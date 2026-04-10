import Fastify, { FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';

import { CodexAppServerManager, JsonRpcClientError } from '../../../packages/codex/src/index';
import { loadRuntimeConfig, RuntimeConfig } from '../../../packages/config/src/index';
import {
  createDatabase,
  DatabaseContext,
  runMigrations,
  seedDefaults
} from '../../../packages/db/src/index';
import { ApiErrorShape } from '../../../packages/shared/src/index';
import { WorkspaceServiceError } from '../../../packages/workspace/src/index';
import { SupervisorEventBus } from './codex/event-bus';
import { LocalCodexSessionStore } from './codex/local-session-store';
import { ThreadService } from './codex/thread-service';
import { registerCodexRoutes } from './routes/codex';
import { registerSystemRoutes } from './routes/system';
import { registerThreadRoutes } from './routes/threads';
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
  codexManager: CodexAppServerManager;
  eventBus: SupervisorEventBus;
  threadService: ThreadService;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}

export function buildApp(
  options: {
    env?: NodeJS.ProcessEnv;
    codexManager?: CodexAppServerManager;
  } = {}
): FastifyInstance {
  const config = loadRuntimeConfig(options.env);
  runMigrations(config.databaseUrl);

  const database = createDatabase(config.databaseUrl);
  seedDefaults(database.db);
  const eventBus = new SupervisorEventBus();
  const localSessionStore = new LocalCodexSessionStore(config.codexHome);
  const codexManager =
    options.codexManager ??
    new CodexAppServerManager({
      command: config.codexCommand,
      startupTimeoutMs: config.codexAppServerStartTimeoutMs,
      clientInfo: {
        name: 'remote-codex-supervisor',
        title: config.appName,
        version: config.appVersion
      }
    });
  const threadService = new ThreadService(
    database.db,
    codexManager,
    eventBus,
    localSessionStore,
    config.workspaceRoot
  );

  const app = Fastify({
    logger: config.nodeEnv !== 'test'
  });

  app.decorate('services', {
    config,
    database,
    codexManager,
    eventBus,
    threadService
  });

  app.register(async (realtimeApp) => {
    await realtimeApp.register(websocket);

    realtimeApp.route({
      method: 'GET',
      url: '/ws',
      handler: (_request, reply) => {
        reply.status(426).send({
          code: 'bad_request',
          message: 'Upgrade to websocket is required.'
        } satisfies ApiErrorShape);
      },
      wsHandler: (socket) => {
        socket.send(
          JSON.stringify({
            type: 'supervisor.connected',
            timestamp: new Date().toISOString()
          })
        );

        const unsubscribe = eventBus.onThreadEvent((event) => {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify(event));
          }
        });

        socket.on('close', () => {
          unsubscribe();
        });
      }
    });
  });

  app.register(registerSystemRoutes);
  app.register(registerCodexRoutes);
  app.register(registerThreadRoutes);
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

    if (error instanceof JsonRpcClientError) {
      const payload: ApiErrorShape = {
        code: 'service_unavailable',
        message: error.message
      };

      if (error.details) {
        payload.details = error.details;
      }

      reply.status(503).send(payload);
      return;
    }

    requestLog(app, error);
    reply.status(500).send({
      code: 'internal_error',
      message: 'An unexpected server error occurred.'
    } satisfies ApiErrorShape);
  });

  app.addHook('onClose', async () => {
    await codexManager.stop();
    database.sqlite.close();
  });

  app.addHook('onReady', async () => {
    try {
      await codexManager.start();
    } catch (error) {
      requestLog(app, error);
    }
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
