import fs from 'node:fs/promises';
import path from 'node:path';

import {
  CodexAppServerManager,
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
  CreateThreadInput,
  ImportThreadInput,
  ModelOptionDto,
  SendThreadPromptInput,
  ThreadDetailDto,
  ThreadDto,
  ThreadEventEnvelope,
  ThreadHistoryItemDto,
  ThreadSourceDto,
  ThreadTurnDto,
  ThreadStatusDto,
  WorkspaceDto
} from '../../../../packages/shared/src/index';
import { HttpError } from '../app';
import { SupervisorEventBus } from './event-bus';
import { LocalCodexSessionStore } from './local-session-store';

const DEFAULT_THREAD_TITLE = 'Untitled thread';

function approvalModeToPolicy(approvalMode: ApprovalMode): 'never' | 'on-request' {
  return approvalMode === 'guarded' ? 'on-request' : 'never';
}

function isRemoteThreadBootstrapError(error: unknown) {
  if (!(error instanceof JsonRpcClientError) || error.code !== 'remote_error') {
    return false;
  }

  return (
    error.message.includes('includeTurns is unavailable before first user message') ||
    error.message.includes('is not materialized yet') ||
    error.message.includes('no rollout found for thread id')
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
  }

  async listModels(): Promise<ModelOptionDto[]> {
    const models = await this.codexManager.listModels();
    return models.map((model) => ({
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      description: model.description,
      isDefault: model.isDefault,
      hidden: model.hidden
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

        updateThreadRecord(this.db, local.id, this.buildThreadPatch(remoteThread, local.model));
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
    const response = await this.codexManager.startThread({
      cwd: workspace.absPath,
      model: input.model,
      approvalPolicy: approvalModeToPolicy(input.approvalMode)
    });

    const created = createThreadRecord(this.db, {
      workspaceId: workspace.id,
      title: normalizedTitle,
      model: input.model,
      approvalMode: input.approvalMode,
      codexThreadId: response.thread.id,
      summaryText: response.thread.preview,
      source: 'supervisor'
    });

    updateThreadRecord(this.db, created.id, {
      ...this.buildThreadPatch(response.thread, input.model),
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
        turns: localSession?.turns ?? []
      };
    }

    if (
      remoteThread.turns.length > 0 &&
      remoteThread.turns.every((turn) => turn.items.length === 0)
    ) {
      remoteThread = (await this.codexManager.resumeThread(record.codexThreadId)).thread;
      loadedIds.add(record.codexThreadId);
    }
    updateThreadRecord(this.db, record.id, this.buildThreadPatch(remoteThread, record.model));

    const updated = getThreadRecordById(this.db, record.id)!;
    return {
      thread: this.toThreadDto(updated, loadedIds),
      workspace: toWorkspaceDto(workspace),
      workspacePathStatus,
      turns: remoteThread.turns.map(turnToDto)
    };
  }

  async resumeThread(localThreadId: string): Promise<ThreadDetailDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record || !record.codexThreadId) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    let response;
    try {
      response = await this.codexManager.resumeThread(record.codexThreadId);
    } catch (error) {
      if (!isRemoteThreadBootstrapError(error)) {
        throw error;
      }

      return this.getThreadDetail(localThreadId);
    }

    updateThreadRecord(
      this.db,
      record.id,
      this.buildThreadPatch(response.thread, record.model ?? response.model)
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

    const turn = await this.codexManager.startTurn({
      threadId: record.codexThreadId,
      prompt
    });

    const patch: Parameters<typeof updateThreadRecord>[2] = {
      codexTurnId: turn.id,
      status: 'running',
      summaryText: prompt,
      lastError: null,
      lastTurnStartedAt: new Date().toISOString()
    };

    if (record.title === DEFAULT_THREAD_TITLE) {
      patch.title = prompt.slice(0, 60);
    }

    updateThreadRecord(this.db, localThreadId, patch);
    const updated = getThreadRecordById(this.db, localThreadId)!;

    return this.toThreadDto(updated, new Set([record.codexThreadId]));
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

        this.emitThreadEvent('thread.turn.failed', record.id, {
          turnId: params.turnId,
          error: params.error.message ?? 'Turn failed unexpectedly.',
          willRetry: params.willRetry
        });
      }
    }
  }

  private buildThreadPatch(remoteThread: CodexThreadRecord, model: string | null | undefined) {
    return {
      codexThreadId: remoteThread.id,
      status: normalizeThreadStatus(remoteThread),
      summaryText: remoteThread.preview || null,
      model: model ?? null,
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
}
