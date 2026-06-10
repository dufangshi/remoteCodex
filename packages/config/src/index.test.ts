import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig, resolveDatabaseUrl } from './index';

describe('loadRuntimeConfig', () => {
  it('uses defaults for development', () => {
    const config = loadRuntimeConfig({});

    expect(config.nodeEnv).toBe('development');
    expect(config.mode).toBe('local');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
    expect(config.logLevel).toBe('info');
    expect(config.disableRequestLogging).toBe(false);
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
});
