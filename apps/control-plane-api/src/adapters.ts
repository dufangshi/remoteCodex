export interface SandboxProvisionResult {
  state: string;
  routerBaseUrl?: string | null;
  workerServiceName?: string | null;
  k8sNamespace?: string | null;
  k8sPodName?: string | null;
}

export interface SandboxManager {
  startSandbox(input: {
    sandboxId: string;
    userId: string;
    image: string;
    region: string;
    s3Prefix: string;
  }): Promise<SandboxProvisionResult>;
  stopSandbox(input: { sandboxId: string; userId: string }): Promise<SandboxProvisionResult>;
}

export class NoopSandboxManager implements SandboxManager {
  constructor(private readonly routerBaseUrl: string) {}

  async startSandbox(input: {
    sandboxId: string;
    userId: string;
    image: string;
    region: string;
    s3Prefix: string;
  }): Promise<SandboxProvisionResult> {
    return {
      state: 'running',
      routerBaseUrl: this.routerBaseUrl,
      workerServiceName: `sandbox-worker-${input.sandboxId}`,
      k8sNamespace: 'remote-codex-sandboxes',
      k8sPodName: `sandbox-${input.sandboxId}`,
    };
  }

  async stopSandbox(): Promise<SandboxProvisionResult> {
    return { state: 'stopped' };
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
