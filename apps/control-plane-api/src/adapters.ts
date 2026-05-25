import { spawn, type ChildProcess } from 'node:child_process';

export interface SandboxProvisionResult {
  state: string;
  routerBaseUrl?: string | null;
  workerServiceName?: string | null;
  k8sNamespace?: string | null;
  k8sPodName?: string | null;
  statusReason?: string | null;
}

export interface SandboxStartInput {
  sandboxId: string;
  userId: string;
  image: string;
  region: string;
  s3Prefix: string;
}

export interface SandboxEnvironment {
  env: Record<string, string>;
}

export type SandboxManagerErrorCode = 'quota' | 'capacity' | 'config' | 'provider';

export class SandboxManagerError extends Error {
  constructor(
    public readonly code: SandboxManagerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface SandboxManager {
  createSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult>;
  startSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult>;
  stopSandbox(input: { sandboxId: string; userId: string }): Promise<SandboxProvisionResult>;
  restartSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult>;
  deleteSandbox(input: { sandboxId: string; userId: string }): Promise<SandboxProvisionResult>;
  getSandboxStatus(input: { sandboxId: string; userId: string }): Promise<SandboxProvisionResult>;
  getSandboxEndpoint(input: { sandboxId: string; userId: string }): Promise<{ routerBaseUrl: string | null }>;
  prepareSandboxEnvironment(input: SandboxStartInput): Promise<SandboxEnvironment>;
}

export class NoopSandboxManager implements SandboxManager {
  constructor(private readonly routerBaseUrl: string) {}

  async createSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    return this.runningResult(input);
  }

  async startSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    return this.runningResult(input);
  }

  async restartSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    return this.runningResult(input);
  }

  async stopSandbox(): Promise<SandboxProvisionResult> {
    return { state: 'stopped' };
  }

  async deleteSandbox(): Promise<SandboxProvisionResult> {
    return { state: 'deleted' };
  }

  async getSandboxStatus(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    return {
      state: 'running',
      routerBaseUrl: this.routerBaseUrl,
      workerServiceName: `sandbox-worker-${input.sandboxId}`,
      k8sNamespace: 'remote-codex-sandboxes',
      k8sPodName: `sandbox-${input.sandboxId}`,
    };
  }

  async getSandboxEndpoint(): Promise<{ routerBaseUrl: string | null }> {
    return { routerBaseUrl: this.routerBaseUrl };
  }

  async prepareSandboxEnvironment(input: SandboxStartInput): Promise<SandboxEnvironment> {
    return {
      env: {
        REMOTE_CODEX_RUNTIME_ROLE: 'worker',
        REMOTE_CODEX_SANDBOX_ID: input.sandboxId,
        REMOTE_CODEX_USER_ID: input.userId,
        WORKSPACE_ROOT: '/workspace',
      },
    };
  }

  private runningResult(input: { sandboxId: string }): SandboxProvisionResult {
    return {
      state: 'running',
      routerBaseUrl: this.routerBaseUrl,
      workerServiceName: `sandbox-worker-${input.sandboxId}`,
      k8sNamespace: 'remote-codex-sandboxes',
      k8sPodName: `sandbox-${input.sandboxId}`,
    };
  }
}

export class LocalWorkerProcessSandboxManager implements SandboxManager {
  private readonly processes = new Map<string, ChildProcess>();

  constructor(
    private readonly input: {
      routerBaseUrl: string;
      workerCommand: string;
      workerArgs?: string[];
      workerEnv?: Record<string, string>;
    },
  ) {}

  async createSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    return this.startSandbox(input);
  }

  async startSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    if (!this.processes.has(input.sandboxId)) {
      const env = await this.prepareSandboxEnvironment(input);
      const child = spawn(this.input.workerCommand, this.input.workerArgs ?? [], {
        env: {
          ...process.env,
          ...this.input.workerEnv,
          ...env.env,
        },
        stdio: 'ignore',
        detached: true,
      });
      child.unref();
      this.processes.set(input.sandboxId, child);
    }
    return this.runningResult(input.sandboxId);
  }

  async stopSandbox(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    const child = this.processes.get(input.sandboxId);
    if (child) {
      child.kill();
      this.processes.delete(input.sandboxId);
    }
    return { state: 'stopped' };
  }

  async restartSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    await this.stopSandbox(input);
    return this.startSandbox(input);
  }

  async deleteSandbox(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    await this.stopSandbox(input);
    return { state: 'deleted' };
  }

  async getSandboxStatus(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    return this.processes.has(input.sandboxId)
      ? this.runningResult(input.sandboxId)
      : { state: 'stopped' };
  }

  async getSandboxEndpoint(): Promise<{ routerBaseUrl: string | null }> {
    return { routerBaseUrl: this.input.routerBaseUrl };
  }

  async prepareSandboxEnvironment(input: SandboxStartInput): Promise<SandboxEnvironment> {
    return {
      env: {
        REMOTE_CODEX_RUNTIME_ROLE: 'worker',
        REMOTE_CODEX_SANDBOX_ID: input.sandboxId,
        REMOTE_CODEX_USER_ID: input.userId,
        REMOTE_CODEX_WORKER_AUTH_TOKEN:
          this.input.workerEnv?.REMOTE_CODEX_WORKER_AUTH_TOKEN ?? 'local-worker-token',
        WORKSPACE_ROOT: this.input.workerEnv?.WORKSPACE_ROOT ?? '/workspace',
        HOME: this.input.workerEnv?.HOME ?? '/home/agent',
      },
    };
  }

  private runningResult(sandboxId: string): SandboxProvisionResult {
    return {
      state: 'running',
      routerBaseUrl: this.input.routerBaseUrl,
      workerServiceName: `local-worker-${sandboxId}`,
    };
  }
}

export interface GatewayUserResult {
  externalUserId: string;
}

export interface GatewayKeyResult {
  externalKeyId: string;
  keyCiphertext?: string | null;
}

export interface LlmGatewayAdmin {
  ensureUser(input: {
    userId: string;
    email: string;
    displayName?: string | null;
  }): Promise<GatewayUserResult>;
  ensureSandboxKey(input: {
    userId: string;
    sandboxId: string;
    externalUserId: string;
  }): Promise<GatewayKeyResult>;
}

export class NoopLlmGatewayAdmin implements LlmGatewayAdmin {
  async ensureUser(input: { userId: string }): Promise<GatewayUserResult> {
    return { externalUserId: `sub2api-user-${input.userId}` };
  }

  async ensureSandboxKey(input: {
    sandboxId: string;
  }): Promise<GatewayKeyResult> {
    return {
      externalKeyId: `sub2api-key-${input.sandboxId}`,
      keyCiphertext: null,
    };
  }
}
