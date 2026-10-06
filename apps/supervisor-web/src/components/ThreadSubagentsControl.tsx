import { useEffect, useRef, useState } from 'react';
import { Bot, X } from 'lucide-react';
import type { ThreadDetailDto, ThreadSubagentDto } from '@remote-codex/shared';

function statusLabel(status: string) {
  switch (status) {
    case 'running':
      return 'Running';
    case 'failed':
      return 'Failed';
    case 'interrupted':
      return 'Interrupted';
    case 'completed':
      return 'Completed';
    default:
      return status;
  }
}

export function ThreadSubagentsControl({ detail }: { detail: ThreadDetailDto }) {
  const subagents = detail.activeSubagents ?? [];
  const running = subagents.filter((agent) => agent.status === 'running');
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [detail.thread.id]);
  useEffect(() => {
    if (running.length === 0) setOpen(false);
  }, [running.length]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  if (running.length === 0) return null;

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
        aria-label={`Subagents (${running.length})`}
        aria-expanded={open}
        title="Native subagents"
        onClick={() => setOpen((current) => !current)}
      >
        <Bot size={14} />
        <span>{running.length}</span>
      </button>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-[var(--overlay-scrim)] backdrop-blur-sm"
            aria-label="Close subagents"
            onClick={close}
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Native subagents"
            className="relative w-full max-w-xl rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] p-5 text-[var(--theme-fg)] shadow-xl"
          >
            <header className="mb-3 flex items-center justify-between">
              <div>
                <h2>Native subagents</h2>
                <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
                  {running.length} currently running
                </p>
              </div>
              <button aria-label="Close subagents dialog" onClick={close}>
                <X size={18} />
              </button>
            </header>
            <div className="max-h-[65dvh] space-y-2 overflow-y-auto">
              {subagents.map((agent: ThreadSubagentDto) => (
                <article
                  key={agent.id}
                  className="rounded-lg border border-[var(--theme-border)] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">{agent.name || agent.id}</strong>
                    <span className="text-xs text-[var(--theme-fg-muted)]">
                      {agent.isBackground && agent.status === 'running' ? 'Running in background' : statusLabel(agent.status)}
                    </span>
                  </div>
                  <code className="mt-1 block text-[11px] text-[var(--theme-fg-muted)]">
                    {agent.id}
                  </code>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
