import { describe, expect, it } from 'vitest';

import {
  validateWorkerEntrypointEnvironment,
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
});
