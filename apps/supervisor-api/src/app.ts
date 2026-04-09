import Fastify, { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';

import { loadRuntimeConfig, RuntimeConfig } from '../../../packages/config/src/index';
import {
  createDatabase,
  DatabaseContext,
  runMigrations,
  seedDefaults
} from '../../../packages/db/src/index';
import { ApiErrorShape } from '../../../packages/shared/src/index';
import { WorkspaceServiceError } from '../../../packages/workspace/src/index';
import { registerSystemRoutes } from './routes/system';
import { registerWorkspaceRoutes } from './routes/workspaces';

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly payload: ApiErrorShape
  ) {
    super(payload.message);
  }
}

export interface AppServices {
  config: RuntimeConfig;
  database: DatabaseContext;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}

export function buildApp(options: { env?: NodeJS.ProcessEnv } = {}): FastifyInstance {
  const config = loadRuntimeConfig(options.env);
  runMigrations(config.databaseUrl);

  const database = createDatabase(config.databaseUrl);
  seedDefaults(database.db);

  const app = Fastify({
    logger: config.nodeEnv !== 'test'
  });

  app.decorate('services', {
    config,
    database
  });

  app.register(websocket);

  app.get('/ws', { websocket: true }, (socket) => {
    socket.send(
      JSON.stringify({
        type: 'supervisor.connected',
        timestamp: new Date().toISOString()
      })
    );
  });

  app.register(registerSystemRoutes);
  app.register(registerWorkspaceRoutes);

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({
      code: 'not_found',
      message: 'The requested endpoint was not found.'
    } satisfies ApiErrorShape);
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      reply.status(error.statusCode).send(error.payload);
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        code: 'bad_request',
        message: 'The request payload is invalid.',
        details: {
          issues: error.issues
        }
      } satisfies ApiErrorShape);
      return;
    }

    if (error instanceof WorkspaceServiceError) {
      const statusCode =
        error.code === 'path_outside_root'
          ? 403
          : error.code === 'path_not_found'
            ? 404
            : 400;
      const payload: ApiErrorShape = {
        code:
          statusCode === 403
            ? 'forbidden'
            : statusCode === 404
              ? 'not_found'
              : 'bad_request',
        message: error.message
      };

      if (error.details) {
        payload.details = error.details;
      }

      reply.status(statusCode).send(payload);
      return;
    }

    requestLog(app, error);
    reply.status(500).send({
      code: 'internal_error',
      message: 'An unexpected server error occurred.'
    } satisfies ApiErrorShape);
  });

  app.addHook('onClose', async () => {
    database.sqlite.close();
  });

  return app;
}

function requestLog(app: FastifyInstance, error: unknown) {
  if (error instanceof Error) {
    app.log.error(error);
    return;
  }

  app.log.error({ error }, 'Non-error value reached Fastify error handler.');
}

export { HttpError };
