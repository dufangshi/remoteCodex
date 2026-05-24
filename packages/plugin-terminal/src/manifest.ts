export const TERMINAL_PLUGIN_ID = 'remote-codex.terminal';

export interface TerminalPluginManifest {
  id: typeof TERMINAL_PLUGIN_ID;
  name: string;
  version: string;
  description: string;
  remoteCodex: string;
  capabilities: {
    artifactTypes: [];
    timelineRenderers: [];
    threadPanels: Array<{
      id: 'terminal';
      label: string;
      kind: 'terminal';
      artifactTypes: [];
    }>;
    frontend: {
      entry: string;
    };
    backend: {
      entry: string;
    };
  };
}

export const terminalPluginManifest: TerminalPluginManifest = {
  id: TERMINAL_PLUGIN_ID,
  name: 'Terminal',
  version: '0.1.0',
  description: 'Built-in durable terminal panel backed by the supervisor PTY host.',
  remoteCodex: '^0.11.0',
  capabilities: {
    artifactTypes: [],
    timelineRenderers: [],
    threadPanels: [
      {
        id: 'terminal',
        label: 'Terminal',
        kind: 'terminal',
        artifactTypes: [],
      },
    ],
    frontend: {
      entry: './dist/index.js',
    },
    backend: {
      entry: './dist/backend.js',
    },
  },
};
