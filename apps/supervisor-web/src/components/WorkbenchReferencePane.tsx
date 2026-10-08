import { useMemo } from 'react';
import { ThreadTimeline, ThreadComposer, type ThreadComposerProps } from '@remote-codex/thread-ui';
import { translate as t, useI18n } from '@remote-codex/thread-ui/i18n';
import {
  buildThreadImageAssetUrl,
  fetchThreadHistoryItemDetail,
  fetchThreadTurnDetail,
} from '../lib/api';
import type { useWorkbenchReference } from '../pages/useWorkbenchReference';
import { resolveThreadContextUsage } from '../pages/threadDetailModel';

export function WorkbenchReferencePane({
  controller,
  onOpenThread,
  draft, onDraftChange, sendShortcut,
}: {
  controller: ReturnType<typeof useWorkbenchReference>;
  onOpenThread: (id: string) => void;
  draft: { prompt: string; attachments: NonNullable<ThreadComposerProps['draftAttachments']> };
  onDraftChange: ThreadComposerProps['onDraftChange'];
  sendShortcut: ThreadComposerProps['sendShortcut'];
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
          {!detail && <p>{t('workbench.referenceUnavailable')}</p>}
          <p>{error}</p>
          <button onClick={retry}>{t('workbench.retryReference')}</button>
        </div>
      )}
      {detail ? (
        <>
          <ThreadTimeline
            key={detail.thread.id}
            threadId={detail.thread.id}
            turns={detail.turns}
            totalTurnCount={detail.totalTurnCount ?? detail.turns.length}
            activeTurnId={detail.thread.activeTurnId}
            threadRunning={detail.thread.status === 'running'}
            liveOutput=""
            liveItems={detail.liveItems ?? null}
            pendingRequests={detail.pendingRequests}
            respondingRequestId={controller.respondingRequestId}
            {...(controller.canControl ? { onRespondToRequest: controller.respond } : {})}
            pendingSteers={detail.pendingSteers ?? []}
            answeredRequestNotes={detail.answeredRequestNotes ?? []}
            activityNotes={detail.activityNotes ?? []}
            onLoadEarlier={loadEarlier}
            loadingEarlier={loadingEarlier}
            adapter={adapter}
            className="thread-timeline-surface min-h-0 flex-1"
          />
          <div className="workbench-composer-target" title={detail.thread.id}>
            {t('workbench.replyToSession', { title: detail.thread.title })}
            <span>{t('workbench.secondaryToolsHint')}</span>
          </div>
          <ThreadComposer
            key={detail.thread.id}
            activeView="chat"
            sendShortcut={sendShortcut ?? 'ctrlEnter'}
            busy={controller.busy}
            settingsBusy={controller.busy}
            error={null}
            shellAvailable={false}
            model={detail.thread.model}
            agentLabel={detail.thread.agentId ?? detail.thread.provider}
            reasoningEffort={detail.thread.reasoningEffort}
            collaborationMode={detail.thread.collaborationMode}
            sandboxMode={detail.thread.sandboxMode ?? null}
            fastMode={detail.thread.fastMode ?? false}
            modelOptions={controller.models}
            contextUsage={resolveThreadContextUsage(detail)}
            capabilities={controller.capabilities ? {
              ...controller.capabilities,
              turns: { ...controller.capabilities.turns, compact: false },
              branching: { ...controller.capabilities.branching, fork: false, resumeAt: false, forkAt: false },
              controls: { ...controller.capabilities.controls, goals: false },
              management: { ...controller.capabilities.management, skills: false, mcpStatus: false, hooks: false, hostConfigFiles: false },
            } : null}
            threadConnected={detail.thread.isLoaded}
            disabled={Boolean(controller.disabledReason)}
            disabledPlaceholder={controller.disabledReason ?? undefined}
            draftPrompt={draft.prompt}
            draftAttachments={draft.attachments}
            onDraftChange={onDraftChange}
            onSubmit={controller.send}
            canInterrupt={Boolean(controller.canControl && detail.thread.activeTurnId)}
            pendingPrompts={(detail.pendingSteers ?? []).filter(item => item.delivery !== 'steer').map(item => ({ id: item.id, prompt: item.prompt }))}
            {...(controller.canControl ? {
              onInterrupt: async () => { await controller.interrupt(); },
              onUpdateSettings: async input => { await controller.updateSettings(input); },
              onCancelPendingPrompt: async queueId => { await controller.cancelQueued(queueId); },
              ...(controller.capabilities?.turns.steer ? { onSteerPendingPrompt: async (queueId: string) => { await controller.steerQueued(queueId); } } : {}),
            } : {})}
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
