import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ThreadDetailDto,
  ThreadEventEnvelope,
} from '@remote-codex/shared';
import { fetchThreadDetail } from '../lib/api';
import { prependTurns } from './threadDetailModel';
import { useScopedState } from './useScopedState';

/** Uses the host's existing socket. This controller has no composer, execution mutations, auto-resume or read/ack side effects. */
export function useWorkbenchReference(device: string, threadId: string | null) {
  const source = `${device}:${threadId ?? ''}`;
  const [detail, setDetail] = useScopedState<ThreadDetailDto | null>(
    source,
    null,
  );
  const [error, setError] = useScopedState<string | null>(source, null);
  const [loadingEarlier, setLoadingEarlier] = useScopedState(source, false);
  const requestOwner = useRef({ source });
  if (requestOwner.current.source !== source) requestOwner.current = { source };
  const owner = requestOwner.current;
  const inFlight = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const detailRef = useRef(detail);
  detailRef.current = detail;
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!threadId) return;
    let alive = true;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    inFlight.current = false;
    async function refresh() {
      if (!alive || pending) return;
      pending = true;
      try {
        const next = await fetchThreadDetail(threadId!, { limit: 3 });
        if (!alive || requestOwner.current !== owner) return;
        setDetail((current) =>
          current
            ? {
                ...next,
                turns: prependTurns(
                  next.turns,
                  current.turns.filter(
                    (turn) => !next.turns.some((t) => t.id === turn.id),
                  ),
                ),
              }
            : next,
        );
        setError(null);
      } catch (caught) {
        if (alive && requestOwner.current === owner)
          setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        pending = false;
      }
    }
    refreshRef.current = () => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          void refresh();
        }, 250);
    };
    void refresh();
    const interval = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, 3000);
    return () => {
      alive = false;
      clearInterval(interval);
      clearTimeout(timer);
      refreshRef.current = () => {};
    };
  }, [threadId, owner, revision, setDetail, setError]);
  const onEvent = useCallback(
    (event: ThreadEventEnvelope) => {
      if (event.threadId === threadId) refreshRef.current();
    },
    [threadId],
  );
  const loadEarlier = useCallback(async () => {
    const current = detailRef.current;
    if (!threadId || !current?.turns.length || inFlight.current) return;
    inFlight.current = true;
    setLoadingEarlier(true);
    try {
      const next = await fetchThreadDetail(threadId, {
        limit: 3,
        beforeTurnId: current.turns[0]!.id,
      });
      if (requestOwner.current !== owner) return;
      setDetail((value) =>
        value
          ? { ...value, turns: prependTurns(value.turns, next.turns) }
          : value,
      );
    } catch (caught) {
      if (requestOwner.current === owner)
        setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (requestOwner.current === owner) {
        inFlight.current = false;
        setLoadingEarlier(false);
      }
    }
  }, [threadId, owner, setDetail, setError, setLoadingEarlier]);
  return {
    detail,
    error,
    onEvent,
    loadEarlier,
    loadingEarlier,
    retry: () => setRevision((r) => r + 1),
  };
}
