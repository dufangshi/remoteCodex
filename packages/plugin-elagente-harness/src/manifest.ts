export interface ElAgenteHarnessPluginManifest {
  id: 'remote-codex.elagente-harness';
  name: string;
  version: string;
  description: string;
  remoteCodex: string;
  capabilities: {
    artifactTypes: Array<{
      type: 'elagente.harness.run' | 'elagente.harness.artifact';
      title: string;
      fileExtensions?: string[];
    }>;
    timelineRenderers: [];
    threadPanels: [];
    modelHints: Array<{
      id: string;
      text: string;
    }>;
    mcpServers: Array<{
      id: string;
      name: string;
      command: string;
      args: string[];
    }>;
  };
}

export const elagenteHarnessPluginManifest: ElAgenteHarnessPluginManifest = {
  id: 'remote-codex.elagente-harness',
  name: 'ElAgente Harness Tools',
  version: '0.1.0',
  description:
    'Managed MCP tools for discovering and invoking ElAgenteHarness chemistry modules from sandbox workers.',
  remoteCodex: '^0.11.0',
  capabilities: {
    artifactTypes: [
      {
        type: 'elagente.harness.run',
        title: 'ElAgente Harness Run',
      },
      {
        type: 'elagente.harness.artifact',
        title: 'ElAgente Harness Artifact',
      },
    ],
    timelineRenderers: [],
    threadPanels: [],
    modelHints: [
      {
        id: 'elagente-harness-tools',
        text:
          'ElAgenteHarness chemistry tools are available through MCP when the sandbox has chemistry enabled. Use harness_status to check readiness, harness_home for root discovery, harness_help and harness_list_tools to inspect modules, and harness_invoke_tool for approved JSON tool calls. Do not ask for or print INACT_X_APP_KEY.',
      },
    ],
    mcpServers: [
      {
        id: 'remote-codex-plugin-mcp',
        name: 'remote_codex_plugins',
        command: 'node',
        args: ['bin/remote-codex-plugin-mcp.mjs'],
      },
    ],
  },
};
