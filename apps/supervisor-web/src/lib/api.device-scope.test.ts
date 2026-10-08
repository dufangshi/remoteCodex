import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encryptedBrowserFetch, encryptedRelaySocket } from './relayTransport';
import {
  setSelectedRelayDeviceId,
  fetchThreadDetail,
  fetchThreadModels,
  fetchThreadCapabilitySnapshot,
  sendThreadPrompt,
  updateThreadSettings,
  interruptThread,
  cancelPendingSteer,
  respondToThreadRequest,
  fetchWorkspaceFileTree,
  fetchWorkspaceDocument,
  saveWorkspaceDocument,
  createWorkspaceFile,
  downloadWorkspaceFile,
  buildWorkspaceRawFileUrl,
  buildThreadImageAssetUrl,
  workspaceResourceScope,
  connectShellSocket,
  fetchThreadDelivery,
  request,
} from './api';
vi.mock('./relayTransport', () => ({
  encryptedBrowserFetch: vi.fn(),
  encryptedRelaySocket: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.setItem('remote-codex-relay-mode', 'true');
  setSelectedRelayDeviceId('host-device');
  vi.mocked(encryptedBrowserFetch).mockImplementation(
    async () =>
      new Response('{}', { headers: { 'content-type': 'application/json' } }),
  );
});
afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('keeps a resolved local request local when navigation changes during a wake retry', async () => {
  vi.useFakeTimers();
  localStorage.setItem('remote-codex-relay-mode', 'false');
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(async () => {
      localStorage.setItem('remote-codex-relay-mode', 'true');
      setSelectedRelayDeviceId('new-device');
      return new Response(
        JSON.stringify({
          code: 'unavailable',
          message: 'starting',
          details: { reason: 'hosted_sandbox_starting' },
        }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    })
    .mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch', fetchMock);
  const pending = request('/api/workspaces');
  await vi.advanceTimersByTimeAsync(1500);
  await pending;
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [url] of fetchMock.mock.calls) expect(url).toBe('/api/workspaces');
  expect(encryptedBrowserFetch).not.toHaveBeenCalled();
});
it('routes every secondary chat operation and attached prompt to its captured device', async () => {
  const target = 'other-device';
  await fetchThreadDetail('peer', {}, target);
  await fetchThreadModels('peer', target);
  await fetchThreadCapabilitySnapshot('peer', target);
  await sendThreadPrompt('peer', { prompt: 'hello' }, target);
  await sendThreadPrompt(
    'peer',
    {
      prompt: 'file',
      attachments: [
        {
          file: new File(['body'], 'a.txt'),
          clientId: 'a',
          kind: 'file',
          originalName: 'a.txt',
          placeholder: '[FILE a.txt]',
        },
      ],
    },
    target,
  );
  await updateThreadSettings('peer', { model: 'model' }, target);
  await interruptThread('peer', {}, target);
  await cancelPendingSteer('peer', 'queue', target);
  await respondToThreadRequest('peer', 'request', { answers: {} }, target);
  expect(encryptedBrowserFetch).toHaveBeenCalledTimes(9);
  for (const [path] of vi.mocked(encryptedBrowserFetch).mock.calls)
    expect(path).toMatch(/^\/relay\/devices\/other-device\/api\/threads\/peer/);
  expect(
    vi.mocked(encryptedBrowserFetch).mock.calls[4]![1]?.body,
  ).toBeInstanceOf(FormData);
  expect(localStorage.getItem('remote-codex-relay-device-id')).toBe(
    'host-device',
  );
});
it('pins workspace reads, creation, saves, downloads, media and draft scope to the tool target', async () => {
  await fetchWorkspaceFileTree('ws', {}, 'peer-device');
  await fetchWorkspaceDocument('ws', 'a.md', undefined, 'peer-device');
  await createWorkspaceFile('ws', 'a.md', 'peer-device');
  await saveWorkspaceDocument(
    'ws',
    {
      path: 'a.md',
      operationId: 'op',
      draftRevision: 1,
      content: 'b',
      workspaceRevision: 'rev',
      fileIdentity: 'file',
      contentHash: 'hash',
      encoding: 'utf8',
      bom: false,
      eol: 'lf',
    } as never,
    'peer-device',
  );
  await downloadWorkspaceFile('ws', { path: 'a.md' }, 'peer-device');
  for (const [path] of vi.mocked(encryptedBrowserFetch).mock.calls)
    expect(path).toMatch(
      /^\/relay\/devices\/peer-device\/api\/workspaces\/ws\//,
    );
  expect(
    buildWorkspaceRawFileUrl('ws', { path: 'a.md' }, 'peer-device'),
  ).toContain('/relay/devices/peer-device/api/workspaces/ws/');
  expect(
    buildThreadImageAssetUrl('peer', { path: 'photo.png' }, 'peer-device'),
  ).toContain('/relay/devices/peer-device/api/threads/peer/');
  expect(workspaceResourceScope('peer-device')).not.toBe(
    workspaceResourceScope('host-device'),
  );
});
it('retains the explicit device through an older-supervisor delivery fallback', async () => {
  vi.mocked(encryptedBrowserFetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({ code: 'badRequest', message: 'unsupported' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    ),
  );
  await fetchThreadDelivery('peer', 'peer-device');
  expect(encryptedBrowserFetch).toHaveBeenCalledTimes(2);
  for (const [path] of vi.mocked(encryptedBrowserFetch).mock.calls)
    expect(path).toMatch(
      /^\/relay\/devices\/peer-device\/api\/threads\/peer\?/,
    );
});
it('subscribes the terminal to the target device and thread instead of the primary route', () => {
  const socket = { addEventListener: vi.fn(), send: vi.fn() };
  vi.mocked(encryptedRelaySocket).mockReturnValue(socket as never);
  connectShellSocket({}, { deviceId: 'peer-device', threadId: 'peer-thread' });
  const url = new URL(vi.mocked(encryptedRelaySocket).mock.calls[0]![0]);
  expect(url.pathname).toBe('/relay/devices/peer-device/ws');
  expect(url.searchParams.get('threadId')).toBe('peer-thread');
});
