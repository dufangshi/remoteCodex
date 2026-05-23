import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  agentBackendIds,
  agentBackendMetadata,
  type AgentBackendIdDto,
} from '../../shared/src/index';

export type AgentProviderId = AgentBackendIdDto;

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

export interface OpenCodeProviderConfig {
  provider: 'opencode';
  enabled: boolean;
  home: string;
  command: string;
}

export type AgentProviderConfig = CodexProviderConfig | ClaudeProviderConfig | OpenCodeProviderConfig;
export interface AgentProviderConfigMap {
  codex: CodexProviderConfig;
  claude: ClaudeProviderConfig;
  opencode: OpenCodeProviderConfig;
}

export interface RuntimeConfig {
  nodeEnv: 'development' | 'test' | 'production';
  runtimeRole: 'supervisor' | 'worker';
  sandboxId: string | null;
  userId: string | null;
  host: string;
  port: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  disableRequestLogging: boolean;
  managementRoutesEnabled: boolean;
  agentRuntimeManagementEnabled: boolean;
  workerAuthToken: string | null;
  llmGatewayBaseUrl: string | null;
  llmGatewayToken: string | null;
  appName: string;
  appVersion: string;
  workspaceRoot: string;
  databaseUrl: string;
  agentProviders: AgentProviderConfigMap;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  REMOTE_CODEX_RUNTIME_ROLE: z.enum(['supervisor', 'worker']).optional(),
  REMOTE_CODEX_SANDBOX_ID: z.string().min(1).optional(),
  REMOTE_CODEX_USER_ID: z.string().min(1).optional(),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  DISABLE_REQUEST_LOGGING: z.string().optional(),
  REMOTE_CODEX_MANAGEMENT_ROUTES_ENABLED: z.string().optional(),
  REMOTE_CODEX_AGENT_RUNTIME_MANAGEMENT_ENABLED: z.string().optional(),
  REMOTE_CODEX_WORKER_AUTH_TOKEN: z.string().min(1).optional(),
  REMOTE_CODEX_LLM_GATEWAY_BASE_URL: z.string().url().optional(),
  REMOTE_CODEX_LLM_GATEWAY_TOKEN: z.string().min(1).optional(),
  APP_NAME: z.string().min(1).optional(),
  APP_VERSION: z.string().min(1).optional(),
  WORKSPACE_ROOT: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  CODEX_HOME: z.string().optional(),
  CODEX_COMMAND: z.string().min(1).optional(),
  CODEX_APP_SERVER_START_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  CLAUDE_HOME: z.string().optional(),
  CLAUDE_COMMAND: z.string().min(1).optional(),
  OPENCODE_HOME: z.string().optional(),
  OPENCODE_COMMAND: z.string().min(1).optional(),
  REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: z.string().optional()
});

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) {
    return defaultValue;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function resolveDatabaseUrl(
  nodeEnv: RuntimeConfig['nodeEnv'],
  value?: string,
  runtimeRole: RuntimeConfig['runtimeRole'] = 'supervisor',
): string {
  if (value && value.trim()) {
    return path.resolve(value);
  }

  if (nodeEnv === 'production') {
    if (runtimeRole === 'worker') {
      return path.join('/home/agent', '.remote-codex', 'worker.sqlite');
    }
    return path.join(os.homedir(), '.remote-codex', 'supervisor.sqlite');
  }

  return path.resolve('.local', 'supervisor-dev.sqlite');
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = envSchema.parse(env);
  const nodeEnv = parsed.NODE_ENV ?? 'development';
  const runtimeRole = parsed.REMOTE_CODEX_RUNTIME_ROLE ?? 'supervisor';
  const workspaceRoot = parsed.WORKSPACE_ROOT?.trim()
    ? path.resolve(parsed.WORKSPACE_ROOT)
    : runtimeRole === 'worker'
      ? '/workspace'
      : os.homedir();
  const disableRequestLogging = parseBoolean(
    parsed.DISABLE_REQUEST_LOGGING,
    nodeEnv === 'production',
  );
  const enabledProviders = new Set(
    (parsed.REMOTE_CODEX_ENABLED_AGENT_PROVIDERS ?? agentBackendIds.join(','))
      .split(',')
      .map((provider) => provider.trim().toLowerCase())
      .filter(Boolean)
  );
  const defaultAgentHomeRoot = runtimeRole === 'worker' ? '/home/agent' : os.homedir();
  const codexHome = parsed.CODEX_HOME?.trim()
    ? path.resolve(parsed.CODEX_HOME)
    : path.join(defaultAgentHomeRoot, agentBackendMetadata.codex.defaultHomeDir);
  const claudeHome = parsed.CLAUDE_HOME?.trim()
    ? path.resolve(parsed.CLAUDE_HOME)
    : path.join(defaultAgentHomeRoot, agentBackendMetadata.claude.defaultHomeDir);
  const opencodeHome = parsed.OPENCODE_HOME?.trim()
    ? path.resolve(parsed.OPENCODE_HOME)
    : path.join(defaultAgentHomeRoot, agentBackendMetadata.opencode.defaultHomeDir);

  return {
    nodeEnv,
    runtimeRole,
    sandboxId: parsed.REMOTE_CODEX_SANDBOX_ID ?? null,
    userId: parsed.REMOTE_CODEX_USER_ID ?? null,
    host: parsed.HOST ?? (runtimeRole === 'worker' ? '0.0.0.0' : '127.0.0.1'),
    port: parsed.PORT ?? 8787,
    logLevel: parsed.LOG_LEVEL ?? (nodeEnv === 'production' ? 'warn' : 'info'),
    disableRequestLogging,
    managementRoutesEnabled: parseBoolean(
      parsed.REMOTE_CODEX_MANAGEMENT_ROUTES_ENABLED,
      runtimeRole !== 'worker',
    ),
    agentRuntimeManagementEnabled: parseBoolean(
      parsed.REMOTE_CODEX_AGENT_RUNTIME_MANAGEMENT_ENABLED,
      runtimeRole !== 'worker',
    ),
    workerAuthToken: parsed.REMOTE_CODEX_WORKER_AUTH_TOKEN ?? null,
    llmGatewayBaseUrl: parsed.REMOTE_CODEX_LLM_GATEWAY_BASE_URL ?? null,
    llmGatewayToken: parsed.REMOTE_CODEX_LLM_GATEWAY_TOKEN ?? null,
    appName: parsed.APP_NAME ?? (runtimeRole === 'worker' ? 'Remote Codex Worker' : 'Remote Codex Supervisor'),
    appVersion: parsed.APP_VERSION ?? '0.1.0',
    workspaceRoot,
    databaseUrl: resolveDatabaseUrl(nodeEnv, parsed.DATABASE_URL, runtimeRole),
    agentProviders: {
      codex: {
        provider: 'codex',
        enabled: enabledProviders.has('codex'),
        home: codexHome,
        command: parsed.CODEX_COMMAND ?? agentBackendMetadata.codex.defaultCommand,
        appServerStartTimeoutMs: parsed.CODEX_APP_SERVER_START_TIMEOUT_MS ?? 10_000,
      },
      claude: {
        provider: 'claude',
        enabled: enabledProviders.has('claude'),
        home: claudeHome,
        command: parsed.CLAUDE_COMMAND ?? agentBackendMetadata.claude.defaultCommand,
      },
      opencode: {
        provider: 'opencode',
        enabled: enabledProviders.has('opencode'),
        home: opencodeHome,
        command: parsed.OPENCODE_COMMAND ?? agentBackendMetadata.opencode.defaultCommand,
      },
    },
  };
}
