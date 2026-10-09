import { getLocale, translate, useI18n } from '@remote-codex/thread-ui/i18n';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  ChevronRight,
  Clock3,
  RefreshCw,
  X,
} from 'lucide-react';
import { TokenUsageCost } from '@remote-codex/thread-ui';
import type {
  NativeSubagentDetailDto,
  NativeSubagentDto,
  ThreadDetailDto,
  ThreadSubagentDto,
} from '@remote-codex/shared';
import { request } from '../lib/api';

function statusLabel(status: string) {
  switch (status) {
    case 'running':
      return translate('workbench.running');
    case 'failed':
      return translate('workbench.failed');
    case 'interrupted':
      return translate('workbench.interrupted');
    case 'completed':
      return translate('workbench.completed');
    default:
      return translate('workbench.unavailable');
  }
}
function dateLabel(date: string | null | undefined) {
  return date ? new Date(date).toLocaleString(getLocale()) : '—';
}
function fallbackAgent(
  agent: ThreadSubagentDto,
  provider: string,
): NativeSubagentDto {
  return {
    ...agent,
    provider,
    nativeSessionId: null,
    model: null,
    prompt: null,
    updatedAt: agent.startedAt,
    latestActivity: null,
    tokenUsage: null,
    priceEstimate: null,
    activityCount: 0,
    detailsAvailable: false,
  };
}

export function ThreadSubagentsControl({
  detail,
}: {
  detail: ThreadDetailDto;
}) {
  useI18n();
  const provider =
    detail.thread.provider === 'acp'
      ? (detail.thread.agentId ?? '')
      : detail.thread.provider;
  const [agents, setAgents] = useState<NativeSubagentDto[] | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [inspect, setInspect] = useState<NativeSubagentDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const listButtons = useRef(new Map<string, HTMLButtonElement>());
  const fallback = detail.activeSubagents ?? [];
  const rows = [...(agents ?? [])];
  for (const active of fallback) {
    if (
      !rows.some(
        (agent) =>
          agent.id === active.id || agent.parentToolCallId === active.id,
      )
    )
      rows.push(fallbackAgent(active, provider));
  }
  const running = rows.filter((agent) => agent.status === 'running').length;
  const threadId = detail.thread.id;

  useEffect(() => {
    setOpen(false);
    setSelected(null);
    setInspect(null);
    setAgents(null);
    setDiscovering(false);
    setError(null);
  }, [threadId]);
  useEffect(() => {
    if (!['codex', 'claude'].includes(provider) && !fallback.length) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function load() {
      const activeController = new AbortController();
      controller = activeController;
      let more = false;
      let nativeWorking = false;
      try {
        if (document.visibilityState !== 'hidden') {
          if (selected && open) {
            const result = await request<NativeSubagentDetailDto>(
              `/api/threads/${encodeURIComponent(threadId)}/subagents/${encodeURIComponent(selected)}`,
              { signal: activeController.signal },
            );
            if (!stopped && !activeController.signal.aborted) {
              setInspect(result);
              setError(null);
              setAgents(
                (current) =>
                  current?.map((agent) =>
                    agent.id === result.agent.id ? result.agent : agent,
                  ) ?? [result.agent],
              );
            }
          } else {
            const result = await request<{
              agents: NativeSubagentDto[];
              refreshing?: boolean;
            }>(`/api/threads/${encodeURIComponent(threadId)}/subagents`, {
              signal: activeController.signal,
            });
            more = result.refreshing === true;
            nativeWorking = result.agents.some(
              (agent) => agent.status === 'running',
            );
            if (!stopped && !activeController.signal.aborted) {
              setAgents(result.agents);
              setDiscovering(more);
              setError(null);
            }
          }
        }
      } catch (cause) {
        if (!stopped && !activeController.signal.aborted && selected && open)
          setError(
            cause instanceof Error
              ? cause.message
              : translate('workbench.subagentLoadFailed'),
          );
      }
      // Refresh while open or working; idle pages don't repeatedly reread native history.
      if (
        !stopped &&
        !activeController.signal.aborted &&
        (more ||
          nativeWorking ||
          open ||
          ['running', 'recovering'].includes(detail.thread.status) ||
          fallback.length > 0)
      )
        timer = setTimeout(load, 3000);
    }
    const onVisible = () => {
      if (document.visibilityState !== 'hidden') {
        clearTimeout(timer);
        controller?.abort();
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [
    threadId,
    provider,
    detail.thread.status,
    fallback.length,
    selected,
    open,
    refresh,
  ]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key === 'Tab') {
        const controls = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], [tabindex="0"]',
          ) ?? [],
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      (previous?.isConnected ? previous : trigger.current)?.focus();
    };
  }, [open]);

  const current = inspect?.agent.id === selected ? inspect : null;
  const agent = current?.agent ?? rows.find((agent) => agent.id === selected);
  function back() {
    const id = selected;
    setSelected(null);
    setInspect(null);
    setError(null);
    requestAnimationFrame(() => id && listButtons.current.get(id)?.focus());
  }
  function select(id: string) {
    setSelected(id);
    setInspect(null);
    setError(null);
  }
  if (!rows.length && !open && !discovering) return null;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="matter-watches-toggle"
        aria-label={translate('workbench.subagents', { value1: running })}
        aria-expanded={open}
        title={translate('workbench.nativeSubagents')}
        onClick={() => setOpen((value) => !value)}
      >
        <Bot size={14} />
        {rows.length > 0 && <span>{running || rows.length}</span>}
      </button>
      {open && (
        <div className="native-agents-overlay">
          <button
            className="native-agents-scrim"
            aria-label={translate('workbench.closeSubagents')}
            onClick={() => setOpen(false)}
          />
          <section
            ref={dialog}
            role="dialog"
            aria-modal="true"
            aria-label={translate('workbench.nativeSubagents')}
            className="native-agents-dialog"
          >
            <header className="native-agents-header">
              {selected && (
                <button
                  type="button"
                  className="native-agents-icon"
                  aria-label={translate('workbench.subagentBack')}
                  onClick={back}
                >
                  <ArrowLeft size={18} />
                </button>
              )}
              <div className="native-agents-heading">
                <h2>
                  {selected
                    ? agent?.name || translate('workbench.subagentDetails')
                    : translate('workbench.nativeSubagents')}
                </h2>
                <span>
                  {selected
                    ? `${agent?.provider ?? provider}${agent?.model ? ` · ${agent.model}` : ''}`
                    : translate('workbench.subagentCounts', {
                        running,
                        total: rows.length,
                      })}
                </span>
              </div>
              <button
                type="button"
                className="native-agents-icon"
                aria-label={translate('workbench.subagentRefresh')}
                title={translate('workbench.subagentRefresh')}
                onClick={() => setRefresh((value) => value + 1)}
              >
                <RefreshCw size={16} />
              </button>
              <button
                type="button"
                className="native-agents-icon"
                aria-label={translate('workbench.closeSubagentsDialog')}
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="native-agents-body">
              {error && (
                <div role="alert" className="native-agents-notice">
                  {error}
                </div>
              )}
              {!selected ? (
                <div className="native-agents-list">
                  {rows.length === 0 && (
                    <p className="native-agents-empty">
                      {translate('workbench.noNativeAgents')}
                    </p>
                  )}
                  {rows.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      ref={(button) => {
                        if (button) listButtons.current.set(agent.id, button);
                        else listButtons.current.delete(agent.id);
                      }}
                      className="native-agents-row"
                      onClick={() => select(agent.id)}
                    >
                      <div className="native-agents-row-main">
                        <div className="native-agents-row-title">
                          <strong>{agent.name || agent.id}</strong>
                          <span
                            className="native-agents-status"
                            data-status={agent.status}
                          >
                            {agent.isBackground && agent.status === 'running'
                              ? translate('workbench.runningInBackground')
                              : statusLabel(agent.status)}
                          </span>
                        </div>
                        <p>
                          {agent.latestActivity ||
                            agent.prompt ||
                            agent.nativeSessionId ||
                            agent.id}
                        </p>
                        <div className="native-agents-row-meta">
                          <span>{agent.provider}</span>
                          {agent.tokenUsage && (
                            <span>
                              {new Intl.NumberFormat(getLocale(), {
                                notation: 'compact',
                              }).format(
                                agent.tokenUsage.total.totalTokens,
                              )}{' '}
                              tok
                            </span>
                          )}
                          {agent.updatedAt && (
                            <span title={dateLabel(agent.updatedAt)}>
                              <Clock3 size={11} />
                              {new Date(agent.updatedAt).toLocaleTimeString(
                                getLocale(),
                                {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                },
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                agent && (
                  <>
                    <div className="native-agents-overview">
                      <span
                        className="native-agents-status"
                        data-status={agent.status}
                      >
                        {statusLabel(agent.status)}
                      </span>
                      <span>
                        {translate('workbench.subagentSteps', {
                          value1: agent.activityCount,
                        })}
                      </span>
                    </div>
                    <div className="native-agents-metrics">
                      <div>
                        <span>{translate('workbench.subagentUsage')}</span>
                        {agent.tokenUsage ? (
                          <div className="native-agents-cost">
                            <strong>
                              {new Intl.NumberFormat(getLocale()).format(
                                agent.tokenUsage.total.totalTokens,
                              )}{' '}
                              tok
                            </strong>
                            <TokenUsageCost
                              usage={agent.tokenUsage.total}
                              price={agent.priceEstimate}
                              tooltipZIndex={110}
                            />
                          </div>
                        ) : (
                          <strong>—</strong>
                        )}
                        {!agent.priceEstimate && (
                          <small>
                            {translate('workbench.subagentCostUnknown')}
                          </small>
                        )}
                      </div>
                      <div>
                        <span>{translate('workbench.subagentLastUpdate')}</span>
                        <strong>{dateLabel(agent.updatedAt)}</strong>
                        <small>
                          {translate('workbench.subagentStarted', {
                            value1: dateLabel(agent.startedAt),
                          })}
                        </small>
                      </div>
                    </div>
                    {agent.prompt && (
                      <div className="native-agents-task">
                        <span>{translate('workbench.subagentTask')}</span>
                        <p>{agent.prompt}</p>
                      </div>
                    )}
                    <div className="native-agents-activity">
                      <h3>{translate('workbench.subagentActivity')}</h3>
                      {!current && !error ? (
                        <p className="native-agents-empty">
                          {translate('workbench.subagentLoading')}
                        </p>
                      ) : current?.items.length ? (
                        <>
                          {current.hasEarlierItems && (
                            <p className="native-agents-notice">
                              {translate('workbench.subagentRecentActivity')}
                            </p>
                          )}
                          {current.items.map((item) => (
                            <article key={item.id}>
                              <div>
                                <span>
                                  {item.kind === 'agentMessage'
                                    ? translate('workbench.subagentMessage')
                                    : translate('workbench.subagentTool')}
                                </span>
                                <time title={dateLabel(item.createdAt)}>
                                  {item.createdAt
                                    ? new Date(
                                        item.createdAt,
                                      ).toLocaleTimeString(getLocale())
                                    : '—'}
                                </time>
                                <span>
                                  {statusLabel(item.status ?? 'completed')}
                                </span>
                              </div>
                              <pre>{item.text}</pre>
                            </article>
                          ))}
                        </>
                      ) : (
                        <p className="native-agents-empty">
                          {translate('workbench.subagentTranscriptUnavailable')}
                        </p>
                      )}
                    </div>
                  </>
                )
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
