import {
  defaultAgentBackendId,
} from '../../shared/src/index';
import {
  AgentProviderId,
  AgentRuntime,
  AgentRuntimeDescriptor,
} from './types';

export class AgentRuntimeRegistry {
  private readonly runtimes = new Map<AgentProviderId, AgentRuntime>();

  constructor(
    runtimes: AgentRuntime[],
    private readonly defaultProvider: AgentProviderId = defaultAgentBackendId,
  ) {
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
    return this.all().map((runtime) => ({
      provider: runtime.provider,
      displayName: runtime.displayName,
      description: runtime.description,
      enabled: isAgentRuntimeEnabled(runtime),
      isDefault: runtime.provider === this.defaultProvider,
      status: runtime.getStatus(),
      capabilities: runtime.capabilities,
      managementSchema: runtime.managementSchema,
      installation: runtime.installation,
    }));
  }
}

export function isAgentRuntimeEnabled(runtime: Pick<AgentRuntime, 'capabilities' | 'installation'>) {
  return (
    runtime.installation.installed &&
    runtime.capabilities.sessions.resume &&
    runtime.capabilities.turns.start
  );
}
