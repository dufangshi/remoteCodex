import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execFileAsync = promisify(execFile);

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

export interface SandboxRuntimeResource {
  sandboxId: string;
  userId?: string | null;
  state?: string | null;
  labels?: Record<string, string>;
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
  listRuntimeResources?(): Promise<SandboxRuntimeResource[]>;
  cleanupRuntimeResource?(input: {
    sandboxId: string;
    userId?: string | null;
    reason: string;
  }): Promise<SandboxProvisionResult>;
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

  async listRuntimeResources(): Promise<SandboxRuntimeResource[]> {
    return [];
  }

  async cleanupRuntimeResource(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    return {
      state: 'deleted',
      k8sNamespace: 'remote-codex-sandboxes',
      k8sPodName: `sandbox-${input.sandboxId}`,
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

  async listRuntimeResources(): Promise<SandboxRuntimeResource[]> {
    return [...this.processes.keys()].map((sandboxId) => ({
      sandboxId,
      state: 'running',
      labels: {
        'remote-codex.dev/sandbox-id': sandboxId,
      },
    }));
  }

  async cleanupRuntimeResource(input: { sandboxId: string }): Promise<SandboxProvisionResult> {
    return this.stopSandbox({ sandboxId: input.sandboxId });
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
  SANDBOX_ENVIRONMENT: z.string().min(1).optional(),
  NODE_ENV: z.string().min(1).optional(),
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
  environmentName: string;
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

export interface AwsWorkerRuntimeResource extends SandboxRuntimeResource {
  podName: string;
  serviceName?: string | null;
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
  listWorkerPods?(input: {
    namespace: string;
    selector: Record<string, string>;
  }): Promise<AwsWorkerRuntimeResource[]>;
}

function shellJson(value: unknown) {
  return JSON.stringify(value);
}

function labelsToSelector(selector: Record<string, string>) {
  return Object.entries(selector)
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
}

function workerPodManifest(spec: AwsWorkerPodSpec) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: spec.podName,
      namespace: spec.namespace,
      labels: spec.labels,
      annotations: {
        'remote-codex.dev/subnet-ids': spec.subnetIds.join(','),
        'remote-codex.dev/security-group-ids': spec.securityGroupIds.join(','),
      },
    },
    spec: {
      serviceAccountName: spec.serviceAccountName,
      restartPolicy: 'Never',
      containers: [
        {
          name: 'worker',
          image: spec.image,
          imagePullPolicy: 'IfNotPresent',
          ports: [
            {
              name: 'http',
              containerPort: 8787,
            },
          ],
          env: [
            ...Object.entries(spec.env).map(([name, value]) => ({ name, value })),
            ...Object.entries(spec.secretEnv).map(([name, ref]) => ({
              name,
              valueFrom: {
                secretKeyRef: {
                  name: ref.secretName,
                  key: ref.key,
                },
              },
            })),
          ],
          resources: {
            requests: {
              cpu: spec.resources.cpu,
              memory: spec.resources.memory,
              'ephemeral-storage': spec.resources.ephemeralStorage,
            },
            limits: {
              cpu: spec.resources.cpu,
              memory: spec.resources.memory,
              'ephemeral-storage': spec.resources.ephemeralStorage,
            },
          },
          readinessProbe: {
            httpGet: {
              path: '/readyz',
              port: 'http',
            },
            initialDelaySeconds: 5,
            periodSeconds: 10,
            failureThreshold: 18,
          },
          livenessProbe: {
            httpGet: {
              path: '/readyz',
              port: 'http',
            },
            initialDelaySeconds: 20,
            periodSeconds: 30,
          },
        },
      ],
    },
  };
}

function workerServiceManifest(spec: AwsWorkerPodSpec) {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: {
      name: spec.serviceName,
      namespace: spec.namespace,
      labels: spec.labels,
    },
    spec: {
      type: 'ClusterIP',
      selector: {
        'remote-codex.dev/sandbox-id': spec.labels['remote-codex.dev/sandbox-id'],
        'remote-codex.dev/runtime-role': 'worker',
      },
      ports: [
        {
          name: 'http',
          port: 8787,
          targetPort: 'http',
        },
      ],
    },
  };
}

function podReadyFromStatus(pod: any) {
  const conditions = Array.isArray(pod?.status?.conditions) ? pod.status.conditions : [];
  return conditions.some(
    (condition: any) => condition?.type === 'Ready' && condition?.status === 'True',
  );
}

function podReasonFromStatus(pod: any) {
  const containerStatuses = Array.isArray(pod?.status?.containerStatuses)
    ? pod.status.containerStatuses
    : [];
  const waiting = containerStatuses
    .map((status: any) => status?.state?.waiting)
    .find((state: any) => state?.reason || state?.message);
  if (waiting) {
    return {
      reason: waiting.reason ?? null,
      message: waiting.message ?? null,
    };
  }

  const conditions = Array.isArray(pod?.status?.conditions) ? pod.status.conditions : [];
  const notReady = conditions
    .filter((condition: any) => condition?.status !== 'True')
    .find((condition: any) => condition?.reason || condition?.message);
  return {
    reason: notReady?.reason ?? pod?.status?.reason ?? null,
    message: notReady?.message ?? pod?.status?.message ?? null,
  };
}

export class KubectlAwsSandboxKubernetesClient implements AwsSandboxKubernetesClient {
  constructor(
    private readonly input: {
      kubectlPath?: string;
      timeoutMs?: number;
    } = {},
  ) {}

  async applyWorkerPod(spec: AwsWorkerPodSpec): Promise<void> {
    await this.kubectl([
      'apply',
      '-f',
      '-',
    ], `${shellJson(workerServiceManifest(spec))}\n---\n${shellJson(workerPodManifest(spec))}\n`);
  }

  async deleteWorkerPod(input: {
    namespace: string;
    podName: string;
    serviceName: string;
  }): Promise<{ deleted: boolean }> {
    const podExists = await this.exists(['get', 'pod', input.podName, '-n', input.namespace]);
    const serviceExists = await this.exists(['get', 'service', input.serviceName, '-n', input.namespace]);
    await this.kubectl([
      'delete',
      'pod',
      input.podName,
      '-n',
      input.namespace,
      '--ignore-not-found=true',
    ]);
    await this.kubectl([
      'delete',
      'service',
      input.serviceName,
      '-n',
      input.namespace,
      '--ignore-not-found=true',
    ]);
    return { deleted: podExists || serviceExists };
  }

  async getWorkerPod(input: {
    namespace: string;
    podName: string;
  }): Promise<AwsWorkerPodStatus | null> {
    const result = await this.kubectl([
      'get',
      'pod',
      input.podName,
      '-n',
      input.namespace,
      '-o',
      'json',
    ], undefined, { allowNotFound: true });
    if (result.notFound) {
      return null;
    }
    const pod = JSON.parse(result.stdout);
    const reason = podReasonFromStatus(pod);
    return {
      phase: pod?.status?.phase ?? 'Unknown',
      ready: podReadyFromStatus(pod),
      reason: reason.reason,
      message: reason.message,
    };
  }

  async getWorkerEndpoint(input: {
    namespace: string;
    serviceName: string;
  }): Promise<AwsWorkerEndpoint> {
    return {
      workerServiceName: input.serviceName,
    };
  }

  async listWorkerPods(input: {
    namespace: string;
    selector: Record<string, string>;
  }): Promise<AwsWorkerRuntimeResource[]> {
    const result = await this.kubectl([
      'get',
      'pods',
      '-n',
      input.namespace,
      '-l',
      labelsToSelector(input.selector),
      '-o',
      'json',
    ]);
    const payload = JSON.parse(result.stdout);
    const items = Array.isArray(payload.items) ? payload.items : [];
    return items.map((pod: any) => ({
      sandboxId:
        pod?.metadata?.labels?.['remote-codex.dev/sandbox-id'] ??
        pod?.metadata?.labels?.['remote-codex/sandbox-id'] ??
        pod?.metadata?.name,
      userId:
        pod?.metadata?.labels?.['remote-codex.dev/user-id'] ??
        pod?.metadata?.labels?.['remote-codex/user-id'] ??
        null,
      podName: pod?.metadata?.name,
      serviceName: pod?.metadata?.name,
      state: pod?.status?.phase ?? 'Unknown',
      labels: pod?.metadata?.labels ?? {},
    }));
  }

  private async exists(args: string[]) {
    const result = await this.kubectl(args, undefined, { allowNotFound: true });
    return !result.notFound;
  }

  private async kubectl(
    args: string[],
    stdin?: string,
    options: { allowNotFound?: boolean } = {},
  ): Promise<{ stdout: string; notFound: boolean }> {
    try {
      if (stdin !== undefined) {
        const result = await this.spawnKubectl(args, stdin);
        return { stdout: result.stdout, notFound: false };
      }
      const result = await execFileAsync(this.input.kubectlPath ?? 'kubectl', args, {
        timeout: this.input.timeoutMs ?? 60_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return { stdout: result.stdout, notFound: false };
    } catch (error) {
      const failure = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
      };
      const stderr = failure.stderr ?? '';
      if (options.allowNotFound && /not found/i.test(stderr)) {
        return { stdout: failure.stdout ?? '', notFound: true };
      }
      if (options.allowNotFound && /not found/i.test(failure.message ?? '')) {
        return { stdout: failure.stdout ?? '', notFound: true };
      }
      throw new SandboxManagerError(
        'provider',
        `kubectl ${args.join(' ')} failed: ${stderr || failure.message || String(error)}`,
      );
    }
  }

  private spawnKubectl(args: string[], stdin: string): Promise<{ stdout: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.input.kubectlPath ?? 'kubectl', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`kubectl ${args.join(' ')} timed out.`));
      }, this.input.timeoutMs ?? 60_000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve({ stdout });
          return;
        }
        reject(new Error(stderr || `kubectl ${args.join(' ')} exited with code ${code}.`));
      });
      child.stdin.end(stdin);
    });
  }
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
    environmentName: kubernetesLabelValue(parsed.SANDBOX_ENVIRONMENT ?? parsed.NODE_ENV ?? 'development'),
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

const sandboxWorkerCleanupScope = 'sandbox-worker';

function kubernetesLabelValue(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
  if (normalized.length > 0 && normalized.length <= 63) {
    return normalized;
  }
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 12);
  const prefix = normalized
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 50)
    .replace(/[^a-z0-9]+$/g, '');
  return prefix ? `${prefix}-${digest}` : digest;
}

export function awsSandboxWorkerLabels(input: {
  sandboxId: string;
  userId: string;
  imageTag: string;
  resourceProfile: AwsSandboxAdapterConfig['resourceProfile'];
  environmentName: string;
}) {
  const sandboxId = kubernetesLabelValue(input.sandboxId);
  const userId = kubernetesLabelValue(input.userId);
  const imageTag = kubernetesLabelValue(input.imageTag);
  const environmentName = kubernetesLabelValue(input.environmentName);
  return {
    'app.kubernetes.io/name': 'remote-codex-worker',
    'app.kubernetes.io/part-of': 'remote-codex',
    'app.kubernetes.io/component': 'sandbox-worker',
    'app.kubernetes.io/managed-by': 'remote-codex-control-plane',
    'app.kubernetes.io/instance': sandboxId,
    'remote-codex.dev/runtime-role': 'worker',
    'remote-codex.dev/cleanup-scope': sandboxWorkerCleanupScope,
    'remote-codex.dev/environment': environmentName,
    'remote-codex.dev/sandbox-id': sandboxId,
    'remote-codex.dev/user-id': userId,
    'remote-codex.dev/image-tag': imageTag,
    'remote-codex.dev/resource-profile': input.resourceProfile,
    'remote-codex/runtime-role': 'worker',
    'remote-codex/sandbox-id': sandboxId,
    'remote-codex/user-id': userId,
    'remote-codex/image-tag': imageTag,
    'remote-codex/resource-profile': input.resourceProfile,
  };
}

export function awsSandboxWorkerCleanupSelector(input: {
  environmentName: string;
  sandboxId?: string;
}) {
  const labels: Record<string, string> = {
    'remote-codex.dev/cleanup-scope': sandboxWorkerCleanupScope,
    'remote-codex.dev/environment': kubernetesLabelValue(input.environmentName),
  };
  if (input.sandboxId) {
    labels['remote-codex.dev/sandbox-id'] = kubernetesLabelValue(input.sandboxId);
  }
  return labels;
}

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

  async listRuntimeResources(): Promise<SandboxRuntimeResource[]> {
    if (!this.kubernetesClient?.listWorkerPods) {
      return [];
    }
    return this.kubernetesClient.listWorkerPods({
      namespace: this.config.namespace,
      selector: awsSandboxWorkerCleanupSelector({
        environmentName: this.config.environmentName,
      }),
    });
  }

  async cleanupRuntimeResource(input: {
    sandboxId: string;
    userId?: string | null;
  }): Promise<SandboxProvisionResult> {
    return this.stopSandbox({
      sandboxId: input.sandboxId,
    });
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
          : {
              REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: '',
            }),
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
      labels: awsSandboxWorkerLabels({
        sandboxId: input.sandboxId,
        userId: input.userId,
        imageTag: this.config.imageTag,
        resourceProfile: this.config.resourceProfile,
        environmentName: this.config.environmentName,
      }),
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

export interface GatewayUsageExportEvent {
  eventId: string;
  externalKeyId: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  costUsd?: number;
  currency?: string;
  occurredAt?: string;
}

export interface GatewayUsageExportResult {
  events: GatewayUsageExportEvent[];
  nextCursor?: string | null;
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
  reconcileSandboxKey(input: {
    userId: string;
    sandboxId: string;
    externalUserId: string;
    externalKeyId?: string | null;
  }): Promise<GatewayKeyResult>;
  exportUsage(input?: {
    cursor?: string | null;
    limit?: number;
  }): Promise<GatewayUsageExportResult>;
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

function gatewayUsageEventsFromPayload(payload: unknown): GatewayUsageExportResult {
  if (!payload || typeof payload !== 'object' || !('events' in payload) || !Array.isArray(payload.events)) {
    throw new SandboxManagerError('provider', 'Gateway usage export response missing events.');
  }
  const nextCursor =
    'nextCursor' in payload && typeof payload.nextCursor === 'string'
      ? payload.nextCursor
      : null;
  return {
    events: payload.events.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        throw new SandboxManagerError('provider', 'Gateway usage export event is invalid.');
      }
      const eventId = 'eventId' in entry ? entry.eventId : null;
      const externalKeyId = 'externalKeyId' in entry ? entry.externalKeyId : null;
      const model = 'model' in entry ? entry.model : null;
      if (typeof eventId !== 'string' || !eventId.trim()) {
        throw new SandboxManagerError('provider', 'Gateway usage export event missing event id.');
      }
      if (typeof externalKeyId !== 'string' || !externalKeyId.trim()) {
        throw new SandboxManagerError('provider', 'Gateway usage export event missing external key id.');
      }
      if (typeof model !== 'string' || !model.trim()) {
        throw new SandboxManagerError('provider', 'Gateway usage export event missing model.');
      }
      return {
        eventId,
        externalKeyId,
        model,
        inputTokens:
          'inputTokens' in entry && typeof entry.inputTokens === 'number'
            ? entry.inputTokens
            : undefined,
        outputTokens:
          'outputTokens' in entry && typeof entry.outputTokens === 'number'
            ? entry.outputTokens
            : undefined,
        cachedTokens:
          'cachedTokens' in entry && typeof entry.cachedTokens === 'number'
            ? entry.cachedTokens
            : undefined,
        costUsd:
          'costUsd' in entry && typeof entry.costUsd === 'number'
            ? entry.costUsd
            : undefined,
        currency:
          'currency' in entry && typeof entry.currency === 'string'
            ? entry.currency
            : undefined,
        occurredAt:
          'occurredAt' in entry && typeof entry.occurredAt === 'string'
            ? entry.occurredAt
            : undefined,
      };
    }),
    nextCursor,
  };
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

  async reconcileSandboxKey(input: {
    userId: string;
    sandboxId: string;
    externalUserId: string;
    externalKeyId?: string | null;
  }): Promise<GatewayKeyResult> {
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/admin/users/${encodeURIComponent(input.externalUserId)}/keys/reconcile`,
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
          externalKeyId: input.externalKeyId ?? null,
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

  async exportUsage(input: {
    cursor?: string | null;
    limit?: number;
  } = {}): Promise<GatewayUsageExportResult> {
    const search = new URLSearchParams();
    if (input.cursor) {
      search.set('cursor', input.cursor);
    }
    if (input.limit) {
      search.set('limit', String(input.limit));
    }
    const query = search.toString();
    const response = await this.fetchImpl(
      `${this.baseUrl}/api/admin/usage/export${query ? `?${query}` : ''}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.adminToken}`,
        },
      },
    );
    const payload = await parseGatewayResponse<unknown>(response);
    return gatewayUsageEventsFromPayload(payload);
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

  async reconcileSandboxKey(input: { sandboxId: string }): Promise<GatewayKeyResult> {
    return {
      externalKeyId: `sub2api-key-${input.sandboxId}`,
      keyCiphertext: null,
    };
  }

  async exportUsage(): Promise<GatewayUsageExportResult> {
    return {
      events: [],
      nextCursor: null,
    };
  }
}
