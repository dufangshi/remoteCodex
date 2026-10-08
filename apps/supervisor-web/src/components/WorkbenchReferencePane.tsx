import { useMemo } from 'react';
import { ThreadTimeline, threadStatusLabel } from '@remote-codex/thread-ui';
import { translate as t, useI18n } from '@remote-codex/thread-ui/i18n';
import {
  buildThreadImageAssetUrl,
  fetchThreadHistoryItemDetail,
  fetchThreadTurnDetail,
} from '../lib/api';
import type { useWorkbenchReference } from '../pages/useWorkbenchReference';

export function WorkbenchReferencePane({
  controller,
  onOpenThread,
}: {
  controller: ReturnType<typeof useWorkbenchReference>;
  onOpenThread: (id: string) => void;
}) {
  useI18n();
  const { detail, error, loadEarlier, loadingEarlier, retry } = controller;
  const threadId = detail?.thread.id;
  const adapter = useMemo(
    () => ({
      getImageAssetUrl: ({
        threadId,
        path,
      }: {
        threadId: string;
        path: string;
      }) => buildThreadImageAssetUrl(threadId, { path }),
      onLoadHistoryItemDetail: (itemId: string) =>
        fetchThreadHistoryItemDetail(threadId!, itemId),
      onLoadTurnDetail: (turnId: string) =>
        fetchThreadTurnDetail(threadId!, turnId),
      onOpenLinkedThread: onOpenThread,
    }),
    [threadId, onOpenThread],
  );
  return (
    <>
      {error && (
        <div className="workbench-reference-status" role="status">
          <p>{t('workbench.referenceUnavailable')}</p>
          <p>{error}</p>
          <button onClick={retry}>{t('workbench.retryReference')}</button>
        </div>
      )}
      {detail ? (
        <>
          <p className="workbench-reference-status">
            {detail.pendingRequests.length > 0
              ? `${t('workbench.awaitingInput')} · ${detail.pendingRequests.length} · `
              : ''}
            {detail.workspace.label} ·{' '}
            {detail.thread.agentId ?? detail.thread.provider} ·{' '}
            {threadStatusLabel(detail.thread.status)}
          </p>
          <ThreadTimeline
            key={detail.thread.id}
            threadId={detail.thread.id}
            turns={detail.turns}
            totalTurnCount={detail.totalTurnCount ?? detail.turns.length}
            activeTurnId={detail.thread.activeTurnId}
            threadRunning={detail.thread.status === 'running'}
            liveOutput=""
            liveItems={detail.liveItems ?? null}
            pendingRequests={[]}
            answeredRequestNotes={detail.answeredRequestNotes ?? []}
            activityNotes={detail.activityNotes ?? []}
            onLoadEarlier={loadEarlier}
            loadingEarlier={loadingEarlier}
            adapter={adapter}
            className="thread-timeline-surface min-h-0 flex-1"
          />
        </>
      ) : (
        !error && (
          <p className="workbench-reference-status">
            {t('workbench.loadingThreadDetail')}
          </p>
        )
      )}
    </>
  );
}
