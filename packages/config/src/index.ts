import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

export type AgentProviderId = 'codex' | 'claude';

export interface CodexProviderConfig {
  provider: 'codex';
  enabled: boolean;
  home: string;
  command: string;
  appServerStartTimeoutMs: number;
}

export interface ClaudeProviderConfig {
  provider: 'claude';
  enabled: boolean;
  home: string;
  command: string;
}

export type AgentProviderConfig = CodexProviderConfig | ClaudeProviderConfig;
export interface AgentProviderConfigMap {
  codex: CodexProviderConfig;
  claude: ClaudeProviderConfig;
}

export interface RuntimeConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  disableRequestLogging: boolean;
  appName: string;
  appVersion: string;
  workspaceRoot: string;
  databaseUrl: string;
  agentProviders: AgentProviderConfigMap;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  DISABLE_REQUEST_LOGGING: z.string().optional(),
  APP_NAME: z.string().min(1).optional(),
  APP_VERSION: z.string().min(1).optional(),
  WORKSPACE_ROOT: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  CODEX_HOME: z.string().optional(),
  CODEX_COMMAND: z.string().min(1).optional(),
  CODEX_APP_SERVER_START_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CLAUDE_HOME: z.string().optional(),
  CLAUDE_COMMAND: z.string().min(1).optional(),
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: z.string().optional()
});

export function resolveDatabaseUrl(
  nodeEnv: RuntimeConfig['nodeEnv'],
  value?: string
): string {
  if (value && value.trim()) {
    return path.resolve(value);
  }

  if (nodeEnv === 'production') {
    return path.join(os.homedir(), '.remote-codex', 'supervisor.sqlite');
  }

  return path.resolve('.local', 'supervisor-dev.sqlite');
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = envSchema.parse(env);
  const nodeEnv = parsed.NODE_ENV ?? 'development';
  const workspaceRoot = parsed.WORKSPACE_ROOT?.trim()
    ? path.resolve(parsed.WORKSPACE_ROOT)
    : os.homedir();
  const disableRequestLogging =
    parsed.DISABLE_REQUEST_LOGGING === undefined
      ? nodeEnv === 'production'
      : ['1', 'true', 'yes', 'on'].includes(parsed.DISABLE_REQUEST_LOGGING.toLowerCase());
  const enabledProviders = new Set(
    (parsed.REMOTE_CODEX_ENABLED_AGENT_PROVIDERS ?? 'codex')
      .split(',')
      .map((provider) => provider.trim().toLowerCase())
      .filter(Boolean)
  );
  const codexHome = parsed.CODEX_HOME?.trim()
    ? path.resolve(parsed.CODEX_HOME)
    : path.join(os.homedir(), '.codex');
  const claudeHome = parsed.CLAUDE_HOME?.trim()
    ? path.resolve(parsed.CLAUDE_HOME)
    : path.join(os.homedir(), '.claude');

  return {
    nodeEnv,
    host: parsed.HOST ?? '127.0.0.1',
    port: parsed.PORT ?? 8787,
    logLevel: parsed.LOG_LEVEL ?? (nodeEnv === 'production' ? 'warn' : 'info'),
    disableRequestLogging,
    appName: parsed.APP_NAME ?? 'Remote Codex Supervisor',
    appVersion: parsed.APP_VERSION ?? '0.1.0',
    workspaceRoot,
    databaseUrl: resolveDatabaseUrl(nodeEnv, parsed.DATABASE_URL),
    agentProviders: {
      codex: {
        provider: 'codex',
        enabled: enabledProviders.has('codex'),
        home: codexHome,
        command: parsed.CODEX_COMMAND ?? 'codex',
        appServerStartTimeoutMs: parsed.CODEX_APP_SERVER_START_TIMEOUT_MS ?? 10_000,
      },
      claude: {
        provider: 'claude',
        enabled: enabledProviders.has('claude'),
        home: claudeHome,
        command: parsed.CLAUDE_COMMAND ?? 'claude',
      },
    },
  };
}
