import {
  AgentProviderId,
  AgentRuntime,
  AgentRuntimeDescriptor,
} from './types';

export class AgentRuntimeRegistry {
  private readonly runtimes = new Map<AgentProviderId, AgentRuntime>();

  constructor(runtimes: AgentRuntime[]) {
    for (const runtime of runtimes) {
      this.runtimes.set(runtime.provider, runtime);
    }
  }

  get(provider: AgentProviderId): AgentRuntime {
    const runtime = this.runtimes.get(provider);
    if (!runtime) {
      throw new Error(`Agent runtime provider is not configured: ${provider}`);
    }
    return runtime;
  }

  getOptional(provider: AgentProviderId): AgentRuntime | null {
    return this.runtimes.get(provider) ?? null;
  }

  all(): AgentRuntime[] {
    return [...this.runtimes.values()];
  }

  list(): AgentRuntimeDescriptor[] {
    return this.all().map((runtime, index) => ({
      provider: runtime.provider,
      displayName: runtime.displayName,
      description: runtime.description,
      enabled: true,
      isDefault: index === 0,
      status: runtime.getStatus(),
      capabilities: runtime.capabilities,
      managementSchema: runtime.managementSchema,
    }));
  }
}
