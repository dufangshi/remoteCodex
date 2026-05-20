import {
  AgentProviderId,
  AgentRuntime,
  AgentRuntimeRegistry,
} from '../../../packages/agent-runtime/src/index';
import {
  CodexAppServerManager,
  CodexRuntimeAdapter,
} from '../../../packages/codex/src/index';
import type { RuntimeConfig } from '../../../packages/config/src/index';
import { CodexManagementService } from './codex/codex-management-service';
import { LocalCodexSessionStore } from './codex/local-session-store';

export type ProviderHostHomes = Partial<Record<AgentProviderId, string>>;

export interface AgentRuntimeBootstrap {
  agentRuntimes: AgentRuntimeRegistry;
  localCodexSessionStore: LocalCodexSessionStore;
  codexManagement: CodexManagementService;
  providerHostHomes: ProviderHostHomes;
}

export function createAgentRuntimeBootstrap(config: RuntimeConfig): AgentRuntimeBootstrap {
  const runtimes: AgentRuntime[] = [];
  const providerHostHomes: ProviderHostHomes = {};
  const codexConfig = config.agentProviders.codex;
  const codexRuntime = codexConfig.enabled
    ? new CodexRuntimeAdapter(
      new CodexAppServerManager({
        command: codexConfig.command,
        startupTimeoutMs: codexConfig.appServerStartTimeoutMs,
        clientInfo: {
          name: 'remote-codex-supervisor',
          title: config.appName,
          version: config.appVersion,
        },
      }),
    )
    : null;

  if (codexRuntime) {
    runtimes.push(codexRuntime);
    providerHostHomes.codex = codexConfig.home;
  }

  const claudeConfig = config.agentProviders.claude;
  if (claudeConfig.enabled) {
    providerHostHomes.claude = claudeConfig.home;
    // Claude is intentionally config-only until the Claude runtime adapter is added.
  }

  return {
    agentRuntimes: new AgentRuntimeRegistry(runtimes),
    localCodexSessionStore: new LocalCodexSessionStore(codexConfig.home),
    codexManagement: new CodexManagementService(codexConfig.home),
    providerHostHomes,
  };
}
