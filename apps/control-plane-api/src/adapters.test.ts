import { describe, expect, it } from 'vitest';

import {
  LocalWorkerProcessSandboxManager,
  NoopSandboxManager,
  SandboxManagerError,
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
});
