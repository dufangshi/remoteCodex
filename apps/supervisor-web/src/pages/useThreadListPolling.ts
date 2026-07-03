import { useCallback, useEffect, useRef } from 'react';

import type { ThreadDto } from '@remote-codex/shared';
import type { Dispatch, SetStateAction } from 'react';
import { fetchThreads } from '../lib/api';

export const THREAD_LIST_POLL_INTERVAL_MS = 5_000;

function stableStringify(value: unknown) {
  return JSON.stringify(value);
}

function areThreadDtosEquivalent(left: ThreadDto, right: ThreadDto) {
  return stableStringify(left) === stableStringify(right);
}

export function mergeThreadListSnapshot(
  current: ThreadDto[],
  next: ThreadDto[],
) {
  const currentById = new Map(current.map((thread) => [thread.id, thread]));
  let changed = current.length !== next.length;
  const merged = next.map((nextThread, index) => {
    const currentThread = currentById.get(nextThread.id);
    if (
      currentThread &&
      areThreadDtosEquivalent(currentThread, nextThread)
    ) {
      if (current[index]?.id !== nextThread.id) {
        changed = true;
      }
      return currentThread;
    }

    changed = true;
    return nextThread;
  });

  return changed ? merged : current;
}

export function useThreadListPolling(input: {
  enabled: boolean;
  setThreads: Dispatch<SetStateAction<ThreadDto[]>>;
  intervalMs?: number;
}) {
  const { enabled, setThreads, intervalMs = THREAD_LIST_POLL_INTERVAL_MS } = input;
  const inFlightRef = useRef(false);

  const refreshThreads = useCallback(async () => {
    if (!enabled || inFlightRef.current) {
      return;
    }

    if (
      typeof document !== 'undefined' &&
      document.visibilityState === 'hidden'
    ) {
      return;
    }

    inFlightRef.current = true;
    try {
      const nextThreads = await fetchThreads();
      setThreads((current) => mergeThreadListSnapshot(current, nextThreads));
    } catch {
      // Keep the existing room list stable; the next poll can recover.
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled, setThreads]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshThreads();
    }, intervalMs);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void refreshThreads();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [enabled, intervalMs, refreshThreads]);
}
