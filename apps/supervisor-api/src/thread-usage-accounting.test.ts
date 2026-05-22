import { describe, expect, it } from 'vitest';

import { buildThreadContextUsageFromPayload } from './thread-usage-accounting';

describe('buildThreadContextUsageFromPayload', () => {
  it('prefers the runtime context window over local model pricing metadata', () => {
    const usage = buildThreadContextUsageFromPayload(
      {
        last: {
          totalTokens: 500000,
          inputTokens: 495000,
          cachedInputTokens: 0,
          outputTokens: 5000,
          reasoningOutputTokens: 0,
        },
        modelContextWindow: 1000000,
      },
      'claude-sonnet-4-5',
      '2026-05-22T00:00:00.000Z',
    );

    expect(usage).toEqual({
      availability: 'available',
      remainingPercent: 51,
      tokensInContextWindow: 500000,
      modelContextWindow: 1000000,
      updatedAt: '2026-05-22T00:00:00.000Z',
    });
  });
});
