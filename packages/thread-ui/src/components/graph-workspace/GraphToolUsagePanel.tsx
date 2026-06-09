import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ThreadHistoryItemDto } from '@remote-codex/shared';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './GraphAccordion';

export interface GraphToolEventSummary {
  id: string;
  kind: ThreadHistoryItemDto['kind'];
  label: string;
  preview: string;
  detail: string;
  turnId?: string | null;
  status?: string | null;
  sequence: number;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'string') {
    return value.length > 2000 ? `${value.slice(0, 2000)}\n...(truncated)` : value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function CallSection({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--theme-fg-muted)]">
        {label}
      </p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--theme-surface-strong)] p-2 text-[11px] leading-relaxed text-[var(--theme-fg-soft)]">
        {formatValue(value)}
      </pre>
    </div>
  );
}

function ToolEventAccordion({ event }: { event: GraphToolEventSummary }) {
  return (
    <AccordionItem
      value={event.id}
      className="thread-tool-call mb-2 overflow-hidden rounded-lg border border-[var(--theme-border)] last:mb-0"
    >
      <AccordionTrigger className="px-3 py-2 text-xs font-medium text-[var(--theme-fg)] hover:bg-[var(--theme-hover)] hover:no-underline [&[data-state=open]]:bg-[var(--theme-hover)]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--theme-accent-strong)]" />
          <span className="truncate font-mono text-xs font-medium text-[var(--theme-fg)]">
            {event.label}
          </span>
          {event.status ? (
            <span className="shrink-0 rounded-full border border-[var(--theme-border)] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-[var(--theme-fg-muted)]">
              {event.status}
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {event.turnId ? (
            <span className="max-w-20 truncate text-[10px] text-[var(--theme-fg-muted)]">
              {event.turnId}
            </span>
          ) : null}
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3">
        <div className="space-y-2 px-3 pb-3 pt-1">
          <CallSection label="Input" value={event.preview} />
          <CallSection label="Output" value={event.detail} />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

export function GraphToolUsagePanel({
  formatToolKind,
  toolCounts,
  toolEvents,
  maxToolCount,
}: {
  formatToolKind: (kind: ThreadHistoryItemDto['kind']) => string;
  toolCounts: Array<[ThreadHistoryItemDto['kind'], number]>;
  toolEvents: GraphToolEventSummary[];
  maxToolCount: number;
}) {
  const [expandedEventId, setExpandedEventId] = useState<string | null>(
    () => toolEvents.at(-1)?.id ?? null,
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setExpandedEventId((current) => current ?? toolEvents.at(-1)?.id ?? null);
  }, [toolEvents]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [toolEvents.length]);

  if (!toolCounts.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-[var(--theme-fg-muted)]">
        <span>No tool calls yet. Run the agent to see usage.</span>
        <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs">
          <RefreshCw className="h-3 w-3" />
          Reload from workspace
        </span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-[var(--theme-border)] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-fg-muted)]">
            Calls this session
          </h2>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-[var(--theme-fg-muted)] opacity-60"
            disabled
            title="Remote Codex streams tool history from thread events"
          >
            <RefreshCw className="h-3 w-3" />
            Reload
          </button>
        </div>
        <div className="space-y-2">
          {toolCounts.map(([kind, count]) => (
            <div key={kind} className="flex items-center gap-3">
              <span
                className="w-40 shrink-0 truncate text-right font-mono text-[11px] text-[var(--theme-fg-muted)]"
                title={formatToolKind(kind)}
              >
                {formatToolKind(kind)}
              </span>
              <div className="flex flex-1 items-center gap-2">
                <div className="relative h-4 flex-1 overflow-hidden rounded-sm bg-[var(--theme-muted)]">
                  <div
                    className="h-full rounded-sm bg-[var(--theme-accent-strong)] transition-all duration-300"
                    style={{ width: `${(count / maxToolCount) * 100}%` }}
                  />
                </div>
                <span className="w-5 shrink-0 text-right text-[11px] font-medium text-[var(--theme-fg-soft)]">
                  {count}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--theme-fg-muted)]">
          Call log
        </h2>
        <Accordion
          type="single"
          collapsible
          value={expandedEventId ?? ''}
          onValueChange={(value) => setExpandedEventId(value || null)}
          className="space-y-0"
        >
          {toolEvents.slice(-50).map((event) => (
            <ToolEventAccordion key={event.id} event={event} />
          ))}
        </Accordion>
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
