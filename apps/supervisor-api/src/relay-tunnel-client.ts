import type { RuntimeConfig } from '../../../packages/config/src/index';
import type {
  RelayHttpRequestPayload,
  RelayHttpResponsePayload,
  RelaySupervisorEnvelope,
  SupervisorSocketServerEnvelope,
} from '../../../packages/shared/src/index';

const RELAY_HEARTBEAT_INTERVAL_MS = 30_000;
const RELAY_RECONNECT_INITIAL_DELAY_MS = 1_000;
const RELAY_RECONNECT_MAX_DELAY_MS = 30_000;

export type RelayRequestHandler = (
  request: RelayHttpRequestPayload,
) => Promise<RelayHttpResponsePayload>;
export type RelayClientConnectedHandler = (
  clientId: string,
  send: (message: SupervisorSocketServerEnvelope) => void,
) => () => void;
export type RelayClientMessageHandler = (
  clientId: string,
  message: unknown,
  send: (message: SupervisorSocketServerEnvelope) => void,
) => Promise<void> | void;

export class RelayTunnelClient {
  private socket: WebSocket | null = null;
  private heartbeatHandle: NodeJS.Timeout | null = null;
  private reconnectHandle: NodeJS.Timeout | null = null;
  private reconnectDelayMs = RELAY_RECONNECT_INITIAL_DELAY_MS;
  private stopped = false;
  private readonly relayClientCleanup = new Map<string, () => void>();

  constructor(
    private readonly config: RuntimeConfig['relay'],
    private readonly handleRequest: RelayRequestHandler,
    private readonly handleClientConnected: RelayClientConnectedHandler,
    private readonly handleClientMessage: RelayClientMessageHandler,
  ) {}

  validateConfig() {
    if (!this.config.serverUrl || !this.config.agentToken) {
      throw new Error(
        'Relay mode requires REMOTE_CODEX_RELAY_SERVER_URL and REMOTE_CODEX_RELAY_AGENT_TOKEN.',
      );
    }
  }

  start() {
    this.validateConfig();
    this.stopped = false;
    this.clearReconnect();

    if (this.socket) {
      return;
    }

    const url = new URL('/supervisor/tunnel', this.config.serverUrl ?? undefined);
    url.searchParams.set('token', this.config.agentToken ?? '');
    this.socket = new WebSocket(url);

    this.socket.addEventListener('open', () => {
      this.reconnectDelayMs = RELAY_RECONNECT_INITIAL_DELAY_MS;
      this.sendHeartbeat();
      this.heartbeatHandle = setInterval(() => {
        this.sendHeartbeat();
      }, RELAY_HEARTBEAT_INTERVAL_MS);
    });

    this.socket.addEventListener('close', () => {
      this.clearHeartbeat();
      this.cleanupRelayClients();
      this.socket = null;
      this.scheduleReconnect();
    });

    this.socket.addEventListener('message', (event) => {
      void this.handleMessage(String(event.data));
    });
  }

  stop() {
    this.stopped = true;
    this.clearHeartbeat();
    this.clearReconnect();
    this.cleanupRelayClients();
    this.socket?.close();
    this.socket = null;
  }

  private sendHeartbeat() {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: 'relay.heartbeat',
        timestamp: new Date().toISOString(),
      } satisfies RelaySupervisorEnvelope),
    );
  }

  private async handleMessage(rawMessage: string) {
    let parsed: RelaySupervisorEnvelope;
    try {
      parsed = JSON.parse(rawMessage) as RelaySupervisorEnvelope;
    } catch {
      return;
    }

    if (parsed.type !== 'relay.request') {
      if (parsed.type === 'relay.client.connected') {
        const cleanup = this.handleClientConnected(parsed.clientId, (message) => {
          this.sendClientMessage(parsed.clientId, message);
        });
        this.relayClientCleanup.set(parsed.clientId, cleanup);
        return;
      }

      if (parsed.type === 'relay.client.disconnected') {
        this.relayClientCleanup.get(parsed.clientId)?.();
        this.relayClientCleanup.delete(parsed.clientId);
        return;
      }

      if (parsed.type === 'relay.client.message') {
        await this.handleClientMessage(parsed.clientId, parsed.payload, (message) => {
          this.sendClientMessage(parsed.clientId, message);
        });
        return;
      }

      return;
    }

    const response = await this.handleRequest(parsed.payload);
    this.socket?.send(
      JSON.stringify({
        type: 'relay.response',
        timestamp: new Date().toISOString(),
        requestId: parsed.requestId,
        payload: response,
      } satisfies RelaySupervisorEnvelope),
    );
  }

  private sendClientMessage(
    clientId: string,
    message: SupervisorSocketServerEnvelope,
  ) {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(
      JSON.stringify({
        type: 'relay.server.message',
        timestamp: new Date().toISOString(),
        clientId,
        payload: message,
      } satisfies RelaySupervisorEnvelope),
    );
  }

  private clearHeartbeat() {
    if (this.heartbeatHandle) {
      clearInterval(this.heartbeatHandle);
      this.heartbeatHandle = null;
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectHandle) {
      return;
    }

    const delayMs = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      RELAY_RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectHandle = setTimeout(() => {
      this.reconnectHandle = null;
      this.start();
    }, delayMs);
  }

  private clearReconnect() {
    if (this.reconnectHandle) {
      clearTimeout(this.reconnectHandle);
      this.reconnectHandle = null;
    }
  }

  private cleanupRelayClients() {
    for (const [clientId, cleanup] of this.relayClientCleanup) {
      cleanup();
      this.relayClientCleanup.delete(clientId);
    }
  }
}
