import type {
  RelayHttpResponsePayload,
  RelaySupervisorEnvelope,
} from '../../../packages/shared/src/index';

export interface RelaySocketWriter {
  send: (message: string) => void;
}

interface PendingRequest {
  resolve: (payload: RelayHttpResponsePayload) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class RelayRequestBroker {
  private readonly pendingRequests = new Map<string, PendingRequest>();

  constructor(private readonly timeoutMs: number) {}

  forward(socket: RelaySocketWriter, message: RelaySupervisorEnvelope) {
    return new Promise<RelayHttpResponsePayload>((resolve, reject) => {
      if (message.type !== 'relay.request') {
        reject(new Error('Only relay.request messages can be forwarded.'));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(message.requestId);
        reject(new Error('Supervisor relay request timed out.'));
      }, this.timeoutMs);

      this.pendingRequests.set(message.requestId, {
        resolve,
        reject,
        timeout,
      });
      socket.send(JSON.stringify(message));
    });
  }

  accept(message: RelaySupervisorEnvelope) {
    if (message.type !== 'relay.response') {
      return false;
    }

    const pending = this.pendingRequests.get(message.requestId);
    if (!pending) {
      return false;
    }

    clearTimeout(pending.timeout);
    this.pendingRequests.delete(message.requestId);
    pending.resolve(message.payload);
    return true;
  }

  rejectAll(error: Error) {
    for (const [requestId, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
      pending.reject(error);
    }
  }
}
