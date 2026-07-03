import type { AndroidThreadBootstrap } from './AndroidBootstrap';
import { supervisorWebSocketUrl } from './AndroidConnection';

export interface AndroidThreadEventEnvelope {
  type: string;
  threadId?: string | null;
  timestamp?: string | null;
  payload?: unknown;
}

export interface AndroidThreadEventSubscription {
  close(): void;
}

interface AndroidThreadEventHandlers {
  onEvent(event: AndroidThreadEventEnvelope): void;
  onOpen?(): void;
  onClose?(): void;
  onError?(message: string): void;
}

const RECONNECT_DELAY_MS = 1000;
const PING_INTERVAL_MS = 25_000;

export function subscribeToThreadEvents(
  bootstrap: AndroidThreadBootstrap,
  threadId: string,
  handlers: AndroidThreadEventHandlers,
): AndroidThreadEventSubscription {
  let socket: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | null = null;
  let pingTimer: number | null = null;

  const clearTimers = () => {
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (pingTimer !== null) {
      window.clearInterval(pingTimer);
      pingTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  const connect = () => {
    const nextSocket = new WebSocket(
      supervisorWebSocketUrl(bootstrap, { threadId }),
    );
    socket = nextSocket;
    nextSocket.onopen = () => {
      handlers.onOpen?.();
      pingTimer = window.setInterval(() => {
        try {
          nextSocket.send(
            JSON.stringify({
              type: 'supervisor.ping',
              timestamp: new Date().toISOString(),
            }),
          );
        } catch {
          // The close handler will reconnect if the socket is no longer usable.
        }
      }, PING_INTERVAL_MS);
    };
    nextSocket.onmessage = (event) => {
      const envelope = parseThreadEvent(event.data);
      if (!envelope || envelope.threadId !== threadId) {
        return;
      }
      handlers.onEvent(envelope);
    };
    nextSocket.onerror = () => {
      handlers.onError?.('Android WebView thread WebSocket failed.');
    };
    nextSocket.onclose = () => {
      if (pingTimer !== null) {
        window.clearInterval(pingTimer);
        pingTimer = null;
      }
      handlers.onClose?.();
      scheduleReconnect();
    };
  };

  connect();

  return {
    close() {
      closed = true;
      clearTimers();
      const current = socket;
      socket = null;
      current?.close();
    },
  };
}

function parseThreadEvent(data: unknown): AndroidThreadEventEnvelope | null {
  if (typeof data !== 'string') {
    return null;
  }
  try {
    const parsed = JSON.parse(data) as AndroidThreadEventEnvelope;
    if (
      typeof parsed.type === 'string' &&
      parsed.type.startsWith('thread.') &&
      typeof parsed.threadId === 'string'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}
