import { useEffect, useRef, useState } from 'react';
import { Workflow } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  TokenUsageCost,
  type TokenUsageCostProps,
} from '@remote-codex/thread-ui';
import { useI18n, type TranslationKey } from '@remote-codex/thread-ui/i18n';
import type {
  AutomationDto,
  AutomationRunDto,
  AutomationTrigger,
  ThreadDto,
} from '@remote-codex/shared';
import { request } from '../lib/api';
import {
  NativeWatchCard,
  isCurrentWatch,
  type NativeWatch,
} from './ThreadWatchesControl';

const button =
  'rounded border border-[var(--theme-border)] px-2.5 py-1.5 text-xs hover:bg-[var(--theme-bg)]';
const knownStates = new Set([
  'enabled',
  'paused',
  'cancelled',
  'due',
  'queued',
  'running',
  'completed',
  'failed',
  'interrupted',
  'timedOut',
  'uncertain',
  'conditionSkipped',
  'loopSkipped',
  'skipped',
]);
const currentAutomation = (a: AutomationDto) =>
  a.state === 'enabled' &&
  (a.definition.trigger.kind !== 'at' ||
    a.nextRunAt != null ||
    a.pendingCount > 0 ||
    (a.statistics?.runningActionCount ?? 0) > 0);

/** Add only attributed known values; coverage remains explicit alongside the sum. */
export function automationTotals(
  items: AutomationDto[],
  watches: NativeWatch[],
) {
  const entries = [
    ...items.map((a) => ({
      count: a.statistics?.triggerCount,
      usage: a.statistics?.tokenUsage,
      price: a.statistics?.priceEstimate,
    })),
    ...watches.map((w) => ({
      count: w.triggerCount,
      usage: w.tokenUsage,
      price: w.priceEstimate,
    })),
  ];
  const usage = {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
  const price = {
    totalUsd: 0,
    inputUsd: 0,
    cachedInputUsd: 0,
    cacheWriteInputUsd: 0,
    outputUsd: 0,
  };
  let triggers = 0,
    unknownCounts = 0,
    usageCount = 0,
    priceCount = 0;
  for (const entry of entries) {
    if (entry.count == null) unknownCounts++;
    else triggers += entry.count;
    if (entry.usage) {
      usageCount++;
      for (const key of Object.keys(usage) as (keyof typeof usage)[])
        usage[key] += entry.usage[key] ?? 0;
    }
    if (entry.price) {
      priceCount++;
      for (const key of Object.keys(price) as (keyof typeof price)[])
        price[key] += entry.price[key] ?? 0;
    }
  }
  // Native ambiguous matches cannot be deduplicated across watch cards here.
  // Keep the confirmed sum and mark the thread trigger total incomplete.
  unknownCounts += Number(
    watches.some((w) => (w.ambiguousTriggerCount ?? 0) > 0),
  );
  return {
    triggers,
    unknownCounts,
    usage: usageCount || !entries.length ? usage : null,
    price: priceCount || !entries.length ? price : null,
  };
}

function Usage({
  usage,
  price,
  note,
}: {
  usage?: TokenUsageCostProps['usage'];
  price?: TokenUsageCostProps['price'];
  note?: string;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span>
        {t('automation.tokens')}:{' '}
        {usage?.totalTokens.toLocaleString(locale) ?? t('automation.unknown')}
      </span>
      <span>
        {t('automation.cost')}:{' '}
        {usage || price ? (
          <TokenUsageCost
            usage={usage ?? null}
            price={price ?? null}
            costLabel={t('automation.cost')}
            detailsNote={note ?? ''}
            tooltipZIndex={120}
          />
        ) : (
          t('automation.unknown')
        )}
      </span>
    </div>
  );
}

function AutomationCard({
  automation: a,
  threadId,
}: {
  automation: AutomationDto;
  threadId: string;
}) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [runs, setRuns] = useState<AutomationRunDto[]>([]);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const base = `/api/threads/${encodeURIComponent(threadId)}/automations/${encodeURIComponent(a.id)}`;
  const date = (v: string | null) =>
    v ? new Date(v).toLocaleString(locale) : t('automation.none');
  const state = (v: string) =>
    knownStates.has(v) ? t(`automation.${v}` as TranslationKey) : v;
  const triggerLabel = (v: AutomationTrigger) =>
    v.kind === 'interval'
      ? t('automation.intervalSummary', { value1: v.everySeconds })
      : v.kind === 'at'
        ? date(v.at)
        : v.kind === 'threadEnded'
          ? `${t('automation.threadEnded')} · ${v.sourceThreadId}`
          : `${t(`automation.${v.kind}`)} · ${v.kind === 'turnEnded' ? v.turnId : v.kind === 'taskEnded' ? `#${v.taskNumber}` : (v.commandKey ?? v.commandId)}`;
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    let refreshing = false;
    const update = async () => {
      if (refreshing || document.visibilityState === 'hidden') return;
      refreshing = true;
      try {
        const data = await request<{ runs: AutomationRunDto[] }>(
          `${base}/runs`,
          { signal: controller.signal, cache: 'no-store' },
        );
        if (!controller.signal.aborted) {
          setRuns(data.runs);
          setError('');
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(String(e instanceof Error ? e.message : e));
      } finally {
        refreshing = false;
      }
    };
    void update();
    const timer = window.setInterval(() => void update(), 3000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [expanded, base]);
  const s = a.statistics;
  const coverage = s
    ? t('automation.coverage', {
        value1: s.usageTurnCount,
        value2: s.pricedTurnCount,
        value3: s.promptTurnCount,
      })
    : t('automation.unknownStatistics');
  return (
    <article className="min-w-0 space-y-2 rounded-lg border border-[var(--theme-border)] p-3">
      <div className="flex justify-between gap-3">
        <strong className="break-words">{a.definition.name}</strong>
        <span className="shrink-0 text-xs">{state(a.state)}</span>
      </div>
      <p className="break-words text-sm">
        {triggerLabel(a.definition.trigger)} →{' '}
        {t(`automation.${a.definition.action.kind}`)}
      </p>
      <p className="text-xs text-[var(--theme-fg-muted)]">
        {t('automation.device')} · {t('automation.next')}: {date(a.nextRunAt)}
      </p>
      <p className="text-xs">
        {t('automation.triggers')}:{' '}
        {s?.triggerCount.toLocaleString(locale) ?? t('automation.unknown')} ·{' '}
        {t('automation.pending')}: {a.pendingCount} · {t('automation.merged')}:{' '}
        {a.missedCount}
      </p>
      <Usage usage={s?.tokenUsage} price={s?.priceEstimate} note={coverage} />
      {a.definition.action.kind === 'prompt' ? (
        <>
          <p className="text-xs text-[var(--theme-fg-muted)]">{coverage}</p>
          {s &&
            s.ambiguousTurnCount + s.missingTurnCount + s.unattributedRunCount >
              0 && (
              <p className="text-xs text-[var(--theme-fg-muted)]">
                {t('automation.incomplete', {
                  value1: s.ambiguousTurnCount,
                  value2: s.missingTurnCount,
                  value3: s.unattributedRunCount,
                })}
              </p>
            )}
        </>
      ) : (
        <p className="text-xs text-[var(--theme-fg-muted)]">
          {t(
            a.definition.action.kind === 'runScript'
              ? 'automation.scriptCharge'
              : 'automation.inboxCharge',
          )}
        </p>
      )}
      {a.error && (
        <p className="break-words text-xs" role="status">
          {t('automation.error')}: {a.error}
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-xs">
          {t('automation.definition')}
        </summary>
        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(a.definition, null, 2)}
        </pre>
      </details>
      <button
        type="button"
        className={button}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {t('automation.history')}
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-[var(--theme-border)] pt-2">
          <p className="text-xs text-[var(--theme-fg-muted)]">
            {t('automation.historyLimit')} {t('automation.queuedNote')}
          </p>
          {error && (
            <p role="alert" className="break-words text-xs">
              {error}
            </p>
          )}
          {!runs.length && <p className="text-xs">{t('automation.noRuns')}</p>}
          {runs.map((r) => (
            <section
              key={r.id}
              className="space-y-1 rounded bg-[var(--theme-bg)] p-2 text-xs"
            >
              <strong>{state(r.state)}</strong> · {t('automation.merged')}:{' '}
              {r.missedCount}
              <p>
                {t('automation.scheduled')}: {date(r.scheduledAt)}
              </p>
              <p>
                {t('automation.started')}: {date(r.startedAt)} ·{' '}
                {t('automation.finished')}: {date(r.completedAt)}
              </p>
              {r.turnId && (
                <p className="break-all">
                  {t('automation.turn')}: {r.turnId}
                </p>
              )}
              {r.error && (
                <p className="break-words" role="status">
                  {r.error}
                </p>
              )}
              {r.commandId && (
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    void request<Record<string, unknown>>(
                      `/api/threads/${encodeURIComponent(threadId)}/commands/${encodeURIComponent(r.commandId!)}`,
                    )
                      .then((v) =>
                        setOutput(
                          [String(v.stdout ?? ''), String(v.stderr ?? '')]
                            .filter(Boolean)
                            .join('\n') || t('automation.none'),
                        ),
                      )
                      .catch((e) => setError(String(e.message ?? e)));
                  }}
                >
                  {t('automation.output')}
                </button>
              )}
            </section>
          ))}
          {output && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">
              {output}
            </pre>
          )}
        </div>
      )}
    </article>
  );
}

export function ThreadAutomationsControl({ thread }: { thread: ThreadDto }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AutomationDto[]>([]);
  const [watches, setWatches] = useState<NativeWatch[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [nativeUnavailable, setNativeUnavailable] = useState(false);
  const [timezone, setTimezone] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const refreshRef = useRef<() => void>(() => {});
  const isClaude = thread.provider === 'claude' || thread.agentId === 'claude';
  useEffect(() => {
    setOpen(false);
    setItems([]);
    setWatches([]);
    setError('');
    setTimezone('');
    setLoading(true);
    setNativeUnavailable(false);
  }, [thread.id]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let refreshing = false;
    const update = async () => {
      if (document.visibilityState === 'hidden' || refreshing) return;
      refreshing = true;
      const results = await Promise.allSettled([
        request<{ automations: AutomationDto[] }>(
          `/api/threads/${encodeURIComponent(thread.id)}/automations`,
          { signal: controller.signal, cache: 'no-store' },
        ),
        ...(isClaude
          ? [
              request<{ watches: NativeWatch[]; timezone?: string }>(
                `/api/threads/${encodeURIComponent(thread.id)}/watches`,
                { signal: controller.signal, cache: 'no-store' },
              ),
            ]
          : []),
      ]);
      if (!controller.signal.aborted) {
        const rules = results[0];
        if (rules.status === 'fulfilled' && 'automations' in rules.value) {
          setItems(rules.value.automations);
          setError('');
        } else if (rules.status === 'rejected')
          setError(String(rules.reason?.message ?? rules.reason));
        const native = results[1];
        if (native?.status === 'fulfilled' && 'watches' in native.value) {
          setWatches(native.value.watches);
          setTimezone(native.value.timezone ?? '');
          setNativeUnavailable(false);
        } else if (native?.status === 'rejected') setNativeUnavailable(true);
        setLoading(false);
      }
      refreshing = false;
    };
    refreshRef.current = () => void update();
    void update();
    const timer = window.setInterval(() => void update(), 3000);
    document.addEventListener('visibilitychange', update);
    return () => {
      controller.abort();
      refreshRef.current = () => {};
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [open, thread.id, isClaude]);
  const totals = automationTotals(items, watches);
  const unknownEmpty =
    !items.length && !watches.length && Boolean(error || nativeUnavailable);
  const active = items.filter(currentAutomation);
  const historical = items.filter((a) => !currentAutomation(a));
  const currentWatches = watches.filter(isCurrentWatch);
  const pastWatches = watches.filter((w) => !isCurrentWatch(w));
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="matter-watches-toggle"
        aria-label={t('automation.title')}
        title={t('automation.title')}
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Workflow size={14} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="z-[100] max-h-[calc(100dvh-2rem)] overflow-y-auto border-[var(--theme-border)] bg-[var(--theme-panel)] text-[var(--theme-fg)] sm:max-w-2xl"
          overlayClassName="z-[95] bg-[var(--overlay-scrim)]"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            title.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle ref={title} tabIndex={-1} className="outline-none">
              {t('automation.title')}
            </DialogTitle>
            <DialogDescription>{t('automation.description')}</DialogDescription>
          </DialogHeader>
          {error && (
            <p
              role="alert"
              className="break-words rounded border border-red-500 p-2 text-sm"
            >
              {error}
            </p>
          )}
          {nativeUnavailable && (
            <p role="status" className="text-xs">
              {t('automation.nativeUnavailable')}
            </p>
          )}
          <button
            type="button"
            className={button}
            onClick={() => refreshRef.current()}
          >
            {t('automation.refresh')}
          </button>
          {loading ? (
            <p className="text-sm">{t('automation.loading')}</p>
          ) : (
            <>
              <section
                aria-label={t('automation.totals')}
                className="space-y-2 rounded-lg border border-[var(--theme-border)] p-3"
              >
                <strong className="text-sm">{t('automation.totals')}</strong>
                <p className="text-sm">
                  {t('automation.triggers')}: {totals.triggers.toLocaleString()}
                  {totals.unknownCounts || error || nativeUnavailable
                    ? ` + ${t('automation.unknown')}`
                    : ''}
                </p>
                <Usage
                  usage={unknownEmpty ? null : totals.usage}
                  price={unknownEmpty ? null : totals.price}
                  note={t('automation.totalCoverage')}
                />
                <p className="text-xs text-[var(--theme-fg-muted)]">
                  {t('automation.totalCoverage')}{' '}
                  {t('automation.triggerSemantics')}
                </p>
              </section>
              {!items.length &&
                !watches.length &&
                !error &&
                !nativeUnavailable && (
                  <p className="text-sm">{t('automation.empty')}</p>
                )}
              {(active.length > 0 || currentWatches.length > 0) && (
                <section
                  className="min-w-0 space-y-3"
                  aria-label={t('automation.active')}
                >
                  <h3 className="text-sm font-semibold">
                    {t('automation.active')}
                  </h3>
                  {active.map((a) => (
                    <AutomationCard
                      key={a.id}
                      automation={a}
                      threadId={thread.id}
                    />
                  ))}
                  {currentWatches.map((w) => (
                    <NativeWatchCard key={`${w.id}:${w.createdAt}`} watch={w} />
                  ))}
                </section>
              )}
              {(historical.length > 0 || pastWatches.length > 0) && (
                <details className="min-w-0">
                  <summary className="cursor-pointer text-sm">
                    {t('automation.historical')} (
                    {historical.length + pastWatches.length})
                  </summary>
                  <div className="mt-3 space-y-3">
                    {historical.map((a) => (
                      <AutomationCard
                        key={a.id}
                        automation={a}
                        threadId={thread.id}
                      />
                    ))}
                    {pastWatches.map((w) => (
                      <NativeWatchCard
                        key={`${w.id}:${w.createdAt}`}
                        watch={w}
                      />
                    ))}
                  </div>
                </details>
              )}
              {watches.length > 0 && (
                <p className="text-xs text-[var(--theme-fg-muted)]">
                  {t('automation.native')} {timezone}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
