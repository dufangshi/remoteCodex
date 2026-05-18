import { describe, expect, it } from 'vitest';

import {
  contextWindowForModel,
  estimateTurnPrice,
  supportsFastMode,
} from './modelPricing';

const sampleUsage = {
  total: {
    totalTokens: 3000,
    inputTokens: 1500,
    cachedInputTokens: 500,
    outputTokens: 1500,
    reasoningOutputTokens: 0,
  },
  last: {
    totalTokens: 3000,
    inputTokens: 1500,
    cachedInputTokens: 500,
    outputTokens: 1500,
    reasoningOutputTokens: 0,
  },
  modelContextWindow: 272000,
};

describe('modelPricing', () => {
  it('prices gpt-5.5 standard turns from the local pricing config', () => {
    const estimate = estimateTurnPrice(sampleUsage, {
      pricingModelKey: 'gpt-5.5',
      pricingTierKey: 'standard',
    });

    expect(estimate).toMatchObject({
      pricingModelKey: 'gpt-5.5',
      pricingTierKey: 'standard',
      inputUsd: 0.005,
      cachedInputUsd: 0.00025,
      outputUsd: 0.045,
    });
    expect(estimate?.totalUsd).toBeCloseTo(0.05025, 10);
  });

  it('uses the gpt-5.5-specific fast multiplier and marks it fast-capable', () => {
    expect(supportsFastMode('gpt-5.5')).toBe(true);
    expect(contextWindowForModel('gpt-5.5')).toBe(272000);

    const estimate = estimateTurnPrice(sampleUsage, {
      pricingModelKey: 'gpt-5.5',
      pricingTierKey: 'fast',
    });

    expect(estimate).toMatchObject({
      pricingModelKey: 'gpt-5.5',
      pricingTierKey: 'fast',
      inputUsd: 0.0125,
      cachedInputUsd: 0.000625,
      outputUsd: 0.1125,
    });
    expect(estimate?.totalUsd).toBeCloseTo(0.125625, 10);
  });
});
