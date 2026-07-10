import fs from 'node:fs';

import { buildApp } from './app';

if (fs.existsSync('.env')) {
  process.loadEnvFile?.('.env');
}

const app = buildApp();
const { host, port } = app.services.config;
let closing = false;

async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`Supervisor API received ${signal}; closing cleanly.`);
  try {
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

app
  .listen({ host, port })
  .then(() => {
    app.log.info(`Supervisor API listening on http://${host}:${port}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
