import { afterEach, describe, expect, it, vi } from 'vitest';

import { RelayTunnelClient } from './relay-tunnel-client';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;

  readonly listeners = new Map<string, Array<(event?: any) => void>>();
  readonly sent: string[] = [];
  readyState = FakeWebSocket.OPEN;

  constructor(readonly url: URL) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event?: any) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }

  emit(type: string, event?: any) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe('RelayTunnelClient', () => {
  const originalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    FakeWebSocket.instances = [];
    globalThis.WebSocket = originalWebSocket;
  });

  it('cleans relay client sessions and reconnects after tunnel close', async () => {
    vi.useFakeTimers();
    globalThis.WebSocket = FakeWebSocket as any;
    const cleanup = vi.fn();
    const handleClientConnected = vi.fn(() => cleanup);
    const client = new RelayTunnelClient(
      {
        serverUrl: 'wss://relay.example.test',
        agentToken: 'agent-token',
      },
      vi.fn(),
      handleClientConnected,
      vi.fn(),
    );

    client.start();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(String(FakeWebSocket.instances[0]!.url)).toBe(
      'wss://relay.example.test/supervisor/tunnel?token=agent-token&deviceToken=agent-token',
    );

    FakeWebSocket.instances[0]!.emit('message', {
      data: JSON.stringify({
        type: 'relay.client.connected',
        timestamp: '2026-06-10T00:00:00.000Z',
        clientId: 'client-1',
      }),
    });
    expect(handleClientConnected).toHaveBeenCalledOnce();

    FakeWebSocket.instances[0]!.emit('close');
    expect(cleanup).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);

    client.stop();
  });

  it('does not reconnect after stop', async () => {
    vi.useFakeTimers();
    globalThis.WebSocket = FakeWebSocket as any;
    const client = new RelayTunnelClient(
      {
        serverUrl: 'wss://relay.example.test',
        agentToken: 'agent-token',
      },
      vi.fn(),
      vi.fn(() => vi.fn()),
      vi.fn(),
    );

    client.start();
    client.stop();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
