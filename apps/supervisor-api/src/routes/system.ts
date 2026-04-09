import { FastifyInstance } from 'fastify';

import {
  HealthDto,
  RuntimeConfigDto,
  VersionDto
} from '../../../../packages/shared/src/index';

export async function registerSystemRoutes(app: FastifyInstance) {
  app.get('/healthz', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString()
    } satisfies HealthDto;
  });

  app.get('/api/version', async () => {
    return {
      name: app.services.config.appName,
      version: app.services.config.appVersion
    } satisfies VersionDto;
  });

  app.get('/api/config/runtime', async () => {
    return {
      appName: app.services.config.appName,
      appVersion: app.services.config.appVersion,
      host: app.services.config.host,
      port: app.services.config.port,
      workspaceRoot: app.services.config.workspaceRoot,
      environment: app.services.config.nodeEnv
    } satisfies RuntimeConfigDto;
  });
}
