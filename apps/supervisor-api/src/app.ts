import Fastify, {
  FastifyInstance,
  type FastifyPluginCallback,
  type FastifyRequest,
  type RouteOptions,
} from 'fastify';
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
  RelayHttpRequestPayload,
  RelayHttpResponsePayload,
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
import { registerAuthRoutes } from './routes/auth';
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
import { WorkerHarnessClient } from './worker-harness-client';
import { WorkerControlPlaneSyncClient } from './worker-control-plane-sync';
import { AuthService, unauthorizedPayload } from './auth';
import { RelayTunnelClient } from './relay-tunnel-client';

type WebsocketLike = {
  readyState: number;
  send: (message: string) => void;
  close: (code?: number, reason?: string) => void;
  on(event: 'message', handler: (message: Buffer | ArrayBuffer | string) => void): void;
  on(event: 'close', handler: () => void): void;
};

type WebsocketRouteOptions = RouteOptions & {
  wsHandler: (socket: WebsocketLike, request: FastifyRequest) => void | Promise<void>;
};

const MAX_PROMPT_ATTACHMENTS = 10;
const MAX_PROMPT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const WORKER_AUTH_EXEMPT_PATHS = new Set(['/healthz', '/readyz']);
const RELAY_FORWARD_HEADER = 'x-remote-codex-relay-forwarded';
export const SUPERVISOR_LOG_REDACTION_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-remote-codex-worker-token"]',
  'res.headers["set-cookie"]',
  'REMOTE_CODEX_WORKER_AUTH_TOKEN',
  'REMOTE_CODEX_WORKER_IDENTITY_SECRET',
  'REMOTE_CODEX_CONTROL_PLANE_SERVICE_TOKEN',
  'REMOTE_CODEX_LLM_GATEWAY_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'INACT_X_APP_KEY',
  'workerAuthToken',
  'workerIdentitySecret',
  'controlPlaneServiceToken',
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
  harnessClient: WorkerHarnessClient;
  controlPlaneSyncClient: Pick<WorkerControlPlaneSyncClient, 'checkpointSession' | 'recordHarnessUsageEvent'> &
    Partial<Pick<WorkerControlPlaneSyncClient, 'checkHarnessQuota'>>;
  authService: AuthService;
  relayTunnelClient: RelayTunnelClient | null;
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
    controlPlaneSyncClient?: AppServices['controlPlaneSyncClient'];
    relayTunnelClient?: RelayTunnelClient;
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
  const authService = new AuthService(config);
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
    config,
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
  const harnessClient = new WorkerHarnessClient(config, {
    env: options.env ?? process.env,
  });
  const controlPlaneSyncClient =
    options.controlPlaneSyncClient ?? new WorkerControlPlaneSyncClient(config);

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

  app.register(multipart as unknown as FastifyPluginCallback<Record<string, unknown>>, {
    limits: {
      files: MAX_PROMPT_ATTACHMENTS,
      fileSize: MAX_PROMPT_ATTACHMENT_BYTES,
    },
  } as Record<string, unknown>);

  const backendPluginHost = new BackendPluginHost(app);
  backendPluginHost.register(createTerminalPluginBackendContribution());
  const relaySocketBridge = createRelaySocketBridge(app, eventBus, backendPluginHost);
  const relayTunnelClient =
    config.mode === 'relay'
      ? (options.relayTunnelClient ??
          new RelayTunnelClient(
            config.relay,
            createRelayRequestHandler(app),
            relaySocketBridge.handleConnected,
            relaySocketBridge.handleMessage,
          )
        )
      : null;
  relayTunnelClient?.validateConfig();

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
    harnessClient,
    controlPlaneSyncClient,
    authService,
    relayTunnelClient,
    repoRoot
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!authService.required) {
      return;
    }

    const requestPath = new URL(request.url, 'http://localhost').pathname;

    if (!requestPath.startsWith('/api/')) {
      return;
    }

    if (
      requestPath === '/api/auth/login' ||
      requestPath === '/api/auth/logout' ||
      requestPath === '/api/auth/session'
    ) {
      return;
    }

    if (config.mode === 'relay' && request.headers[RELAY_FORWARD_HEADER] === '1') {
      return;
    }

    const session = authService.verifyRequest(request);
    if (!session.authenticated) {
      return reply.status(401).send(unauthorizedPayload());
    }
  });

  app.register(async (realtimeApp) => {
    await realtimeApp.register(websocket as unknown as FastifyPluginCallback);

    const websocketRoute = {
      method: 'GET',
      url: '/ws',
      handler: (_request, reply) => {
        reply.status(426).send({
          code: 'bad_request',
          message: 'Upgrade to websocket is required.'
        } satisfies ApiErrorShape);
      },
      wsHandler: (socket, request) => {
        const supervisorSocket = socket as WebsocketLike;
        const session = authService.verifyRequest(request);
        if (!session.authenticated) {
          supervisorSocket.close(1008, 'Authentication is required.');
          return;
        }

        const supervisorSession = createSupervisorSocketSession({
          app,
          eventBus,
          backendPluginHost,
          send(message) {
            if (supervisorSocket.readyState === 1) {
              supervisorSocket.send(JSON.stringify(message));
            }
          },
        });

        supervisorSocket.on('message', async (rawMessage) => {
          await supervisorSession.handleMessage(rawMessage.toString());
        });

        supervisorSocket.on('close', () => {
          supervisorSession.close();
        });
      },
    } satisfies WebsocketRouteOptions;

    realtimeApp.route(websocketRoute as RouteOptions);
  });

  app.register(registerAuthRoutes);
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
    relayTunnelClient?.stop();
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
      relayTunnelClient?.start();
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

export function createRelayRequestHandler(app: FastifyInstance) {
  return async function handleRelayRequest(
    request: RelayHttpRequestPayload,
  ): Promise<RelayHttpResponsePayload> {
    const payload =
      request.body === null
        ? undefined
        : request.bodyEncoding === 'base64'
          ? Buffer.from(request.body, 'base64')
          : request.body;
    const response = await app.inject({
      method: request.method as any,
      url: request.path,
      headers: {
        ...request.headers,
        [RELAY_FORWARD_HEADER]: '1',
      },
      ...(payload !== undefined ? { payload } : {}),
    });
    const responseBody = relayResponseBody(response);

    return {
      statusCode: response.statusCode,
      headers: relayResponseHeaders(response.headers),
      body: responseBody.body,
      ...(responseBody.bodyEncoding ? { bodyEncoding: responseBody.bodyEncoding } : {}),
    };
  };
}

function relayResponseBody(response: {
  body: string;
  headers: Record<string, string | string[] | number | undefined>;
  rawPayload: Buffer;
}): { body: string; bodyEncoding?: 'base64' } {
  const contentType = responseHeader(response.headers, 'content-type');
  if (isTextRelayResponse(contentType)) {
    return { body: response.body };
  }

  return {
    body: response.rawPayload.toString('base64'),
    bodyEncoding: 'base64',
  };
}

function responseHeader(
  headers: Record<string, string | string[] | number | undefined>,
  name: string,
) {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName || value === undefined) {
      continue;
    }
    return Array.isArray(value) ? value.join(', ') : String(value);
  }
  return '';
}

function isTextRelayResponse(contentType: string) {
  const lower = contentType.toLowerCase();
  return (
    lower.startsWith('text/') ||
    lower.includes('application/json') ||
    lower.includes('+json') ||
    lower.includes('application/javascript') ||
    lower.includes('application/xml') ||
    lower.includes('+xml') ||
    lower.includes('image/svg+xml')
  );
}

export function createRelayClientConnectedHandler(eventBus: SupervisorEventBus) {
  return function handleRelayClientConnected(
    _clientId: string,
    send: (message: SupervisorSocketServerEnvelope) => void,
  ) {
    send({
      type: 'supervisor.connected',
      timestamp: new Date().toISOString(),
    });

    const unsubscribeThread = eventBus.onThreadEvent((event) => {
      send(event);
    });
    const unsubscribeShell = eventBus.onShellEvent((event) => {
      send(event);
    });

    return () => {
      unsubscribeThread();
      unsubscribeShell();
    };
  };
}

export function createSupervisorSocketSession(input: {
  app: FastifyInstance;
  eventBus: SupervisorEventBus;
  backendPluginHost: BackendPluginHost;
  send: (message: SupervisorSocketServerEnvelope) => void;
}) {
  const closeHandlers: Array<() => void> = [];
  const socketState = new Map<string, unknown>();
  const onClose = (handler: () => void) => {
    closeHandlers.push(handler);
  };

  input.send({
    type: 'supervisor.connected',
    timestamp: new Date().toISOString(),
  });

  const unsubscribeThread = input.eventBus.onThreadEvent((event) => {
    input.send(event);
  });
  const unsubscribeShell = input.eventBus.onShellEvent((event) => {
    input.send(event);
  });

  return {
    async handleMessage(rawMessage: string) {
      let parsed: SupervisorSocketClientEnvelope;
      try {
        parsed = JSON.parse(rawMessage) as SupervisorSocketClientEnvelope;
      } catch {
        return;
      }

      try {
        if (parsed.type === 'supervisor.ping') {
          input.send({
            type: 'supervisor.pong',
            timestamp: new Date().toISOString(),
            payload: {
              requestTimestamp:
                typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
            },
          });
          return;
        }

        await input.backendPluginHost.handleSocketMessage({
          app: input.app,
          send: input.send,
          onClose,
          state: socketState,
          message: parsed,
        });
      } catch {
        return;
      }
    },
    close() {
      for (const handler of closeHandlers.splice(0)) {
        handler();
      }
      unsubscribeThread();
      unsubscribeShell();
    },
  };
}

export function createRelaySocketBridge(
  app: FastifyInstance,
  eventBus: SupervisorEventBus,
  backendPluginHost: BackendPluginHost,
) {
  const sessions = new Map<string, ReturnType<typeof createSupervisorSocketSession>>();

  return {
    handleConnected(
      clientId: string,
      send: (message: SupervisorSocketServerEnvelope) => void,
    ) {
      const existing = sessions.get(clientId);
      existing?.close();
      const session = createSupervisorSocketSession({
        app,
        eventBus,
        backendPluginHost,
        send,
      });
      sessions.set(clientId, session);
      return () => {
        session.close();
        sessions.delete(clientId);
      };
    },
    async handleMessage(clientId: string, message: unknown) {
      const session = sessions.get(clientId);
      if (!session) {
        return;
      }
      await session.handleMessage(JSON.stringify(message));
    },
  };
}

export function handleRelayClientMessage(
  _clientId: string,
  message: unknown,
  send: (message: SupervisorSocketServerEnvelope) => void,
) {
  const parsed = message as Partial<SupervisorSocketClientEnvelope>;
  if (parsed.type !== 'supervisor.ping') {
    return;
  }

  send({
    type: 'supervisor.pong',
    timestamp: new Date().toISOString(),
    payload: {
      requestTimestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : null,
    },
  });
}

function relayResponseHeaders(
  headers: Record<string, string | string[] | number | undefined>,
) {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      output[name] = value.join(', ');
    } else if (value !== undefined) {
      output[name] = String(value);
    }
  }
  return output;
}

export { HttpError };
