import fs from 'node:fs/promises';
import path from 'node:path';

import {
  CodexAppServerManager,
  CodexServerRequest,
  CodexServerEvent,
  CodexThreadRecord,
  CodexTurnItem,
  CodexTurnRecord,
  JsonRpcClientError
} from '../../../../packages/codex/src/index';
import {
  createThreadRecord,
  createWorkspaceRecord,
  DatabaseClient,
  getThreadRecordByCodexThreadId,
  getThreadRecordById,
  getWorkspaceRecordByPath,
  getWorkspaceRecordById,
  listThreadRecords,
  updateThreadRecord
} from '../../../../packages/db/src/index';
import {
  ApprovalMode,
  CollaborationModeDto,
  CreateThreadInput,
  ImportThreadInput,
  ModelOptionDto,
  ReasoningEffortDto,
  RespondThreadActionRequestInput,
  ResumeThreadInput,
  SendThreadPromptInput,
  ThreadActionQuestionDto,
  ThreadActionRequestDto,
  ThreadDetailDto,
  ThreadDto,
  ThreadEventEnvelope,
  ThreadHistoryItemDto,
  ThreadSourceDto,
  ThreadTurnDto,
  ThreadStatusDto,
  UpdateThreadSettingsInput,
  WorkspaceDto
} from '../../../../packages/shared/src/index';
import { HttpError } from '../app';
import { SupervisorEventBus } from './event-bus';
import { LocalCodexSessionStore } from './local-session-store';

const DEFAULT_THREAD_TITLE = 'Untitled thread';
const LOCAL_PLAN_DECISION_PREFIX = 'plan-decision:';
const IMPLEMENT_APPROVED_PLAN_PROMPT = 'Implement the approved plan.';

type PendingThreadRequestRecord =
  | {
      source: 'server';
      serverRequestId: number;
      request: ThreadActionRequestDto;
    }
  | {
      source: 'planDecision';
      request: ThreadActionRequestDto;
    };

function approvalModeToPolicy(approvalMode: ApprovalMode): 'never' | 'on-request' {
  return approvalMode === 'guarded' ? 'on-request' : 'never';
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

function itemToHistoryItem(item: CodexTurnItem): ThreadHistoryItemDto {
  switch (item.type) {
    case 'userMessage':
      return {
        id: item.id,
        kind: 'userMessage',
        text:
          item.content
            ?.map((entry) => (entry.type === 'text' ? (entry.text ?? '') : `[${entry.type}]`))
            .join('\n')
            .trim() ?? ''
      };
    case 'agentMessage':
      return {
        id: item.id,
        kind: 'agentMessage',
        text: item.text ?? ''
      };
    case 'plan':
      return {
        id: item.id,
        kind: 'plan',
        text: item.text ?? ''
      };
    case 'reasoning':
      return {
        id: item.id,
        kind: 'reasoning',
        text: [item.summary?.join('\n') ?? '', item.text ?? ''].filter(Boolean).join('\n\n')
      };
    case 'commandExecution':
      return {
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
    case 'fileChange':
      return {
        id: item.id,
        kind: 'fileChange',
        text: item.text ?? 'File changes applied.',
        status: item.status ?? null
      };
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
      return {
        id: item.id,
        kind: 'toolCall',
        text: item.text ?? item.type,
        status: item.status ?? null
      };
    default:
      return {
        id: item.id,
        kind: 'other',
        text: item.text ?? item.type
      };
  }
}

function turnToDto(turn: CodexTurnRecord): ThreadTurnDto {
  return {
    id: turn.id,
    startedAt: parseUuidV7Timestamp(turn.id),
    status: turn.status,
    error: turn.error?.message ?? null,
    items: turn.items.map(itemToHistoryItem)
  };
}

export class ThreadService {
  private readonly pendingRequests = new Map<string, Map<string, PendingThreadRequestRecord>>();

  constructor(
    private readonly db: DatabaseClient,
    private readonly codexManager: CodexAppServerManager,
    private readonly eventBus: SupervisorEventBus,
    private readonly localSessionStore: LocalCodexSessionStore,
    private readonly workspaceRoot: string
  ) {
    this.codexManager.on('notification', (event) => {
      void this.handleNotification(event as CodexServerEvent);
    });
    this.codexManager.on('request', (request) => {
      void this.handleServerRequest(request as CodexServerRequest);
    });
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
    const response = await this.codexManager.startThread({
      cwd: workspace.absPath,
      model: input.model,
      approvalPolicy: approvalModeToPolicy(input.approvalMode)
    });

    const created = createThreadRecord(this.db, {
      workspaceId: workspace.id,
      title: normalizedTitle,
      model: input.model,
      reasoningEffort,
      collaborationMode: 'default',
      approvalMode: input.approvalMode,
      codexThreadId: response.thread.id,
      summaryText: response.thread.preview,
      source: 'supervisor'
    });

    updateThreadRecord(this.db, created.id, {
      ...this.buildThreadPatch(
        response.thread,
        input.model,
        response.reasoningEffort ?? reasoningEffort
      ),
      title: normalizedTitle === DEFAULT_THREAD_TITLE && response.thread.name ? response.thread.name : normalizedTitle
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
      title: localSession.title?.trim() || 'Untitled imported session',
      model: localSession.model,
      reasoningEffort: null,
      collaborationMode: 'default',
      approvalMode: 'yolo',
      codexThreadId: normalizedSessionId,
      summaryText:
        localSession.turns
          .flatMap((turn) => turn.items)
          .find((item) => item.kind === 'userMessage')
          ?.text ?? null,
      source: 'local_codex_import'
    });

    return this.getThreadDetail(created.id);
  }

  async getThreadDetail(localThreadId: string): Promise<ThreadDetailDto> {
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
    let remoteThread: CodexThreadRecord | null = null;
    try {
      remoteThread = await this.codexManager.readThread(record.codexThreadId);
    } catch (error) {
      if (!isRemoteThreadBootstrapError(error)) {
        throw error;
      }
    }

    if (!remoteThread) {
      const updated = getThreadRecordById(this.db, record.id)!;
      const localSession = await this.localSessionStore.findSession(record.codexThreadId);
      return {
        thread: this.toThreadDto(updated, loadedIds),
        workspace: toWorkspaceDto(workspace),
        workspacePathStatus,
        turns: localSession?.turns ?? [],
        pendingRequests: this.listPendingRequests(updated.id)
      };
    }

    if (
      remoteThread.turns.length > 0 &&
      remoteThread.turns.every((turn) => turn.items.length === 0)
    ) {
      remoteThread = (
        await this.codexManager.resumeThread({
          threadId: record.codexThreadId
        })
      ).thread;
      loadedIds.add(record.codexThreadId);
    }
    updateThreadRecord(
      this.db,
      record.id,
      this.buildThreadPatch(remoteThread, record.model, record.reasoningEffort)
    );

    const updated = getThreadRecordById(this.db, record.id)!;
    this.syncPendingPlanDecisionRequest(
      updated.id,
      updated.collaborationMode,
      remoteThread
    );
    return {
      thread: this.toThreadDto(updated, loadedIds),
      workspace: toWorkspaceDto(workspace),
      workspacePathStatus,
      turns: remoteThread.turns.map(turnToDto),
      pendingRequests: this.listPendingRequests(updated.id)
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
    try {
      response = await this.codexManager.resumeThread({
        threadId: record.codexThreadId,
        model: input.model ?? record.model ?? null
      });
    } catch (error) {
      if (!isRemoteThreadBootstrapError(error)) {
        throw error;
      }

      return this.getThreadDetail(localThreadId);
    }

    updateThreadRecord(
      this.db,
      record.id,
      this.buildThreadPatch(
        response.thread,
        input.model ?? record.model ?? response.model,
        response.reasoningEffort ?? record.reasoningEffort
      )
    );

    return this.getThreadDetail(localThreadId);
  }

  async sendPrompt(localThreadId: string, input: SendThreadPromptInput): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record || !record.codexThreadId) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    if (record.codexTurnId && record.status === 'running') {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'The current turn is still running.'
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

    const prompt = input.prompt.trim();
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

    const turn = await this.codexManager.startTurn({
      threadId: record.codexThreadId,
      prompt,
      model: effectiveModel,
      effort: normalizedReasoning,
      collaborationMode
    });

    const patch: Parameters<typeof updateThreadRecord>[2] = {
      codexTurnId: turn.id,
      status: 'running',
      summaryText: prompt,
      lastError: null,
      lastTurnStartedAt: new Date().toISOString(),
      model: effectiveModel,
      reasoningEffort: normalizedReasoning,
      collaborationMode
    };

    if (record.title === DEFAULT_THREAD_TITLE) {
      patch.title = prompt.slice(0, 60);
    }

    updateThreadRecord(this.db, localThreadId, patch);
    const updated = getThreadRecordById(this.db, localThreadId)!;

    return this.toThreadDto(updated, new Set([record.codexThreadId]));
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
    const nextModel = input.model ?? record.model ?? fallbackModel?.model ?? null;
    const requestedReasoning =
      input.reasoningEffort !== undefined
        ? normalizeReasoningEffort(input.reasoningEffort)
        : normalizeReasoningEffort(record.reasoningEffort);
    const nextReasoning = this.normalizeReasoningForModel(
      modelRecords,
      nextModel,
      requestedReasoning
    );
    const nextCollaborationMode =
      input.collaborationMode !== undefined
        ? normalizeCollaborationMode(input.collaborationMode)
        : normalizeCollaborationMode(record.collaborationMode);

    if (nextCollaborationMode !== 'plan') {
      this.clearPendingPlanDecisionRequests(localThreadId, true);
    }

    updateThreadRecord(this.db, localThreadId, {
      model: nextModel,
      reasoningEffort: nextReasoning,
      collaborationMode: nextCollaborationMode
    });

    const updated = getThreadRecordById(this.db, localThreadId)!;
    const loadedIds = new Set(await this.codexManager.listLoadedThreads().catch(() => []));
    this.emitThreadEvent('thread.updated', updated.id, {
      model: updated.model,
      reasoningEffort: updated.reasoningEffort,
      collaborationMode: updated.collaborationMode
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

    const updated = getThreadRecordById(this.db, localThreadId)!;
    return this.toThreadDto(updated, new Set());
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
      this.codexManager.respondToServerRequest(pending.serverRequestId, {
        answers: input.answers
      });
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
      }
    }

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

        if (record.title === DEFAULT_THREAD_TITLE || !record.title.trim()) {
          updateThreadRecord(this.db, record.id, {
            title: params.threadName
          });
        }

        this.emitThreadEvent('thread.updated', record.id, {
          title: getThreadRecordById(this.db, record.id)?.title ?? record.title
        });
        return;
      }
      case 'turn/started': {
        const params = event.params as { threadId: string; turn: CodexTurnRecord };
        const record = getThreadRecordByCodexThreadId(this.db, params.threadId);
        if (!record) {
          return;
        }

        this.clearPendingPlanDecisionRequests(record.id, true);

        updateThreadRecord(this.db, record.id, {
          codexTurnId: params.turn.id,
          status: 'running',
          lastError: null,
          lastTurnStartedAt: new Date().toISOString()
        });

        this.emitThreadEvent('thread.turn.started', record.id, {
          turnId: params.turn.id
        });
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
        this.pendingRequests.delete(record.id);
        if (
          params.turn.status === 'completed' &&
          normalizeCollaborationMode(record.collaborationMode) === 'plan' &&
          params.turn.items.some((item) => item.type === 'plan')
        ) {
          this.createPendingPlanDecisionRequest(record.id, params.turn.id, true);
        }

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
        this.pendingRequests.delete(record.id);

        this.emitThreadEvent('thread.turn.failed', record.id, {
          turnId: params.turnId,
          error: params.error.message ?? 'Turn failed unexpectedly.',
          willRetry: params.willRetry
        });
      }
    }
  }

  private async handleServerRequest(request: CodexServerRequest) {
    if (request.method !== 'item/tool/requestUserInput') {
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
      collaborationMode: normalizeCollaborationMode(record.collaborationMode),
      approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
      status: (record.status ?? 'idle') as ThreadStatusDto,
      summaryText: record.summaryText ?? null,
      lastError: record.lastError ?? null,
      activeTurnId: record.codexTurnId ?? null,
      isLoaded: record.codexThreadId ? loadedIds.has(record.codexThreadId) : false,
      isPinned: record.isPinned,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastTurnStartedAt: record.lastTurnStartedAt ?? null,
      lastTurnCompletedAt: record.lastTurnCompletedAt ?? null
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

  private createPendingPlanDecisionRequest(
    localThreadId: string,
    turnId: string,
    emitEvents: boolean
  ) {
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
}
