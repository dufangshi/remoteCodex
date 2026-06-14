import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig, resolveDatabaseUrl } from './index';

describe('loadRuntimeConfig', () => {
  it('uses defaults for development', () => {
    const config = loadRuntimeConfig({});

    expect(config.nodeEnv).toBe('development');
    expect(config.runtimeRole).toBe('supervisor');
    expect(config.sandboxId).toBeNull();
    expect(config.userId).toBeNull();
    expect(config.mode).toBe('local');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
    expect(config.logLevel).toBe('info');
    expect(config.disableRequestLogging).toBe(false);
    expect(config.managementRoutesEnabled).toBe(true);
    expect(config.agentRuntimeManagementEnabled).toBe(true);
    expect(config.workerAuthToken).toBeNull();
    expect(config.workerIdentitySecret).toBeNull();
    expect(config.controlPlaneBaseUrl).toBeNull();
    expect(config.controlPlaneServiceToken).toBeNull();
    expect(config.llmGatewayBaseUrl).toBeNull();
    expect(config.llmGatewayToken).toBeNull();
    expect(config.workerRuntimeManifestPath).toBeNull();
    expect(config.workspaceRoot).toBe(os.homedir());
    expect(config.databaseUrl).toBe(path.resolve('.local', 'supervisor-dev.sqlite'));
    expect(config.auth).toEqual({
      adminUsername: null,
      adminPassword: null,
      sessionSecret: null,
      sessionTtlSeconds: 60 * 60 * 24 * 7,
    });
    expect(config.relay).toEqual({
      serverUrl: null,
      agentToken: null,
    });
    expect(config.agentProviders.codex).toEqual({
      provider: 'codex',
      enabled: true,
      home: path.join(os.homedir(), '.codex'),
      command: 'codex',
      appServerStartTimeoutMs: 10_000,
    });
    expect(config.agentProviders.claude).toEqual({
      provider: 'claude',
      enabled: true,
      home: path.join(os.homedir(), '.claude'),
      command: 'claude',
    });
    expect(config.agentProviders.opencode).toEqual({
      provider: 'opencode',
      enabled: true,
      home: path.join(os.homedir(), '.opencode'),
      command: 'opencode',
    });
  });

  it('allows optional providers to be explicitly disabled', () => {
    const config = loadRuntimeConfig({
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex',
    });

    expect(config.agentProviders.codex.enabled).toBe(true);
    expect(config.agentProviders.claude.enabled).toBe(false);
    expect(config.agentProviders.opencode.enabled).toBe(false);
  });

  it('treats blank optional environment variables as unset', () => {
    const config = loadRuntimeConfig({
      REMOTE_CODEX_MODE: 'local',
      WORKSPACE_ROOT: '',
      DATABASE_URL: '',
      REMOTE_CODEX_RELAY_SERVER_URL: '',
      REMOTE_CODEX_RELAY_AGENT_TOKEN: '',
      CODEX_HOME: '',
      CODEX_COMMAND: '',
      CLAUDE_HOME: '',
      CLAUDE_COMMAND: '',
      OPENCODE_HOME: '',
      OPENCODE_COMMAND: '',
    });

    expect(config.mode).toBe('local');
    expect(config.relay).toEqual({
      serverUrl: null,
      agentToken: null,
    });
    expect(config.workspaceRoot).toBe(os.homedir());
    expect(config.databaseUrl).toBe(path.resolve('.local', 'supervisor-dev.sqlite'));
    expect(config.agentProviders.codex.command).toBe('codex');
    expect(config.agentProviders.claude.command).toBe('claude');
    expect(config.agentProviders.opencode.command).toBe('opencode');
  });

  it('resolves production database to user home', () => {
    expect(resolveDatabaseUrl('production')).toBe(
      path.join(os.homedir(), '.remote-codex', 'supervisor.sqlite')
    );
  });

  it('uses quieter defaults for production', () => {
    const config = loadRuntimeConfig({
      NODE_ENV: 'production',
    });

    expect(config.logLevel).toBe('warn');
    expect(config.disableRequestLogging).toBe(true);
  });

  it('uses container worker defaults when requested', () => {
    const config = loadRuntimeConfig({
      NODE_ENV: 'production',
      REMOTE_CODEX_RUNTIME_ROLE: 'worker',
      REMOTE_CODEX_SANDBOX_ID: 'sbx_123',
      REMOTE_CODEX_USER_ID: 'user_123',
      REMOTE_CODEX_WORKER_AUTH_TOKEN: 'worker-token',
      REMOTE_CODEX_WORKER_IDENTITY_SECRET: 'identity-secret',
      REMOTE_CODEX_CONTROL_PLANE_BASE_URL: 'https://control-plane.example.com',
      REMOTE_CODEX_CONTROL_PLANE_SERVICE_TOKEN: 'control-plane-service-token',
      REMOTE_CODEX_LLM_GATEWAY_BASE_URL: 'https://llm-gateway.example.com',
      REMOTE_CODEX_LLM_GATEWAY_TOKEN: 'gw-token',
      ELAGENTE_HARNESS_BASE_URL: 'https://harness.example.com',
      INACT_X_APP_KEY: 'harness-app-key',
      REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: 'true',
    });

    expect(config.runtimeRole).toBe('worker');
    expect(config.sandboxId).toBe('sbx_123');
    expect(config.userId).toBe('user_123');
    expect(config.host).toBe('0.0.0.0');
    expect(config.workspaceRoot).toBe('/workspace');
    expect(config.databaseUrl).toBe('/home/agent/.remote-codex/worker.sqlite');
    expect(config.managementRoutesEnabled).toBe(false);
    expect(config.agentRuntimeManagementEnabled).toBe(false);
    expect(config.workerAuthToken).toBe('worker-token');
    expect(config.workerIdentitySecret).toBe('identity-secret');
    expect(config.controlPlaneBaseUrl).toBe('https://control-plane.example.com');
    expect(config.controlPlaneServiceToken).toBe('control-plane-service-token');
    expect(config.llmGatewayBaseUrl).toBe('https://llm-gateway.example.com');
    expect(config.llmGatewayToken).toBe('gw-token');
    expect(config.harnessBaseUrl).toBe('https://harness.example.com');
    expect(config.harnessEnabled).toBe(true);
    expect(config.chemistryToolsEnabled).toBe(true);
    expect(config.workerRuntimeManifestPath).toBe('/opt/remote-codex/worker-runtime-manifest.json');
    expect(config.appName).toBe('Remote Codex Worker');
    expect(config.agentProviders.codex.home).toBe('/home/agent/.codex');
    expect(config.agentProviders.claude.home).toBe('/home/agent/.claude');
    expect(config.agentProviders.opencode.home).toBe('/home/agent/.opencode');
  });

  it('honors explicit overrides', () => {
    const config = loadRuntimeConfig({
      NODE_ENV: 'test',
      HOST: '0.0.0.0',
      PORT: '9999',
      LOG_LEVEL: 'error',
      DISABLE_REQUEST_LOGGING: 'true',
      WORKSPACE_ROOT: '/tmp/workspaces',
      DATABASE_URL: '/tmp/db.sqlite',
      CODEX_HOME: '/tmp/codex-home',
      CODEX_COMMAND: 'codex-custom',
      CODEX_APP_SERVER_START_TIMEOUT_MS: '15000',
      CLAUDE_HOME: '/tmp/claude-home',
      CLAUDE_COMMAND: 'claude-custom',
      OPENCODE_HOME: '/tmp/opencode-home',
      OPENCODE_COMMAND: 'opencode-custom',
      REMOTE_CODEX_MODE: 'server',
      REMOTE_CODEX_ADMIN_USERNAME: 'admin',
      REMOTE_CODEX_ADMIN_PASSWORD: 'secret',
      REMOTE_CODEX_SESSION_SECRET: 'session-secret-value',
      REMOTE_CODEX_SESSION_TTL_SECONDS: '3600',
      REMOTE_CODEX_RELAY_SERVER_URL: 'wss://relay.example.test',
      REMOTE_CODEX_RELAY_AGENT_TOKEN: 'relay-token',
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex,claude'
    });

    expect(config.nodeEnv).toBe('test');
    expect(config.runtimeRole).toBe('supervisor');
    expect(config.mode).toBe('server');
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(9999);
    expect(config.logLevel).toBe('error');
    expect(config.disableRequestLogging).toBe(true);
    expect(config.workspaceRoot).toBe('/tmp/workspaces');
    expect(config.databaseUrl).toBe('/tmp/db.sqlite');
    expect(config.auth).toEqual({
      adminUsername: 'admin',
      adminPassword: 'secret',
      sessionSecret: 'session-secret-value',
      sessionTtlSeconds: 3600,
    });
    expect(config.relay).toEqual({
      serverUrl: 'wss://relay.example.test',
      agentToken: 'relay-token',
    });
    expect(config.agentProviders.codex).toEqual({
      provider: 'codex',
      enabled: true,
      home: '/tmp/codex-home',
      command: 'codex-custom',
      appServerStartTimeoutMs: 15_000,
    });
    expect(config.agentProviders.claude).toEqual({
      provider: 'claude',
      enabled: true,
      home: '/tmp/claude-home',
      command: 'claude-custom',
    });
    expect(config.agentProviders.opencode).toEqual({
      provider: 'opencode',
      enabled: false,
      home: '/tmp/opencode-home',
      command: 'opencode-custom',
    });
  });

  it('prefers relay supervisor host and port over generic fallbacks', () => {
    const config = loadRuntimeConfig({
      NODE_ENV: 'test',
      HOST: '0.0.0.0',
      PORT: '9999',
      REMOTE_CODEX_RELAY_SUPERVISOR_HOST: '127.0.0.1',
      REMOTE_CODEX_RELAY_SUPERVISOR_PORT: '8787',
    });

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
  });
});
