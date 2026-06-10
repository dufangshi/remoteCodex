import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ENABLED_PROVIDER_RUNTIMES = ['codex', 'claude', 'opencode'];

export interface WorkerEnvironmentFilesystem {
  mkdirSync(path: string, options: { recursive: true; mode: number }): void;
  statSync(path: string): { isDirectory(): boolean };
  existsSync(path: string): boolean;
  accessSync(path: string, mode: number): void;
}

function requireEnv(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required in worker mode.`);
  }
  return value;
}

function assertPath(expected: string, actual: string | undefined, name: string) {
  if (path.resolve(actual ?? '') !== expected) {
    throw new Error(`${name} must be ${expected} in worker mode.`);
  }
}

function ensureDirectory(filesystem: WorkerEnvironmentFilesystem, dir: string, name: string) {
  filesystem.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = filesystem.statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`${name} must be a directory: ${dir}`);
  }
  filesystem.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
}

function assertPathInside(parent: string, child: string, name: string) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const relative = path.relative(resolvedParent, resolvedChild);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${name} must be inside ${resolvedParent} in worker mode.`);
  }
}

function ensureNotWorldWritable(
  filesystem: WorkerEnvironmentFilesystem,
  filePath: string,
  name: string,
) {
  if (!filesystem.existsSync(filePath)) {
    return;
  }
  const stat = filesystem.statSync(filePath);
  if ('mode' in stat && typeof stat.mode === 'number' && (stat.mode & 0o002) !== 0) {
    throw new Error(`${name} must not be world-writable in worker mode: ${filePath}`);
  }
}

function enabledProviderRuntimes(env: NodeJS.ProcessEnv) {
  const raw = env.REMOTE_CODEX_ENABLED_AGENT_PROVIDERS;
  if (raw === undefined) {
    return DEFAULT_ENABLED_PROVIDER_RUNTIMES;
  }
  return raw
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined) {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function validateMcpConfigPaths(env: NodeJS.ProcessEnv, filesystem: WorkerEnvironmentFilesystem) {
  const home = env.HOME ?? '/home/agent';
  const providerConfigs = [
    {
      enabled: enabledProviderRuntimes(env).includes('codex'),
      home: env.CODEX_HOME ?? path.join(home, '.codex'),
      file: 'config.toml',
      name: 'Codex MCP config path',
    },
    {
      enabled: enabledProviderRuntimes(env).includes('claude'),
      home: env.CLAUDE_HOME ?? path.join(home, '.claude'),
      file: 'settings.json',
      name: 'Claude MCP config path',
    },
    {
      enabled: enabledProviderRuntimes(env).includes('opencode'),
      home: env.OPENCODE_HOME ?? path.join(home, '.opencode'),
      file: 'opencode.json',
      name: 'OpenCode MCP config path',
    },
  ];

  for (const config of providerConfigs) {
    if (!config.enabled) {
      continue;
    }
    assertPathInside(home, config.home, config.name);
    ensureNotWorldWritable(
      filesystem,
      path.join(config.home, config.file),
      config.name,
    );
  }
}

function validateGatewayEnvironment(env: NodeJS.ProcessEnv) {
  if (enabledProviderRuntimes(env).length === 0) {
    return;
  }
  const baseUrl = requireEnv(env, 'REMOTE_CODEX_LLM_GATEWAY_BASE_URL');
  requireEnv(env, 'REMOTE_CODEX_LLM_GATEWAY_TOKEN');
  try {
    new URL(baseUrl);
  } catch {
    throw new Error('REMOTE_CODEX_LLM_GATEWAY_BASE_URL must be a valid URL.');
  }
}

function validateHarnessEnvironment(env: NodeJS.ProcessEnv) {
  if (!parseBoolean(env.REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED)) {
    return;
  }
  const baseUrl = requireEnv(env, 'ELAGENTE_HARNESS_BASE_URL');
  requireEnv(env, 'INACT_X_APP_KEY');
  try {
    new URL(baseUrl);
  } catch {
    throw new Error('ELAGENTE_HARNESS_BASE_URL must be a valid URL.');
  }
}

export function validateWorkerEntrypointEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  filesystem: WorkerEnvironmentFilesystem = fs,
) {
  if (env.REMOTE_CODEX_RUNTIME_ROLE !== 'worker') {
    throw new Error('REMOTE_CODEX_RUNTIME_ROLE must be worker for the worker entrypoint.');
  }
  requireEnv(env, 'REMOTE_CODEX_SANDBOX_ID');
  requireEnv(env, 'REMOTE_CODEX_USER_ID');
  requireEnv(env, 'REMOTE_CODEX_WORKER_AUTH_TOKEN');
  assertPath('/workspace', env.WORKSPACE_ROOT, 'WORKSPACE_ROOT');
  assertPath('/home/agent', env.HOME, 'HOME');
  ensureDirectory(filesystem, '/workspace', 'WORKSPACE_ROOT');
  ensureDirectory(filesystem, '/home/agent', 'HOME');
  ensureDirectory(filesystem, env.CODEX_HOME ?? '/home/agent/.codex', 'CODEX_HOME');
  ensureDirectory(filesystem, env.CLAUDE_HOME ?? '/home/agent/.claude', 'CLAUDE_HOME');
  ensureDirectory(filesystem, env.OPENCODE_HOME ?? '/home/agent/.opencode', 'OPENCODE_HOME');
  validateMcpConfigPaths(env, filesystem);
  validateGatewayEnvironment(env);
  validateHarnessEnvironment(env);
}

export function workerStartupLogPayload(env: NodeJS.ProcessEnv = process.env) {
  return {
    sandboxId: env.REMOTE_CODEX_SANDBOX_ID ?? null,
    userId: env.REMOTE_CODEX_USER_ID ?? null,
    workspaceRoot: env.WORKSPACE_ROOT ?? null,
    home: env.HOME ?? null,
    gatewayConfigured: Boolean(env.REMOTE_CODEX_LLM_GATEWAY_BASE_URL),
    harnessConfigured: Boolean(env.ELAGENTE_HARNESS_BASE_URL),
    chemistryToolsEnabled: parseBoolean(env.REMOTE_CODEX_CHEMISTRY_TOOLS_ENABLED),
  };
}
