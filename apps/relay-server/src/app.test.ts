import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRelayServer } from './app';
import { RelayRequestBroker } from './request-broker';

describe('relay server', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports health before a supervisor tunnel is connected', async () => {
    const app = buildRelayServer({
      host: '127.0.0.1',
      port: 0,
      supervisorToken: 'supervisor-token',
      clientToken: null,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      supervisorConnected: false,
      supervisorConnectedAt: null,
      lastSupervisorHeartbeatAt: null,
    });

    await app.close();
  });

  it('rejects non-websocket tunnel requests', async () => {
    const app = buildRelayServer({
      host: '127.0.0.1',
      port: 0,
      supervisorToken: 'supervisor-token',
      clientToken: null,
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/supervisor/tunnel',
    });

    expect(response.statusCode).toBe(426);
    expect(response.json()).toEqual({
      code: 'bad_request',
      message: 'Upgrade to websocket is required.',
    });

    await app.close();
  });

  it('requires client auth for relayed HTTP requests when configured', async () => {
    const app = buildRelayServer({
      host: '127.0.0.1',
      port: 0,
      supervisorToken: 'supervisor-token',
      clientToken: 'client-token',
    });
    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/relay/api/version',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'unauthorized',
      message: 'Relay client authentication is required.',
    });

    await app.close();
  });

  it('matches relayed HTTP responses to pending tunnel requests', async () => {
    const broker = new RelayRequestBroker(1000);
    const sent: string[] = [];
    const responsePromise = broker.forward(
      {
        send: (message) => {
          sent.push(message);
        },
      },
      {
        type: 'relay.request',
        timestamp: '2026-06-10T00:00:00.000Z',
        requestId: 'request-1',
        payload: {
          method: 'GET',
          path: '/api/version',
          headers: {},
          body: null,
        },
      },
    );

    expect(JSON.parse(sent[0]!)).toMatchObject({
      type: 'relay.request',
      requestId: 'request-1',
      payload: {
        path: '/api/version',
      },
    });

    expect(
      broker.accept({
        type: 'relay.response',
        timestamp: '2026-06-10T00:00:01.000Z',
        requestId: 'request-1',
        payload: {
          statusCode: 200,
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ version: 'from-home' }),
        },
      }),
    ).toBe(true);

    await expect(responsePromise).resolves.toEqual({
      statusCode: 200,
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ version: 'from-home' }),
    });
  });

  it('rejects pending relay requests when the supervisor does not answer', async () => {
    vi.useFakeTimers();
    const broker = new RelayRequestBroker(30_000);
    const supervisorSocket = {
      sent: [] as string[],
      send(message: string) {
        this.sent.push(message);
      },
    };
    const responsePromise = broker.forward(supervisorSocket, {
      type: 'relay.request',
      timestamp: '2026-06-10T00:00:00.000Z',
      requestId: 'request-1',
      payload: {
        method: 'GET',
        path: '/api/version',
        headers: {},
        body: null,
      },
    });

    expect(JSON.parse(supervisorSocket.sent[0]!)).toMatchObject({
      type: 'relay.request',
      payload: {
        path: '/api/version',
      },
    });
    const rejectionExpectation = expect(responsePromise).rejects.toThrow(
      'Supervisor relay request timed out.',
    );
    await vi.advanceTimersByTimeAsync(30_000);
    await rejectionExpectation;
  });
});
