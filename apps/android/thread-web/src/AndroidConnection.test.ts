import { describe, expect, it } from 'vitest';

import type { AndroidThreadBootstrap } from './AndroidBootstrap';
import {
  supervisorApiUrl,
  supervisorRestPath,
  supervisorWebSocketUrl,
} from './AndroidConnection';

const relayBootstrap: AndroidThreadBootstrap = {
  baseUrl: 'https://remote-codex.example',
  mode: 'relay',
  authToken: 'relay-token',
  relayDeviceId: 'device-123',
  threadId: 'thread-123',
  theme: 'system',
};

describe('AndroidConnection', () => {
  it('routes relay API requests through the selected device', () => {
    expect(supervisorRestPath(relayBootstrap, '/api/threads')).toBe(
      '/relay/devices/device-123/api/threads',
    );
    expect(supervisorApiUrl(relayBootstrap, '/api/threads/thread-123')).toBe(
      'https://remote-codex.example/relay/devices/device-123/api/threads/thread-123',
    );
  });

  it('keeps relay control-plane requests out of the selected device route', () => {
    expect(supervisorRestPath(relayBootstrap, '/relay/portal')).toBe(
      '/relay/portal',
    );
    expect(supervisorRestPath(relayBootstrap, '/relay/access?deviceId=device-123')).toBe(
      '/relay/access?deviceId=device-123',
    );
    expect(supervisorApiUrl(relayBootstrap, '/relay/shares')).toBe(
      'https://remote-codex.example/relay/shares',
    );
  });

  it('falls back to relay-prefixed API routes when no device is selected', () => {
    const bootstrap = {
      ...relayBootstrap,
      relayDeviceId: null,
    };
    expect(supervisorRestPath(bootstrap, '/api/threads')).toBe(
      '/relay/api/threads',
    );
  });

  it('adds relay session tokens to relay websocket URLs', () => {
    expect(supervisorWebSocketUrl(relayBootstrap, { threadId: 'thread-123' })).toBe(
      'wss://remote-codex.example/relay/ws?relaySession=relay-token&threadId=thread-123',
    );
  });

  it('leaves local and server REST paths unchanged', () => {
    expect(
      supervisorRestPath(
        {
          ...relayBootstrap,
          mode: 'local',
          relayDeviceId: null,
        },
        'api/threads',
      ),
    ).toBe('/api/threads');
    expect(
      supervisorRestPath(
        {
          ...relayBootstrap,
          mode: 'server',
          relayDeviceId: null,
        },
        '/api/threads',
      ),
    ).toBe('/api/threads');
  });
});
