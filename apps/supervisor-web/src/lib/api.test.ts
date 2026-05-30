import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyProviderHostConfigArchive,
  bootstrapControlPlaneUser,
  closeControlPlaneSession,
  controlPlaneOAuthStartUrl,
  createThreadShell,
  createProviderHostConfigArchive,
  createControlPlaneWorkspace,
  createWorkspace,
  disconnectThread,
  fetchAgentBackendModels,
  fetchAgentBackendStatus,
  fetchProviderHostConfigArchives,
  fetchProviderHostFile,
  importThread,
  buildAndRestartService,
  renameProviderHostConfigArchive,
  restartAgentBackend,
  loginControlPlanePasswordAccount,
  registerControlPlanePasswordAccount,
  resumeControlPlaneSession,
  resumeThread,
  sendThreadPrompt,
  terminateShell,
  updateProviderHostFile,
} from './api';

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
    await importThread('019d6fb7-7033-7a30-a2c7-74d0919e87d4');

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls).toHaveLength(2);

    for (const [, init] of calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get('Content-Type')).toBe('application/json');
    }
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
    await buildAndRestartService();

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0]?.[0]).toBe('/api/agent-runtimes/codex/status');
    expect(calls[1]?.[0]).toBe('/api/agent-runtimes/codex/restart');
    expect(calls[1]?.[1]?.method).toBe('POST');
    expect(calls[2]?.[0]).toBe('/api/agent-runtimes/codex/models');
    expect(calls[3]?.[0]).toBe('/api/service/build-restart');
    expect(calls[3]?.[1]?.method).toBe('POST');
  });

  it('uses control-plane password auth endpoints', async () => {
    await registerControlPlanePasswordAccount('https://control.example.test/', {
      email: 'user@example.com',
      password: 'password123',
      displayName: 'User',
    });
    await loginControlPlanePasswordAccount('https://control.example.test/', {
      email: 'user@example.com',
      password: 'password123',
    });

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0]?.[0]).toBe('https://control.example.test/api/auth/password/register');
    expect(calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      email: 'user@example.com',
      password: 'password123',
      displayName: 'User',
    });
    expect(calls[1]?.[0]).toBe('https://control.example.test/api/auth/password/login');
    expect(calls[1]?.[1]?.method).toBe('POST');
  });

  it('builds oauth start urls with return targets', () => {
    const url = new URL(controlPlaneOAuthStartUrl(
      'https://control.example.test/',
      'github',
      'https://frontend.example.test/control-plane/login',
    ));
    expect(url.origin + url.pathname).toBe('https://control.example.test/api/auth/oauth/github/start');
    expect(url.searchParams.get('returnTo')).toBe('https://frontend.example.test/control-plane/login');
  });

  it('keeps control-plane auth headers and JSON request shape', async () => {
    const auth = {
      baseUrl: 'https://control.example.test/',
      token: 'dev:user-1',
    };

    await bootstrapControlPlaneUser(auth, {
      email: 'user@example.com',
      displayName: 'User',
    });
    await createControlPlaneWorkspace(auth, {
      projectId: 'project-1',
      name: 'Molecule study',
      slug: 'molecule-study',
    });
    await closeControlPlaneSession(auth, 'session-1');
    await resumeControlPlaneSession(auth, 'session-1');

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0]?.[0]).toBe('https://control.example.test/api/me/bootstrap');
    expect(calls[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({
      email: 'user@example.com',
      displayName: 'User',
    });
    expect(new Headers(calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer dev:user-1');
    expect(new Headers(calls[0]?.[1]?.headers).get('Content-Type')).toBe('application/json');

    expect(calls[1]?.[0]).toBe(
      'https://control.example.test/api/projects/project-1/workspaces',
    );
    expect(calls[1]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
      name: 'Molecule study',
      slug: 'molecule-study',
    });
    expect(new Headers(calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer dev:user-1');
    expect(new Headers(calls[1]?.[1]?.headers).get('Content-Type')).toBe('application/json');

    expect(calls[2]?.[0]).toBe('https://control.example.test/api/sessions/session-1/close');
    expect(calls[2]?.[1]?.method).toBe('POST');
    expect(new Headers(calls[2]?.[1]?.headers).get('Authorization')).toBe('Bearer dev:user-1');
    expect(new Headers(calls[2]?.[1]?.headers).has('x-remote-codex-worker-token')).toBe(false);

    expect(calls[3]?.[0]).toBe('https://control.example.test/api/sessions/session-1/resume');
    expect(calls[3]?.[1]?.method).toBe('POST');
    expect(new Headers(calls[3]?.[1]?.headers).get('Authorization')).toBe('Bearer dev:user-1');
    expect(new Headers(calls[3]?.[1]?.headers).has('x-remote-codex-worker-token')).toBe(false);
  });
});
