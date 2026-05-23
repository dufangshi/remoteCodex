import fs from 'node:fs';

import { buildControlPlaneApp } from './app';

if (fs.existsSync('.env')) {
  process.loadEnvFile?.('.env');
}

const app = buildControlPlaneApp();
const { host, port } = app.services.config;

app
  .listen({ host, port })
  .then(() => {
    app.log.info(`Control Plane API listening on http://${host}:${port}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
