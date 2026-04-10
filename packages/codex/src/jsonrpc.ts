import { EventEmitter } from 'node:events';
import readline from 'node:readline';
import { Readable, Writable } from 'node:stream';

import {
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcSuccess
} from './types';

export class JsonRpcClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

export class JsonRpcClient extends EventEmitter {
  private readonly reader: readline.Interface;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private nextRequestId = 1;
  private closed = false;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable
  ) {
    super();

    this.reader = readline.createInterface({
      input: this.input,
      crlfDelay: Infinity
    });

    this.reader.on('line', (line) => {
      if (!line.trim()) {
        return;
      }

      this.handleMessage(line);
    });

    this.reader.on('close', () => {
      this.close();
    });
  }

  async request<TResult = unknown, TParams = unknown>(
    method: string,
    params?: TParams,
    timeoutMs = 20_000
  ): Promise<TResult> {
    if (this.closed) {
      throw new JsonRpcClientError('JSON-RPC client is closed.', 'client_closed');
    }

    const id = this.nextRequestId++;
    const payload: JsonRpcRequest<TParams> = {
      jsonrpc: '2.0',
      id,
      method
    };

    if (params !== undefined) {
      payload.params = params;
    }

    return new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new JsonRpcClientError(`JSON-RPC request timed out for ${method}.`, 'request_timeout', {
            method,
            timeoutMs
          })
        );
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timer
      });

      this.output.write(`${JSON.stringify(payload)}\n`);
    });
  }

  close() {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.reader.close();

    for (const [id, request] of this.pending.entries()) {
      clearTimeout(request.timer);
      request.reject(
        new JsonRpcClientError('JSON-RPC client closed before response was received.', 'client_closed', {
          id
        })
      );
    }

    this.pending.clear();
    this.emit('closed');
  }

  private handleMessage(raw: string) {
    let parsed: Record<string, unknown>;

    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      this.emit(
        'warning',
        new JsonRpcClientError('Failed to parse JSON-RPC payload.', 'invalid_json', {
          raw,
          error: error instanceof Error ? error.message : String(error)
        })
      );
      return;
    }

    if (typeof parsed.method === 'string' && !('id' in parsed)) {
      this.emit('notification', parsed as unknown as JsonRpcNotification);
      return;
    }

    if (typeof parsed.id !== 'number') {
      return;
    }

    const request = this.pending.get(parsed.id);
    if (!request) {
      return;
    }

    clearTimeout(request.timer);
    this.pending.delete(parsed.id);

    if ('error' in parsed && parsed.error && typeof parsed.error === 'object') {
      const error = parsed.error as JsonRpcFailure['error'];
      request.reject(
        new JsonRpcClientError(error.message, 'remote_error', {
          code: error.code,
          data: error.data
        })
      );
      return;
    }

    request.resolve((parsed as unknown as JsonRpcSuccess).result);
  }
}
