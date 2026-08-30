import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AndroidThreadBootstrap } from './AndroidBootstrap';
import { AndroidApiClient } from './AndroidApiClient';

const bootstrap: AndroidThreadBootstrap = {
  baseUrl: 'https://remote-codex.example.test',
  mode: 'server',
  authToken: 'android-token',
  relayDeviceId: null,
  threadId: null,
  theme: 'system',
};

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('AndroidApiClient provider management', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses the canonical provider config routes and PATCH contract', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ name: 'config.toml', path: '/tmp/config.toml', exists: true, content: 'saved' }),
    );
    const client = new AndroidApiClient(bootstrap);

    await client.fetchProviderHostFile('codex', 'config.toml');
    await client.updateProviderHostFile('codex', 'config.toml', { content: 'saved' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://remote-codex.example.test/api/config/providers/codex/files/config.toml',
    );
    expect(fetchMock.mock.calls[1]).toEqual([
      'https://remote-codex.example.test/api/config/providers/codex/files/config.toml',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ content: 'saved' }) }),
    ]);
  });

  it('routes archive and runtime recovery operations through the supervisor', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse({}));
    const client = new AndroidApiClient(bootstrap);

    await client.restartAgentBackend('codex');
    await client.fetchProviderHostConfigArchives('codex');
    await client.createProviderHostConfigArchive('codex', { label: 'Known good' });
    await client.renameProviderHostConfigArchive('codex', 'archive/1', { label: 'Renamed' });
    await client.applyProviderHostConfigArchive('codex', 'archive/1');
    await client.buildAndRestartService();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://remote-codex.example.test/api/agent-runtimes/codex/restart',
      'https://remote-codex.example.test/api/config/providers/codex/archives',
      'https://remote-codex.example.test/api/config/providers/codex/archives',
      'https://remote-codex.example.test/api/config/providers/codex/archives/archive%2F1',
      'https://remote-codex.example.test/api/config/providers/codex/archives/archive%2F1/apply',
      'https://remote-codex.example.test/api/service/build-restart',
    ]);
  });
});
