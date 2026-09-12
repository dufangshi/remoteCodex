import { expect, it, vi } from 'vitest';
import {
  focusNotificationThread,
  notificationThreadUrl,
} from './notificationWorker';
const origin = 'https://remote.example';
const a =
  '/devices/11111111-1111-4111-8111-111111111111/threads/22222222-2222-4222-8222-222222222222';
const b = a.replaceAll('22222222', '33333333');
it('finds a SPA tab by its live route, or opens a new thread without redirecting another tab', async () => {
  // Simulate channel ports without depending on browser process activation.
  class Channel {
    port1 = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      close() {},
    };
    port2 = {
      close() {},
      postMessage: (data: unknown) => this.port1.onmessage?.({ data }),
    };
  }
  vi.stubGlobal('MessageChannel', Channel);
  try {
    const focus = vi.fn().mockResolvedValue({});
    const client = {
      url: origin + b,
      focus,
      postMessage: (_: unknown, ports: Channel['port2'][]) =>
        ports[0]!.postMessage({ url: origin + a + '?panel=files' }),
    };
    const openWindow = vi.fn().mockResolvedValue(null);
    const clients = {
      matchAll: vi.fn().mockResolvedValue([client]),
      openWindow,
    } as unknown as Clients;
    await focusNotificationThread(clients, a, origin);
    expect(focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
    await focusNotificationThread(clients, b, origin);
    expect(openWindow).toHaveBeenCalledWith(origin + b);
    await focusNotificationThread(clients, 'https://evil.test' + a, origin);
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(notificationThreadUrl('/relay/account', origin)).toBeNull();
  } finally {
    vi.unstubAllGlobals();
  }
});
