import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  CodexAppServerManager,
  CodexServerRequest,
  CodexServerEvent,
  SandboxPolicy,
  CodexThreadRecord,
  CodexTurnItem,
  CodexTurnRecord,
  JsonRpcClientError
} from '../../../../packages/codex/src/index';
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
  deleteNotificationsByThreadId,
  deleteThreadPendingSteerRecordById,
  deleteThreadPendingSteerRecordsByThreadId,
  deleteThreadRecord,
  deleteThreadTurnMetadataByThreadId,
  deleteViewerSessionsByThreadId,
  getThreadTurnMetadataByThreadAndTurnId,
  getThreadRecordByCodexThreadId,
  getThreadRecordById,
  getWorkspaceRecordByPath,
  getWorkspaceRecordById,
  listThreadActivityNotesByThreadId,
  listThreadForkRecordsByForkedThreadId,
  listThreadForkRecordsBySourceThreadId,
  listThreadPendingSteerRecordsByThreadId,
  listThreadTurnMetadataByThreadId,
  listThreadRecords,
  upsertThreadTurnMetadata,
  updateThreadRecord
} from '../../../../packages/db/src/index';
import {
  ApprovalMode,
  CollaborationModeDto,
  CreateThreadInput,
  ForkThreadInput,
  ImportThreadInput,
  ModelOptionDto,
  PromptAttachmentManifestEntryDto,
  ReasoningEffortDto,
  RespondThreadActionRequestInput,
  ResumeThreadInput,
  SandboxModeDto,
  SendThreadPromptInput,
  ThreadAnsweredRequestNoteDto,
  ThreadActionQuestionDto,
  ThreadActionRequestDto,
  ThreadActivityNoteDto,
  ThreadContextUsageDto,
  ThreadDetailDto,
  ThreadDto,
  ThreadEventEnvelope,
  ThreadForkResultDto,
  ThreadForkTurnOptionDto,
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
  UpdateThreadSettingsInput,
  WorkspaceDto
} from '../../../../packages/shared/src/index';
import { HttpError } from '../app';
import {
  readCodexFastModeSync,
  writeCodexFastMode,
} from './codexHostConfig';
import { SupervisorEventBus } from './event-bus';
import { LocalCodexSessionStore } from './local-session-store';
import {
  buildTurnPricingSnapshot,
  contextWindowForModel,
  estimateTurnPrice,
  supportsFastMode,
} from './modelPricing';
import { truncateAutoThreadTitle } from './thread-title';

const DEFAULT_THREAD_TITLE = 'Untitled thread';
const GENERIC_REMOTE_THREAD_TITLE = 'Thread';
const LOCAL_PLAN_DECISION_PREFIX = 'plan-decision:';
const IMPLEMENT_APPROVED_PLAN_PROMPT = 'Implement the approved plan.';
const THREAD_DETAIL_CACHE_TTL_MS = 5_000;
const DEFERRED_COMMAND_DETAIL_TITLE = 'Command Output';
const DEFERRED_TOOL_DETAIL_TITLE = 'Tool Call Details';
const CONTEXT_BASELINE_TOKENS = 12_000;
const FAST_MODE_NOTE_ON = 'Fast mode on';
const FAST_MODE_NOTE_OFF = 'Fast mode off';

type PendingThreadRequestRecord =
  | {
      source: 'server';
      serverRequestId: number;
      responseKind: 'answers' | 'mcpElicitation';
      request: ThreadActionRequestDto;
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

function buildTurnSandboxPolicy(
  sandboxMode: SandboxModeDto,
  writableRoot: string,
): SandboxPolicy {
  switch (sandboxMode) {
    case 'danger-full-access':
      return {
        type: 'dangerFullAccess',
      };
    case 'read-only':
      return {
        type: 'readOnly',
        access: {
          type: 'fullAccess',
        },
        networkAccess: false,
      };
    case 'workspace-write':
    default:
      return {
        type: 'workspaceWrite',
        writableRoots: [writableRoot],
        readOnlyAccess: {
          type: 'fullAccess',
        },
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      };
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

function serviceTierForFastMode(
  fastMode: boolean,
): 'fast' | null {
  return fastMode ? 'fast' : null;
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

function isRemoteThreadBootstrapError(error: unknown) {
  if (!(error instanceof JsonRpcClientError) || error.code !== 'remote_error') {
    return false;
  }

  return (
    error.message.includes('includeTurns is unavailable before first user message') ||
    error.message.includes('is not materialized yet') ||
    error.message.includes('no rollout found for thread id') ||
    error.message.includes('failed to load rollout') ||
    (error.message.includes('rollout at') && error.message.includes('is empty'))
  );
}

type TurnSteerRace =
  | { type: 'missing' }
  | { type: 'turnIdMismatch'; actualTurnId: string };

function parseTurnSteerRace(error: unknown): TurnSteerRace | null {
  if (!(error instanceof JsonRpcClientError) || error.code !== 'remote_error') {
    return null;
  }

  if (error.message === 'no active turn to steer') {
    return { type: 'missing' };
  }

  const mismatchPrefix = 'expected active turn id `';
  const mismatchSeparator = '` but found `';
  if (!error.message.startsWith(mismatchPrefix)) {
    return null;
  }

  const actualTurnId = error.message
    .slice(mismatchPrefix.length)
    .split(mismatchSeparator)[1]
    ?.replace(/`$/, '');

  if (!actualTurnId) {
    return null;
  }

  return {
    type: 'turnIdMismatch',
    actualTurnId,
  };
}

function extractTurnUserMessages(turn: CodexTurnRecord) {
  return turn.items
    .filter((item) => item.type === 'userMessage')
    .map((item) =>
      item.content
        ?.map((entry) => (entry.type === 'text' ? (entry.text ?? '') : `[${entry.type}]`))
        .join('\n')
        .trim() ?? '',
    )
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

function parseUuidV7Timestamp(id: string): string | null {
  const normalized = id.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(normalized) || normalized[12]?.toLowerCase() !== '7') {
    return null;
  }

  const millis = Number.parseInt(normalized.slice(0, 12), 16);
  if (!Number.isFinite(millis)) {
    return null;
  }

  return new Date(millis).toISOString();
}

function normalizeThreadStatus(record: CodexThreadRecord): ThreadStatusDto {
  switch (record.status.type) {
    case 'idle':
      return 'idle';
    case 'systemError':
      return 'system_error';
    case 'notLoaded':
      return 'not_loaded';
    case 'active':
      return 'running';
  }
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

function stringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => stringOrNull(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function normalizeTextLines(text: string) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  while (lines.length > 1 && lines.at(-1)?.trim() === '') {
    lines.pop();
  }

  return lines;
}

function textFromContentEntries(
  content: CodexTurnItem['content'],
  fallback: string | null = null,
) {
  const text =
    content
      ?.map((entry) => {
        if (typeof entry.text === 'string') {
          return entry.text;
        }

        return `[${entry.type}]`;
      })
      .join('\n')
      .trim();

  return text || fallback;
}

function codexItemText(item: CodexTurnItem, fallback = '') {
  const contentText = textFromContentEntries(item.content);
  const directText = typeof item.text === 'string' && item.text.trim() ? item.text : null;

  if (
    contentText &&
    (!directText ||
      contentText.includes('\n') ||
      (Array.isArray(item.content) && item.content.length > 1))
  ) {
    return contentText;
  }

  return directText ?? contentText ?? fallback;
}

function summarizeCommandText(text: string) {
  const lines = normalizeTextLines(text);
  return lines.find((line) => line.trim().length > 0) ?? lines[0] ?? 'Command output';
}

function safeJsonStringify(value: unknown) {
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized && serialized !== 'null' ? serialized : null;
  } catch {
    return String(value);
  }
}

function summarizeToolCallText(text: string) {
  const lines = normalizeTextLines(text);
  return lines.find((line) => line.trim().length > 0) ?? lines[0] ?? 'Tool call';
}

function deferCommandHistoryItem(
  item: ThreadHistoryItemDto & { kind: 'commandExecution' },
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const fullText = item.detailText?.trim() || item.text || 'Command output';
  deferredDetails.set(item.id, {
    id: item.id,
    kind: item.kind,
    title: DEFERRED_COMMAND_DETAIL_TITLE,
    text: fullText,
  });

  return {
    ...item,
    text: summarizeCommandText(fullText),
    detailText: null,
    hasDeferredDetail: true,
  };
}

function deferToolCallHistoryItem(
  item: ThreadHistoryItemDto & { kind: 'toolCall' },
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const fullText = item.detailText?.trim() || item.text || 'Tool call';
  deferredDetails.set(item.id, {
    id: item.id,
    kind: item.kind,
    title: DEFERRED_TOOL_DETAIL_TITLE,
    text: fullText,
  });

  return {
    ...item,
    text: summarizeToolCallText(fullText),
    detailText: null,
    hasDeferredDetail: true,
  };
}

function extractToolCallRecords(item: CodexTurnItem) {
  const action = isRecord(item.action) ? item.action : null;
  const result = isRecord(item.result) ? item.result : null;

  return {
    action,
    result,
    input: action && isRecord(action.input) ? action.input : null,
    output: result && isRecord(result.output) ? result.output : null,
  };
}

function valueFromNestedRecords(
  records: Array<Record<string, unknown> | null | undefined>,
  keys: string[],
) {
  for (const record of records) {
    if (!record) {
      continue;
    }

    for (const key of keys) {
      const value = record[key];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
  }

  return null;
}

function formatToolCallHistoryItem(
  item: CodexTurnItem,
  deferredDetails?: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  const { action, result, input, output } = extractToolCallRecords(item);
  const nestedRecords = [item, action, result, input, output];
  const toolName = uniqueStrings([
    stringOrNull(valueFromNestedRecords(nestedRecords, [
      'tool',
      'toolName',
      'tool_name',
      'name',
      'title',
      'functionName',
      'function_name',
    ])),
  ])[0] ?? null;
  const serverName = uniqueStrings([
    stringOrNull(valueFromNestedRecords(nestedRecords, [
      'server',
      'serverName',
      'server_name',
      'mcpServer',
      'mcp_server',
      'namespace',
    ])),
  ])[0] ?? null;
  const status = stringOrNull(item.status) ?? stringOrNull(item.phase) ?? null;
  const summaryLine = serverName && toolName
    ? `${serverName}/${toolName}`
    : toolName ?? serverName ?? stringOrNull(item.text) ?? item.type;

  const detailLines = [summaryLine];
  if (status) {
    detailLines.push(`Status: ${status}`);
  }

  const text = stringOrNull(item.text);
  if (text && text !== summaryLine) {
    detailLines.push('', text);
  }

  const argumentPayload = input ?? action;
  const resultPayload = output ?? result;
  const argumentText = safeJsonStringify(argumentPayload);
  const resultText = safeJsonStringify(resultPayload);

  if (argumentText) {
    detailLines.push('', 'Arguments', argumentText);
  }
  if (resultText) {
    detailLines.push('', 'Result', resultText);
  }

  const historyItem: ThreadHistoryItemDto = {
    id: item.id,
    kind: 'toolCall',
    text: summaryLine,
    previewText: summaryLine,
    detailText: detailLines.join('\n'),
    status,
  };

  if (
    deferredDetails &&
    (Boolean(argumentText) ||
      Boolean(resultText) ||
      (historyItem.detailText?.length ?? 0) > 240)
  ) {
    return deferToolCallHistoryItem(
      historyItem as ThreadHistoryItemDto & { kind: 'toolCall' },
      deferredDetails,
    );
  }

  return historyItem;
}

function deferLargeHistoryItemDetails(
  turn: ThreadTurnDto,
  deferredDetails: Map<string, ThreadHistoryItemDetailDto>,
): ThreadTurnDto {
  return {
    ...turn,
    items: turn.items.map((item) =>
      item.kind === 'commandExecution'
        ? deferCommandHistoryItem(
            item as ThreadHistoryItemDto & { kind: 'commandExecution' },
            deferredDetails,
          )
        : item.kind === 'toolCall'
          ? deferToolCallHistoryItem(
              item as ThreadHistoryItemDto & { kind: 'toolCall' },
              deferredDetails,
            )
        : item,
    ),
  };
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

interface WebSearchSourceRecord {
  title: string | null;
  url: string | null;
  snippet: string | null;
}

function extractWebSearchQueries(item: CodexTurnItem) {
  const action = isRecord(item.action) ? item.action : null;
  const result = isRecord(item.result) ? item.result : null;

  return uniqueStrings([
    stringOrNull(item.query),
    ...stringArray(item.queries),
    action ? stringOrNull(action.query) : null,
    ...(action ? stringArray(action.queries) : []),
    action && isRecord(action.input) ? stringOrNull(action.input.query) : null,
    result ? stringOrNull(result.query) : null,
    ...(result ? stringArray(result.queries) : []),
  ]);
}

function normalizeWebSearchSource(value: unknown): WebSearchSourceRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = stringOrNull(value.title) ?? stringOrNull(value.name);
  const url = stringOrNull(value.url) ?? stringOrNull(value.link);
  const snippet =
    stringOrNull(value.snippet) ??
    stringOrNull(value.description) ??
    stringOrNull(value.text);

  if (!title && !url && !snippet) {
    return null;
  }

  return { title, url, snippet };
}

function extractWebSearchSources(item: CodexTurnItem) {
  const action = isRecord(item.action) ? item.action : null;
  const result = isRecord(item.result) ? item.result : null;

  const candidates: unknown[] = [
    item.sources,
    action?.sources,
    result?.sources,
    result?.results,
    action?.results,
    item.results,
    item.searchResults,
    item.webResults,
  ];

  const sources: WebSearchSourceRecord[] = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) {
      continue;
    }

    for (const entry of candidate) {
      const normalized = normalizeWebSearchSource(entry);
      if (normalized) {
        sources.push(normalized);
      }
    }
  }

  return sources.filter((source, index, allSources) => {
    return (
      index ===
      allSources.findIndex(
        (entry) =>
          entry.title === source.title &&
          entry.url === source.url &&
          entry.snippet === source.snippet,
      )
    );
  });
}

function stringifyPayload(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return null;
  }
}

function extractImageAssetPath(item: CodexTurnItem) {
  const candidates: unknown[] = [
    item.path,
    item.imagePath,
    item.filePath,
    isRecord(item.action) ? item.action.path : null,
    isRecord(item.action) ? item.action.imagePath : null,
    isRecord(item.result) ? item.result.path : null,
    isRecord(item.result) ? item.result.imagePath : null,
  ];

  for (const candidate of candidates) {
    const normalized = stringOrNull(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function formatImageHistoryItem(item: CodexTurnItem): ThreadHistoryItemDto {
  const assetPath = extractImageAssetPath(item);
  const text =
    stringOrNull(item.text) ??
    assetPath ??
    'Image view';

  return {
    id: item.id,
    kind: 'image',
    text,
    previewText: text,
    detailText: assetPath,
    assetPath,
    status: item.status ?? null,
  };
}

function formatWebSearchHistoryItem(item: CodexTurnItem): ThreadHistoryItemDto {
  const queries = extractWebSearchQueries(item);
  const sources = extractWebSearchSources(item);
  const supplementalText = stringOrNull(item.text);
  const previewText =
    queries.length > 0
      ? queries.length <= 2
        ? queries.join('\n')
        : `${queries[0]}\n${queries[1]}\n+${queries.length - 2} more queries`
      : supplementalText ?? 'Web search';

  const detailLines: string[] = [];

  if (queries.length > 0) {
    detailLines.push(queries.length === 1 ? 'Search query' : 'Search queries', '');
    detailLines.push(...queries.map((query) => `- ${query}`), '');
  }

  if (sources.length > 0) {
    detailLines.push('Sources', '');
    for (const source of sources) {
      detailLines.push(`- ${source.title ?? 'Untitled source'}`);
      if (source.url) {
        detailLines.push(`  ${source.url}`);
      }
      if (source.snippet) {
        detailLines.push(`  ${source.snippet}`);
      }
    }
    detailLines.push('');
  }

  if (supplementalText && !queries.includes(supplementalText)) {
    detailLines.push('Additional text', '', supplementalText, '');
  }

  if (sources.length === 0) {
    const rawPayload = stringifyPayload(item);
    if (rawPayload) {
      detailLines.push('Raw payload', '', rawPayload, '');
    }
  }

  return {
    id: item.id,
    kind: 'webSearch',
    text: previewText,
    previewText,
    detailText: detailLines.join('\n').trim() || null,
    status: item.status ?? null,
  };
}

function isRunningItemStatus(status: string | null | undefined) {
  if (!status) {
    return false;
  }

  const normalized = status.toLowerCase();
  return (
    normalized.includes('running') ||
    normalized.includes('inprogress') ||
    normalized.includes('in_progress') ||
    normalized.includes('compacting')
  );
}

function formatContextCompactionHistoryItem(item: CodexTurnItem): ThreadHistoryItemDto {
  const rawText =
    stringOrNull(item.text) ??
    (Array.isArray(item.summary) ? item.summary.filter(Boolean).join('\n') : null);
  const status = stringOrNull(item.status) ?? stringOrNull(item.phase) ?? null;
  const previewText = isRunningItemStatus(status)
    ? 'Compacting context'
    : 'Context compacted';
  const detailText = rawText && rawText !== previewText ? rawText : null;

  return {
    id: item.id,
    kind: 'contextCompaction',
    text: previewText,
    previewText,
    detailText,
    status,
  };
}

function countUnifiedDiffStats(diffText: string) {
  let additions = 0;
  let deletions = 0;

  for (const line of diffText.replace(/\r\n/g, '\n').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
      continue;
    }
    if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function extractPathFromDiffText(diffText: string) {
  for (const line of diffText.replace(/\r\n/g, '\n').split('\n')) {
    if (!line.startsWith('+++ ')) {
      continue;
    }

    const candidate = line.slice(4).trim();
    if (!candidate || candidate === '/dev/null') {
      continue;
    }

    return candidate.replace(/^b\//, '');
  }

  return null;
}

function extractFileChangeEntries(item: CodexTurnItem) {
  const candidateArrays: unknown[] = [
    item.changes,
    item.files,
    isRecord(item.result) ? item.result.changes : null,
    isRecord(item.result) ? item.result.files : null,
    isRecord(item.action) ? item.action.changes : null,
    isRecord(item.action) ? item.action.files : null,
  ];

  const normalizedEntries = new Map<
    string,
    { path: string | null; additions: number; deletions: number }
  >();

  function valueFromRecords(
    records: Array<Record<string, unknown>>,
    keys: string[],
  ) {
    for (const record of records) {
      for (const key of keys) {
        const value = record[key];
        if (value !== undefined && value !== null) {
          return value;
        }
      }
    }

    return null;
  }

  function normalizeEntry(entry: unknown) {
    if (typeof entry === 'string') {
      return {
        path: entry.trim() || null,
        additions: 0,
        deletions: 0,
      };
    }

    if (!isRecord(entry)) {
      return null;
    }

    const nestedRecords = [
      entry,
      isRecord(entry.result) ? entry.result : null,
      isRecord(entry.action) ? entry.action : null,
      isRecord(entry.stats) ? entry.stats : null,
      isRecord(entry.summary) ? entry.summary : null,
      isRecord(entry.diff) ? entry.diff : null,
    ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));

    const path = uniqueStrings([
      stringOrNull(valueFromRecords(nestedRecords, ['path', 'filePath', 'targetPath'])),
      stringOrNull(
        valueFromRecords(nestedRecords, [
          'relativePath',
          'relative_path',
          'filename',
          'file',
          'newPath',
          'new_path',
          'oldPath',
          'old_path',
        ]),
      ),
    ])[0] ?? null;

    const explicitAdditions =
      numberOrNull(
        valueFromRecords(nestedRecords, [
          'additions',
          'added',
          'insertions',
          'linesAdded',
          'lines_added',
          'addedLines',
          'added_lines',
          'numAdded',
          'num_added',
        ]),
      ) ?? 0;
    const explicitDeletions =
      numberOrNull(
        valueFromRecords(nestedRecords, [
          'deletions',
          'removed',
          'deleted',
          'linesRemoved',
          'lines_removed',
          'removedLines',
          'removed_lines',
          'numRemoved',
          'num_removed',
        ]),
      ) ?? 0;
    const diffText = stringOrNull(
      valueFromRecords(nestedRecords, ['diff', 'patch', 'unifiedDiff', 'unified_diff']),
    );
    const diffStats =
      explicitAdditions === 0 && explicitDeletions === 0 && diffText
        ? countUnifiedDiffStats(diffText)
        : null;
    const additions = explicitAdditions || diffStats?.additions || 0;
    const deletions = explicitDeletions || diffStats?.deletions || 0;
    const normalizedPath = path ?? (diffText ? extractPathFromDiffText(diffText) : null);

    if (!normalizedPath && additions === 0 && deletions === 0) {
      return null;
    }

    return {
      path: normalizedPath,
      additions,
      deletions,
    };
  }

  for (const candidateArray of candidateArrays) {
    if (!Array.isArray(candidateArray)) {
      continue;
    }

    for (const entry of candidateArray) {
      const normalized = normalizeEntry(entry);
      if (!normalized) {
        continue;
      }

      const key = normalized.path ?? `unknown:${normalizedEntries.size}`;
      const current = normalizedEntries.get(key);
      if (current) {
        current.additions += normalized.additions;
        current.deletions += normalized.deletions;
        continue;
      }

      normalizedEntries.set(key, normalized);
    }
  }

  return [...normalizedEntries.values()];
}

function formatFileChangeHistoryItem(item: CodexTurnItem): ThreadHistoryItemDto {
  const entries = extractFileChangeEntries(item);
  const fallbackText = stringOrNull(item.text) ?? 'File changes applied.';

  if (entries.length === 0) {
    return {
      id: item.id,
      kind: 'fileChange',
      text: fallbackText,
      previewText: fallbackText,
      status: item.status ?? null,
    };
  }

  const additions = entries.reduce((sum, entry) => sum + entry.additions, 0);
  const deletions = entries.reduce((sum, entry) => sum + entry.deletions, 0);
  const summaryParts = [
    `${entries.length} ${entries.length === 1 ? 'file' : 'files'} changed`,
  ];
  if (additions > 0) {
    summaryParts.push(`+${additions}`);
  }
  if (deletions > 0) {
    summaryParts.push(`-${deletions}`);
  }

  const previewText = summaryParts.join(' · ');
  const fileNames = entries
    .map((entry) => entry.path)
    .filter((entry): entry is string => Boolean(entry));
  const primaryFileName = fileNames[0] ?? previewText;
  const compactPathText =
    fileNames.length === 0
      ? previewText
      : fileNames.length === 1
        ? primaryFileName
        : `${primaryFileName}, +${fileNames.length - 1} more`;
  const detailLines = entries.map((entry) => {
    const counts: string[] = [];
    if (entry.additions > 0) {
      counts.push(`+${entry.additions}`);
    }
    if (entry.deletions > 0) {
      counts.push(`-${entry.deletions}`);
    }
    return `- ${entry.path ?? 'Unknown file'}${counts.length > 0 ? ` (${counts.join(' ')})` : ''}`;
  });

  if (fallbackText !== 'File changes applied.' && fallbackText !== previewText) {
    detailLines.push('', fallbackText);
  }

  return {
    id: item.id,
    kind: 'fileChange',
    text: compactPathText,
    previewText,
    detailText: detailLines.join('\n'),
    status: item.status ?? null,
    changedFiles: entries.length,
    addedLines: additions,
    removedLines: deletions,
  };
}

function itemToHistoryItem(
  item: CodexTurnItem,
  deferredDetails?: Map<string, ThreadHistoryItemDetailDto>,
): ThreadHistoryItemDto {
  switch (item.type) {
    case 'userMessage':
      return {
        id: item.id,
        kind: 'userMessage',
        text: codexItemText(item),
      };
    case 'agentMessage':
      return {
        id: item.id,
        kind: 'agentMessage',
        text: codexItemText(item)
      };
    case 'text':
      return {
        id: item.id,
        kind: 'agentMessage',
        text: codexItemText(item)
      };
    case 'plan':
      return {
        id: item.id,
        kind: 'plan',
        text: codexItemText(item)
      };
    case 'contextCompaction':
    case 'context_compaction':
      return formatContextCompactionHistoryItem(item);
    case 'reasoning':
      return {
        id: item.id,
        kind: 'reasoning',
        text: [item.summary?.join('\n') ?? '', item.text ?? ''].filter(Boolean).join('\n\n')
      };
    case 'commandExecution':
      return deferredDetails
        ? deferCommandHistoryItem(
            {
              id: item.id,
              kind: 'commandExecution',
              text: [item.command ?? '', item.aggregatedOutput ?? '']
                .filter(Boolean)
                .join('\n\n'),
              status: item.status ?? null,
            },
            deferredDetails,
          )
        : {
        id: item.id,
        kind: 'commandExecution',
        text: [item.command ?? '', item.aggregatedOutput ?? ''].filter(Boolean).join('\n\n'),
        status: item.status ?? null
      };
    case 'webSearch':
    case 'web_search':
    case 'webSearchCall':
    case 'web_search_call':
      return formatWebSearchHistoryItem(item);
    case 'imageView':
    case 'image_view':
    case 'viewImage':
    case 'view_image':
      return formatImageHistoryItem(item);
    case 'fileChange':
      return formatFileChangeHistoryItem(item);
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
      return formatToolCallHistoryItem(item, deferredDetails);
    default:
      return {
        id: item.id,
        kind: 'other',
        text: codexItemText(item, item.type)
      };
  }
}

function liveCodexItemToHistoryItem(
  item: CodexTurnItem,
  phase: 'started' | 'completed',
): ThreadHistoryItemDto | null {
  const deferredDetails = new Map<string, ThreadHistoryItemDetailDto>();
  const historyItem = itemToHistoryItem(item, deferredDetails);

  if (
    historyItem.kind !== 'commandExecution' &&
    historyItem.kind !== 'toolCall'
  ) {
    return null;
  }

  return {
    ...historyItem,
    status:
      historyItem.status ??
      (phase === 'started' ? 'running' : 'completed'),
  };
}

function normalizeOptionLabelForApproval(value: string) {
  return value.replace(/\s*\(recommended\)\s*$/i, '').trim().toLowerCase();
}

function isAllowOptionLabel(value: string) {
  const normalized = normalizeOptionLabelForApproval(value);
  return /^(allow|approve|yes|continue|proceed|trust)\b/.test(normalized);
}

function isDenyOptionLabel(value: string) {
  const normalized = normalizeOptionLabelForApproval(value);
  return /^(deny|reject|block|cancel|no|abort|disallow|don't allow|do not allow)\b/.test(
    normalized,
  );
}

function isLikelyPositiveApprovalOption(value: string) {
  const normalized = normalizeOptionLabelForApproval(value);
  return (
    isAllowOptionLabel(value) ||
    /^(yes|continue|proceed|trust|always|once|ok)\b/.test(normalized)
  );
}

function isLikelyApprovalPrompt(
  requestMethod: string,
  questions: Array<{
    header: string;
    question: string;
    options: Array<{ label: string; description: string }> | null;
  }>,
) {
  const methodText = requestMethod.toLowerCase();
  if (
    methodText.includes('approval') ||
    methodText.includes('authorize') ||
    methodText.includes('requestuserinput')
  ) {
    return true;
  }

  const combinedText = questions
    .flatMap((question) => [
      question.header,
      question.question,
      ...(question.options?.map((option) => option.label) ?? []),
    ])
    .join(' ')
    .toLowerCase();

  return /(allow|approve|permission|authorize|authorization|auth|mcp|tool)/.test(
    combinedText,
  );
}

function buildAutoApprovedAnswersForServerQuestions(
  requestMethod: string,
  questions: Array<{
    id: string;
    header: string;
    question: string;
    isOther: boolean;
    isSecret: boolean;
    options: Array<{ label: string; description: string }> | null;
  }>,
) {
  if (!isLikelyApprovalPrompt(requestMethod, questions)) {
    return null;
  }

  const answers: Record<string, { answers: string[] }> = {};

  for (const question of questions) {
    if (!question.options || question.options.length === 0) {
      return null;
    }

    const recommendedOption = question.options.find((option) =>
      /\(recommended\)\s*$/i.test(option.label),
    );
    const allowOption =
      recommendedOption && isLikelyPositiveApprovalOption(recommendedOption.label)
        ? recommendedOption
        : question.options.find((option) =>
            isLikelyPositiveApprovalOption(option.label),
          );

    if (!allowOption) {
      return null;
    }

    answers[question.id] = {
      answers: [allowOption.label],
    };
  }

  return answers;
}

function isMcpElicitationRequest(
  request: CodexServerRequest,
): request is CodexServerRequest & {
  params: {
    threadId: string;
    turnId?: string;
    serverName?: string;
    mode?: string;
    message?: string;
    requestedSchema?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
  };
} {
  return request.method === 'mcpServer/elicitation/request';
}

function buildAutoApprovedMcpElicitationResult(
  request: CodexServerRequest,
) {
  if (!isMcpElicitationRequest(request)) {
    return null;
  }

  return {
    action: 'accept',
    content: {},
  } as const;
}

function buildThreadRequestFromMcpElicitation(
  request: CodexServerRequest & {
    params: {
      threadId: string;
      turnId?: string;
      serverName?: string;
      mode?: string;
      message?: string;
      requestedSchema?: Record<string, unknown>;
      _meta?: Record<string, unknown>;
    };
  },
): ThreadActionRequestDto {
  const meta = isRecord(request.params._meta) ? request.params._meta : null;
  const toolTitle = stringOrNull(meta?.tool_title);
  const toolDescription = stringOrNull(meta?.tool_description);
  const serverName = stringOrNull(request.params.serverName) ?? 'MCP';
  const message =
    stringOrNull(request.params.message) ??
    `Allow the ${serverName} MCP server to continue?`;

  return {
    id: String(request.id),
    kind: 'requestUserInput',
    title: toolTitle ?? `${serverName} MCP`,
    description: toolDescription ?? message,
    turnId: request.params.turnId ?? null,
    itemId: null,
    createdAt: new Date().toISOString(),
    questions: [
      {
        id: 'decision',
        header: toolTitle ?? `${serverName} MCP`,
        question: message,
        isOther: false,
        isSecret: false,
        options: [
          {
            label: 'Allow',
            description: 'Permit this MCP tool call.',
          },
          {
            label: 'Deny',
            description: 'Reject this MCP tool call.',
          },
        ],
      },
    ],
  };
}

function turnToDto(
  turn: CodexTurnRecord,
  deferredDetails?: Map<string, ThreadHistoryItemDetailDto>,
): ThreadTurnDto {
  return {
    id: turn.id,
    startedAt: parseUuidV7Timestamp(turn.id),
    status: turn.status,
    error: turn.error?.message ?? null,
    items: turn.items.map((item) => itemToHistoryItem(item, deferredDetails))
  };
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

export class ThreadService {
  private readonly pendingRequests = new Map<string, Map<string, PendingThreadRequestRecord>>();
  private readonly dismissedPlanDecisionTurns = new Map<string, string>();
  private readonly threadDetailCache = new Map<string, ThreadDetailCacheEntry>();
  private readonly threadContextUsage = new Map<string, ThreadContextUsageDto>();
  private readonly threadCumulativeTokenUsage = new Map<string, ThreadTurnTokenUsageBreakdown>();
  private readonly threadLivePlans = new Map<string, ThreadLivePlanDto>();
  private readonly threadLiveItems = new Map<string, ThreadLiveItemsDto>();
  private readonly answeredRequestNotes = new Map<string, ThreadAnsweredRequestNoteDto[]>();

  constructor(
    private readonly db: DatabaseClient,
    private readonly codexManager: CodexAppServerManager,
    private readonly eventBus: SupervisorEventBus,
    private readonly localSessionStore: LocalCodexSessionStore,
    private readonly workspaceRoot: string,
    private readonly codexHome: string,
  ) {
    this.codexManager.on('notification', (event) => {
      void this.handleNotification(event as CodexServerEvent);
    });
    this.codexManager.on('request', (request) => {
      void this.handleServerRequest(request as CodexServerRequest);
    });
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

  private async buildThreadDetailCacheEntry(
    localThreadId: string,
    record: { id: string; codexThreadId: string | null; collaborationMode: string | null; model: string | null; reasoningEffort: string | null; },
    turnMetadataById: Map<string, ThreadTurnMetadataRecord>,
  ): Promise<ThreadDetailCacheEntry> {
    const cached = this.getThreadDetailCache(localThreadId);
    if (cached) {
      return cached;
    }

    let remoteThread: CodexThreadRecord | null = null;
    try {
      remoteThread = await this.codexManager.readThread(record.codexThreadId!);
    } catch (error) {
      if (!isRemoteThreadBootstrapError(error)) {
        throw error;
      }
    }

    if (!remoteThread) {
      const localSession = await this.localSessionStore.findSession(record.codexThreadId!);
      const deferredDetails = new Map<string, ThreadHistoryItemDetailDto>();
      const turns = (localSession?.turns ?? []).map((turn) =>
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
      remoteThread.turns.length > 0 &&
      remoteThread.turns.every((turn) => turn.items.length === 0)
    ) {
      remoteThread = (
        await this.codexManager.resumeThread({
          threadId: record.codexThreadId!,
        })
      ).thread;
    }

    updateThreadRecord(
      this.db,
      record.id,
      this.buildThreadPatch(remoteThread, record.model, record.reasoningEffort),
    );

    const updated = getThreadRecordById(this.db, record.id)!;
    this.syncPendingPlanDecisionRequest(
      updated.id,
      updated.collaborationMode,
      remoteThread,
    );
    this.reconcilePendingSteers(updated.id, remoteThread);

    const deferredDetails = new Map<string, ThreadHistoryItemDetailDto>();
    const turns = remoteThread.turns.map((turn) =>
      buildTurnDto(turnToDto(turn, deferredDetails), turnMetadataById.get(turn.id)),
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
    const models = await this.codexManager.listModels();
    return models.map((model) => ({
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      description: model.description,
      isDefault: model.isDefault,
      hidden: model.hidden,
      supportedReasoningEfforts: model.supportedReasoningEfforts.map((entry) => ({
        reasoningEffort: entry.reasoningEffort,
        description: entry.description
      })),
      defaultReasoningEffort: model.defaultReasoningEffort
    }));
  }

  async listThreads(): Promise<ThreadDto[]> {
    let loadedIds = new Set<string>();
    try {
      loadedIds = new Set(await this.codexManager.listLoadedThreads());
      const remoteThreads = await this.codexManager.listThreads();
      for (const remoteThread of remoteThreads) {
        const local = getThreadRecordByCodexThreadId(this.db, remoteThread.id);
        if (!local) {
          continue;
        }

        updateThreadRecord(
          this.db,
          local.id,
          this.buildThreadPatch(remoteThread, local.model, local.reasoningEffort)
        );
      }
    } catch {
      // Keep local state if codex is unavailable.
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

    const normalizedTitle = input.title?.trim() || DEFAULT_THREAD_TITLE;
    const modelRecords = await this.codexManager.listModels().catch(() => []);
    const matchedModel = modelRecords.find((entry) => entry.model === input.model);
    const reasoningEffort =
      normalizeReasoningEffort(matchedModel?.defaultReasoningEffort) ?? 'medium';
    const sandboxMode = defaultSandboxModeForApprovalMode(input.approvalMode);
    const fastMode = readCodexFastModeSync(this.codexHome);
    ensureFastModeSupported(input.model, fastMode);
    const response = await this.codexManager.startThread({
      cwd: workspace.absPath,
      model: input.model,
      approvalPolicy: approvalModeToPolicy(input.approvalMode),
      sandbox: sandboxMode,
      serviceTier: serviceTierForFastMode(fastMode),
    });

    const created = createThreadRecord(this.db, {
      workspaceId: workspace.id,
      title: normalizedTitle,
      model: input.model,
      reasoningEffort,
      collaborationMode: 'default',
      approvalMode: input.approvalMode,
      sandboxMode: normalizeSandboxMode(response.sandbox) ?? sandboxMode,
      codexThreadId: response.thread.id,
      summaryText: response.thread.preview,
      fastMode,
      source: 'supervisor',
      isConnected: true,
    });

    updateThreadRecord(this.db, created.id, {
      ...this.buildThreadPatch(
        response.thread,
        input.model,
        response.reasoningEffort ?? reasoningEffort
      ),
      title:
        normalizedTitle === DEFAULT_THREAD_TITLE &&
        response.thread.name &&
        response.thread.name.trim() !== GENERIC_REMOTE_THREAD_TITLE
          ? truncateAutoThreadTitle(response.thread.name)
          : normalizedTitle
    });

    const record = getThreadRecordById(this.db, created.id)!;
    return this.toThreadDto(record, new Set([response.thread.id]));
  }

  async importThread(sessionId: ImportThreadInput['sessionId']): Promise<ThreadDetailDto> {
    const normalizedSessionId = sessionId.trim();
    if (!normalizedSessionId) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Session id is required.'
      });
    }

    const existingThread = getThreadRecordByCodexThreadId(this.db, normalizedSessionId);
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
      title: truncateAutoThreadTitle(
        localSession.title?.trim() || 'Untitled imported session'
      ),
      model: localSession.model,
      reasoningEffort: null,
      collaborationMode: 'default',
      approvalMode: 'yolo',
      sandboxMode: defaultSandboxModeForApprovalMode('yolo'),
      codexThreadId: normalizedSessionId,
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

    if (!record.codexThreadId) {
      throw new HttpError(503, {
        code: 'service_unavailable',
        message: 'Thread is missing its Codex session identifier.'
      });
    }

    const loadedIds = new Set(await this.codexManager.listLoadedThreads().catch(() => []));
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
      livePlan: this.getLivePlan(updated.id),
      liveItems,
    };
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

    if (!record.codexThreadId) {
      throw new HttpError(503, {
        code: 'service_unavailable',
        message: 'Thread is missing its Codex session identifier.',
      });
    }

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
    if (!record || !record.codexThreadId) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    let response;
    const sandboxMode =
      input.sandboxMode ??
      normalizeSandboxMode(record.sandboxMode) ??
      defaultSandboxModeForApprovalMode((record.approvalMode ?? 'yolo') as ApprovalMode);
    try {
      ensureFastModeSupported(
        input.model ?? record.model ?? null,
        normalizeFastMode(record.fastMode),
      );
      response = await this.codexManager.resumeThread({
        threadId: record.codexThreadId,
        model: input.model ?? record.model ?? null,
        sandbox: sandboxMode,
        serviceTier: serviceTierForFastMode(normalizeFastMode(record.fastMode)),
      });
    } catch (error) {
      if (!isRemoteThreadBootstrapError(error)) {
        throw error;
      }

      return this.getThreadDetail(localThreadId);
    }

    const modelRecords = await this.codexManager.listModels().catch(() => []);
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
        response.thread,
        effectiveModel,
        resumedReasoning
      ),
    );
    updateThreadRecord(this.db, record.id, {
      sandboxMode: normalizeSandboxMode(response.sandbox) ?? sandboxMode,
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
    if (!record || !record.codexThreadId) {
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
    if (!record || !record.codexThreadId) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    if (record.source === 'local_codex_import') {
      const loadedIds = new Set(await this.codexManager.listLoadedThreads().catch(() => []));
      if (!loadedIds.has(record.codexThreadId)) {
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

    const modelRecords = await this.codexManager.listModels().catch(() => []);
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
    ensureFastModeSupported(effectiveModel, normalizeFastMode(record.fastMode));
    const serviceTier = serviceTierForFastMode(normalizeFastMode(record.fastMode));
    const connectedRecord = {
      ...record,
      codexThreadId: record.codexThreadId,
    };

    if (record.codexTurnId && record.status === 'running') {
      return this.steerOrStartPromptTurn(localThreadId, {
        ...connectedRecord,
        codexTurnId: record.codexTurnId,
      }, {
        prompt,
        displayPrompt,
        clientRequestId: input.clientRequestId ?? null,
        effectiveModel,
        normalizedReasoning,
        collaborationMode,
        sandboxMode,
        serviceTier,
        workspacePath: workspace.absPath,
      });
    }

    return this.startPromptTurn(localThreadId, connectedRecord, {
      prompt,
      effectiveModel,
      normalizedReasoning,
      collaborationMode,
      sandboxMode,
      serviceTier,
      workspacePath: workspace.absPath,
    });
  }

  private async startPromptTurn(
    localThreadId: string,
    record: { id: string; codexThreadId: string; title: string; },
    input: {
      prompt: string;
      effectiveModel: string | null;
      normalizedReasoning: ReasoningEffortDto | null;
      collaborationMode: CollaborationModeDto;
      sandboxMode: SandboxModeDto;
      serviceTier: 'fast' | null;
      workspacePath: string;
    },
  ): Promise<ThreadDto> {
    const modelRecords = await this.codexManager.listModels().catch(() => []);
    ensureFastModeSupported(input.effectiveModel, input.serviceTier === 'fast');
    const pricingSnapshot = buildTurnPricingSnapshot(
      input.effectiveModel,
      input.serviceTier === 'fast',
    );
    const turn = await this.codexManager.startTurn({
      threadId: record.codexThreadId,
      prompt: input.prompt,
      model: input.effectiveModel,
      serviceTier: input.serviceTier,
      effort: input.normalizedReasoning,
      collaborationMode: input.collaborationMode,
      sandboxPolicy: buildTurnSandboxPolicy(input.sandboxMode, input.workspacePath),
    });
    upsertThreadTurnMetadata(this.db, {
      threadId: localThreadId,
      turnId: turn.id,
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
      codexTurnId: turn.id,
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

    return this.toThreadDto(updated, new Set([record.codexThreadId]));
  }

  private async steerOrStartPromptTurn(
    localThreadId: string,
    record: {
      id: string;
      codexThreadId: string;
      codexTurnId: string;
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
      serviceTier: 'fast' | null;
      workspacePath: string;
    },
  ): Promise<ThreadDto> {
    let steerTurnId = record.codexTurnId;
    let retriedAfterTurnMismatch = false;

    while (steerTurnId) {
      try {
        await this.codexManager.steerTurn({
          threadId: record.codexThreadId!,
          turnId: steerTurnId,
          prompt: input.prompt,
        });

        updateThreadRecord(this.db, localThreadId, {
          codexTurnId: steerTurnId,
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
        return this.toThreadDto(updated, new Set([record.codexThreadId!]));
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
            codexTurnId: steerTurnId,
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
      serviceTier: input.serviceTier,
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

    const modelRecords = await this.codexManager.listModels().catch(() => []);
    const fallbackModel = modelRecords.find((entry) => entry.isDefault) ?? modelRecords[0] ?? null;
    const currentFastMode = normalizeFastMode(record.fastMode);
    const requestedFastMode =
      input.fastMode !== undefined ? input.fastMode : currentFastMode;
    const currentModel = record.model ?? fallbackModel?.model ?? null;
    const currentReasoning = normalizeReasoningEffort(record.reasoningEffort);
    let nextModel = input.model ?? currentModel;
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

    if (currentFastMode !== nextFastMode) {
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
    const loadedIds = new Set(await this.codexManager.listLoadedThreads().catch(() => []));
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
    const loadedIds = new Set(await this.codexManager.listLoadedThreads().catch(() => []));

    this.emitThreadEvent('thread.updated', updated.id, {
      title: updated.title
    });

    return this.toThreadDto(updated, loadedIds);
  }

  async compactThread(localThreadId: string): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record || !record.codexThreadId) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    if (record.isConnected === false) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Connect this thread before compacting its context.',
      });
    }

    const loadedIds = new Set(await this.codexManager.listLoadedThreads().catch(() => []));
    if (!loadedIds.has(record.codexThreadId)) {
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

    await this.codexManager.compactThread(record.codexThreadId);

    const updated = getThreadRecordById(this.db, localThreadId)!;
    const refreshedLoadedIds = new Set(await this.codexManager.listLoadedThreads().catch(() => []));
    return this.toThreadDto(updated, refreshedLoadedIds);
  }

  async listForkTurnOptions(localThreadId: string): Promise<ThreadForkTurnOptionDto[]> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record || !record.codexThreadId) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

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
    if (!record || !record.codexThreadId) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

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

    const forkedThread = await this.codexManager.forkThread({
      threadId: record.codexThreadId,
    });
    const turnsToRollback =
      selectedTurn == null ? 0 : Math.max(0, turnOptions.length - selectedTurn.turnIndex);
    if (turnsToRollback > 0) {
      await this.codexManager.rollbackThread({
        threadId: forkedThread.id,
        count: turnsToRollback,
      });
    }

    const forkTitleBase = record.title.trim() || DEFAULT_THREAD_TITLE;
    const created = createThreadRecord(this.db, {
      workspaceId: record.workspaceId,
      title: `${forkTitleBase} / fork`,
      model: record.model,
      reasoningEffort: record.reasoningEffort,
      fastMode: normalizeFastMode(record.fastMode),
      fastBaseModel: record.fastBaseModel,
      fastBaseReasoningEffort: record.fastBaseReasoningEffort,
      collaborationMode: normalizeCollaborationMode(record.collaborationMode),
      approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
      sandboxMode: normalizeSandboxMode(record.sandboxMode),
      codexThreadId: forkedThread.id,
      summaryText: forkedThread.preview,
      source: 'supervisor',
      isConnected: true,
    });

    updateThreadRecord(this.db, created.id, {
      ...this.buildThreadPatch(
        forkedThread,
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

    const [entry] = await this.codexManager.listSkills({
      cwds: [workspace.absPath],
      forceReload: true,
    });

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
        scope: skill.scope,
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

    return {
      servers: (await this.codexManager.listMcpServers()).map((server) => ({
        name: server.name,
        authStatus: server.authStatus,
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

  async interruptThread(localThreadId: string, requestedTurnId?: string): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record || !record.codexThreadId) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const turnId = requestedTurnId ?? record.codexTurnId;
    if (!turnId) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'There is no active turn to interrupt.'
      });
    }

    const interruptedTurn = await this.codexManager.interruptTurn(record.codexThreadId, turnId);

    updateThreadRecord(this.db, localThreadId, {
      codexTurnId: null,
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
    this.answeredRequestNotes.delete(localThreadId);
    deleteViewerSessionsByThreadId(this.db, localThreadId);
    deleteNotificationsByThreadId(this.db, localThreadId);
    deleteThreadForkRecordsBySourceThreadId(this.db, localThreadId);
    deleteThreadForkRecordsByForkedThreadId(this.db, localThreadId);
    deleteThreadActivityNotesByThreadId(this.db, localThreadId);
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
      const selectedAnswer = Object.values(input.answers)[0]?.answers[0]?.trim().toLowerCase();
      const result =
        pending.responseKind === 'mcpElicitation'
          ? {
              action:
                selectedAnswer && /^(deny|reject|block|cancel|no|abort)\b/.test(selectedAnswer)
                  ? 'decline'
                  : 'accept',
              content: {},
            }
          : {
              answers: input.answers,
            };
      this.codexManager.respondToServerRequest(pending.serverRequestId, result);
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
        if (record.source === 'local_codex_import' && record.codexThreadId) {
          const loadedIds = new Set(await this.codexManager.listLoadedThreads().catch(() => []));
          if (!loadedIds.has(record.codexThreadId)) {
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

  private async handleNotification(event: CodexServerEvent) {
    switch (event.method) {
      case 'thread/status/changed': {
        const params = event.params as { threadId: string; status: CodexThreadRecord['status'] };
        const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
        if (!record) {
          return;
        }

        updateThreadRecord(this.db, record.id, {
          status: normalizeThreadStatus({
            id: record.codexThreadId ?? '',
            preview: record.summaryText ?? '',
            createdAt: Math.floor(new Date(record.createdAt).getTime() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            status: params.status,
            cwd: '',
            name: record.title,
            turns: []
          })
        });

        this.emitThreadEvent('thread.updated', record.id, {
          status: getThreadRecordById(this.db, record.id)?.status ?? record.status
        });
        return;
      }
      case 'thread/name/updated': {
        const params = event.params as { threadId: string; threadName?: string };
        const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
        if (!record || !params.threadName) {
          return;
        }

        if (isAutoGeneratedTitle(record.title)) {
          updateThreadRecord(this.db, record.id, {
            title: truncateAutoThreadTitle(params.threadName)
          });
        }

        this.emitThreadEvent('thread.updated', record.id, {
          title: getThreadRecordById(this.db, record.id)?.title ?? record.title
        });
        return;
      }
      case 'thread/tokenUsage/updated': {
        const params = event.params as {
          threadId: string;
          turnId: string;
          tokenUsage?: ThreadContextTokenUsagePayload | null;
        };
        const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
        if (!record) {
          return;
        }

        const usage = buildThreadContextUsageFromPayload(
          params.tokenUsage,
          record.model,
        );
        this.setThreadContextUsage(record.id, usage, true);
        const existingTurnMetadata = getThreadTurnMetadataByThreadAndTurnId(
          this.db,
          record.id,
          params.turnId,
        );
        const previousState = parseStoredThreadTurnTokenUsageState(
          existingTurnMetadata?.tokenUsageJson,
        );
        const previousCumulativeTotal = this.threadCumulativeTokenUsage.get(record.id);
        const currentCumulativeTotal = buildTurnTokenBreakdown(
          isRecord(params.tokenUsage?.total) ? params.tokenUsage.total : null,
        );
        if (currentCumulativeTotal) {
          this.threadCumulativeTokenUsage.set(record.id, currentCumulativeTotal);
        }
        const baselineTotal =
          previousState.baselineTotal ??
          previousCumulativeTotal ??
          this.getLatestStoredThreadCumulativeTotal(record.id, {
            excludeTurnId: params.turnId,
          }) ??
          zeroTurnTokenBreakdown();
        const turnTokenUsage = buildThreadTurnTokenUsage(
          params.tokenUsage,
          baselineTotal,
          previousState.usage,
        );
        if (turnTokenUsage) {
          upsertThreadTurnMetadata(this.db, {
            threadId: record.id,
            turnId: params.turnId,
            tokenUsageJson: stringifyStoredThreadTurnTokenUsageState({
              baselineTotal,
              usage: turnTokenUsage,
            }),
          });
          this.invalidateThreadDetailCache(record.id);
          this.emitThreadEvent('thread.turn.token.updated', record.id, {
            turnId: params.turnId,
            tokenUsage: turnTokenUsage,
            priceEstimate: estimateTurnPrice(turnTokenUsage, {
              pricingModelKey: existingTurnMetadata?.pricingModelKey,
              pricingTierKey: normalizePricingTier(existingTurnMetadata?.pricingTierKey),
            }),
          });
        }
        return;
      }
      case 'turn/started': {
        const params = event.params as { threadId: string; turn: CodexTurnRecord };
        const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
        if (!record) {
          return;
        }

        this.clearPendingPlanDecisionRequests(record.id, true);
        this.dismissedPlanDecisionTurns.delete(record.id);

        updateThreadRecord(this.db, record.id, {
          codexTurnId: params.turn.id,
          status: 'running',
          lastError: null,
          lastTurnStartedAt: new Date().toISOString()
        });
        this.setLivePlan(record.id, null);
        this.setLiveItems(record.id, null);
        this.resetThreadContextUsage(record.id, true);
        upsertThreadTurnMetadata(this.db, {
          threadId: record.id,
          turnId: params.turn.id,
          tokenUsageJson: stringifyStoredThreadTurnTokenUsageState({
            baselineTotal:
              this.threadCumulativeTokenUsage.get(record.id) ??
              this.getLatestStoredThreadCumulativeTotal(record.id, {
                excludeTurnId: params.turn.id,
              }) ??
              zeroTurnTokenBreakdown(),
            usage: null,
          }),
        });
        this.invalidateThreadDetailCache(record.id);

        this.emitThreadEvent('thread.turn.started', record.id, {
          turnId: params.turn.id
        });
        return;
      }
      case 'item/started':
      case 'item/completed': {
        const params = event.params as {
          threadId: string;
          turnId: string;
          item?: CodexTurnItem;
        };
        const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
        if (!record || !params.item) {
          return;
        }

        const liveItem = liveCodexItemToHistoryItem(
          params.item,
          event.method === 'item/started' ? 'started' : 'completed',
        );
        if (!liveItem) {
          return;
        }

        this.upsertLiveItem(record.id, params.turnId, liveItem);
        this.emitThreadEvent(
          event.method === 'item/started'
            ? 'thread.item.started'
            : 'thread.item.completed',
          record.id,
          {
            turnId: params.turnId,
            item: liveItem,
          },
        );
        return;
      }
      case 'turn/plan/updated': {
        const params = event.params as {
          threadId: string;
          turnId: string;
          explanation: string | null;
          plan: Array<{ step: string; status: string }>;
        };
        const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
        if (!record) {
          return;
        }

        this.setLivePlan(record.id, {
          turnId: params.turnId,
          explanation: params.explanation,
          plan: params.plan,
          updatedAt: new Date().toISOString(),
        });

        this.emitThreadEvent('thread.plan.updated', record.id, {
          turnId: params.turnId,
          explanation: params.explanation,
          plan: params.plan
        });
        return;
      }
      case 'item/agentMessage/delta': {
        const params = event.params as {
          threadId: string;
          turnId: string;
          itemId: string;
          delta: string;
        };
        const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
        if (!record) {
          return;
        }

        this.emitThreadEvent('thread.output.delta', record.id, {
          turnId: params.turnId,
          itemId: params.itemId,
          delta: params.delta
        });
        return;
      }
      case 'turn/completed': {
        const params = event.params as { threadId: string; turn: CodexTurnRecord };
        const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
        if (!record) {
          return;
        }

        updateThreadRecord(this.db, record.id, {
          codexTurnId: null,
          status:
            params.turn.status === 'failed'
              ? 'failed'
              : params.turn.status === 'interrupted'
                ? 'interrupted'
                : 'idle',
          lastError: params.turn.error?.message ?? null,
          lastTurnCompletedAt: new Date().toISOString()
        });
        this.setLivePlan(record.id, null);
        this.setLiveItems(record.id, null);
        this.clearPendingSteersForTurn(record.id, params.turn.id);
        this.pendingRequests.delete(record.id);
        if (
          params.turn.status === 'completed' &&
          normalizeCollaborationMode(record.collaborationMode) === 'plan' &&
          params.turn.items.some((item) => item.type === 'plan')
        ) {
          this.createPendingPlanDecisionRequest(record.id, params.turn.id, true);
        } else {
          this.dismissedPlanDecisionTurns.delete(record.id);
        }
        this.invalidateThreadDetailCache(record.id);

        this.emitThreadEvent(
          params.turn.status === 'failed' ? 'thread.turn.failed' : 'thread.turn.completed',
          record.id,
          {
            turnId: params.turn.id,
            status: params.turn.status,
            error: params.turn.error?.message ?? null
          }
        );
        return;
      }
      case 'error': {
        const params = event.params as {
          threadId: string;
          turnId: string;
          error: { message?: string };
          willRetry: boolean;
        };
        const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
        if (!record) {
          return;
        }

        updateThreadRecord(this.db, record.id, {
          status: 'failed',
          lastError: params.error.message ?? 'Turn failed unexpectedly.'
        });
        this.setLivePlan(record.id, null);
        this.setLiveItems(record.id, null);
        this.clearPendingSteersForTurn(record.id, params.turnId);
        this.pendingRequests.delete(record.id);
        this.dismissedPlanDecisionTurns.delete(record.id);
        this.invalidateThreadDetailCache(record.id);

        this.emitThreadEvent('thread.turn.failed', record.id, {
          turnId: params.turnId,
          error: params.error.message ?? 'Turn failed unexpectedly.',
          willRetry: params.willRetry
        });
      }
    }
  }

  private async handleServerRequest(request: CodexServerRequest) {
    if (isMcpElicitationRequest(request)) {
      const record = getThreadRecordByCodexThreadId(this.db, request.params.threadId);
      if (!record) {
        return;
      }

      const approvalMode = (record.approvalMode ?? 'yolo') as ApprovalMode;
      const autoApprovedResult =
        approvalMode === 'yolo'
          ? buildAutoApprovedMcpElicitationResult(request)
          : null;
      if (autoApprovedResult) {
        this.codexManager.respondToServerRequest(request.id, autoApprovedResult);
        return;
      }

      const threadRequest = buildThreadRequestFromMcpElicitation(request);
      let threadRequests = this.pendingRequests.get(record.id);
      if (!threadRequests) {
        threadRequests = new Map();
        this.pendingRequests.set(record.id, threadRequests);
      }
      threadRequests.set(threadRequest.id, {
        source: 'server',
        serverRequestId: request.id,
        responseKind: 'mcpElicitation',
        request: threadRequest,
      });

      this.emitThreadEvent('thread.request.created', record.id, {
        request: threadRequest,
      });
      return;
    }

    const params = request.params as {
      threadId?: string;
      turnId?: string;
      itemId?: string;
      questions?: Array<{
        id: string;
        header: string;
        question: string;
        isOther: boolean;
        isSecret: boolean;
        options: Array<{ label: string; description: string }> | null;
      }>;
    };

    if (!params.threadId || !Array.isArray(params.questions)) {
      return;
    }

    const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
    if (!record) {
      return;
    }

    const questions: ThreadActionQuestionDto[] = params.questions.map((question) => ({
      id: question.id,
      header: question.header,
      question: question.question,
      isOther: question.isOther,
      isSecret: question.isSecret,
      options: question.options?.map((option) => ({
        label: option.label,
        description: option.description
      })) ?? null
    }));

    const approvalMode = (record.approvalMode ?? 'yolo') as ApprovalMode;
    const autoApprovedAnswers =
      approvalMode === 'yolo'
        ? buildAutoApprovedAnswersForServerQuestions(
            request.method,
            params.questions,
          )
        : null;
    if (autoApprovedAnswers) {
      this.codexManager.respondToServerRequest(request.id, {
        answers: autoApprovedAnswers,
      });
      return;
    }

    const threadRequest: ThreadActionRequestDto = {
      id: String(request.id),
      kind: 'requestUserInput',
      title: questions[0]?.header || 'User input required',
      description: questions[0]?.question ?? null,
      turnId: params.turnId ?? null,
      itemId: params.itemId ?? null,
      createdAt: new Date().toISOString(),
      questions
    };

    let threadRequests = this.pendingRequests.get(record.id);
    if (!threadRequests) {
      threadRequests = new Map();
      this.pendingRequests.set(record.id, threadRequests);
    }
    threadRequests.set(threadRequest.id, {
      source: 'server',
      serverRequestId: request.id,
      responseKind: 'answers',
      request: threadRequest
    });

    this.emitThreadEvent('thread.request.created', record.id, {
      request: threadRequest
    });
  }

  private buildThreadPatch(
    remoteThread: CodexThreadRecord,
    model: string | null | undefined,
    reasoningEffort: string | null | undefined
  ) {
    return {
      codexThreadId: remoteThread.id,
      status: normalizeThreadStatus(remoteThread),
      summaryText: remoteThread.preview || null,
      model: model ?? null,
      reasoningEffort: normalizeReasoningEffort(reasoningEffort),
      lastError:
        remoteThread.turns.find((turn) => turn.status === 'failed')?.error?.message ?? null,
      updatedAt: toIsoFromUnix(remoteThread.updatedAt)
    };
  }

  private toThreadDto(record: any, loadedIds: Set<string>): ThreadDto {
    return {
      id: record.id,
      workspaceId: record.workspaceId,
      codexThreadId: record.codexThreadId ?? null,
      source: (record.source ?? 'supervisor') as ThreadSourceDto,
      title: record.title,
      model: record.model ?? null,
      reasoningEffort: normalizeReasoningEffort(record.reasoningEffort),
      fastMode: normalizeFastMode(record.fastMode),
      collaborationMode: normalizeCollaborationMode(record.collaborationMode),
      approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
      sandboxMode:
        normalizeSandboxMode(record.sandboxMode) ??
        defaultSandboxModeForApprovalMode((record.approvalMode ?? 'yolo') as ApprovalMode),
      status: (record.status ?? 'idle') as ThreadStatusDto,
      summaryText: record.summaryText ?? null,
      lastError: record.lastError ?? null,
      activeTurnId: record.codexTurnId ?? null,
      isLoaded:
        record.isConnected !== false &&
        (record.codexThreadId ? loadedIds.has(record.codexThreadId) : false),
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
      items: nextItems,
      updatedAt: new Date().toISOString(),
    });
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
    const notes: ThreadActivityNoteDto[] = listThreadActivityNotesByThreadId(
      this.db,
      localThreadId,
    ).map((record) => ({
      id: record.id,
      kind: 'fastMode',
      text: record.text,
      createdAt: record.createdAt,
      anchorTurnId: null,
    }));

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
    createThreadActivityNoteRecord(this.db, {
      threadId: localThreadId,
      kind: input.kind,
      text: input.text,
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

  private reconcilePendingSteers(localThreadId: string, remoteThread: CodexThreadRecord) {
    const records = listThreadPendingSteerRecordsByThreadId(this.db, localThreadId);
    if (records.length === 0) {
      return;
    }

    const turnsById = new Map(remoteThread.turns.map((turn) => [turn.id, turn]));
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
    remoteThread: CodexThreadRecord
  ) {
    const latestTurn = remoteThread.turns.at(-1) ?? null;
    const shouldHavePlanDecision =
      normalizeCollaborationMode(collaborationMode) === 'plan' &&
      latestTurn?.status === 'completed' &&
      latestTurn.items.some((item) => item.type === 'plan');

    if (!shouldHavePlanDecision || !latestTurn) {
      this.clearPendingPlanDecisionRequests(localThreadId, false);
      this.dismissedPlanDecisionTurns.delete(localThreadId);
      return;
    }

    const expectedRequestId = `${LOCAL_PLAN_DECISION_PREFIX}${latestTurn.id}`;
    const existingRequest = this.pendingRequests.get(localThreadId)?.get(expectedRequestId);
    if (existingRequest?.source === 'planDecision') {
      return;
    }

    this.createPendingPlanDecisionRequest(localThreadId, latestTurn.id, false);
  }

  private normalizeReasoningForModel(
    modelRecords: Array<{
      model: string;
      defaultReasoningEffort: string;
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
