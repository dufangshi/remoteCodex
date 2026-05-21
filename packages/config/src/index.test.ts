import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig, resolveDatabaseUrl } from './index';

describe('loadRuntimeConfig', () => {
  it('uses defaults for development', () => {
    const config = loadRuntimeConfig({});

    expect(config.nodeEnv).toBe('development');
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(8787);
    expect(config.logLevel).toBe('info');
    expect(config.disableRequestLogging).toBe(false);
    expect(config.workspaceRoot).toBe(os.homedir());
    expect(config.databaseUrl).toBe(path.resolve('.local', 'supervisor-dev.sqlite'));
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
  });

  it('allows Claude to be explicitly disabled', () => {
    const config = loadRuntimeConfig({
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex',
    });

    expect(config.agentProviders.codex.enabled).toBe(true);
    expect(config.agentProviders.claude.enabled).toBe(false);
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
      REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: 'codex,claude'
    });

    expect(config.nodeEnv).toBe('test');
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(9999);
    expect(config.logLevel).toBe('error');
    expect(config.disableRequestLogging).toBe(true);
    expect(config.workspaceRoot).toBe('/tmp/workspaces');
    expect(config.databaseUrl).toBe('/tmp/db.sqlite');
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
  });
});
