import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clock3, X } from 'lucide-react';
import { request } from '../lib/api';
import type { ThreadDto } from '@remote-codex/shared';

interface Watch {
  id: string;
  cron: string;
  schedule: string;
  prompt: string;
  recurring: boolean;
  createdAt: string | null;
  lastTriggeredAt: string | null;
  expiresAt: string | null;
  status: 'active' | 'unconfirmed' | 'sessionEnded';
}
export function ThreadWatchesControl({ thread }: { thread: ThreadDto }) {
  const [snapshot, setSnapshot] = useState<{
    watches: Watch[];
    timezone?: string;
  }>({ watches: [] });
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const isClaude = thread.provider === 'claude' || thread.agentId === 'claude';
  useEffect(() => {
    if (!isClaude) {
      setSnapshot({ watches: [] });
      return;
    }
    let alive = true;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const data = await request<{ watches: Watch[]; timezone?: string }>(
          `/api/threads/${encodeURIComponent(thread.id)}/watches`,
          { signal: controller.signal, cache: 'no-store' },
        );
        if (alive) setSnapshot(data);
      } catch {
        /* Older runtimes do not advertise native watches. */
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [thread.id, isClaude, thread.updatedAt]);
  useEffect(() => {
    setOpen(false);
  }, [thread.id]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open]);
  if (!snapshot.watches.length) return null;
  const count = snapshot.watches.filter(
    (w) => w.status !== 'sessionEnded',
  ).length;
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="matter-watches-toggle"
        aria-label={`Watches (${count})`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Session watches"
      >
        <Clock3 size={14} />
        <span>{count}</span>
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
            <button
              className="absolute inset-0 bg-[var(--overlay-scrim)] backdrop-blur-sm"
              aria-label="Close watches"
              onClick={close}
            />
            <section
              role="dialog"
              aria-modal="true"
              aria-label="Thread watches"
              className="relative w-full max-w-xl rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 text-[var(--theme-fg)] shadow-xl"
            >
              <header className="mb-3 flex items-center justify-between">
                <h2>Watches</h2>
                <button
                  autoFocus
                  aria-label="Close watches dialog"
                  onClick={close}
                >
                  <X size={18} />
                </button>
              </header>
              <p className="mb-3 text-xs text-[var(--theme-fg-muted)]">
                Session timers stop when the Claude process exits.{' '}
                {snapshot.timezone}
              </p>
              <div className="max-h-[65dvh] space-y-3 overflow-y-auto">
                {snapshot.watches.map((w) => (
                  <article
                    key={w.id}
                    className="rounded-lg border border-[var(--theme-border)] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm">{w.schedule}</strong>
                      <code className="text-xs">{w.id}</code>
                    </div>
                    <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                      {w.status === 'active'
                        ? 'Active in current session'
                        : w.status === 'sessionEnded'
                          ? 'Session ended — recreate this watch'
                          : 'Status unconfirmed'}
                    </p>
                    <code className="mt-2 block text-xs">{w.cron}</code>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                      {w.prompt}
                    </p>
                    {w.lastTriggeredAt && (
                      <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">
                        Last triggered:{' '}
                        {new Date(w.lastTriggeredAt).toLocaleString()}
                      </p>
                    )}
                    {w.expiresAt && (
                      <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                        Expires: {new Date(w.expiresAt).toLocaleString()}
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
