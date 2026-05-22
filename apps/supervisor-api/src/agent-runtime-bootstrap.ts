import {
  AgentProviderId,
  AgentRuntime,
  AgentRuntimeRegistry,
} from '../../../packages/agent-runtime/src/index';
import {
  CodexAppServerManager,
  CodexManagementService,
  CodexRuntimeAdapter,
  LocalCodexSessionStore,
} from '../../../packages/codex/src/index';
import { ClaudeRuntimeAdapter } from '../../../packages/claude/src/index';
import { OpenCodeRuntimeAdapter } from '../../../packages/opencode/src/index';
import type { RuntimeConfig } from '../../../packages/config/src/index';

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
    runtimes.push(createClaudeRuntime(config));
    providerHostHomes.claude = claudeConfig.home;
  }

  const opencodeConfig = config.agentProviders.opencode;
  if (opencodeConfig.enabled) {
    runtimes.push(createOpenCodeRuntime(config));
    providerHostHomes.opencode = opencodeConfig.home;
  }

  return {
    agentRuntimes: new AgentRuntimeRegistry(runtimes),
    localCodexSessionStore: new LocalCodexSessionStore(codexConfig.home),
    codexManagement: new CodexManagementService(codexConfig.home),
    providerHostHomes,
  };
}

function createClaudeRuntime(config: RuntimeConfig): AgentRuntime {
  const claudeConfig = config.agentProviders.claude;
  return new ClaudeRuntimeAdapter({
      home: claudeConfig.home,
      command: claudeConfig.command,
      clientInfo: {
        name: 'remote-codex-supervisor',
        title: config.appName,
        version: config.appVersion,
      },
    });
}

function createOpenCodeRuntime(config: RuntimeConfig): AgentRuntime {
  const opencodeConfig = config.agentProviders.opencode;
  return new OpenCodeRuntimeAdapter({
      home: opencodeConfig.home,
      command: opencodeConfig.command,
      clientInfo: {
        name: 'remote-codex-supervisor',
        title: config.appName,
        version: config.appVersion,
      },
    });
}
