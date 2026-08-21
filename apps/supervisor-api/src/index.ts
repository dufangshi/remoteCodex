import fs from 'node:fs';

import { buildApp } from './app';
import { LifecycleControlServer } from './platform/lifecycle-control';

if (fs.existsSync('.env')) {
  process.loadEnvFile?.('.env');
}

const app = buildApp();
const { host, port } = app.services.config;
let closing = false;
const lifecycleControl =
  process.env.REMOTE_CODEX_LIFECYCLE_CONTROL_ENDPOINT &&
  process.env.REMOTE_CODEX_LIFECYCLE_CONTROL_TOKEN &&
  process.env.REMOTE_CODEX_LIFECYCLE_INSTANCE_ID
    ? new LifecycleControlServer({
        endpoint: process.env.REMOTE_CODEX_LIFECYCLE_CONTROL_ENDPOINT,
        token: process.env.REMOTE_CODEX_LIFECYCLE_CONTROL_TOKEN,
        instanceId: process.env.REMOTE_CODEX_LIFECYCLE_INSTANCE_ID,
        onShutdown: () => shutdown('lifecycle control request'),
      })
    : null;

async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`Supervisor API received ${signal}; closing cleanly.`);
  try {
    await app.close();
    await lifecycleControl?.stop();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

Promise.resolve()
  .then(() => lifecycleControl?.start())
  .then(() => app.listen({ host, port }))
  .then(() => {
    app.log.info(`Supervisor API listening on http://${host}:${port}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
