import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  contextWindowForModel,
  estimateTurnPrice,
  resetPricingConfigCacheForTest,
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
  afterEach(() => {
    resetPricingConfigCacheForTest();
    vi.unstubAllEnvs();
  });

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

  it('prices Claude Sonnet and its 1M context option from the local pricing config', () => {
    expect(supportsFastMode('sonnet')).toBe(false);
    expect(contextWindowForModel('sonnet')).toBe(200000);
    expect(contextWindowForModel('sonnet[1m]')).toBe(1000000);

    const standardEstimate = estimateTurnPrice(sampleUsage, {
      pricingModelKey: 'sonnet',
      pricingTierKey: 'standard',
    });
    expect(standardEstimate).toMatchObject({
      pricingModelKey: 'sonnet',
      pricingTierKey: 'standard',
      inputUsd: 0.003,
      cachedInputUsd: 0.00015,
      outputUsd: 0.0225,
    });

    const oneMillionEstimate = estimateTurnPrice(sampleUsage, {
      pricingModelKey: 'sonnet[1m]',
      pricingTierKey: 'standard',
    });
    expect(oneMillionEstimate).toMatchObject({
      pricingModelKey: 'sonnet[1m]',
      pricingTierKey: 'standard',
      inputUsd: 0.006,
      cachedInputUsd: 0.0003,
      outputUsd: 0.03375,
    });
  });

  it('resolves pricing config from the installed package root when provided', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-pricing-root-'));
    await fs.mkdir(path.join(tempDir, 'config'), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, 'config', 'codex-model-pricing.json'),
      JSON.stringify({
        currency: 'USD',
        tiers: {
          standard: { multiplier: 1 },
          fast: { multiplier: 2 },
        },
        models: {
          'package-model': {
            inputUsdPerMillion: 10,
            cachedInputUsdPerMillion: 1,
            outputUsdPerMillion: 20,
            supportsFastMode: true,
            contextWindowTokens: 123000,
          },
        },
      }),
      'utf8',
    );
    vi.stubEnv('REMOTE_CODEX_PACKAGE_ROOT', tempDir);
    resetPricingConfigCacheForTest();

    expect(contextWindowForModel('package-model')).toBe(123000);
    expect(supportsFastMode('package-model')).toBe(true);
  });
});
