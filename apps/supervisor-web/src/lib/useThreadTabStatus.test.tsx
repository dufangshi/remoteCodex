import { renderHook, act } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ThreadDto } from '@remote-codex/shared';
import { useThreadTabStatus } from './useThreadTabStatus';
const favicon = () =>
  decodeURIComponent(
    document.querySelector<HTMLLinkElement>('link[type="image/svg+xml"]')!.href,
  );
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
  expect(document.title).toBe('Compiler');
  expect(favicon()).toContain('M25 16a9');
  const completed = {
    ...base,
    status: 'idle',
    lastTurnCompletedAt: '2026-09-12T00:00:00Z',
  } as ThreadDto;
  hook.rerender({ thread: completed });
  expect(document.title).toBe('Compiler');
  expect(favicon()).toContain('fill="#f85149"');
  hook.unmount();
  const reloaded = renderHook(() => useThreadTabStatus(completed));
  expect(document.title).toBe('Compiler');
  expect(favicon()).toContain('fill="#f85149"');
  focus.mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event('focus'));
  });
  expect(document.title).toBe('Compiler');
  expect(favicon()).toContain('m8 16 5 5 11-11');
  reloaded.unmount();
  const running = renderHook(() =>
    useThreadTabStatus({ ...completed, status: 'running' }),
  );
  expect(document.title).toBe('Compiler');
  expect(favicon()).toContain('M25 16a9');
  running.unmount();
  expect(document.querySelector('link[type="image/svg+xml"]')).toBeNull();
});
