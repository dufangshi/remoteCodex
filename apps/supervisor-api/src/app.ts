import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ZodError } from 'zod';

import { loadRuntimeConfig, RuntimeConfig } from '../../../packages/config/src/index';
import {
  AgentRuntimeManagementError,
  AgentRuntimeError,
  AgentRuntimeRegistry,
} from '../../../packages/agent-runtime/src/index';
import { PluginRegistry } from '../../../packages/plugin-runtime/src/index';
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
import {
  AgentRuntimeBootstrap,
  createAgentRuntimeBootstrap,
} from './agent-runtime-bootstrap';
import { SupervisorEventBus } from './event-bus';
import { ThreadService } from './thread-service';
import { registerAgentRuntimeRoutes } from './routes/agent-runtimes';
import { registerShellRoutes } from './routes/shells';
import { registerSystemRoutes } from './routes/system';
import { registerThreadRoutes } from './routes/threads';
import { registerWorkspaceRoutes } from './routes/workspaces';
import { registerPluginRoutes } from './routes/plugins';
import { ProviderHostConfigService } from './provider-host-config-service';
import { ShellServiceError, ShellSessionService } from './shell/shell-session-service';
import { TmuxManager } from './shell/tmux-manager';
import { builtinPlugins } from './plugins/builtin-plugins';
import { PluginService } from './plugins/plugin-service';
import { PluginSettingsStore } from './plugins/plugin-settings-store';

const MAX_PROMPT_ATTACHMENTS = 10;
const MAX_PROMPT_ATTACHMENT_BYTES = 25 * 1024 * 1024;

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
  agentRuntimes: AgentRuntimeRegistry;
  serviceLifecycle: {
    launchBuildRestart: () => Promise<{ pid: number | null }>;
  };
  eventBus: SupervisorEventBus;
  threadService: ThreadService;
  shellService: ShellSessionService;
  providerHostConfigService: ProviderHostConfigService;
  pluginRegistry: PluginRegistry;
  pluginService: PluginService;
}

function findRepoRoot(start = process.cwd()) {
  if (process.env.REMOTE_CODEX_REPO_ROOT) {
    return path.resolve(process.env.REMOTE_CODEX_REPO_ROOT);
  }

  let current = path.resolve(start);

  while (current !== path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, 'pnpm-workspace.yaml')) &&
      fs.existsSync(path.join(current, 'scripts', 'service-restart.mjs'))
    ) {
      return current;
    }

    current = path.dirname(current);
  }

  return path.resolve(process.cwd());
}

function createServiceLifecycle() {
  return {
    async launchBuildRestart() {
      if (process.env.REMOTE_CODEX_DISABLE_BUILD_RESTART === 'true') {
        throw new HttpError(503, {
          code: 'service_unavailable',
          message:
            'Build and restart is not available from the npm-installed package. Upgrade with npm install -g remote-codex@latest, then run remote-codex stop and remote-codex start.',
        });
      }

      const repoRoot = findRepoRoot();
      const restartScript = path.join(repoRoot, 'scripts', 'service-restart.mjs');
      if (!fs.existsSync(restartScript) || !fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))) {
        throw new HttpError(503, {
          code: 'service_unavailable',
          message:
            'Build and restart requires a Remote Codex source checkout. Set REMOTE_CODEX_REPO_ROOT to the checkout path, or update the npm package with npm install -g remote-codex@latest.',
        });
      }

      const child = spawn(process.execPath, [restartScript, 'launch'], {
        cwd: repoRoot,
        detached: true,
        env: process.env,
        stdio: 'ignore',
      });

      child.unref();
      return { pid: child.pid ?? null };
    },
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    services: AppServices;
  }
}

export function buildApp(
  options: {
    env?: NodeJS.ProcessEnv;
    agentRuntimes?: AgentRuntimeRegistry;
    runtimeBootstrap?: AgentRuntimeBootstrap;
    shellService?: ShellSessionService;
    serviceLifecycle?: AppServices['serviceLifecycle'];
  } = {}
): FastifyInstance {
  const config = loadRuntimeConfig(options.env);
  runMigrations(config.databaseUrl);

  const database = createDatabase(config.databaseUrl);
  seedDefaults(database.db);
  const eventBus = new SupervisorEventBus();
  const pluginRegistry = new PluginRegistry(builtinPlugins);
  const pluginSettingsStore = new PluginSettingsStore(database.db);
  const pluginService = new PluginService(pluginRegistry, pluginSettingsStore);
  const runtimeBootstrap = options.runtimeBootstrap ?? createAgentRuntimeBootstrap(config);
  const agentRuntimes = options.agentRuntimes ?? runtimeBootstrap.agentRuntimes;
  const threadService = new ThreadService(
    database.db,
    agentRuntimes,
    eventBus,
    runtimeBootstrap.localCodexSessionStore,
    config.workspaceRoot,
    runtimeBootstrap.codexManagement,
    pluginService,
  );
  const shellService =
    options.shellService ??
    new ShellSessionService(database.db, eventBus, new TmuxManager());
  const providerHostConfigService = new ProviderHostConfigService(
    agentRuntimes,
    runtimeBootstrap.providerHostHomes,
  );

  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: config.logLevel
          },
    disableRequestLogging: config.disableRequestLogging
  });

  app.register(multipart, {
    limits: {
      files: MAX_PROMPT_ATTACHMENTS,
      fileSize: MAX_PROMPT_ATTACHMENT_BYTES,
    },
  });

  app.decorate('services', {
    config,
    database,
    agentRuntimes,
    serviceLifecycle: options.serviceLifecycle ?? createServiceLifecycle(),
    eventBus,
    threadService,
    shellService,
    providerHostConfigService,
    pluginRegistry,
    pluginService
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
                onData: (data, options) => {
                  send({
                    type: 'shell.output',
                    shellId: parsed.shellId,
                    timestamp: new Date().toISOString(),
                    payload: {
                      data,
                      ...(options?.replace ? { replace: true } : {}),
                      ...(options?.cursorX !== undefined
                        ? { cursorX: options.cursorX }
                        : {}),
                      ...(options?.cursorY !== undefined
                        ? { cursorY: options.cursorY }
                        : {}),
                      ...(options?.paneHeight !== undefined
                        ? { paneHeight: options.paneHeight }
                        : {}),
                      ...(options?.cwdBaseName !== undefined
                        ? { cwdBaseName: options.cwdBaseName }
                        : {}),
                      ...(options?.envPrefix !== undefined
                        ? { envPrefix: options.envPrefix }
                        : {}),
                      ...(options?.isCommandRunning !== undefined
                        ? { isCommandRunning: options.isCommandRunning }
                        : {}),
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

            if (parsed.type === 'supervisor.ping') {
              send({
                type: 'supervisor.pong',
                timestamp: new Date().toISOString(),
                payload: {
                  requestTimestamp:
                    typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
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
              return;
            }

            if (parsed.type === 'shell.clear') {
              await shellService.clearShell(parsed.shellId, parsed.viewerId);
            }
          } catch (error) {
            if ('shellId' in parsed) {
              send(makeShellErrorEnvelope(parsed.shellId, error));
            }
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
  app.register(registerAgentRuntimeRoutes);
  app.register(registerShellRoutes);
  app.register(registerPluginRoutes);
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

    if (error instanceof AgentRuntimeManagementError) {
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
              error.code === 'thread_not_connected' ||
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

    if (error instanceof AgentRuntimeError) {
      const payload: ApiErrorShape = {
        code: 'service_unavailable',
        message: error.message
      };

      if (error.details) {
        payload.details = {
          ...error.details,
          provider: error.provider,
          runtimeCode: error.code,
        };
      }

      reply.status(503).send(payload);
      return;
    }

    if (error instanceof ZodError) {
      reply.status(400).send({
        code: 'bad_request',
        message: 'Request validation failed.',
        details: {
          issues: error.issues,
        },
      } satisfies ApiErrorShape);
      return;
    }

    if (
      error instanceof Error &&
      'statusCode' in error &&
      typeof error.statusCode === 'number' &&
      error.statusCode >= 400 &&
      error.statusCode < 600
    ) {
      if ('code' in error && error.code === 'FST_REQ_FILE_TOO_LARGE') {
        reply.status(413).send({
          code: 'bad_request',
          message: `Each attachment must be ${MAX_PROMPT_ATTACHMENT_BYTES / (1024 * 1024)} MB or smaller.`,
          details: {
            fastifyCode: error.code,
            maxBytes: MAX_PROMPT_ATTACHMENT_BYTES,
          },
        } satisfies ApiErrorShape);
        return;
      }

      const payload: ApiErrorShape = {
        code: 'bad_request',
        message: error.message || 'Request could not be processed.',
      };
      if ('details' in error && error.details && typeof error.details === 'object') {
        payload.details = error.details as Record<string, unknown>;
      }
      reply.status(error.statusCode).send(payload);
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
    await Promise.all(agentRuntimes.all().map((runtime) => runtime.stop()));
    database.sqlite.close();
  });

  app.addHook('onReady', async () => {
    try {
      await Promise.all(agentRuntimes.all().map((runtime) => runtime.start()));
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
