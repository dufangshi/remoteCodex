import { describe, expect, it } from 'vitest';

import {
  buildThreadContextUsageFromPayload,
  mergeThreadContextUsageFromPayload,
  shouldResetThreadContextUsageForTurnStart,
} from './thread-usage-accounting';

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

  it('keeps an existing available estimate when a partial live update cannot compute context', () => {
    const current = {
      availability: 'available' as const,
      remainingPercent: 38,
      tokensInContextWindow: 165200,
      modelContextWindow: 258400,
      updatedAt: '2026-05-22T00:00:00.000Z',
    };

    expect(
      mergeThreadContextUsageFromPayload(
        current,
        {
          total: {
            totalTokens: 166000,
            inputTokens: 140800,
            cachedInputTokens: 0,
            outputTokens: 25200,
            reasoningOutputTokens: 0,
          },
        },
        'unknown-model',
        '2026-05-22T00:01:00.000Z',
      ),
    ).toEqual(current);
  });

  it('only resets context display on turn start when no available estimate exists', () => {
    expect(
      shouldResetThreadContextUsageForTurnStart({
        availability: 'available',
        remainingPercent: 38,
        tokensInContextWindow: 165200,
        modelContextWindow: 258400,
        updatedAt: '2026-05-22T00:00:00.000Z',
      }),
    ).toBe(false);

    expect(
      shouldResetThreadContextUsageForTurnStart({
        availability: 'unavailable',
        remainingPercent: null,
        tokensInContextWindow: null,
        modelContextWindow: null,
        updatedAt: null,
      }),
    ).toBe(true);
  });
});
