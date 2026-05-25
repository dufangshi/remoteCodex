import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ENABLED_PROVIDER_RUNTIMES = ['codex', 'claude', 'opencode'];

export interface WorkerEnvironmentFilesystem {
  mkdirSync(path: string, options: { recursive: true; mode: number }): void;
  statSync(path: string): { isDirectory(): boolean };
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
  validateGatewayEnvironment(env);
}
