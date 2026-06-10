import websocket from '@fastify/websocket';
import Fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

import type {
  ApiErrorShape,
  RelayHealthDto,
  RelaySupervisorEnvelope,
} from '../../../packages/shared/src/index';
import type { RelayServerConfig } from './config';
import { RelayRequestBroker } from './request-broker';

interface RelayState {
  supervisorSocket: { send: (message: string) => void; readyState: number } | null;
  clientSockets: Map<
    string,
    { send: (message: string) => void; readyState: number; close: () => void }
  >;
  supervisorConnected: boolean;
  supervisorConnectedAt: string | null;
  lastSupervisorHeartbeatAt: string | null;
}

const RELAY_REQUEST_TIMEOUT_MS = 30_000;
const WEBSOCKET_OPEN = 1;

export function buildRelayServer(config: RelayServerConfig): FastifyInstance {
  const app = Fastify({ logger: false });
  const requestBroker = new RelayRequestBroker(RELAY_REQUEST_TIMEOUT_MS);
  const state: RelayState = {
    supervisorSocket: null,
    clientSockets: new Map(),
    supervisorConnected: false,
    supervisorConnectedAt: null,
    lastSupervisorHeartbeatAt: null,
  };

  app.get('/healthz', async () => {
    return {
      status: 'ok',
      supervisorConnected: state.supervisorConnected,
      supervisorConnectedAt: state.supervisorConnectedAt,
      lastSupervisorHeartbeatAt: state.lastSupervisorHeartbeatAt,
    } satisfies RelayHealthDto;
  });

  app.all('/relay/*', async (request, reply) => {
    if (new URL(request.url, 'http://relay.local').pathname === '/relay/ws') {
      reply.status(426).send({
        code: 'bad_request',
        message: 'Upgrade to websocket is required.',
      } satisfies ApiErrorShape);
      return;
    }

    const clientToken = bearerToken(request.headers.authorization) ?? queryToken(request.query);
    if (config.clientToken && clientToken !== config.clientToken) {
      reply.status(401).send({
        code: 'unauthorized',
        message: 'Relay client authentication is required.',
      } satisfies ApiErrorShape);
      return;
    }

    if (!state.supervisorSocket || state.supervisorSocket.readyState !== WEBSOCKET_OPEN) {
      reply.status(503).send({
        code: 'service_unavailable',
        message: 'No supervisor is connected to this relay.',
      } satisfies ApiErrorShape);
      return;
    }

    const targetPath = request.url.slice('/relay'.length) || '/';
    if (!isAllowedRelayTarget(targetPath)) {
      reply.status(403).send({
        code: 'forbidden',
        message: 'This relay path is not allowed.',
      } satisfies ApiErrorShape);
      return;
    }

    let response;
    try {
      const requestId = randomUUID();
      response = await requestBroker.forward(
        state.supervisorSocket,
        {
          type: 'relay.request',
          timestamp: new Date().toISOString(),
          requestId,
          payload: {
            method: request.method,
            path: targetPath,
            headers: relayRequestHeaders(request.headers),
            body: relayRequestBody(request.body),
          },
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Relay request failed.';
      reply.status(message.includes('timed out') ? 504 : 503).send({
        code: 'service_unavailable',
        message,
      } satisfies ApiErrorShape);
      return;
    }

    for (const [name, value] of Object.entries(response.headers)) {
      if (canForwardResponseHeader(name)) {
        reply.header(name, value);
      }
    }
    reply.status(response.statusCode).send(response.body);
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
        const token = bearerToken(request.headers.authorization) ?? queryToken(request.query);
        if (token !== config.supervisorToken) {
          socket.close(1008, 'Supervisor relay token is invalid.');
          return;
        }

        state.supervisorConnected = true;
        state.supervisorConnectedAt = new Date().toISOString();
        state.lastSupervisorHeartbeatAt = state.supervisorConnectedAt;
        state.supervisorSocket = socket;

        socket.send(
          JSON.stringify({
            type: 'relay.connected',
            timestamp: new Date().toISOString(),
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
            state.lastSupervisorHeartbeatAt = parsed.timestamp;
            return;
          }

          if (parsed.type === 'relay.server.message') {
            const clientSocket = state.clientSockets.get(parsed.clientId);
            if (clientSocket?.readyState === WEBSOCKET_OPEN) {
              clientSocket.send(JSON.stringify(parsed.payload));
            }
            return;
          }

          requestBroker.accept(parsed);
        });

        socket.on('close', () => {
          if (state.supervisorSocket === socket) {
            state.supervisorSocket = null;
          }
          state.supervisorConnected = false;
          requestBroker.rejectAll(new Error('Supervisor tunnel closed.'));
          for (const [clientId, clientSocket] of state.clientSockets) {
            state.clientSockets.delete(clientId);
            clientSocket.close();
          }
        });
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
        const clientToken = bearerToken(request.headers.authorization) ?? queryToken(request.query);
        if (config.clientToken && clientToken !== config.clientToken) {
          socket.close(1008, 'Relay client authentication is required.');
          return;
        }

        if (!state.supervisorSocket || state.supervisorSocket.readyState !== WEBSOCKET_OPEN) {
          socket.close(1013, 'No supervisor is connected to this relay.');
          return;
        }

        const clientId = randomUUID();
        state.clientSockets.set(clientId, socket);
        sendToSupervisor(state, {
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

          sendToSupervisor(state, {
            type: 'relay.client.message',
            timestamp: new Date().toISOString(),
            clientId,
            payload: payload as any,
          });
        });

        socket.on('close', () => {
          state.clientSockets.delete(clientId);
          sendToSupervisor(state, {
            type: 'relay.client.disconnected',
            timestamp: new Date().toISOString(),
            clientId,
          });
        });
      },
    });
  });

  return app;
}

function sendToSupervisor(state: RelayState, message: RelaySupervisorEnvelope) {
  if (state.supervisorSocket?.readyState === WEBSOCKET_OPEN) {
    state.supervisorSocket.send(JSON.stringify(message));
  }
}

function isAllowedRelayTarget(path: string) {
  const pathname = new URL(path, 'http://relay.local').pathname;
  return pathname === '/healthz' || pathname.startsWith('/api/');
}

function relayRequestBody(body: unknown) {
  if (body === undefined || body === null) {
    return null;
  }

  if (typeof body === 'string') {
    return body;
  }

  if (Buffer.isBuffer(body)) {
    return body.toString('utf8');
  }

  return JSON.stringify(body);
}

function relayRequestHeaders(headers: Record<string, string | string[] | undefined>) {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'authorization') {
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
  return lower !== 'content-length' && lower !== 'transfer-encoding';
}

function bearerToken(value: string | undefined) {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? '');
  return match?.[1]?.trim() ?? null;
}

function queryToken(query: unknown) {
  if (!query || typeof query !== 'object' || !('token' in query)) {
    return null;
  }

  const token = query.token;
  return typeof token === 'string' && token.trim() ? token.trim() : null;
}
