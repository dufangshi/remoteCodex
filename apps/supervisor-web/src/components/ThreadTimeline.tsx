import {
  ThreadTimeline as SharedThreadTimeline,
  type ThreadTimelineAdapter,
} from '@remote-codex/thread-ui';
import type { ComponentProps } from 'react';

type ThreadTimelineProps = ComponentProps<typeof SharedThreadTimeline>;

export function ThreadTimeline({
  adapter,
  ...props
}: ThreadTimelineProps) {
  const localAdapter: ThreadTimelineAdapter = {
    getImageAssetUrl: ({ threadId, path }) =>
      `/api/threads/${threadId}/assets/image?path=${encodeURIComponent(path)}`,
    onOpenLinkedThread: (threadId) => {
      window.location.assign(`/threads/${threadId}`);
    },
    ...adapter,
  };

  return <SharedThreadTimeline {...props} adapter={localAdapter} />;
}
