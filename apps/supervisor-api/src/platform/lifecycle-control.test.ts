import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LifecycleControlServer, requestLifecycleControl } from './lifecycle-control';

let server: LifecycleControlServer | null = null;
let temporaryDirectory: string | null = null;

afterEach(async () => {
  await server?.stop();
  server = null;
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = null;
  }
});

describe.skipIf(process.platform === 'win32')('LifecycleControlServer', () => {
  it('authenticates status and shutdown requests over local IPC', async () => {
    temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-lifecycle-'));
    const endpoint = path.join(temporaryDirectory, 'control.sock');
    const onShutdown = vi.fn();
    server = new LifecycleControlServer({
      endpoint,
      token: 'secret-token',
      instanceId: 'instance-id',
      onShutdown,
    });
    await server.start();

    await expect(requestLifecycleControl({
      endpoint,
      token: 'secret-token',
      instanceId: 'instance-id',
      action: 'status',
    })).resolves.toMatchObject({
      ok: true,
      status: 'running',
      instanceId: 'instance-id',
    });

    await expect(requestLifecycleControl({
      endpoint,
      token: 'wrong-token',
      instanceId: 'instance-id',
      action: 'status',
    })).resolves.toEqual({ ok: false, error: 'unauthorized' });

    await expect(requestLifecycleControl({
      endpoint,
      token: 'secret-token',
      instanceId: 'instance-id',
      action: 'shutdown',
    })).resolves.toMatchObject({ ok: true, status: 'stopping' });
    await vi.waitFor(() => expect(onShutdown).toHaveBeenCalledOnce());
  });
});
