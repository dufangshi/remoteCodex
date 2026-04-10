import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { JsonRpcClient, JsonRpcClientError } from './jsonrpc';
import {
  AppServerStatusSnapshot,
  CodexClientInfo,
  CodexModelRecord,
  CodexServerEvent,
  CodexThreadRecord,
  CodexTurnRecord,
  ThreadStartInput,
  TurnStartInput
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
    isDefault: record.isDefault
  };
}

export class CodexAppServerManager extends EventEmitter {
  private readonly maxRestarts: number;
  private readonly spawnProcess: (command: string, args: string[]) => SpawnedChild;
  private process: SpawnedChild | null = null;
  private client: JsonRpcClient | null = null;
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
    this.client?.close();
    this.client = null;

    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
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

  async startThread(input: ThreadStartInput) {
    await this.ensureReady();
    const response = await this.client!.request<{ thread: any; model: string }>('thread/start', {
      cwd: input.cwd,
      model: input.model,
      approvalPolicy: input.approvalPolicy,
      experimentalRawEvents: false,
      persistExtendedHistory: true
    });

    return {
      thread: mapThread(response.thread),
      model: response.model
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

  async resumeThread(threadId: string) {
    await this.ensureReady();
    const response = await this.client!.request<{ thread: any; model: string }>('thread/resume', {
      threadId,
      persistExtendedHistory: true
    });
    return {
      thread: mapThread(response.thread),
      model: response.model
    };
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
      ]
    });
    return mapTurn(response.turn);
  }

  async interruptTurn(threadId: string, turnId: string) {
    await this.ensureReady();
    const response = await this.client!.request<{ turn?: any }>('turn/interrupt', {
      threadId,
      turnId
    });
    return response.turn ? mapTurn(response.turn) : null;
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
      this.client?.close();
      this.client = null;
      this.process = null;

      if (this.intentionalStop) {
        this.setStatus('stopped', null);
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
