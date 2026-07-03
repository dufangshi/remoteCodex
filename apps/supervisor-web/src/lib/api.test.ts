import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyProviderHostConfigArchive,
  createThreadShell,
  createProviderHostConfigArchive,
  createWorkspace,
  disconnectThread,
  buildApiUrl,
  buildThreadImageAssetUrl,
  buildWorkspaceRawFileUrl,
  fetchAgentBackendModels,
  fetchAgentBackendStatus,
  fetchAuthSession,
  fetchProviderHostConfigArchives,
  fetchProviderHostFile,
  importThread,
  installOrUpdateAgentBackend,
  buildAndRestartService,
  login,
  enableRelayMode,
  renameProviderHostConfigArchive,
  restartAgentBackend,
  resumeThread,
  sendThreadPrompt,
  setSelectedRelayDeviceId,
  terminateShell,
  updateProviderHostFile,
} from './api';

describe('api request helper', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState(null, '', '/');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true })
      })
    );
  });

  it('sends same-origin credentials and a stored bearer token', async () => {
    window.localStorage.setItem('remote-codex-auth-token', 'token-1');

    await fetchAuthSession();

    const call = vi.mocked(fetch).mock.calls.at(-1);
    expect(call?.[0]).toBe('/api/auth/session');
    expect(call?.[1]?.credentials).toBe('same-origin');
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-1');
  });

  it('stores the login token for follow-up requests', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          token: 'token-2',
          session: {
            authenticated: true,
            username: 'admin',
            expiresAt: '2026-06-10T00:00:00.000Z',
            mode: 'server',
            authRequired: true,
          },
        }),
      }),
    );

    await login({ username: 'admin', password: 'secret' });

    expect(window.localStorage.getItem('remote-codex-auth-token')).toBe('token-2');
    const call = vi.mocked(fetch).mock.calls.at(-1);
    expect(call?.[0]).toBe('/api/auth/login');
    expect(call?.[1]?.credentials).toBe('same-origin');
  });

  it('does not force a JSON content type for body-less post requests', async () => {
    await resumeThread('thread-1');
    await disconnectThread('thread-1');

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
    await importThread({
      sessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
      provider: 'claude',
    });

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);

    for (const [, init] of calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('Content-Type')).toBe('application/json');
    }
    expect(calls[1]?.[1]?.body).toBe(JSON.stringify({
      sessionId: '019d6fb7-7033-7a30-a2c7-74d0919e87d4',
      provider: 'claude',
    }));
  });

  it('keeps shell create and terminate request shapes aligned', async () => {
    await createThreadShell('thread-1', { cols: 120, rows: 40 });
    await terminateShell('shell-1');

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0]?.[0]).toBe('/api/threads/thread-1/shell');
    expect(calls[0]?.[1]?.method).toBe('POST');
    expect(calls[0]?.[1]?.body).toBe(JSON.stringify({ cols: 120, rows: 40 }));
    expect(calls[1]?.[0]).toBe('/api/shells/shell-1/terminate');
    expect(calls[1]?.[1]?.method).toBe('POST');
  });

  it('uses multipart form data when prompt attachments are present', async () => {
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

    await sendThreadPrompt('thread-1', {
      prompt: 'Review this [FILE notes.txt]',
      attachments: [
        {
          clientId: 'attachment-1',
          kind: 'file',
          originalName: 'notes.txt',
          placeholder: '[FILE notes.txt]',
          file,
        },
      ],
    });

    const call = vi.mocked(fetch).mock.calls.at(-1);
    expect(call?.[0]).toBe('/api/threads/thread-1/prompt');
    expect(call?.[1]?.method).toBe('POST');
    expect(call?.[1]?.body).toBeInstanceOf(FormData);
    const headers = new Headers(call?.[1]?.headers);
    expect(headers.has('Content-Type')).toBe(false);
  });

  it('maps browser media urls through the selected relay device', () => {
    enableRelayMode();
    setSelectedRelayDeviceId('device-1');

    expect(
      buildThreadImageAssetUrl('thread-1', {
        path: './.temp/threads/thread-1/image.png',
      }),
    ).toBe(
      '/relay/devices/device-1/api/threads/thread-1/assets/image?path=.%2F.temp%2Fthreads%2Fthread-1%2Fimage.png',
    );
    expect(
      buildWorkspaceRawFileUrl('workspace-1', {
        path: 'screenshots/image 1.png',
      }),
    ).toBe(
      '/relay/devices/device-1/api/workspaces/workspace-1/files/raw?path=screenshots%2Fimage+1.png',
    );
  });

  it('lets relay device ids in the URL override the globally selected device', () => {
    enableRelayMode();
    setSelectedRelayDeviceId('device-b');
    window.history.pushState(null, '', '/devices/device-a/threads/thread-1');

    expect(buildApiUrl('/api/threads/thread-1')).toBe(
      '/relay/devices/device-a/api/threads/thread-1',
    );
    expect(
      buildThreadImageAssetUrl('thread-1', {
        path: './.temp/threads/thread-1/image.png',
      }),
    ).toBe(
      '/relay/devices/device-a/api/threads/thread-1/assets/image?path=.%2F.temp%2Fthreads%2Fthread-1%2Fimage.png',
    );
  });

  it('preserves non-JSON upstream error status and body text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'OpenAI upstream unavailable.',
      }),
    );

    await expect(
      sendThreadPrompt('thread-1', {
        prompt: 'Trigger outage.',
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      payload: {
        code: 'service_unavailable',
        message: 'Upstream service unavailable (503 Service Unavailable).\nOpenAI upstream unavailable.',
      },
    });
  });

  it('uses the expected provider host file endpoints', async () => {
    await fetchProviderHostFile('codex', 'config.toml');
    await updateProviderHostFile('codex', 'auth.json', {
      content: '{\n  "token": "abc"\n}\n',
    });

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0]?.[0]).toBe('/api/config/providers/codex/files/config.toml');
    expect(calls[1]?.[0]).toBe('/api/config/providers/codex/files/auth.json');
    expect(calls[1]?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
      content: '{\n  "token": "abc"\n}\n',
    });
  });

  it('uses the expected provider config archive endpoints', async () => {
    await fetchProviderHostConfigArchives('codex');
    await createProviderHostConfigArchive('codex', { label: 'Known good' });
    await renameProviderHostConfigArchive('codex', 'archive-1', { label: 'Renamed' });
    await applyProviderHostConfigArchive('codex', 'archive-1');

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0]?.[0]).toBe('/api/config/providers/codex/archives');
    expect(calls[1]?.[0]).toBe('/api/config/providers/codex/archives');
    expect(calls[1]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
      label: 'Known good',
    });
    expect(calls[2]?.[0]).toBe('/api/config/providers/codex/archives/archive-1');
    expect(calls[2]?.[1]?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[2]?.[1]?.body))).toEqual({
      label: 'Renamed',
    });
    expect(calls[3]?.[0]).toBe('/api/config/providers/codex/archives/archive-1/apply');
    expect(calls[3]?.[1]?.method).toBe('POST');
  });

  it('uses the expected agent runtime endpoints for status, restart, and models', async () => {
    await fetchAgentBackendStatus('codex');
    await restartAgentBackend('codex');
    await fetchAgentBackendModels('codex');
    await installOrUpdateAgentBackend('claude', 'install');
    await buildAndRestartService();

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0]?.[0]).toBe('/api/agent-runtimes/codex/status');
    expect(calls[1]?.[0]).toBe('/api/agent-runtimes/codex/restart');
    expect(calls[1]?.[1]?.method).toBe('POST');
    expect(calls[2]?.[0]).toBe('/api/agent-runtimes/codex/models');
    expect(calls[3]?.[0]).toBe('/api/agent-runtimes/claude/install');
    expect(calls[3]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(calls[3]?.[1]?.body))).toEqual({ action: 'install' });
    expect(calls[4]?.[0]).toBe('/api/service/build-restart');
    expect(calls[4]?.[1]?.method).toBe('POST');
  });

});
