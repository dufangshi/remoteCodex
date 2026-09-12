import { useEffect } from 'react';
import type { ThreadDto } from '@remote-codex/shared';

export function tabState(status: string, completed: number, seen: number) {
  if (status === 'running')
    return { label: 'Working', color: '#e9ab3c', symbol: '◌' };
  if (status === 'recovering')
    return { label: 'Checking status', color: '#e9ab3c', symbol: '?' };
  if (completed > seen)
    return {
      label: status === 'failed' ? 'Failed · Unread' : 'Unread',
      color: '#58a6ff',
      symbol: '●',
    };
  return {
    label: status === 'failed' ? 'Failed · Read' : 'Idle',
    color: '#8c959f',
    symbol: '✓',
  };
}
export function useThreadTabStatus(thread: ThreadDto | null) {
  useEffect(() => {
    if (!thread || !window.location.pathname.endsWith('/' + thread.id)) return;
    const key = `remote-codex:thread-seen:${window.location.pathname}`;
    const completed = Date.parse(thread.lastTurnCompletedAt ?? '') || 0;
    let memorySeen = 0;
    const icons = Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]'),
    );
    const previous = icons.map((icon) => [icon, icon.href, icon.type] as const);
    const icon = document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/svg+xml';
    icons.forEach((old) => old.remove());
    document.head.append(icon);
    function update() {
      let seen = memorySeen;
      try {
        seen = Math.max(seen, Number(localStorage.getItem(key)) || 0);
      } catch {
        /* Private storage may be unavailable. */
      }
      if (
        document.visibilityState === 'visible' &&
        document.hasFocus() &&
        thread!.status !== 'running' &&
        thread!.status !== 'recovering'
      ) {
        seen = Math.max(seen, completed);
        memorySeen = seen;
        try {
          if (localStorage.getItem(key) !== String(seen))
            localStorage.setItem(key, String(seen));
        } catch {
          /* Keep the in-page read marker. */
        }
      }
      const state = tabState(thread!.status, completed, seen);
      document.title = `${state.symbol} ${state.label} · ${thread!.title}`;
      icon.href =
        'data:image/svg+xml,' +
        encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#171713"/><circle cx="16" cy="16" r="10" fill="${state.color}"/>${state.label === 'Working' ? '<circle cx="16" cy="16" r="5" fill="#171713"/>' : ''}</svg>`,
        );
    }
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    window.addEventListener('storage', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
      window.removeEventListener('storage', update);
      icon.remove();
      previous.forEach(([old, href, type]) => {
        old.href = href;
        old.type = type;
        document.head.append(old);
      });
    };
  }, [thread?.id, thread?.title, thread?.status, thread?.lastTurnCompletedAt]);
}
