import { describe, expect, it } from 'vitest';

import {
  AwsEksFargateSandboxManager,
  AwsSandboxKubernetesClient,
  AwsWorkerPodSpec,
  AwsWorkerPodStatus,
  LocalWorkerProcessSandboxManager,
  NoopSandboxManager,
  SandboxManagerError,
  loadAwsSandboxAdapterConfig,
} from './adapters';

const sandboxInput = {
  sandboxId: 'sbx_test',
  userId: 'user_test',
  image: 'remote-codex-worker:test',
  region: 'local',
  s3Prefix: 's3://example/test',
};

function awsConfig() {
  return loadAwsSandboxAdapterConfig({
    AWS_REGION: 'us-east-1',
    SANDBOX_EKS_CLUSTER_NAME: 'remote-codex-staging',
    SANDBOX_K8S_SERVICE_ACCOUNT: 'remote-codex-worker',
    SANDBOX_WORKER_IMAGE_REPOSITORY: '123456789012.dkr.ecr.us-east-1.amazonaws.com/remote-codex-worker',
    SANDBOX_WORKER_IMAGE_TAG: 'staging-abc123',
    SANDBOX_ROUTER_BASE_URL: 'https://sandbox-router.example.test',
    SANDBOX_WORKER_AUTH_TOKEN_SECRET_NAME: 'remote-codex-worker-token',
    SANDBOX_SUBNET_IDS: 'subnet-a',
    SANDBOX_SECURITY_GROUP_IDS: 'sg-worker',
  });
}

function mockKubernetesClient(
  input: {
    podStatus?: AwsWorkerPodStatus | null;
    deleteResult?: { deleted: boolean };
  } = {},
) {
  const calls: {
    appliedPods: AwsWorkerPodSpec[];
    deletedPods: Array<{ namespace: string; podName: string; serviceName: string }>;
    endpointRequests: Array<{ namespace: string; serviceName: string }>;
  } = {
    appliedPods: [],
    deletedPods: [],
    endpointRequests: [],
  };
  const client: AwsSandboxKubernetesClient = {
    async applyWorkerPod(spec) {
      calls.appliedPods.push(spec);
    },
    async deleteWorkerPod(request) {
      calls.deletedPods.push(request);
      return input.deleteResult ?? { deleted: true };
    },
    async getWorkerPod() {
      return input.podStatus ?? null;
    },
    async getWorkerEndpoint(request) {
      calls.endpointRequests.push(request);
      return {
        routerBaseUrl: 'https://sandbox-router.example.test',
        workerServiceName: request.serviceName,
      };
    },
  };

  return { client, calls };
}

describe('sandbox manager adapters', () => {
  it('prepares a worker environment with sandbox identity', async () => {
    const manager = new NoopSandboxManager('http://router.test');
    const env = await manager.prepareSandboxEnvironment(sandboxInput);

    expect(env.env).toMatchObject({
      REMOTE_CODEX_RUNTIME_ROLE: 'worker',
      REMOTE_CODEX_SANDBOX_ID: 'sbx_test',
      REMOTE_CODEX_USER_ID: 'user_test',
      WORKSPACE_ROOT: '/workspace',
    });
  });

  it('starts and stops a local worker process for development', async () => {
    const manager = new LocalWorkerProcessSandboxManager({
      routerBaseUrl: 'http://127.0.0.1:8791',
      workerCommand: process.execPath,
      workerArgs: ['-e', 'setInterval(() => {}, 1000)'],
      workerEnv: {
        REMOTE_CODEX_WORKER_AUTH_TOKEN: 'local-token',
      },
    });

    const started = await manager.startSandbox(sandboxInput);
    expect(started).toMatchObject({
      state: 'running',
      routerBaseUrl: 'http://127.0.0.1:8791',
      workerServiceName: 'local-worker-sbx_test',
    });

    await expect(manager.getSandboxStatus(sandboxInput)).resolves.toMatchObject({
      state: 'running',
    });

    const stopped = await manager.stopSandbox(sandboxInput);
    expect(stopped.state).toBe('stopped');
    await expect(manager.getSandboxStatus(sandboxInput)).resolves.toMatchObject({
      state: 'stopped',
    });
  });

  it('classifies sandbox manager errors for API mapping', () => {
    const error = new SandboxManagerError('capacity', 'No sandbox capacity is available.');

    expect(error.code).toBe('capacity');
    expect(error.message).toBe('No sandbox capacity is available.');
  });

  it('loads AWS EKS Fargate sandbox adapter configuration', () => {
    const config = loadAwsSandboxAdapterConfig({
      AWS_REGION: 'us-east-1',
      SANDBOX_EKS_CLUSTER_NAME: 'remote-codex-staging',
      SANDBOX_K8S_NAMESPACE: 'remote-codex-sandboxes',
      SANDBOX_K8S_SERVICE_ACCOUNT: 'remote-codex-worker',
      SANDBOX_WORKER_IMAGE_REPOSITORY: '123456789012.dkr.ecr.us-east-1.amazonaws.com/remote-codex-worker',
      SANDBOX_WORKER_IMAGE_TAG: 'staging-abc123',
      SANDBOX_ROUTER_BASE_URL: 'https://sandbox-router.example.test',
      SANDBOX_WORKER_AUTH_TOKEN_SECRET_NAME: 'remote-codex-worker-token',
      SANDBOX_SUBNET_IDS: 'subnet-a, subnet-b',
      SANDBOX_SECURITY_GROUP_IDS: 'sg-worker',
      SANDBOX_RESOURCE_PROFILE: 'standard',
    });

    expect(config).toMatchObject({
      region: 'us-east-1',
      clusterName: 'remote-codex-staging',
      namespace: 'remote-codex-sandboxes',
      serviceAccountName: 'remote-codex-worker',
      imageRepository: '123456789012.dkr.ecr.us-east-1.amazonaws.com/remote-codex-worker',
      imageTag: 'staging-abc123',
      routerBaseUrl: 'https://sandbox-router.example.test',
      workerAuthTokenSecretName: 'remote-codex-worker-token',
      subnetIds: ['subnet-a', 'subnet-b'],
      securityGroupIds: ['sg-worker'],
      resourceProfile: 'standard',
    });
  });

  it('rejects incomplete AWS sandbox adapter configuration', () => {
    expect(() =>
      loadAwsSandboxAdapterConfig({
        SANDBOX_EKS_CLUSTER_NAME: 'remote-codex-staging',
        SANDBOX_K8S_SERVICE_ACCOUNT: 'remote-codex-worker',
        SANDBOX_WORKER_IMAGE_REPOSITORY: 'repo',
        SANDBOX_WORKER_IMAGE_TAG: 'tag',
        SANDBOX_ROUTER_BASE_URL: 'https://sandbox-router.example.test',
        SANDBOX_WORKER_AUTH_TOKEN_SECRET_NAME: 'secret',
        SANDBOX_SUBNET_IDS: '  ',
        SANDBOX_SECURITY_GROUP_IDS: 'sg-worker',
      }),
    ).toThrow('SANDBOX_SUBNET_IDS must include at least one subnet id.');
  });

  it('prepares AWS worker identity without exposing provider root keys', async () => {
    const manager = new AwsEksFargateSandboxManager(awsConfig());

    const env = await manager.prepareSandboxEnvironment(sandboxInput);
    expect(env.env).toMatchObject({
      REMOTE_CODEX_RUNTIME_ROLE: 'worker',
      REMOTE_CODEX_SANDBOX_ID: 'sbx_test',
      REMOTE_CODEX_USER_ID: 'user_test',
      REMOTE_CODEX_SANDBOX_REGION: 'local',
      REMOTE_CODEX_SANDBOX_S3_PREFIX: 's3://example/test',
      SANDBOX_ROUTER_BASE_URL: 'https://sandbox-router.example.test',
      WORKSPACE_ROOT: '/workspace',
      HOME: '/home/agent',
    });
    expect(env.secretEnv).toMatchObject({
      REMOTE_CODEX_WORKER_AUTH_TOKEN: {
        secretName: 'remote-codex-worker-token',
        key: 'token',
      },
    });
    expect(Object.keys(env.env)).not.toContain('OPENAI_API_KEY');
    expect(Object.keys(env.env)).not.toContain('ANTHROPIC_API_KEY');
  });

  it('applies an AWS worker Pod spec with deterministic names, env, and secrets', async () => {
    const { client, calls } = mockKubernetesClient();
    const manager = new AwsEksFargateSandboxManager(awsConfig(), client);

    const result = await manager.startSandbox(sandboxInput);

    expect(result).toMatchObject({
      state: 'starting',
      routerBaseUrl: 'https://sandbox-router.example.test',
      workerServiceName: 'remote-codex-worker-sbx-test',
      k8sNamespace: 'remote-codex-sandboxes',
      k8sPodName: 'remote-codex-worker-sbx-test',
    });
    expect(calls.appliedPods).toHaveLength(1);
    const podSpec = calls.appliedPods[0];
    expect(podSpec).toBeDefined();
    expect(podSpec).toMatchObject({
      namespace: 'remote-codex-sandboxes',
      podName: 'remote-codex-worker-sbx-test',
      serviceName: 'remote-codex-worker-sbx-test',
      image: '123456789012.dkr.ecr.us-east-1.amazonaws.com/remote-codex-worker:staging-abc123',
      serviceAccountName: 'remote-codex-worker',
      subnetIds: ['subnet-a'],
      securityGroupIds: ['sg-worker'],
      resourceProfile: 'standard',
      resources: {
        cpu: '1000m',
        memory: '2Gi',
        ephemeralStorage: '40Gi',
      },
    });
    expect(podSpec!.labels).toMatchObject({
      'remote-codex/runtime-role': 'worker',
      'remote-codex/sandbox-id': 'sbx_test',
      'remote-codex/user-id': 'user_test',
      'remote-codex/image-tag': 'staging-abc123',
      'remote-codex/resource-profile': 'standard',
    });
    expect(podSpec!.env).toMatchObject({
      REMOTE_CODEX_RUNTIME_ROLE: 'worker',
      REMOTE_CODEX_SANDBOX_ID: 'sbx_test',
      REMOTE_CODEX_USER_ID: 'user_test',
      WORKSPACE_ROOT: '/workspace',
      HOME: '/home/agent',
    });
    expect(podSpec!.secretEnv).toMatchObject({
      REMOTE_CODEX_WORKER_AUTH_TOKEN: {
        secretName: 'remote-codex-worker-token',
        key: 'token',
      },
    });
  });

  it('deletes AWS worker Pod resources when stopping a sandbox', async () => {
    const { client, calls } = mockKubernetesClient();
    const manager = new AwsEksFargateSandboxManager(awsConfig(), client);

    const result = await manager.stopSandbox(sandboxInput);

    expect(result).toMatchObject({
      state: 'stopping',
      workerServiceName: 'remote-codex-worker-sbx-test',
      k8sPodName: 'remote-codex-worker-sbx-test',
      statusReason: 'Worker Pod deletion has been requested.',
    });
    expect(calls.deletedPods).toEqual([
      {
        namespace: 'remote-codex-sandboxes',
        podName: 'remote-codex-worker-sbx-test',
        serviceName: 'remote-codex-worker-sbx-test',
      },
    ]);
  });

  it('maps AWS worker Pod status to sandbox lifecycle states', async () => {
    const ready = new AwsEksFargateSandboxManager(
      awsConfig(),
      mockKubernetesClient({ podStatus: { phase: 'Running', ready: true } }).client,
    );
    await expect(ready.getSandboxStatus(sandboxInput)).resolves.toMatchObject({
      state: 'running',
      statusReason: 'Worker Pod is running and ready.',
      startupProgress: 100,
      lastFailureCode: null,
      lastFailureMessage: null,
    });

    const pending = new AwsEksFargateSandboxManager(
      awsConfig(),
      mockKubernetesClient({ podStatus: { phase: 'Pending', ready: false } }).client,
    );
    await expect(pending.getSandboxStatus(sandboxInput)).resolves.toMatchObject({
      state: 'starting',
      statusReason: 'Worker Pod is pending.',
    });

    const imagePullFailure = new AwsEksFargateSandboxManager(
      awsConfig(),
      mockKubernetesClient({
        podStatus: {
          phase: 'Pending',
          ready: false,
          reason: 'ImagePullBackOff',
          message: 'Cannot pull worker image.',
        },
      }).client,
    );
    await expect(imagePullFailure.getSandboxStatus(sandboxInput)).resolves.toMatchObject({
      state: 'failed',
      statusReason: 'Cannot pull worker image.',
      startupProgress: 25,
      lastFailureCode: 'image_pull',
      lastFailureMessage: 'Cannot pull worker image.',
    });

    const capacityFailure = new AwsEksFargateSandboxManager(
      awsConfig(),
      mockKubernetesClient({
        podStatus: {
          phase: 'Pending',
          ready: false,
          reason: 'Unschedulable',
          message: 'No Fargate capacity is currently available.',
        },
      }).client,
    );
    await expect(capacityFailure.getSandboxStatus(sandboxInput)).resolves.toMatchObject({
      state: 'failed',
      statusReason: 'No Fargate capacity is currently available.',
      startupProgress: 25,
      lastFailureCode: 'capacity',
      lastFailureMessage: 'No Fargate capacity is currently available.',
    });

    const readinessFailure = new AwsEksFargateSandboxManager(
      awsConfig(),
      mockKubernetesClient({
        podStatus: {
          phase: 'Running',
          ready: false,
          reason: 'ReadinessTimeout',
          message: 'Worker did not become ready before timeout.',
        },
      }).client,
    );
    await expect(readinessFailure.getSandboxStatus(sandboxInput)).resolves.toMatchObject({
      state: 'failed',
      statusReason: 'Worker did not become ready before timeout.',
      startupProgress: 100,
      lastFailureCode: 'readiness_timeout',
      lastFailureMessage: 'Worker did not become ready before timeout.',
    });

    const absent = new AwsEksFargateSandboxManager(
      awsConfig(),
      mockKubernetesClient({ podStatus: null }).client,
    );
    await expect(absent.getSandboxStatus(sandboxInput)).resolves.toMatchObject({
      state: 'stopped',
      statusReason: 'Worker Pod is absent.',
    });
  });

  it('discovers AWS worker endpoint through the Kubernetes client', async () => {
    const { client, calls } = mockKubernetesClient();
    const manager = new AwsEksFargateSandboxManager(awsConfig(), client);

    await expect(manager.getSandboxEndpoint(sandboxInput)).resolves.toEqual({
      routerBaseUrl: 'https://sandbox-router.example.test',
    });
    expect(calls.endpointRequests).toEqual([
      {
        namespace: 'remote-codex-sandboxes',
        serviceName: 'remote-codex-worker-sbx-test',
      },
    ]);
  });

  it('fails closed when AWS lifecycle operations have no Kubernetes client', async () => {
    const manager = new AwsEksFargateSandboxManager(awsConfig());

    await expect(manager.startSandbox(sandboxInput)).rejects.toMatchObject({
      code: 'config',
      message: 'AWS Kubernetes client is required to start sandboxes.',
    });
  });
});
