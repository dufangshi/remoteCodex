import { useEffect, useState } from 'react';
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  loadPushSettings,
  pushSupported,
  subscriptionId,
  type PushSettings,
} from '../lib/relayPush';

export function RelayNotifications() {
  const [settings, setSettings] = useState<PushSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const supported = pushSupported();
  async function refresh() {
    try {
      const next = await loadPushSettings();
      setSettings(next);
      const sub = supported ? await currentPushSubscription() : null;
      setEnabled(
        !!sub &&
          Notification.permission === 'granted' &&
          next.subscriptionIds.includes(await subscriptionId(sub.endpoint)),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Unable to load notification settings.',
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  function toggle() {
    if (!settings) return;
    setBusy(true);
    setError('');
    // Request permission immediately in the click handler, before other awaits.
    const operation = enabled
      ? disablePush()
      : enablePush(settings.publicKey, Notification.requestPermission());
    void operation.then(refresh).catch((e) => {
      setError(
        e instanceof Error ? e.message : 'Unable to change notifications.',
      );
      setBusy(false);
    });
  }
  return (
    <section className="grid gap-5 py-6 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-8">
      <header>
        <h2 className="text-base font-semibold">Thread notifications</h2>
        <p className="mt-1 text-sm text-[var(--theme-fg-muted)]">
          Your Relay account.
        </p>
      </header>
      <div className="space-y-3 text-sm">
        <p>
          Notify this browser when a thread turn completes or fails on any
          device you own. Threads and devices shared with you are excluded.
        </p>
        <p className="text-[var(--theme-fg-muted)]">
          Pages can be closed. Clicking a notification opens its thread or
          focuses the tab already showing it. Chat content is not included.
        </p>
        {!supported ? (
          <p>
            This browser cannot enable Web Push here. Use HTTPS and a supported
            browser; on iPhone or iPad, add Remote Codex to the Home Screen
            first.
          </p>
        ) : (
          <>
            <p>
              {busy
                ? 'Checking notifications…'
                : enabled
                  ? 'Enabled in this browser'
                  : 'Disabled in this browser'}
            </p>
            <button
              type="button"
              className="relay-button-primary min-h-11"
              disabled={busy || !settings}
              onClick={toggle}
            >
              {enabled ? 'Disable notifications' : 'Enable notifications'}
            </button>
            {Notification.permission === 'denied' && (
              <p>
                Notifications are blocked. Allow them in this site’s browser
                settings, then reload.
              </p>
            )}
          </>
        )}
        <p className="text-[var(--theme-fg-muted)]">
          Enable separately in each browser. Signing out or ending this login
          session disables its subscription.
        </p>
        {error && (
          <p role="alert" className="text-[var(--status-danger-fg)]">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
