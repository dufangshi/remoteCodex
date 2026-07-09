import {
  getThreadTurnMetadataByThreadAndTurnId,
  listThreadTurnMetadataByThreadId,
  upsertThreadTurnMetadata,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import {
  ThreadContextUsageDto,
  ThreadTurnPriceEstimateDto,
  ThreadTurnPricingTierDto,
  ThreadTurnTokenUsageDto,
} from '../../../packages/shared/src/index';
import {
  buildTurnPricingSnapshot,
  contextWindowForModel,
  estimateTurnPrice,
} from '../../../packages/agent-runtime/src/index';

const CONTEXT_BASELINE_TOKENS = 12_000;

export interface ThreadContextTokenUsagePayload {
  total?: Record<string, unknown> | null;
  last?: Record<string, unknown> | null;
  modelContextWindow?: unknown;
  model_context_window?: unknown;
}

export interface ThreadTurnTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface StoredThreadTurnTokenUsageState {
  baselineTotal: ThreadTurnTokenUsageBreakdown | null;
  usage: ThreadTurnTokenUsageDto | null;
}

export interface ThreadUsageUpdateResult {
  tokenUsage: ThreadTurnTokenUsageDto;
  priceEstimate: ThreadTurnPriceEstimateDto | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizePricingTier(
  value: string | null | undefined,
): ThreadTurnPricingTierDto | null {
  return value === 'fast' || value === 'standard' ? value : null;
}

export function buildThreadTurnPricingSnapshot(
  model: string | null | undefined,
  fastMode: boolean,
): { pricingModelKey: string; pricingTierKey: ThreadTurnPricingTierDto } | null {
  return buildTurnPricingSnapshot(model, fastMode);
}

export function estimateThreadTurnPrice(
  usage: ThreadTurnTokenUsageDto | null | undefined,
  snapshot:
    | {
        pricingModelKey: string | null | undefined;
        pricingTierKey: ThreadTurnPricingTierDto | string | null | undefined;
      }
    | null
    | undefined,
) {
  return estimateTurnPrice(usage, snapshot);
}

export function createUnavailableThreadContextUsage(
  timestamp: string | null = new Date().toISOString(),
): ThreadContextUsageDto {
  return {
    availability: 'unavailable',
    remainingPercent: null,
    tokensInContextWindow: null,
    modelContextWindow: null,
    updatedAt: timestamp,
  };
}

function clampPercentage(value: number) {
  return Math.max(0, Math.min(100, value));
}

function computeContextRemainingPercent(
  tokensInContextWindow: number,
  contextWindow: number,
) {
  if (contextWindow <= CONTEXT_BASELINE_TOKENS) {
    return 0;
  }

  const effectiveWindow = contextWindow - CONTEXT_BASELINE_TOKENS;
  const used = Math.max(tokensInContextWindow - CONTEXT_BASELINE_TOKENS, 0);
  const remaining = Math.max(effectiveWindow - used, 0);
  return clampPercentage(Math.round((remaining / effectiveWindow) * 100));
}

export function buildThreadContextUsageFromPayload(
  payload: ThreadContextTokenUsagePayload | null | undefined,
  model: string | null | undefined = null,
  timestamp = new Date().toISOString(),
): ThreadContextUsageDto {
  const tokenUsage = isRecord(payload) ? payload : null;
  const modelContextWindow =
    numberOrNull(
      tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window,
    ) ??
    contextWindowForModel(model);
  const lastUsage = isRecord(tokenUsage?.last) ? tokenUsage.last : null;
  const tokensInContextWindow = numberOrNull(
    lastUsage?.totalTokens ?? lastUsage?.total_tokens,
  );

  if (
    modelContextWindow === null ||
    tokensInContextWindow === null ||
    modelContextWindow <= 0
  ) {
    return createUnavailableThreadContextUsage(timestamp);
  }

  return {
    availability: 'available',
    remainingPercent: computeContextRemainingPercent(
      tokensInContextWindow,
      modelContextWindow,
    ),
    tokensInContextWindow,
    modelContextWindow,
    updatedAt: timestamp,
  };
}

export function mergeThreadContextUsageFromPayload(
  current: ThreadContextUsageDto | null | undefined,
  payload: ThreadContextTokenUsagePayload | null | undefined,
  model: string | null | undefined = null,
  timestamp = new Date().toISOString(),
): ThreadContextUsageDto {
  const next = buildThreadContextUsageFromPayload(payload, model, timestamp);
  if (next.availability === 'available') {
    return next;
  }

  if (current?.availability === 'available') {
    return current;
  }

  return next;
}

export function shouldResetThreadContextUsageForTurnStart(
  current: ThreadContextUsageDto | null | undefined,
) {
  return current?.availability !== 'available';
}

export function buildTurnTokenBreakdown(
  payload: Record<string, unknown> | null | undefined,
): ThreadTurnTokenUsageBreakdown | null {
  const usage = isRecord(payload) ? payload : null;
  const inputDetails = isRecord(
    usage?.inputTokensDetails ?? usage?.input_tokens_details,
  )
    ? (usage?.inputTokensDetails ?? usage?.input_tokens_details) as Record<string, unknown>
    : null;
  const cache = isRecord(usage?.cache) ? usage.cache : null;
  const totalTokens = numberOrNull(usage?.totalTokens ?? usage?.total_tokens);
  const inputTokens = numberOrNull(usage?.inputTokens ?? usage?.input_tokens);
  const cachedInputTokens = numberOrNull(
    usage?.cachedInputTokens ??
      usage?.cached_input_tokens ??
      inputDetails?.cachedTokens ??
      inputDetails?.cached_tokens ??
      cache?.read,
  );
  const cacheWriteInputTokens =
    numberOrNull(
      usage?.cacheWriteInputTokens ??
        usage?.cache_write_input_tokens ??
        usage?.cacheWriteTokens ??
        usage?.cache_write_tokens ??
        usage?.cacheCreationInputTokens ??
        usage?.cache_creation_input_tokens ??
        inputDetails?.cacheWriteTokens ??
        inputDetails?.cache_write_tokens ??
        cache?.write,
    ) ?? 0;
  const outputTokens = numberOrNull(usage?.outputTokens ?? usage?.output_tokens);
  const reasoningOutputTokens = numberOrNull(
    usage?.reasoningOutputTokens ?? usage?.reasoning_output_tokens,
  );

  if (
    totalTokens === null ||
    inputTokens === null ||
    cachedInputTokens === null ||
    outputTokens === null ||
    reasoningOutputTokens === null
  ) {
    return null;
  }

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningOutputTokens,
  };
}

export function zeroTurnTokenBreakdown(): ThreadTurnTokenUsageBreakdown {
  return {
    totalTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function subtractTurnTokenBreakdowns(
  current: ThreadTurnTokenUsageBreakdown,
  previous: ThreadTurnTokenUsageBreakdown,
): ThreadTurnTokenUsageBreakdown {
  return {
    totalTokens: Math.max(current.totalTokens - previous.totalTokens, 0),
    inputTokens: Math.max(current.inputTokens - previous.inputTokens, 0),
    cachedInputTokens: Math.max(
      current.cachedInputTokens - previous.cachedInputTokens,
      0,
    ),
    cacheWriteInputTokens: Math.max(
      current.cacheWriteInputTokens - previous.cacheWriteInputTokens,
      0,
    ),
    outputTokens: Math.max(current.outputTokens - previous.outputTokens, 0),
    reasoningOutputTokens: Math.max(
      current.reasoningOutputTokens - previous.reasoningOutputTokens,
      0,
    ),
  };
}

function parseThreadTurnTokenUsage(
  payload: Record<string, unknown> | null | undefined,
): ThreadTurnTokenUsageDto | null {
  const tokenUsage = isRecord(payload) ? payload : null;
  const total = buildTurnTokenBreakdown(
    isRecord(tokenUsage?.total) ? tokenUsage.total : null,
  );
  const last = buildTurnTokenBreakdown(
    isRecord(tokenUsage?.last) ? tokenUsage.last : null,
  );
  const modelContextWindow = numberOrNull(
    tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window,
  );

  if (!total || !last) {
    return null;
  }

  return {
    total,
    last,
    modelContextWindow,
  };
}

export function parseStoredThreadTurnTokenUsageState(
  value: string | null | undefined,
): StoredThreadTurnTokenUsageState {
  if (!value) {
    return {
      baselineTotal: null,
      usage: null,
    };
  }

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const baselineTotal = buildTurnTokenBreakdown(
      isRecord(parsed?.baselineTotal) ? parsed.baselineTotal : null,
    );

    return {
      baselineTotal,
      usage: parseThreadTurnTokenUsage(parsed),
    };
  } catch {
    return {
      baselineTotal: null,
      usage: null,
    };
  }
}

export function parseThreadTurnTokenUsageJson(
  value: string | null | undefined,
): ThreadTurnTokenUsageDto | null {
  return parseStoredThreadTurnTokenUsageState(value).usage;
}

function cumulativeTotalFromStoredThreadTurnTokenUsageState(
  state: StoredThreadTurnTokenUsageState,
): ThreadTurnTokenUsageBreakdown | null {
  if (!state.usage?.total) {
    return null;
  }

  if (!state.baselineTotal) {
    return {
      ...state.usage.total,
      cacheWriteInputTokens: state.usage.total.cacheWriteInputTokens ?? 0,
    };
  }

  return {
    totalTokens: state.baselineTotal.totalTokens + state.usage.total.totalTokens,
    inputTokens: state.baselineTotal.inputTokens + state.usage.total.inputTokens,
    cachedInputTokens:
      state.baselineTotal.cachedInputTokens + state.usage.total.cachedInputTokens,
    cacheWriteInputTokens:
      state.baselineTotal.cacheWriteInputTokens +
      (state.usage.total.cacheWriteInputTokens ?? 0),
    outputTokens: state.baselineTotal.outputTokens + state.usage.total.outputTokens,
    reasoningOutputTokens:
      state.baselineTotal.reasoningOutputTokens +
      state.usage.total.reasoningOutputTokens,
  };
}

export function stringifyStoredThreadTurnTokenUsageState(
  state: StoredThreadTurnTokenUsageState,
) {
  return JSON.stringify({
    baselineTotal: state.baselineTotal,
    total: state.usage?.total ?? null,
    last: state.usage?.last ?? null,
    modelContextWindow: state.usage?.modelContextWindow ?? null,
  });
}

function buildThreadTurnTokenUsage(
  payload: ThreadContextTokenUsagePayload | null | undefined,
  baselineTotal: ThreadTurnTokenUsageBreakdown,
  previous: ThreadTurnTokenUsageDto | null = null,
): ThreadTurnTokenUsageDto | null {
  const tokenUsage = isRecord(payload) ? payload : null;
  const cumulativeTotal = buildTurnTokenBreakdown(
    isRecord(tokenUsage?.total) ? tokenUsage.total : null,
  );
  const last = buildTurnTokenBreakdown(
    isRecord(tokenUsage?.last) ? tokenUsage.last : null,
  );
  const modelContextWindow = numberOrNull(
    tokenUsage?.modelContextWindow ?? tokenUsage?.model_context_window,
  );
  const isCumulative = tokenUsage?.cumulative !== false;

  if (!last) {
    return null;
  }

  return {
    total:
      cumulativeTotal && isCumulative
        ? subtractTurnTokenBreakdowns(cumulativeTotal, baselineTotal)
        : previous?.total ?? last,
    last,
    modelContextWindow:
      modelContextWindow ?? previous?.modelContextWindow ?? null,
  };
}

export class ThreadUsageAccounting {
  private readonly threadContextUsage = new Map<string, ThreadContextUsageDto>();
  private readonly threadCumulativeTokenUsage = new Map<
    string,
    ThreadTurnTokenUsageBreakdown
  >();

  constructor(private readonly db: DatabaseClient) {}

  clearThread(localThreadId: string) {
    this.threadContextUsage.delete(localThreadId);
    this.threadCumulativeTokenUsage.delete(localThreadId);
  }

  getThreadContextUsage(localThreadId: string): ThreadContextUsageDto {
    return (
      this.threadContextUsage.get(localThreadId) ??
      createUnavailableThreadContextUsage(null)
    );
  }

  setThreadContextUsage(localThreadId: string, usage: ThreadContextUsageDto) {
    this.threadContextUsage.set(localThreadId, usage);
  }

  resetThreadContextUsage(localThreadId: string) {
    this.setThreadContextUsage(
      localThreadId,
      createUnavailableThreadContextUsage(),
    );
  }

  latestStoredThreadCumulativeTotal(
    localThreadId: string,
    options: { excludeTurnId?: string } = {},
  ): ThreadTurnTokenUsageBreakdown | null {
    const metadata = listThreadTurnMetadataByThreadId(this.db, localThreadId)
      .filter((entry) => entry.turnId !== options.excludeTurnId)
      .sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? '') || 0;
        const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? '') || 0;
        return rightTime - leftTime;
      });

    for (const entry of metadata) {
      const cumulative = cumulativeTotalFromStoredThreadTurnTokenUsageState(
        parseStoredThreadTurnTokenUsageState(entry.tokenUsageJson),
      );
      if (cumulative) {
        return cumulative;
      }
    }

    return null;
  }

  turnStartBaseline(
    localThreadId: string,
    turnId: string,
  ): ThreadTurnTokenUsageBreakdown {
    return (
      this.threadCumulativeTokenUsage.get(localThreadId) ??
      this.latestStoredThreadCumulativeTotal(localThreadId, {
        excludeTurnId: turnId,
      }) ??
      zeroTurnTokenBreakdown()
    );
  }

  updateTurnUsage(input: {
    localThreadId: string;
    turnId: string;
    tokenUsage: ThreadContextTokenUsagePayload | null;
  }): ThreadUsageUpdateResult | null {
    const existingTurnMetadata = getThreadTurnMetadataByThreadAndTurnId(
      this.db,
      input.localThreadId,
      input.turnId,
    );
    const previousState = parseStoredThreadTurnTokenUsageState(
      existingTurnMetadata?.tokenUsageJson,
    );
    const previousCumulativeTotal = this.threadCumulativeTokenUsage.get(
      input.localThreadId,
    );
    const currentCumulativeTotal = buildTurnTokenBreakdown(
      isRecord(input.tokenUsage?.total) ? input.tokenUsage.total : null,
    );
    if (currentCumulativeTotal) {
      this.threadCumulativeTokenUsage.set(input.localThreadId, currentCumulativeTotal);
    }
    const baselineTotal =
      previousState.baselineTotal ??
      previousCumulativeTotal ??
      this.latestStoredThreadCumulativeTotal(input.localThreadId, {
        excludeTurnId: input.turnId,
      }) ??
      zeroTurnTokenBreakdown();
    const turnTokenUsage = buildThreadTurnTokenUsage(
      input.tokenUsage,
      baselineTotal,
      previousState.usage,
    );
    if (!turnTokenUsage) {
      return null;
    }

    upsertThreadTurnMetadata(this.db, {
      threadId: input.localThreadId,
      turnId: input.turnId,
      tokenUsageJson: stringifyStoredThreadTurnTokenUsageState({
        baselineTotal,
        usage: turnTokenUsage,
      }),
    });

    return {
      tokenUsage: turnTokenUsage,
      priceEstimate: estimateTurnPrice(turnTokenUsage, {
        pricingModelKey: existingTurnMetadata?.pricingModelKey,
        pricingTierKey: normalizePricingTier(existingTurnMetadata?.pricingTierKey),
      }),
    };
  }

}
