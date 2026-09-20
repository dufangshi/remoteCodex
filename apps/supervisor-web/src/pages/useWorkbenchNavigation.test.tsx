import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ThreadDetailDto } from '@remote-codex/shared';
import { useWorkbenchNavigation, workbenchThreadStatus } from './useWorkbenchNavigation';
import { request } from '../lib/api';

vi.mock('../lib/api', () => ({
  request: vi.fn(),
  relayModeActive: () => true,
  ApiError: class extends Error {},
}));

describe('account thread navigation', () => {
  it('uses every current-workspace thread for tabs, independently of account recents and active tab', async () => {
    vi.mocked(request).mockResolvedValue({ threads: [{ deviceId: 'wsl', threadId: 'elsewhere', title: 'Recent elsewhere', favorite: false }], notifications: [] });
    const detail = { thread: { id: 'second', workspaceId: 'app', title: 'Second', status: 'running', createdAt: '2026-09-02' }, workspace: { label: 'App' } } as ThreadDetailDto;
    const threads = [detail.thread, { ...detail.thread, id: 'first', createdAt: '2026-09-01' }, { ...detail.thread, id: 'other', workspaceId: 'another' }];
    const { result, rerender, unmount } = renderHook(({ current }) => useWorkbenchNavigation(current, threads, 'wsl'), { initialProps: { current: detail } });
    await waitFor(() => expect(result.current.navigationReady).toBe(true));
    expect(result.current.workspaceThreads.map(t => t.key)).toEqual(['wsl:first', 'wsl:second']);
    expect(result.current.threads.map(t => t.key)).toContain('wsl:elsewhere');
    rerender({ current: { ...detail, thread: threads[1]! } });
    expect(result.current.workspaceThreads.map(t => t.key)).toEqual(['wsl:first', 'wsl:second']);
    unmount();
  });
  it('loads notification titles and reply previews using the notification device, even without a saved shortcut', async () => {
    const completed = '2026-09-19T14:00:00Z';
    const snapshot = { threads: [], notifications: [{ id: 'event', title: '1 completed', href: '/devices/mac/threads/review', occurredAt: completed }] };
    vi.mocked(request).mockImplementation(async url => {
      if (url === '/relay/account/workbench') return snapshot;
      if (url === '/relay/devices/mac/api/threads/review?view=summary&limit=10') return {
        thread: { title: 'Fix the image preview' }, turns: [{ status: 'completed', completedAt: completed, items: [{ kind: 'agentMessage', text: 'The image now loads correctly. ' + 'Details '.repeat(50) }] }],
      };
      throw new Error(`Unexpected URL: ${url}`);
    });
    const { result, unmount } = renderHook(() => useWorkbenchNavigation(null, [], 'wsl'));
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    act(() => result.current.onReadNotifications());
    await waitFor(() => expect(result.current.notifications[0]?.title).toBe('Fix the image preview · Completed'));
    expect(result.current.notifications[0]?.summary).toMatch(/^The image now loads correctly/);
    expect(Array.from(result.current.notifications[0]!.summary!)).toHaveLength(181);
    expect(result.current.notifications[0]?.summary).toMatch(/…$/);
    unmount();
  });
  it('distinguishes running, unread completion, read idle, failure and unavailable states', () => {
    const completed = '2026-09-19T14:00:00Z';
    const activity = { status: 'idle', lastTurnCompletedAt: completed };
    expect(workbenchThreadStatus({ ...activity, status: 'running' })).toBe('running');
    expect(workbenchThreadStatus(activity)).toBe('unread');
    expect(workbenchThreadStatus(activity, completed)).toBe('idle');
    expect(workbenchThreadStatus({ ...activity, lastTurnCompletedAt: '2026-09-19T15:00:00Z' }, completed)).toBe('unread');
    expect(workbenchThreadStatus({ ...activity, status: 'failed' }, completed)).toBe('failed');
    expect(workbenchThreadStatus({ ...activity, status: 'system_error' })).toBe('failed');
    expect(workbenchThreadStatus({ status: 'idle' })).toBe('idle');
    expect(workbenchThreadStatus({ status: 'not_loaded' })).toBe('unknown');
    expect(workbenchThreadStatus(undefined)).toBe('unknown');
  });

  it('acknowledges a completed turn only while the thread is focused, and never through a favorite write', async () => {
    const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const completion = '2026-09-19T14:00:00Z';
    let ref = { deviceId: 'mac', threadId: 'read-test', title: 'Read state', workspaceLabel: 'App', favorite: false, visitedAt: '', readCompletedAt: null as string | null };
    vi.mocked(request).mockClear();
    vi.mocked(request).mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') ref = { ...ref, ...JSON.parse(String(init.body)) };
      return { threads: [ref], notifications: [] };
    });
    const detail = { thread: { id: 'read-test', title: 'Read state', status: 'idle', lastTurnCompletedAt: completion }, workspace: { label: 'App' } } as ThreadDetailDto;
    const { result, unmount } = renderHook(() => useWorkbenchNavigation(detail, [detail.thread], 'mac'));
    await waitFor(() => expect(result.current.threads[0]?.status).toBe('unread'));
    act(() => result.current.onToggleFavorite());
    await waitFor(() => expect(result.current.favorite).toBe(true));
    expect(ref.readCompletedAt).toBeNull();
    expect(result.current.threads[0]?.status).toBe('unread');
    focus.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.threads[0]?.status).toBe('idle'));
    expect(ref.readCompletedAt).toBe(completion);
    unmount();
    focus.mockRestore();
  });
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
    await act(async () => result.current.onToggleThreadFavorite('wsl:same-id'));
    expect(references.find((t) => t.deviceId === 'wsl')?.favorite).toBe(false);
    expect(references.find((t) => t.deviceId === 'mac')?.favorite).toBe(true);
    expect(request).toHaveBeenLastCalledWith('/relay/account/workbench', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"deviceId":"wsl"'),
    }));
  });
});
