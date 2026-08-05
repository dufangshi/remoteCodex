import { describe, expect, it } from 'vitest';

import { UnsupportedShellBackend } from './unsupported-shell-backend';

describe('UnsupportedShellBackend', () => {
  it('has no sessions and rejects terminal creation with a stable code', async () => {
    const backend = new UnsupportedShellBackend('Unavailable for test.');

    await expect(backend.listSessionNames()).resolves.toEqual([]);
    await expect(backend.hasSession('missing')).resolves.toBe(false);
    await expect(backend.createSession({
      sessionId: 'shell-id',
      threadId: 'thread-id',
      cwd: process.cwd(),
    })).rejects.toMatchObject({
      code: 'plugin_disabled',
      message: 'Unavailable for test.',
    });
  });
});
