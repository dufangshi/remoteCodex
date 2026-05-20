import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AgentRuntime,
  AgentRuntimeRegistry,
  AgentGoal,
  AgentProviderId,
  AgentProviderRequest,
  AgentRuntimeEvent,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTurn,
} from '../../../packages/agent-runtime/src/index';
import {
  createThreadActivityNoteRecord,
  createThreadForkRecord,
  createThreadPendingSteerRecord,
  createThreadRecord,
  createWorkspaceRecord,
  DatabaseClient,
  deleteThreadActivityNotesByThreadId,
  deleteThreadForkRecordsByForkedThreadId,
  deleteThreadForkRecordsBySourceThreadId,
  deleteThreadGoalRecordsByThreadId,
  deleteThreadHistoryItemRecordsByThreadId,
  deleteNotificationsByThreadId,
  deleteThreadPendingSteerRecordById,
  deleteThreadPendingSteerRecordsByThreadId,
  deleteThreadRecord,
  deleteThreadTurnMetadataByThreadId,
  deleteViewerSessionsByThreadId,
  getThreadTurnMetadataByThreadAndTurnId,
  getLatestThreadTurnMetadataByThreadId,
  getThreadRecordByProviderSessionId,
  getThreadRecordById,
  getWorkspaceRecordByPath,
  getWorkspaceRecordById,
  listThreadActivityNotesByThreadId,
  listThreadForkRecordsByForkedThreadId,
  listThreadForkRecordsBySourceThreadId,
  listThreadGoalRecordsByThreadId,
  listThreadHistoryItemRecordsByThreadId,
  listThreadPendingSteerRecordsByThreadId,
  listThreadTurnMetadataByThreadId,
  listThreadRecords,
  markActiveThreadGoalRecordTerminated,
  upsertThreadGoalRecord,
  upsertThreadHistoryItemRecord,
  upsertThreadTurnMetadata,
  updateThreadRecord
} from '../../../packages/db/src/index';
import {
  ApprovalMode,
  CollaborationModeDto,
  AgentHookDto,
  AgentHookEventNameDto,
  AgentSkillDto,
  CreateThreadInput,
  ExportThreadPdfInput,
  ForkThreadInput,
  ImportThreadInput,
  CreateThreadHookInput,
  ModelOptionDto,
  PromptAttachmentManifestEntryDto,
  ReasoningEffortDto,
  RespondThreadActionRequestInput,
  ResumeThreadInput,
  SandboxModeDto,
  SendThreadPromptInput,
  ThreadAnsweredRequestNoteDto,
  ThreadActionRequestDto,
  ThreadActivityNoteDto,
  ThreadContextUsageDto,
  ThreadDetailDto,
  ThreadDto,
  ThreadEventEnvelope,
  ThreadExportTurnOptionsDto,
  ThreadForkResultDto,
  ThreadForkTurnOptionDto,
  ThreadGoalDto,
  ThreadHooksDto,
  TrustThreadHookInput,
  ThreadHistoryItemDetailDto,
  ThreadHistoryItemDto,
  ThreadLiveItemsDto,
  ThreadLivePlanDto,
  ThreadMcpServersDto,
  ThreadPendingSteerDto,
  ThreadSkillsDto,
  ThreadSourceDto,
  ThreadTurnDto,
  ThreadTurnPricingTierDto,
  ThreadTurnTokenUsageDto,
  ThreadStatusDto,
  UntrustThreadHookInput,
  UpdateThreadGoalInput,
  UpdateThreadHookInput,
  UpdateThreadSettingsInput,
  WorkspaceDto
} from '../../../packages/shared/src/index';

type UpstreamThreadGoalStatus = Exclude<ThreadGoalDto['status'], 'terminated'>;
type NormalizedThreadGoal = ThreadGoalDto;
import {
  renderThreadExportPdf,
  renderThreadExportStandaloneHtml,
} from './exports/thread-pdf-export';
import { HttpError } from './app';
import {
  readCodexFastModeSync,
  readCodexFeatureFlag,
  writeCodexFeatureFlag,
  writeCodexFastMode,
} from './codex/codexHostConfig';
import { SupervisorEventBus } from './event-bus';
import { LocalCodexSessionStore } from './codex/local-session-store';
import {
  isCodexRuntimeRequestError,
  isRemoteThreadBootstrapError,
  isUnsupportedHooksListError,
  parseTurnSteerRace,
  unwrapCodexJsonRpcError,
} from './codex/runtime-errors';
import {
  applyRecordedTurnItemOrders,
  agentTurnToThreadTurnDto,
  deferLargeHistoryItemDetails,
  mergePersistedHistoryItemsIntoTurns,
  parseStoredHistoryItem,
  shouldPersistLiveHistoryItem,
  sortHistoryItemsBySequence,
  type TurnItemOrderSnapshot,
} from './thread-history-items';
import {
  buildTurnPricingSnapshot,
  contextWindowForModel,
  estimateTurnPrice,
  supportsFastMode,
} from './codex/modelPricing';
import { truncateAutoThreadTitle } from './codex/thread-title';

const DEFAULT_THREAD_TITLE = 'Untitled thread';
const GENERIC_REMOTE_THREAD_TITLE = 'Thread';
const LOCAL_PLAN_DECISION_PREFIX = 'plan-decision:';
const IMPLEMENT_APPROVED_PLAN_PROMPT = 'Implement the approved plan.';
const THREAD_DETAIL_CACHE_TTL_MS = 5_000;
const CONTEXT_BASELINE_TOKENS = 12_000;
const FAST_MODE_NOTE_ON = 'Fast mode on';
const FAST_MODE_NOTE_OFF = 'Fast mode off';
const HOOK_EVENT_JSON_KEYS = {
  preToolUse: 'PreToolUse',
  permissionRequest: 'PermissionRequest',
  postToolUse: 'PostToolUse',
  preCompact: 'PreCompact',
  postCompact: 'PostCompact',
  sessionStart: 'SessionStart',
  userPromptSubmit: 'UserPromptSubmit',
  stop: 'Stop',
} as const;
const HOOK_EVENT_DTO_KEYS = Object.fromEntries(
  Object.entries(HOOK_EVENT_JSON_KEYS).map(([dtoKey, jsonKey]) => [jsonKey, dtoKey]),
) as Record<string, AgentHookEventNameDto>;

const GOAL_FEATURE_DISABLED_MESSAGE =
  'Codex /goal is experimental. Enable it by adding `goals = true` under `[features]` in ~/.codex/config.toml, then restart the Codex app-server.';

type PendingThreadRequestRecord =
  | {
      source: 'server';
      providerRequestId: string | number;
      responseKind: string;
      responsePayload?: Record<string, unknown>;
      request: ThreadActionRequestDto & { kind: 'requestUserInput' };
    }
  | {
      source: 'planDecision';
      request: ThreadActionRequestDto;
    };

interface ThreadDetailCacheEntry {
  cachedAt: number;
  turns: ThreadTurnDto[];
  totalTurnCount: number;
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>;
}

interface SendPromptOptions {
  displayPrompt?: string | null;
}

interface ThreadContextTokenUsagePayload {
  total?: Record<string, unknown> | null;
  last?: Record<string, unknown> | null;
  modelContextWindow?: unknown;
  model_context_window?: unknown;
}

interface ThreadTurnTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface StoredThreadTurnTokenUsageState {
  baselineTotal: ThreadTurnTokenUsageBreakdown | null;
  usage: ThreadTurnTokenUsageDto | null;
}

interface ThreadTurnMetadataRecord {
  model: string | null;
  reasoningEffort: string | null;
  reasoningEffortAvailable: boolean | null;
  pricingModelKey: string | null;
  pricingTierKey: ThreadTurnPricingTierDto | null;
  tokenUsageJson: string | null;
}

function toIsoFromEpoch(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return new Date().toISOString();
  }
  const epochMs = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(epochMs).toISOString();
}

function toThreadGoalDto(goal: {
  threadId: string;
  localGoalId?: string | null;
  objective: string;
  status: ThreadGoalDto['status'];
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number | string;
  updatedAt: number | string;
  completedAt?: string | null;
}): ThreadGoalDto {
  return {
    threadId: goal.threadId,
    localGoalId: goal.localGoalId ?? null,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.tokenBudget,
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt:
      typeof goal.createdAt === 'string'
        ? goal.createdAt
        : toIsoFromEpoch(goal.createdAt),
    updatedAt:
      typeof goal.updatedAt === 'string'
        ? goal.updatedAt
        : toIsoFromEpoch(goal.updatedAt),
    completedAt: goal.completedAt ?? null,
  };
}

function toThreadGoalDtoFromAgentGoal(goal: AgentGoal): ThreadGoalDto {
  return toThreadGoalDto({
    threadId: goal.providerSessionId,
    objective: goal.objective,
    status: goal.status as ThreadGoalDto['status'],
    tokenBudget: goal.tokenBudget,
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
  });
}

function toThreadGoalDtoFromRecord(record: ReturnType<typeof listThreadGoalRecordsByThreadId>[number]): ThreadGoalDto {
  const terminalCompletedAt =
    record.completedAt ??
    (['complete', 'terminated'].includes(record.status) ? record.updatedAt : null);
  return toThreadGoalDto({
    threadId: record.providerSessionId,
    localGoalId: record.id,
    objective: record.objective,
    status: record.status as ThreadGoalDto['status'],
    tokenBudget: record.tokenBudget,
    tokensUsed: record.tokensUsed,
    timeUsedSeconds: record.timeUsedSeconds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: terminalCompletedAt,
  });
}

function normalizeThreadGoalStatusForThread(
  goal: ThreadGoalDto,
  record: {
    id?: string;
    providerSessionId?: string | null;
    providerTurnId?: string | null;
    status?: string | null;
  },
): NormalizedThreadGoal {
  if (
    goal.status === 'complete' &&
    (record.providerTurnId || record.status === 'running')
  ) {
    return {
      ...goal,
      status: 'active',
      completedAt: null,
    };
  }

  return goal;
}

function goalHistoryKey(goal: ThreadGoalDto) {
  return `${goal.threadId}:${goal.objective}:${goal.createdAt}`;
}

function mergeGoalHistoryEntry(existing: ThreadGoalDto, incoming: ThreadGoalDto) {
  const existingUpdatedAt = Date.parse(existing.updatedAt) || 0;
  const incomingUpdatedAt = Date.parse(incoming.updatedAt) || 0;
  const latest = incomingUpdatedAt >= existingUpdatedAt ? incoming : existing;
  const fallback = latest === incoming ? existing : incoming;

  return {
    ...latest,
    localGoalId: latest.localGoalId ?? fallback.localGoalId ?? null,
  };
}

function mapCodexGoalError(error: unknown): never {
  const codexError = unwrapCodexJsonRpcError(error);
  if (codexError) {
    const remoteMessage = codexError.message || '';
    if (remoteMessage.toLowerCase().includes('goals feature is disabled')) {
      throw new HttpError(409, {
        code: 'goal_feature_disabled',
        message: GOAL_FEATURE_DISABLED_MESSAGE,
      });
    }

    throw new HttpError(502, {
      code: 'codex_goal_error',
      message: remoteMessage || 'Codex goal operation failed.',
    });
  }

  throw error;
}

function approvalModeToPolicy(approvalMode: ApprovalMode): 'never' | 'on-request' {
  return approvalMode === 'guarded' ? 'on-request' : 'never';
}

function defaultSandboxModeForApprovalMode(
  approvalMode: ApprovalMode | null | undefined,
): SandboxModeDto {
  return approvalMode === 'guarded' ? 'workspace-write' : 'danger-full-access';
}

function normalizeSandboxMode(
  value: string | null | undefined,
): SandboxModeDto | null {
  switch (value) {
    case 'read-only':
    case 'workspace-write':
    case 'danger-full-access':
      return value;
    default:
      return null;
  }
}

function normalizeReasoningEffort(
  value: string | null | undefined
): ReasoningEffortDto | null {
  switch (value) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return value;
    default:
      return null;
  }
}

function normalizeCollaborationMode(
  value: string | null | undefined
): CollaborationModeDto {
  return value === 'plan' ? 'plan' : 'default';
}

function normalizeFastMode(value: unknown): boolean {
  return value === true || value === 1;
}

function performanceModeForFastMode(
  fastMode: boolean,
): 'fast' | 'standard' {
  return fastMode ? 'fast' : 'standard';
}

function normalizePricingTier(
  value: string | null | undefined,
): ThreadTurnPricingTierDto | null {
  return value === 'fast' || value === 'standard' ? value : null;
}

function ensureFastModeSupported(
  model: string | null | undefined,
  fastMode: boolean,
) {
  if (!fastMode) {
    return;
  }

  if (supportsFastMode(model)) {
    return;
  }

  throw new HttpError(400, {
    code: 'bad_request',
    message: 'Current model does not support fast mode.',
  });
}

function isAutoGeneratedTitle(title: string | null | undefined) {
  const normalized = title?.trim();
  return !normalized || normalized === DEFAULT_THREAD_TITLE || normalized === GENERIC_REMOTE_THREAD_TITLE;
}

function extractTurnUserMessages(turn: AgentTurn) {
  return turn.items
    .filter((item) => item.kind === 'userMessage')
    .map((item) => item.text.trim())
    .filter((text) => text.length > 0);
}

function buildAnsweredRequestNote(
  request: ThreadActionRequestDto,
  input: RespondThreadActionRequestInput,
): ThreadAnsweredRequestNoteDto | null {
  const summaryLines = request.questions
    .map((question) => {
      const answer = input.answers[question.id]?.answers[0]?.trim();
      if (!answer) {
        return null;
      }

      return `${question.header}: ${answer}`;
    })
    .filter((line): line is string => Boolean(line));

  if (summaryLines.length === 0) {
    return null;
  }

  return {
    id: request.id,
    turnId: request.turnId ?? null,
    title: request.title,
    summaryLines,
    createdAt: new Date().toISOString(),
  };
}

function toIsoFromUnix(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

async function pathExists(absPath: string) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveComparablePath(absPath: string): Promise<string> {
  const resolved = path.resolve(absPath);
  if (await pathExists(resolved)) {
    return fs.realpath(resolved);
  }

  const parentPath = path.dirname(resolved);
  if (parentPath === resolved) {
    return resolved;
  }

  const resolvedParent = await resolveComparablePath(parentPath);
  return path.join(resolvedParent, path.basename(resolved));
}

async function resolveImportedWorkspacePath(
  workspaceRoot: string,
  candidatePath: string
) {
  if (!path.isAbsolute(candidatePath)) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Imported session path must be absolute.'
    });
  }

  const resolvedRoot = await resolveComparablePath(workspaceRoot);
  const resolvedCandidate = await resolveComparablePath(candidatePath);
  const normalizedRoot = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`;

  if (
    resolvedCandidate !== resolvedRoot &&
    !resolvedCandidate.startsWith(normalizedRoot)
  ) {
    throw new HttpError(403, {
      code: 'forbidden',
      message: 'Imported session path must stay within the configured workspace root.'
    });
  }

  return resolvedCandidate;
}

function toWorkspaceDto(record: {
  id: string;
  hostId: string;
  label: string;
  absPath: string;
  isFavorite: boolean;
  createdAt: string;
  lastOpenedAt: string | null;
}): WorkspaceDto {
  return {
    id: record.id,
    hostId: record.hostId,
    label: record.label,
    absPath: record.absPath,
    isFavorite: record.isFavorite,
    createdAt: record.createdAt,
    lastOpenedAt: record.lastOpenedAt
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function createUnavailableThreadContextUsage(
  timestamp: string | null = new Date().toISOString(),
): ThreadContextUsageDto {
  return {
    availability: 'unavailable',
    remainingPercent: null,
    tokensInContextWindow: null,
    modelContextWindow: null,
    updatedAt: timestamp,
  };
}

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function computeContextRemainingPercent(
  tokensInContextWindow: number,
  contextWindow: number,
) {
  if (contextWindow <= CONTEXT_BASELINE_TOKENS) {
    return 0;
  }

  const effectiveWindow = contextWindow - CONTEXT_BASELINE_TOKENS;
  const used = Math.max(tokensInContextWindow - CONTEXT_BASELINE_TOKENS, 0);
  const remaining = Math.max(effectiveWindow - used, 0);
  return clampPercentage(Math.round((remaining / effectiveWindow) * 100));
}

function buildThreadContextUsageFromPayload(
  payload: ThreadContextTokenUsagePayload | null | undefined,
  model: string | null | undefined = null,
  timestamp = new Date().toISOString(),
): ThreadContextUsageDto {
  const tokenUsage = isRecord(payload) ? payload : null;
  const modelContextWindow =
    contextWindowForModel(model) ??
    numberOrNull(
      tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window,
    );
  const lastUsage = isRecord(tokenUsage?.last) ? tokenUsage.last : null;
  const tokensInContextWindow = numberOrNull(
    lastUsage?.totalTokens ?? lastUsage?.total_tokens,
  );

  if (
    modelContextWindow === null ||
    tokensInContextWindow === null ||
    modelContextWindow <= 0
  ) {
    return createUnavailableThreadContextUsage(timestamp);
  }

  return {
    availability: 'available',
    remainingPercent: computeContextRemainingPercent(
      tokensInContextWindow,
      modelContextWindow,
    ),
    tokensInContextWindow,
    modelContextWindow,
    updatedAt: timestamp,
  };
}

function buildTurnTokenBreakdown(
  payload: Record<string, unknown> | null | undefined,
): ThreadTurnTokenUsageBreakdown | null {
  const usage = isRecord(payload) ? payload : null;
  const totalTokens = numberOrNull(usage?.totalTokens ?? usage?.total_tokens);
  const inputTokens = numberOrNull(usage?.inputTokens ?? usage?.input_tokens);
  const cachedInputTokens = numberOrNull(
    usage?.cachedInputTokens ?? usage?.cached_input_tokens,
  );
  const outputTokens = numberOrNull(usage?.outputTokens ?? usage?.output_tokens);
  const reasoningOutputTokens = numberOrNull(
    usage?.reasoningOutputTokens ?? usage?.reasoning_output_tokens,
  );

  if (
    totalTokens === null ||
    inputTokens === null ||
    cachedInputTokens === null ||
    outputTokens === null ||
    reasoningOutputTokens === null
  ) {
    return null;
  }

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
  };
}

function zeroTurnTokenBreakdown(): ThreadTurnTokenUsageBreakdown {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function subtractTurnTokenBreakdowns(
  current: ThreadTurnTokenUsageBreakdown,
  previous: ThreadTurnTokenUsageBreakdown,
): ThreadTurnTokenUsageBreakdown {
  return {
    totalTokens: Math.max(current.totalTokens - previous.totalTokens, 0),
    inputTokens: Math.max(current.inputTokens - previous.inputTokens, 0),
    cachedInputTokens: Math.max(
      current.cachedInputTokens - previous.cachedInputTokens,
      0,
    ),
    outputTokens: Math.max(current.outputTokens - previous.outputTokens, 0),
    reasoningOutputTokens: Math.max(
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
      0,
    ),
  };
}

function parseThreadTurnTokenUsage(
  payload: Record<string, unknown> | null | undefined,
): ThreadTurnTokenUsageDto | null {
  const tokenUsage = isRecord(payload) ? payload : null;
  const total = buildTurnTokenBreakdown(
    isRecord(tokenUsage?.total) ? tokenUsage.total : null,
  );
  const last = buildTurnTokenBreakdown(
    isRecord(tokenUsage?.last) ? tokenUsage.last : null,
  );
  const modelContextWindow = numberOrNull(
    tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window,
  );

  if (!total || !last) {
    return null;
  }

  return {
    total,
    last,
    modelContextWindow,
  };
}

function parseStoredThreadTurnTokenUsageState(
  value: string | null | undefined,
): StoredThreadTurnTokenUsageState {
  if (!value) {
    return {
      baselineTotal: null,
      usage: null,
    };
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const baselineTotal = buildTurnTokenBreakdown(
      isRecord(parsed?.baselineTotal) ? parsed.baselineTotal : null,
    );

    return {
      baselineTotal,
      usage: parseThreadTurnTokenUsage(parsed),
    };
  } catch {
    return {
      baselineTotal: null,
      usage: null,
    };
  }
}

function cumulativeTotalFromStoredThreadTurnTokenUsageState(
  state: StoredThreadTurnTokenUsageState,
): ThreadTurnTokenUsageBreakdown | null {
  if (!state.usage?.total) {
    return null;
  }

  if (!state.baselineTotal) {
    return state.usage.total;
  }

  return {
    totalTokens: state.baselineTotal.totalTokens + state.usage.total.totalTokens,
    inputTokens: state.baselineTotal.inputTokens + state.usage.total.inputTokens,
    cachedInputTokens:
      state.baselineTotal.cachedInputTokens + state.usage.total.cachedInputTokens,
    outputTokens: state.baselineTotal.outputTokens + state.usage.total.outputTokens,
    reasoningOutputTokens:
      state.baselineTotal.reasoningOutputTokens +
      state.usage.total.reasoningOutputTokens,
  };
}

function stringifyStoredThreadTurnTokenUsageState(
  state: StoredThreadTurnTokenUsageState,
) {
  return JSON.stringify({
    baselineTotal: state.baselineTotal,
    total: state.usage?.total ?? null,
    last: state.usage?.last ?? null,
    modelContextWindow: state.usage?.modelContextWindow ?? null,
  });
}

function buildThreadTurnTokenUsage(
  payload: ThreadContextTokenUsagePayload | null | undefined,
  baselineTotal: ThreadTurnTokenUsageBreakdown,
  previous: ThreadTurnTokenUsageDto | null = null,
): ThreadTurnTokenUsageDto | null {
  const tokenUsage = isRecord(payload) ? payload : null;
  const cumulativeTotal = buildTurnTokenBreakdown(
    isRecord(tokenUsage?.total) ? tokenUsage.total : null,
  );
  const last = buildTurnTokenBreakdown(
    isRecord(tokenUsage?.last) ? tokenUsage.last : null,
  );
  const modelContextWindow = numberOrNull(
    tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window,
  );

  if (!last) {
    return null;
  }

  return {
    total:
      cumulativeTotal
        ? subtractTurnTokenBreakdowns(cumulativeTotal, baselineTotal)
        : previous?.total ?? last,
    last,
    modelContextWindow:
      modelContextWindow ?? previous?.modelContextWindow ?? null,
  };
}

function parseThreadTurnTokenUsageJson(
  value: string | null | undefined,
): ThreadTurnTokenUsageDto | null {
  return parseStoredThreadTurnTokenUsageState(value).usage;
}

interface UploadedPromptAttachment {
  manifest: PromptAttachmentManifestEntryDto;
  buffer: Buffer;
}

function sanitizeAttachmentFileName(originalName: string) {
  const basename = path.basename(originalName).trim() || 'attachment';
  const extension = path.extname(basename).replace(/[^a-zA-Z0-9.]/g, '');
  const rawStem = extension ? basename.slice(0, -extension.length) : basename;
  const sanitizedStem = rawStem
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  const stem = sanitizedStem || 'attachment';
  const normalizedExtension = extension.slice(0, 16);
  return `${stem}-${randomUUID().slice(0, 8)}${normalizedExtension}`;
}

function threadTempDirectoryPath(workspacePath: string, localThreadId: string) {
  return path.join(workspacePath, '.temp', 'threads', localThreadId);
}

function normalizeHooksJson(value: unknown): { hooks: Record<string, unknown[]> } & Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.hooks)) {
    return { hooks: {} as Record<string, unknown[]> };
  }

  const hooks: Record<string, unknown[]> = {};
  for (const [eventName, groups] of Object.entries(value.hooks)) {
    hooks[eventName] = Array.isArray(groups) ? groups : [];
  }
  return { ...value, hooks };
}

function readJsonFileOrDefault(
  filePath: string,
): Promise<{ hooks: Record<string, unknown[]> } & Record<string, unknown>> {
  return fs
    .readFile(filePath, 'utf8')
    .then((raw) => {
      if (!raw.trim()) {
        return { hooks: {} as Record<string, unknown[]> };
      }
      return normalizeHooksJson(JSON.parse(raw));
    })
    .catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { hooks: {} as Record<string, unknown[]> };
      }
      throw error;
    });
}

function validateHookInput(input: CreateThreadHookInput) {
  if (!HOOK_EVENT_JSON_KEYS[input.eventName]) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Unsupported hook event.',
    });
  }
  if (input.scope !== 'global' && input.scope !== 'project') {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Hook scope must be global or project.',
    });
  }
  if (!input.command.trim()) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Hook command cannot be empty.',
    });
  }
  if (
    input.timeoutSec !== undefined &&
    input.timeoutSec !== null &&
    (!Number.isInteger(input.timeoutSec) || input.timeoutSec <= 0 || input.timeoutSec > 86_400)
  ) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Hook timeout must be a positive number of seconds.',
    });
  }
}

async function writeHookJsonEntry({
  codexHome,
  workspacePath,
  input,
}: {
  codexHome: string;
  workspacePath: string;
  input: CreateThreadHookInput;
}) {
  validateHookInput(input);

  const hooksPath =
    input.scope === 'global'
      ? path.join(codexHome, 'hooks.json')
      : path.join(workspacePath, '.codex', 'hooks.json');
  const config = await readJsonFileOrDefault(hooksPath);
  const eventKey = HOOK_EVENT_JSON_KEYS[input.eventName];
  const matcher = input.matcher?.trim() || null;
  const handler: Record<string, unknown> = {
    type: 'command',
    command: input.command.trim(),
  };
  if (input.timeoutSec !== undefined && input.timeoutSec !== null) {
    handler.timeout = input.timeoutSec;
  }
  if (input.statusMessage?.trim()) {
    handler.statusMessage = input.statusMessage.trim();
  }

  const group: Record<string, unknown> = {
    hooks: [handler],
  };
  if (matcher) {
    group.matcher = matcher;
  }

  const currentGroups = Array.isArray(config.hooks[eventKey])
    ? config.hooks[eventKey]
    : [];
  config.hooks[eventKey] = [...currentGroups, group];

  await fs.mkdir(path.dirname(hooksPath), { recursive: true });
  await fs.writeFile(hooksPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function hookInputMatches(
  group: unknown,
  handler: unknown,
  input: CreateThreadHookInput,
) {
  if (!isRecord(group) || !isRecord(handler)) {
    return false;
  }
  const matcher = typeof group.matcher === 'string' ? group.matcher : null;
  const handlerCommand = typeof handler.command === 'string' ? handler.command : '';
  const handlerTimeout =
    typeof handler.timeout === 'number' && Number.isFinite(handler.timeout)
      ? handler.timeout
      : null;
  const handlerStatusMessage =
    typeof handler.statusMessage === 'string' ? handler.statusMessage : null;
  return (
    handler.type === 'command' &&
    (input.matcher?.trim() || null) === matcher &&
    input.command.trim() === handlerCommand &&
    (input.timeoutSec ?? null) === handlerTimeout &&
    (input.statusMessage?.trim() || null) === handlerStatusMessage
  );
}

async function updateHookJsonEntry({
  codexHome,
  workspacePath,
  input,
}: {
  codexHome: string;
  workspacePath: string;
  input: UpdateThreadHookInput;
}) {
  validateHookInput(input);
  validateHookInput(input.target);

  if (input.scope !== input.target.scope) {
    throw new HttpError(400, {
      code: 'bad_request',
      message: 'Hook scope cannot be changed while editing.',
    });
  }

  const hooksPath =
    input.scope === 'global'
      ? path.join(codexHome, 'hooks.json')
      : path.join(workspacePath, '.codex', 'hooks.json');
  const config = await readJsonFileOrDefault(hooksPath);
  const targetEventKey = HOOK_EVENT_JSON_KEYS[input.target.eventName];
  const nextEventKey = HOOK_EVENT_JSON_KEYS[input.eventName];
  const currentGroups = Array.isArray(config.hooks[targetEventKey])
    ? config.hooks[targetEventKey]
    : [];
  let replacementGroup: Record<string, unknown> | null = null;

  config.hooks[targetEventKey] = currentGroups
    .map((group) => {
      if (replacementGroup || !isRecord(group) || !Array.isArray(group.hooks)) {
        return group;
      }
      const hookIndex = group.hooks.findIndex((handler) =>
        hookInputMatches(group, handler, input.target),
      );
      if (hookIndex < 0) {
        return group;
      }

      const handler: Record<string, unknown> = {
        type: 'command',
        command: input.command.trim(),
      };
      if (input.timeoutSec !== undefined && input.timeoutSec !== null) {
        handler.timeout = input.timeoutSec;
      }
      if (input.statusMessage?.trim()) {
        handler.statusMessage = input.statusMessage.trim();
      }
      replacementGroup = {
        hooks: [handler],
      };
      const matcher = input.matcher?.trim() || null;
      if (matcher) {
        replacementGroup.matcher = matcher;
      }

      if (targetEventKey !== nextEventKey) {
        const remainingHooks = group.hooks.filter((_, index) => index !== hookIndex);
        return {
          ...group,
          hooks: remainingHooks,
        };
      }

      return {
        ...replacementGroup,
        hooks: group.hooks.map((existing, index) =>
          index === hookIndex
            ? (replacementGroup!.hooks as unknown[])[0]
            : existing,
        ),
      };
    })
    .filter((group) => {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        return true;
      }
      return group.hooks.length > 0;
    });

  if (!replacementGroup) {
    throw new HttpError(404, {
      code: 'not_found',
      message: 'Hook was not found in hooks.json.',
    });
  }

  if (targetEventKey !== nextEventKey) {
    if (config.hooks[targetEventKey]?.length === 0) {
      delete config.hooks[targetEventKey];
    }
    const nextGroups = Array.isArray(config.hooks[nextEventKey])
      ? config.hooks[nextEventKey]
      : [];
    config.hooks[nextEventKey] = [...nextGroups, replacementGroup];
  }

  await fs.mkdir(path.dirname(hooksPath), { recursive: true });
  await fs.writeFile(hooksPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function readLocalHookDtos({
  hooksPath,
  source,
  displayOffset,
}: {
  hooksPath: string;
  source: 'user' | 'project';
  displayOffset: number;
}): Promise<AgentHookDto[]> {
  const config = await readJsonFileOrDefault(hooksPath);
  const hooks: AgentHookDto[] = [];
  for (const [eventKey, groups] of Object.entries(config.hooks)) {
    const eventName = HOOK_EVENT_DTO_KEYS[eventKey];
    if (!eventName || !Array.isArray(groups)) {
      continue;
    }
    groups.forEach((group, groupIndex) => {
      if (!isRecord(group) || !Array.isArray(group.hooks)) {
        return;
      }
      const matcher = typeof group.matcher === 'string' ? group.matcher : null;
      group.hooks.forEach((handler, handlerIndex) => {
        if (!isRecord(handler) || handler.type !== 'command') {
          return;
        }
        const command = typeof handler.command === 'string' ? handler.command : null;
        if (!command) {
          return;
        }
        const timeoutSec =
          typeof handler.timeout === 'number' && Number.isFinite(handler.timeout)
            ? handler.timeout
            : 600;
        const statusMessage =
          typeof handler.statusMessage === 'string' ? handler.statusMessage : null;
        const key = `${source}:${hooksPath}:${eventKey}:${groupIndex}:${handlerIndex}`;
        hooks.push({
          key,
          eventName,
          handlerType: 'command',
          matcher,
          command,
          timeoutSec,
          statusMessage,
          sourcePath: hooksPath,
          source,
          pluginId: null,
          displayOrder: displayOffset + hooks.length,
          enabled: true,
          isManaged: false,
          currentHash: '',
          trustStatus: 'untrusted',
        });
      });
    });
  }
  return hooks;
}

function hookMatchesInput(hook: AgentHookDto, input: CreateThreadHookInput) {
  return (
    hook.source === input.scope &&
    hook.eventName === input.eventName &&
    (hook.matcher ?? null) === (input.matcher ?? null) &&
    hook.command === input.command &&
    (input.timeoutSec == null || hook.timeoutSec === input.timeoutSec) &&
    (hook.statusMessage ?? null) === (input.statusMessage ?? null)
  );
}

async function findOfficialHookForInput(
  runtime: AgentRuntime,
  workspacePath: string,
  input: CreateThreadHookInput,
): Promise<AgentHookDto | null> {
  if (!runtime.listHooks) {
    return null;
  }
  const [entry] = await runtime.listHooks({
    cwds: [workspacePath],
  }) as Awaited<ReturnType<NonNullable<AgentRuntime['listHooks']>>>;
  const officialHooks: AgentHookDto[] = (entry?.hooks ?? []).map((hook) => ({
    key: hook.key,
    eventName: hook.eventName as AgentHookDto['eventName'],
    handlerType: hook.handlerType as AgentHookDto['handlerType'],
    matcher: hook.matcher,
    command: hook.command,
    timeoutSec: hook.timeoutSec,
    statusMessage: hook.statusMessage,
    sourcePath: hook.sourcePath,
    source: hook.source as AgentHookDto['source'],
    pluginId: hook.pluginId,
    displayOrder: hook.displayOrder,
    enabled: hook.enabled,
    isManaged: hook.isManaged,
    currentHash: hook.currentHash,
    trustStatus: hook.trustStatus as AgentHookDto['trustStatus'],
  }));
  return officialHooks.find((hook) => hookMatchesInput(hook, input)) ?? null;
}

async function trustHookForInput(
  runtime: AgentRuntime,
  workspacePath: string,
  input: CreateThreadHookInput,
) {
  const hook = await findOfficialHookForInput(runtime, workspacePath, input);
  if (!runtime.setHookTrust || !hook || !hook.key || !hook.currentHash || hook.isManaged) {
    return;
  }

  await runtime.setHookTrust({
    key: hook.key,
    trustedHash: hook.currentHash,
  });
}

function buildTurnDto(
  turn: ThreadTurnDto,
  metadata: ThreadTurnMetadataRecord | undefined,
): ThreadTurnDto {
  const tokenUsage = parseThreadTurnTokenUsageJson(metadata?.tokenUsageJson);

  return {
    ...turn,
    model: metadata?.model ?? null,
    reasoningEffort: normalizeReasoningEffort(metadata?.reasoningEffort),
    reasoningEffortAvailable: metadata?.reasoningEffortAvailable ?? null,
    tokenUsage,
    priceEstimate: estimateTurnPrice(tokenUsage, {
      pricingModelKey: metadata?.pricingModelKey,
      pricingTierKey: normalizePricingTier(metadata?.pricingTierKey),
    }),
  };
}

function sliceTurnsForDetail<T extends { id: string }>(
  turns: T[],
  options: { limit?: number; beforeTurnId?: string } = {},
) {
  const totalTurnCount = turns.length;
  const limit = options.limit ?? 10;

  if (turns.length === 0) {
    return {
      turns,
      totalTurnCount,
    };
  }

  if (options.beforeTurnId) {
    const beforeIndex = turns.findIndex((turn) => turn.id === options.beforeTurnId);
    const exclusiveEnd = beforeIndex >= 0 ? beforeIndex : turns.length;
    const start = Math.max(0, exclusiveEnd - limit);
    return {
      turns: turns.slice(start, exclusiveEnd),
      totalTurnCount,
    };
  }

  return {
    turns: turns.slice(Math.max(0, turns.length - limit)),
    totalTurnCount,
  };
}

function userPromptPreviewFromTurn(turn: ThreadTurnDto) {
  const prompt = turn.items.find((item) => item.kind === 'userMessage')?.text.trim();
  if (!prompt) {
    return 'No user prompt captured';
  }

  const singleLine = prompt.replace(/\s+/g, ' ').trim();
  return singleLine.length > 96 ? `${singleLine.slice(0, 95).trimEnd()}...` : singleLine;
}

function defaultExportOptions(input: ExportThreadPdfInput) {
  return {
    includeTokenAndPrice: input.options?.includeTokenAndPrice ?? true,
    includeCommandOutput: input.options?.includeCommandOutput ?? false,
    includeAbsolutePaths: input.options?.includeAbsolutePaths ?? false,
  };
}

function safeExportFileName(title: string) {
  return safeTranscriptExportFileName(title, 'pdf');
}

function safeTranscriptExportFileName(title: string, extension: 'pdf' | 'html') {
  const stem = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  return `remote-codex-${stem || 'thread'}-${timestamp}.${extension}`;
}

export class ThreadService {
  private readonly pendingRequests = new Map<string, Map<string, PendingThreadRequestRecord>>();
  private readonly dismissedPlanDecisionTurns = new Map<string, string>();
  private readonly threadDetailCache = new Map<string, ThreadDetailCacheEntry>();
  private readonly threadContextUsage = new Map<string, ThreadContextUsageDto>();
  private readonly threadCumulativeTokenUsage = new Map<string, ThreadTurnTokenUsageBreakdown>();
  private readonly threadLivePlans = new Map<string, ThreadLivePlanDto>();
  private readonly threadLiveItems = new Map<string, ThreadLiveItemsDto>();
  private readonly threadTurnItemOrder = new Map<string, Map<string, Map<string, number>>>();
  private readonly threadNextTurnItemSequence = new Map<string, Map<string, number>>();
  private readonly answeredRequestNotes = new Map<string, ThreadAnsweredRequestNoteDto[]>();

  constructor(
    private readonly db: DatabaseClient,
    private readonly agentRuntimes: AgentRuntimeRegistry,
    private readonly eventBus: SupervisorEventBus,
    private readonly localSessionStore: LocalCodexSessionStore,
    private readonly workspaceRoot: string,
    private readonly codexHome: string,
  ) {
    for (const runtime of this.agentRuntimes.all()) {
      runtime.on('event', (event) => {
        void this.handleRuntimeEvent(event as AgentRuntimeEvent);
      });
      runtime.on('provider-request', (request) => {
        void this.handleProviderRequest(request as AgentProviderRequest);
      });
    }
  }

  private normalizeProvider(provider: string | null | undefined): AgentProviderId {
    if (!provider || provider === 'codex') {
      return 'codex';
    }
    if (provider === 'claude') {
      return 'claude';
    }
    throw new HttpError(400, {
      code: 'bad_request',
      message: `Unsupported agent runtime provider: ${provider}`,
    });
  }

  private runtimeForProvider(provider: string | null | undefined): AgentRuntime {
    const normalizedProvider = this.normalizeProvider(provider);
    const runtime = this.agentRuntimes.getOptional(normalizedProvider);
    if (!runtime) {
      throw new HttpError(501, {
        code: 'service_unavailable',
        message: `Agent runtime provider is not configured: ${normalizedProvider}`,
      });
    }
    return runtime;
  }

  private providerForRecord(record: { provider?: string | null | undefined }): AgentProviderId {
    return this.normalizeProvider(record.provider);
  }

  private requireProviderSessionId(record: { providerSessionId?: string | null }) {
    if (!record.providerSessionId) {
      throw new HttpError(503, {
        code: 'service_unavailable',
        message: 'Thread is missing its provider session identifier.',
      });
    }
    return record.providerSessionId;
  }

  private findRecordByProviderSessionId(provider: string | null | undefined, providerSessionId: string) {
    return getThreadRecordByProviderSessionId(
      this.db,
      this.providerForRecord({ provider }),
      providerSessionId,
    );
  }

  private codexRuntime(): AgentRuntime {
    return this.agentRuntimes.get('codex');
  }

  private isCodexProvider(provider: string | null | undefined): boolean {
    return this.providerForRecord({ provider }) === 'codex';
  }

  private runtimeSupportsFastMode(provider: string | null | undefined): boolean {
    return this.runtimeForProvider(provider).capabilities.controls.fastServiceTier;
  }

  private fastModeForProvider(provider: string | null | undefined, fastMode: unknown): boolean {
    return this.runtimeSupportsFastMode(provider) ? normalizeFastMode(fastMode) : false;
  }

  private performanceModeForRecord(record: { provider?: string | null; fastMode?: unknown }) {
    return performanceModeForFastMode(this.fastModeForProvider(record.provider, record.fastMode));
  }

  private assertCodexHooksFileManagement(provider: string | null | undefined): void {
    if (!this.isCodexProvider(provider)) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support hooks file editing.',
      });
    }
  }

  private async handleProviderRequest(request: AgentProviderRequest) {
    await this.handleProviderRuntimeRequest(request);
  }

  private async listLoadedProviderSessionIds(provider: string | null | undefined = 'codex') {
    return new Set(
      await this.runtimeForProvider(provider).listLoadedSessions().catch(() => []),
    );
  }

  private async listProviderModels(provider: string | null | undefined = 'codex') {
    return this.runtimeForProvider(provider).listModels().catch(() => []);
  }

  private getLatestStoredThreadCumulativeTotal(
    localThreadId: string,
    options: { excludeTurnId?: string } = {},
  ): ThreadTurnTokenUsageBreakdown | null {
    const metadata = listThreadTurnMetadataByThreadId(this.db, localThreadId)
      .filter((entry) => entry.turnId !== options.excludeTurnId)
      .sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? '') || 0;
        const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? '') || 0;
        return rightTime - leftTime;
      });

    for (const entry of metadata) {
      const cumulative = cumulativeTotalFromStoredThreadTurnTokenUsageState(
        parseStoredThreadTurnTokenUsageState(entry.tokenUsageJson),
      );
      if (cumulative) {
        return cumulative;
      }
    }

    return null;
  }

  private getThreadDetailCache(localThreadId: string): ThreadDetailCacheEntry | null {
    const cached = this.threadDetailCache.get(localThreadId);
    if (!cached) {
      return null;
    }

    if (Date.now() - cached.cachedAt > THREAD_DETAIL_CACHE_TTL_MS) {
      this.threadDetailCache.delete(localThreadId);
      return null;
    }

    return cached;
  }

  private setThreadDetailCache(localThreadId: string, entry: Omit<ThreadDetailCacheEntry, 'cachedAt'>) {
    this.threadDetailCache.set(localThreadId, {
      ...entry,
      cachedAt: Date.now(),
    });
  }

  private invalidateThreadDetailCache(localThreadId: string) {
    this.threadDetailCache.delete(localThreadId);
  }

  private getThreadContextUsage(localThreadId: string): ThreadContextUsageDto {
    return (
      this.threadContextUsage.get(localThreadId) ??
      createUnavailableThreadContextUsage(null)
    );
  }

  private setThreadContextUsage(
    localThreadId: string,
    usage: ThreadContextUsageDto,
    emitEvent = false,
  ) {
    this.threadContextUsage.set(localThreadId, usage);
    if (!emitEvent) {
      return;
    }

    this.emitThreadEvent('thread.context.updated', localThreadId, {
      contextUsage: usage,
    });
  }

  private resetThreadContextUsage(localThreadId: string, emitEvent = false) {
    this.setThreadContextUsage(
      localThreadId,
      createUnavailableThreadContextUsage(),
      emitEvent,
    );
  }

  private listPersistedHistoryItemsByTurnId(localThreadId: string) {
    const itemsByTurnId = new Map<string, ThreadHistoryItemDto[]>();
    for (const record of listThreadHistoryItemRecordsByThreadId(this.db, localThreadId)) {
      const item = parseStoredHistoryItem(record.itemJson);
      if (!item) {
        continue;
      }

      const current = itemsByTurnId.get(record.turnId) ?? [];
      current.push(item);
      itemsByTurnId.set(record.turnId, current);
    }

    return itemsByTurnId;
  }

  private persistLiveHistoryItem(
    localThreadId: string,
    turnId: string,
    item: ThreadHistoryItemDto,
  ) {
    if (!shouldPersistLiveHistoryItem(item)) {
      return;
    }

    upsertThreadHistoryItemRecord(this.db, {
      threadId: localThreadId,
      turnId,
      itemId: item.id,
      itemJson: JSON.stringify(item),
    });
  }

  private async buildThreadDetailCacheEntry(
    localThreadId: string,
    record: {
      id: string;
      provider?: string | null;
      providerSessionId: string | null;
      collaborationMode: string | null;
      model: string | null;
      reasoningEffort: string | null;
    },
    turnMetadataById: Map<string, ThreadTurnMetadataRecord>,
  ): Promise<ThreadDetailCacheEntry> {
    const cached = this.getThreadDetailCache(localThreadId);
    if (cached) {
      return cached;
    }

    const providerSessionId = this.requireProviderSessionId(record);
    const runtime = this.runtimeForProvider(record.provider);
    let remoteSession: AgentSessionDetail | null = null;
    try {
      const session = await runtime.readSession(providerSessionId);
      remoteSession = session;
    } catch (error) {
      if (!isRemoteThreadBootstrapError(error)) {
        throw error;
      }
    }

    if (!remoteSession) {
      const localSession = await this.localSessionStore.findSession(providerSessionId);
      const deferredDetails = new Map<string, ThreadHistoryItemDetailDto>();
      const persistedItemsByTurnId = this.listPersistedHistoryItemsByTurnId(localThreadId);
      const turns = mergePersistedHistoryItemsIntoTurns(
        applyRecordedTurnItemOrders(
          localSession?.turns ?? [],
          this.turnItemOrderSnapshot(localThreadId),
        ),
        persistedItemsByTurnId,
        deferredDetails,
      ).map((turn) =>
        buildTurnDto(
          deferLargeHistoryItemDetails(turn, deferredDetails),
          turnMetadataById.get(turn.id),
        ),
      );
      const entry = {
        turns,
        totalTurnCount: turns.length,
        deferredDetails,
      };
      this.setThreadDetailCache(localThreadId, entry);
      return this.threadDetailCache.get(localThreadId)!;
    }

    if (
      remoteSession.turns.length > 0 &&
      remoteSession.turns.every((turn) => turn.items.length === 0)
    ) {
      const response = await runtime.resumeSession({
        providerSessionId,
      });
      remoteSession = response.session;
    }

    updateThreadRecord(
      this.db,
      record.id,
      this.buildThreadPatch(remoteSession, record.model, record.reasoningEffort),
    );

    const updated = getThreadRecordById(this.db, record.id)!;
    this.syncPendingPlanDecisionRequest(
      updated.id,
      updated.collaborationMode,
      remoteSession,
    );
    this.reconcilePendingSteers(updated.id, remoteSession);

    const deferredDetails = new Map<string, ThreadHistoryItemDetailDto>();
    const persistedItemsByTurnId = this.listPersistedHistoryItemsByTurnId(localThreadId);
    const turns = mergePersistedHistoryItemsIntoTurns(
      applyRecordedTurnItemOrders(
        remoteSession.turns.map((turn) => agentTurnToThreadTurnDto(turn, deferredDetails)),
        this.turnItemOrderSnapshot(localThreadId),
      ),
      persistedItemsByTurnId,
      deferredDetails,
    ).map((turn) =>
      buildTurnDto(turn, turnMetadataById.get(turn.id)),
    );
    const entry = {
      turns,
      totalTurnCount: turns.length,
      deferredDetails,
    };
    this.setThreadDetailCache(localThreadId, entry);
    return this.threadDetailCache.get(localThreadId)!;
  }

  async listModels(): Promise<ModelOptionDto[]> {
    const models = await this.runtimeForProvider('codex').listModels();
    return models.map((model) => ({
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      description: model.description,
      isDefault: model.isDefault,
      hidden: model.hidden,
      supportedReasoningEfforts: model.supportedReasoningEfforts.map((entry) => ({
        reasoningEffort: entry.reasoningEffort as ReasoningEffortDto,
        description: entry.description
      })),
      defaultReasoningEffort: (model.defaultReasoningEffort ?? 'none') as ReasoningEffortDto
    }));
  }

  async listThreads(): Promise<ThreadDto[]> {
    let loadedIds = new Set<string>();
    for (const runtime of this.agentRuntimes.all()) {
      try {
        for (const providerSessionId of await runtime.listLoadedSessions()) {
          loadedIds.add(providerSessionId);
        }
        const remoteSessions = await runtime.listSessions();
        for (const remoteSession of remoteSessions) {
          const local = this.findRecordByProviderSessionId(
            runtime.provider,
            remoteSession.providerSessionId,
          );
          if (!local) {
            continue;
          }

          updateThreadRecord(
            this.db,
            local.id,
            this.buildThreadPatch(remoteSession, local.model, local.reasoningEffort)
          );
        }
      } catch {
        // Keep local state if a provider runtime is unavailable.
      }
    }

    return listThreadRecords(this.db).map((record) => this.toThreadDto(record, loadedIds));
  }

  async createThread(input: CreateThreadInput): Promise<ThreadDto> {
    const workspace = getWorkspaceRecordById(this.db, input.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found.'
      });
    }

    const provider = this.normalizeProvider(input.provider);

    const normalizedTitle = input.title?.trim() || DEFAULT_THREAD_TITLE;
    const runtime = this.runtimeForProvider(provider);
    const modelRecords = await runtime.listModels().catch(() => []);
    const matchedModel = modelRecords.find((entry) => entry.model === input.model);
    const reasoningEffort =
      normalizeReasoningEffort(matchedModel?.defaultReasoningEffort) ?? 'medium';
    const sandboxMode = defaultSandboxModeForApprovalMode(input.approvalMode);
    const fastMode = this.runtimeSupportsFastMode(provider)
      ? readCodexFastModeSync(this.codexHome)
      : false;
    if (this.runtimeSupportsFastMode(provider)) {
      ensureFastModeSupported(input.model, fastMode);
    }
    const response = await runtime.startSession({
      cwd: workspace.absPath,
      model: input.model,
      approvalMode: input.approvalMode,
      sandboxMode,
      performanceMode: performanceModeForFastMode(fastMode),
    });

    const created = createThreadRecord(this.db, {
      workspaceId: workspace.id,
      provider,
      providerSessionId: response.providerSessionId,
      title: normalizedTitle,
      model: input.model,
      reasoningEffort,
      collaborationMode: 'default',
      approvalMode: input.approvalMode,
      sandboxMode: normalizeSandboxMode(response.sandboxMode) ?? sandboxMode,
      summaryText: response.session.preview ?? null,
      fastMode,
      source: 'supervisor',
      isConnected: true,
    });

    updateThreadRecord(this.db, created.id, {
      ...this.buildThreadPatch(
        response.session,
        input.model,
        response.reasoningEffort ?? reasoningEffort
      ),
      title:
        normalizedTitle === DEFAULT_THREAD_TITLE &&
        response.session.title &&
        response.session.title.trim() !== GENERIC_REMOTE_THREAD_TITLE
          ? truncateAutoThreadTitle(response.session.title)
          : normalizedTitle,
    });

    const record = getThreadRecordById(this.db, created.id)!;
    return this.toThreadDto(record, new Set([response.providerSessionId]));
  }

  async importThread(sessionId: ImportThreadInput['sessionId']): Promise<ThreadDetailDto> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Session id is required.'
      });
    }

    const existingThread = this.findRecordByProviderSessionId("codex", normalizedSessionId);
    if (existingThread) {
      return this.getThreadDetail(existingThread.id);
    }

    const localSession = await this.localSessionStore.findSession(normalizedSessionId);
    if (!localSession) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Session not found on this machine.'
      });
    }

    const importedPath = await resolveImportedWorkspacePath(
      this.workspaceRoot,
      localSession.cwd
    );
    let workspace = getWorkspaceRecordByPath(this.db, importedPath);

    if (!workspace) {
      workspace = createWorkspaceRecord(this.db, {
        absPath: importedPath,
        label: path.basename(importedPath) || 'workspace'
      });
    }

    const created = createThreadRecord(this.db, {
      workspaceId: workspace.id,
      provider: 'codex',
      providerSessionId: normalizedSessionId,
      title: truncateAutoThreadTitle(
        localSession.title?.trim() || 'Untitled imported session'
      ),
      model: localSession.model,
      reasoningEffort: null,
      collaborationMode: 'default',
      approvalMode: 'yolo',
      sandboxMode: defaultSandboxModeForApprovalMode('yolo'),
      summaryText:
        localSession.turns
          .flatMap((turn) => turn.items)
          .find((item) => item.kind === 'userMessage')
          ?.text ?? null,
      fastMode: readCodexFastModeSync(this.codexHome),
      source: 'local_codex_import',
      isConnected: false,
    });

    return this.getThreadDetail(created.id);
  }

  async getThreadDetail(
    localThreadId: string,
    options: { limit?: number; beforeTurnId?: string } = {},
  ): Promise<ThreadDetailDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.'
      });
    }

    this.requireProviderSessionId(record);
    const loadedIds = await this.listLoadedProviderSessionIds(record.provider);
    const workspacePathStatus = (await pathExists(workspace.absPath)) ? 'present' : 'missing';
    const turnMetadataById = new Map<string, ThreadTurnMetadataRecord>(
      listThreadTurnMetadataByThreadId(this.db, localThreadId).map((entry) => [
        entry.turnId,
        {
          model: entry.model ?? null,
          reasoningEffort: entry.reasoningEffort ?? null,
          reasoningEffortAvailable: entry.reasoningEffortAvailable ?? null,
          pricingModelKey: entry.pricingModelKey ?? null,
          pricingTierKey: normalizePricingTier(entry.pricingTierKey),
          tokenUsageJson: entry.tokenUsageJson ?? null,
        },
      ]),
    );
    const cachedDetail = await this.buildThreadDetailCacheEntry(
      localThreadId,
      record,
      turnMetadataById,
    );
    const updated = getThreadRecordById(this.db, record.id)!;
    const pagedTurns = sliceTurnsForDetail(cachedDetail.turns, options);
    const liveItems = this.getLiveItems(
      updated.id,
      cachedDetail.turns,
      pagedTurns.turns,
    );
    const goal = await this.getThreadGoalForRecord(updated).catch(() => null);
    const goalHistory = this.listThreadGoalHistory(updated.id);
    return {
      thread: this.toThreadDto(updated, loadedIds),
      workspace: toWorkspaceDto(workspace),
      workspacePathStatus,
      turns: pagedTurns.turns,
      totalTurnCount: pagedTurns.totalTurnCount,
      pendingRequests: this.listPendingRequests(updated.id),
      pendingSteers: this.listPendingSteers(updated.id),
      answeredRequestNotes: this.listAnsweredRequestNotes(updated.id),
      activityNotes: this.listActivityNotes(updated.id),
      goal,
      goalHistory,
      livePlan: this.getLivePlan(updated.id),
      liveItems,
    };
  }

  private async getThreadExportBase(localThreadId: string) {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    this.requireProviderSessionId(record);

    const turnMetadataById = new Map<string, ThreadTurnMetadataRecord>(
      listThreadTurnMetadataByThreadId(this.db, localThreadId).map((entry) => [
        entry.turnId,
        {
          model: entry.model ?? null,
          reasoningEffort: entry.reasoningEffort ?? null,
          reasoningEffortAvailable: entry.reasoningEffortAvailable ?? null,
          pricingModelKey: entry.pricingModelKey ?? null,
          pricingTierKey: normalizePricingTier(entry.pricingTierKey),
          tokenUsageJson: entry.tokenUsageJson ?? null,
        },
      ]),
    );
    const cachedDetail = await this.buildThreadDetailCacheEntry(
      localThreadId,
      record,
      turnMetadataById,
    );
    const updated = getThreadRecordById(this.db, record.id)!;
    return {
      record: updated,
      workspace,
      turns: cachedDetail.turns,
    };
  }

  async listThreadExportTurns(localThreadId: string): Promise<ThreadExportTurnOptionsDto> {
    const { turns } = await this.getThreadExportBase(localThreadId);
    return {
      totalTurnCount: turns.length,
      turns: turns.map((turn, index) => ({
        turnId: turn.id,
        turnNumber: index + 1,
        startedAt: turn.startedAt,
        status: turn.status,
        userPromptPreview: userPromptPreviewFromTurn(turn),
      })).reverse(),
    };
  }

  async exportThreadPdf(
    localThreadId: string,
    input: ExportThreadPdfInput,
  ): Promise<{ buffer: Buffer; filename: string }> {
    return this.exportThreadTranscript(localThreadId, {
      ...input,
      format: 'pdf',
    });
  }

  async exportThreadTranscript(
    localThreadId: string,
    input: ExportThreadPdfInput,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const { record, workspace, turns } = await this.getThreadExportBase(localThreadId);
    const totalTurnCount = turns.length;
    const selectedTurnNumbers = new Map(
      turns.map((turn, index) => [turn.id, index + 1] as const),
    );
    const selectedTurns = (() => {
      if (input.mode === 'selected') {
        const requestedIds = [...new Set(input.turnIds ?? [])];
        if (requestedIds.length === 0) {
          throw new HttpError(400, {
            code: 'bad_request',
            message: 'Select at least one turn to export.',
          });
        }
        if (requestedIds.length > 100) {
          throw new HttpError(400, {
            code: 'bad_request',
            message: 'A PDF export can include at most 100 turns.',
          });
        }

        const requested = new Set(requestedIds);
        const matched = turns.filter((turn) => requested.has(turn.id));
        if (matched.length !== requested.size) {
          const matchedIds = new Set(matched.map((turn) => turn.id));
          const missing = requestedIds.filter((turnId) => !matchedIds.has(turnId));
          throw new HttpError(400, {
            code: 'bad_request',
            message: `Some selected turns were not found: ${missing.join(', ')}`,
          });
        }

        return matched;
      }

      const limit = Math.max(1, Math.min(input.limit ?? 10, 100));
      return turns.slice(Math.max(0, turns.length - limit));
    })();

    const snapshot = {
      thread: this.toThreadDto(record, new Set(record.providerSessionId ? [record.providerSessionId] : [])),
      workspace: toWorkspaceDto(workspace),
      exportedAt: new Date().toISOString(),
      totalTurnCount,
      selectedTurnNumbers,
      turns: selectedTurns,
      profile: input.profile ?? 'review',
      options: defaultExportOptions(input),
    };
    const format = input.format ?? 'pdf';
    const buffer = format === 'html'
      ? Buffer.from(renderThreadExportStandaloneHtml(snapshot), 'utf8')
      : await renderThreadExportPdf(snapshot);

    return {
      buffer,
      filename: safeTranscriptExportFileName(record.title, format),
      contentType: format === 'html' ? 'text/html; charset=utf-8' : 'application/pdf',
    };
  }

  async getThreadGoal(localThreadId: string): Promise<ThreadGoalDto | null> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    this.requireProviderSessionId(record);

    return this.getThreadGoalForRecord(record, { allowEnableFeature: true });
  }

  async updateThreadGoal(
    localThreadId: string,
    input: UpdateThreadGoalInput,
  ): Promise<ThreadGoalDto | null> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    const providerSessionId = this.requireProviderSessionId(record);

    if (record.isConnected === false) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Connect this thread before changing its goal.',
      });
    }

    const runtime = this.runtimeForProvider(record.provider);
    if (!runtime.setGoal || !runtime.capabilities.controls.goals) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support goals.',
      });
    }

    try {
      await this.ensureGoalsFeatureEnabled(record.provider);
      await this.ensureThreadLoadedForCodexOperation(record);
      const upstreamStatus =
        input.status === 'terminated' ? undefined : (input.status as UpstreamThreadGoalStatus | null | undefined);
      const goal = await runtime.setGoal({
        providerSessionId,
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(upstreamStatus !== undefined ? { status: upstreamStatus } : {}),
        ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
      });
      const dto = normalizeThreadGoalStatusForThread(toThreadGoalDtoFromAgentGoal(goal), record);
      const persistedGoal = toThreadGoalDtoFromRecord(
        this.persistThreadGoalSnapshot(localThreadId, dto),
      );
      this.emitThreadEvent('thread.goal.updated', localThreadId, {
        goal: persistedGoal,
        goalHistory: this.listThreadGoalHistory(localThreadId),
      });
      return persistedGoal;
    } catch (error) {
      mapCodexGoalError(error);
    }
  }

  async clearThreadGoal(
    localThreadId: string,
  ): Promise<{ cleared: boolean; goalHistory: ThreadGoalDto[] }> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    const providerSessionId = this.requireProviderSessionId(record);

    if (record.isConnected === false) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Connect this thread before clearing its goal.',
      });
    }

    const runtime = this.runtimeForProvider(record.provider);
    if (!runtime.clearGoal || !runtime.capabilities.controls.goals) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support goals.',
      });
    }

    try {
      await this.ensureGoalsFeatureEnabled(record.provider);
      await this.ensureThreadLoadedForCodexOperation(record);
      const cleared = await runtime.clearGoal(providerSessionId);
      markActiveThreadGoalRecordTerminated(this.db, localThreadId);
      const goalHistory = this.listThreadGoalHistory(localThreadId);
      this.emitThreadEvent('thread.goal.cleared', localThreadId, { goalHistory });
      return { cleared, goalHistory };
    } catch (error) {
      mapCodexGoalError(error);
    }
  }

  private async getThreadGoalForRecord(record: {
    id: string;
    providerSessionId: string | null;
    provider?: string | null;
    model?: string | null;
    sandboxMode?: string | null;
    approvalMode?: string | null;
  }, options: { allowEnableFeature?: boolean } = {}): Promise<ThreadGoalDto | null> {
    if (!record.providerSessionId) {
      return null;
    }

    try {
      if (options.allowEnableFeature) {
        await this.ensureGoalsFeatureEnabled(record.provider);
        await this.ensureThreadLoadedForCodexOperation(record);
      }
      const runtime = this.runtimeForProvider(record.provider);
      if (!runtime.getGoal || !runtime.capabilities.controls.goals) {
        return null;
      }
      const goal = await runtime.getGoal(record.providerSessionId);
      if (!goal) {
        return null;
      }

      const dto = normalizeThreadGoalStatusForThread(toThreadGoalDtoFromAgentGoal(goal), record);
      return toThreadGoalDtoFromRecord(this.persistThreadGoalSnapshot(record.id, dto));
    } catch (error) {
      if (isCodexRuntimeRequestError(error)) {
        return null;
      }
      throw error;
    }
  }

  private persistThreadGoalSnapshot(
    localThreadId: string,
    goal: ThreadGoalDto | Parameters<typeof toThreadGoalDto>[0],
  ) {
    const dto =
      'createdAt' in goal && typeof goal.createdAt === 'string'
        ? (goal as ThreadGoalDto)
        : toThreadGoalDto(goal as Parameters<typeof toThreadGoalDto>[0]);
    return upsertThreadGoalRecord(this.db, {
      threadId: localThreadId,
      providerSessionId: dto.threadId,
      localGoalId: dto.localGoalId ?? null,
      objective: dto.objective,
      status: dto.status,
      tokenBudget: dto.tokenBudget,
      tokensUsed: dto.tokensUsed,
      timeUsedSeconds: dto.timeUsedSeconds,
      startedAt: dto.createdAt,
      completedAt: dto.completedAt ?? null,
      createdAt: dto.createdAt,
      updatedAt: dto.updatedAt,
    });
  }

  private listThreadGoalHistory(localThreadId: string): ThreadGoalDto[] {
    const deduped = new Map<string, ThreadGoalDto>();
    for (const goal of listThreadGoalRecordsByThreadId(this.db, localThreadId).map(
      toThreadGoalDtoFromRecord,
    )) {
      const key = goalHistoryKey(goal);
      const existing = deduped.get(key);
      deduped.set(key, existing ? mergeGoalHistoryEntry(existing, goal) : goal);
    }
    return [...deduped.values()].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    );
  }

  private async ensureGoalsFeatureEnabled(provider: string | null | undefined) {
    if (!this.isCodexProvider(provider)) {
      return;
    }

    try {
      if (await readCodexFeatureFlag(this.codexHome, 'goals')) {
        return;
      }

      await writeCodexFeatureFlag(this.codexHome, 'goals', true);
      await this.codexRuntime().stop();
      await this.codexRuntime().start();
    } catch (error) {
      if (isCodexRuntimeRequestError(error)) {
        throw new HttpError(409, {
          code: 'goal_feature_disabled',
          message: GOAL_FEATURE_DISABLED_MESSAGE,
        });
      }
      throw error;
    }
  }

  private async ensureThreadLoadedForCodexOperation(record: {
    id: string;
    providerSessionId: string | null;
    provider?: string | null;
    model?: string | null;
    sandboxMode?: string | null;
    approvalMode?: string | null;
  }) {
    if (!record.providerSessionId) {
      return;
    }

    const loadedIds = await this.listLoadedProviderSessionIds(record.provider);
    if (loadedIds.has(record.providerSessionId)) {
      return;
    }

    const resumeInput: ResumeThreadInput = {};
    if (record.model) {
      resumeInput.model = record.model;
    }
    const normalizedSandboxMode = normalizeSandboxMode(record.sandboxMode);
    if (normalizedSandboxMode) {
      resumeInput.sandboxMode = normalizedSandboxMode;
    }
    await this.resumeThread(record.id, resumeInput);
  }

  async getThreadHistoryItemDetail(
    localThreadId: string,
    itemId: string,
  ): Promise<ThreadHistoryItemDetailDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    this.requireProviderSessionId(record);

    const turnMetadataById = new Map<string, ThreadTurnMetadataRecord>(
      listThreadTurnMetadataByThreadId(this.db, localThreadId).map((entry) => [
        entry.turnId,
        {
          model: entry.model ?? null,
          reasoningEffort: entry.reasoningEffort ?? null,
          reasoningEffortAvailable: entry.reasoningEffortAvailable ?? null,
          pricingModelKey: entry.pricingModelKey ?? null,
          pricingTierKey: normalizePricingTier(entry.pricingTierKey),
          tokenUsageJson: entry.tokenUsageJson ?? null,
        },
      ]),
    );
    const cachedDetail = await this.buildThreadDetailCacheEntry(
      localThreadId,
      record,
      turnMetadataById,
    );
    const detail = cachedDetail.deferredDetails.get(itemId);
    if (!detail) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Detailed history item was not found for this thread.',
      });
    }

    return detail;
  }

  async preparePromptAttachments(
    localThreadId: string,
    input: SendThreadPromptInput,
    attachments: UploadedPromptAttachment[],
  ): Promise<SendThreadPromptInput> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.'
      });
    }

    if (!(await pathExists(workspace.absPath))) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Workspace path is missing on this machine.'
      });
    }

    const tempDirectory = threadTempDirectoryPath(workspace.absPath, localThreadId);
    await fs.mkdir(tempDirectory, { recursive: true });

    let rewrittenPrompt = input.prompt;

    for (const attachment of attachments) {
      if (!rewrittenPrompt.includes(attachment.manifest.placeholder)) {
        throw new HttpError(400, {
          code: 'bad_request',
          message: `Prompt is missing attachment placeholder ${attachment.manifest.placeholder}.`
        });
      }

      const savedFileName = sanitizeAttachmentFileName(attachment.manifest.originalName);
      await fs.writeFile(path.join(tempDirectory, savedFileName), attachment.buffer);

      const relativePath = `./.temp/threads/${localThreadId}/${savedFileName}`;
      const replacementToken =
        attachment.manifest.kind === 'photo'
          ? `[PHOTO ${relativePath}]`
          : `[FILE ${relativePath}]`;
      rewrittenPrompt = rewrittenPrompt
        .split(attachment.manifest.placeholder)
        .join(replacementToken);
    }

    return {
      ...input,
      prompt: rewrittenPrompt
    };
  }

  async resumeThread(localThreadId: string, input: ResumeThreadInput = {}): Promise<ThreadDetailDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }
    const providerSessionId = this.requireProviderSessionId(record);

    let response;
    const runtime = this.runtimeForProvider(record.provider);
    const sandboxMode =
      input.sandboxMode ??
      normalizeSandboxMode(record.sandboxMode) ??
      defaultSandboxModeForApprovalMode((record.approvalMode ?? 'yolo') as ApprovalMode);
    const fastMode = this.fastModeForProvider(record.provider, record.fastMode);
    try {
      ensureFastModeSupported(
        input.model ?? record.model ?? null,
        fastMode,
      );
      response = await runtime.resumeSession({
        providerSessionId,
        model: input.model ?? record.model ?? null,
        sandboxMode,
        performanceMode: performanceModeForFastMode(fastMode),
      });
    } catch (error) {
      if (!isRemoteThreadBootstrapError(error)) {
        throw error;
      }

      return this.getThreadDetail(localThreadId);
    }

    const modelRecords = await runtime.listModels().catch(() => []);
    const effectiveModel =
      input.model ?? record.model ?? response.model ?? null;
    const resumedReasoning = this.normalizeReasoningForModel(
      modelRecords,
      effectiveModel,
      normalizeReasoningEffort(record.reasoningEffort) ??
        normalizeReasoningEffort(response.reasoningEffort)
    );

    updateThreadRecord(
      this.db,
      record.id,
      this.buildThreadPatch(
        response.session,
        effectiveModel,
        resumedReasoning
      ),
    );
    updateThreadRecord(this.db, record.id, {
      sandboxMode: normalizeSandboxMode(response.sandboxMode) ?? sandboxMode,
      providerSessionId: response.providerSessionId,
    });

    updateThreadRecord(this.db, record.id, {
      isConnected: true,
    });
    if (input.model && input.model !== record.model) {
      this.resetThreadContextUsage(record.id);
    }
    this.invalidateThreadDetailCache(localThreadId);

    return this.getThreadDetail(localThreadId);
  }

  async disconnectThread(localThreadId: string): Promise<ThreadDetailDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    updateThreadRecord(this.db, record.id, {
      isConnected: false,
    });
    this.invalidateThreadDetailCache(localThreadId);

    return this.getThreadDetail(localThreadId);
  }

  async sendPrompt(
    localThreadId: string,
    input: SendThreadPromptInput,
    options: SendPromptOptions = {},
  ): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }
    const providerSessionId = this.requireProviderSessionId(record);

    if (record.source === 'local_codex_import') {
      const loadedIds = await this.listLoadedProviderSessionIds(record.provider);
      if (!loadedIds.has(providerSessionId)) {
        throw new HttpError(409, {
          code: 'conflict',
          message: 'Resume / Connect this imported session before sending a new prompt.'
        });
      }
    }

    if (record.isConnected === false) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Connect this thread before sending a new prompt.'
      });
    }

    const prompt = input.prompt.trim();
    const displayPrompt = options.displayPrompt?.trim() || prompt;
    if (!prompt) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Prompt cannot be empty.'
      });
    }

    this.clearPendingPlanDecisionRequests(localThreadId, true);

    const runtime = this.runtimeForProvider(record.provider);
    const modelRecords = await runtime.listModels().catch(() => []);
    const defaultModel = modelRecords.find((entry) => entry.isDefault) ?? modelRecords[0] ?? null;
    const effectiveModel = input.model ?? record.model ?? defaultModel?.model ?? null;
    const collaborationMode =
      input.collaborationMode ?? normalizeCollaborationMode(record.collaborationMode);
    const effectiveReasoning =
      input.reasoningEffort !== undefined
        ? normalizeReasoningEffort(input.reasoningEffort)
        : normalizeReasoningEffort(record.reasoningEffort);
    const normalizedReasoning = this.normalizeReasoningForModel(
      modelRecords,
      effectiveModel,
      effectiveReasoning
    );
    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found.',
      });
    }
    const sandboxMode =
      (input.sandboxMode !== undefined
        ? normalizeSandboxMode(input.sandboxMode)
        : normalizeSandboxMode(record.sandboxMode)) ??
      defaultSandboxModeForApprovalMode((record.approvalMode ?? 'yolo') as ApprovalMode);
    const fastMode = this.fastModeForProvider(record.provider, record.fastMode);
    ensureFastModeSupported(effectiveModel, fastMode);
    const performanceMode = performanceModeForFastMode(fastMode);
    const connectedRecord = {
      ...record,
      providerSessionId,
    };

    if (record.providerTurnId && record.status === 'running') {
      return this.steerOrStartPromptTurn(localThreadId, {
        ...connectedRecord,
        providerTurnId: record.providerTurnId,
      }, {
        prompt,
        displayPrompt,
        clientRequestId: input.clientRequestId ?? null,
        effectiveModel,
        normalizedReasoning,
        collaborationMode,
        sandboxMode,
        performanceMode,
        workspacePath: workspace.absPath,
      });
    }

    return this.startPromptTurn(localThreadId, connectedRecord, {
      prompt,
      effectiveModel,
      normalizedReasoning,
      collaborationMode,
      sandboxMode,
      performanceMode,
      workspacePath: workspace.absPath,
    });
  }

  private async startPromptTurn(
    localThreadId: string,
    record: { id: string; provider?: string | null; providerSessionId: string; title: string; },
    input: {
      prompt: string;
      effectiveModel: string | null;
      normalizedReasoning: ReasoningEffortDto | null;
      collaborationMode: CollaborationModeDto;
      sandboxMode: SandboxModeDto;
      performanceMode: 'fast' | 'standard';
      workspacePath: string;
    },
  ): Promise<ThreadDto> {
    const runtime = this.runtimeForProvider(record.provider);
    const modelRecords = await runtime.listModels().catch(() => []);
    ensureFastModeSupported(input.effectiveModel, input.performanceMode === 'fast');
    const pricingSnapshot = buildTurnPricingSnapshot(
      input.effectiveModel,
      input.performanceMode === 'fast',
    );
    const turn = await runtime.startTurn({
      providerSessionId: record.providerSessionId,
      prompt: input.prompt,
      model: input.effectiveModel,
      performanceMode: input.performanceMode,
      reasoningEffort: input.normalizedReasoning,
      collaborationMode: input.collaborationMode,
      sandboxMode: input.sandboxMode,
      workspacePath: input.workspacePath,
    });
    upsertThreadTurnMetadata(this.db, {
      threadId: localThreadId,
      turnId: turn.rawTurnId ?? turn.providerTurnId,
      model: input.effectiveModel,
      reasoningEffort: input.normalizedReasoning,
      reasoningEffortAvailable: this.reasoningEffortAvailableForModel(
        modelRecords,
        input.effectiveModel,
      ),
      pricingModelKey: pricingSnapshot?.pricingModelKey ?? null,
      pricingTierKey: pricingSnapshot?.pricingTierKey ?? null,
    });

    const patch: Parameters<typeof updateThreadRecord>[2] = {
      providerTurnId: turn.providerTurnId,
      status: 'running',
      summaryText: input.prompt,
      lastError: null,
      lastTurnStartedAt: new Date().toISOString(),
      model: input.effectiveModel,
      reasoningEffort: input.normalizedReasoning,
      collaborationMode: input.collaborationMode,
      sandboxMode: input.sandboxMode,
    };

    if (isAutoGeneratedTitle(record.title)) {
      patch.title = truncateAutoThreadTitle(input.prompt);
    }

    updateThreadRecord(this.db, localThreadId, patch);
    this.setLivePlan(localThreadId, null);
    this.setLiveItems(localThreadId, null);
    this.resetThreadContextUsage(localThreadId, true);
    this.invalidateThreadDetailCache(localThreadId);
    const updated = getThreadRecordById(this.db, localThreadId)!;

    return this.toThreadDto(updated, new Set([record.providerSessionId]));
  }

  private async steerOrStartPromptTurn(
    localThreadId: string,
    record: {
      id: string;
      provider?: string | null;
      providerSessionId: string;
      providerTurnId: string;
      status: string | null;
      title: string;
    },
    input: {
      prompt: string;
      displayPrompt: string;
      clientRequestId: string | null;
      effectiveModel: string | null;
      normalizedReasoning: ReasoningEffortDto | null;
      collaborationMode: CollaborationModeDto;
      sandboxMode: SandboxModeDto;
      performanceMode: 'fast' | 'standard';
      workspacePath: string;
    },
  ): Promise<ThreadDto> {
    const runtime = this.runtimeForProvider(record.provider);
    let steerTurnId = record.providerTurnId;
    let retriedAfterTurnMismatch = false;

    while (steerTurnId) {
      try {
        await runtime.sendInput?.({
          providerSessionId: record.providerSessionId,
          providerTurnId: steerTurnId,
          prompt: input.prompt,
        });

        updateThreadRecord(this.db, localThreadId, {
          providerTurnId: steerTurnId,
          status: 'running',
          lastError: null,
        });
        createThreadPendingSteerRecord(this.db, {
          threadId: localThreadId,
          turnId: steerTurnId,
          clientRequestId: input.clientRequestId,
          displayPrompt: input.displayPrompt,
          submittedPrompt: input.prompt,
        });
        this.invalidateThreadDetailCache(localThreadId);
        this.emitThreadEvent('thread.updated', localThreadId, {
          reason: 'pending_steer_updated',
        });

        const updated = getThreadRecordById(this.db, localThreadId)!;
        return this.toThreadDto(updated, new Set([record.providerSessionId]));
      } catch (error) {
        const steerRace = parseTurnSteerRace(error);
        if (
          steerRace?.type === 'turnIdMismatch' &&
          !retriedAfterTurnMismatch &&
          steerRace.actualTurnId !== steerTurnId
        ) {
          steerTurnId = steerRace.actualTurnId;
          retriedAfterTurnMismatch = true;
          updateThreadRecord(this.db, localThreadId, {
            providerTurnId: steerTurnId,
            status: 'running',
          });
          continue;
        }

        if (!steerRace) {
          throw error;
        }

        break;
      }
    }

    return this.startPromptTurn(localThreadId, record, {
      prompt: input.displayPrompt,
      effectiveModel: input.effectiveModel,
      normalizedReasoning: input.normalizedReasoning,
      collaborationMode: input.collaborationMode,
      sandboxMode: input.sandboxMode,
      performanceMode: input.performanceMode,
      workspacePath: input.workspacePath,
    });
  }

  async updateThreadSettings(
    localThreadId: string,
    input: UpdateThreadSettingsInput
  ): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const modelRecords = await this.listProviderModels(record.provider);
    const fallbackModel = modelRecords.find((entry) => entry.isDefault) ?? modelRecords[0] ?? null;
    const supportsFastMode = this.runtimeSupportsFastMode(record.provider);
    const currentFastMode = this.fastModeForProvider(record.provider, record.fastMode);
    const requestedFastMode =
      supportsFastMode && input.fastMode !== undefined ? input.fastMode : currentFastMode;
    const currentModel = record.model ?? fallbackModel?.model ?? null;
    const currentReasoning = normalizeReasoningEffort(record.reasoningEffort);
    const nextModel = input.model ?? currentModel;
    let nextReasoning =
      input.reasoningEffort !== undefined
        ? normalizeReasoningEffort(input.reasoningEffort)
        : currentReasoning;
    const nextFastMode = requestedFastMode;

    nextReasoning = this.normalizeReasoningForModel(
      modelRecords,
      nextModel,
      nextReasoning,
    );
    const nextCollaborationMode =
      input.collaborationMode !== undefined
        ? normalizeCollaborationMode(input.collaborationMode)
        : normalizeCollaborationMode(record.collaborationMode);
    const nextSandboxMode =
      input.sandboxMode !== undefined
        ? normalizeSandboxMode(input.sandboxMode)
        : normalizeSandboxMode(record.sandboxMode);
    ensureFastModeSupported(nextModel, nextFastMode);

    if (nextCollaborationMode !== 'plan') {
      this.clearPendingPlanDecisionRequests(localThreadId, true);
    }

    if (supportsFastMode && currentFastMode !== nextFastMode) {
      await writeCodexFastMode(this.codexHome, nextFastMode);
      this.appendActivityNote(localThreadId, {
        kind: 'fastMode',
        text: nextFastMode ? FAST_MODE_NOTE_ON : FAST_MODE_NOTE_OFF,
      });
    }

    updateThreadRecord(this.db, localThreadId, {
      model: nextModel,
      reasoningEffort: nextReasoning,
      fastMode: nextFastMode,
      collaborationMode: nextCollaborationMode,
      sandboxMode: nextSandboxMode,
    });
    if (nextModel !== record.model) {
      this.resetThreadContextUsage(localThreadId);
    }

    const updated = getThreadRecordById(this.db, localThreadId)!;
    const loadedIds = await this.listLoadedProviderSessionIds(record.provider);
    this.emitThreadEvent('thread.updated', updated.id, {
      model: updated.model,
      reasoningEffort: updated.reasoningEffort,
      fastMode: nextFastMode,
      collaborationMode: updated.collaborationMode,
      sandboxMode: updated.sandboxMode,
    });

    return this.toThreadDto(updated, loadedIds);
  }

  async updateThreadTitle(localThreadId: string, title: string): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Thread title cannot be empty.'
      });
    }

    updateThreadRecord(this.db, localThreadId, {
      title: normalizedTitle
    });

    const updated = getThreadRecordById(this.db, localThreadId)!;
    const loadedIds = await this.listLoadedProviderSessionIds(record.provider);

    this.emitThreadEvent('thread.updated', updated.id, {
      title: updated.title
    });

    return this.toThreadDto(updated, loadedIds);
  }

  async compactThread(localThreadId: string): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    const providerSessionId = this.requireProviderSessionId(record);

    if (record.isConnected === false) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Connect this thread before compacting its context.',
      });
    }

    const loadedIds = await this.listLoadedProviderSessionIds(record.provider);
    if (!loadedIds.has(providerSessionId)) {
      const resumeInput: ResumeThreadInput = {};
      if (record.model) {
        resumeInput.model = record.model;
      }
      const normalizedSandboxMode = normalizeSandboxMode(record.sandboxMode);
      if (normalizedSandboxMode) {
        resumeInput.sandboxMode = normalizedSandboxMode;
      }
      await this.resumeThread(localThreadId, resumeInput);
    }

    const runtime = this.runtimeForProvider(record.provider);
    if (!runtime.compactSession) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support context compaction.',
      });
    }
    await runtime.compactSession(providerSessionId);

    const updated = getThreadRecordById(this.db, localThreadId)!;
    const refreshedLoadedIds = await this.listLoadedProviderSessionIds(record.provider);
    return this.toThreadDto(updated, refreshedLoadedIds);
  }

  async listForkTurnOptions(localThreadId: string): Promise<ThreadForkTurnOptionDto[]> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    this.requireProviderSessionId(record);

    const turnMetadataById = new Map<string, ThreadTurnMetadataRecord>(
      listThreadTurnMetadataByThreadId(this.db, localThreadId).map((entry) => [
        entry.turnId,
        {
          model: entry.model ?? null,
          reasoningEffort: entry.reasoningEffort ?? null,
          reasoningEffortAvailable: entry.reasoningEffortAvailable ?? null,
          pricingModelKey: entry.pricingModelKey ?? null,
          pricingTierKey: normalizePricingTier(entry.pricingTierKey),
          tokenUsageJson: entry.tokenUsageJson ?? null,
        },
      ]),
    );
    const cachedDetail = await this.buildThreadDetailCacheEntry(
      localThreadId,
      record,
      turnMetadataById,
    );

    return cachedDetail.turns.map((turn, index) => ({
      turnId: turn.id,
      turnIndex: index + 1,
      startedAt: turn.startedAt,
      status: turn.status,
    }));
  }

  async forkThread(
    localThreadId: string,
    input: ForkThreadInput,
  ): Promise<ThreadForkResultDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    const providerSessionId = this.requireProviderSessionId(record);

    if (record.status === 'running') {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Cannot fork a thread while it is still running.',
      });
    }

    const turnOptions = await this.listForkTurnOptions(localThreadId);
    const selectedTurn =
      input.mode === 'turn'
        ? turnOptions.find((turn) => turn.turnId === input.turnId)
        : turnOptions.at(-1) ?? null;

    if (input.mode === 'turn' && !selectedTurn) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'The selected fork turn was not found.',
      });
    }

    const runtime = this.runtimeForProvider(record.provider);
    if (!runtime.forkSession) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support session fork.',
      });
    }

    let forkedSession = await runtime.forkSession({
      providerSessionId,
      atTurnId: selectedTurn?.turnId ?? null,
    });
    const turnsToRollback =
      selectedTurn == null ? 0 : Math.max(0, turnOptions.length - selectedTurn.turnIndex);
    if (turnsToRollback > 0) {
      if (!runtime.rollbackSession) {
        throw new HttpError(409, {
          code: 'conflict',
          message: 'This backend does not support rollback after fork.',
        });
      }
      forkedSession = await runtime.rollbackSession({
        providerSessionId: forkedSession.providerSessionId,
        count: turnsToRollback,
      });
    }

    const forkTitleBase = record.title.trim() || DEFAULT_THREAD_TITLE;
    const created = createThreadRecord(this.db, {
      workspaceId: record.workspaceId,
      provider: record.provider === 'claude' ? 'claude' : 'codex',
      providerSessionId: forkedSession.providerSessionId,
      title: `${forkTitleBase} / fork`,
      model: record.model,
      reasoningEffort: record.reasoningEffort,
      fastMode: this.fastModeForProvider(record.provider, record.fastMode),
      fastBaseModel: record.fastBaseModel,
      fastBaseReasoningEffort: record.fastBaseReasoningEffort,
      collaborationMode: normalizeCollaborationMode(record.collaborationMode),
      approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
      sandboxMode: normalizeSandboxMode(record.sandboxMode),
      summaryText: forkedSession.preview,
      source: 'supervisor',
      isConnected: true,
    });

    updateThreadRecord(this.db, created.id, {
      ...this.buildThreadPatch(
        forkedSession,
        record.model,
        normalizeReasoningEffort(record.reasoningEffort),
      ),
      title: `${forkTitleBase} / fork`,
    });

    createThreadForkRecord(this.db, {
      sourceThreadId: localThreadId,
      sourceTurnId: selectedTurn?.turnId ?? null,
      sourceTurnIndex: selectedTurn?.turnIndex ?? null,
      forkedThreadId: created.id,
    });

    this.invalidateThreadDetailCache(localThreadId);
    this.invalidateThreadDetailCache(created.id);

    return {
      thread: await this.getThreadDetail(created.id),
      sourceThreadId: localThreadId,
      sourceTurnId: selectedTurn?.turnId ?? null,
      sourceTurnIndex: selectedTurn?.turnIndex ?? null,
    };
  }

  async listThreadSkills(localThreadId: string): Promise<ThreadSkillsDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    const runtime = this.runtimeForProvider(record.provider);
    if (!runtime.listSkills) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not expose skills.',
      });
    }
    const [entry] = await runtime.listSkills({
      cwds: [workspace.absPath],
      forceReload: true,
    }) as Awaited<ReturnType<NonNullable<AgentRuntime['listSkills']>>>;

    return {
      cwd: workspace.absPath,
      skills: (entry?.skills ?? []).map((skill) => ({
        name: skill.name,
        description: skill.description,
        ...(skill.shortDescription ? { shortDescription: skill.shortDescription } : {}),
        ...(skill.interface
          ? {
              interface: {
                ...(skill.interface.displayName
                  ? { displayName: skill.interface.displayName }
                  : {}),
                ...(skill.interface.shortDescription
                  ? { shortDescription: skill.interface.shortDescription }
                  : {}),
                ...(skill.interface.brandColor
                  ? { brandColor: skill.interface.brandColor }
                  : {}),
                ...(skill.interface.defaultPrompt
                  ? { defaultPrompt: skill.interface.defaultPrompt }
                  : {}),
              },
            }
          : {}),
        path: skill.path,
        scope: skill.scope as AgentSkillDto['scope'],
        enabled: skill.enabled,
      })),
      errors: (entry?.errors ?? []).map((error) => ({
        path: error.path,
        message: error.message,
      })),
    };
  }

  async listThreadMcpServers(localThreadId: string): Promise<ThreadMcpServersDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const runtime = this.runtimeForProvider(record.provider);
    if (!runtime.listMcpServers) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not expose MCP server status.',
      });
    }

    return {
      servers: ((await runtime.listMcpServers()) as Awaited<ReturnType<NonNullable<AgentRuntime['listMcpServers']>>>).map((server) => ({
        name: server.name,
        authStatus: server.authStatus as ThreadMcpServersDto['servers'][number]['authStatus'],
        tools: server.tools.map((tool) => ({
          name: tool.name,
          title: tool.title,
          description: tool.description,
        })),
        resourceCount: server.resourceCount,
        resourceTemplateCount: server.resourceTemplateCount,
      })),
    };
  }

  async listThreadHooks(localThreadId: string): Promise<ThreadHooksDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    let entry: Awaited<ReturnType<NonNullable<AgentRuntime['listHooks']>>>[number] | undefined;
    let fallbackWarnings: string[] = [];
    const runtime = this.runtimeForProvider(record.provider);
    try {
      if (!runtime.listHooks) {
        throw new HttpError(409, {
          code: 'conflict',
          message: 'This backend does not expose hooks.',
        });
      }
      [entry] = await runtime.listHooks({
        cwds: [workspace.absPath],
      }) as Awaited<ReturnType<NonNullable<AgentRuntime['listHooks']>>>;
    } catch (error) {
      if (!this.isCodexProvider(record.provider) || !isUnsupportedHooksListError(error)) {
        throw error;
      }

      fallbackWarnings = [
        'Codex app-server does not expose hooks/list yet; showing hooks parsed from hooks.json only.',
      ];
    }

    return this.toThreadHooksDto(record.provider, workspace.absPath, entry, fallbackWarnings);
  }

  async createThreadHook(
    localThreadId: string,
    input: CreateThreadHookInput,
  ): Promise<ThreadHooksDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    const runtime = this.runtimeForProvider(record.provider);
    if (!runtime.capabilities.management.hooks) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not expose hooks.',
      });
    }
    this.assertCodexHooksFileManagement(record.provider);

    await writeHookJsonEntry({
      codexHome: this.codexHome,
      workspacePath: workspace.absPath,
      input,
    });

    await trustHookForInput(runtime, workspace.absPath, input);

    return this.listThreadHooks(localThreadId);
  }

  async updateThreadHook(
    localThreadId: string,
    input: UpdateThreadHookInput,
  ): Promise<ThreadHooksDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    const runtime = this.runtimeForProvider(record.provider);
    if (!runtime.capabilities.management.hooks) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not expose hooks.',
      });
    }
    this.assertCodexHooksFileManagement(record.provider);

    await updateHookJsonEntry({
      codexHome: this.codexHome,
      workspacePath: workspace.absPath,
      input,
    });

    await trustHookForInput(runtime, workspace.absPath, input);

    return this.listThreadHooks(localThreadId);
  }

  async trustThreadHook(
    localThreadId: string,
    input: TrustThreadHookInput,
  ): Promise<ThreadHooksDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    const runtime = this.runtimeForProvider(record.provider);
    if (!runtime.setHookTrust) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support hook trust.',
      });
    }

    await runtime.setHookTrust({
      key: input.key,
      trustedHash: input.currentHash,
    });

    return this.listThreadHooks(localThreadId);
  }

  async untrustThreadHook(
    localThreadId: string,
    input: UntrustThreadHookInput,
  ): Promise<ThreadHooksDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    const runtime = this.runtimeForProvider(record.provider);
    if (!runtime.setHookTrust) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support hook trust.',
      });
    }

    await runtime.setHookTrust({
      key: input.key,
      trustedHash: null,
    });

    return this.listThreadHooks(localThreadId);
  }

  async interruptThread(localThreadId: string, requestedTurnId?: string): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }
    const providerSessionId = this.requireProviderSessionId(record);

    const turnId = requestedTurnId ?? record.providerTurnId;
    if (!turnId) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'There is no active turn to interrupt.'
      });
    }

    const interruptedTurn = await this.runtimeForProvider(record.provider).interruptTurn({
      providerSessionId,
      providerTurnId: turnId,
    });

    updateThreadRecord(this.db, localThreadId, {
      providerTurnId: null,
      status: interruptedTurn?.status === 'failed' ? 'failed' : 'interrupted',
      lastError: interruptedTurn?.error?.message ?? null,
      lastTurnCompletedAt: new Date().toISOString()
    });
    this.setLivePlan(localThreadId, null);
    this.setLiveItems(localThreadId, null);
    this.clearPendingSteersForTurn(localThreadId, turnId);
    this.invalidateThreadDetailCache(localThreadId);

    const updated = getThreadRecordById(this.db, localThreadId)!;
    return this.toThreadDto(updated, new Set());
  }

  async deleteThread(localThreadId: string): Promise<{ id: string }> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (workspace) {
      const tempDirectory = threadTempDirectoryPath(workspace.absPath, localThreadId);
      await fs.rm(tempDirectory, { recursive: true, force: true }).catch(() => {});
    }

    this.pendingRequests.delete(localThreadId);
    this.dismissedPlanDecisionTurns.delete(localThreadId);
    this.invalidateThreadDetailCache(localThreadId);
    this.threadContextUsage.delete(localThreadId);
    this.threadLivePlans.delete(localThreadId);
    this.threadLiveItems.delete(localThreadId);
    this.clearRecordedTurnItemOrders(localThreadId);
    this.answeredRequestNotes.delete(localThreadId);
    deleteViewerSessionsByThreadId(this.db, localThreadId);
    deleteNotificationsByThreadId(this.db, localThreadId);
    deleteThreadForkRecordsBySourceThreadId(this.db, localThreadId);
    deleteThreadForkRecordsByForkedThreadId(this.db, localThreadId);
    deleteThreadActivityNotesByThreadId(this.db, localThreadId);
    deleteThreadGoalRecordsByThreadId(this.db, localThreadId);
    deleteThreadHistoryItemRecordsByThreadId(this.db, localThreadId);
    deleteThreadPendingSteerRecordsByThreadId(this.db, localThreadId);
    deleteThreadTurnMetadataByThreadId(this.db, localThreadId);
    deleteThreadRecord(this.db, localThreadId);

    return { id: localThreadId };
  }

  async respondToRequest(
    localThreadId: string,
    requestId: string,
    input: RespondThreadActionRequestInput
  ): Promise<ThreadDetailDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const pending = this.pendingRequests.get(localThreadId)?.get(requestId);
    if (!pending) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Request was not found for this thread.'
      });
    }

    if (pending.source === 'server') {
      const runtime = this.runtimeForProvider(record.provider);
      if (!runtime.buildProviderRequestResponse) {
        throw new HttpError(409, {
          code: 'conflict',
          message: 'This backend cannot build provider request responses.',
        });
      }
      if (!runtime.respondToProviderRequest) {
        throw new HttpError(409, {
          code: 'conflict',
          message: 'This backend cannot respond to provider requests.',
        });
      }
      const result = runtime.buildProviderRequestResponse(pending, input);
      runtime.respondToProviderRequest(pending.providerRequestId, result);
      this.pendingRequests.get(localThreadId)?.delete(requestId);
      if (this.pendingRequests.get(localThreadId)?.size === 0) {
        this.pendingRequests.delete(localThreadId);
      }
    } else {
      const selectedAnswer = Object.values(input.answers)[0]?.answers[0]?.trim().toLowerCase();
      this.pendingRequests.get(localThreadId)?.delete(requestId);
      if (this.pendingRequests.get(localThreadId)?.size === 0) {
        this.pendingRequests.delete(localThreadId);
      }

      if (selectedAnswer === 'implement') {
        this.dismissedPlanDecisionTurns.delete(localThreadId);
        if (record.source === 'local_codex_import') {
          const providerSessionId = this.requireProviderSessionId(record);
          const loadedIds = await this.listLoadedProviderSessionIds(record.provider);
          if (!loadedIds.has(providerSessionId)) {
            await this.resumeThread(localThreadId, {
              ...(record.model ? { model: record.model } : {})
            });
          }
        }
        await this.updateThreadSettings(localThreadId, {
          collaborationMode: 'default'
        });
        await this.sendPrompt(localThreadId, {
          prompt: IMPLEMENT_APPROVED_PLAN_PROMPT,
          collaborationMode: 'default'
        });
      } else if (pending.request.turnId) {
        this.dismissedPlanDecisionTurns.set(localThreadId, pending.request.turnId);
      }
    }

    this.appendAnsweredRequestNote(
      localThreadId,
      buildAnsweredRequestNote(pending.request, input),
    );

    this.emitThreadEvent('thread.request.resolved', localThreadId, {
      requestId
    });

    return this.getThreadDetail(localThreadId);
  }

  private async handleRuntimeEvent(event: AgentRuntimeEvent) {
    switch (event.type) {
      case 'session.status.changed': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }

        updateThreadRecord(this.db, record.id, {
          status: event.status,
        });

        this.emitThreadEvent('thread.updated', record.id, {
          status: getThreadRecordById(this.db, record.id)?.status ?? record.status
        });
        return;
      }
      case 'session.title.updated': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }

        if (isAutoGeneratedTitle(record.title)) {
          updateThreadRecord(this.db, record.id, {
            title: truncateAutoThreadTitle(event.title),
          });
        }

        this.emitThreadEvent('thread.updated', record.id, {
          title: getThreadRecordById(this.db, record.id)?.title ?? record.title
        });
        return;
      }
      case 'goal.updated': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }

        const dto = normalizeThreadGoalStatusForThread(
          toThreadGoalDtoFromAgentGoal(event.goal),
          record,
        );
        const persistedGoal = toThreadGoalDtoFromRecord(
          this.persistThreadGoalSnapshot(record.id, dto),
        );
        this.emitThreadEvent('thread.goal.updated', record.id, {
          turnId: event.providerTurnId,
          goal: persistedGoal,
          goalHistory: this.listThreadGoalHistory(record.id),
        });
        return;
      }
      case 'goal.cleared': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }

        markActiveThreadGoalRecordTerminated(this.db, record.id);
        this.emitThreadEvent('thread.goal.cleared', record.id, {
          goalHistory: this.listThreadGoalHistory(record.id),
        });
        return;
      }
      case 'usage.updated': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }
        const tokenUsage = isRecord(event.usage)
          ? (event.usage as ThreadContextTokenUsagePayload)
          : null;

        const usage = buildThreadContextUsageFromPayload(
          tokenUsage,
          record.model,
        );
        this.setThreadContextUsage(record.id, usage, true);
        const existingTurnMetadata = getThreadTurnMetadataByThreadAndTurnId(
          this.db,
          record.id,
          event.providerTurnId,
        );
        const previousState = parseStoredThreadTurnTokenUsageState(
          existingTurnMetadata?.tokenUsageJson,
        );
        const previousCumulativeTotal = this.threadCumulativeTokenUsage.get(record.id);
        const currentCumulativeTotal = buildTurnTokenBreakdown(
          isRecord(tokenUsage?.total) ? tokenUsage.total : null,
        );
        if (currentCumulativeTotal) {
          this.threadCumulativeTokenUsage.set(record.id, currentCumulativeTotal);
        }
        const baselineTotal =
          previousState.baselineTotal ??
          previousCumulativeTotal ??
          this.getLatestStoredThreadCumulativeTotal(record.id, {
            excludeTurnId: event.providerTurnId,
          }) ??
          zeroTurnTokenBreakdown();
        const turnTokenUsage = buildThreadTurnTokenUsage(
          tokenUsage,
          baselineTotal,
          previousState.usage,
        );
        if (turnTokenUsage) {
          upsertThreadTurnMetadata(this.db, {
            threadId: record.id,
            turnId: event.providerTurnId,
            tokenUsageJson: stringifyStoredThreadTurnTokenUsageState({
              baselineTotal,
              usage: turnTokenUsage,
            }),
          });
          this.invalidateThreadDetailCache(record.id);
          this.emitThreadEvent('thread.turn.token.updated', record.id, {
            turnId: event.providerTurnId,
            tokenUsage: turnTokenUsage,
            priceEstimate: estimateTurnPrice(turnTokenUsage, {
              pricingModelKey: existingTurnMetadata?.pricingModelKey,
              pricingTierKey: normalizePricingTier(existingTurnMetadata?.pricingTierKey),
            }),
          });
        }
        return;
      }
      case 'turn.started': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }
        const turnId = event.turn.providerTurnId;

        this.clearPendingPlanDecisionRequests(record.id, true);
        this.dismissedPlanDecisionTurns.delete(record.id);

        updateThreadRecord(this.db, record.id, {
          providerTurnId: turnId,
          status: 'running',
          lastError: null,
          lastTurnStartedAt: new Date().toISOString()
        });
        this.resetRecordedTurnItemOrder(record.id, turnId);
        for (const item of event.turn.items) {
          this.recordTurnItemOrder(record.id, turnId, item.id);
        }
        this.setLivePlan(record.id, null);
        this.setLiveItems(record.id, null);
        this.resetThreadContextUsage(record.id, true);
        const pricingSnapshot = buildTurnPricingSnapshot(
          record.model,
          this.fastModeForProvider(record.provider, record.fastMode),
        );
        upsertThreadTurnMetadata(this.db, {
          threadId: record.id,
          turnId,
          model: record.model ?? null,
          reasoningEffort: normalizeReasoningEffort(record.reasoningEffort),
          pricingModelKey: pricingSnapshot?.pricingModelKey ?? null,
          pricingTierKey: pricingSnapshot?.pricingTierKey ?? null,
          tokenUsageJson: stringifyStoredThreadTurnTokenUsageState({
            baselineTotal:
              this.threadCumulativeTokenUsage.get(record.id) ??
              this.getLatestStoredThreadCumulativeTotal(record.id, {
                excludeTurnId: turnId,
              }) ??
              zeroTurnTokenBreakdown(),
            usage: null,
          }),
        });
        this.invalidateThreadDetailCache(record.id);

        this.emitThreadEvent('thread.turn.started', record.id, {
          turnId,
        });
        return;
      }
      case 'hook.started':
      case 'hook.completed': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }

        const turnId = event.providerTurnId ?? record.providerTurnId;
        if (!turnId) {
          return;
        }
        const liveItem = {
          ...event.item,
          sequence: this.recordTurnItemOrder(record.id, turnId, event.item.id),
        };
        this.persistLiveHistoryItem(record.id, turnId, liveItem);
        this.upsertLiveItem(record.id, turnId, liveItem);
        this.emitThreadEvent(
          event.type === 'hook.started'
            ? 'thread.item.started'
            : 'thread.item.completed',
          record.id,
          {
            turnId,
            item: liveItem,
          },
        );
        return;
      }
      case 'item.started':
      case 'item.completed': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }

        const sequence = this.recordTurnItemOrder(
          record.id,
          event.providerTurnId,
          event.item.id,
        );
        const orderedLiveItem = {
          ...event.item,
          sequence,
        };
        this.persistLiveHistoryItem(record.id, event.providerTurnId, orderedLiveItem);
        this.upsertLiveItem(record.id, event.providerTurnId, orderedLiveItem);
        this.emitThreadEvent(
          event.type === 'item.started'
            ? 'thread.item.started'
            : 'thread.item.completed',
          record.id,
          {
            turnId: event.providerTurnId,
            item: orderedLiveItem,
          },
        );
        return;
      }
      case 'plan.updated': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }

        this.setLivePlan(record.id, {
          turnId: event.providerTurnId,
          explanation: event.explanation,
          plan: event.plan,
          updatedAt: new Date().toISOString(),
        });

        this.emitThreadEvent('thread.plan.updated', record.id, {
          turnId: event.providerTurnId,
          explanation: event.explanation,
          plan: event.plan,
        });
        return;
      }
      case 'output.delta': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }

        this.recordTurnItemOrder(record.id, event.providerTurnId, event.itemId);
        this.emitThreadEvent('thread.output.delta', record.id, {
          turnId: event.providerTurnId,
          itemId: event.itemId,
          delta: event.delta,
        });
        return;
      }
      case 'turn.completed': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }
        const turnId = event.turn.providerTurnId;
        const turnItems = event.turn.items;

        updateThreadRecord(this.db, record.id, {
          providerTurnId: null,
          status:
            event.turn.status === 'failed'
              ? 'failed'
              : event.turn.status === 'interrupted'
                ? 'interrupted'
                : 'idle',
          lastError: event.turn.error?.message ?? null,
          lastTurnCompletedAt: new Date().toISOString()
        });
        this.setLivePlan(record.id, null);
        this.setLiveItems(record.id, null);
        this.clearPendingSteersForTurn(record.id, turnId);
        this.pendingRequests.delete(record.id);
        if (
          event.turn.status === 'completed' &&
          normalizeCollaborationMode(record.collaborationMode) === 'plan' &&
          turnItems.some((item) => item.kind === 'plan')
        ) {
          this.createPendingPlanDecisionRequest(record.id, turnId, true);
        } else {
          this.dismissedPlanDecisionTurns.delete(record.id);
        }
        this.invalidateThreadDetailCache(record.id);

        this.emitThreadEvent(
          event.turn.status === 'failed' ? 'thread.turn.failed' : 'thread.turn.completed',
          record.id,
          {
            turnId,
            status: event.turn.status,
            error: event.turn.error?.message ?? null,
          }
        );
        return;
      }
      case 'turn.failed': {
        const record = this.findRecordByProviderSessionId(
          event.provider,
          event.providerSessionId,
        );
        if (!record) {
          return;
        }

        updateThreadRecord(this.db, record.id, {
          status: 'failed',
          lastError: event.error,
        });
        this.setLivePlan(record.id, null);
        this.setLiveItems(record.id, null);
        this.clearPendingSteersForTurn(record.id, event.providerTurnId);
        this.pendingRequests.delete(record.id);
        this.dismissedPlanDecisionTurns.delete(record.id);
        this.invalidateThreadDetailCache(record.id);

        this.emitThreadEvent('thread.turn.failed', record.id, {
          turnId: event.providerTurnId,
          error: event.error,
          willRetry: event.willRetry,
        });
        return;
      }
    }
  }

  private async handleProviderRuntimeRequest(request: AgentProviderRequest) {
    const runtime = this.runtimeForProvider(request.provider);
    const defaultMappedRequest = runtime.mapProviderRequest?.(request, {
      approvalMode: 'guarded',
    });
    const providerSessionIdFromParams =
      isRecord(request.params)
        ? request.params.providerSessionId ??
          request.params.threadId ??
          request.params.conversationId ??
          request.params.sessionId
        : null;
    const providerSessionId =
      defaultMappedRequest?.providerSessionId ??
      (typeof providerSessionIdFromParams === 'string' ? providerSessionIdFromParams : null);
    const record = providerSessionId
      ? this.findRecordByProviderSessionId(request.provider, providerSessionId)
      : null;
    if (!record) {
      return;
    }

    const approvalMode = (record.approvalMode ?? 'yolo') as ApprovalMode;
    const mappedRequest =
      approvalMode === 'guarded'
        ? defaultMappedRequest
        : runtime.mapProviderRequest?.(request, { approvalMode });
    if (!mappedRequest) {
      return;
    }

    if (mappedRequest.autoApprovedResult) {
      runtime.respondToProviderRequest?.(
        mappedRequest.providerRequestId,
        mappedRequest.autoApprovedResult,
      );
      return;
    }

    if (!mappedRequest.pendingRequest) {
      return;
    }
    let threadRequests = this.pendingRequests.get(record.id);
    if (!threadRequests) {
      threadRequests = new Map();
      this.pendingRequests.set(record.id, threadRequests);
    }
    const pendingRequest: Extract<PendingThreadRequestRecord, { source: 'server' }> = {
      source: 'server',
      providerRequestId: mappedRequest.pendingRequest.providerRequestId,
      responseKind: mappedRequest.pendingRequest.responseKind,
      request: mappedRequest.pendingRequest.request as ThreadActionRequestDto & {
        kind: 'requestUserInput';
      },
    };
    if (mappedRequest.pendingRequest.responsePayload) {
      pendingRequest.responsePayload = mappedRequest.pendingRequest.responsePayload;
    }
    threadRequests.set(mappedRequest.pendingRequest.request.id, pendingRequest);

    this.emitThreadEvent('thread.request.created', record.id, {
      request: mappedRequest.pendingRequest.request,
    });
  }

  private buildThreadPatch(
    remoteSession: AgentSessionSummary | AgentSessionDetail,
    model: string | null | undefined,
    reasoningEffort: string | null | undefined
  ) {
    const failedTurn = 'turns' in remoteSession
      ? remoteSession.turns.find((turn) => turn.status === 'failed')
      : null;
    return {
      provider: remoteSession.provider,
      providerSessionId: remoteSession.providerSessionId,
      status: remoteSession.status,
      summaryText: remoteSession.preview || null,
      model: model ?? null,
      reasoningEffort: normalizeReasoningEffort(reasoningEffort),
      lastError: failedTurn?.error?.message ?? null,
      updatedAt: remoteSession.updatedAt ?? new Date().toISOString(),
    };
  }

  private toThreadDto(record: any, loadedIds: Set<string>): ThreadDto {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      provider: (record.provider ?? 'codex') as ThreadDto['provider'],
      providerSessionId: record.providerSessionId ?? null,
      source: (record.source ?? 'supervisor') as ThreadSourceDto,
      title: record.title,
      model: record.model ?? null,
      reasoningEffort: normalizeReasoningEffort(record.reasoningEffort),
      fastMode: this.fastModeForProvider(record.provider, record.fastMode),
      collaborationMode: normalizeCollaborationMode(record.collaborationMode),
      approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
      sandboxMode:
        normalizeSandboxMode(record.sandboxMode) ??
        defaultSandboxModeForApprovalMode((record.approvalMode ?? 'yolo') as ApprovalMode),
      status: (record.status ?? 'idle') as ThreadStatusDto,
      summaryText: record.summaryText ?? null,
      lastError: record.lastError ?? null,
      activeTurnId: record.providerTurnId ?? null,
      isLoaded:
        record.isConnected !== false &&
        (record.providerSessionId ? loadedIds.has(record.providerSessionId) : false),
      isPinned: record.isPinned,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastTurnStartedAt: record.lastTurnStartedAt ?? null,
      lastTurnCompletedAt: record.lastTurnCompletedAt ?? null,
      contextUsage: this.getThreadContextUsage(record.id),
    };
  }

  private emitThreadEvent(
    type: ThreadEventEnvelope['type'],
    threadId: string,
    payload: Record<string, unknown>
  ) {
    this.eventBus.emitThreadEvent({
      type,
      threadId,
      timestamp: new Date().toISOString(),
      payload
    });
  }

  private listPendingRequests(localThreadId: string): ThreadActionRequestDto[] {
    return [...(this.pendingRequests.get(localThreadId)?.values() ?? [])].map((entry) => entry.request);
  }

  private getLivePlan(localThreadId: string): ThreadLivePlanDto | null {
    return this.threadLivePlans.get(localThreadId) ?? null;
  }

  private setLivePlan(localThreadId: string, plan: ThreadLivePlanDto | null) {
    if (plan) {
      this.threadLivePlans.set(localThreadId, plan);
    } else {
      this.threadLivePlans.delete(localThreadId);
    }
  }

  private setLiveItems(localThreadId: string, liveItems: ThreadLiveItemsDto | null) {
    if (liveItems && liveItems.items.length > 0) {
      this.threadLiveItems.set(localThreadId, liveItems);
      return;
    }

    this.threadLiveItems.delete(localThreadId);
  }

  private resetRecordedTurnItemOrder(localThreadId: string, turnId: string) {
    this.threadTurnItemOrder.get(localThreadId)?.delete(turnId);
    this.threadNextTurnItemSequence.get(localThreadId)?.delete(turnId);
  }

  private clearRecordedTurnItemOrders(localThreadId: string) {
    this.threadTurnItemOrder.delete(localThreadId);
    this.threadNextTurnItemSequence.delete(localThreadId);
  }

  private recordTurnItemOrder(localThreadId: string, turnId: string, itemId: string) {
    let threadOrders = this.threadTurnItemOrder.get(localThreadId);
    if (!threadOrders) {
      threadOrders = new Map();
      this.threadTurnItemOrder.set(localThreadId, threadOrders);
    }

    let turnOrder = threadOrders.get(turnId);
    if (!turnOrder) {
      turnOrder = new Map();
      threadOrders.set(turnId, turnOrder);
    }

    const existing = turnOrder.get(itemId);
    if (existing !== undefined) {
      return existing;
    }

    let threadSequences = this.threadNextTurnItemSequence.get(localThreadId);
    if (!threadSequences) {
      threadSequences = new Map();
      this.threadNextTurnItemSequence.set(localThreadId, threadSequences);
    }

    const sequence = threadSequences.get(turnId) ?? 0;
    threadSequences.set(turnId, sequence + 1);
    turnOrder.set(itemId, sequence);
    return sequence;
  }

  private turnItemOrderSnapshot(localThreadId: string): TurnItemOrderSnapshot {
    return this.threadTurnItemOrder.get(localThreadId) ?? new Map();
  }

  private getLiveItems(
    localThreadId: string,
    allTurns: ThreadTurnDto[],
    visibleTurns: ThreadTurnDto[] = allTurns,
  ): ThreadLiveItemsDto | null {
    const current = this.threadLiveItems.get(localThreadId);
    if (!current) {
      return null;
    }

    const reconciled = this.reconcileLiveItems(localThreadId, allTurns);
    if (!reconciled) {
      return null;
    }

    const visibleTurnIds = new Set(visibleTurns.map((turn) => turn.id));
    return visibleTurnIds.has(reconciled.turnId) ? reconciled : null;
  }

  private upsertLiveItem(
    localThreadId: string,
    turnId: string,
    item: ThreadHistoryItemDto,
  ) {
    const current = this.threadLiveItems.get(localThreadId);
    const currentItems =
      current?.turnId === turnId ? current.items : [];
    const nextItems = [
      ...currentItems.filter((entry) => entry.id !== item.id),
      item,
    ];

    this.setLiveItems(localThreadId, {
      turnId,
      items: sortHistoryItemsBySequence(nextItems),
      updatedAt: new Date().toISOString(),
    });
  }

  private async toThreadHooksDto(
    provider: string | null | undefined,
    workspacePath: string,
    entry: Awaited<ReturnType<NonNullable<AgentRuntime['listHooks']>>>[number] | undefined,
    fallbackWarnings: string[] = [],
  ): Promise<ThreadHooksDto> {
    const globalHooksPath = path.join(this.codexHome, 'hooks.json');
    const projectHooksPath = path.join(workspacePath, '.codex', 'hooks.json');
    const officialHooks: AgentHookDto[] = (entry?.hooks ?? []).map((hook) => ({
      key: hook.key,
      eventName: hook.eventName as AgentHookDto['eventName'],
      handlerType: hook.handlerType as AgentHookDto['handlerType'],
      matcher: hook.matcher,
      command: hook.command,
      timeoutSec: hook.timeoutSec,
      statusMessage: hook.statusMessage,
      sourcePath: hook.sourcePath,
      source: hook.source as AgentHookDto['source'],
      pluginId: hook.pluginId,
      displayOrder: hook.displayOrder,
      enabled: hook.enabled,
      isManaged: hook.isManaged,
      currentHash: hook.currentHash,
      trustStatus: hook.trustStatus as AgentHookDto['trustStatus'],
    }));
    const [globalHooks, projectHooks] = this.isCodexProvider(provider)
      ? await Promise.all([
          readLocalHookDtos({
            hooksPath: globalHooksPath,
            source: 'user',
            displayOffset: officialHooks.length,
          }),
          readLocalHookDtos({
            hooksPath: projectHooksPath,
            source: 'project',
            displayOffset: officialHooks.length + 10_000,
          }),
        ])
      : [[], []];
    const hooksBySignature = new Map<string, AgentHookDto>();
    for (const hook of [...globalHooks, ...projectHooks, ...officialHooks]) {
      const signature = [
        hook.sourcePath,
        hook.eventName,
        hook.matcher ?? '',
        hook.command ?? '',
        hook.timeoutSec,
        hook.statusMessage ?? '',
      ].join('\0');
      hooksBySignature.set(signature, hook);
    }

    return {
      cwd: entry?.cwd ?? workspacePath,
      hooks: [...hooksBySignature.values()].sort(
        (left, right) => left.displayOrder - right.displayOrder,
      ),
      warnings: [...fallbackWarnings, ...(entry?.warnings ?? [])],
      errors: entry?.errors ?? [],
      globalHooksPath,
      projectHooksPath,
    };
  }

  private reconcileLiveItems(
    localThreadId: string,
    turns: ThreadTurnDto[],
  ): ThreadLiveItemsDto | null {
    const current = this.threadLiveItems.get(localThreadId);
    if (!current) {
      return null;
    }

    const matchingTurn = turns.find((turn) => turn.id === current.turnId);
    const materializedItemIds = new Set(
      matchingTurn?.items.map((item) => item.id) ?? [],
    );
    const nextItems = current.items.filter(
      (item) => !materializedItemIds.has(item.id),
    );

    if (nextItems.length === current.items.length) {
      return current;
    }

    if (nextItems.length === 0) {
      this.threadLiveItems.delete(localThreadId);
      return null;
    }

    const nextLiveItems: ThreadLiveItemsDto = {
      ...current,
      items: nextItems,
      updatedAt: new Date().toISOString(),
    };
    this.threadLiveItems.set(localThreadId, nextLiveItems);
    return nextLiveItems;
  }

  private listAnsweredRequestNotes(localThreadId: string): ThreadAnsweredRequestNoteDto[] {
    return [...(this.answeredRequestNotes.get(localThreadId) ?? [])];
  }

  private appendAnsweredRequestNote(
    localThreadId: string,
    note: ThreadAnsweredRequestNoteDto | null,
  ) {
    if (!note) {
      return;
    }

    const current = this.answeredRequestNotes.get(localThreadId) ?? [];
    const next = [...current.filter((entry) => entry.id !== note.id), note];
    this.answeredRequestNotes.set(localThreadId, next.slice(-16));
  }

  private listActivityNotes(localThreadId: string): ThreadActivityNoteDto[] {
    const cachedTurns = this.threadDetailCache.get(localThreadId)?.turns ?? [];
    const notes: ThreadActivityNoteDto[] = listThreadActivityNotesByThreadId(
      this.db,
      localThreadId,
    ).map((record) => {
      const fallbackAnchor = [...cachedTurns]
        .reverse()
        .find(
          (turn) =>
            turn.startedAt &&
            turn.startedAt.localeCompare(record.createdAt) <= 0,
        );
      return {
        id: record.id,
        kind: 'fastMode',
        text: record.text,
        createdAt: record.createdAt,
        anchorTurnId: record.anchorTurnId ?? fallbackAnchor?.id ?? null,
      };
    });

    for (const record of listThreadForkRecordsBySourceThreadId(this.db, localThreadId)) {
      const forkedThread = getThreadRecordById(this.db, record.forkedThreadId);
      notes.push({
        id: `fork-created:${record.id}`,
        kind: 'forkCreated',
        createdAt: record.createdAt,
        anchorTurnId: record.sourceTurnId ?? null,
        linkedThreadId: record.forkedThreadId,
        linkedThreadTitle: forkedThread?.title ?? null,
        turnIndex: record.sourceTurnIndex ?? null,
      });
    }

    for (const record of listThreadForkRecordsByForkedThreadId(this.db, localThreadId)) {
      const sourceThread = getThreadRecordById(this.db, record.sourceThreadId);
      notes.push({
        id: `fork-source:${record.id}`,
        kind: 'forkSource',
        createdAt: record.createdAt,
        anchorTurnId: '__leading__',
        linkedThreadId: record.sourceThreadId,
        linkedThreadTitle: sourceThread?.title ?? null,
        turnIndex: record.sourceTurnIndex ?? null,
      });
    }

    return notes.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  private appendActivityNote(
    localThreadId: string,
    input: { kind: 'fastMode'; text: string },
  ) {
    const cachedAnchorTurnId =
      this.threadDetailCache.get(localThreadId)?.turns.at(-1)?.id ?? null;
    const metadataAnchorTurnId =
      getLatestThreadTurnMetadataByThreadId(this.db, localThreadId)?.turnId ?? null;
    createThreadActivityNoteRecord(this.db, {
      threadId: localThreadId,
      kind: input.kind,
      text: input.text,
      anchorTurnId: cachedAnchorTurnId ?? metadataAnchorTurnId,
    });
  }

  private listPendingSteers(localThreadId: string): ThreadPendingSteerDto[] {
    return listThreadPendingSteerRecordsByThreadId(this.db, localThreadId).map((record) => ({
      id: record.id,
      clientRequestId: record.clientRequestId ?? null,
      turnId: record.turnId,
      prompt: record.displayPrompt,
      createdAt: record.createdAt,
    }));
  }

  private clearPendingSteersForTurn(localThreadId: string, turnId: string) {
    const records = listThreadPendingSteerRecordsByThreadId(this.db, localThreadId).filter(
      (record) => record.turnId === turnId,
    );
    if (records.length === 0) {
      return;
    }

    for (const record of records) {
      deleteThreadPendingSteerRecordById(this.db, record.id);
    }

    this.invalidateThreadDetailCache(localThreadId);
    this.emitThreadEvent('thread.updated', localThreadId, {
      reason: 'pending_steer_updated',
      turnId,
    });
  }

  private reconcilePendingSteers(localThreadId: string, remoteSession: AgentSessionDetail) {
    const records = listThreadPendingSteerRecordsByThreadId(this.db, localThreadId);
    if (records.length === 0) {
      return;
    }

    const turnsById = new Map(
      remoteSession.turns.map((turn) => [turn.providerTurnId, turn]),
    );
    let removed = false;

    for (const record of records) {
      const turn = turnsById.get(record.turnId);
      if (!turn) {
        deleteThreadPendingSteerRecordById(this.db, record.id);
        removed = true;
        continue;
      }

      const turnMessages = extractTurnUserMessages(turn);
      if (
        turnMessages.includes(record.submittedPrompt) ||
        turnMessages.includes(record.displayPrompt) ||
        turn.status !== 'inProgress'
      ) {
        deleteThreadPendingSteerRecordById(this.db, record.id);
        removed = true;
      }
    }

    if (removed) {
      this.invalidateThreadDetailCache(localThreadId);
      this.emitThreadEvent('thread.updated', localThreadId, {
        reason: 'pending_steer_updated',
      });
    }
  }

  private createPendingPlanDecisionRequest(
    localThreadId: string,
    turnId: string,
    emitEvents: boolean
  ) {
    if (this.dismissedPlanDecisionTurns.get(localThreadId) === turnId) {
      return;
    }

    this.clearPendingPlanDecisionRequests(localThreadId, false);

    const request: ThreadActionRequestDto = {
      id: `${LOCAL_PLAN_DECISION_PREFIX}${turnId}`,
      kind: 'planDecision',
      title: 'Plan ready',
      description:
        'Review the proposed plan. Implement will switch the thread back to default mode and start execution automatically.',
      turnId,
      itemId: null,
      createdAt: new Date().toISOString(),
      questions: [
        {
          id: 'plan-decision',
          header: 'Next step',
          question: 'Choose whether to implement this plan now or keep refining it in plan mode.',
          isOther: false,
          isSecret: false,
          options: [
            {
              label: 'Implement',
              description: 'Exit plan mode and continue with implementation immediately.'
            },
            {
              label: 'Stay in plan mode',
              description: 'Keep plan mode on so you can send feedback and request another plan.'
            }
          ]
        }
      ]
    };

    let threadRequests = this.pendingRequests.get(localThreadId);
    if (!threadRequests) {
      threadRequests = new Map();
      this.pendingRequests.set(localThreadId, threadRequests);
    }

    threadRequests.set(request.id, {
      source: 'planDecision',
      request
    });

    if (emitEvents) {
      this.emitThreadEvent('thread.request.created', localThreadId, {
        request
      });
    }
  }

  private clearPendingPlanDecisionRequests(localThreadId: string, emitEvents: boolean) {
    const threadRequests = this.pendingRequests.get(localThreadId);
    if (!threadRequests) {
      return;
    }

    const removedIds: string[] = [];
    for (const [requestId, request] of threadRequests.entries()) {
      if (request.source !== 'planDecision') {
        continue;
      }

      threadRequests.delete(requestId);
      removedIds.push(requestId);
    }

    if (threadRequests.size === 0) {
      this.pendingRequests.delete(localThreadId);
    }

    if (!emitEvents) {
      return;
    }

    removedIds.forEach((requestId) => {
      this.emitThreadEvent('thread.request.resolved', localThreadId, {
        requestId
      });
    });
  }

  private syncPendingPlanDecisionRequest(
    localThreadId: string,
    collaborationMode: string | null | undefined,
    remoteSession: AgentSessionDetail
  ) {
    const latestTurn = remoteSession.turns.at(-1) ?? null;
    const shouldHavePlanDecision =
      normalizeCollaborationMode(collaborationMode) === 'plan' &&
      latestTurn?.status === 'completed' &&
      latestTurn.items.some((item) => item.kind === 'plan');

    if (!shouldHavePlanDecision || !latestTurn) {
      this.clearPendingPlanDecisionRequests(localThreadId, false);
      this.dismissedPlanDecisionTurns.delete(localThreadId);
      return;
    }

    const expectedRequestId = `${LOCAL_PLAN_DECISION_PREFIX}${latestTurn.providerTurnId}`;
    const existingRequest = this.pendingRequests.get(localThreadId)?.get(expectedRequestId);
    if (existingRequest?.source === 'planDecision') {
      return;
    }

    this.createPendingPlanDecisionRequest(localThreadId, latestTurn.providerTurnId, false);
  }

  private normalizeReasoningForModel(
    modelRecords: Array<{
      model: string;
      defaultReasoningEffort: string | null;
      supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
    }>,
    model: string | null,
    requested: ReasoningEffortDto | null
  ): ReasoningEffortDto | null {
    if (!model) {
      return requested;
    }

    const matchedModel = modelRecords.find((entry) => entry.model === model);
    if (!matchedModel) {
      return requested;
    }

    const supported = new Set(
      matchedModel.supportedReasoningEfforts.map((entry) => entry.reasoningEffort)
    );

    if (requested && supported.has(requested)) {
      return requested;
    }

    return normalizeReasoningEffort(matchedModel.defaultReasoningEffort);
  }

  private reasoningEffortAvailableForModel(
    modelRecords: Array<{
      model: string;
      supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
    }>,
    model: string | null,
  ): boolean | null {
    if (!model) {
      return null;
    }

    const matchedModel = modelRecords.find((entry) => entry.model === model);
    if (!matchedModel) {
      return null;
    }

    return matchedModel.supportedReasoningEfforts.length > 1;
  }
}
