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
    let timer: ReturnType<typeof setTimeout> | undefined;
    setSnapshot(null);
    setError('');
    async function refresh() {
      try {
        const response = await fetch(`/relay/public-links/${encodeURIComponent(id ?? '')}`, {
          signal: controller.signal,
          credentials: 'omit',
          cache: 'no-store',
        });
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? 'This share link is unavailable or has been revoked.'
              : 'Unable to load this shared thread.',
          );
        const value: PublicTranscriptSnapshot = await response.json();
        if (controller.signal.aborted) return;
        setSnapshot(value);
        setError('');
        if (value.live) timer = setTimeout(refresh, 5000);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSnapshot(null);
          setError(error instanceof Error ? error.message : 'Unable to load this shared thread.');
          timer = setTimeout(refresh, 5000);
        }
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
      robots.remove();
    };
  }, [id]);
  useEffect(() => {
    if (!snapshot) return;
    const previous = document.documentElement.getAttribute(
      'data-theme-effective',
    );
    document.documentElement.setAttribute(
      'data-theme-effective',
      snapshot.theme ?? 'dark',
    );
    return () => {
      if (previous)
        document.documentElement.setAttribute('data-theme-effective', previous);
      else document.documentElement.removeAttribute('data-theme-effective');
    };
  }, [snapshot]);
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
