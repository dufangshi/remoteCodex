import { ThreadAutomationsControl } from './ThreadAutomationsControl';
import { getLocale, translate, useI18n } from '@remote-codex/thread-ui/i18n';
import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  TokenUsageCost,
  type TokenUsageCostProps,
} from '@remote-codex/thread-ui';
import type { ThreadDto } from '@remote-codex/shared';

export interface NativeWatch {
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
const statusLabel: Record<NativeWatch['status'], string> = {
  get active() {
    return translate('workbench.activeInCurrentSession');
  },
  get unconfirmed() {
    return translate('workbench.statusUnconfirmed');
  },
  get sessionEnded() {
    return translate('workbench.sessionEnded');
  },
  get notScheduled() {
    return translate('workbench.noLongerScheduled');
  },
  get deleted() {
    return translate('workbench.cancelled');
  },
  get expired() {
    return translate('workbench.expired');
  },
  get completed() {
    return translate('workbench.completed');
  },
};
export const isCurrentWatch = (watch: NativeWatch) =>
  watch.status === 'active' || watch.status === 'unconfirmed';
const dateLabel = (date: string | null) =>
  date
    ? new Date(date).toLocaleString(getLocale())
    : translate('workbench.unavailable');

export function NativeWatchCard({ watch: w }: { watch: NativeWatch }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const ambiguous = w.ambiguousTriggerCount ?? 0;
  const count = w.triggerCount;
  const partial = count != null && (w.pricedTriggerCount ?? 0) < count;
  const coverage = partial
    ? t('automation.nativeCoverage', {
        value1: w.pricedTriggerCount ?? 0,
        value2: count,
      })
    : translate('workbench.sumOfCostsReportedByTheRecorded');
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
              {translate('workbench.thisRecordedWatchMayHaveEndedIts')}
            </p>
          )}
        </div>
        <div
          className="shrink-0 text-sm"
          aria-label={translate('workbench.watchTotalCost')}
        >
          {w.priceEstimate || w.tokenUsage ? (
            <TokenUsageCost
              usage={w.tokenUsage ?? null}
              price={w.priceEstimate ?? null}
              costLabel={translate('workbench.watchTotalCost')}
              detailsNote={`${coverage}${ambiguous ? translate('workbench.ambiguousRunsAreExcluded') : ''}`}
              tooltipZIndex={120}
            />
          ) : (
            <span className="text-xs text-[var(--theme-fg-muted)]">
              {translate('workbench.costUnavailable')}
            </span>
          )}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-[var(--theme-fg-muted)]">
          {translate('workbench.created')}
        </dt>
        <dd>
          {w.createdAt ? (
            <time dateTime={w.createdAt}>{dateLabel(w.createdAt)}</time>
          ) : (
            translate('workbench.unavailable')
          )}
        </dd>
        <dt className="text-[var(--theme-fg-muted)]">
          {translate('workbench.triggers')}
        </dt>
        <dd>
          {count == null
            ? translate('workbench.unavailable')
            : count.toLocaleString(getLocale())}
        </dd>
        {w.lastTriggeredAt && (
          <>
            <dt className="text-[var(--theme-fg-muted)]">
              {translate('workbench.lastTriggered')}
            </dt>
            <dd>
              <time dateTime={w.lastTriggeredAt}>
                {dateLabel(w.lastTriggeredAt)}
              </time>
            </dd>
          </>
        )}
        {w.statusCheckedAt && (
          <>
            <dt className="text-[var(--theme-fg-muted)]">
              {translate('workbench.statusChecked')}
            </dt>
            <dd>
              <time dateTime={w.statusCheckedAt}>
                {dateLabel(w.statusCheckedAt)}
              </time>
            </dd>
          </>
        )}
      </dl>
      <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">
        {t('automation.tokens')}:{' '}
        {w.tokenUsage?.totalTokens.toLocaleString(getLocale()) ??
          t('automation.unknown')}
        {count != null && (
          <>
            {' '}
            ·{' '}
            {t('automation.nativeTokenCoverage', {
              value1: w.usageTriggerCount ?? 0,
              value2: count,
            })}
          </>
        )}
      </p>
      {ambiguous > 0 && (
        <p className="mt-2 text-xs text-[var(--theme-fg-muted)]">
          {ambiguous} {translate('workbench.additional')}{' '}
          {ambiguous === 1
            ? translate('workbench.runMatches')
            : translate('workbench.runsMatch')}{' '}
          {translate('workbench.multipleWatchesExcludedFromThisTotal')}
        </p>
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
        {expanded
          ? translate('workbench.hideDetails')
          : translate('workbench.showDetails')}
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
                <dt className="text-[var(--theme-fg-muted)]">
                  {translate('workbench.expires')}
                </dt>
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

/** Compatibility entry point for the thread toolbar: one unified read-only panel. */
export function ThreadWatchesControl({ thread }: { thread: ThreadDto }) {
  return <ThreadAutomationsControl thread={thread} />;
}
