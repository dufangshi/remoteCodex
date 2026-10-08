import { useEffect, useRef, useState } from 'react';
import { Workflow } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@remote-codex/thread-ui';
import { useI18n, type TranslationKey } from '@remote-codex/thread-ui/i18n';
import type {
  AutomationDefinition,
  AutomationDto,
  AutomationRunDto,
  AutomationTrigger,
  AutomationAction,
  ThreadDto,
} from '@remote-codex/shared';
import { request } from '../lib/api';

const field =
  'w-full rounded border border-[var(--theme-border)] bg-[var(--theme-bg)] px-2 py-1.5 text-sm';
const button =
  'rounded border border-[var(--theme-border)] px-2.5 py-1.5 text-xs hover:bg-[var(--theme-bg)] disabled:opacity-50';
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

export function ThreadAutomationsControl({ thread }: { thread: ThreadDto }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AutomationDto[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string | null>(null);
  const [runs, setRuns] = useState<AutomationRunDto[]>([]);
  const [output, setOutput] = useState('');
  const createRequest = useRef<{ signature: string; id: string } | null>(null);
  const base = `/api/threads/${encodeURIComponent(thread.id)}/automations`;
  const date = (v: string | null) =>
    v ? new Date(v).toLocaleString(locale) : t('automation.none');
  const state = (v: string) =>
    knownStates.has(v) ? t(`automation.${v}` as TranslationKey) : v;
  const refresh = async (signal?: AbortSignal) => {
    const v = await request<{ automations: AutomationDto[] }>(base, {
      cache: 'no-store',
      signal: signal ?? null,
    });
    if (signal?.aborted) return;
    setItems(v.automations);
    if (history) {
      const data = await request<{ runs: AutomationRunDto[] }>(
        `${base}/${history}/runs`,
        { signal: signal ?? null },
      );
      if (!signal?.aborted) setRuns(data.runs);
    }
  };
  useEffect(() => {
    setItems([]);
    setOpen(false);
    setHistory(null);
    setCreating(false);
    setError('');
  }, [thread.id]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const controller = new AbortController();
    const update = () => {
      if (document.visibilityState !== 'hidden')
        void refresh(controller.signal).catch((e) => {
          if (alive) setError(String(e.message ?? e));
        });
    };
    update();
    const timer = window.setInterval(update, 3000);
    return () => {
      alive = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [open, thread.id, history]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const triggerLabel = (v: AutomationTrigger) =>
    v.kind === 'interval'
      ? t('automation.intervalSummary', { value1: v.everySeconds })
      : v.kind === 'at'
        ? date(v.at)
        : v.kind === 'threadEnded'
          ? `${t('automation.threadEnded')} · ${v.sourceThreadId}`
          : `${t(`automation.${v.kind}`)} · ${v.kind === 'turnEnded' ? v.turnId : v.kind === 'taskEnded' ? `#${v.taskNumber}` : (v.commandKey ?? v.commandId)}`;
  return (
    <>
      <button
        type="button"
        className="matter-watches-toggle"
        aria-label={t('automation.title')}
        title={t('automation.title')}
        onClick={() => setOpen(true)}
      >
        <Workflow size={14} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="z-[100] max-h-[calc(100dvh-2rem)] overflow-y-auto border-[var(--theme-border)] bg-[var(--theme-panel)] text-[var(--theme-fg)] sm:max-w-2xl"
          overlayClassName="z-[95] bg-[var(--overlay-scrim)]"
        >
          <DialogHeader>
            <DialogTitle>{t('automation.title')}</DialogTitle>
            <DialogDescription>
              {t('automation.description')} {t('automation.native')}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p
              role="alert"
              className="break-words rounded border border-red-500 p-2 text-sm"
            >
              {error}
            </p>
          )}
          {creating ? (
            <AutomationForm
              threadId={thread.id}
              busy={busy}
              onBack={() => setCreating(false)}
              onPreview={async (d) =>
                await request(base + '/preview', {
                  method: 'POST',
                  body: JSON.stringify(d),
                })
              }
              onSave={(d) =>
                act(async () => {
                  // Keep the acceptance identity when a response is lost. Include
                  // the target so a form cannot reuse it for a different thread.
                  const signature = JSON.stringify({
                    threadId: thread.id,
                    definition: d,
                  });
                  if (createRequest.current?.signature !== signature) {
                    createRequest.current = {
                      signature,
                      id: crypto.randomUUID(),
                    };
                  }
                  const pending = createRequest.current;
                  await request(base, {
                    method: 'POST',
                    body: JSON.stringify({
                      definition: d,
                      clientRequestId: pending.id,
                    }),
                  });
                  if (createRequest.current === pending)
                    createRequest.current = null;
                  setCreating(false);
                })
              }
            />
          ) : (
            <>
              <div className="flex gap-2">
                <button className={button} onClick={() => setCreating(true)}>
                  {t('automation.create')}
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void act(() => refresh())}
                >
                  {t('automation.refresh')}
                </button>
              </div>
              {!items.length && (
                <p className="text-sm">{t('automation.empty')}</p>
              )}
              {items.map((a) => (
                <article
                  key={a.id}
                  className="min-w-0 space-y-2 rounded-lg border border-[var(--theme-border)] p-3"
                >
                  <div className="flex justify-between gap-3">
                    <strong className="break-words">{a.definition.name}</strong>
                    <span className="shrink-0 text-xs">{state(a.state)}</span>
                  </div>
                  <p className="break-words text-sm">
                    {triggerLabel(a.definition.trigger)} →{' '}
                    {t(`automation.${a.definition.action.kind}`)}
                  </p>
                  <p className="text-xs text-[var(--theme-fg-muted)]">
                    {t('automation.device')} · {t('automation.next')}:{' '}
                    {date(a.nextRunAt)}
                  </p>
                  <p className="text-xs">
                    {t('automation.pending')}: {a.pendingCount} ·{' '}
                    {t('automation.merged')}: {a.missedCount}
                  </p>
                  {a.error && (
                    <p className="break-words text-xs" role="status">
                      {t('automation.error')}: {a.error}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {a.state !== 'cancelled' && (
                      <>
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              request(
                                `${base}/${a.id}/${a.state === 'enabled' ? 'pause' : 'resume'}`,
                                { method: 'POST' },
                              ),
                            )
                          }
                        >
                          {t(
                            a.state === 'enabled'
                              ? 'automation.pause'
                              : 'automation.resume',
                          )}
                        </button>
                        <button
                          className={button}
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              request(`${base}/${a.id}/cancel`, {
                                method: 'POST',
                              }),
                            )
                          }
                        >
                          {t('automation.cancel')}
                        </button>
                      </>
                    )}
                    <button
                      className={button}
                      onClick={() => {
                        setHistory(history === a.id ? null : a.id);
                        setRuns([]);
                        setOutput('');
                      }}
                    >
                      {t('automation.history')}
                    </button>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-xs">
                      {t('automation.definition')}
                    </summary>
                    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(a.definition, null, 2)}
                    </pre>
                  </details>
                  {history === a.id && (
                    <div className="space-y-2 border-t border-[var(--theme-border)] pt-2">
                      <p className="text-xs text-[var(--theme-fg-muted)]">
                        {t('automation.queuedNote')}
                      </p>
                      {!runs.some((r) => r.automationId === a.id) && (
                        <p className="text-xs">{t('automation.noRuns')}</p>
                      )}
                      {runs
                        .filter((r) => r.automationId === a.id)
                        .map((r) => (
                          <section
                            key={r.id}
                            className="space-y-1 rounded bg-[var(--theme-bg)] p-2 text-xs"
                          >
                            <strong>{state(r.state)}</strong> ·{' '}
                            {t('automation.merged')}: {r.missedCount}
                            <p>
                              {t('automation.scheduled')}: {date(r.scheduledAt)}
                            </p>
                            <p>
                              {t('automation.started')}: {date(r.startedAt)} ·{' '}
                              {t('automation.finished')}: {date(r.completedAt)}
                            </p>
                            {r.error && (
                              <p className="break-words" role="status">
                                {r.error}
                              </p>
                            )}
                            {r.commandId && (
                              <button
                                className={button}
                                onClick={() =>
                                  void act(async () => {
                                    const v = await request<
                                      Record<string, unknown>
                                    >(
                                      `/api/threads/${encodeURIComponent(thread.id)}/commands/${r.commandId}`,
                                    );
                                    setOutput(
                                      [
                                        String(v.stdout ?? ''),
                                        String(v.stderr ?? ''),
                                      ]
                                        .filter(Boolean)
                                        .join('\n') || t('automation.none'),
                                    );
                                  })
                                }
                              >
                                {t('automation.output')}
                              </button>
                            )}
                          </section>
                        ))}
                      {output && (
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">
                          {output}
                        </pre>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AutomationForm({
  threadId,
  busy,
  onSave,
  onPreview,
  onBack,
}: {
  threadId: string;
  busy: boolean;
  onSave: (d: AutomationDefinition) => Promise<void>;
  onPreview: (d: AutomationDefinition) => Promise<unknown>;
  onBack: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<AutomationTrigger['kind']>('interval');
  const [action, setAction] = useState<AutomationAction['kind']>('prompt');
  const [seconds, setSeconds] = useState(3600);
  const [at, setAt] = useState('');
  const [source, setSource] = useState(threadId);
  const [sourceId, setSourceId] = useState('');
  const [success, setSuccess] = useState(true);
  const [text, setText] = useState('');
  const [subject, setSubject] = useState('');
  const [argv, setArgv] = useState('["/bin/sh", "scripts/check.sh"]');
  const [shell, setShell] = useState(false);
  const [cwd, setCwd] = useState('.');
  const [timeout, setTimeoutSeconds] = useState(60);
  const [replay, setReplay] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [raw, setRaw] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const definition = (): AutomationDefinition => {
    if (advanced) return JSON.parse(raw);
    const sourceTrigger: AutomationTrigger =
      trigger === 'interval'
        ? { kind: trigger, everySeconds: seconds }
        : trigger === 'at'
          ? { kind: trigger, at: new Date(at).toISOString() }
          : trigger === 'threadEnded'
            ? { kind: trigger, sourceThreadId: source }
            : trigger === 'turnEnded'
              ? { kind: trigger, sourceThreadId: source, turnId: sourceId }
              : trigger === 'taskEnded'
                ? {
                    kind: trigger,
                    rootThreadId: source,
                    taskNumber: Number(sourceId),
                  }
                : {
                    kind: trigger,
                    sourceThreadId: source,
                    commandKey: sourceId,
                  };
    const command = shell
      ? { shell: argv, argv: [], cwd, timeoutSeconds: timeout }
      : { argv: JSON.parse(argv), cwd, timeoutSeconds: timeout };
    return {
      name,
      trigger: sourceTrigger,
      action:
        action === 'prompt'
          ? { kind: action, text }
          : action === 'notifyInbox'
            ? {
                kind: action,
                subject,
                text,
                messageKind: 'result',
                includeClosingMessage: true,
              }
            : { kind: action, ...command },
      condition:
        trigger === 'interval' || trigger === 'at' || !success
          ? { kind: 'all', conditions: [] }
          : trigger === 'commandEnded'
            ? { kind: 'exitCodeEquals', value: 0 }
            : { kind: 'statusIn', values: ['completed'] },
      replayExisting: trigger === 'threadEnded' ? false : replay,
    };
  };
  const submit = async (save: boolean) => {
    setError('');
    try {
      const d = definition();
      if (save) await onSave(d);
      else setPreview(JSON.stringify(await onPreview(d), null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const label = (key: TranslationKey, input: React.ReactNode) => (
    <label className="block space-y-1 text-xs">
      <span>{t(key)}</span>
      {input}
    </label>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(true);
      }}
    >
      <label className="flex gap-2 text-xs">
        <input
          type="checkbox"
          checked={advanced}
          onChange={(e) => {
            if (e.target.checked && !raw) {
              try {
                setRaw(JSON.stringify(definition(), null, 2));
              } catch {
                setRaw('{}');
              }
            }
            setAdvanced(e.target.checked);
          }}
        />
        {t('automation.advanced')}
      </label>
      {advanced ? (
        <>
          <p className="text-xs">{t('automation.advancedNote')}</p>
          {label(
            'automation.advanced',
            <textarea
              className={field + ' h-72 font-mono'}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />,
          )}
        </>
      ) : (
        <>
          {label(
            'automation.name',
            <input
              required
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />,
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {label(
              'automation.trigger',
              <select
                className={field}
                value={trigger}
                onChange={(e) => {
                  setTrigger(e.target.value as AutomationTrigger['kind']);
                  setSourceId('');
                  if (e.target.value === 'threadEnded') {
                    setSource('');
                    setReplay(false);
                  }
                }}
              >
                {(
                  [
                    'interval',
                    'at',
                    'threadEnded',
                    'turnEnded',
                    'taskEnded',
                    'commandEnded',
                  ] as const
                ).map((k) => (
                  <option key={k} value={k}>
                    {t(`automation.${k}`)}
                  </option>
                ))}
              </select>,
            )}
            {label(
              'automation.action',
              <select
                className={field}
                value={action}
                onChange={(e) =>
                  setAction(e.target.value as AutomationAction['kind'])
                }
              >
                {(['prompt', 'notifyInbox', 'runScript'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`automation.${k}`)}
                  </option>
                ))}
              </select>,
            )}
          </div>
          {trigger === 'interval' ? (
            label(
              'automation.seconds',
              <input
                required
                type="number"
                min="1"
                className={field}
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
              />,
            )
          ) : trigger === 'at' ? (
            label(
              'automation.date',
              <input
                required
                type="datetime-local"
                className={field}
                value={at}
                onChange={(e) => setAt(e.target.value)}
              />,
            )
          ) : (
            <>
              {label(
                trigger === 'taskEnded'
                  ? 'automation.root'
                  : 'automation.source',
                <input
                  required
                  className={field}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                />,
              )}
              {trigger !== 'threadEnded' &&
                label(
                  trigger === 'turnEnded'
                    ? 'automation.turn'
                    : trigger === 'taskEnded'
                      ? 'automation.task'
                      : 'automation.commandKey',
                  <input
                    required
                    className={field}
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                  />,
                )}
              {label(
                'automation.condition',
                <select
                  className={field}
                  value={success ? 'success' : 'any'}
                  onChange={(e) => setSuccess(e.target.value === 'success')}
                >
                  <option value="success">{t('automation.success')}</option>
                  <option value="any">{t('automation.anyTerminal')}</option>
                </select>,
              )}
              {trigger === 'threadEnded' ? (
                <p className="text-xs text-[var(--theme-fg-muted)]">
                  {t('automation.threadEndedNote')}
                </p>
              ) : (
                <label className="flex gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={replay}
                    onChange={(e) => setReplay(e.target.checked)}
                  />
                  {t('automation.replay')}
                </label>
              )}
            </>
          )}
          {action === 'runScript' ? (
            <>
              <label className="flex gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={shell}
                  onChange={(e) => {
                    setShell(e.target.checked);
                    setArgv(e.target.checked ? '' : '[]');
                  }}
                />
                {t('automation.shell')}
              </label>
              {label(
                shell ? 'automation.shell' : 'automation.argv',
                <textarea
                  required
                  className={field + ' font-mono'}
                  value={argv}
                  onChange={(e) => setArgv(e.target.value)}
                />,
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {label(
                  'automation.cwd',
                  <input
                    required
                    className={field}
                    value={cwd}
                    onChange={(e) => setCwd(e.target.value)}
                  />,
                )}
                {label(
                  'automation.timeout',
                  <input
                    type="number"
                    min="1"
                    max="300"
                    className={field}
                    value={timeout}
                    onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                  />,
                )}
              </div>
              <p className="text-xs text-[var(--theme-fg-muted)]">
                {t('automation.scriptNote')}
              </p>
            </>
          ) : (
            <>
              {action === 'notifyInbox' &&
                label(
                  'automation.subject',
                  <input
                    required
                    className={field}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />,
                )}
              {label(
                'automation.text',
                <textarea
                  required={action === 'prompt'}
                  className={field}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />,
              )}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="break-words text-sm">
          {error}
        </p>
      )}
      {preview && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">
          {preview}
        </pre>
      )}
      <div className="flex gap-2">
        <button type="button" className={button} onClick={onBack}>
          {t('automation.back')}
        </button>
        <button
          type="button"
          className={button}
          disabled={busy}
          onClick={() => void submit(false)}
        >
          {t('automation.preview')}
        </button>
        <button type="submit" className={button} disabled={busy}>
          {t('automation.save')}
        </button>
      </div>
    </form>
  );
}
