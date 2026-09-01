import { describe, expect, it, vi } from 'vitest';

import {
  REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL,
  type HarnessExtensionEventEnvelope,
} from './extensions';
import {
  HarnessExtensionInvocationError,
  HarnessExtensionRegistry,
} from './extension-registry';

const descriptor = {
  id: 'fixture.session',
  version: 1,
  stability: 'experimental' as const,
  methods: ['compact'],
  events: ['checkpoint'],
};

describe('HarnessExtensionRegistry', () => {
  it('enforces one owner and deduplicates idempotent calls', async () => {
    const registry = new HarnessExtensionRegistry();
    const request = vi.fn(async () => ({ compacted: true }));
    registry.register({
      ownerId: 'owner-1',
      descriptor,
      transport: { request },
      capabilityPatch: {
        turns: { compact: true },
        controls: { goals: true },
      },
      paramMappers: {
        compact: (envelope) => ({
          sessionId: (envelope.params as { providerSessionId: string }).providerSessionId,
        }),
      },
    });
    expect(() => registry.register({
      ownerId: 'owner-2',
      descriptor,
      transport: { request },
    })).toThrow(/already owned/);
    const input = {
      extensionId: 'fixture.session',
      extensionVersion: 1,
      method: 'compact',
      operationId: 'operation-1',
      idempotencyKey: 'thread-1:compact:1',
      params: { providerSessionId: 'session-1' },
    };
    const [first, second] = await Promise.all([
      registry.invoke(input),
      registry.invoke(input),
    ]);
    expect(first).toEqual({ compacted: true });
    expect(second).toEqual(first);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      'remoteCodex/fixture.session/v1/compact',
      { sessionId: 'session-1' },
      expect.any(AbortSignal),
    );
    expect(registry.effectiveCapabilities({
      sessions: { list: true, read: true, resume: true, importLocal: false },
      turns: { start: true, streamInput: false, steer: false, interrupt: true, compact: false },
      branching: { fork: false, hardRollback: false, resumeAt: false, rewindFiles: false },
      controls: {
        planMode: true,
        permissionRequests: true,
        sandboxMode: true,
        performanceMode: false,
        goals: false,
      },
      management: {
        models: false,
        mcpStatus: false,
        skills: false,
        hooks: false,
        hookTrust: false,
        hostConfigFiles: false,
        providerSettings: false,
      },
      usage: { contextWindow: true, tokenUsage: true, costUsd: false },
    })).toMatchObject({
      turns: { compact: true },
      controls: { goals: true },
    });
    await expect(registry.invoke({
      ...input,
      params: { providerSessionId: 'session-2' },
    })).rejects.toMatchObject({
      payload: { code: 'idempotency_conflict', retryable: false },
    });
    await expect(registry.invoke({
      ...input,
      extensionVersion: 2,
      idempotencyKey: 'thread-1:compact:v2',
    })).rejects.toMatchObject({
      payload: { code: 'extension_method_unavailable', retryable: false },
    });
  });

  it('times out, aborts transport, and permits an explicit retry', async () => {
    const registry = new HarnessExtensionRegistry();
    let calls = 0;
    registry.register({
      ownerId: 'owner-1',
      descriptor,
      transport: {
        request: async (_method, _params, signal) => {
          calls += 1;
          await new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
          return {};
        },
      },
    });
    const input = {
      extensionId: 'fixture.session',
      extensionVersion: 1,
      method: 'compact',
      operationId: 'operation-timeout',
      idempotencyKey: 'thread-1:compact:timeout',
      params: {},
      timeoutMs: 5,
    };
    await expect(registry.invoke(input)).rejects.toBeInstanceOf(
      HarnessExtensionInvocationError,
    );
    await expect(registry.invoke(input)).rejects.toMatchObject({
      payload: { code: 'extension_timeout', retryable: true },
    });
    expect(calls).toBe(2);
  });

  it('cancels promptly even when transport ignores abort and does not dispatch pre-aborted calls', async () => {
    const registry = new HarnessExtensionRegistry();
    const request = vi.fn(async () => new Promise<never>(() => {}));
    registry.register({
      ownerId: 'owner-1',
      descriptor,
      transport: { request },
    });
    const preAborted = new AbortController();
    preAborted.abort(new Error('already cancelled'));
    const input = {
      extensionId: 'fixture.session',
      extensionVersion: 1,
      method: 'compact',
      operationId: 'operation-cancel',
      idempotencyKey: 'thread-1:compact:cancel',
      params: {},
      timeoutMs: 10_000,
    };

    await expect(registry.invoke({
      ...input,
      signal: preAborted.signal,
    })).rejects.toMatchObject({
      payload: { code: 'extension_cancelled', retryable: true },
    });
    expect(request).not.toHaveBeenCalled();

    const controller = new AbortController();
    const pending = registry.invoke({ ...input, signal: controller.signal });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    controller.abort(new Error('cancel now'));
    await expect(pending).rejects.toMatchObject({
      payload: { code: 'extension_cancelled', retryable: true },
    });
  });

  it('validates and deduplicates declared extension events', () => {
    const registry = new HarnessExtensionRegistry();
    registry.register({
      ownerId: 'owner-1',
      descriptor,
      transport: { request: async () => ({}) },
    });
    const events: HarnessExtensionEventEnvelope[] = [];
    registry.on('event', (event) => events.push(event));
    const event: HarnessExtensionEventEnvelope = {
      protocol: REMOTE_CODEX_HARNESS_EXTENSION_PROTOCOL,
      extensionId: 'fixture.session',
      extensionVersion: 1,
      event: 'checkpoint',
      operationId: 'operation-1',
      providerSessionId: 'session-1',
      providerTurnId: 'turn-1',
      providerItemId: 'checkpoint-1',
      sequence: 1,
      payload: { status: 'completed' },
    };
    expect(registry.handleEvent('owner-1', event)).toBe(true);
    expect(registry.handleEvent('owner-1', event)).toBe(false);
    expect(events).toHaveLength(1);
  });
});
