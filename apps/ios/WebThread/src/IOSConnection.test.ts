import { describe, expect, it } from 'vitest';

import type { IOSBootstrap } from './IOSBootstrap';
import {
  supervisorApiUrl,
  supervisorRestPath,
  supervisorWebSocketUrl,
} from './IOSConnection';

function bootstrap(overrides: Partial<IOSBootstrap>): IOSBootstrap {
  return {
    baseUrl: 'https://remote-codex.example.test',
    mode: 'local',
    authToken: null,
    relayDeviceId: null,
    threadId: null,
    theme: 'system',
    fixture: false,
    ...overrides,
  };
}

describe('iOS supervisor connection paths', () => {
  it('keeps local and server REST paths direct', () => {
    expect(supervisorRestPath(bootstrap({ mode: 'local' }), '/api/threads')).toBe('/api/threads');
    expect(supervisorRestPath(bootstrap({ mode: 'server' }), 'api/threads')).toBe('/api/threads');
  });

  it('prefixes relay REST paths with the selected device', () => {
    expect(
      supervisorRestPath(
        bootstrap({ mode: 'relay', relayDeviceId: 'device/with spaces' }),
        '/api/threads',
      ),
    ).toBe('/relay/devices/device%2Fwith%20spaces/api/threads');
  });

  it('keeps relay control-plane paths out of the selected device route', () => {
    expect(
      supervisorRestPath(
        bootstrap({ mode: 'relay', relayDeviceId: 'device-a' }),
        '/relay/portal',
      ),
    ).toBe('/relay/portal');
    expect(
      supervisorRestPath(
        bootstrap({ mode: 'relay', relayDeviceId: 'device-a' }),
        '/relay/access?deviceId=device-a',
      ),
    ).toBe('/relay/access?deviceId=device-a');
  });

  it('falls back to relay session REST paths without a selected device', () => {
    expect(supervisorRestPath(bootstrap({ mode: 'relay' }), '/api/threads')).toBe('/relay/api/threads');
  });

  it('builds absolute API URLs from the normalized origin', () => {
    expect(supervisorApiUrl(bootstrap({ mode: 'server' }), '/api/threads/t1')).toBe(
      'https://remote-codex.example.test/api/threads/t1',
    );
  });

  it('uses token query names that match server and relay modes', () => {
    expect(supervisorWebSocketUrl(bootstrap({ mode: 'server', authToken: 'server-token' }))).toBe(
      'wss://remote-codex.example.test/ws?token=server-token',
    );
    expect(
      supervisorWebSocketUrl(
        bootstrap({
          mode: 'relay',
          relayDeviceId: 'device-a',
          authToken: 'relay token',
        }),
      ),
    ).toBe(
      'wss://remote-codex.example.test/relay/ws?relaySession=relay%20token',
    );
  });

  it('adds thread ids to relay websocket URLs', () => {
    expect(
      supervisorWebSocketUrl(
        bootstrap({
          mode: 'relay',
          relayDeviceId: 'device-a',
          authToken: 'relay token',
        }),
        { threadId: 'thread-a' },
      ),
    ).toBe(
      'wss://remote-codex.example.test/relay/ws?relaySession=relay%20token&threadId=thread-a',
    );
  });

  it('falls back to relay session websocket paths without a selected device', () => {
    expect(
      supervisorWebSocketUrl(
        bootstrap({
          mode: 'relay',
          relayDeviceId: null,
          authToken: 'relay token',
        }),
      ),
    ).toBe('wss://remote-codex.example.test/relay/ws?relaySession=relay%20token');
  });
});
