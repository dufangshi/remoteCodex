import { describe, expect, it } from 'vitest';

import {
  AwsEksFargateSandboxManager,
  AwsSandboxSecretWriter,
  AwsSandboxKubernetesClient,
  AwsWorkerPodSpec,
  AwsWorkerPodStatus,
  HttpHarnessAdmin,
  HttpLlmGatewayAdmin,
  LocalWorkerProcessSandboxManager,
  NoopSandboxManager,
  SandboxManagerError,
  awsSandboxWorkerCleanupSelector,
  awsSandboxWorkerLabels,
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
    SANDBOX_WORKER_IMAGE_REPOSITORY:
      '123456789012.dkr.ecr.us-east-1.amazonaws.com/remote-codex-worker',
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
    secretWrites: Array<{
      namespace: string;
      secretName: string;
      key: string;
      value: string;
    }>;
    secretReads: Array<{ namespace: string; secretName: string; key: string }>;
    deletedPods: Array<{
      namespace: string;
      podName: string;
      serviceName: string;
    }>;
    endpointRequests: Array<{ namespace: string; serviceName: string }>;
  } = {
    appliedPods: [],
    secretWrites: [],
    secretReads: [],
    deletedPods: [],
    endpointRequests: [],
  };
  const client: AwsSandboxKubernetesClient = {
    async applyWorkerPod(spec) {
      calls.appliedPods.push(spec);
    },
    async upsertSecretKey(request) {
      calls.secretWrites.push(request);
    },
    async hasSecretKey(request) {
      calls.secretReads.push(request);
      return calls.secretWrites.some(
        (write) =>
          write.namespace === request.namespace &&
          write.secretName === request.secretName &&
          write.key === request.key,
      );
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

    await expect(manager.getSandboxStatus(sandboxInput)).resolves.toMatchObject(
      {
        state: 'running',
      },
    );

    const stopped = await manager.stopSandbox(sandboxInput);
    expect(stopped.state).toBe('stopped');
    await expect(manager.getSandboxStatus(sandboxInput)).resolves.toMatchObject(
      {
        state: 'stopped',
      },
    );
  });

  it('classifies sandbox manager errors for API mapping', () => {
    const error = new SandboxManagerError(
      'capacity',
      'No sandbox capacity is available.',
    );

    expect(error.code).toBe('capacity');
    expect(error.message).toBe('No sandbox capacity is available.');
  });

  it('loads AWS EKS Fargate sandbox adapter configuration', () => {
    const config = loadAwsSandboxAdapterConfig({
      AWS_REGION: 'us-east-1',
      SANDBOX_EKS_CLUSTER_NAME: 'remote-codex-staging',
      SANDBOX_K8S_NAMESPACE: 'remote-codex-sandboxes',
      SANDBOX_K8S_SERVICE_ACCOUNT: 'remote-codex-worker',
      SANDBOX_WORKER_IMAGE_REPOSITORY:
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/remote-codex-worker',
      SANDBOX_WORKER_IMAGE_TAG: 'staging-abc123',
      SANDBOX_ROUTER_BASE_URL: 'https://sandbox-router.example.test',
      SANDBOX_WORKER_AUTH_TOKEN_SECRET_NAME: 'remote-codex-worker-token',
      SANDBOX_SUBNET_IDS: 'subnet-a, subnet-b',
      SANDBOX_SECURITY_GROUP_IDS: 'sg-worker',
      SANDBOX_RESOURCE_PROFILE: 'standard',
      SANDBOX_ENVIRONMENT: 'staging',
    });

    expect(config).toMatchObject({
      region: 'us-east-1',
      environmentName: 'staging',
      clusterName: 'remote-codex-staging',
      namespace: 'remote-codex-sandboxes',
      serviceAccountName: 'remote-codex-worker',
      imageRepository:
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/remote-codex-worker',
      imageTag: 'staging-abc123',
      routerBaseUrl: 'https://sandbox-router.example.test',
      workerAuthTokenSecretName: 'remote-codex-worker-token',
      subnetIds: ['subnet-a', 'subnet-b'],
      securityGroupIds: ['sg-worker'],
      resourceProfile: 'standard',
      enabledAgentProviders: 'codex',
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

  it('builds deterministic AWS worker labels and cleanup selectors', () => {
    const labels = awsSandboxWorkerLabels({
      sandboxId: 'sbx_test',
      userId: 'user_test',
      imageTag: 'staging-abc123',
      resourceProfile: 'standard',
      environmentName: 'staging',
    });

    expect(labels).toMatchObject({
      'app.kubernetes.io/name': 'remote-codex-worker',
      'app.kubernetes.io/part-of': 'remote-codex',
      'app.kubernetes.io/component': 'sandbox-worker',
      'app.kubernetes.io/managed-by': 'remote-codex-control-plane',
      'app.kubernetes.io/instance': 'sbx_test',
      'remote-codex.dev/runtime-role': 'worker',
      'remote-codex.dev/cleanup-scope': 'sandbox-worker',
      'remote-codex.dev/environment': 'staging',
      'remote-codex.dev/sandbox-id': 'sbx_test',
      'remote-codex.dev/user-id': 'user_test',
      'remote-codex.dev/image-tag': 'staging-abc123',
      'remote-codex.dev/resource-profile': 'standard',
    });
    expect(
      awsSandboxWorkerCleanupSelector({ environmentName: 'staging' }),
    ).toEqual({
      'remote-codex.dev/cleanup-scope': 'sandbox-worker',
      'remote-codex.dev/environment': 'staging',
    });
    expect(
      awsSandboxWorkerCleanupSelector({
        environmentName: 'staging',
        sandboxId: 'sbx_test',
      }),
    ).toEqual({
      'remote-codex.dev/cleanup-scope': 'sandbox-worker',
      'remote-codex.dev/environment': 'staging',
      'remote-codex.dev/sandbox-id': 'sbx_test',
    });
  });

  it('prepares AWS worker identity without exposing provider root keys', async () => {
    const manager = new AwsEksFargateSandboxManager(awsConfig());

    const env = await manager.prepareSandboxEnvironment({
      ...sandboxInput,
      gateway: {
        baseUrl: 'https://llm-gateway.example.test',
        keyId: 'gw-key-sbx-test',
        tokenSecretName: 'remote-codex-gateway-tokens',
      },
      harness: {
        baseUrl: 'https://harness.example.test',
        appKeySecretName: 'remote-codex-harness-app-keys',
        chemistryToolsEnabled: true,
      },
    });
    expect(env.env).toMatchObject({
      REMOTE_CODEX_RUNTIME_ROLE: 'worker',
      REMOTE_CODEX_SANDBOX_ID: 'sbx_test',
      REMOTE_CODEX_USER_ID: 'user_test',
      REMOTE_CODEX_SANDBOX_REGION: 'local',
      REMOTE_CODEX_SANDBOX_S3_PREFIX: 's3://example/test',
      SANDBOX_ROUTER_BASE_URL: 'https://sandbox-router.example.test',
      REMOTE_CODEX_LLM_GATEWAY_BASE_URL: 'https://llm-gateway.example.test',
      REMOTE_CODEX_LLM_GATEWAY_KEY_ID: 'gw-key-sbx-test',
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex',
      ELAGENTE_HARNESS_BASE_URL: 'https://harness.example.test',
      REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
      WORKSPACE_ROOT: '/workspace',
      HOME: '/home/agent',
      CODEX_HOME: '/home/agent/.codex',
      CLAUDE_HOME: '/home/agent/.claude',
      CLAUDE_CONFIG_DIR: '/home/agent/.claude',
      OPENCODE_HOME: '/home/agent/.opencode',
      DATABASE_URL: '/home/agent/.remote-codex/worker.sqlite',
      REMOTE_CODEX_DISABLE_BUILD_RESTART: 'true',
    });
    expect(env.secretEnv).toMatchObject({
      REMOTE_CODEX_WORKER_AUTH_TOKEN: {
        secretName: 'remote-codex-worker-token',
        key: 'token',
      },
      REMOTE_CODEX_WORKER_IDENTITY_SECRET: {
        secretName: 'remote-codex-worker-token',
        key: 'identity-secret',
      },
      REMOTE_CODEX_LLM_GATEWAY_TOKEN: {
        secretName: 'remote-codex-gateway-tokens',
        key: 'gw-key-sbx-test',
      },
      INACT_X_APP_KEY: {
        secretName: 'remote-codex-harness-app-keys',
        key: 'sbx_test',
      },
    });
    expect(Object.keys(env.env)).not.toContain('OPENAI_API_KEY');
    expect(Object.keys(env.env)).not.toContain('ANTHROPIC_API_KEY');
    expect(Object.keys(env.env)).not.toContain(
      'REMOTE_CODEX_LLM_GATEWAY_TOKEN',
    );
    expect(Object.keys(env.env)).not.toContain('INACT_X_APP_KEY');
  });

  it('supports a control-plane managed staging gateway token without a Kubernetes Secret', async () => {
    const manager = new AwsEksFargateSandboxManager(awsConfig());

    const env = await manager.prepareSandboxEnvironment({
      ...sandboxInput,
      gateway: {
        baseUrl: 'https://llm-gateway.example.test',
        keyId: 'sub2api-api-key',
        tokenSecretName: 'remote-codex-gateway-tokens',
        staticToken: 'gateway-static-token',
      },
    });

    expect(env.env).toMatchObject({
      REMOTE_CODEX_LLM_GATEWAY_BASE_URL: 'https://llm-gateway.example.test',
      REMOTE_CODEX_LLM_GATEWAY_KEY_ID: 'sub2api-api-key',
      REMOTE_CODEX_LLM_GATEWAY_TOKEN: 'gateway-static-token',
    });
    expect(env.secretEnv).not.toHaveProperty('REMOTE_CODEX_LLM_GATEWAY_TOKEN');
  });

  it('uses the sub2api remote-codex admin contract for sandbox keys and usage export', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const admin = new HttpLlmGatewayAdmin({
      baseUrl: 'https://sub2api.example.test',
      adminToken: 'admin-token',
      fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        if (String(url).endsWith('/users/ensure')) {
          return Response.json({ externalUserId: '123', balance: 50 });
        }
        if (String(url).endsWith('/users/123/balance/ensure')) {
          return Response.json({
            externalUserId: '123',
            balance: 1000,
            previousBalance: 50,
            adjusted: true,
          });
        }
        if (String(url).includes('/keys/ensure')) {
          return Response.json({
            externalKeyId: '456',
            key: 'sk-sandbox-key',
          });
        }
        if (String(url).includes('/keys/456/rotate')) {
          return Response.json({
            externalKeyId: '789',
            keyCiphertext: 'sk-rotated-key',
          });
        }
        if (String(url).includes('/usage/export')) {
          return Response.json({
            events: [
              {
                eventId: 'usage-1',
                externalKeyId: '789',
                model: 'gpt-5.4',
                inputTokens: 12,
                outputTokens: 34,
                costUsd: 0.001,
                occurredAt: '2026-06-04T17:00:00Z',
              },
            ],
            nextCursor: 'cursor-next',
          });
        }
        return Response.json({});
      }) as typeof fetch,
    });

    await expect(
      admin.ensureUser({
        userId: 'control-user',
        email: 'user@example.com',
        displayName: 'User',
        balance: 1,
      }),
    ).resolves.toEqual({ externalUserId: '123', balance: 50 });
    await expect(
      admin.ensureUserBalance({
        externalUserId: '123',
        minimumBalance: 100,
        targetBalance: 1000,
      }),
    ).resolves.toEqual({
      externalUserId: '123',
      balance: 1000,
      previousBalance: 50,
      adjusted: true,
    });
    await expect(
      admin.ensureSandboxKey({
        userId: 'control-user',
        sandboxId: 'sandbox-1',
        externalUserId: '123',
        groupId: 42,
      }),
    ).resolves.toEqual({
      externalKeyId: '456',
      keyCiphertext: 'sk-sandbox-key',
    });
    await expect(
      admin.rotateSandboxKey({
        userId: 'control-user',
        sandboxId: 'sandbox-1',
        externalUserId: '123',
        externalKeyId: '456',
        groupId: 42,
      }),
    ).resolves.toEqual({
      externalKeyId: '789',
      keyCiphertext: 'sk-rotated-key',
    });
    await expect(
      admin.exportUsage({ cursor: 'cursor-current', limit: 25 }),
    ).resolves.toEqual({
      events: [
        {
          eventId: 'usage-1',
          externalKeyId: '789',
          model: 'gpt-5.4',
          inputTokens: 12,
          outputTokens: 34,
          cachedTokens: undefined,
          costUsd: 0.001,
          currency: undefined,
          occurredAt: '2026-06-04T17:00:00Z',
        },
      ],
      nextCursor: 'cursor-next',
    });

    expect(requests.map((request) => request.url)).toEqual([
      'https://sub2api.example.test/api/v1/admin/integrations/remote-codex/users/ensure',
      'https://sub2api.example.test/api/v1/admin/integrations/remote-codex/users/123/balance/ensure',
      'https://sub2api.example.test/api/v1/admin/integrations/remote-codex/users/123/keys/ensure',
      'https://sub2api.example.test/api/v1/admin/integrations/remote-codex/users/123/keys/456/rotate',
      'https://sub2api.example.test/api/v1/admin/integrations/remote-codex/usage/export?cursor=cursor-current&limit=25',
    ]);
    expect(JSON.parse(String(requests[0]!.init!.body))).toMatchObject({
      externalId: 'control-user',
      email: 'user@example.com',
      displayName: 'User',
      balance: 1,
    });
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      minimumBalance: 100,
      targetBalance: 1000,
    });
    expect(requests[2]?.init?.headers).toMatchObject({
      authorization: 'Bearer admin-token',
      'x-api-key': 'admin-token',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(requests[2]?.init?.body))).toMatchObject({
      externalId: 'sandbox-1',
      sandboxId: 'sandbox-1',
      group_id: 42,
    });
    expect(JSON.parse(String(requests[2]?.init?.body))).toMatchObject({
      sandboxId: 'sandbox-1',
      group_id: 42,
    });
  });

  it('lets control plane override the AWS worker enabled provider list at launch', async () => {
    const manager = new AwsEksFargateSandboxManager(awsConfig());

    const env = await manager.prepareSandboxEnvironment({
      ...sandboxInput,
      enabledAgentProviders: 'codex,opencode',
    });

    expect(env.env.REMOTE_CODEX_ENABLED_AGENT_PROVIDERS).toBe('codex,opencode');
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
    expect(calls.deletedPods).toEqual([
      {
        namespace: 'remote-codex-sandboxes',
        podName: 'remote-codex-worker-sbx-test',
        serviceName: 'remote-codex-worker-sbx-test',
      },
    ]);
    expect(calls.appliedPods).toHaveLength(1);
    const podSpec = calls.appliedPods[0];
    expect(podSpec).toBeDefined();
    expect(podSpec).toMatchObject({
      namespace: 'remote-codex-sandboxes',
      podName: 'remote-codex-worker-sbx-test',
      serviceName: 'remote-codex-worker-sbx-test',
      image:
        '123456789012.dkr.ecr.us-east-1.amazonaws.com/remote-codex-worker:staging-abc123',
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
      'app.kubernetes.io/name': 'remote-codex-worker',
      'app.kubernetes.io/part-of': 'remote-codex',
      'app.kubernetes.io/component': 'sandbox-worker',
      'app.kubernetes.io/managed-by': 'remote-codex-control-plane',
      'app.kubernetes.io/instance': 'sbx_test',
      'remote-codex.dev/runtime-role': 'worker',
      'remote-codex.dev/cleanup-scope': 'sandbox-worker',
      'remote-codex.dev/environment': 'development',
      'remote-codex.dev/sandbox-id': 'sbx_test',
      'remote-codex.dev/user-id': 'user_test',
      'remote-codex.dev/image-tag': 'staging-abc123',
      'remote-codex.dev/resource-profile': 'standard',
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
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex',
      HOST: '0.0.0.0',
      PORT: '8787',
      WORKSPACE_ROOT: '/workspace',
      HOME: '/home/agent',
      CODEX_HOME: '/home/agent/.codex',
      CLAUDE_HOME: '/home/agent/.claude',
      CLAUDE_CONFIG_DIR: '/home/agent/.claude',
      OPENCODE_HOME: '/home/agent/.opencode',
      DATABASE_URL: '/home/agent/.remote-codex/worker.sqlite',
      REMOTE_CODEX_DISABLE_BUILD_RESTART: 'true',
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
      mockKubernetesClient({ podStatus: { phase: 'Running', ready: true } })
        .client,
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
      mockKubernetesClient({ podStatus: { phase: 'Pending', ready: false } })
        .client,
    );
    await expect(pending.getSandboxStatus(sandboxInput)).resolves.toMatchObject(
      {
        state: 'starting',
        statusReason: 'Worker Pod is pending.',
      },
    );

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
    await expect(
      imagePullFailure.getSandboxStatus(sandboxInput),
    ).resolves.toMatchObject({
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
    await expect(
      capacityFailure.getSandboxStatus(sandboxInput),
    ).resolves.toMatchObject({
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
    await expect(
      readinessFailure.getSandboxStatus(sandboxInput),
    ).resolves.toMatchObject({
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

  it('writes sandbox secret values through the AWS Kubernetes client', async () => {
    const { client, calls } = mockKubernetesClient();
    const writer = new AwsSandboxSecretWriter({
      namespace: 'remote-codex-sandboxes',
      kubernetesClient: client,
    });

    await writer.putSecretValue({
      secretName: 'remote-codex-harness-app-keys',
      key: 'sbx_test',
      value: 'harness-api-key',
    });

    expect(calls.secretWrites).toEqual([
      {
        namespace: 'remote-codex-sandboxes',
        secretName: 'remote-codex-harness-app-keys',
        key: 'sbx_test',
        value: 'harness-api-key',
      },
    ]);
    await expect(
      writer.hasSecretValue({
        secretName: 'remote-codex-harness-app-keys',
        key: 'sbx_test',
      }),
    ).resolves.toBe(true);
    await expect(
      writer.hasSecretValue({
        secretName: 'remote-codex-harness-app-keys',
        key: 'missing',
      }),
    ).resolves.toBe(false);
    expect(calls.secretReads).toEqual([
      {
        namespace: 'remote-codex-sandboxes',
        secretName: 'remote-codex-harness-app-keys',
        key: 'sbx_test',
      },
      {
        namespace: 'remote-codex-sandboxes',
        secretName: 'remote-codex-harness-app-keys',
        key: 'missing',
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

describe('HTTP ElAgenteHarness admin', () => {
  it('ensures a sandbox key through the planned admin ensure API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({
        externalUserId: 'remote-codex:user:user-123',
        externalKeyId: 'harness-key-123',
        apiKey: 'harness-api-key-123',
      });
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test/',
      adminKey: 'admin-key',
      fetchImpl,
    });

    await expect(
      admin.ensureSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
        email: 'user@example.test',
      }),
    ).resolves.toEqual({
      externalKeyId: 'harness-key-123',
      apiKey: 'harness-api-key-123',
      keyCiphertext: null,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://harness.example.test/admin/members/ensure',
      init: {
        method: 'POST',
        headers: {
          'x-admin-key': 'admin-key',
          'content-type': 'application/json',
        },
      },
    });
    expect(JSON.parse(String(requests[0]!.init!.body))).toMatchObject({
      externalId: 'remote-codex:sandbox:sbx-123',
      userId: 'user-123',
      sandboxId: 'sbx-123',
      externalUserId: 'remote-codex:user:user-123',
      kind: 'agent',
    });
  });

  it('rotates a sandbox key through the planned Harness admin API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({
        externalKeyId: 'remote-codex:sandbox:sbx-123',
        apiKey: 'harness-api-key-rotated',
      });
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
    });

    await expect(
      admin.rotateSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
        externalKeyId: 'remote-codex:sandbox:sbx-123',
      }),
    ).resolves.toEqual({
      externalKeyId: 'remote-codex:sandbox:sbx-123',
      apiKey: 'harness-api-key-rotated',
      keyCiphertext: null,
    });
    expect(requests[0]).toMatchObject({
      url: 'https://harness.example.test/admin/members/remote-codex%3Asandbox%3Asbx-123/rekey',
      init: {
        method: 'POST',
        headers: {
          'x-admin-key': 'admin-key',
          'content-type': 'application/json',
        },
      },
    });
    expect(JSON.parse(String(requests[0]!.init!.body))).toEqual({
      userId: 'user-123',
      sandboxId: 'sbx-123',
      externalUserId: 'remote-codex:user:user-123',
    });
  });

  it('falls back to the current Harness rekey API when planned rotate is unavailable', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/admin/members/harness-key-42/rekey')) {
        return new Response('not found', { status: 404 });
      }
      return new Response('OK\napi_key = "harness-api-key-rotated"\n');
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
    });

    await expect(
      admin.rotateSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
        externalKeyId: 'harness-key-42',
      }),
    ).resolves.toEqual({
      externalKeyId: 'harness-key-42',
      apiKey: 'harness-api-key-rotated',
      keyCiphertext: null,
    });
    expect(requests.map((request) => request.url)).toEqual([
      'https://harness.example.test/admin/members/harness-key-42/rekey',
      'https://harness.example.test/admin/harness-key-42/rekey',
    ]);
  });

  it('revokes a sandbox key through the planned Harness admin API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({ status: 'revoked' });
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
    });

    await expect(
      admin.revokeSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
        externalKeyId: 'remote-codex:sandbox:sbx-123',
      }),
    ).resolves.toBeUndefined();
    expect(requests[0]).toMatchObject({
      url: 'https://harness.example.test/admin/members/remote-codex%3Asandbox%3Asbx-123/revoke',
      init: {
        method: 'POST',
        headers: {
          'x-admin-key': 'admin-key',
          'content-type': 'application/json',
        },
      },
    });
  });

  it('falls back to the current Harness delete API when planned revoke is unavailable', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/admin/members/harness-key-42/revoke')) {
        return new Response('not found', { status: 404 });
      }
      return new Response('OK\n');
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
    });

    await expect(
      admin.revokeSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
        externalKeyId: 'harness-key-42',
      }),
    ).resolves.toBeUndefined();
    expect(requests.map((request) => request.url)).toEqual([
      'https://harness.example.test/admin/members/harness-key-42/revoke',
      'https://harness.example.test/admin/harness-key-42/delete',
    ]);
  });

  it('reconciles a sandbox key through the planned Harness admin API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({
        externalKeyId: 'remote-codex:sandbox:sbx-123',
        apiKey: 'harness-api-key-reconciled',
      });
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
    });

    await expect(
      admin.reconcileSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
        externalKeyId: 'remote-codex:sandbox:sbx-old',
      }),
    ).resolves.toEqual({
      externalKeyId: 'remote-codex:sandbox:sbx-123',
      apiKey: 'harness-api-key-reconciled',
      keyCiphertext: null,
    });
    expect(requests[0]).toMatchObject({
      url: 'https://harness.example.test/admin/members/reconcile',
      init: {
        method: 'POST',
        headers: {
          'x-admin-key': 'admin-key',
          'content-type': 'application/json',
        },
      },
    });
    expect(JSON.parse(String(requests[0]!.init!.body))).toMatchObject({
      externalId: 'remote-codex:sandbox:sbx-123',
      externalKeyId: 'remote-codex:sandbox:sbx-old',
      userId: 'user-123',
      sandboxId: 'sbx-123',
      externalUserId: 'remote-codex:user:user-123',
    });
  });

  it('falls back to metadata-only reconcile when the planned Harness reconcile API is unavailable', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return new Response('not found', { status: 404 });
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
    });

    await expect(
      admin.reconcileSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
        externalKeyId: 'harness-key-42',
      }),
    ).resolves.toEqual({
      externalKeyId: 'harness-key-42',
      apiKey: null,
      keyCiphertext: null,
    });
    expect(requests.map((request) => request.url)).toEqual([
      'https://harness.example.test/admin/members/reconcile',
    ]);
  });

  it('falls back to the current Harness admin create API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith('/admin/members/ensure')) {
        return new Response('not found', { status: 404 });
      }
      return new Response(
        'OK\nid      = 42\nkind    = "agent"\napi_key = "harness-api-key-42"\n',
      );
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
    });

    await expect(
      admin.ensureSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
      }),
    ).resolves.toEqual({
      externalKeyId: '42',
      apiKey: 'harness-api-key-42',
      keyCiphertext: null,
    });
    expect(requests.map((request) => request.url)).toEqual([
      'https://harness.example.test/admin/members/ensure',
      'https://harness.example.test/admin/create',
    ]);
  });

  it('does not fall back to the current Harness admin create API when legacy fallback is disabled', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return new Response('not found', { status: 404 });
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
      legacyFallback: false,
    });

    await expect(
      admin.ensureSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
      }),
    ).rejects.toMatchObject({
      code: 'provider',
      message: 'not found',
    });
    expect(requests.map((request) => request.url)).toEqual([
      'https://harness.example.test/admin/members/ensure',
    ]);
  });

  it('does not fall back to legacy Harness rotate, revoke, or reconcile paths when legacy fallback is disabled', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return new Response('not found', { status: 404 });
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
      legacyFallback: false,
    });

    await expect(
      admin.rotateSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
        externalKeyId: 'harness-key-42',
      }),
    ).rejects.toMatchObject({
      code: 'provider',
      message: 'not found',
    });
    await expect(
      admin.revokeSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
        externalKeyId: 'harness-key-42',
      }),
    ).rejects.toMatchObject({
      code: 'provider',
      message: 'not found',
    });
    await expect(
      admin.reconcileSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
        externalKeyId: 'harness-key-42',
      }),
    ).rejects.toMatchObject({
      code: 'provider',
      message: 'not found',
    });
    expect(requests.map((request) => request.url)).toEqual([
      'https://harness.example.test/admin/members/harness-key-42/rekey',
      'https://harness.example.test/admin/members/harness-key-42/revoke',
      'https://harness.example.test/admin/members/reconcile',
    ]);
  });

  it('maps Harness admin errors to provider sandbox manager errors', async () => {
    const fetchImpl = async () =>
      Response.json({ message: 'harness unavailable' }, { status: 503 });
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
    });

    await expect(
      admin.ensureSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'remote-codex:user:user-123',
      }),
    ).rejects.toMatchObject({
      code: 'provider',
      message: 'harness unavailable',
    });
  });

  it('exports Harness usage through the admin API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({
        events: [
          {
            eventId: 'harness-event-1',
            externalKeyId: 'harness-key-123',
            module: 'farmaco',
            tool: 'generate_ligand_xyz',
            runId: 'run-1',
            jobId: 'job-1',
            computeUnits: '12.5',
            costUsd: 0.0312,
            status: 'ok',
            metadata: {
              resultStatus: 'ok',
            },
            occurredAt: '2026-06-03T01:00:00.000Z',
          },
        ],
        nextCursor: 'cursor-2',
      });
    };
    const admin = new HttpHarnessAdmin({
      baseUrl: 'https://harness.example.test',
      adminKey: 'admin-key',
      fetchImpl,
    });

    await expect(
      admin.exportUsage({ cursor: 'cursor-1', limit: 25 }),
    ).resolves.toEqual({
      events: [
        {
          eventId: 'harness-event-1',
          externalKeyId: 'harness-key-123',
          userId: null,
          sandboxId: null,
          workspaceId: null,
          sessionId: null,
          module: 'farmaco',
          tool: 'generate_ligand_xyz',
          runId: 'run-1',
          jobId: 'job-1',
          computeUnits: 12.5,
          costUsd: 0.0312,
          status: 'ok',
          metadata: {
            resultStatus: 'ok',
          },
          occurredAt: '2026-06-03T01:00:00.000Z',
        },
      ],
      nextCursor: 'cursor-2',
    });
    expect(requests[0]).toMatchObject({
      url: 'https://harness.example.test/admin/usage/export?cursor=cursor-1&limit=25',
      init: {
        method: 'GET',
        headers: {
          'x-admin-key': 'admin-key',
        },
      },
    });
  });
});

describe('HTTP LLM gateway admin', () => {
  it('ensures a gateway user through the admin API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({ externalUserId: 'gw-user-123' });
    };
    const admin = new HttpLlmGatewayAdmin({
      baseUrl: 'https://gateway-admin.example.test/',
      adminToken: 'admin-token',
      contract: 'generic',
      fetchImpl,
    });

    await expect(
      admin.ensureUser({
        userId: 'user-123',
        email: 'user@example.test',
        displayName: 'User Test',
      }),
    ).resolves.toEqual({ externalUserId: 'gw-user-123', balance: null });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://gateway-admin.example.test/api/admin/users/ensure',
      init: {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
      },
    });
    expect(JSON.parse(String(requests[0]!.init!.body))).toEqual({
      externalId: 'user-123',
      email: 'user@example.test',
      displayName: 'User Test',
    });
  });

  it('ensures a gateway sandbox key through the admin API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({
        externalKeyId: 'gw-key-123',
        keyCiphertext: 'encrypted-gateway-token',
      });
    };
    const admin = new HttpLlmGatewayAdmin({
      baseUrl: 'https://gateway-admin.example.test',
      adminToken: 'admin-token',
      contract: 'generic',
      fetchImpl,
    });

    await expect(
      admin.ensureSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'gw-user-123',
      }),
    ).resolves.toEqual({
      externalKeyId: 'gw-key-123',
      keyCiphertext: 'encrypted-gateway-token',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: 'https://gateway-admin.example.test/api/admin/users/gw-user-123/keys/ensure',
      init: {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
      },
    });
    expect(JSON.parse(String(requests[0]!.init!.body))).toEqual({
      externalId: 'sbx-123',
      userId: 'user-123',
      sandboxId: 'sbx-123',
    });
  });

  it('rotates a gateway sandbox key through the admin API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({
        externalKeyId: 'gw-key-rotated',
        keyCiphertext: 'encrypted-rotated-token',
      });
    };
    const admin = new HttpLlmGatewayAdmin({
      baseUrl: 'https://gateway-admin.example.test',
      adminToken: 'admin-token',
      contract: 'generic',
      fetchImpl,
    });

    await expect(
      admin.rotateSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'gw-user-123',
        externalKeyId: 'gw-key-123',
      }),
    ).resolves.toEqual({
      externalKeyId: 'gw-key-rotated',
      keyCiphertext: 'encrypted-rotated-token',
    });
    expect(requests[0]).toMatchObject({
      url: 'https://gateway-admin.example.test/api/admin/users/gw-user-123/keys/gw-key-123/rotate',
      init: {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
      },
    });
    expect(JSON.parse(String(requests[0]!.init!.body))).toEqual({
      userId: 'user-123',
      sandboxId: 'sbx-123',
    });
  });

  it('revokes a gateway sandbox key through the admin API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({ ok: true });
    };
    const admin = new HttpLlmGatewayAdmin({
      baseUrl: 'https://gateway-admin.example.test',
      adminToken: 'admin-token',
      contract: 'generic',
      fetchImpl,
    });

    await expect(
      admin.revokeSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'gw-user-123',
        externalKeyId: 'gw-key-123',
      }),
    ).resolves.toBeUndefined();
    expect(requests[0]).toMatchObject({
      url: 'https://gateway-admin.example.test/api/admin/users/gw-user-123/keys/gw-key-123/revoke',
      init: {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
      },
    });
    expect(JSON.parse(String(requests[0]!.init!.body))).toEqual({
      userId: 'user-123',
      sandboxId: 'sbx-123',
    });
  });

  it('reconciles a gateway sandbox key through the admin API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({
        externalKeyId: 'gw-key-reconciled',
        keyCiphertext: 'encrypted-reconciled-token',
      });
    };
    const admin = new HttpLlmGatewayAdmin({
      baseUrl: 'https://gateway-admin.example.test',
      adminToken: 'admin-token',
      contract: 'generic',
      fetchImpl,
    });

    await expect(
      admin.reconcileSandboxKey({
        userId: 'user-123',
        sandboxId: 'sbx-123',
        externalUserId: 'gw-user-123',
        externalKeyId: 'gw-key-old',
      }),
    ).resolves.toEqual({
      externalKeyId: 'gw-key-reconciled',
      keyCiphertext: 'encrypted-reconciled-token',
    });
    expect(requests[0]).toMatchObject({
      url: 'https://gateway-admin.example.test/api/admin/users/gw-user-123/keys/reconcile',
      init: {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin-token',
          'content-type': 'application/json',
        },
      },
    });
    expect(JSON.parse(String(requests[0]!.init!.body))).toEqual({
      externalId: 'sbx-123',
      userId: 'user-123',
      sandboxId: 'sbx-123',
      externalKeyId: 'gw-key-old',
    });
  });

  it('exports gateway usage through the admin API', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requests.push({ url: String(url), init });
      return Response.json({
        events: [
          {
            eventId: 'gateway_req_1',
            externalKeyId: 'gw-key-123',
            model: 'gpt-5.1-codex',
            inputTokens: 200,
            outputTokens: 50,
            cachedTokens: 25,
            costUsd: 0.42,
            currency: 'USD',
            occurredAt: '2026-05-23T01:00:00.000Z',
          },
        ],
        nextCursor: 'cursor-2',
      });
    };
    const admin = new HttpLlmGatewayAdmin({
      baseUrl: 'https://gateway-admin.example.test',
      adminToken: 'admin-token',
      contract: 'generic',
      fetchImpl,
    });

    await expect(
      admin.exportUsage({ cursor: 'cursor-1', limit: 25 }),
    ).resolves.toEqual({
      events: [
        {
          eventId: 'gateway_req_1',
          externalKeyId: 'gw-key-123',
          model: 'gpt-5.1-codex',
          inputTokens: 200,
          outputTokens: 50,
          cachedTokens: 25,
          costUsd: 0.42,
          currency: 'USD',
          occurredAt: '2026-05-23T01:00:00.000Z',
        },
      ],
      nextCursor: 'cursor-2',
    });
    expect(requests[0]).toMatchObject({
      url: 'https://gateway-admin.example.test/api/admin/usage/export?cursor=cursor-1&limit=25',
      init: {
        method: 'GET',
        headers: {
          authorization: 'Bearer admin-token',
        },
      },
    });
  });

  it('maps gateway admin errors to provider sandbox manager errors', async () => {
    const fetchImpl = async () =>
      Response.json({ message: 'gateway unavailable' }, { status: 503 });
    const admin = new HttpLlmGatewayAdmin({
      baseUrl: 'https://gateway-admin.example.test',
      adminToken: 'admin-token',
      contract: 'generic',
      fetchImpl,
    });

    await expect(
      admin.ensureUser({
        userId: 'user-123',
        email: 'user@example.test',
      }),
    ).rejects.toMatchObject({
      code: 'provider',
      message: 'gateway unavailable',
    });
  });
});
