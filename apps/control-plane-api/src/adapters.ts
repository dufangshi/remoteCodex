import { spawn, type ChildProcess } from 'node:child_process';
import { z } from 'zod';

export interface SandboxProvisionResult {
  state: string;
  routerBaseUrl?: string | null;
  workerServiceName?: string | null;
  k8sNamespace?: string | null;
  k8sPodName?: string | null;
  statusReason?: string | null;
  startupProgress?: number;
  lastFailureCode?: string | null;
  lastFailureMessage?: string | null;
}

export interface SandboxStartInput {
  sandboxId: string;
  userId: string;
  image: string;
  region: string;
  s3Prefix: string;
  gateway?: {
    baseUrl: string;
    keyId: string;
    tokenSecretName?: string | null;
  } | undefined;
  harness?: {
    baseUrl: string;
    appKeySecretName?: string | null;
    chemistryToolsEnabled?: boolean;
  } | undefined;
}

export interface SandboxEnvironment {
  env: Record<string, string>;
}

export interface SandboxSecretEnvRef {
  secretName: string;
  key: string;
}

export interface SandboxEnvironmentSpec extends SandboxEnvironment {
  secretEnv?: Record<string, SandboxSecretEnvRef>;
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
        ...(input.gateway
          ? {
              REMOTE_CODEX_LLM_GATEWAY_BASE_URL: input.gateway.baseUrl,
              REMOTE_CODEX_LLM_GATEWAY_KEY_ID: input.gateway.keyId,
              ...(this.input.workerEnv?.REMOTE_CODEX_LLM_GATEWAY_TOKEN
                ? {
                    REMOTE_CODEX_LLM_GATEWAY_TOKEN:
                      this.input.workerEnv.REMOTE_CODEX_LLM_GATEWAY_TOKEN,
                  }
                : {}),
            }
          : {}),
        ...(input.harness
          ? {
              ELAGENTE_HARNESS_BASE_URL: input.harness.baseUrl,
              REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: input.harness.chemistryToolsEnabled
                ? 'true'
                : 'false',
              ...(this.input.workerEnv?.INACT_X_APP_KEY
                ? {
                    INACT_X_APP_KEY: this.input.workerEnv.INACT_X_APP_KEY,
                  }
                : {}),
            }
          : {}),
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

export interface AwsWorkerPodSpec {
  namespace: string;
  podName: string;
  serviceName: string;
  image: string;
  serviceAccountName: string;
  labels: Record<string, string>;
  env: Record<string, string>;
  secretEnv: Record<string, SandboxSecretEnvRef>;
  subnetIds: string[];
  securityGroupIds: string[];
  resourceProfile: AwsSandboxAdapterConfig['resourceProfile'];
  resources: {
    cpu: string;
    memory: string;
    ephemeralStorage: string;
  };
}

export interface AwsWorkerPodStatus {
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | 'Unknown' | string;
  ready: boolean;
  reason?: string | null;
  message?: string | null;
}

export interface AwsWorkerEndpoint {
  routerBaseUrl?: string | null;
  workerServiceName?: string | null;
}

export interface AwsSandboxKubernetesClient {
  applyWorkerPod(spec: AwsWorkerPodSpec): Promise<void>;
  deleteWorkerPod(input: {
    namespace: string;
    podName: string;
    serviceName: string;
  }): Promise<{ deleted: boolean }>;
  getWorkerPod(input: {
    namespace: string;
    podName: string;
  }): Promise<AwsWorkerPodStatus | null>;
  getWorkerEndpoint(input: {
    namespace: string;
    serviceName: string;
  }): Promise<AwsWorkerEndpoint>;
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

const awsResourceProfiles: Record<
  AwsSandboxAdapterConfig['resourceProfile'],
  AwsWorkerPodSpec['resources']
> = {
  small: {
    cpu: '500m',
    memory: '1Gi',
    ephemeralStorage: '20Gi',
  },
  standard: {
    cpu: '1000m',
    memory: '2Gi',
    ephemeralStorage: '40Gi',
  },
  large: {
    cpu: '2000m',
    memory: '4Gi',
    ephemeralStorage: '80Gi',
  },
};

export class AwsEksFargateSandboxManager implements SandboxManager {
  constructor(
    readonly config: AwsSandboxAdapterConfig,
    private readonly kubernetesClient?: AwsSandboxKubernetesClient,
  ) {}

  async createSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    return this.startSandbox(input);
  }

  async startSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    const podSpec = await this.buildWorkerPodSpec(input);
    await this.requireKubernetesClient('start sandboxes').applyWorkerPod(podSpec);
    return {
      state: 'starting',
      routerBaseUrl: this.config.routerBaseUrl,
      workerServiceName: podSpec.serviceName,
      k8sNamespace: this.config.namespace,
      k8sPodName: podSpec.podName,
      statusReason: 'Worker Pod has been applied and is waiting for readiness.',
      startupProgress: 25,
    };
  }

  async stopSandbox(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    const podName = this.podName(input.sandboxId);
    const workerServiceName = this.workerServiceName(input.sandboxId);
    const result = await this.requireKubernetesClient('stop sandboxes').deleteWorkerPod({
      namespace: this.config.namespace,
      podName,
      serviceName: workerServiceName,
    });
    return {
      state: result.deleted ? 'stopping' : 'stopped',
      routerBaseUrl: this.config.routerBaseUrl,
      workerServiceName,
      k8sNamespace: this.config.namespace,
      k8sPodName: podName,
      statusReason: result.deleted
        ? 'Worker Pod deletion has been requested.'
        : 'Worker Pod was already absent.',
      startupProgress: result.deleted ? 25 : 0,
    };
  }

  async restartSandbox(input: SandboxStartInput): Promise<SandboxProvisionResult> {
    await this.stopSandbox(input);
    return this.startSandbox(input);
  }

  async deleteSandbox(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    await this.stopSandbox(input);
    return {
      state: 'deleted',
      routerBaseUrl: this.config.routerBaseUrl,
      workerServiceName: this.workerServiceName(input.sandboxId),
      k8sNamespace: this.config.namespace,
      k8sPodName: this.podName(input.sandboxId),
    };
  }

  async getSandboxStatus(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    const podName = this.podName(input.sandboxId);
    const workerServiceName = this.workerServiceName(input.sandboxId);
    const podStatus = await this.requireKubernetesClient('poll sandbox status').getWorkerPod({
      namespace: this.config.namespace,
      podName,
    });
    return this.resultFromPodStatus({
      podStatus,
      podName,
      workerServiceName,
    });
  }

  async getSandboxEndpoint(input: { sandboxId: string }): Promise<{ routerBaseUrl: string | null }> {
    const endpoint = await this.requireKubernetesClient('discover sandbox endpoints').getWorkerEndpoint({
      namespace: this.config.namespace,
      serviceName: this.workerServiceName(input.sandboxId),
    });
    return {
      routerBaseUrl: endpoint.routerBaseUrl ?? this.config.routerBaseUrl,
    };
  }

  async prepareSandboxEnvironment(input: SandboxStartInput): Promise<SandboxEnvironmentSpec> {
    return {
      env: {
        REMOTE_CODEX_RUNTIME_ROLE: 'worker',
        REMOTE_CODEX_SANDBOX_ID: input.sandboxId,
        REMOTE_CODEX_USER_ID: input.userId,
        REMOTE_CODEX_SANDBOX_REGION: input.region,
        REMOTE_CODEX_SANDBOX_S3_PREFIX: input.s3Prefix,
        SANDBOX_ROUTER_BASE_URL: this.config.routerBaseUrl,
        ...(input.gateway
          ? {
              REMOTE_CODEX_LLM_GATEWAY_BASE_URL: input.gateway.baseUrl,
              REMOTE_CODEX_LLM_GATEWAY_KEY_ID: input.gateway.keyId,
            }
          : {}),
        ...(input.harness
          ? {
              ELAGENTE_HARNESS_BASE_URL: input.harness.baseUrl,
              REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: input.harness.chemistryToolsEnabled
                ? 'true'
                : 'false',
            }
          : {}),
        WORKSPACE_ROOT: '/workspace',
        HOME: '/home/agent',
      },
      secretEnv: {
        REMOTE_CODEX_WORKER_AUTH_TOKEN: {
          secretName: this.config.workerAuthTokenSecretName,
          key: 'token',
        },
        ...(input.gateway?.tokenSecretName
          ? {
              REMOTE_CODEX_LLM_GATEWAY_TOKEN: {
                secretName: input.gateway.tokenSecretName,
                key: input.gateway.keyId,
              },
            }
          : {}),
        ...(input.harness?.appKeySecretName
          ? {
              INACT_X_APP_KEY: {
                secretName: input.harness.appKeySecretName,
                key: input.sandboxId,
              },
            }
          : {}),
      },
    };
  }

  private async buildWorkerPodSpec(input: SandboxStartInput): Promise<AwsWorkerPodSpec> {
    const env = await this.prepareSandboxEnvironment(input);
    const image = `${this.config.imageRepository}:${this.config.imageTag}`;
    return {
      namespace: this.config.namespace,
      podName: this.podName(input.sandboxId),
      serviceName: this.workerServiceName(input.sandboxId),
      image,
      serviceAccountName: this.config.serviceAccountName,
      labels: {
        'app.kubernetes.io/name': 'remote-codex-worker',
        'remote-codex/runtime-role': 'worker',
        'remote-codex/sandbox-id': input.sandboxId,
        'remote-codex/user-id': input.userId,
        'remote-codex/image-tag': this.config.imageTag,
        'remote-codex/resource-profile': this.config.resourceProfile,
      },
      env: env.env,
      secretEnv: env.secretEnv ?? {},
      subnetIds: this.config.subnetIds,
      securityGroupIds: this.config.securityGroupIds,
      resourceProfile: this.config.resourceProfile,
      resources: awsResourceProfiles[this.config.resourceProfile],
    };
  }

  private resultFromPodStatus(input: {
    podStatus: AwsWorkerPodStatus | null;
    podName: string;
    workerServiceName: string;
  }): SandboxProvisionResult {
    const base = {
      routerBaseUrl: this.config.routerBaseUrl,
      workerServiceName: input.workerServiceName,
      k8sNamespace: this.config.namespace,
      k8sPodName: input.podName,
    };

    if (!input.podStatus) {
      return {
        ...base,
        state: 'stopped',
        statusReason: 'Worker Pod is absent.',
      };
    }

    const reason = input.podStatus.reason ?? undefined;
    const message = input.podStatus.message ?? undefined;
    const statusReason = message ?? reason ?? undefined;

    if (input.podStatus.phase === 'Running' && input.podStatus.ready) {
      return {
        ...base,
        state: 'running',
        statusReason: 'Worker Pod is running and ready.',
        startupProgress: 100,
        lastFailureCode: null,
        lastFailureMessage: null,
      };
    }

    if (input.podStatus.phase === 'Running') {
      return {
        ...base,
        state: reason === 'ReadinessTimeout' ? 'failed' : 'degraded',
        statusReason: statusReason ?? 'Worker Pod is running but not ready.',
        startupProgress: reason === 'ReadinessTimeout' ? 100 : 75,
        lastFailureCode: reason === 'ReadinessTimeout' ? 'readiness_timeout' : null,
        lastFailureMessage: reason === 'ReadinessTimeout' ? statusReason ?? null : null,
      };
    }

    if (input.podStatus.phase === 'Pending') {
      if (reason === 'Unschedulable' || reason === 'FailedScheduling') {
        return {
          ...base,
          state: 'failed',
          statusReason: statusReason ?? 'Worker Pod cannot be scheduled.',
          startupProgress: 25,
          lastFailureCode: 'capacity',
          lastFailureMessage: statusReason ?? null,
        };
      }
      if (reason === 'ErrImagePull' || reason === 'ImagePullBackOff') {
        return {
          ...base,
          state: 'failed',
          statusReason: statusReason ?? 'Worker image cannot be pulled.',
          startupProgress: 25,
          lastFailureCode: 'image_pull',
          lastFailureMessage: statusReason ?? null,
        };
      }
      return {
        ...base,
        state: 'starting',
        statusReason: statusReason ?? 'Worker Pod is pending.',
        startupProgress: 50,
      };
    }

    if (input.podStatus.phase === 'Succeeded') {
      return {
        ...base,
        state: 'stopped',
        statusReason: statusReason ?? 'Worker Pod completed.',
        startupProgress: 0,
      };
    }

    if (input.podStatus.phase === 'Failed') {
      return {
        ...base,
        state: 'failed',
        statusReason: statusReason ?? 'Worker Pod failed.',
        startupProgress: 100,
        lastFailureCode: reason ?? 'pod_failed',
        lastFailureMessage: statusReason ?? null,
      };
    }

    return {
      ...base,
      state: 'unknown',
      statusReason: statusReason ?? 'Worker Pod state is unknown.',
      startupProgress: 0,
    };
  }

  private podName(sandboxId: string) {
    const safeSandboxId = sandboxId
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/^-+|-+$/g, '');
    return `remote-codex-worker-${safeSandboxId}`.slice(0, 63);
  }

  private workerServiceName(sandboxId: string) {
    return this.podName(sandboxId);
  }

  private requireKubernetesClient(operation: string) {
    if (!this.kubernetesClient) {
      throw new SandboxManagerError(
        'config',
        `AWS Kubernetes client is required to ${operation}.`,
      );
    }
    return this.kubernetesClient;
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
  rotateSandboxKey(input: {
    userId: string;
    sandboxId: string;
    externalUserId: string;
    externalKeyId: string;
  }): Promise<GatewayKeyResult>;
  revokeSandboxKey(input: {
    userId: string;
    sandboxId: string;
    externalUserId: string;
    externalKeyId: string;
  }): Promise<void>;
}

type GatewayFetch = typeof fetch;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

async function parseGatewayResponse<T>(response: Response): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'message' in payload &&
      typeof payload.message === 'string'
        ? payload.message
        : `Gateway admin request failed with status ${response.status}.`;
    throw new SandboxManagerError('provider', message);
  }
  return payload as T;
}

function externalIdFromPayload(payload: unknown, fallbackName: string) {
  if (!payload || typeof payload !== 'object') {
    throw new SandboxManagerError('provider', `Gateway admin response missing ${fallbackName}.`);
  }
  const candidate =
    'externalUserId' in payload
      ? payload.externalUserId
      : 'externalKeyId' in payload
        ? payload.externalKeyId
        : 'id' in payload
          ? payload.id
          : null;
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw new SandboxManagerError('provider', `Gateway admin response missing ${fallbackName}.`);
  }
  return candidate;
}

export class HttpLlmGatewayAdmin implements LlmGatewayAdmin {
  private readonly baseUrl: string;

  constructor(
    input: {
      baseUrl: string;
      adminToken: string;
      fetchImpl?: GatewayFetch;
    },
  ) {
    this.baseUrl = trimTrailingSlash(input.baseUrl);
    this.adminToken = input.adminToken;
    this.fetchImpl = input.fetchImpl ?? fetch;
  }

  private readonly adminToken: string;
  private readonly fetchImpl: GatewayFetch;

  async ensureUser(input: {
    userId: string;
    email: string;
    displayName?: string | null;
  }): Promise<GatewayUserResult> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/admin/users/ensure`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.adminToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        externalId: input.userId,
        email: input.email,
        displayName: input.displayName ?? null,
      }),
    });
    const payload = await parseGatewayResponse<unknown>(response);
    return {
      externalUserId: externalIdFromPayload(payload, 'external user id'),
    };
  }

  async ensureSandboxKey(input: {
    userId: string;
    sandboxId: string;
    externalUserId: string;
  }): Promise<GatewayKeyResult> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/admin/users/${encodeURIComponent(input.externalUserId)}/keys/ensure`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          externalId: input.sandboxId,
          userId: input.userId,
          sandboxId: input.sandboxId,
        }),
      },
    );
    const payload = await parseGatewayResponse<unknown>(response);
    return {
      externalKeyId: externalIdFromPayload(payload, 'external key id'),
      keyCiphertext:
        payload &&
        typeof payload === 'object' &&
        'keyCiphertext' in payload &&
        typeof payload.keyCiphertext === 'string'
          ? payload.keyCiphertext
          : null,
    };
  }

  async rotateSandboxKey(input: {
    userId: string;
    sandboxId: string;
    externalUserId: string;
    externalKeyId: string;
  }): Promise<GatewayKeyResult> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/admin/users/${encodeURIComponent(input.externalUserId)}/keys/${encodeURIComponent(input.externalKeyId)}/rotate`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userId: input.userId,
          sandboxId: input.sandboxId,
        }),
      },
    );
    const payload = await parseGatewayResponse<unknown>(response);
    return {
      externalKeyId: externalIdFromPayload(payload, 'external key id'),
      keyCiphertext:
        payload &&
        typeof payload === 'object' &&
        'keyCiphertext' in payload &&
        typeof payload.keyCiphertext === 'string'
          ? payload.keyCiphertext
          : null,
    };
  }

  async revokeSandboxKey(input: {
    userId: string;
    sandboxId: string;
    externalUserId: string;
    externalKeyId: string;
  }): Promise<void> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/admin/users/${encodeURIComponent(input.externalUserId)}/keys/${encodeURIComponent(input.externalKeyId)}/revoke`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.adminToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          userId: input.userId,
          sandboxId: input.sandboxId,
        }),
      },
    );
    await parseGatewayResponse<unknown>(response);
  }
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

  async rotateSandboxKey(input: { sandboxId: string }): Promise<GatewayKeyResult> {
    return {
      externalKeyId: `sub2api-key-${input.sandboxId}-rotated`,
      keyCiphertext: null,
    };
  }

  async revokeSandboxKey(): Promise<void> {}
}
