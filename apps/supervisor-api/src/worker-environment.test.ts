import { describe, expect, it } from 'vitest';

import {
  validateWorkerEntrypointEnvironment,
  workerStartupLogPayload,
  type WorkerEnvironmentFilesystem,
} from './worker-environment';

const fakeFilesystem: WorkerEnvironmentFilesystem = {
  mkdirSync() {},
  statSync() {
    return {
      isDirectory() {
        return true;
      },
    };
  },
  accessSync() {},
};

function baseWorkerEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    REMOTE_CODEX_RUNTIME_ROLE: 'worker',
    REMOTE_CODEX_SANDBOX_ID: 'sbx_test',
    REMOTE_CODEX_USER_ID: 'user_test',
    REMOTE_CODEX_WORKER_AUTH_TOKEN: 'router-token',
    WORKSPACE_ROOT: '/workspace',
    HOME: '/home/agent',
    CODEX_HOME: '/home/agent/.codex',
    CLAUDE_HOME: '/home/agent/.claude',
    OPENCODE_HOME: '/home/agent/.opencode',
    REMOTE_CODEX_LLM_GATEWAY_BASE_URL: 'https://llm-gateway.example.com',
    REMOTE_CODEX_LLM_GATEWAY_TOKEN: 'sandbox-gateway-token',
    ...overrides,
  };
}

describe('worker entrypoint environment validation', () => {
  it('accepts a worker environment with provider gateway credentials', async () => {
    expect(() =>
      validateWorkerEntrypointEnvironment(baseWorkerEnv(), fakeFilesystem),
    ).not.toThrow();
  });

  it('requires gateway credentials when provider runtimes are enabled', () => {
    expect(() =>
      validateWorkerEntrypointEnvironment(
        baseWorkerEnv({
          REMOTE_CODEX_LLM_GATEWAY_TOKEN: '',
        }),
        fakeFilesystem,
      ),
    ).toThrow('REMOTE_CODEX_LLM_GATEWAY_TOKEN is required in worker mode.');
  });

  it('requires a valid gateway base URL when provider runtimes are enabled', () => {
    expect(() =>
      validateWorkerEntrypointEnvironment(
        baseWorkerEnv({
          REMOTE_CODEX_LLM_GATEWAY_BASE_URL: 'not-a-url',
        }),
        fakeFilesystem,
      ),
    ).toThrow('REMOTE_CODEX_LLM_GATEWAY_BASE_URL must be a valid URL.');
  });

  it('allows missing gateway credentials only when provider runtimes are disabled', () => {
    expect(() =>
      validateWorkerEntrypointEnvironment(
        baseWorkerEnv({
          REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: '',
          REMOTE_CODEX_LLM_GATEWAY_BASE_URL: '',
          REMOTE_CODEX_LLM_GATEWAY_TOKEN: '',
        }),
        fakeFilesystem,
      ),
    ).not.toThrow();
  });

  it('requires harness credentials when chemistry tools are enabled', () => {
    expect(() =>
      validateWorkerEntrypointEnvironment(
        baseWorkerEnv({
          REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
          ELAGENTE_HARNESS_BASE_URL: 'https://harness.example.com',
          INACT_X_APP_KEY: '',
        }),
        fakeFilesystem,
      ),
    ).toThrow('INACT_X_APP_KEY is required in worker mode.');
  });

  it('requires a valid harness base URL when chemistry tools are enabled', () => {
    expect(() =>
      validateWorkerEntrypointEnvironment(
        baseWorkerEnv({
          REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
          ELAGENTE_HARNESS_BASE_URL: 'not-a-url',
          INACT_X_APP_KEY: 'harness-app-key',
        }),
        fakeFilesystem,
      ),
    ).toThrow('ELAGENTE_HARNESS_BASE_URL must be a valid URL.');
  });

  it('allows missing harness credentials when chemistry tools are disabled', () => {
    expect(() =>
      validateWorkerEntrypointEnvironment(
        baseWorkerEnv({
          REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'false',
          ELAGENTE_HARNESS_BASE_URL: '',
          INACT_X_APP_KEY: '',
        }),
        fakeFilesystem,
      ),
    ).not.toThrow();
  });

  it('redacts gateway token and harness key from startup log payload', () => {
    const payload = workerStartupLogPayload(
      baseWorkerEnv({
        REMOTE_CODEX_LLM_GATEWAY_BASE_URL: 'https://llm-gateway.example.com',
        REMOTE_CODEX_LLM_GATEWAY_TOKEN: 'must-not-leak-gateway-token',
        REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
        ELAGENTE_HARNESS_BASE_URL: 'https://harness.example.com',
        INACT_X_APP_KEY: 'must-not-leak-harness-key',
      }),
    );

    expect(payload).toEqual({
      sandboxId: 'sbx_test',
      userId: 'user_test',
      workspaceRoot: '/workspace',
      home: '/home/agent',
      gatewayConfigured: true,
      harnessConfigured: true,
      chemistryToolsEnabled: true,
    });
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain('must-not-leak-gateway-token');
    expect(serialized).not.toContain('must-not-leak-harness-key');
    expect(serialized).not.toContain('REMOTE_CODEX_LLM_GATEWAY_TOKEN');
    expect(serialized).not.toContain('INACT_X_APP_KEY');
  });
});
