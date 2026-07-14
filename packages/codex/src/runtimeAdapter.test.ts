import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { CodexRuntimeAdapter } from './runtimeAdapter';
import type { TurnStartInput } from './types';

class FakeCodexManager extends EventEmitter {
  startTurnInput: TurnStartInput | null = null;

  getStatus() {
    return {
      state: 'ready' as const,
      transport: 'stdio' as const,
      lastStartedAt: null,
      lastError: null,
      restartCount: 0,
    };
  }

  async startTurn(input: TurnStartInput) {
    this.startTurnInput = input;
    return {
      id: 'turn-1',
      status: 'completed' as const,
      error: null,
      items: [],
    };
  }

  async readAccount() {
    return { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
  }

  async readAccountRateLimits(): Promise<any> {
    return {
      rateLimits: {},
      rateLimitsByLimitId: {
        codex: {
          primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1_800_000_000 },
          secondary: { usedPercent: 75, windowDurationMins: 10_080, resetsAt: 1_800_604_800 },
        },
      },
    };
  }
}

describe('CodexRuntimeAdapter', () => {
  it('does not terminate a turn while Codex is retrying an upstream request', () => {
    const manager = new FakeCodexManager();
    const adapter = new CodexRuntimeAdapter(manager as never);
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    manager.emit('notification', {
      method: 'error',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        willRetry: true,
        error: {
          message: 'Reconnecting... 1/5',
          additionalDetails: 'unexpected status 404 Not Found',
        },
      },
    });

    expect(events).toEqual([]);
  });

  it('preserves detailed upstream errors when the final retry fails', () => {
    const manager = new FakeCodexManager();
    const adapter = new CodexRuntimeAdapter(manager as never);
    const events: unknown[] = [];
    adapter.on('event', (event) => events.push(event));

    manager.emit('notification', {
      method: 'error',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        willRetry: false,
        error: {
          message: 'Upstream request failed.',
          additionalDetails: JSON.stringify({
            error: {
              message: 'Model "gpt-5.6-sol" is not supported by any configured account in this group',
              type: 'model_not_found',
            },
          }),
        },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'turn.failed',
        providerSessionId: 'thread-1',
        providerTurnId: 'turn-1',
        error: 'Model "gpt-5.6-sol" is not supported by any configured account in this group',
        willRetry: false,
      }),
    ]);
  });

  it('converts prompt photo tokens into structured local image input', async () => {
    const manager = new FakeCodexManager();
    const adapter = new CodexRuntimeAdapter(manager as never);

    await adapter.startTurn({
      providerSessionId: 'thread-1',
      prompt: 'Inspect this [PHOTO ./.temp/threads/thread-1/photo.png] then summarize.',
      workspacePath: '/tmp/workspace',
    });

    expect(manager.startTurnInput).toMatchObject({
      threadId: 'thread-1',
      prompt: 'Inspect this [PHOTO ./.temp/threads/thread-1/photo.png] then summarize.',
      input: [
        { type: 'text', text: 'Inspect this ', text_elements: [] },
        {
          type: 'localImage',
          path: '/tmp/workspace/.temp/threads/thread-1/photo.png',
        },
        { type: 'text', text: ' then summarize.', text_elements: [] },
      ],
    });
  });

  it('keeps mobile photo extensions as structured local image input', async () => {
    const manager = new FakeCodexManager();
    const adapter = new CodexRuntimeAdapter(manager as never);

    await adapter.startTurn({
      providerSessionId: 'thread-1',
      prompt: 'Inspect [PHOTO ./.temp/threads/thread-1/photo.heic].',
      workspacePath: '/tmp/workspace',
    });

    expect(manager.startTurnInput?.input).toEqual([
      { type: 'text', text: 'Inspect ', text_elements: [] },
      {
        type: 'localImage',
        path: '/tmp/workspace/.temp/threads/thread-1/photo.heic',
      },
      { type: 'text', text: '.', text_elements: [] },
    ]);
  });

  it('maps ChatGPT rate-limit windows without assuming fixed durations', async () => {
    const adapter = new CodexRuntimeAdapter(new FakeCodexManager() as never);

    await expect(adapter.getSubscriptionUsage()).resolves.toMatchObject({
      provider: 'codex',
      authKind: 'subscription',
      stale: false,
      windows: [
        { id: 'primary', label: '5h', durationMinutes: 300, usedPercent: 40 },
        { id: 'secondary', label: '7d', durationMinutes: 10_080, usedPercent: 75 },
      ],
    });
  });

  it('uses the populated backward-compatible snapshot when a named bucket is empty', async () => {
    const manager = new FakeCodexManager();
    manager.readAccountRateLimits = async () => ({
      rateLimits: {
        primary: {
          usedPercent: 63,
          windowDurationMins: 10_080,
          resetsAt: 1_800_604_800,
        },
      },
      rateLimitsByLimitId: { codex: { primary: null, secondary: null } },
    });
    const adapter = new CodexRuntimeAdapter(manager as never);

    await expect(adapter.getSubscriptionUsage()).resolves.toMatchObject({
      provider: 'codex',
      authKind: 'subscription',
      windows: [
        { id: 'primary', label: '7d', durationMinutes: 10_080, usedPercent: 63 },
      ],
    });
  });

  it('normalizes legacy snake-case rate-limit window fields', async () => {
    const manager = new FakeCodexManager();
    manager.readAccountRateLimits = async () => ({
      rateLimits: {
        primary: {
          used_percent: 12,
          window_minutes: 300,
          resets_at: 1_800_000_000,
        },
      },
      rateLimitsByLimitId: null,
    });
    const adapter = new CodexRuntimeAdapter(manager as never);

    await expect(adapter.getSubscriptionUsage()).resolves.toMatchObject({
      windows: [{ label: '5h', durationMinutes: 300, usedPercent: 12 }],
    });
  });

  it('hides subscription windows for API-key authentication', async () => {
    const manager = new FakeCodexManager();
    manager.readAccount = async () => ({
      account: { type: 'apiKey' },
      requiresOpenaiAuth: true,
    });
    const adapter = new CodexRuntimeAdapter(manager as never);

    await expect(adapter.getSubscriptionUsage()).resolves.toMatchObject({
      authKind: 'apiKey',
      windows: [],
    });
  });
});
