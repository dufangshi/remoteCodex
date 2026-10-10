import { ThreadAutomationsControl } from './ThreadAutomationsControl';
import { getLocale, translate, useI18n } from '@pockymoe/thread-ui/i18n';
import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  TokenUsageCost,
  type TokenUsageCostProps,
} from '@pockymoe/thread-ui';
import type { ThreadDto } from '@pockymoe/shared';

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
    <article className="automation-rule">
      <div className="automation-rule-heading">
        <strong>{w.schedule}</strong>
        <span className={`automation-state is-${w.status}`}>
          <i />
          {statusLabel[w.status]}
        </span>
      </div>
      <p className="automation-native-prompt">{w.prompt}</p>
      <div className="automation-rule-meta">
        <span>
          {translate('workbench.triggers')}:{' '}
          {count?.toLocaleString(getLocale()) ?? '—'}
        </span>
        {w.lastTriggeredAt && (
          <span>
            {translate('workbench.lastTriggered')}:{' '}
            <time dateTime={w.lastTriggeredAt}>
              {dateLabel(w.lastTriggeredAt)}
            </time>
          </span>
        )}
      </div>
      <div className="automation-rule-usage">
        <span>
          {t('automation.tokenMetric')}:{' '}
          {w.tokenUsage?.totalTokens.toLocaleString(getLocale()) ?? '—'}
        </span>
        <span aria-label={translate('workbench.watchTotalCost')}>
          {w.priceEstimate || w.tokenUsage ? (
            <TokenUsageCost
              usage={w.tokenUsage ?? null}
              price={w.priceEstimate ?? null}
              costLabel={translate('workbench.watchTotalCost')}
              detailsNote={`${coverage}${ambiguous ? translate('workbench.ambiguousRunsAreExcluded') : ''}`}
              tooltipZIndex={120}
            />
          ) : (
            '—'
          )}
        </span>
        {(partial || ambiguous > 0) && (
          <span className="automation-inline-quality">
            {t('automation.partial')}
          </span>
        )}
      </div>
      <button
        type="button"
        className="automation-native-details"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {expanded
          ? translate('workbench.hideDetails')
          : translate('workbench.showDetails')}
      </button>
      {expanded && (
        <div
          id={detailsId}
          className="mt-3 min-w-0 space-y-2 border-t border-[var(--theme-border)] pt-3 text-xs text-[var(--theme-fg-muted)]"
        >
          {w.status === 'unconfirmed' && (
            <p>{translate('workbench.thisRecordedWatchMayHaveEndedIts')}</p>
          )}
          {partial && <p>{coverage}</p>}
          {count != null && (
            <p>
              {t('automation.nativeTokenCoverage', {
                value1: w.usageTriggerCount ?? 0,
                value2: count,
              })}
            </p>
          )}
          {ambiguous > 0 && (
            <p>
              {ambiguous} {translate('workbench.additional')}{' '}
              {ambiguous === 1
                ? translate('workbench.runMatches')
                : translate('workbench.runsMatch')}{' '}
              {translate('workbench.multipleWatchesExcludedFromThisTotal')}
            </p>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt>ID</dt>
            <dd className="break-all">
              <code>{w.id}</code>
            </dd>
            <dt>Cron</dt>
            <dd className="break-all">
              <code>{w.cron}</code>
            </dd>
            <dt>{translate('workbench.created')}</dt>
            <dd>{dateLabel(w.createdAt)}</dd>
            {w.statusCheckedAt && (
              <>
                <dt>{translate('workbench.statusChecked')}</dt>
                <dd>{dateLabel(w.statusCheckedAt)}</dd>
              </>
            )}
            {w.expiresAt && (
              <>
                <dt>{translate('workbench.expires')}</dt>
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
