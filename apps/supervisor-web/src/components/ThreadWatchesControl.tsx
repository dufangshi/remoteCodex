import { getLocale } from '@remote-codex/thread-ui/i18n';
import { translate, useI18n } from '@remote-codex/thread-ui/i18n';
import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Clock3 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  TokenUsageCost,
  type TokenUsageCostProps,
} from '@remote-codex/thread-ui';
import type { ThreadDto } from '@remote-codex/shared';
import { request } from '../lib/api';

interface Watch {
  id: string;
  cron: string;
  schedule: string;
  prompt: string;
  recurring: boolean;
  createdAt: string | null;
  lastTriggeredAt: string | null;
  expiresAt: string | null;
  status:
    | 'active'
    | 'unconfirmed'
    | 'sessionEnded'
    | 'notScheduled'
    | 'deleted'
    | 'expired'
    | 'completed';
  statusCheckedAt?: string | null;
  // Older Supervisors return the schedule without usage statistics.
  triggerCount?: number | null;
  ambiguousTriggerCount?: number;
  usageTriggerCount?: number;
  pricedTriggerCount?: number;
  tokenUsage?: TokenUsageCostProps['usage'];
  priceEstimate?: TokenUsageCostProps['price'];
}
interface WatchSnapshot {
  watches: Watch[];
  timezone?: string;
}
const statusLabel: Record<Watch['status'], string> = {
  get active() { return translate("workbench.activeInCurrentSession"); },
  get unconfirmed() { return translate("workbench.statusUnconfirmed"); },
  get sessionEnded() { return translate("workbench.sessionEnded"); },
  get notScheduled() { return translate("workbench.noLongerScheduled"); },
  get deleted() { return translate("workbench.cancelled"); },
  get expired() { return translate("workbench.expired"); },
  get completed() { return translate("workbench.completed"); },
};
const isCurrent = (watch: Watch) =>
  watch.status === 'active' || watch.status === 'unconfirmed';
const dateLabel = (date: string | null) =>
  date ? new Date(date).toLocaleString(getLocale()) : translate("workbench.unavailable");

function WatchCard({ watch: w }: { watch: Watch }) {
  const { locale: i18nLocale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const ambiguous = w.ambiguousTriggerCount ?? 0;
  const count = w.triggerCount;
  const partial = count != null && (w.pricedTriggerCount ?? 0) < count;
  const coverage = partial
    ? `Cost reported for ${w.pricedTriggerCount ?? 0} of ${count} recorded runs.`
    : translate("workbench.sumOfCostsReportedByTheRecorded");
  return (
    <article className="min-w-0 rounded-lg border border-[var(--theme-border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <strong className="block break-words text-sm">{w.schedule}</strong>
          <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
            {statusLabel[w.status]}
          </p>
          {w.status === 'unconfirmed' && (
            <p className="mt-1 text-xs text-[var(--theme-fg-muted)]">
              {translate("workbench.thisRecordedWatchMayHaveEndedIts")}</p>
          )}
        </div>
        <div className="shrink-0 text-sm" aria-label={translate("workbench.watchTotalCost")}>
          {w.priceEstimate || w.tokenUsage ? (
            <TokenUsageCost
              usage={w.tokenUsage ?? null}
              price={w.priceEstimate ?? null}
              costLabel={translate("workbench.watchTotalCost")}
              detailsNote={`${coverage}${ambiguous ? translate("workbench.ambiguousRunsAreExcluded") : ''}`}
              tooltipZIndex={120}
            />
          ) : (
            <span className="text-xs text-[var(--theme-fg-muted)]">
              {translate("workbench.costUnavailable")}</span>
          )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-[var(--theme-fg-muted)]">{translate("workbench.created")}</dt>
        <dd>
          {w.createdAt ? (
            <time dateTime={w.createdAt}>{dateLabel(w.createdAt)}</time>
          ) : (
            translate("workbench.unavailable")
          )}
        </dd>
        <dt className="text-[var(--theme-fg-muted)]">{translate("workbench.triggers")}</dt>
        <dd>
          {count == null
            ? translate("workbench.unavailable")
            : `${count.toLocaleString(getLocale())}${ambiguous ? ' confirmed' : ''}`}
        </dd>
        {w.lastTriggeredAt && (
          <>
            <dt className="text-[var(--theme-fg-muted)]">{translate("workbench.lastTriggered")}</dt>
            <dd>
              <time dateTime={w.lastTriggeredAt}>
                {dateLabel(w.lastTriggeredAt)}
              </time>
            </dd>
          </>
        )}
        {w.statusCheckedAt && (
          <>
            <dt className="text-[var(--theme-fg-muted)]">{translate("workbench.statusChecked")}</dt>
            <dd><time dateTime={w.statusCheckedAt}>{dateLabel(w.statusCheckedAt)}</time></dd>
          </>
        )}
      </dl>
      {ambiguous > 0 && (
        <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">
          {ambiguous} {translate("workbench.additional")}{' '}
          {ambiguous === 1 ? translate("workbench.runMatches") : translate("workbench.runsMatch")} {translate("workbench.multipleWatchesExcludedFromThisTotal")}</p>
      )}
      {partial && (
        <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">{coverage}</p>
      )}
      <button
        type="button"
        className="mt-3 flex items-center gap-1 text-xs text-[var(--theme-fg-muted)] hover:text-[var(--theme-fg)]"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {expanded ? translate("workbench.hideDetails") : translate("workbench.showDetails")}
      </button>
      {expanded && (
        <div
          id={detailsId}
          className="mt-3 min-w-0 space-y-2 border-t border-[var(--theme-border)] pt-3"
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-[var(--theme-fg-muted)]">ID</dt>
            <dd className="break-all">
              <code>{w.id}</code>
            </dd>
            <dt className="text-[var(--theme-fg-muted)]">Cron</dt>
            <dd className="break-all">
              <code>{w.cron}</code>
            </dd>
            {w.expiresAt && (
              <>
                <dt className="text-[var(--theme-fg-muted)]">{translate("workbench.expires")}</dt>
                <dd>{dateLabel(w.expiresAt)}</dd>
              </>
            )}
          </dl>
          <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
            {w.prompt}
          </p>
        </div>
      )}
    </article>
  );
}

export function ThreadWatchesControl({ thread }: { thread: ThreadDto }) {
  const { locale: i18nLocale } = useI18n();
  const [snapshot, setSnapshot] = useState<WatchSnapshot>({ watches: [] });
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const refreshRef = useRef<() => void>(() => {});
  const isClaude = thread.provider === 'claude' || thread.agentId === 'claude';
  useEffect(() => {
    setSnapshot({ watches: [] });
    if (!isClaude) return;
    let alive = true;
    let refreshing = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (document.visibilityState === 'hidden' || refreshing) return;
      refreshing = true;
      try {
        const data = await request<WatchSnapshot>(
          `/api/threads/${encodeURIComponent(thread.id)}/watches`,
          { signal: controller.signal, cache: 'no-store' },
        );
        if (alive) setSnapshot(data);
      } catch {
        /* Older runtimes do not advertise native watches. */
      } finally {
        refreshing = false;
      }
    };
    refreshRef.current = () => void refresh();
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      alive = false;
      refreshRef.current = () => {};
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [thread.id, isClaude]);
  useEffect(() => {
    setOpen(false);
  }, [thread.id]);
  if (!snapshot.watches.length) return null;
  const current = snapshot.watches.filter(isCurrent);
  const past = snapshot.watches.filter((w) => !isCurrent(w));
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="matter-watches-toggle"
        aria-label={translate("workbench.watches", { value1: current.length })}
        aria-expanded={open}
        onClick={() => {
          refreshRef.current();
          setOpen(!open);
        }}
        title={translate("workbench.sessionWatches")}
      >
        <Clock3 size={14} />
        <span>{current.length}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="z-[100] max-h-[calc(100dvh-2rem)] gap-3 border-[var(--theme-border)] bg-[var(--theme-panel)] p-4 text-[var(--theme-fg)] sm:max-w-xl sm:p-5"
          overlayClassName="z-[95] bg-[var(--overlay-scrim)] backdrop-blur-sm"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            title.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle ref={title} tabIndex={-1} className="outline-none">
              {translate("workbench.watches_2cb575")}</DialogTitle>
            <DialogDescription className="pr-4 text-xs text-[var(--theme-fg-muted)]">
              {translate("workbench.sessionTimersStopWhenTheClaudeProcess")}{' '}
              {snapshot.timezone}
              <span className="mt-1 block">
                {translate("workbench.totalsIncludeRecordedScheduledTurns")}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-3 overflow-y-auto overscroll-contain max-h-[65dvh]">
            {current.map((w) => (
              <WatchCard key={`${w.id}:${w.createdAt}`} watch={w} />
            ))}
            {past.length > 0 && (
              <details className="min-w-0">
                <summary className="cursor-pointer text-sm text-[var(--theme-fg-muted)]">
                  {translate("workbench.pastWatches")}{past.length})
                </summary>
                <div className="mt-3 space-y-3">
                  {past.map((w) => (
                    <WatchCard key={`${w.id}:${w.createdAt}`} watch={w} />
                  ))}
                </div>
              </details>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
