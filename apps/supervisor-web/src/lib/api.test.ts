import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspace, importThread, markWorkspaceOpened, resumeThread } from './api';

describe('api request helper', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true })
      })
    );
  });

  it('does not force a JSON content type for body-less post requests', async () => {
    await markWorkspaceOpened('workspace-1');
    await resumeThread('thread-1');

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);

    for (const [, init] of calls) {
      const headers = new Headers(init?.headers);
      expect(headers.has('Content-Type')).toBe(false);
    }
  });

  it('adds a JSON content type when a JSON body is present', async () => {
    await createWorkspace({
      absPath: '/Users/fonsh/remoteCodex'
    });
    await importThread('019d6fb7-7033-7a30-a2c7-74d0919e87d4');

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);

    for (const [, init] of calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('Content-Type')).toBe('application/json');
    }
  });
});
