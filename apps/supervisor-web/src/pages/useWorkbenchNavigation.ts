import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThreadDetailDto, ThreadDto } from '@remote-codex/shared';
import type {
  WorkbenchNotification,
  WorkbenchThread,
} from '@remote-codex/thread-ui';
import { ApiError, relayModeActive, request } from '../lib/api';
import { threadHref } from '../lib/relayRoutes';

interface ThreadReference {
  deviceId: string | null;
  threadId: string;
  title: string;
  workspaceLabel: string;
  workspaceId?: string;
  deviceName?: string;
  favorite: boolean;
  visitedAt: string;
  readCompletedAt?: string | null;
}
type ThreadActivity = { status: string; lastTurnCompletedAt?: string | null };
export function workbenchThreadStatus(activity: ThreadActivity | undefined, readCompletedAt?: string | null) {
  if (!activity) return 'unknown';
  if (['running', 'inProgress', 'recovering'].includes(activity.status)) return 'running';
  if (['failed', 'error', 'system_error'].includes(activity.status)) return 'failed';
  if (['unknown', 'not_loaded'].includes(activity.status)) return 'unknown';
  if (activity.status === 'interrupted') return 'interrupted';
  if (activity.lastTurnCompletedAt && (!readCompletedAt || Date.parse(activity.lastTurnCompletedAt) > Date.parse(readCompletedAt))) return 'unread';
  return 'idle';
}
interface NavigationSnapshot {
  threads: ThreadReference[];
  notifications: WorkbenchNotification[];
}
const LOCAL_KEY = 'remote-codex.local-workbench.v1';
const referenceKey = (r: { deviceId: string | null; threadId: string }) =>
  `${r.deviceId ?? 'local'}:${r.threadId}`;
function loadLocal(): NavigationSnapshot {
  try {
    const value = JSON.parse(
      localStorage.getItem(LOCAL_KEY) ?? '{}',
    ) as NavigationSnapshot;
    return {
      threads: Array.isArray(value.threads) ? value.threads : [],
      notifications: Array.isArray(value.notifications)
        ? value.notifications
        : [],
    };
  } catch {
    return { threads: [], notifications: [] };
  }
}

export function useWorkbenchNavigation(
  detail: ThreadDetailDto | null,
  threads: ThreadDto[],
  deviceId: string | null,
) {
  const relay = relayModeActive();
  const [snapshot, setSnapshot] = useState<NavigationSnapshot>({
    threads: [],
    notifications: [],
  });
  const [statuses, setStatuses] = useState<Record<string, ThreadActivity>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [navigationReady, setNavigationReady] = useState(false);
  const [readAt, setReadAt] = useState(Date.now());
  const revision = useRef(0);
  const currentKey = `${deviceId ?? 'local'}:${detail?.thread.id ?? ''}`;
  const current = useRef(detail);
  current.current = detail;
  const threadId = detail?.thread.id;

  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const controller = new AbortController();
    setSnapshot({ threads: [], notifications: [] });
    setNavigationReady(false);
    async function refresh() {
      if (inFlight || document.visibilityState === 'hidden') return;
      inFlight = true;
      const startedAtRevision = revision.current;
      try {
        const next = relay
          ? await request<NavigationSnapshot>('/relay/account/workbench', {
              signal: controller.signal,
            })
          : loadLocal();
        if (!alive) return;
        if (startedAtRevision === revision.current) { setSnapshot(next); setNavigationReady(true); }
        setError(null);
        if (relay) {
          // Explicit device + thread paths: never switch the browser's selected device to poll.
          const pending = next.threads.filter((r) => r.deviceId !== deviceId);
          const updates: Record<string, ThreadActivity> = {};
          await Promise.all(
            Array.from({ length: Math.min(6, pending.length) }, async () => {
              while (alive && pending.length) {
                const r = pending.shift()!;
                try {
                  const value = await request<ThreadDetailDto>(
                    `/relay/devices/${encodeURIComponent(r.deviceId!)}/api/threads/${encodeURIComponent(r.threadId)}?view=summary&limit=1`,
                    {
                      signal: AbortSignal.any([
                        controller.signal,
                        AbortSignal.timeout(5000),
                      ]),
                    },
                  );
                  updates[referenceKey(r)] = value.thread;
                } catch {
                  updates[referenceKey(r)] = { status: 'unknown' };
                }
              }
            }),
          );
          if (alive) setStatuses(updates);
        }
      } catch (e) {
        if (alive)
          setError(
            e instanceof Error ? e.message : 'Navigation could not refresh.',
          );
      } finally {
        inFlight = false;
      }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('storage', onVisible);
    return () => {
      alive = false;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('storage', onVisible);
    };
  }, [relay, deviceId]);

  const save = useCallback(
    async (favorite?: boolean, markRead = false) => {
      const value = current.current;
      if (!value) return;
      const writeRevision = ++revision.current;
      const reference = {
        deviceId,
        threadId: value.thread.id,
        title: value.thread.title,
        workspaceId: value.thread.workspaceId,
        workspaceLabel: value.workspace.label,
        ...(favorite !== undefined ? { favorite } : {}),
        ...(markRead && value.thread.lastTurnCompletedAt ? { readCompletedAt: value.thread.lastTurnCompletedAt } : {}),
      };
      if (relay) {
        const next = await request<NavigationSnapshot>(
          '/relay/account/workbench',
          { method: 'POST', body: JSON.stringify(reference) },
        );
        if (writeRevision === revision.current) { setSnapshot(next); setNavigationReady(true); }
      } else {
        const next = loadLocal();
        const previous = next.threads.find(
          (t) => referenceKey(t) === referenceKey(reference),
        );
        const record: ThreadReference = {
          ...reference,
          favorite: favorite ?? previous?.favorite ?? false,
          visitedAt: new Date().toISOString(),
          readCompletedAt: reference.readCompletedAt ?? previous?.readCompletedAt ?? null,
        };
        next.threads = [
          record,
          ...next.threads.filter(
            (t) => referenceKey(t) !== referenceKey(record),
          ),
        ].slice(0, 100);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
        setSnapshot(next);
        setNavigationReady(true);
      }
    },
    [deviceId, relay],
  );
  useEffect(() => {
    if (!threadId) return;
    const visit = () => {
      if (document.visibilityState === 'hidden' || !document.hasFocus()) return;
      void save(undefined, true).catch((e) =>
      setError(
        e instanceof ApiError ? e.message : 'Could not save recent thread.',
      ),
    );
    };
    visit();
    window.addEventListener('focus', visit);
    document.addEventListener('visibilitychange', visit);
    return () => {
      window.removeEventListener('focus', visit);
      document.removeEventListener('visibilitychange', visit);
    };
  }, [threadId, detail?.thread.title, detail?.thread.lastTurnCompletedAt, save]);

  const favorite =
    snapshot.threads.find((t) => referenceKey(t) === currentKey)?.favorite ??
    false;
  const toggleFavorite = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await save(!favorite);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save shortcut.');
    } finally {
      setBusy(false);
    }
  };
  const refs = [...snapshot.threads];
  if (detail && !refs.some((r) => referenceKey(r) === currentKey))
    refs.unshift({
      deviceId,
      threadId: detail.thread.id,
      title: detail.thread.title,
      workspaceLabel: detail.workspace.label,
      favorite: false,
      visitedAt: new Date().toISOString(),
    });
  const items: WorkbenchThread[] = refs.map((r) => {
    const local =
      r.deviceId === deviceId
        ? (r.threadId === detail?.thread.id ? detail.thread : threads.find((t) => t.id === r.threadId))
        : undefined;
    return {
      key: referenceKey(r),
      title: local?.title ?? r.title,
      subtitle: [r.deviceName, r.workspaceLabel].filter(Boolean).join(' · '),
      href: threadHref(r.threadId, r.deviceId),
      favorite: r.favorite,
      status: workbenchThreadStatus(local ?? statuses[referenceKey(r)], r.readCompletedAt),
    };
  });
  const localNotifications: WorkbenchNotification[] = relay
    ? []
    : threads
        .filter((t) => t.lastTurnCompletedAt)
        .map((t) => ({
          id: `${t.id}:${t.lastTurnCompletedAt}`,
          title: `${t.title} ${t.status === 'failed' ? 'failed' : 'completed'}`,
          href: threadHref(t.id),
          occurredAt: t.lastTurnCompletedAt!,
        }))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const notifications = relay ? snapshot.notifications : localNotifications;
  return {
    navigationReady,
    threads: items,
    currentKey,
    favorite,
    favoriteBusy: busy,
    error,
    onToggleFavorite: () => void toggleFavorite(),
    notifications,
    unreadCount: notifications.filter((n) => Date.parse(n.occurredAt) > readAt)
      .length,
    onReadNotifications: () => setReadAt(Date.now()),
  };
}
