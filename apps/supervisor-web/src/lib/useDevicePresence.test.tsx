import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RelayPortalSummaryDto } from '@remote-codex/shared';
import { request } from './api';
import { useDevicePresence } from './useDevicePresence';

vi.mock('./api', () => ({ request: vi.fn() }));
const fixture = () => ({
  devices: [{ id: 'mac', connected: true }, { id: 'linux', connected: true }],
  sharedWithMe: [{ deviceId: 'guest-mac', threadId: 'thread', deviceConnected: true }],
  sharedByMe: [],
} as unknown as RelayPortalSummaryDto);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-10T00:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('expires replies at five seconds despite stale portal polls, isolates peers, and recovers without navigation', async () => {
  let sleeping = false;
  vi.mocked(request).mockImplementation(async (url, init) => {
    if (sleeping && String(url).includes('/mac/')) return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    return { connected: true };
  });
  const { result, rerender, unmount } = renderHook(({ raw }) => useDevicePresence(raw), { initialProps: { raw: fixture() } });
  await act(async () => {});
  expect(result.current?.devices.map(d => d.connected)).toEqual([true, true]);
  expect(request).toHaveBeenCalledWith('/relay/devices/guest-mac/presence?threadId=thread', expect.anything());
  sleeping = true;
  await act(() => vi.advanceTimersByTimeAsync(3000));
  rerender({ raw: fixture() }); // Socket inventory still says online.
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(result.current?.devices.map(d => d.connected)).toEqual([false, true]);
  expect(result.current?.sharedWithMe[0]?.deviceConnected).toBe(true);
  sleeping = false;
  await act(() => vi.advanceTimersByTimeAsync(3500));
  expect(result.current?.devices[0]?.connected).toBe(true);
  unmount();
});

it('aborts hidden-page probes and ignores late replies when returning to the page', async () => {
  let finish: ((value: unknown) => void) | undefined;
  vi.mocked(request).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const raw = { ...fixture(), devices: [{ id: 'mac', connected: true }], sharedWithMe: [] } as unknown as RelayPortalSummaryDto;
  const { result, unmount } = renderHook(() => useDevicePresence(raw));
  const lateReply = finish!;
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  visibility.mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  vi.mocked(request).mockClear();
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(request).not.toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => lateReply({ connected: true }));
  expect(result.current?.devices[0]?.connected).toBe(false);
  await act(async () => finish!({ connected: true }));
  expect(result.current?.devices[0]?.connected).toBe(true);
  unmount();
});
