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
import { registerSystemRoutes } from './routes/system';
import { registerThreadRoutes } from './routes/threads';
import { registerWorkspaceRoutes } from './routes/workspaces';
import { registerPluginRoutes } from './routes/plugins';
import { ProviderHostConfigService } from './provider-host-config-service';
import { ShellServiceError, ShellSessionService } from './shell/shell-session-service';
import { builtinPlugins } from './plugins/builtin-plugins';
import { PluginService } from './plugins/plugin-service';
import { PluginSettingsStore } from './plugins/plugin-settings-store';
import { configureWorkerProviderGateway } from './worker-bootstrap';
import { BackendPluginHost } from './plugins/backend-plugin-host';
import {
  createTerminalShellBackend,
  createTerminalPluginBackendContribution,
} from './plugins/terminal-plugin-backend';
import { WorkerIdentityError } from './worker-identity';

const MAX_PROMPT_ATTACHMENTS = 10;
const MAX_PROMPT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const WORKER_AUTH_EXEMPT_PATHS = new Set(['/healthz', '/readyz']);
export const SUPERVISOR_LOG_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-remote-codex-worker-token"]',
  'res.headers["set-cookie"]',
  'REMOTE_CODEX_WORKER_AUTH_TOKEN',
  'REMOTE_CODEX_WORKER_IDENTITY_SECRET',
  'REMOTE_CODEX_LLM_GATEWAY_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'INACT_X_APP_KEY',
  'workerAuthToken',
  'workerIdentitySecret',
  'llmGatewayToken',
  'keyCiphertext',
  '*.keyCiphertext',
];

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
  repoRoot: string;
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
  const repoRoot = findRepoRoot();
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
    new ShellSessionService(
      database.db,
      eventBus,
      createTerminalShellBackend(options.env),
    );
  const providerHostConfigService = new ProviderHostConfigService(
    agentRuntimes,
    runtimeBootstrap.providerHostHomes,
  );

  const app = Fastify({
    logger:
      config.nodeEnv === 'test'
        ? false
        : {
            level: config.logLevel,
            redact: {
              paths: SUPERVISOR_LOG_REDACTION_PATHS,
              censor: '[redacted]',
            },
          },
    disableRequestLogging: config.disableRequestLogging
  });

  app.addHook('onRequest', async (request) => {
    if (
      config.runtimeRole !== 'worker' ||
      !config.workerAuthToken ||
      WORKER_AUTH_EXEMPT_PATHS.has(request.url.split('?')[0] ?? request.url)
    ) {
      return;
    }

    const headerToken = request.headers['x-remote-codex-worker-token'];
    const authorization = request.headers.authorization;
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    const token = typeof headerToken === 'string' ? headerToken : bearer;
    if (token !== config.workerAuthToken) {
      throw new HttpError(401, {
        code: 'forbidden',
        message: 'Worker access requires a valid router token.',
      });
    }
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
    pluginService,
    repoRoot
  });

  const backendPluginHost = new BackendPluginHost(app);
  backendPluginHost.register(createTerminalPluginBackendContribution());

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
        const closeHandlers: Array<() => void> = [];
        const socketState = new Map<string, unknown>();
        const onClose = (handler: () => void) => {
          closeHandlers.push(handler);
        };

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

            const handled = await backendPluginHost.handleSocketMessage({
              app,
              send,
              onClose,
              state: socketState,
              message: parsed,
            });
            if (!handled) {
              return;
            }
          } catch {
            return;
          }
        });

        socket.on('close', () => {
          for (const handler of closeHandlers.splice(0)) {
            handler();
          }
          unsubscribe();
          unsubscribeShell();
        });
      }
    });
  });

  app.register(registerSystemRoutes);
  app.register(registerAgentRuntimeRoutes);
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

    if (error instanceof WorkerIdentityError) {
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
              error.code === 'invalid_viewer' ||
              error.code === 'plugin_disabled'
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
      await configureWorkerProviderGateway(config);
      await pluginService.syncManagedCodexMcpConfig({
        codexHome: runtimeBootstrap.providerHostHomes.codex ?? null,
        repoRoot,
      });
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
