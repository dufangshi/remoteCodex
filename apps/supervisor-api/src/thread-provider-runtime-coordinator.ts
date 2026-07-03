import type {
  AgentModel,
  AgentProviderId,
  AgentRuntime,
  AgentRuntimeRegistry,
} from '../../../packages/agent-runtime/src/index';
import type {
  ModelOptionDto,
  ReasoningEffortDto,
} from '../../../packages/shared/src/index';
import {
  defaultAgentBackendId,
  isAgentBackendId,
} from '../../../packages/shared/src/index';
import { HttpError } from './app';

export function normalizeReasoningEffort(
  value: string | null | undefined,
): ReasoningEffortDto | null {
  switch (value) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return value;
    default:
      return null;
  }
}

export function normalizeFastMode(value: unknown): boolean {
  return value === true || value === 1;
}

export function performanceModeForFastMode(
  fastMode: boolean,
): 'fast' | 'standard' {
  return fastMode ? 'fast' : 'standard';
}

export function ensureFastModeSupported(
  model: string | null | undefined,
  fastMode: boolean,
  modelRecords: Array<{
    model: string;
    supportsPerformanceMode?: boolean;
  }> = [],
) {
  if (!fastMode) {
    return;
  }

  const matchedModel = model
    ? modelRecords.find((entry) => entry.model === model)
    : null;
  if (matchedModel?.supportsPerformanceMode === true) {
    return;
  }

  throw new HttpError(400, {
    code: 'bad_request',
    message: 'Current model does not support fast mode.',
  });
}

export class ThreadProviderRuntimeCoordinator {
  constructor(private readonly agentRuntimes: AgentRuntimeRegistry) {}

  normalizeProvider(provider: string | null | undefined): AgentProviderId {
    if (!provider) {
      return defaultAgentBackendId;
    }
    if (isAgentBackendId(provider)) {
      return provider;
    }
    throw new HttpError(400, {
      code: 'bad_request',
      message: `Unsupported agent runtime provider: ${provider}`,
    });
  }

  runtimeForProvider(provider: string | null | undefined): AgentRuntime {
    const normalizedProvider = this.normalizeProvider(provider);
    const runtime = this.optionalRuntimeForProvider(normalizedProvider);
    if (!runtime) {
      throw new HttpError(501, {
        code: 'service_unavailable',
        message: `Agent runtime provider is not configured: ${normalizedProvider}`,
      });
    }
    return runtime;
  }

  optionalRuntimeForProvider(provider: string | null | undefined): AgentRuntime | null {
    return this.agentRuntimes.getOptional(this.normalizeProvider(provider)) ?? null;
  }

  allRuntimes(): AgentRuntime[] {
    return this.agentRuntimes.all();
  }

  providerForRecord(record: { provider?: string | null | undefined }): AgentProviderId {
    return this.normalizeProvider(record.provider);
  }

  isCodexProvider(provider: string | null | undefined): boolean {
    return this.providerForRecord({ provider }) === 'codex';
  }

  runtimeSupportsFastMode(provider: string | null | undefined): boolean {
    return this.optionalRuntimeForProvider(provider)?.capabilities.controls.performanceMode ?? false;
  }

  fastModeForProvider(provider: string | null | undefined, fastMode: unknown): boolean {
    return this.runtimeSupportsFastMode(provider) ? normalizeFastMode(fastMode) : false;
  }

  performanceModeForRecord(record: { provider?: string | null; fastMode?: unknown }) {
    return performanceModeForFastMode(
      this.fastModeForProvider(record.provider, record.fastMode),
    );
  }

  async listLoadedProviderSessionIds(provider: string | null | undefined = 'codex') {
    const runtime = this.optionalRuntimeForProvider(provider);
    if (!runtime) {
      return new Set<string>();
    }
    return new Set(
      await runtime.listLoadedSessions().catch(() => []),
    );
  }

  async listProviderModels(provider: string | null | undefined = 'codex') {
    return this.runtimeForProvider(provider).listModels().catch(() => []);
  }

  async listProviderModelOptions(
    provider: string | null | undefined = 'codex',
  ): Promise<ModelOptionDto[]> {
    const models = await this.runtimeForProvider(provider).listModels();
    return models.map((model) => this.modelOptionFromAgentModel(model));
  }

  normalizeReasoningForModel(
    modelRecords: Array<{
      model: string;
      defaultReasoningEffort: string | null;
      supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
    }>,
    model: string | null,
    requested: ReasoningEffortDto | null,
  ): ReasoningEffortDto | null {
    if (!model) {
      return requested;
    }

    const matchedModel = modelRecords.find((entry) => entry.model === model);
    if (!matchedModel) {
      return requested;
    }

    const supported = new Set(
      matchedModel.supportedReasoningEfforts.map((entry) => entry.reasoningEffort),
    );

    if (requested && supported.has(requested)) {
      return requested;
    }

    return normalizeReasoningEffort(matchedModel.defaultReasoningEffort);
  }

  reasoningEffortAvailableForModel(
    modelRecords: Array<{
      model: string;
      supportedReasoningEfforts: Array<{ reasoningEffort: string }>;
    }>,
    model: string | null,
  ): boolean | null {
    if (!model) {
      return null;
    }

    const matchedModel = modelRecords.find((entry) => entry.model === model);
    if (!matchedModel) {
      return null;
    }

    return matchedModel.supportedReasoningEfforts.length > 1;
  }

  modelOptionFromAgentModel(model: AgentModel): ModelOptionDto {
    return {
      id: model.id,
      model: model.model,
      displayName: model.displayName,
      description: model.description,
      isDefault: model.isDefault,
      hidden: model.hidden,
      supportsPerformanceMode: model.supportsPerformanceMode === true,
      supportedReasoningEfforts: model.supportedReasoningEfforts.map((entry) => ({
        reasoningEffort: entry.reasoningEffort as ReasoningEffortDto,
        description: entry.description,
      })),
      defaultReasoningEffort: model.defaultReasoningEffort as ReasoningEffortDto | null,
    };
  }
}
