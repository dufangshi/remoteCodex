import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  validateWorkerEntrypointEnvironment,
  workerStartupLogPayload,
  type WorkerEnvironmentFilesystem,
} from './worker-environment';
import { loadRuntimeConfig } from '../../../packages/config/src/index';
import { configureWorkerProviderGateway } from './worker-bootstrap';

const fakeFilesystem: WorkerEnvironmentFilesystem = {
  mkdirSync() {},
  statSync() {
    return {
      mode: 0o600,
      isDirectory() {
        return true;
      },
    };
  },
  existsSync() {
    return false;
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

  it('rejects worker MCP config homes outside HOME', () => {
    expect(() =>
      validateWorkerEntrypointEnvironment(
        baseWorkerEnv({
          CODEX_HOME: '/tmp/outside-codex',
        }),
        fakeFilesystem,
      ),
    ).toThrow('Codex MCP config path must be inside /home/agent in worker mode.');
  });

  it('rejects world-writable MCP provider config files', () => {
    const filesystem: WorkerEnvironmentFilesystem = {
      ...fakeFilesystem,
      existsSync(filePath) {
        return filePath === '/home/agent/.codex/config.toml';
      },
      statSync(filePath) {
        return {
          mode: filePath === '/home/agent/.codex/config.toml' ? 0o666 : 0o700,
          isDirectory() {
            return true;
          },
        };
      },
    };

    expect(() =>
      validateWorkerEntrypointEnvironment(baseWorkerEnv(), filesystem),
    ).toThrow(
      'Codex MCP config path must not be world-writable in worker mode: /home/agent/.codex/config.toml',
    );
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

describe('worker provider gateway bootstrap', () => {
  it('writes Codex sub2api config and auth from launch env', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-worker-bootstrap-'));
    const env = baseWorkerEnv({
      CODEX_HOME: path.join(tempDir, '.codex'),
      CLAUDE_HOME: path.join(tempDir, '.claude'),
      OPENCODE_HOME: path.join(tempDir, '.opencode'),
      WORKSPACE_ROOT: '/workspace',
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex',
      REMOTE_CODEX_LLM_GATEWAY_BASE_URL: 'https://sub.example.test/',
      REMOTE_CODEX_LLM_GATEWAY_TOKEN: 'sandbox-sub2api-key',
    });

    await configureWorkerProviderGateway(loadRuntimeConfig(env));

    const configToml = await fs.readFile(path.join(tempDir, '.codex', 'config.toml'), 'utf8');
    const authJson = JSON.parse(
      await fs.readFile(path.join(tempDir, '.codex', 'auth.json'), 'utf8'),
    );
    expect(configToml).toContain('model_provider = "sub2api"');
    expect(configToml).toContain('base_url = "https://sub.example.test"');
    expect(configToml).toContain('wire_api = "responses"');
    expect(configToml).toContain('requires_openai_auth = true');
    expect(configToml).not.toContain('sandbox-sub2api-key');
    expect(authJson).toEqual({
      OPENAI_API_KEY: 'sandbox-sub2api-key',
    });
    await expect(fs.stat(path.join(tempDir, '.claude', 'settings.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.stat(path.join(tempDir, '.opencode', 'opencode.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
