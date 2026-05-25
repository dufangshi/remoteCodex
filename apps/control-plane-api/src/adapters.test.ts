import { describe, expect, it } from 'vitest';

import {
  AwsEksFargateSandboxManager,
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
    const manager = new AwsEksFargateSandboxManager(
      loadAwsSandboxAdapterConfig({
        AWS_REGION: 'us-east-1',
        SANDBOX_EKS_CLUSTER_NAME: 'remote-codex-staging',
        SANDBOX_K8S_SERVICE_ACCOUNT: 'remote-codex-worker',
        SANDBOX_WORKER_IMAGE_REPOSITORY: '123456789012.dkr.ecr.us-east-1.amazonaws.com/remote-codex-worker',
        SANDBOX_WORKER_IMAGE_TAG: 'staging-abc123',
        SANDBOX_ROUTER_BASE_URL: 'https://sandbox-router.example.test',
        SANDBOX_WORKER_AUTH_TOKEN_SECRET_NAME: 'remote-codex-worker-token',
        SANDBOX_SUBNET_IDS: 'subnet-a',
        SANDBOX_SECURITY_GROUP_IDS: 'sg-worker',
      }),
    );

    const env = await manager.prepareSandboxEnvironment(sandboxInput);
    expect(env.env).toMatchObject({
      REMOTE_CODEX_RUNTIME_ROLE: 'worker',
      REMOTE_CODEX_SANDBOX_ID: 'sbx_test',
      REMOTE_CODEX_USER_ID: 'user_test',
      WORKSPACE_ROOT: '/workspace',
      HOME: '/home/agent',
    });
    expect(Object.keys(env.env)).not.toContain('OPENAI_API_KEY');
    expect(Object.keys(env.env)).not.toContain('ANTHROPIC_API_KEY');
  });
});
