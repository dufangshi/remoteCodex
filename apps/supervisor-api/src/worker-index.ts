import fs from 'node:fs';
import path from 'node:path';

import { buildApp } from './app';

if (fs.existsSync('.env')) {
  process.loadEnvFile?.('.env');
}

process.env.REMOTE_CODEX_RUNTIME_ROLE ??= 'worker';
process.env.HOST ??= '0.0.0.0';
process.env.WORKSPACE_ROOT ??= '/workspace';
process.env.HOME ??= '/home/agent';
process.env.CODEX_HOME ??= '/home/agent/.codex';
process.env.CLAUDE_HOME ??= '/home/agent/.claude';
process.env.CLAUDE_CONFIG_DIR ??= '/home/agent/.claude';
process.env.OPENCODE_HOME ??= '/home/agent/.opencode';
process.env.REMOTE_CODEX_DISABLE_BUILD_RESTART ??= 'true';

function requireEnv(name: string) {
  const value = process.env[name];
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

function ensureDirectory(dir: string, name: string) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`${name} must be a directory: ${dir}`);
  }
  fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
}

function validateWorkerEnvironment() {
  if (process.env.REMOTE_CODEX_RUNTIME_ROLE !== 'worker') {
    throw new Error('REMOTE_CODEX_RUNTIME_ROLE must be worker for the worker entrypoint.');
  }
  requireEnv('REMOTE_CODEX_SANDBOX_ID');
  requireEnv('REMOTE_CODEX_USER_ID');
  requireEnv('REMOTE_CODEX_WORKER_AUTH_TOKEN');
  assertPath('/workspace', process.env.WORKSPACE_ROOT, 'WORKSPACE_ROOT');
  assertPath('/home/agent', process.env.HOME, 'HOME');
  ensureDirectory('/workspace', 'WORKSPACE_ROOT');
  ensureDirectory('/home/agent', 'HOME');
  ensureDirectory(process.env.CODEX_HOME ?? '/home/agent/.codex', 'CODEX_HOME');
  ensureDirectory(process.env.CLAUDE_HOME ?? '/home/agent/.claude', 'CLAUDE_HOME');
  ensureDirectory(process.env.OPENCODE_HOME ?? '/home/agent/.opencode', 'OPENCODE_HOME');
}

validateWorkerEnvironment();

const app = buildApp();
const { host, port } = app.services.config;

app
  .listen({ host, port })
  .then(() => {
    app.log.info(
      {
        sandboxId: app.services.config.sandboxId,
        userId: app.services.config.userId,
        workspaceRoot: app.services.config.workspaceRoot,
      },
      `Remote Codex Worker listening on http://${host}:${port}`,
    );
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
