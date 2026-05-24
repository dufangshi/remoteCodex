import { describe, expect, it, vi } from 'vitest';

import { BackendPluginHost } from './backend-plugin-host';
import { createTerminalPluginBackendContribution } from './terminal-plugin-backend';

describe('BackendPluginHost', () => {
  it('dispatches shell websocket messages through the terminal plugin contribution', async () => {
    const app = {
      services: {
        pluginService: {
          getPlugin: vi.fn(() => ({ enabled: true })),
        },
        shellService: {
          attachShell: vi.fn(async (_shellId: string, options: any) => {
            options.onConnected({
              viewerId: 'viewer-1',
              shell: {
                threadId: 'thread-1',
              },
            });
            options.onData('$ ', {
              replace: true,
              cwdBaseName: 'workspace',
              isCommandRunning: false,
            });
            return {
              viewerId: 'viewer-1',
              shell: {
                threadId: 'thread-1',
              },
            };
          }),
          detachShell: vi.fn(async () => undefined),
        },
      },
      register: vi.fn(),
    } as any;

    const host = new BackendPluginHost(app);
    host.register(createTerminalPluginBackendContribution());
    const sent: unknown[] = [];
    const closeHandlers: Array<() => void> = [];

    const handled = await host.handleSocketMessage({
      app,
      send: (message) => sent.push(message),
      onClose: (handler) => closeHandlers.push(handler),
      state: new Map(),
      message: {
        type: 'shell.attach',
        shellId: 'shell-1',
        cols: 80,
        rows: 24,
      },
    });

    expect(handled).toBe(true);
    expect(app.services.shellService.attachShell).toHaveBeenCalledWith(
      'shell-1',
      expect.objectContaining({
        cols: 80,
        rows: 24,
      }),
    );
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'shell.connected',
          shellId: 'shell-1',
          payload: {
            viewerId: 'viewer-1',
          },
        }),
        expect.objectContaining({
          type: 'shell.output',
          shellId: 'shell-1',
          payload: expect.objectContaining({
            data: '$ ',
            replace: true,
          }),
        }),
      ]),
    );

    expect(closeHandlers).toHaveLength(1);
    closeHandlers[0]?.();
    expect(app.services.shellService.detachShell).toHaveBeenCalledWith(
      'shell-1',
      'viewer-1',
    );
  });

  it('lets unclaimed websocket messages fall through', async () => {
    const host = new BackendPluginHost({} as any);

    await expect(
      host.handleSocketMessage({
        app: {} as any,
        send: () => {},
        onClose: () => {},
        state: new Map(),
        message: {
          type: 'supervisor.ping',
          timestamp: '2026-01-01T00:00:00.000Z',
        },
      }),
    ).resolves.toBe(false);
  });
});
