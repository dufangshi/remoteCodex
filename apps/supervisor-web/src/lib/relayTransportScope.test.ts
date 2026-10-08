import { expect, it } from 'vitest';
import { scopeFromPage } from './relayTransportCrypto';
it('uses the page thread for its own device and never as a cross-device handshake scope', () => {
  const page = 'https://remote.example/devices/device-a/threads/thread-a';
  expect(scopeFromPage(page)).toBe('thread-a');
  expect(scopeFromPage(page, 'device-a')).toBe('thread-a');
  expect(scopeFromPage(page, 'device-b')).toBeUndefined();
  expect(
    scopeFromPage('https://remote.example/devices/a%20b/threads/thread', 'a b'),
  ).toBe('thread');
});
