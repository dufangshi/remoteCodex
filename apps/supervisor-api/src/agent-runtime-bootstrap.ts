import { AgentProviderId, AgentRuntimeRegistry } from '../../../packages/agent-runtime/src/index';
import {
  CodexAppServerManager,
  CodexRuntimeAdapter,
} from '../../../packages/codex/src/index';
import type { RuntimeConfig } from '../../../packages/config/src/index';
import { LocalCodexSessionStore } from './codex/local-session-store';

export type ProviderHostHomes = Partial<Record<AgentProviderId, string>>;

export interface AgentRuntimeBootstrap {
  agentRuntimes: AgentRuntimeRegistry;
  localCodexSessionStore: LocalCodexSessionStore;
  providerHostHomes: ProviderHostHomes;
}

export function createAgentRuntimeBootstrap(config: RuntimeConfig): AgentRuntimeBootstrap {
  const codexRuntime = new CodexRuntimeAdapter(
    new CodexAppServerManager({
      command: config.codexCommand,
      startupTimeoutMs: config.codexAppServerStartTimeoutMs,
      clientInfo: {
        name: 'remote-codex-supervisor',
        title: config.appName,
        version: config.appVersion,
      },
    }),
  );

  return {
    agentRuntimes: new AgentRuntimeRegistry([codexRuntime]),
    localCodexSessionStore: new LocalCodexSessionStore(config.codexHome),
    providerHostHomes: {
      codex: config.codexHome,
    },
  };
}
