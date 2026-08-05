import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

export interface LifecycleControlServerOptions {
  endpoint: string;
  token: string;
  instanceId: string;
  onShutdown: () => void | Promise<void>;
}

type LifecycleRequest = {
  action?: unknown;
  token?: unknown;
  instanceId?: unknown;
};

export class LifecycleControlServer {
  private server: net.Server | null = null;

  constructor(private readonly options: LifecycleControlServerOptions) {}

  async start() {
    if (this.server) {
      return;
    }
    if (process.platform !== 'win32') {
      await fs.unlink(this.options.endpoint).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      });
      await fs.mkdir(path.dirname(this.options.endpoint), { recursive: true });
    }

    const server = net.createServer((socket) => {
      socket.setEncoding('utf8');
      let input = '';
      socket.on('data', (chunk: string) => {
        input += chunk;
        if (input.length > 16 * 1024) {
          socket.end(`${JSON.stringify({ ok: false, error: 'request_too_large' })}\n`);
          return;
        }
        const newline = input.indexOf('\n');
        if (newline < 0) {
          return;
        }
        const line = input.slice(0, newline);
        input = '';
        void this.handleRequest(line, socket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.endpoint, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
  }

  async stop() {
    const server = this.server;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (process.platform !== 'win32') {
      await fs.unlink(this.options.endpoint).catch(() => undefined);
    }
  }

  private async handleRequest(line: string, socket: net.Socket) {
    let request: LifecycleRequest;
    try {
      request = JSON.parse(line) as LifecycleRequest;
    } catch {
      socket.end(`${JSON.stringify({ ok: false, error: 'invalid_json' })}\n`);
      return;
    }
    if (
      request.token !== this.options.token ||
      request.instanceId !== this.options.instanceId
    ) {
      socket.end(`${JSON.stringify({ ok: false, error: 'unauthorized' })}\n`);
      return;
    }
    if (request.action === 'status') {
      socket.end(`${JSON.stringify({
        ok: true,
        status: 'running',
        instanceId: this.options.instanceId,
        pid: process.pid,
      })}\n`);
      return;
    }
    if (request.action === 'shutdown') {
      socket.end(`${JSON.stringify({
        ok: true,
        status: 'stopping',
        instanceId: this.options.instanceId,
      })}\n`);
      setImmediate(() => void this.options.onShutdown());
      return;
    }
    socket.end(`${JSON.stringify({ ok: false, error: 'unsupported_action' })}\n`);
  }
}

export function requestLifecycleControl(
  input: {
    endpoint: string;
    token: string;
    instanceId: string;
    action: 'status' | 'shutdown';
    timeoutMs?: number;
  },
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = net.createConnection(input.endpoint);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('Lifecycle control request timed out.'));
    }, input.timeoutMs ?? 2_000);
    let output = '';
    const finish = (callback: () => void) => {
      clearTimeout(timer);
      callback();
    };
    socket.setEncoding('utf8');
    socket.once('connect', () => {
      socket.write(`${JSON.stringify({
        action: input.action,
        token: input.token,
        instanceId: input.instanceId,
      })}\n`);
    });
    socket.on('data', (chunk: string) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) {
        return;
      }
      try {
        const response = JSON.parse(output.slice(0, newline)) as Record<string, unknown>;
        socket.end();
        finish(() => resolve(response));
      } catch (error) {
        socket.destroy();
        finish(() => reject(error));
      }
    });
    socket.once('error', (error) => finish(() => reject(error)));
  });
}
