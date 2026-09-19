import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadDetailDto } from '@remote-codex/shared';
import { useWorkbenchNavigation } from './useWorkbenchNavigation';
import { request } from '../lib/api';

vi.mock('../lib/api', () => ({
  request: vi.fn(),
  relayModeActive: () => true,
  ApiError: class extends Error {},
}));

describe('account thread navigation', () => {
  it('keeps same-ID threads on different devices separate and monitors shared threads with explicit URLs', async () => {
    const references = [
      {
        deviceId: 'mac',
        threadId: 'same-id',
        title: 'Mac review',
        workspaceLabel: 'App',
        favorite: false,
        visitedAt: '2026-09-19',
      },
      {
        deviceId: 'wsl',
        threadId: 'same-id',
        title: 'WSL review',
        workspaceLabel: 'Server',
        favorite: true,
        visitedAt: '2026-09-18',
      },
      {
        deviceId: 'shared-device',
        threadId: 'shared-thread',
        title: 'Shared review',
        workspaceLabel: 'Team',
        favorite: true,
        visitedAt: '2026-09-18',
      },
    ];
    vi.mocked(request).mockImplementation(async (url, init) => {
      if (url === '/relay/account/workbench') {
        if (init?.method === 'POST') {
          const visit = JSON.parse(String(init.body));
          if (visit.favorite !== undefined)
            references.find(
              (r) =>
                r.deviceId === visit.deviceId && r.threadId === visit.threadId,
            )!.favorite = visit.favorite;
        }
        return { threads: structuredClone(references), notifications: [] };
      }
      if (String(url).includes('/shared-device/'))
        return { thread: { status: 'running' } };
      return { thread: { status: 'idle' } };
    });
    const detail = {
      thread: {
        id: 'same-id',
        workspaceId: 'app',
        title: 'Mac review',
        status: 'idle',
      },
      workspace: { label: 'App' },
    } as ThreadDetailDto;
    const { result } = renderHook(() =>
      useWorkbenchNavigation(detail, [detail.thread], 'mac'),
    );
    await waitFor(() => expect(result.current.threads).toHaveLength(3));
    await waitFor(() =>
      expect(
        result.current.threads.find(
          (t) => t.key === 'shared-device:shared-thread',
        )?.status,
      ).toBe('running'),
    );
    expect(
      result.current.threads.find((t) => t.key === 'wsl:same-id')?.href,
    ).toBe('/devices/wsl/threads/same-id');
    expect(result.current.favorite).toBe(false);
    act(() => result.current.onToggleFavorite());
    await waitFor(() => expect(result.current.favorite).toBe(true));
    expect(request).toHaveBeenCalledWith(
      '/relay/devices/shared-device/api/threads/shared-thread?view=summary&limit=1',
      expect.anything(),
    );
    const writes = vi
      .mocked(request)
      .mock.calls.filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(writes.at(-1)).toMatchObject({
      deviceId: 'mac',
      threadId: 'same-id',
      favorite: true,
    });
    expect(references.find((t) => t.deviceId === 'wsl')?.favorite).toBe(true);
  });
});
