import { renderHook, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ThreadDto } from '@remote-codex/shared';
import { useThreadTabStatus } from './useThreadTabStatus';
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
it('keeps a background completion unread across reload, then marks it read on focus; running wins', () => {
  window.history.replaceState({}, '', '/threads/thread-a');
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  const base = {
    id: 'thread-a',
    title: 'Compiler',
    status: 'running',
    lastTurnCompletedAt: null,
  } as ThreadDto;
  const hook = renderHook(({ thread }) => useThreadTabStatus(thread), {
    initialProps: { thread: base },
  });
  expect(document.title).toContain('Working');
  const completed = {
    ...base,
    status: 'idle',
    lastTurnCompletedAt: '2026-09-12T00:00:00Z',
  } as ThreadDto;
  hook.rerender({ thread: completed });
  expect(document.title).toContain('Unread');
  hook.unmount();
  const reloaded = renderHook(() => useThreadTabStatus(completed));
  expect(document.title).toContain('Unread');
  focus.mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(document.title).toContain('Idle');
  reloaded.unmount();
  const running = renderHook(() =>
    useThreadTabStatus({ ...completed, status: 'running' }),
  );
  expect(document.title).toContain('Working');
  running.unmount();
  expect(document.querySelector('link[type="image/svg+xml"]')).toBeNull();
});
