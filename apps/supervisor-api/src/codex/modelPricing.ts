import fs from 'node:fs';
import path from 'node:path';

import { ThreadTurnPriceEstimateDto, ThreadTurnTokenUsageDto } from '../../../../packages/shared/src/index';

export type PricingTierKey = 'standard' | 'fast';

interface ModelPricingEntry {
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number;
  outputUsdPerMillion: number;
  supportsFastMode: boolean;
  fastMultiplier?: number;
  contextWindowTokens?: number;
}

interface PricingTierConfig {
  multiplier: number;
}

interface TurnPricingSnapshot {
  pricingModelKey: string;
  pricingTierKey: PricingTierKey;
}

interface PricingConfig {
  currency: 'USD';
  tiers: Record<PricingTierKey, PricingTierConfig>;
  models: Record<string, ModelPricingEntry>;
}

const TOKEN_PRICE_DENOMINATOR = 1_000_000;
let cachedPricingConfig: PricingConfig | null = null;

function resolveRepoRoot(start = process.cwd()) {
  let current = path.resolve(start);

  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    current = path.dirname(current);
  }

  throw new Error('Unable to locate repository root for Codex pricing config.');
}

function getPricingConfigPath() {
  return path.join(resolveRepoRoot(), 'config', 'codex-model-pricing.json');
}

function isPositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parsePricingConfig(raw: unknown): PricingConfig {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Pricing config must be a JSON object.');
  }

  const config = raw as {
    currency?: unknown;
    tiers?: unknown;
    models?: unknown;
  };

  if (config.currency !== 'USD') {
    throw new Error('Pricing config currency must be "USD".');
  }

  if (!config.tiers || typeof config.tiers !== 'object') {
    throw new Error('Pricing config must include a "tiers" object.');
  }
  if (!config.models || typeof config.models !== 'object') {
    throw new Error('Pricing config must include a "models" object.');
  }

  const tiersSource = config.tiers as Record<string, unknown>;
  const modelsSource = config.models as Record<string, unknown>;

  const tiers: Record<PricingTierKey, PricingTierConfig> = {
    standard: {
      multiplier: 1,
    },
    fast: {
      multiplier: 1,
    },
  };

  for (const tierKey of ['standard', 'fast'] as const) {
    const value = tiersSource[tierKey];
    if (!value || typeof value !== 'object') {
      throw new Error(`Pricing config tier "${tierKey}" is missing or invalid.`);
    }

    const multiplier = (value as { multiplier?: unknown }).multiplier;
    if (!isPositiveNumber(multiplier)) {
      throw new Error(`Pricing config tier "${tierKey}" multiplier must be a non-negative number.`);
    }

    tiers[tierKey] = {
      multiplier: multiplier as number,
    };
  }

  const models: Record<string, ModelPricingEntry> = {};
  for (const [modelKey, value] of Object.entries(modelsSource)) {
    if (!value || typeof value !== 'object') {
      throw new Error(`Pricing config model "${modelKey}" is invalid.`);
    }

    const entry = value as {
      inputUsdPerMillion?: unknown;
      cachedInputUsdPerMillion?: unknown;
      outputUsdPerMillion?: unknown;
      supportsFastMode?: unknown;
      fastMultiplier?: unknown;
      contextWindowTokens?: unknown;
    };

    if (
      !isPositiveNumber(entry.inputUsdPerMillion) ||
      !isPositiveNumber(entry.cachedInputUsdPerMillion) ||
      !isPositiveNumber(entry.outputUsdPerMillion) ||
      typeof entry.supportsFastMode !== 'boolean'
    ) {
      throw new Error(`Pricing config model "${modelKey}" has invalid fields.`);
    }
    if (
      entry.fastMultiplier !== undefined &&
      !isPositiveNumber(entry.fastMultiplier)
    ) {
      throw new Error(`Pricing config model "${modelKey}" fastMultiplier must be a non-negative number.`);
    }
    if (
      entry.contextWindowTokens !== undefined &&
      !isPositiveNumber(entry.contextWindowTokens)
    ) {
      throw new Error(`Pricing config model "${modelKey}" contextWindowTokens must be a non-negative number.`);
    }

    models[modelKey] = {
      inputUsdPerMillion: entry.inputUsdPerMillion as number,
      cachedInputUsdPerMillion: entry.cachedInputUsdPerMillion as number,
      outputUsdPerMillion: entry.outputUsdPerMillion as number,
      supportsFastMode: entry.supportsFastMode,
      ...(entry.fastMultiplier !== undefined
        ? { fastMultiplier: entry.fastMultiplier as number }
        : {}),
      ...(entry.contextWindowTokens !== undefined
        ? { contextWindowTokens: entry.contextWindowTokens as number }
        : {}),
    };
  }

  return {
    currency: 'USD',
    tiers,
    models,
  };
}

function getPricingConfig() {
  if (cachedPricingConfig) {
    return cachedPricingConfig;
  }

  const configPath = getPricingConfigPath();
  const content = fs.readFileSync(configPath, 'utf8');
  cachedPricingConfig = parsePricingConfig(JSON.parse(content) as unknown);
  return cachedPricingConfig;
}

export function pricingTierForFastMode(fastMode: boolean): PricingTierKey {
  return fastMode ? 'fast' : 'standard';
}

export function supportsFastMode(model: string | null | undefined) {
  if (!model) {
    return false;
  }

  return getPricingConfig().models[model]?.supportsFastMode === true;
}

export function contextWindowForModel(model: string | null | undefined) {
  if (!model) {
    return null;
  }

  const contextWindow = getPricingConfig().models[model]?.contextWindowTokens;
  return typeof contextWindow === 'number' && contextWindow > 0
    ? contextWindow
    : null;
}

export function buildTurnPricingSnapshot(
  model: string | null | undefined,
  fastMode: boolean,
): TurnPricingSnapshot | null {
  const pricingModelKey = model?.trim();
  if (!pricingModelKey) {
    return null;
  }

  return {
    pricingModelKey,
    pricingTierKey: pricingTierForFastMode(fastMode),
  };
}

export function estimateTurnPrice(
  usage: ThreadTurnTokenUsageDto | null | undefined,
  snapshot:
    | {
        pricingModelKey: string | null | undefined;
        pricingTierKey: PricingTierKey | string | null | undefined;
      }
    | null
    | undefined,
): ThreadTurnPriceEstimateDto | null {
  if (!usage?.total) {
    return null;
  }

  const pricingModelKey = snapshot?.pricingModelKey?.trim();
  if (!pricingModelKey) {
    return null;
  }

  const pricingConfig = getPricingConfig();
  const modelPricing = pricingConfig.models[pricingModelKey];
  if (!modelPricing) {
    return null;
  }

  const tierKey =
    snapshot?.pricingTierKey === 'fast' ? 'fast' : snapshot?.pricingTierKey === 'standard'
      ? 'standard'
      : null;
  if (!tierKey) {
    return null;
  }

  const tier = pricingConfig.tiers[tierKey];
  if (!tier) {
    return null;
  }

  const nonCachedInputTokens = Math.max(
    usage.total.inputTokens - usage.total.cachedInputTokens,
    0,
  );
  const cachedInputTokens = Math.max(usage.total.cachedInputTokens, 0);
  const outputTokens = Math.max(usage.total.outputTokens, 0);
  const multiplier =
    tierKey === 'fast' && modelPricing.fastMultiplier !== undefined
      ? modelPricing.fastMultiplier
      : tier.multiplier;

  const inputUsd =
    (nonCachedInputTokens * modelPricing.inputUsdPerMillion * multiplier) /
    TOKEN_PRICE_DENOMINATOR;
  const cachedInputUsd =
    (cachedInputTokens * modelPricing.cachedInputUsdPerMillion * multiplier) /
    TOKEN_PRICE_DENOMINATOR;
  const outputUsd =
    (outputTokens * modelPricing.outputUsdPerMillion * multiplier) /
    TOKEN_PRICE_DENOMINATOR;

  return {
    pricingModelKey,
    pricingTierKey: tierKey,
    currency: pricingConfig.currency,
    inputUsd,
    cachedInputUsd,
    outputUsd,
    totalUsd: inputUsd + cachedInputUsd + outputUsd,
  };
}
