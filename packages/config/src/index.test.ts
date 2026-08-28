import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig, resolveDatabaseUrl } from './index';

describe('loadRuntimeConfig', () => {
  it('uses defaults for development', () => {
    const config = loadRuntimeConfig({}, 'linux');

    expect(config.nodeEnv).toBe('development');
    expect(config.mode).toBe('local');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
    expect(config.logLevel).toBe('info');
    expect(config.disableRequestLogging).toBe(false);
    expect(config.managementRoutesEnabled).toBe(true);
    expect(config.agentRuntimeManagementEnabled).toBe(true);
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
    expect(config.agentProviders.acp.enabled).toBe(true);
  });

  it('allows optional providers to be explicitly disabled', () => {
    const config = loadRuntimeConfig({
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex',
    });

    expect(config.agentProviders.codex.enabled).toBe(true);
    expect(config.agentProviders.claude.enabled).toBe(false);
    expect(config.agentProviders.opencode.enabled).toBe(false);
    expect(config.agentProviders.acp.enabled).toBe(false);
  });

  it('enables Codex and its built-in ACP catalog by default on native Windows', () => {
    const config = loadRuntimeConfig({}, 'win32');

    expect(config.agentProviders.codex.enabled).toBe(true);
    expect(config.agentProviders.claude.enabled).toBe(false);
    expect(config.agentProviders.opencode.enabled).toBe(false);
    expect(config.agentProviders.acp.enabled).toBe(true);
  });

  it('honors explicit provider overrides on native Windows', () => {
    const config = loadRuntimeConfig({
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex,opencode',
    }, 'win32');

    expect(config.agentProviders.codex.enabled).toBe(true);
    expect(config.agentProviders.claude.enabled).toBe(false);
    expect(config.agentProviders.opencode.enabled).toBe(true);
    expect(config.agentProviders.acp.enabled).toBe(false);
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
      ACP_HOME: '',
      ACP_COMMAND: '',
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
    expect(config.agentProviders.acp).toEqual({
      provider: 'acp',
      enabled: true,
      home: path.join(os.homedir(), '.acp'),
      command: 'grok agent stdio',
      startupTimeoutMs: 10_000,
    });
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
      ACP_HOME: '/tmp/acp-home',
      ACP_COMMAND: 'custom-acp --stdio',
      ACP_STARTUP_TIMEOUT_MS: '25000',
      REMOTE_CODEX_MODE: 'server',
      REMOTE_CODEX_ADMIN_USERNAME: 'admin',
      REMOTE_CODEX_ADMIN_PASSWORD: 'secret',
      REMOTE_CODEX_SESSION_SECRET: 'session-secret-value',
      REMOTE_CODEX_SESSION_TTL_SECONDS: '3600',
      REMOTE_CODEX_RELAY_SERVER_URL: 'wss://relay.example.test',
      REMOTE_CODEX_RELAY_AGENT_TOKEN: 'relay-token',
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex,claude,acp'
    });

    expect(config.nodeEnv).toBe('test');
    expect(config.mode).toBe('server');
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(9999);
    expect(config.logLevel).toBe('error');
    expect(config.disableRequestLogging).toBe(true);
    expect(config.workspaceRoot).toBe(path.resolve('/tmp/workspaces'));
    expect(config.databaseUrl).toBe(path.resolve('/tmp/db.sqlite'));
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
      home: path.resolve('/tmp/codex-home'),
      command: 'codex-custom',
      appServerStartTimeoutMs: 15_000,
    });
    expect(config.agentProviders.claude).toEqual({
      provider: 'claude',
      enabled: true,
      home: path.resolve('/tmp/claude-home'),
      command: 'claude-custom',
    });
    expect(config.agentProviders.opencode).toEqual({
      provider: 'opencode',
      enabled: false,
      home: path.resolve('/tmp/opencode-home'),
      command: 'opencode-custom',
    });
    expect(config.agentProviders.acp).toEqual({
      provider: 'acp',
      enabled: true,
      home: path.resolve('/tmp/acp-home'),
      command: 'custom-acp --stdio',
      startupTimeoutMs: 25_000,
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
