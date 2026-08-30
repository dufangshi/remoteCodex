import type {
  ShellEventEnvelope,
  SupervisorConnectedEnvelope,
  SupervisorSocketClientEnvelope,
  SupervisorSocketServerEnvelope,
} from '@remote-codex/shared';
import type { ShellSocketConnection, ShellSocketHandlers } from '@remote-codex/thread-ui';

import type { AndroidThreadBootstrap } from './AndroidBootstrap';
import { supervisorWebSocketUrl } from './AndroidConnection';

export function connectAndroidShellSocket(
  bootstrap: AndroidThreadBootstrap,
  handlers: ShellSocketHandlers,
): ShellSocketConnection {
  const socket = new WebSocket(supervisorWebSocketUrl(bootstrap));
  socket.addEventListener('message', (message) => {
    try {
      const parsed = JSON.parse(message.data as string) as SupervisorSocketServerEnvelope;
      if (parsed.type === 'supervisor.connected') {
        handlers.onConnected?.(parsed as SupervisorConnectedEnvelope);
      } else if (isShellEvent(parsed)) {
        handlers.onShellEvent?.(parsed);
      }
    } catch {
      // Ignore malformed supervisor messages.
    }
  });
  return {
    socket,
    send(message: SupervisorSocketClientEnvelope) {
      socket.send(JSON.stringify(message));
    },
    close() {
      socket.close();
    },
  };
}

function isShellEvent(event: SupervisorSocketServerEnvelope): event is ShellEventEnvelope {
  return (
    'shellId' in event &&
    event.type.startsWith('shell.') &&
    typeof event.payload === 'object' &&
    event.payload !== null
  );
}
