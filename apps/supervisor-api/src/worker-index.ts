import fs from 'node:fs';

import { buildApp } from './app';
import {
  validateWorkerEntrypointEnvironment,
  workerStartupLogPayload,
} from './worker-environment';

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

validateWorkerEntrypointEnvironment();

const app = buildApp();
const { host, port } = app.services.config;
let shutdownStarted = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  const hardExit = setTimeout(() => {
    app.log.error({ signal }, 'Remote Codex Worker graceful shutdown timed out.');
    process.exit(1);
  }, 55_000);
  hardExit.unref();

  try {
    app.log.info({ signal }, 'Remote Codex Worker shutting down.');
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ error, signal }, 'Remote Codex Worker shutdown failed.');
    process.exit(1);
  }
}

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

app
  .listen({ host, port })
  .then(() => {
    app.log.info(
      workerStartupLogPayload(process.env),
      `Remote Codex Worker listening on http://${host}:${port}`,
    );
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
