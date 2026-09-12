import { request } from './api';
import { ensureRelayWorker } from './relayTransport';

export interface PushSettings {
  publicKey: string;
  subscriptionIds: string[];
  scope: string;
}
export const loadPushSettings = () =>
  request<PushSettings>('/relay/account/notifications');
export function pushSupported() {
  return (
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}
export async function subscriptionId(endpoint: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(endpoint),
  );
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
export async function currentPushSubscription() {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return registration?.pushManager.getSubscription() ?? null;
}
export async function enablePush(
  publicKey: string,
  permission: Promise<NotificationPermission>,
) {
  if ((await permission) !== 'granted')
    throw new Error(
      'Allow notifications in your browser settings to enable thread updates.',
    );
  const registration = await ensureRelayWorker();
  let sub = await registration.pushManager.getSubscription();
  if (!sub) {
    const key = Uint8Array.from(
      atob(publicKey.replaceAll('-', '+').replaceAll('_', '/')),
      (c) => c.charCodeAt(0),
    );
    sub = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }
  await request('/relay/account/notifications/subscription', {
    method: 'POST',
    body: JSON.stringify(sub.toJSON()),
  });
}
export async function disablePush() {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await request('/relay/account/notifications/subscription', {
    method: 'DELETE',
    body: JSON.stringify({ id: await subscriptionId(sub.endpoint) }),
  });
  await sub.unsubscribe();
  const registration = await navigator.serviceWorker.getRegistration('/');
  for (const notification of (await registration?.getNotifications()) ?? [])
    notification.close();
}

// Service workers cannot rely on WindowClient.url after React Router navigation.
export function installNotificationRouteResponder() {
  if (!('serviceWorker' in navigator)) return () => {};
  const reply = (event: MessageEvent) => {
    if (event.data?.type === 'remote-codex-current-route')
      event.ports[0]?.postMessage({ url: window.location.href });
  };
  navigator.serviceWorker.addEventListener('message', reply);
  return () => navigator.serviceWorker.removeEventListener('message', reply);
}
