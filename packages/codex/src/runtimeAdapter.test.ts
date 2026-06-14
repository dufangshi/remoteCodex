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
}

describe('CodexRuntimeAdapter', () => {
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
});
