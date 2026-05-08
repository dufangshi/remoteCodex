import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { JsonRpcClient, JsonRpcClientError } from './jsonrpc';
import {
  AppServerStatusSnapshot,
  CodexClientInfo,
  CodexMcpServerRecord,
  CodexModelRecord,
  CodexServerRequest,
  CodexServerEvent,
  CodexSkillsListEntry,
  CodexThreadGoalRecord,
  CodexThreadRecord,
  CodexTurnRecord,
  ReasoningEffort,
  ThreadGoalSetInput,
  ThreadForkInput,
  ThreadRollbackInput,
  ThreadResumeInput,
  ThreadStartInput,
  TurnStartInput,
  TurnSteerInput
} from './types';

interface SpawnedChild {
  stdout: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  stderr: NodeJS.ReadableStream;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface CodexAppServerManagerOptions {
  command: string;
  startupTimeoutMs: number;
  clientInfo: CodexClientInfo;
  maxRestarts?: number;
  spawnProcess?: (command: string, args: string[]) => SpawnedChild;
}

function mapThread(record: any): CodexThreadRecord {
  return {
    id: record.id,
    preview: record.preview ?? '',
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    status: record.status,
    cwd: record.cwd,
    name: record.name ?? null,
    turns: Array.isArray(record.turns) ? record.turns.map(mapTurn) : []
  };
}

function mapTurn(record: any): CodexTurnRecord {
  return {
    id: record.id,
    status: record.status,
    error: record.error ?? null,
    items: Array.isArray(record.items) ? record.items : []
  };
}

function mapModel(record: any): CodexModelRecord {
  return {
    id: record.id,
    model: record.model,
    displayName: record.displayName,
    description: record.description,
    hidden: record.hidden,
    isDefault: record.isDefault,
    supportedReasoningEfforts: Array.isArray(record.supportedReasoningEfforts)
      ? record.supportedReasoningEfforts.map((entry: any) => ({
          reasoningEffort: entry.reasoningEffort,
          description: entry.description
        }))
      : [],
    defaultReasoningEffort: record.defaultReasoningEffort ?? 'medium'
  };
}

function mapSkillsListEntry(record: any): CodexSkillsListEntry {
  return {
    cwd: record.cwd,
    skills: Array.isArray(record.skills)
      ? record.skills.map((skill: any) => ({
          name: skill.name,
          description: skill.description ?? '',
          shortDescription: skill.shortDescription ?? null,
          interface: skill.interface
            ? {
                displayName: skill.interface.displayName ?? null,
                shortDescription: skill.interface.shortDescription ?? null,
                brandColor: skill.interface.brandColor ?? null,
                defaultPrompt: skill.interface.defaultPrompt ?? null,
              }
            : null,
          path: skill.path,
          scope: skill.scope,
          enabled: skill.enabled === true,
        }))
      : [],
    errors: Array.isArray(record.errors)
      ? record.errors.map((error: any) => ({
          path: error.path,
          message: error.message,
        }))
      : [],
  };
}

function mapMcpServer(record: any): CodexMcpServerRecord {
  const tools = record.tools ?? {};
  return {
    name: record.name,
    authStatus: record.authStatus ?? record.auth_status ?? 'unsupported',
    tools: Object.values(tools).map((tool: any) => ({
      name: tool.name,
      title: tool.title ?? null,
      description: tool.description ?? null,
    })),
    resourceCount: Array.isArray(record.resources) ? record.resources.length : 0,
    resourceTemplateCount: Array.isArray(record.resourceTemplates)
      ? record.resourceTemplates.length
      : 0,
  };
}

function parseGoalTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && value.trim() !== '') {
      return numericValue;
    }

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return Math.floor(Date.now() / 1000);
}

function mapThreadGoal(record: any): CodexThreadGoalRecord {
  return {
    threadId: record.threadId,
    objective: record.objective,
    status: record.status,
    tokenBudget: record.tokenBudget ?? null,
    tokensUsed: record.tokensUsed ?? 0,
    timeUsedSeconds: record.timeUsedSeconds ?? 0,
    createdAt: parseGoalTimestamp(record.createdAt),
    updatedAt: parseGoalTimestamp(record.updatedAt),
  };
}

export class CodexAppServerManager extends EventEmitter {
  private readonly maxRestarts: number;
  private readonly spawnProcess: (command: string, args: string[]) => SpawnedChild;
  private process: SpawnedChild | null = null;
  private client: JsonRpcClient | null = null;
  private readonly intentionallyStopping = new Set<SpawnedChild>();
  private status: AppServerStatusSnapshot = {
    state: 'stopped',
    transport: 'stdio',
    lastStartedAt: null,
    lastError: null,
    restartCount: 0
  };
  private startPromise: Promise<void> | null = null;
  private intentionalStop = false;

  constructor(private readonly options: CodexAppServerManagerOptions) {
    super();
    this.maxRestarts = options.maxRestarts ?? 3;
    this.spawnProcess =
      options.spawnProcess ??
      ((command: string, args: string[]) =>
        spawn(command, args, {
          stdio: 'pipe'
        }) as unknown as ChildProcessWithoutNullStreams);
  }

  getStatus(): AppServerStatusSnapshot {
    return { ...this.status };
  }

  async start(): Promise<void> {
    if (this.status.state === 'ready') {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.intentionalStop = false;
    this.setStatus('starting', null);

    this.startPromise = this.doStart().finally(() => {
      this.startPromise = null;
    });

    return this.startPromise;
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    const client = this.client;
    const process = this.process;

    client?.close();
    if (this.client === client) {
      this.client = null;
    }

    if (process) {
      this.intentionallyStopping.add(process);
      process.kill('SIGTERM');
      if (this.process === process) {
        this.process = null;
      }
    }

    this.setStatus('stopped', null);
  }

  async ensureReady(): Promise<void> {
    if (this.status.state !== 'ready') {
      await this.start();
    }

    if (this.status.state !== 'ready' || !this.client) {
      throw new JsonRpcClientError(
        this.status.lastError ?? 'Codex app-server is unavailable.',
        'app_server_unavailable'
      );
    }
  }

  async listModels(): Promise<CodexModelRecord[]> {
    await this.ensureReady();
    const response = await this.client!.request<{ data: any[] }>('model/list', {
      includeHidden: false
    });
    return response.data.map(mapModel);
  }

  async listThreads(): Promise<CodexThreadRecord[]> {
    await this.ensureReady();
    const response = await this.client!.request<{ data: any[] }>('thread/list', {
      archived: false
    });
    return response.data.map(mapThread);
  }

  async listLoadedThreads(): Promise<string[]> {
    await this.ensureReady();
    const response = await this.client!.request<{ data: string[] }>('thread/loaded/list', {});
    return response.data;
  }

  async listSkills(input: { cwds?: string[]; forceReload?: boolean } = {}) {
    await this.ensureReady();
    const response = await this.client!.request<{ data: any[] }>('skills/list', {
      ...(input.cwds && input.cwds.length > 0 ? { cwds: input.cwds } : {}),
      ...(input.forceReload !== undefined ? { forceReload: input.forceReload } : {}),
    });
    return response.data.map(mapSkillsListEntry);
  }

  async listMcpServers() {
    await this.ensureReady();
    const servers: CodexMcpServerRecord[] = [];
    let cursor: string | null = null;

    do {
      const response: {
        data: any[];
        nextCursor?: string | null;
        next_cursor?: string | null;
      } = await this.client!.request('mcpServerStatus/list', {
        cursor,
        limit: 100,
        detail: 'full',
      });
      servers.push(...response.data.map(mapMcpServer));
      cursor = response.nextCursor ?? response.next_cursor ?? null;
    } while (cursor);

    return servers;
  }

  async startThread(input: ThreadStartInput) {
    await this.ensureReady();
    const response = await this.client!.request<{ thread: any; model: string; reasoningEffort?: ReasoningEffort | null; sandbox?: string | null }>('thread/start', {
      cwd: input.cwd,
      model: input.model,
      serviceTier: input.serviceTier,
      approvalPolicy: input.approvalPolicy,
      sandbox: input.sandbox ?? null,
      experimentalRawEvents: false,
      persistExtendedHistory: true
    });

    return {
      thread: mapThread(response.thread),
      model: response.model,
      reasoningEffort: response.reasoningEffort ?? null,
      sandbox: response.sandbox ?? null,
    };
  }

  async readThread(threadId: string) {
    await this.ensureReady();
    const response = await this.client!.request<{ thread: any }>('thread/read', {
      threadId,
      includeTurns: true
    });
    return mapThread(response.thread);
  }

  async resumeThread(input: ThreadResumeInput) {
    await this.ensureReady();
    const response = await this.client!.request<{ thread: any; model: string; reasoningEffort?: ReasoningEffort | null; sandbox?: string | null }>('thread/resume', {
      threadId: input.threadId,
      model: input.model ?? null,
      serviceTier: input.serviceTier,
      sandbox: input.sandbox ?? null,
      persistExtendedHistory: true
    });
    return {
      thread: mapThread(response.thread),
      model: response.model,
      reasoningEffort: response.reasoningEffort ?? null,
      sandbox: response.sandbox ?? null,
    };
  }

  async forkThread(input: ThreadForkInput) {
    await this.ensureReady();
    const response = await this.client!.request<{ thread: any }>('thread/fork', {
      threadId: input.threadId,
    });
    return mapThread(response.thread);
  }

  async rollbackThread(input: ThreadRollbackInput) {
    await this.ensureReady();
    const response = await this.client!.request<{ thread: any }>('thread/rollback', {
      threadId: input.threadId,
      count: input.count,
    });
    return mapThread(response.thread);
  }

  async startTurn(input: TurnStartInput) {
    await this.ensureReady();
    const response = await this.client!.request<{ turn: any }>('turn/start', {
      threadId: input.threadId,
      input: [
        {
          type: 'text',
          text: input.prompt,
          text_elements: []
        }
      ],
      model: input.model ?? null,
      serviceTier:
        input.serviceTier === undefined ? undefined : input.serviceTier,
      effort: input.effort ?? null,
      sandboxPolicy: input.sandboxPolicy ?? null,
      collaborationMode: input.collaborationMode
        ? {
            mode: input.collaborationMode,
            settings: {
              model: input.model ?? '',
              reasoning_effort: input.effort ?? null,
              developer_instructions: null
            }
          }
        : null
    });
    return mapTurn(response.turn);
  }

  async steerTurn(input: TurnSteerInput) {
    await this.ensureReady();
    const response = await this.client!.request<{ turn?: any }>('turn/steer', {
      threadId: input.threadId,
      expectedTurnId: input.turnId,
      input: [
        {
          type: 'text',
          text: input.prompt,
          text_elements: []
        }
      ]
    });
    return response.turn ? mapTurn(response.turn) : null;
  }

  async compactThread(threadId: string) {
    await this.ensureReady();
    await this.client!.request<unknown>('thread/compact/start', {
      threadId,
    });
  }

  async getThreadGoal(threadId: string) {
    await this.ensureReady();
    const response = await this.client!.request<{ goal: any | null }>('thread/goal/get', {
      threadId,
    });
    return response.goal ? mapThreadGoal(response.goal) : null;
  }

  async setThreadGoal(input: ThreadGoalSetInput) {
    await this.ensureReady();
    const response = await this.client!.request<{ goal: any }>('thread/goal/set', {
      threadId: input.threadId,
      ...(input.objective !== undefined ? { objective: input.objective } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
    });
    return mapThreadGoal(response.goal);
  }

  async clearThreadGoal(threadId: string) {
    await this.ensureReady();
    const response = await this.client!.request<{ cleared: boolean }>('thread/goal/clear', {
      threadId,
    });
    return response.cleared;
  }

  async setExperimentalFeatureEnablement(enablement: Record<string, boolean>) {
    await this.ensureReady();
    await this.client!.request<unknown>('experimentalFeature/enablement/set', {
      enablement,
    });
  }

  async interruptTurn(threadId: string, turnId: string) {
    await this.ensureReady();
    const response = await this.client!.request<{ turn?: any }>('turn/interrupt', {
      threadId,
      turnId
    });
    return response.turn ? mapTurn(response.turn) : null;
  }

  respondToServerRequest(id: number, result: unknown) {
    if (!this.client) {
      throw new JsonRpcClientError('Codex app-server is unavailable.', 'app_server_unavailable');
    }

    this.client.respond(id, result);
  }

  private async doStart() {
    const child = this.spawnProcess(this.options.command, ['app-server', '--listen', 'stdio://']);
    this.process = child;
    this.status.lastStartedAt = new Date().toISOString();
    const startupError = new Promise<never>((_, reject) => {
      child.once('error', (error) => {
        reject(
          new JsonRpcClientError(
            `Failed to spawn Codex app-server: ${error.message}`,
            'spawn_failed'
          )
        );
      });
    });

    child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (!message) {
        return;
      }

      this.emit('stderr', message);
    });

    child.once('exit', (code, signal) => {
      const intentionallyStopping = this.intentionallyStopping.delete(child);
      const isCurrentClient = this.client === client;
      const isCurrentProcess = this.process === child;

      if (isCurrentClient) {
        this.client?.close();
        this.client = null;
      }
      if (isCurrentProcess) {
        this.process = null;
      }

      if (!isCurrentClient && !isCurrentProcess) {
        return;
      }

      if (intentionallyStopping || this.intentionalStop) {
        if (isCurrentProcess || isCurrentClient) {
          this.setStatus('stopped', null);
        }
        return;
      }

      const reason = `Codex app-server exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`;
      if (this.status.restartCount < this.maxRestarts) {
        this.status.restartCount += 1;
        this.setStatus('degraded', reason);
        void this.start();
        return;
      }

      this.setStatus('failed', reason);
    });

    const client = new JsonRpcClient(child.stdout as any, child.stdin as any);
    this.client = client;

    client.on('notification', (notification) => {
      this.emit('notification', notification as CodexServerEvent);
    });

    client.on('request', (request) => {
      this.emit('request', request as CodexServerRequest);
    });

    client.on('warning', (warning) => {
      this.emit('warning', warning);
    });

    await Promise.race([
      client.request('initialize', {
        clientInfo: this.options.clientInfo,
        capabilities: {
          experimentalApi: true
        }
      }),
      startupError,
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new JsonRpcClientError(
              'Codex app-server initialize handshake timed out.',
              'initialize_timeout'
            )
          );
        }, this.options.startupTimeoutMs);
      })
    ]).catch((error) => {
      this.client = null;
      this.process?.kill('SIGTERM');
      this.process = null;
      this.setStatus('failed', error instanceof Error ? error.message : String(error));
      throw error;
    });

    this.setStatus('ready', null);
  }

  private setStatus(state: AppServerStatusSnapshot['state'], lastError: string | null) {
    this.status = {
      ...this.status,
      state,
      lastError
    };
    this.emit('status', this.getStatus());
  }
}
