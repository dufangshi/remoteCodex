import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  agentBackendIds,
  agentBackendMetadata,
  type AgentBackendIdDto,
} from '../../shared/src/index';

export type AgentProviderId = AgentBackendIdDto;
export type RuntimeMode = 'local' | 'server' | 'relay';

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
  mode: RuntimeMode;
  host: string;
  port: number;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  disableRequestLogging: boolean;
  managementRoutesEnabled: boolean;
  agentRuntimeManagementEnabled: boolean;
  workerAuthToken: string | null;
  workerIdentitySecret: string | null;
  controlPlaneBaseUrl: string | null;
  controlPlaneServiceToken: string | null;
  llmGatewayBaseUrl: string | null;
  llmGatewayToken: string | null;
  harnessBaseUrl: string | null;
  harnessEnabled: boolean;
  chemistryToolsEnabled: boolean;
  harnessWakeupCallbackBaseUrl: string | null;
  workerRuntimeManifestPath: string | null;
  appName: string;
  appVersion: string;
  workspaceRoot: string;
  databaseUrl: string;
  auth: {
    adminUsername: string | null;
    adminPassword: string | null;
    sessionSecret: string | null;
    sessionTtlSeconds: number;
  };
  relay: {
    serverUrl: string | null;
    agentToken: string | null;
  };
  agentProviders: AgentProviderConfigMap;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  REMOTE_CODEX_RUNTIME_ROLE: z.enum(['supervisor', 'worker']).optional(),
  REMOTE_CODEX_SANDBOX_ID: z.string().min(1).optional(),
  REMOTE_CODEX_USER_ID: z.string().min(1).optional(),
  REMOTE_CODEX_MODE: z.enum(['local', 'server', 'relay']).optional(),
  HOST: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional(),
  DISABLE_REQUEST_LOGGING: z.string().optional(),
  REMOTE_CODEX_MANAGEMENT_ROUTES_ENABLED: z.string().optional(),
  REMOTE_CODEX_AGENT_RUNTIME_MANAGEMENT_ENABLED: z.string().optional(),
  REMOTE_CODEX_WORKER_AUTH_TOKEN: z.string().min(1).optional(),
  REMOTE_CODEX_WORKER_IDENTITY_SECRET: z.string().min(1).optional(),
  REMOTE_CODEX_CONTROL_PLANE_BASE_URL: z.string().url().optional(),
  REMOTE_CODEX_CONTROL_PLANE_SERVICE_TOKEN: z.string().min(1).optional(),
  REMOTE_CODEX_LLM_GATEWAY_BASE_URL: z.string().url().optional(),
  REMOTE_CODEX_LLM_GATEWAY_TOKEN: z.string().min(1).optional(),
  ELAGENTE_HARNESS_BASE_URL: z.string().url().optional(),
  INACT_X_APP_KEY: z.string().min(1).optional(),
  REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED: z.string().optional(),
  REMOTE_CODEX_HARNESS_WAKEUP_CALLBACK_BASE_URL: z.string().url().optional(),
  REMOTE_CODEX_WORKER_RUNTIME_MANIFEST: z.string().min(1).optional(),
  APP_NAME: z.string().min(1).optional(),
  APP_VERSION: z.string().min(1).optional(),
  WORKSPACE_ROOT: z.string().optional(),
  DATABASE_URL: z.string().optional(),
  REMOTE_CODEX_ADMIN_USERNAME: z.string().min(1).optional(),
  REMOTE_CODEX_ADMIN_PASSWORD: z.string().min(1).optional(),
  REMOTE_CODEX_SESSION_SECRET: z.string().min(16).optional(),
  REMOTE_CODEX_SESSION_TTL_SECONDS: z.coerce.number().int().positive().optional(),
  REMOTE_CODEX_RELAY_SERVER_URL: z.string().url().optional(),
  REMOTE_CODEX_RELAY_AGENT_TOKEN: z.string().min(1).optional(),
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

function optionalNonEmpty(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeOptionalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    ...env,
    WORKSPACE_ROOT: optionalNonEmpty(env.WORKSPACE_ROOT),
    DATABASE_URL: optionalNonEmpty(env.DATABASE_URL),
    REMOTE_CODEX_ADMIN_USERNAME: optionalNonEmpty(env.REMOTE_CODEX_ADMIN_USERNAME),
    REMOTE_CODEX_ADMIN_PASSWORD: optionalNonEmpty(env.REMOTE_CODEX_ADMIN_PASSWORD),
    REMOTE_CODEX_SESSION_SECRET: optionalNonEmpty(env.REMOTE_CODEX_SESSION_SECRET),
    REMOTE_CODEX_RELAY_SERVER_URL: optionalNonEmpty(env.REMOTE_CODEX_RELAY_SERVER_URL),
    REMOTE_CODEX_RELAY_AGENT_TOKEN: optionalNonEmpty(env.REMOTE_CODEX_RELAY_AGENT_TOKEN),
    CODEX_HOME: optionalNonEmpty(env.CODEX_HOME),
    CODEX_COMMAND: optionalNonEmpty(env.CODEX_COMMAND),
    CLAUDE_HOME: optionalNonEmpty(env.CLAUDE_HOME),
    CLAUDE_COMMAND: optionalNonEmpty(env.CLAUDE_COMMAND),
    OPENCODE_HOME: optionalNonEmpty(env.OPENCODE_HOME),
    OPENCODE_COMMAND: optionalNonEmpty(env.OPENCODE_COMMAND),
    REMOTE_CODEX_ENABLED_AGENT_PROVIDERS: optionalNonEmpty(
      env.REMOTE_CODEX_ENABLED_AGENT_PROVIDERS,
    ),
  };
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
  const parsed = envSchema.parse(normalizeOptionalEnv(env));
  const nodeEnv = parsed.NODE_ENV ?? 'development';
  const runtimeRole = parsed.REMOTE_CODEX_RUNTIME_ROLE ?? 'supervisor';
  const mode = parsed.REMOTE_CODEX_MODE ?? 'local';
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
    mode,
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
    workerIdentitySecret: parsed.REMOTE_CODEX_WORKER_IDENTITY_SECRET ?? null,
    controlPlaneBaseUrl: parsed.REMOTE_CODEX_CONTROL_PLANE_BASE_URL ?? null,
    controlPlaneServiceToken: parsed.REMOTE_CODEX_CONTROL_PLANE_SERVICE_TOKEN ?? null,
    llmGatewayBaseUrl: parsed.REMOTE_CODEX_LLM_GATEWAY_BASE_URL ?? null,
    llmGatewayToken: parsed.REMOTE_CODEX_LLM_GATEWAY_TOKEN ?? null,
    harnessBaseUrl: parsed.ELAGENTE_HARNESS_BASE_URL ?? null,
    harnessEnabled: Boolean(parsed.ELAGENTE_HARNESS_BASE_URL && parsed.INACT_X_APP_KEY),
    chemistryToolsEnabled: parseBoolean(parsed.REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED, false),
    harnessWakeupCallbackBaseUrl:
      parsed.REMOTE_CODEX_HARNESS_WAKEUP_CALLBACK_BASE_URL?.replace(/\/+$/, '') ?? null,
    workerRuntimeManifestPath: parsed.REMOTE_CODEX_WORKER_RUNTIME_MANIFEST
      ? path.resolve(parsed.REMOTE_CODEX_WORKER_RUNTIME_MANIFEST)
      : runtimeRole === 'worker'
        ? '/opt/remote-codex/worker-runtime-manifest.json'
        : null,
    appName: parsed.APP_NAME ?? (runtimeRole === 'worker' ? 'Remote Codex Worker' : 'Remote Codex Supervisor'),
    appVersion: parsed.APP_VERSION ?? '0.1.0',
    workspaceRoot,
    databaseUrl: resolveDatabaseUrl(nodeEnv, parsed.DATABASE_URL, runtimeRole),
    auth: {
      adminUsername: parsed.REMOTE_CODEX_ADMIN_USERNAME ?? null,
      adminPassword: parsed.REMOTE_CODEX_ADMIN_PASSWORD ?? null,
      sessionSecret: parsed.REMOTE_CODEX_SESSION_SECRET ?? null,
      sessionTtlSeconds: parsed.REMOTE_CODEX_SESSION_TTL_SECONDS ?? 60 * 60 * 24 * 7,
    },
    relay: {
      serverUrl: parsed.REMOTE_CODEX_RELAY_SERVER_URL ?? null,
      agentToken: parsed.REMOTE_CODEX_RELAY_AGENT_TOKEN ?? null,
    },
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
