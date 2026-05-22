import type {
  AgentRuntime,
} from '../../../packages/agent-runtime/src/index';
import type {
  ThreadGoalFeatureManagement,
} from './thread-goal-coordinator';
import type {
  ThreadProviderRuntimeCoordinator,
} from './thread-provider-runtime-coordinator';

export interface ProviderGoalFeatureAdapter {
  mapGoalError(error: unknown): never;
  ensureGoalsFeatureEnabled(runtime: AgentRuntime): Promise<void>;
  isRuntimeRequestError(error: unknown): boolean;
}

export class ProviderFeatureCoordinator implements ThreadGoalFeatureManagement {
  constructor(
    private readonly providerRuntime: ThreadProviderRuntimeCoordinator,
    private readonly codexGoalFeatures: ProviderGoalFeatureAdapter,
  ) {}

  mapGoalError(error: unknown): never {
    this.codexGoalFeatures.mapGoalError(error);
  }

  async ensureGoalsFeatureEnabled(provider: string | null | undefined): Promise<void> {
    if (!this.providerRuntime.isCodexProvider(provider)) {
      return;
    }

    await this.codexGoalFeatures.ensureGoalsFeatureEnabled(
      this.providerRuntime.runtimeForProvider('codex'),
    );
  }

  isRuntimeRequestError(error: unknown): boolean {
    return this.codexGoalFeatures.isRuntimeRequestError(error);
  }
}
