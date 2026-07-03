import { describe, expect, it, vi } from 'vitest';

import type { IOSBootstrap } from './IOSBootstrap';
import { subscribeToThreadEvents } from './IOSWebSocket';

function bootstrap(overrides: Partial<IOSBootstrap> = {}): IOSBootstrap {
  return {
    baseUrl: 'https://remote-codex.example.test',
    mode: 'server',
    authToken: 'ios-token',
    relayDeviceId: null,
    threadId: 'thread-1',
    theme: 'system',
    fixture: false,
    uiTestInitialSettings: null,
    ...overrides,
  };
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

describe('iOS WebView thread WebSocket subscription', () => {
  it('opens a thread-filtered socket and forwards only matching thread events', () => {
    FakeWebSocket.instances = [];
    const onEvent = vi.fn();
    const onOpen = vi.fn();

    const subscription = subscribeToThreadEvents(
      bootstrap(),
      'thread-1',
      {
        onEvent,
        onOpen,
      },
      (url) => new FakeWebSocket(url),
    );

    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toBe(
      'wss://remote-codex.example.test/ws?token=ios-token&threadId=thread-1',
    );

    socket.onopen?.(new Event('open'));
    expect(onOpen).toHaveBeenCalledOnce();

    socket.emitMessage(JSON.stringify({ type: 'supervisor.connected' }));
    socket.emitMessage(JSON.stringify({
      type: 'thread.output.delta',
      threadId: 'other-thread',
      payload: { delta: 'ignored' },
    }));
    socket.emitMessage(JSON.stringify({
      type: 'thread.output.delta',
      threadId: 'thread-1',
      payload: { delta: 'hello' },
    }));

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'thread.output.delta',
        threadId: 'thread-1',
      }),
    );

    subscription.close();
    expect(socket.closed).toBe(true);
  });

  it('opens relay session websocket paths when no device is selected', () => {
    FakeWebSocket.instances = [];

    const subscription = subscribeToThreadEvents(
      bootstrap({
        mode: 'relay',
        authToken: 'relay token',
        relayDeviceId: null,
      }),
      'thread-1',
      {
        onEvent: vi.fn(),
      },
      (url) => new FakeWebSocket(url),
    );

    expect(FakeWebSocket.instances[0]?.url).toBe(
      'wss://remote-codex.example.test/relay/ws?relaySession=relay%20token&threadId=thread-1',
    );

    subscription.close();
  });

  it('does not reconnect after the subscription is explicitly closed', () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];

    const subscription = subscribeToThreadEvents(
      bootstrap(),
      'thread-1',
      {
        onEvent: vi.fn(),
      },
      (url) => new FakeWebSocket(url),
    );

    const socket = FakeWebSocket.instances[0]!;
    subscription.close();
    socket.onclose?.({} as CloseEvent);

    vi.advanceTimersByTime(1500);

    expect(FakeWebSocket.instances).toHaveLength(1);
    vi.useRealTimers();
  });
});
