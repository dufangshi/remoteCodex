import { describe, expect, it } from 'vitest';

import {
  REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL,
  createHarnessExtensionCall,
  harnessExtensionMethodName,
} from './extensions';

describe('harness extension contract', () => {
  it('creates versioned, idempotent extension calls', () => {
    expect(createHarnessExtensionCall({
      extensionId: 'codex.session',
      extensionVersion: 1,
      method: 'compact',
      operationId: 'operation-1',
      idempotencyKey: 'thread-1:compact:operation-1',
      params: { providerSessionId: 'session-1' },
    })).toEqual({
      protocol: REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL,
      extensionId: 'codex.session',
      extensionVersion: 1,
      method: 'compact',
      operationId: 'operation-1',
      idempotencyKey: 'thread-1:compact:operation-1',
      params: { providerSessionId: 'session-1' },
    });
    expect(harnessExtensionMethodName('codex.session', 1, 'compact')).toBe(
      'remoteCodex/codex.session/v1/compact',
    );
  });

  it('rejects ambiguous names and missing idempotency fields', () => {
    expect(() => harnessExtensionMethodName('Codex Session', 1, 'compact')).toThrow(
      /lowercase extension identifier/,
    );
    expect(() => createHarnessExtensionCall({
      extensionId: 'codex.session',
      extensionVersion: 1,
      method: 'compact',
      operationId: '',
      idempotencyKey: '',
      params: {},
    })).toThrow(/operation id is required/);
  });
});
