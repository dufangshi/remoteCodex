import { useEffect } from 'react';
import { fetchThreadTurnDetail } from '../lib/api';
import { useScopedState } from '../pages/useScopedState';
import { nativeSummaries } from '../pages/workbenchNativeModel';
import { threadStatusLabel } from '@pockymoe/thread-ui';
import {
  formatDate,
  translate as t,
  useI18n,
} from '@pockymoe/thread-ui/i18n';
import type {
  ThreadDetailDto,
  ThreadDto,
  ThreadTurnDto,
} from '@pockymoe/shared';

export function WorkbenchCollaboration({
  detail,
  threads,
  onCompare,
  onOpen,
  onNativeResult,
  visible,
  sourceKey,
  liveItems,
}: {
  detail: ThreadDetailDto | null;
  threads: ThreadDto[];
  onCompare: (id: string) => void;
  onOpen: (id: string) => void;
  visible: boolean;
  sourceKey: string;
  liveItems: ThreadDetailDto['liveItems'];
  onNativeResult: (target: { turnId: string; itemId: string }) => void;
}) {
  useI18n();
  const root = detail?.thread.rootThreadId ?? detail?.thread.id;
  const family = threads.filter(
    (thread) =>
      thread.id !== detail?.thread.id &&
      (thread.id === root || thread.rootThreadId === root),
  );
  const [history, setHistory] = useScopedState<ThreadTurnDto[]>(
    sourceKey,
    [],
  );
  const [historyError, setHistoryError] = useScopedState<string | null>(
    sourceKey,
    null,
  );
  const historyKey =
    detail?.turns
      .slice(-3)
      .map((turn) => `${turn.id}:${turn.status}:${turn.completedAt ?? ''}`)
      .join('|') ?? '';
  useEffect(() => {
    if (!visible || !detail) return;
    let alive = true;
    void Promise.all(
      detail.turns
        .slice(-3)
        .map((turn) => fetchThreadTurnDetail(detail.thread.id, turn.id)),
    )
      .then((turns) => {
        if (alive) {
          setHistory(turns);
          setHistoryError(null);
        }
      })
      .catch((caught) => {
        if (alive)
          setHistoryError(
            caught instanceof Error ? caught.message : String(caught),
          );
      });
    return () => {
      alive = false;
    };
  }, [visible, sourceKey, historyKey, setHistory, setHistoryError]);
  const agents = nativeSummaries(detail, history, liveItems);
  return (
    <>
      <p>{t('workbench.summaryScope')}</p>
      <section>
        <h3>
          {t('workbench.managedThreads')} · {family.length}
        </h3>
        {family.length ? (
          family.map((thread) => (
            <article key={thread.id} data-testid="managed-summary">
              <header>
                <strong>{thread.title}</strong>
                <span data-status={thread.status}>
                  {thread.status === 'idle' && thread.lastTurnCompletedAt
                    ? t('workbench.completed')
                    : threadStatusLabel(thread.status)}
                </span>
              </header>
              {thread.lastError && <p>{thread.lastError}</p>}
              <p>
                {t('workbench.lastActivity')} · {formatDate(thread.updatedAt)}
              </p>
              <footer>
                <button onClick={() => onOpen(thread.id)}>
                  {t('workbench.openResult')}
                </button>
                <button onClick={() => onCompare(thread.id)}>
                  {t('workbench.compareResult')}
                </button>
              </footer>
            </article>
          ))
        ) : (
          <p>{t('workbench.noManagedThreads')}</p>
        )}
      </section>
      <section>
        <h3>
          {t('workbench.nativeAgents')} · {agents.length}
        </h3>
        {historyError && (
          <p role="status">
            {t('workbench.statusUnavailable')} · {historyError}
          </p>
        )}
        {agents.length ? (
          agents.map((agent) => {
            const resultTurn = agent.parentToolCallId
              ? detail?.turns.find((turn) =>
                  turn.items.some((item) => item.id === agent.parentToolCallId),
                )
              : undefined;
            const target =
              agent.target ??
              (resultTurn && agent.parentToolCallId
                ? { turnId: resultTurn.id, itemId: agent.parentToolCallId }
                : null);
            return (
              <article key={agent.id} data-testid="native-summary">
                <header>
                  <strong>{agent.name ?? agent.id}</strong>
                  <span data-status={agent.status}>
                    {agent.status === 'completed'
                      ? t('workbench.completed')
                      : agent.status === 'failed'
                        ? t('workbench.failed')
                        : agent.status === 'running'
                          ? t('workbench.running')
                          : agent.status === 'interrupted'
                            ? t('workbench.interrupted')
                            : t('workbench.statusUnavailable')}
                  </span>
                </header>
                <p>
                  {agent.id}
                  {agent.completedAt
                    ? ` · ${formatDate(agent.completedAt)}`
                    : ''}
                </p>
                {target && (
                  <footer>
                    <button onClick={() => onNativeResult(target)}>
                      {t('workbench.openResult')}
                    </button>
                  </footer>
                )}
              </article>
            );
          })
        ) : (
          <p>{t('workbench.noNativeAgents')}</p>
        )}
      </section>
    </>
  );
}
