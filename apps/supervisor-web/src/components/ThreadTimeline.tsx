import {
  ThreadTimeline as SharedThreadTimeline,
  type ThreadTimelineAdapter,
} from '@remote-codex/thread-ui';
import type { ComponentProps } from 'react';
import { buildThreadImageAssetUrl } from '../lib/api';

type ThreadTimelineProps = ComponentProps<typeof SharedThreadTimeline> & {
  onLoadHistoryItemDetail?: ThreadTimelineAdapter['onLoadHistoryItemDetail'];
  onOpenThread?: (threadId: string) => void;
};

export function ThreadTimeline({
  adapter,
  onLoadHistoryItemDetail,
  onOpenThread,
  ...props
}: ThreadTimelineProps) {
  const localAdapter: ThreadTimelineAdapter = {
    getImageAssetUrl: ({ threadId, path }) =>
      buildThreadImageAssetUrl(threadId, { path }),
    onOpenLinkedThread:
      onOpenThread ??
      ((threadId) => {
        window.location.assign(`/threads/${threadId}`);
      }),
    ...(onLoadHistoryItemDetail
      ? { onLoadHistoryItemDetail }
      : {}),
    ...adapter,
  };

  return <SharedThreadTimeline {...props} adapter={localAdapter} />;
}
