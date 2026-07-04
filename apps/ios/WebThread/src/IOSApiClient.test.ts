import { afterEach, describe, expect, it, vi } from 'vitest';

import type { IOSBootstrap } from './IOSBootstrap';
import { IOSApiClient, IOSApiError } from './IOSApiClient';

function bootstrap(overrides: Partial<IOSBootstrap> = {}): IOSBootstrap {
  return {
    baseUrl: 'https://remote-codex.example.test',
    mode: 'server',
    authToken: 'ios-token',
    relayDeviceId: null,
    threadId: null,
    theme: 'system',
    fixture: false,
    ...overrides,
  };
}

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function downloadResponse(body: string, headers: Record<string, string>) {
  return new Response(body, {
    status: 200,
    headers,
  });
}

describe('IOSApiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads runtime metadata through the supervisor API', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse([]));
    const client = new IOSApiClient(bootstrap());

    await expect(client.listAgentRuntimes()).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://remote-codex.example.test/api/agent-runtimes',
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
  });

  it('loads model options for the selected thread provider', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse([]));
    const client = new IOSApiClient(bootstrap());

    await expect(client.listModels('claude')).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://remote-codex.example.test/api/agent-runtimes/claude/models',
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
  });

  it('loads thread detail through relay selected-device REST forwarding with auth', async () => {
    const payload = {
      thread: {
        id: 'thread-1',
        title: 'Relay thread',
      },
      turns: [],
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(
      bootstrap({
        mode: 'relay',
        relayDeviceId: 'device-1',
      }),
    );

    await expect(client.fetchThreadDetail('thread-1', 45)).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://remote-codex.example.test/relay/devices/device-1/api/threads/thread-1?limit=45',
    );
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
  });

  it('loads relay access through the relay control plane in relay mode', async () => {
    const payload = {
      kind: 'shared',
      shareId: 'share-1',
      threadAccess: 'read',
      workspaceAccess: 'read',
      workspaceId: 'workspace-1',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(
      bootstrap({
        mode: 'relay',
        relayDeviceId: 'device-1',
      }),
    );

    await expect(
      client.fetchRelayAccess({
        deviceId: 'device-1',
        threadId: 'thread-1',
        workspaceId: 'workspace-1',
      }),
    ).resolves.toEqual(payload);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://remote-codex.example.test/relay/access?deviceId=device-1&threadId=thread-1&workspaceId=workspace-1',
    );
  });

  it('creates and revokes relay shares through the relay control plane', async () => {
    const payload = {
      id: 'share-1',
      ownerUserId: 'owner',
      targetUserId: 'target',
      targetUsername: 'friend',
      deviceId: 'device-1',
      deviceName: 'Mac',
      threadId: 'thread-1',
      workspaceId: 'workspace-1',
      label: 'handoff',
      threadAccess: 'control',
      workspaceAccess: 'write',
      createdAt: '2026-07-03T00:00:00.000Z',
      revokedAt: null,
      expiresAt: null,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(payload))
      .mockResolvedValueOnce(jsonResponse(payload));
    const client = new IOSApiClient(
      bootstrap({
        mode: 'relay',
        relayDeviceId: 'device-1',
      }),
    );

    await expect(
      client.createRelayShare({
        targetIdentifier: 'friend',
        deviceId: 'device-1',
        threadId: 'thread-1',
        workspaceId: 'workspace-1',
        label: 'handoff',
        threadAccess: 'control',
        workspaceAccess: 'write',
      }),
    ).resolves.toEqual(payload);
    await expect(client.revokeRelayShare('share-1')).resolves.toEqual(payload);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://remote-codex.example.test/relay/shares',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://remote-codex.example.test/relay/shares/share-1',
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
  });

  it('cancels pending queued prompts through the supervisor API', async () => {
    const payload = {
      thread: {
        id: 'thread-1',
        title: 'Canceled queue',
      },
      turns: [],
      pendingSteers: [],
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(bootstrap());

    await expect(
      client.cancelPendingSteer('thread-1', 'pending-steer-1'),
    ).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://remote-codex.example.test/api/threads/thread-1/pending-steers/pending-steer-1',
    );
    expect(init?.method).toBe('DELETE');
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
  });

  it('loads earlier thread detail pages with beforeTurnId', async () => {
    const payload = {
      thread: {
        id: 'thread-1',
        title: 'Paged thread',
      },
      turns: [],
      totalTurnCount: 45,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(bootstrap());

    await expect(
      client.fetchThreadDetail('thread-1', {
        limit: 10,
        beforeTurnId: 'turn-16',
      }),
    ).resolves.toEqual(payload);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://remote-codex.example.test/api/threads/thread-1?limit=10&beforeTurnId=turn-16',
    );
  });

  it('parses JSON API errors and falls back for non-JSON errors', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'not_found',
            message: 'Workspace missing.',
            details: { path: '/tmp/missing' },
          }),
          {
            status: 404,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response('not json', {
          status: 502,
          headers: { 'content-type': 'text/plain' },
        }),
      );
    const client = new IOSApiClient(bootstrap());

    await expect(client.listThreads()).rejects.toMatchObject({
      statusCode: 404,
      payload: {
        code: 'not_found',
        message: 'Workspace missing.',
        details: { path: '/tmp/missing' },
      },
    } satisfies Partial<IOSApiError>);
    await expect(client.listThreads()).rejects.toMatchObject({
      statusCode: 502,
      payload: {
        code: 'internal_error',
        message: 'Request failed (502).',
      },
    } satisfies Partial<IOSApiError>);
  });

  it('sends prompts with auth, JSON body, and a client request id', async () => {
    const payload = {
      id: 'thread-1',
      title: 'Prompted thread',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(bootstrap());

    await expect(client.sendPrompt('thread-1', 'hello from webview')).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://remote-codex.example.test/api/threads/thread-1/prompt',
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      prompt: 'hello from webview',
      clientRequestId: expect.any(String),
    });
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
    expect((init?.headers as Headers).get('content-type')).toBe(
      'application/json',
    );
  });

  it('patches thread settings with auth and the shared settings payload', async () => {
    const updatedThread = {
      id: '6c07cdb9-b149-4921-aa86-9b87dcf11111',
      title: 'Updated thread',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(updatedThread));
    const client = new IOSApiClient(bootstrap());

    await expect(
      client.updateThreadSettings(updatedThread.id, {
        model: 'ios-e2e-stream',
        reasoningEffort: 'high',
        collaborationMode: 'plan',
      }),
    ).resolves.toEqual(updatedThread);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://remote-codex.example.test/api/threads/6c07cdb9-b149-4921-aa86-9b87dcf11111/settings',
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          model: 'ios-e2e-stream',
          reasoningEffort: 'high',
          collaborationMode: 'plan',
        }),
      }),
    );
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
    expect((init?.headers as Headers).get('content-type')).toBe(
      'application/json',
    );
  });

  it('renames and deletes threads with auth', async () => {
    const renamedThread = {
      id: 'thread-1',
      title: 'Renamed from iOS WebView',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(renamedThread))
      .mockResolvedValueOnce(jsonResponse({ id: 'thread-1' }));
    const client = new IOSApiClient(bootstrap());

    await expect(
      client.renameThread('thread-1', 'Renamed from iOS WebView'),
    ).resolves.toEqual(renamedThread);
    await expect(client.deleteThread('thread-1')).resolves.toEqual({
      id: 'thread-1',
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://remote-codex.example.test/api/threads/thread-1',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Renamed from iOS WebView' }),
      }),
    );
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://remote-codex.example.test/api/threads/thread-1',
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'DELETE',
      }),
    );
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
  });

  it('responds to a pending thread request with auth and shared answer payload', async () => {
    const updatedDetail = {
      thread: {
        id: '6c07cdb9-b149-4921-aa86-9b87dcf11111',
        title: 'Updated thread',
      },
      pendingRequests: [],
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(updatedDetail));
    const client = new IOSApiClient(bootstrap());

    await expect(
      client.respondToRequest(
        '6c07cdb9-b149-4921-aa86-9b87dcf11111',
        'toolu_question',
        {
          answers: {
            'question-1': {
              answers: ['Detailed'],
            },
          },
        },
      ),
    ).resolves.toEqual(updatedDetail);

    const [, init] = fetchMock.mock.calls[0]!;
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://remote-codex.example.test/api/threads/6c07cdb9-b149-4921-aa86-9b87dcf11111/requests/toolu_question/respond',
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          answers: {
            'question-1': {
              answers: ['Detailed'],
            },
          },
        }),
      }),
    );
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
    expect((init?.headers as Headers).get('content-type')).toBe(
      'application/json',
    );
  });

  it('loads export turns without caching', async () => {
    const payload = {
      turns: [],
      totalTurnCount: 0,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(bootstrap());

    await expect(client.fetchThreadExportTurns('thread-1')).resolves.toEqual(
      payload,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://remote-codex.example.test/api/threads/thread-1/export-turns',
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
  });

  it('loads fork turns and forks a selected turn through thread endpoints', async () => {
    const forkTurns = [
      {
        turnId: 'turn-1',
        turnIndex: 1,
        startedAt: '2026-07-01T00:00:00.000Z',
        status: 'completed',
      },
    ];
    const forkResult = {
      thread: {
        thread: {
          id: 'forked-thread',
          title: 'Forked thread',
        },
        turns: [],
      },
      sourceThreadId: 'thread-1',
      sourceTurnId: 'turn-1',
      sourceTurnIndex: 1,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(forkTurns))
      .mockResolvedValueOnce(jsonResponse(forkResult));
    const client = new IOSApiClient(bootstrap());

    await expect(client.fetchForkTurnOptions('thread-1')).resolves.toEqual(
      forkTurns,
    );
    await expect(
      client.forkThread('thread-1', { mode: 'turn', turnId: 'turn-1' }),
    ).resolves.toEqual(forkResult);

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://remote-codex.example.test/api/threads/thread-1/fork-turns',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://remote-codex.example.test/api/threads/thread-1/fork',
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ mode: 'turn', turnId: 'turn-1' }),
      }),
    );
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
  });

  it('loads deferred history item detail with auth', async () => {
    const payload = {
      id: 'command-1',
      kind: 'commandExecution',
      title: 'Command Output',
      text: 'IOS_HISTORY_DETAIL_FULL_OUTPUT',
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(bootstrap());

    await expect(
      client.fetchHistoryItemDetail('thread-1', 'command-1'),
    ).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://remote-codex.example.test/api/threads/thread-1/items/command-1/detail',
    );
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
  });

  it('downloads transcript exports with auth, query options, and response filename', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      downloadResponse('html export', {
        'content-type': 'text/html',
        'content-disposition':
          'attachment; filename="fallback.html"; filename*=UTF-8\'\'ios%20export.html',
      }),
    );
    const client = new IOSApiClient(bootstrap());

    const result = await client.downloadThreadTranscriptExport('thread-1', {
      format: 'html',
      mode: 'selected',
      turnIds: ['turn-2', 'turn-1'],
      profile: 'review',
      options: {
        includeTokenAndPrice: true,
        includeCommandOutput: false,
        includeAbsolutePaths: false,
      },
    });

    expect(result.filename).toBe('ios export.html');
    expect(result.contentType).toBe('text/html');
    expect(result.blob).toBeDefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://remote-codex.example.test/api/threads/thread-1/exports/pdf?format=html&mode=selected&turnIds=turn-2%2Cturn-1&profile=review&includeTokenAndPrice=true&includeCommandOutput=false&includeAbsolutePaths=false',
    );
    expect(init).toEqual(
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
  });

  it('loads workspace tree directories without caching', async () => {
    const payload = {
      name: 'Sources',
      path: 'Sources',
      kind: 'directory',
      hasChildren: true,
      childrenLoaded: true,
      truncated: false,
      children: [],
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(bootstrap());

    await expect(client.fetchWorkspaceTree('workspace-1', 'Sources')).resolves.toEqual(
      payload,
    );

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://remote-codex.example.test/api/workspaces/workspace-1/files/tree?path=Sources',
    );
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
  });

  it('loads workspace file preview chunks with offset, limit, and auth', async () => {
    const payload = {
      path: 'Sources/Long.txt',
      name: 'Long.txt',
      content: 'chunk',
      language: 'text',
      size: 48000,
      truncated: true,
      nextOffset: 24000,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(bootstrap());

    await expect(
      client.fetchWorkspaceFilePreview('workspace-1', {
        path: 'Sources/Long.txt',
        offset: 24000,
        limit: 24000,
      }),
    ).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://remote-codex.example.test/api/workspaces/workspace-1/files/preview?path=Sources%2FLong.txt&offset=24000&limit=24000',
    );
    expect(init).toEqual(
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
  });

  it('builds workspace raw file URLs through the active connection mode', () => {
    const client = new IOSApiClient(
      bootstrap({
        mode: 'relay',
        relayDeviceId: 'device-1',
      }),
    );

    expect(
      client.buildWorkspaceRawFileUrl('workspace-1', {
        path: 'Sources/image 1.png',
      }),
    ).toBe(
      'https://remote-codex.example.test/relay/devices/device-1/api/workspaces/workspace-1/files/raw?path=Sources%2Fimage+1.png',
    );
  });

  it('builds thread image asset URLs with server auth query tokens', () => {
    const client = new IOSApiClient(bootstrap());

    expect(
      client.buildThreadImageAssetUrl('thread-1', {
        path: './.temp/threads/thread-1/image 1.png',
      }),
    ).toBe(
      'https://remote-codex.example.test/api/threads/thread-1/assets/image?path=.%2F.temp%2Fthreads%2Fthread-1%2Fimage+1.png&token=ios-token',
    );
  });

  it('builds thread image asset URLs through relay devices with session query tokens', () => {
    const client = new IOSApiClient(
      bootstrap({
        mode: 'relay',
        relayDeviceId: 'device-1',
      }),
    );

    expect(
      client.buildThreadImageAssetUrl('thread-1', {
        path: './.temp/threads/thread-1/image 1.png',
      }),
    ).toBe(
      'https://remote-codex.example.test/relay/devices/device-1/api/threads/thread-1/assets/image?path=.%2F.temp%2Fthreads%2Fthread-1%2Fimage+1.png&relaySession=ios-token',
    );
  });

  it('omits image asset auth query tokens for unauthenticated local mode', () => {
    const client = new IOSApiClient(
      bootstrap({
        mode: 'local',
        authToken: null,
      }),
    );

    expect(
      client.buildThreadImageAssetUrl('thread-1', {
        path: './.temp/threads/thread-1/image.png',
      }),
    ).toBe(
      'https://remote-codex.example.test/api/threads/thread-1/assets/image?path=.%2F.temp%2Fthreads%2Fthread-1%2Fimage.png',
    );
  });

  it('downloads workspace files with auth and response filename', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      downloadResponse('workspace file', {
        'content-type': 'text/plain',
        'content-disposition':
          'attachment; filename="Long.txt"; filename*=UTF-8\'\'Long.txt',
      }),
    );
    const client = new IOSApiClient(bootstrap());

    const result = await client.downloadWorkspaceNode('workspace-1', {
      path: 'Sources/Long.txt',
    });

    expect(result.filename).toBe('Long.txt');
    expect(result.contentType).toBe('text/plain');
    expect(result.blob).toBeDefined();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://remote-codex.example.test/api/workspaces/workspace-1/files/download?path=Sources%2FLong.txt',
    );
    expect(init).toEqual(
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
  });

  it('uploads workspace files as multipart form data without forcing JSON content type', async () => {
    const payload = {
      kind: 'file',
      file: {
        path: 'Sources/ios-webview-upload.txt',
        name: 'ios-webview-upload.txt',
        size: 36,
      },
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(bootstrap());
    const file = new File(['IOS_WEBVIEW_WORKSPACE_UPLOAD_MARKER\n'], 'ios-webview-upload.txt', {
      type: 'text/plain',
    });

    await expect(
      client.uploadWorkspaceFile('workspace-1', {
        path: 'Sources/ios-webview-upload.txt',
        file,
      }),
    ).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://remote-codex.example.test/api/workspaces/workspace-1/files/upload',
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
    expect((init?.headers as Headers).get('content-type')).toBeNull();
  });

  it('writes workspace files with JSON body and auth', async () => {
    const payload = {
      path: 'Sources/ios-webview-write.txt',
      name: 'ios-webview-write.txt',
      size: 35,
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(payload));
    const client = new IOSApiClient(bootstrap());

    await expect(
      client.writeWorkspaceFile('workspace-1', {
        path: 'Sources/ios-webview-write.txt',
        content: 'IOS_WEBVIEW_WORKSPACE_WRITE_MARKER\n',
      }),
    ).resolves.toEqual(payload);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://remote-codex.example.test/api/workspaces/workspace-1/files',
    );
    expect(init).toEqual(
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          path: 'Sources/ios-webview-write.txt',
          content: 'IOS_WEBVIEW_WORKSPACE_WRITE_MARKER\n',
        }),
      }),
    );
    expect((init?.headers as Headers).get('authorization')).toBe(
      'Bearer ios-token',
    );
    expect((init?.headers as Headers).get('content-type')).toBe(
      'application/json',
    );
  });
});
