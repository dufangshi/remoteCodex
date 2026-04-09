import fs from 'node:fs';

import { buildApp } from './app';

if (fs.existsSync('.env')) {
  process.loadEnvFile?.('.env');
}

const app = buildApp();
const { host, port } = app.services.config;

app
  .listen({ host, port })
  .then(() => {
    app.log.info(`Supervisor API listening on http://${host}:${port}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
