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
  const [notificationDetails, setNotificationDetails] = useState<Record<string, { title: string; summary: string }>>({});
  const [notificationsOpened, setNotificationsOpened] = useState(0);
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
    async (favorite?: boolean, markRead = false, target?: ThreadReference) => {
      const value = current.current;
      if (!value && !target) return;
      const writeRevision = ++revision.current;
      const reference = {
        deviceId: target ? target.deviceId : deviceId,
        threadId: target?.threadId ?? value!.thread.id,
        title: target?.title ?? value!.thread.title,
        ...((target ? target.workspaceId : value?.thread.workspaceId) ? { workspaceId: (target ? target.workspaceId : value?.thread.workspaceId)! } : {}),
        workspaceLabel: target?.workspaceLabel ?? value!.workspace.label,
        ...(favorite !== undefined ? { favorite } : {}),
        ...(markRead && value?.thread.lastTurnCompletedAt ? { readCompletedAt: value.thread.lastTurnCompletedAt } : {}),
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
  const toggleFavorite = async (key = currentKey) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const target = snapshot.threads.find(t => referenceKey(t) === key);
      await save(!(target?.favorite ?? favorite), false, target);
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
  const rawNotifications = relay ? snapshot.notifications : localNotifications;
  const notificationKey = JSON.stringify(rawNotifications.slice(0, 30).map(n => [n.id, n.href, n.occurredAt]));
  useEffect(() => {
    if (!notificationsOpened) return;
    let alive = true;
    const controller = new AbortController();
    const pending = rawNotifications.slice(0, 30).filter(n => !notificationDetails[n.id]);
    void Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
      while (alive && pending.length) {
        const notification = pending.shift()!;
        // Fetch private previews through the viewer's authenticated device transport.
        const match = notification.href.match(/^\/devices\/([^/]+)\/threads\/([^/?#]+)$/);
        const local = notification.href.match(/^\/threads\/([^/?#]+)$/);
        const base = match ? `/relay/devices/${match[1]}/api/threads/${match[2]}` : local && !relay ? `/api/threads/${local[1]}` : null;
        if (!base) continue;
        try {
          const value = await request<ThreadDetailDto>(`${base}?view=summary&limit=10`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) });
          const eventTime = Date.parse(notification.occurredAt);
          const turn = value.turns.filter(t => t.completedAt && Math.abs(Date.parse(t.completedAt) - eventTime) < 60_000)
            .sort((a, b) => Math.abs(Date.parse(a.completedAt!) - eventTime) - Math.abs(Date.parse(b.completedAt!) - eventTime))[0];
          const text = [...(turn?.items ?? [])].reverse().find(item => item.kind === 'agentMessage' && item.text.trim())?.text.trim().replace(/\s+/g, ' ') ?? '';
          const summary = text ? Array.from(text).slice(0, 180).join('') + (Array.from(text).length > 180 ? '…' : '') : 'Open the thread to view its response.';
          if (alive) setNotificationDetails(previous => ({ ...previous, [notification.id]: { title: `${value.thread.title} · ${turn?.status === 'failed' ? 'Failed' : turn?.status === 'interrupted' ? 'Interrupted' : 'Completed'}`, summary } }));
        } catch { /* Leave metadata visible; retry unavailable previews when the bell opens again. */ }
      }
    }));
    return () => { alive = false; controller.abort(); };
  }, [notificationKey, notificationsOpened, relay]);
  const notifications = rawNotifications.map(n => ({ ...n, ...notificationDetails[n.id] }));
  return {
    navigationReady,
    threads: items,
    workspaceThreads: threads
      .filter(thread => thread.workspaceId === detail?.thread.workspaceId)
      .slice()
      .sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id))
      .map(thread => {
        const key = `${deviceId ?? 'local'}:${thread.id}`;
        const reference = snapshot.threads.find(r => referenceKey(r) === key);
        return {
          key, title: thread.title, subtitle: detail?.workspace.label ?? '',
          href: threadHref(thread.id, deviceId), favorite: reference?.favorite ?? false,
          status: workbenchThreadStatus(thread.id === detail?.thread.id ? detail.thread : thread, reference?.readCompletedAt),
        };
      }),
    currentKey,
    favorite,
    favoriteBusy: busy,
    error,
    onToggleFavorite: () => void toggleFavorite(),
    onToggleThreadFavorite: (key: string) => toggleFavorite(key),
    onThreadRenamed: async (key: string, title: string) => {
      const target = snapshot.threads.find(t => referenceKey(t) === key);
      if (target) await save(undefined, false, { ...target, title });
    },
    onThreadRemoved: async (key: string) => {
      const target = snapshot.threads.find(t => referenceKey(t) === key);
      if (!target) return;
      ++revision.current;
      if (relay) {
        setSnapshot(await request<NavigationSnapshot>('/relay/account/workbench', { method: 'DELETE', body: JSON.stringify({ deviceId: target.deviceId, threadId: target.threadId }) }));
      } else {
        const next = loadLocal();
        next.threads = next.threads.filter(t => referenceKey(t) !== key);
        localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
        setSnapshot(next);
      }
    },
    notifications,
    unreadCount: notifications.filter((n) => Date.parse(n.occurredAt) > readAt)
      .length,
    onReadNotifications: () => { setReadAt(Date.now()); setNotificationsOpened(value => value + 1); },
  };
}
