import fs from 'node:fs';
import { ZodError } from 'zod';

import { buildRelayServer } from './app';
import { loadRelayServerConfig } from './config';

if (fs.existsSync('.env')) {
  process.loadEnvFile?.('.env');
}

let config;
try {
  config = loadRelayServerConfig();
} catch (error) {
  if (error instanceof ZodError) {
    console.error('Remote Codex relay configuration is invalid.');
    for (const issue of error.issues) {
      const name = issue.path.join('.') || 'environment';
      console.error(`- ${name}: ${issue.message}`);
    }
    console.error('');
    console.error('Required: REMOTE_CODEX_ADMIN_USERNAME, REMOTE_CODEX_ADMIN_PASSWORD');
    console.error('Optional: REMOTE_CODEX_ADMIN_EMAIL, REMOTE_CODEX_RELAY_SUPERVISOR_TOKEN, REMOTE_CODEX_RELAY_CLIENT_TOKEN, REMOTE_CODEX_RELAY_SESSION_SECRET, REMOTE_CODEX_RELAY_DATA_DIR, REMOTE_CODEX_RELAY_WEB_DIST_DIR, HOST, PORT');
    process.exit(1);
  }

  throw error;
}

const app = buildRelayServer(config);

app
  .listen({ host: config.host, port: config.port })
  .then(() => {
    app.log.info(`Remote Codex relay listening on http://${config.host}:${config.port}`);
  })
  .catch((error) => {
    console.error(
      `Failed to start Remote Codex relay on http://${config.host}:${config.port}.`,
    );
    console.error(error instanceof Error ? error.message : String(error));
    app.log.error(error);
    process.exit(1);
  });
