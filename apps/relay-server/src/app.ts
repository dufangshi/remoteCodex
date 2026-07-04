import websocket from '@fastify/websocket';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type {
  ApiErrorShape,
  RelayEffectiveAccessDto,
  RelayHealthDto,
  RelaySupervisorEnvelope,
  RelayUserDto,
  SupervisorSocketServerEnvelope,
} from '../../../packages/shared/src/index';
import type { RelayServerConfig } from './config';
import { RelayRequestBroker } from './request-broker';
import {
  DeviceConnectionStatus,
  RelayStore,
  RelayStoreError,
} from './relay-store';
import type { EffectiveRelayAccess } from './relay-store';

interface SupervisorConnection extends DeviceConnectionStatus {
  deviceId: string;
  socket: { send: (message: string) => void; readyState: number };
  requestBroker: RelayRequestBroker;
  clientSockets: Map<
    string,
    {
      socket: { send: (message: string) => void; readyState: number; close: (code?: number, reason?: string) => void };
      threadId: string | null;
      access: EffectiveRelayAccess;
    }
  >;
}

interface RelayState {
  supervisors: Map<string, SupervisorConnection>;
}

interface AuthenticatedRelayRequest extends FastifyRequest {
  relayUser: RelayUserDto;
}

const RELAY_REQUEST_TIMEOUT_MS = 30_000;
const WEBSOCKET_OPEN = 1;
const RELAY_COOKIE_NAME = 'remote_codex_relay_session';
const threadAccessSchema = z.enum(['read', 'control']);
const workspaceAccessSchema = z.enum(['none', 'read', 'write']);

const loginSchema = z.object({
  identifier: z.string().trim().min(1),
  password: z.string().min(1),
});
const registerSchema = z.object({
  email: z.string().trim().email(),
  username: z.string().trim().min(3),
  password: z.string().min(8),
  registrationPassword: z.string().optional(),
});
const createDeviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
const createShareSchema = z
  .object({
    targetIdentifier: z.string().trim().min(1).optional(),
    targetUsername: z.string().trim().min(3).optional(),
    deviceId: z.string().uuid(),
    threadId: z.string().trim().min(1),
    workspaceId: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1).max(160).nullable().optional(),
    threadAccess: threadAccessSchema.default('control'),
    workspaceAccess: workspaceAccessSchema.default('none'),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((input) => input.targetIdentifier || input.targetUsername, {
    message: 'targetIdentifier is required.',
    path: ['targetIdentifier'],
  });
const updateShareSchema = z.object({
  workspaceId: z.string().uuid().nullable().optional(),
  label: z.string().trim().min(1).max(160).nullable().optional(),
  threadAccess: threadAccessSchema.optional(),
  workspaceAccess: workspaceAccessSchema.optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});
const setEnabledSchema = z.object({
  enabled: z.boolean(),
});
const updateAccountSchema = z.object({
  username: z.string().trim().min(3).optional(),
});
const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});
const relayAccessQuerySchema = z.object({
  deviceId: z.string().uuid(),
  threadId: z.string().trim().min(1).optional(),
  workspaceId: z.string().uuid().optional(),
});

interface RelayServerBuildOptions {
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_WEBVIEW_CORS_ORIGINS = new Set([
  'null',
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
]);
const WEBVIEW_CORS_ALLOW_HEADERS = [
  'authorization',
  'content-type',
].join(', ');
const WEBVIEW_CORS_ALLOW_METHODS = [
  'GET',
  'POST',
  'PATCH',
  'PUT',
  'DELETE',
  'OPTIONS',
].join(', ');
const RELAY_REQUEST_HEADER_BLOCKLIST = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'expect',
  'forwarded',
  'host',
  'keep-alive',
  'origin',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'referer',
  'referrer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'x-client-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-port',
  'x-forwarded-proto',
  'x-forwarded-protocol',
  'x-forwarded-scheme',
  'x-real-ip',
  'x-remote-codex-relay-forwarded',
]);
const RELAY_RESPONSE_HEADER_BLOCKLIST = new Set([
  'access-control-allow-credentials',
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-allow-origin',
  'access-control-expose-headers',
  'access-control-max-age',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'keep-alive',
  'location',
  'proxy-authenticate',
  'refresh',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function buildRelayServer(
  config: RelayServerConfig,
  options: RelayServerBuildOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: false });
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body);
  });
  const store = RelayStore.fromDataDir(
    config.dataDir,
    config.sessionSecret,
    config.registrationEnabled,
  );
  if (config.registrationEnabledConfigured) {
    store.setRegistrationEnabled(config.registrationEnabled);
  }
  store.seedAdmin({
    username: config.adminUsername,
    email: config.adminEmail,
    password: config.adminPassword,
  });

  const state: RelayState = {
    supervisors: new Map(),
  };
  const allowedWebViewCorsOrigins = webViewCorsOrigins(options.env ?? process.env);

  app.addHook('onRequest', async (request, reply) => {
    if (!allowedWebViewCorsOrigins) {
      return;
    }
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !allowedWebViewCorsOrigins.has(origin)) {
      return;
    }
    applyWebViewCorsHeaders(reply, origin);
    if (request.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });

  app.get('/healthz', async () => {
    const primary = [...state.supervisors.values()][0] ?? null;
    return {
      status: 'ok',
      supervisorConnected: state.supervisors.size > 0,
      supervisorConnectedAt: primary?.connectedAt ?? null,
      lastSupervisorHeartbeatAt: primary?.lastHeartbeatAt ?? null,
      supervisorCount: state.supervisors.size,
    } satisfies RelayHealthDto;
  });

  app.get('/relay/auth/session', async (request) => {
    return store.verifySession(readRelaySessionToken(request));
  });

  app.post('/relay/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body ?? {});
    if (
      config.registrationPassword &&
      body.registrationPassword !== config.registrationPassword
    ) {
      reply.status(403).send({
        code: 'forbidden',
        message: 'Invalid registration password.',
      } satisfies ApiErrorShape);
      return;
    }
    const { registrationPassword: _registrationPassword, ...registerInput } = body;
    const result = store.register(registerInput);
    attachRelayCookie(reply, result.token);
    return result;
  });

  app.post('/relay/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body ?? {});
    const result = store.login(body);
    attachRelayCookie(reply, result.token);
    return result;
  });

  app.post('/relay/auth/logout', async (_request, reply) => {
    clearRelayCookie(reply);
    return store.emptySession();
  });

  app.patch('/relay/account', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const body = updateAccountSchema.parse(request.body ?? {});
    return store.updateAccount(user.id, {
      ...(body.username !== undefined ? { username: body.username } : {}),
    });
  });

  app.patch('/relay/account/password', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const body = updatePasswordSchema.parse(request.body ?? {});
    return store.updatePassword(user.id, body);
  });

  app.get('/relay/portal', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    return store.portalSummary(user.id, connectionStatus(state));
  });

  app.get('/relay/access', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const query = relayAccessQuerySchema.parse(request.query ?? {});
    const access = store.effectiveAccess(user.id, query.deviceId, {
      threadId: query.threadId ?? null,
      workspaceId: query.workspaceId ?? null,
    });
    if (!access) {
      reply.status(403).send({
        code: 'forbidden',
        message: 'Device access is not allowed.',
      } satisfies ApiErrorShape);
      return;
    }
    return relayAccessDto(access);
  });

  app.post('/relay/devices', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const body = createDeviceSchema.parse(request.body ?? {});
    return store.createDevice(user.id, body);
  });

  app.delete('/relay/devices/:deviceId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);
    store.deleteDevice(user.id, deviceId);
    return { id: deviceId };
  });

  app.post('/relay/shares', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const body = createShareSchema.parse(request.body ?? {});
    return store.createShare(user.id, {
      targetIdentifier: body.targetIdentifier ?? body.targetUsername!,
      deviceId: body.deviceId,
      threadId: body.threadId,
      workspaceId: body.workspaceId ?? null,
      label: body.label ?? null,
      threadAccess: body.threadAccess,
      workspaceAccess: body.workspaceAccess,
      expiresAt: body.expiresAt ?? null,
    });
  });

  app.patch('/relay/shares/:shareId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { shareId } = z.object({ shareId: z.string().uuid() }).parse(request.params);
    const body = updateShareSchema.parse(request.body ?? {});
    return store.updateShare(user.id, shareId, body);
  });

  app.delete('/relay/shares/:shareId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { shareId } = z.object({ shareId: z.string().uuid() }).parse(request.params);
    return store.revokeShare(user.id, shareId);
  });

  app.get('/relay/admin', async (request, reply) => {
    const user = requireRelayUser(request, reply, store, { admin: true });
    if (!user) {
      return;
    }
    return store.adminSummary(connectionStatus(state));
  });

  app.patch('/relay/admin/settings/registration', async (request, reply) => {
    const user = requireRelayUser(request, reply, store, { admin: true });
    if (!user) {
      return;
    }
    const body = setEnabledSchema.parse(request.body ?? {});
    return { registrationEnabled: store.setRegistrationEnabled(body.enabled) };
  });

  app.patch('/relay/admin/users/:userId', async (request, reply) => {
    const user = requireRelayUser(request, reply, store, { admin: true });
    if (!user) {
      return;
    }
    const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = setEnabledSchema.parse(request.body ?? {});
    return store.setUserEnabled(userId, body.enabled);
  });

  app.all('/relay/devices/:deviceId/api/*', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);
    const targetPath = request.url.replace(/^\/relay\/devices\/[^/]+/, '') || '/';
    await forwardRelayHttp({
      request,
      reply,
      state,
      store,
      user,
      deviceId,
      targetPath,
    });
  });

  app.get('/relay/devices/:deviceId/healthz', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);
    await forwardRelayHttp({
      request,
      reply,
      state,
      store,
      user,
      deviceId,
      targetPath: '/healthz',
    });
  });

  app.all('/relay/api/*', async (request, reply) => {
    const user = requireRelayUser(request, reply, store);
    if (!user) {
      return;
    }
    const deviceId = firstAccessibleConnectedDevice(state, store, user.id);
    if (!deviceId) {
      reply.status(503).send({
        code: 'service_unavailable',
        message: 'No accessible supervisor is connected to this relay.',
      } satisfies ApiErrorShape);
      return;
    }
    const targetPath = request.url.slice('/relay'.length) || '/';
    await forwardRelayHttp({
      request,
      reply,
      state,
      store,
      user,
      deviceId,
      targetPath,
    });
  });

  app.register(async (realtimeApp) => {
    await realtimeApp.register(websocket);

    realtimeApp.route({
      method: 'GET',
      url: '/supervisor/tunnel',
      handler: (_request, reply) => {
        reply.status(426).send({
          code: 'bad_request',
          message: 'Upgrade to websocket is required.',
        } satisfies ApiErrorShape);
      },
      wsHandler: (socket, request) => {
        const legacyToken = bearerToken(request.headers.authorization) ?? queryToken(request.query);
        const deviceToken = queryToken(request.query, 'deviceToken') ?? legacyToken;
        const device = store.verifyDeviceToken(deviceToken);
        const deviceId =
          device?.id ??
          (config.supervisorToken && legacyToken === config.supervisorToken
            ? 'legacy-default'
            : null);
        if (!deviceId) {
          socket.close(1008, 'Supervisor relay token is invalid.');
          return;
        }

        const connectedAt = new Date().toISOString();
        const existing = state.supervisors.get(deviceId);
        existing?.socket.send(JSON.stringify({
          type: 'relay.connected',
          timestamp: connectedAt,
          deviceId,
        } satisfies RelaySupervisorEnvelope));
        existing?.clientSockets.forEach((clientConnection) => clientConnection.socket.close());

        const connection: SupervisorConnection = {
          deviceId,
          socket,
          requestBroker: new RelayRequestBroker(RELAY_REQUEST_TIMEOUT_MS),
          clientSockets: new Map(),
          connected: true,
          connectedAt,
          lastHeartbeatAt: connectedAt,
        };
        state.supervisors.set(deviceId, connection);

        socket.send(
          JSON.stringify({
            type: 'relay.connected',
            timestamp: connectedAt,
            deviceId,
          } satisfies RelaySupervisorEnvelope),
        );

        socket.on('message', (rawMessage: Buffer) => {
          let parsed: RelaySupervisorEnvelope;
          try {
            parsed = JSON.parse(rawMessage.toString()) as RelaySupervisorEnvelope;
          } catch {
            return;
          }

          if (parsed.type === 'relay.heartbeat') {
            connection.lastHeartbeatAt = parsed.timestamp;
            return;
          }

          if (parsed.type === 'relay.server.message') {
            const clientConnection = connection.clientSockets.get(parsed.clientId);
            if (
              clientConnection &&
              clientConnection.socket.readyState === WEBSOCKET_OPEN &&
              shouldForwardSocketEvent(parsed.payload, clientConnection.threadId)
            ) {
              clientConnection.socket.send(JSON.stringify(parsed.payload));
            }
            return;
          }

          connection.requestBroker.accept(parsed);
        });

        socket.on('close', () => {
          if (state.supervisors.get(deviceId)?.socket === socket) {
            state.supervisors.delete(deviceId);
          }
          connection.requestBroker.rejectAll(new Error('Supervisor tunnel closed.'));
          for (const [clientId, clientConnection] of connection.clientSockets) {
            connection.clientSockets.delete(clientId);
            clientConnection.socket.close();
          }
        });
      },
    });

    realtimeApp.route({
      method: 'GET',
      url: '/relay/devices/:deviceId/ws',
      handler: (_request, reply) => {
        reply.status(426).send({
          code: 'bad_request',
          message: 'Upgrade to websocket is required.',
        } satisfies ApiErrorShape);
      },
      wsHandler: (socket, request) => {
        const session = store.verifySession(readRelaySessionToken(request));
        const deviceId = pathParam(request.params, 'deviceId');
        const threadId = queryString(request.query, 'threadId');
        if (!session.authenticated || !session.user || !deviceId) {
          socket.close(1008, 'Relay login is required.');
          return;
        }
        const access = store.effectiveAccess(session.user.id, deviceId, { threadId });
        if (!access) {
          socket.close(1008, 'Device access is not allowed.');
          return;
        }

        const supervisor = state.supervisors.get(deviceId);
        if (!supervisor || supervisor.socket.readyState !== WEBSOCKET_OPEN) {
          socket.close(1013, 'No supervisor is connected for this device.');
          return;
        }

        if (access.kind === 'shared') {
          store.recordShareAccess(access.share, session.user);
        }
        connectRelayWebsocket(supervisor, socket, threadId, access);
      },
    });

    realtimeApp.route({
      method: 'GET',
      url: '/relay/ws',
      handler: (_request, reply) => {
        reply.status(426).send({
          code: 'bad_request',
          message: 'Upgrade to websocket is required.',
        } satisfies ApiErrorShape);
      },
      wsHandler: (socket, request) => {
        const session = store.verifySession(readRelaySessionToken(request));
        if (!session.authenticated || !session.user) {
          socket.close(1008, 'Relay login is required.');
          return;
        }
        const threadId = queryString(request.query, 'threadId');
        const deviceId = firstAccessibleConnectedDevice(state, store, session.user.id, threadId);
        const supervisor = deviceId ? state.supervisors.get(deviceId) : null;
        const access = deviceId ? store.effectiveAccess(session.user.id, deviceId, { threadId }) : null;
        if (!deviceId || !supervisor || supervisor.socket.readyState !== WEBSOCKET_OPEN) {
          socket.close(1013, 'No accessible supervisor is connected to this relay.');
          return;
        }
        if (!access) {
          socket.close(1008, 'Device access is not allowed.');
          return;
        }
        if (access.kind === 'shared') {
          store.recordShareAccess(access.share, session.user);
        }
        connectRelayWebsocket(supervisor, socket, threadId, access);
      },
    });
  });

  if (config.webDistDir) {
    registerRelayWebApp(app, config.webDistDir);
  }

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof RelayStoreError) {
      reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
      } satisfies ApiErrorShape);
      return;
    }
    if (error instanceof z.ZodError) {
      reply.status(400).send({
        code: 'bad_request',
        message: 'The request payload is invalid.',
        details: {
          issues: error.issues,
        },
      } satisfies ApiErrorShape);
      return;
    }
    reply.status(500).send({
      code: 'internal_error',
      message: 'An unexpected relay server error occurred.',
    } satisfies ApiErrorShape);
  });

  return app;
}

function webViewCorsOrigins(env: NodeJS.ProcessEnv) {
  if (env.REMOTE_CODEX_ENABLE_WEBVIEW_CORS !== 'true') {
    return null;
  }
  const configured = env.REMOTE_CODEX_WEBVIEW_CORS_ORIGINS
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return new Set(configured?.length ? configured : DEFAULT_WEBVIEW_CORS_ORIGINS);
}

function applyWebViewCorsHeaders(reply: FastifyReply, origin: string) {
  reply.header('access-control-allow-origin', origin);
  reply.header('access-control-allow-methods', WEBVIEW_CORS_ALLOW_METHODS);
  reply.header('access-control-allow-headers', WEBVIEW_CORS_ALLOW_HEADERS);
  reply.header('access-control-max-age', '600');
  reply.header('vary', 'Origin');
}

async function forwardRelayHttp(input: {
  request: FastifyRequest;
  reply: FastifyReply;
  state: RelayState;
  store: RelayStore;
  user: RelayUserDto;
  deviceId: string;
  targetPath: string;
}) {
  const threadId = threadIdFromPath(input.targetPath);
  const workspaceId = workspaceIdFromPath(input.targetPath);
  const access = input.store.effectiveAccess(input.user.id, input.deviceId, {
    threadId,
    workspaceId,
  });
  if (!access) {
    input.reply.status(403).send({
      code: 'forbidden',
      message: 'Device access is not allowed.',
    } satisfies ApiErrorShape);
    return;
  }

  if (!isAllowedRelayTarget(input.targetPath)) {
    input.reply.status(403).send({
      code: 'forbidden',
      message: 'This relay path is not allowed.',
    } satisfies ApiErrorShape);
    return;
  }

  if (!isAllowedForRelayAccess(access, input.request.method, input.targetPath)) {
    input.reply.status(403).send({
      code: 'forbidden',
      message: 'This shared session does not allow that operation.',
    } satisfies ApiErrorShape);
    return;
  }

  if (access.kind === 'shared') {
    input.store.recordShareAccess(access.share, input.user);
  }

  const supervisor = input.state.supervisors.get(input.deviceId);
  if (!supervisor || supervisor.socket.readyState !== WEBSOCKET_OPEN) {
    input.reply.status(503).send({
      code: 'service_unavailable',
      message: 'No supervisor is connected for this device.',
    } satisfies ApiErrorShape);
    return;
  }

  try {
    const requestId = randomUUID();
    const requestBody = relayRequestBody(input.request.body);
    const response = await supervisor.requestBroker.forward(supervisor.socket, {
      type: 'relay.request',
      timestamp: new Date().toISOString(),
      requestId,
      deviceId: input.deviceId,
      payload: {
        method: input.request.method,
        path: input.targetPath,
        headers: relayRequestHeaders(input.request.headers),
        body: requestBody.body,
        ...(requestBody.bodyEncoding ? { bodyEncoding: requestBody.bodyEncoding } : {}),
      },
    });

    for (const [name, value] of Object.entries(response.headers)) {
      if (canForwardResponseHeader(name)) {
        input.reply.header(name, value);
      }
    }
    input.reply.status(response.statusCode).send(relayResponseBody(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Relay request failed.';
    input.reply.status(message.includes('timed out') ? 504 : 503).send({
      code: 'service_unavailable',
      message,
    } satisfies ApiErrorShape);
  }
}

function relayResponseBody(response: { body: string; bodyEncoding?: 'utf8' | 'base64' }) {
  if (response.bodyEncoding === 'base64') {
    return Buffer.from(response.body, 'base64');
  }
  return response.body;
}

function connectRelayWebsocket(
  supervisor: SupervisorConnection,
  socket: {
    send: (message: string) => void;
    readyState: number;
    close: (code?: number, reason?: string) => void;
    on: any;
  },
  threadId: string | null,
  access: EffectiveRelayAccess,
) {
  const clientId = randomUUID();
  supervisor.clientSockets.set(clientId, { socket, threadId, access });
  sendToSupervisor(supervisor, {
    type: 'relay.client.connected',
    timestamp: new Date().toISOString(),
    clientId,
  });

  socket.on('message', (rawMessage: Buffer) => {
    let payload: unknown;
    try {
      payload = JSON.parse(rawMessage.toString());
    } catch {
      return;
    }

    if (access.kind === 'shared' && access.threadAccess !== 'control') {
      socket.close(1008, 'Shared read-only session cannot control supervisor.');
      return;
    }

    sendToSupervisor(supervisor, {
      type: 'relay.client.message',
      timestamp: new Date().toISOString(),
      clientId,
      payload: payload as any,
    });
  });

  socket.on('close', () => {
    supervisor.clientSockets.delete(clientId);
    sendToSupervisor(supervisor, {
      type: 'relay.client.disconnected',
      timestamp: new Date().toISOString(),
      clientId,
    });
  });
}

function sendToSupervisor(supervisor: SupervisorConnection, message: RelaySupervisorEnvelope) {
  if (supervisor.socket.readyState === WEBSOCKET_OPEN) {
    supervisor.socket.send(JSON.stringify(message));
  }
}

function registerRelayWebApp(app: FastifyInstance, distDirInput: string) {
  const distDir = path.resolve(distDirInput);
  const indexFile = path.join(distDir, 'index.html');
  const mimeTypes = new Map([
    ['.css', 'text/css; charset=utf-8'],
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.webp', 'image/webp'],
    ['.woff', 'font/woff'],
    ['.woff2', 'font/woff2'],
  ]);

  app.get('/*', async (request, reply) => {
    if (!fs.existsSync(indexFile)) {
      reply.status(503).type('text/plain; charset=utf-8').send('Relay web frontend is not built.');
      return;
    }
    const pathname = new URL(request.url, 'http://relay.local').pathname;
    if (
      pathname.startsWith('/relay/') ||
      pathname === '/healthz' ||
      pathname === '/supervisor/tunnel'
    ) {
      reply.status(404).send({
        code: 'not_found',
        message: 'The requested relay endpoint was not found.',
      } satisfies ApiErrorShape);
      return;
    }
    const assetPath = await resolveAssetPath(distDir, indexFile, pathname);
    if (!assetPath) {
      reply.status(404).type('text/plain; charset=utf-8').send('Not Found');
      return;
    }
    if (assetPath === indexFile) {
      const html = await fsp.readFile(indexFile, 'utf8');
      const payload = injectRelayBootstrap(html);
      reply
        .header('cache-control', 'no-cache')
        .header('content-length', Buffer.byteLength(payload))
        .type('text/html; charset=utf-8');
      return reply.send(payload);
    }
    const stat = await fsp.stat(assetPath);
    reply
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('content-length', stat.size)
      .type(mimeTypes.get(path.extname(assetPath).toLowerCase()) ?? 'application/octet-stream');
    return reply.send(fs.createReadStream(assetPath));
  });
}

function injectRelayBootstrap(html: string) {
  const script = `<script>window.__REMOTE_CODEX_BOOTSTRAP__=${JSON.stringify({
    mode: 'relay',
    relayApiBase: '/relay',
  })};</script>`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `${script}</head>`);
  }
  return `${script}${html}`;
}

async function resolveAssetPath(distDir: string, indexFile: string, pathname: string) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const candidate = path.resolve(distDir, relativePath);
  if (candidate !== distDir && !candidate.startsWith(`${distDir}${path.sep}`)) {
    return null;
  }
  const stat = await safeStat(candidate);
  if (stat?.isFile()) {
    return candidate;
  }
  if (path.posix.extname(decodedPath)) {
    return null;
  }
  return indexFile;
}

function requireRelayUser(
  request: FastifyRequest,
  reply: FastifyReply,
  store: RelayStore,
  options: { admin?: boolean } = {},
) {
  const session = store.verifySession(readRelaySessionToken(request));
  if (!session.authenticated || !session.user) {
    reply.status(401).send({
      code: 'unauthorized',
      message: 'Relay login is required.',
    } satisfies ApiErrorShape);
    return null;
  }
  if (options.admin && session.user.role !== 'admin') {
    reply.status(403).send({
      code: 'forbidden',
      message: 'Admin access is required.',
    } satisfies ApiErrorShape);
    return null;
  }
  (request as AuthenticatedRelayRequest).relayUser = session.user;
  return session.user;
}

function readRelaySessionToken(request: FastifyRequest) {
  return (
    bearerToken(request.headers.authorization) ??
    queryToken(request.query, 'relaySession') ??
    queryToken(request.query, 'token') ??
    readCookie(request.headers.cookie, RELAY_COOKIE_NAME)
  );
}

function attachRelayCookie(reply: FastifyReply, token: string) {
  reply.header(
    'set-cookie',
    `${RELAY_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 14}`,
  );
}

function clearRelayCookie(reply: FastifyReply) {
  reply.header(
    'set-cookie',
    `${RELAY_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

function connectionStatus(state: RelayState) {
  const statuses = new Map<string, DeviceConnectionStatus>();
  for (const [deviceId, supervisor] of state.supervisors) {
    statuses.set(deviceId, {
      connected: true,
      connectedAt: supervisor.connectedAt,
      lastHeartbeatAt: supervisor.lastHeartbeatAt,
    });
  }
  return statuses;
}

function relayAccessDto(access: EffectiveRelayAccess): RelayEffectiveAccessDto {
  return {
    kind: access.kind,
    shareId: access.share?.id ?? null,
    threadAccess: access.threadAccess,
    workspaceAccess: access.workspaceAccess,
    workspaceId: access.workspaceId,
  };
}

function firstAccessibleConnectedDevice(
  state: RelayState,
  store: RelayStore,
  userId: string,
  threadId?: string | null,
) {
  for (const deviceId of state.supervisors.keys()) {
    if (store.canAccessDevice(userId, deviceId, threadId)) {
      return deviceId;
    }
  }
  return null;
}

function isAllowedRelayTarget(pathValue: string) {
  const pathname = new URL(pathValue, 'http://relay.local').pathname;
  return pathname === '/healthz' || pathname.startsWith('/api/');
}

function threadIdFromPath(pathValue: string) {
  const pathname = new URL(pathValue, 'http://relay.local').pathname;
  const match = /^\/api\/threads\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

function workspaceIdFromPath(pathValue: string) {
  const pathname = new URL(pathValue, 'http://relay.local').pathname;
  const match = /^\/api\/workspaces\/([^/?#]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]!) : null;
}

function isAllowedForRelayAccess(
  access: EffectiveRelayAccess,
  method: string,
  pathValue: string,
) {
  if (access.kind === 'owner') {
    return true;
  }

  const pathname = new URL(pathValue, 'http://relay.local').pathname;
  const methodName = method.toUpperCase();
  const threadId = threadIdFromPath(pathValue);
  if (threadId) {
    return isAllowedSharedThreadPath(access, methodName, pathname, threadId);
  }

  const workspaceId = workspaceIdFromPath(pathValue);
  if (workspaceId) {
    return isAllowedSharedWorkspacePath(access, methodName, pathname, workspaceId);
  }
  return false;
}

function isAllowedSharedThreadPath(
  access: EffectiveRelayAccess,
  methodName: string,
  pathname: string,
  threadId: string,
) {
  if (access.kind !== 'shared' || access.share.threadId !== threadId) {
    return false;
  }
  const escapedThreadId = escapeRegExp(encodeURIComponent(threadId));
  const readPatterns = [
    new RegExp(`^/api/threads/${escapedThreadId}$`),
    new RegExp(`^/api/threads/${escapedThreadId}/items/[^/]+/detail$`),
    new RegExp(`^/api/threads/${escapedThreadId}/export-turns$`),
    new RegExp(`^/api/threads/${escapedThreadId}/exports/pdf$`),
    new RegExp(`^/api/threads/${escapedThreadId}/assets/image$`),
    new RegExp(`^/api/threads/${escapedThreadId}/goal$`),
    new RegExp(`^/api/threads/${escapedThreadId}/skills$`),
    new RegExp(`^/api/threads/${escapedThreadId}/mcp-servers$`),
    new RegExp(`^/api/threads/${escapedThreadId}/hooks$`),
  ];
  if (methodName === 'GET' && readPatterns.some((pattern) => pattern.test(pathname))) {
    return true;
  }
  if (access.threadAccess !== 'control') {
    return false;
  }
  const controlPatterns = [
    new RegExp(`^/api/threads/${escapedThreadId}/goal$`),
    new RegExp(`^/api/threads/${escapedThreadId}/resume$`),
    new RegExp(`^/api/threads/${escapedThreadId}/prompt$`),
    new RegExp(`^/api/threads/${escapedThreadId}/interrupt$`),
    new RegExp(`^/api/threads/${escapedThreadId}/requests/[^/]+/respond$`),
  ];
  if (methodName === 'PATCH') {
    return new RegExp(`^/api/threads/${escapedThreadId}/goal$`).test(pathname);
  }
  if (methodName === 'POST') {
    return controlPatterns.some((pattern) => pattern.test(pathname));
  }
  return false;
}

function isAllowedSharedWorkspacePath(
  access: EffectiveRelayAccess,
  methodName: string,
  pathname: string,
  workspaceId: string,
) {
  if (
    access.kind !== 'shared' ||
    access.workspaceAccess === 'none' ||
    access.workspaceId !== workspaceId
  ) {
    return false;
  }
  const escapedWorkspaceId = escapeRegExp(encodeURIComponent(workspaceId));
  const readPatterns = [
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/tree$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/preview$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/raw$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/download$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/artifacts$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/artifacts/[^/]+$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/artifacts/[^/]+/download$`),
  ];
  if (methodName === 'GET' && readPatterns.some((pattern) => pattern.test(pathname))) {
    return true;
  }
  if (access.workspaceAccess !== 'write') {
    return false;
  }
  const writePatterns = [
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/upload$`),
    new RegExp(`^/api/workspaces/${escapedWorkspaceId}/files/move$`),
  ];
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(methodName) &&
    writePatterns.some((pattern) => pattern.test(pathname));
}

function shouldForwardSocketEvent(
  event: SupervisorSocketServerEnvelope,
  threadId: string | null,
) {
  if (!threadId) {
    return true;
  }
  if (event.type === 'supervisor.connected' || event.type === 'supervisor.pong') {
    return true;
  }
  return 'threadId' in event && event.threadId === threadId;
}

export function relayRequestBody(body: unknown): {
  body: string | null;
  bodyEncoding?: 'base64';
} {
  if (body === undefined || body === null) {
    return { body: null };
  }

  if (typeof body === 'string') {
    return { body };
  }

  if (Buffer.isBuffer(body)) {
    return {
      body: body.toString('base64'),
      bodyEncoding: 'base64',
    };
  }

  return { body: JSON.stringify(body) };
}

export function relayRequestHeaders(headers: Record<string, string | string[] | undefined>) {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (RELAY_REQUEST_HEADER_BLOCKLIST.has(lower) || lower.startsWith('x-forwarded-')) {
      continue;
    }
    if (Array.isArray(value)) {
      output[name] = value.join(', ');
    } else if (value !== undefined) {
      output[name] = value;
    }
  }
  return output;
}

function canForwardResponseHeader(name: string) {
  const lower = name.toLowerCase();
  return !RELAY_RESPONSE_HEADER_BLOCKLIST.has(lower);
}

function bearerToken(value: string | undefined) {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
  return match?.[1]?.trim() ?? null;
}

function queryToken(query: unknown, name = 'token') {
  if (!query || typeof query !== 'object' || !(name in query)) {
    return null;
  }

  const token = (query as Record<string, unknown>)[name];
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}

function readCookie(cookie: string | undefined, name: string) {
  if (!cookie) {
    return null;
  }
  for (const entry of cookie.split(';')) {
    const [entryName, ...valueParts] = entry.trim().split('=');
    if (entryName === name) {
      return decodeURIComponent(valueParts.join('='));
    }
  }
  return null;
}

function pathParam(params: unknown, name: string) {
  if (!params || typeof params !== 'object' || !(name in params)) {
    return null;
  }
  const value = (params as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

function queryString(query: unknown, name: string) {
  if (!query || typeof query !== 'object' || !(name in query)) {
    return null;
  }
  const value = (query as Record<string, unknown>)[name];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function safeStat(filePath: string) {
  try {
    return await fsp.stat(filePath);
  } catch {
    return null;
  }
}
