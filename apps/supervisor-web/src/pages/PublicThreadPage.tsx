import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  PublicTranscript,
  type PublicTranscriptSnapshot,
} from '@remote-codex/thread-ui';

export function PublicThreadPage() {
  const { id } = useParams();
  const [snapshot, setSnapshot] = useState<PublicTranscriptSnapshot | null>(
    null,
  );
  const [error, setError] = useState('');
  useEffect(() => {
    const robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow, noarchive';
    document.head.appendChild(robots);
    const controller = new AbortController();
    setSnapshot(null);
    setError('');
    fetch(`/relay/public-links/${encodeURIComponent(id ?? '')}`, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? 'This share link is unavailable or has been revoked.'
              : 'Unable to load this shared thread.',
          );
        return response.json();
      })
      .then(setSnapshot)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => {
      controller.abort();
      robots.remove();
    };
  }, [id]);
  return (
    <div className="thread-ui-shell public-thread-page min-h-screen bg-[var(--theme-bg)] text-[var(--theme-fg)]">
      {snapshot ? (
        <PublicTranscript snapshot={snapshot} />
      ) : (
        <p role="status" className="p-8 text-center">
          {error || 'Loading shared thread…'}
        </p>
      )}
    </div>
  );
}
