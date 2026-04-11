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
import {
  ApiErrorShape,
  ShellEventEnvelope,
  SupervisorSocketClientEnvelope,
  SupervisorSocketServerEnvelope,
} from '../../../packages/shared/src/index';
import { WorkspaceServiceError } from '../../../packages/workspace/src/index';
import { SupervisorEventBus } from './codex/event-bus';
import { LocalCodexSessionStore } from './codex/local-session-store';
import { ThreadService } from './codex/thread-service';
import { registerCodexRoutes } from './routes/codex';
import { registerShellRoutes } from './routes/shells';
import { registerSystemRoutes } from './routes/system';
import { registerThreadRoutes } from './routes/threads';
import { registerWorkspaceRoutes } from './routes/workspaces';
import { ShellServiceError, ShellSessionService } from './shell/shell-session-service';
import { TmuxManager } from './shell/tmux-manager';

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
  shellService: ShellSessionService;
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
    shellService?: ShellSessionService;
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
  const shellService =
    options.shellService ??
    new ShellSessionService(database.db, eventBus, new TmuxManager());

  const app = Fastify({
    logger: config.nodeEnv !== 'test'
  });

  app.decorate('services', {
    config,
    database,
    codexManager,
    eventBus,
    threadService,
    shellService
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
        let attachedShell: { shellId: string; viewerId: string } | null = null;

        function send(message: SupervisorSocketServerEnvelope) {
          if (socket.readyState === 1) {
            socket.send(JSON.stringify(message));
          }
        }

        send({
          type: 'supervisor.connected',
          timestamp: new Date().toISOString()
        });

        const unsubscribe = eventBus.onThreadEvent((event) => {
          send(event);
        });
        const unsubscribeShell = eventBus.onShellEvent((event) => {
          send(event);
        });

        socket.on('message', async (rawMessage: Buffer) => {
          let parsed: SupervisorSocketClientEnvelope;
          try {
            parsed = JSON.parse(rawMessage.toString()) as SupervisorSocketClientEnvelope;
          } catch {
            return;
          }

          try {
            if (parsed.type === 'shell.attach') {
              if (
                attachedShell &&
                attachedShell.shellId !== parsed.shellId
              ) {
                await shellService.detachShell(
                  attachedShell.shellId,
                  attachedShell.viewerId,
                );
                attachedShell = null;
              }

              const attachment = await shellService.attachShell(parsed.shellId, {
                cols: parsed.cols,
                rows: parsed.rows,
                onData: (data, replace) => {
                  send({
                    type: 'shell.output',
                    shellId: parsed.shellId,
                    timestamp: new Date().toISOString(),
                    payload: {
                      data,
                      ...(replace ? { replace: true } : {}),
                    }
                  });
                },
              });
              attachedShell = {
                shellId: parsed.shellId,
                viewerId: attachment.viewerId,
              };
              send({
                type: 'shell.connected',
                shellId: parsed.shellId,
                timestamp: new Date().toISOString(),
                payload: {
                  viewerId: attachment.viewerId,
                },
              });
              return;
            }

            if (parsed.type === 'shell.detach') {
              await shellService.detachShell(parsed.shellId, parsed.viewerId);
              if (
                attachedShell?.shellId === parsed.shellId &&
                attachedShell.viewerId === parsed.viewerId
              ) {
                attachedShell = null;
              }
              return;
            }

            if (parsed.type === 'shell.input') {
              await shellService.sendInput(
                parsed.shellId,
                parsed.viewerId,
                parsed.data,
              );
              return;
            }

            if (parsed.type === 'shell.resize') {
              await shellService.resizeShell(
                parsed.shellId,
                parsed.viewerId,
                parsed.cols,
                parsed.rows,
              );
            }
          } catch (error) {
            send(makeShellErrorEnvelope(parsed.shellId, error));
          }
        });

        socket.on('close', () => {
          if (attachedShell) {
            void shellService.detachShell(
              attachedShell.shellId,
              attachedShell.viewerId,
            ).catch(() => {});
            attachedShell = null;
          }
          unsubscribe();
          unsubscribeShell();
        });
      }
    });
  });

  app.register(registerSystemRoutes);
  app.register(registerCodexRoutes);
  app.register(registerShellRoutes);
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

    if (error instanceof ShellServiceError) {
      const statusCode =
        error.code === 'thread_not_found' || error.code === 'shell_not_found'
          ? 404
          : error.code === 'viewer_conflict' ||
              error.code === 'shell_exists' ||
              error.code === 'workspace_missing' ||
              error.code === 'shell_not_running' ||
              error.code === 'viewer_not_attached' ||
              error.code === 'invalid_viewer'
            ? 409
            : 503;
      reply.status(statusCode).send({
        code:
          statusCode === 404
            ? 'not_found'
            : statusCode === 409
              ? 'conflict'
              : 'service_unavailable',
        message: error.message,
        details: {
          shellCode: error.code,
        },
      } satisfies ApiErrorShape);
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
    await shellService.stop();
    await codexManager.stop();
    database.sqlite.close();
  });

  app.addHook('onReady', async () => {
    try {
      await codexManager.start();
      await shellService.syncShellStateOnStartup();
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

function makeShellErrorEnvelope(
  shellId: string,
  error: unknown,
): ShellEventEnvelope {
  if (error instanceof ShellServiceError) {
    return {
      type: 'shell.error',
      shellId,
      timestamp: new Date().toISOString(),
      payload: {
        code: error.code,
        message: error.message,
      },
    };
  }

  return {
    type: 'shell.error',
    shellId,
    timestamp: new Date().toISOString(),
    payload: {
      code: 'unknown',
      message:
        error instanceof Error ? error.message : 'Unexpected shell error.',
    },
  };
}
