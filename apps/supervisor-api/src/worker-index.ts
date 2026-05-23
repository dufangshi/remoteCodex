import fs from 'node:fs';

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
