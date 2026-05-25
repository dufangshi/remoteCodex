import { spawn, type ChildProcess } from 'node:child_process';
import { z } from 'zod';

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

const awsSandboxAdapterEnvSchema = z.object({
  AWS_REGION: z.string().min(1).optional(),
  SANDBOX_AWS_REGION: z.string().min(1).optional(),
  SANDBOX_EKS_CLUSTER_NAME: z.string().min(1),
  SANDBOX_K8S_NAMESPACE: z.string().min(1).default('remote-codex-sandboxes'),
  SANDBOX_K8S_SERVICE_ACCOUNT: z.string().min(1),
  SANDBOX_WORKER_IMAGE_REPOSITORY: z.string().min(1),
  SANDBOX_WORKER_IMAGE_TAG: z.string().min(1),
  SANDBOX_ROUTER_BASE_URL: z.string().url(),
  SANDBOX_WORKER_AUTH_TOKEN_SECRET_NAME: z.string().min(1),
  SANDBOX_SUBNET_IDS: z.string().min(1),
  SANDBOX_SECURITY_GROUP_IDS: z.string().min(1),
  SANDBOX_RESOURCE_PROFILE: z.enum(['small', 'standard', 'large']).default('standard'),
});

export interface AwsSandboxAdapterConfig {
  region: string;
  clusterName: string;
  namespace: string;
  serviceAccountName: string;
  imageRepository: string;
  imageTag: string;
  routerBaseUrl: string;
  workerAuthTokenSecretName: string;
  subnetIds: string[];
  securityGroupIds: string[];
  resourceProfile: 'small' | 'standard' | 'large';
}

function commaList(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadAwsSandboxAdapterConfig(
  env: NodeJS.ProcessEnv = process.env,
): AwsSandboxAdapterConfig {
  const parsed = awsSandboxAdapterEnvSchema.parse(env);
  const subnetIds = commaList(parsed.SANDBOX_SUBNET_IDS);
  const securityGroupIds = commaList(parsed.SANDBOX_SECURITY_GROUP_IDS);
  if (subnetIds.length === 0) {
    throw new SandboxManagerError('config', 'SANDBOX_SUBNET_IDS must include at least one subnet id.');
  }
  if (securityGroupIds.length === 0) {
    throw new SandboxManagerError(
      'config',
      'SANDBOX_SECURITY_GROUP_IDS must include at least one security group id.',
    );
  }

  return {
    region: parsed.SANDBOX_AWS_REGION ?? parsed.AWS_REGION ?? 'us-east-1',
    clusterName: parsed.SANDBOX_EKS_CLUSTER_NAME,
    namespace: parsed.SANDBOX_K8S_NAMESPACE,
    serviceAccountName: parsed.SANDBOX_K8S_SERVICE_ACCOUNT,
    imageRepository: parsed.SANDBOX_WORKER_IMAGE_REPOSITORY,
    imageTag: parsed.SANDBOX_WORKER_IMAGE_TAG,
    routerBaseUrl: parsed.SANDBOX_ROUTER_BASE_URL,
    workerAuthTokenSecretName: parsed.SANDBOX_WORKER_AUTH_TOKEN_SECRET_NAME,
    subnetIds,
    securityGroupIds,
    resourceProfile: parsed.SANDBOX_RESOURCE_PROFILE,
  };
}

export class AwsEksFargateSandboxManager implements SandboxManager {
  constructor(readonly config: AwsSandboxAdapterConfig) {}

  async createSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    return this.startSandbox(input);
  }

  async startSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    return {
      state: 'starting',
      routerBaseUrl: this.config.routerBaseUrl,
      workerServiceName: this.workerServiceName(input.sandboxId),
      k8sNamespace: this.config.namespace,
      k8sPodName: this.podName(input.sandboxId),
      statusReason: 'AWS EKS Fargate adapter is configured; Pod creation is not implemented yet.',
    };
  }

  async stopSandbox(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    return {
      state: 'stopping',
      routerBaseUrl: this.config.routerBaseUrl,
      workerServiceName: this.workerServiceName(input.sandboxId),
      k8sNamespace: this.config.namespace,
      k8sPodName: this.podName(input.sandboxId),
      statusReason: 'AWS EKS Fargate adapter is configured; Pod stop is not implemented yet.',
    };
  }

  async restartSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    await this.stopSandbox(input);
    return this.startSandbox(input);
  }

  async deleteSandbox(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    await this.stopSandbox(input);
    return {
      state: 'deleting',
      routerBaseUrl: this.config.routerBaseUrl,
      workerServiceName: this.workerServiceName(input.sandboxId),
      k8sNamespace: this.config.namespace,
      k8sPodName: this.podName(input.sandboxId),
    };
  }

  async getSandboxStatus(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    return {
      state: 'unknown',
      routerBaseUrl: this.config.routerBaseUrl,
      workerServiceName: this.workerServiceName(input.sandboxId),
      k8sNamespace: this.config.namespace,
      k8sPodName: this.podName(input.sandboxId),
      statusReason: 'AWS EKS Fargate status polling is not implemented yet.',
    };
  }

  async getSandboxEndpoint(): Promise<{ routerBaseUrl: string | null }> {
    return { routerBaseUrl: this.config.routerBaseUrl };
  }

  async prepareSandboxEnvironment(input: SandboxStartInput): Promise<SandboxEnvironment> {
    return {
      env: {
        REMOTE_CODEX_RUNTIME_ROLE: 'worker',
        REMOTE_CODEX_SANDBOX_ID: input.sandboxId,
        REMOTE_CODEX_USER_ID: input.userId,
        WORKSPACE_ROOT: '/workspace',
        HOME: '/home/agent',
      },
    };
  }

  private podName(sandboxId: string) {
    return `remote-codex-worker-${sandboxId}`;
  }

  private workerServiceName(sandboxId: string) {
    return `remote-codex-worker-${sandboxId}`;
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
