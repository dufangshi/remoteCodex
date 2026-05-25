import { buildSandboxRouterApp } from './app';

const app = buildSandboxRouterApp();
const { host, port } = app.services.config;

app
  .listen({ host, port })
  .then(() => {
    app.log.info(`Remote Codex sandbox router listening on http://${host}:${port}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
