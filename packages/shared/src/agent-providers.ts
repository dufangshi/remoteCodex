export const agentBackendIds = ['codex', 'claude', 'opencode'] as const;

export type AgentBackendIdDto = (typeof agentBackendIds)[number];

export const defaultAgentBackendId: AgentBackendIdDto = 'codex';

export interface AgentBackendMetadata {
  displayName: string;
  description: string;
  defaultTransport: 'stdio' | 'sdk' | 'none';
  homeEnvVar: string;
  commandEnvVar: string;
  defaultHomeDir: string;
  defaultCommand: string;
}

export const agentBackendMetadata: Record<AgentBackendIdDto, AgentBackendMetadata> = {
  codex: {
    displayName: 'Codex',
    description: 'Local Codex app-server runtime.',
    defaultTransport: 'stdio',
    homeEnvVar: 'CODEX_HOME',
    commandEnvVar: 'CODEX_COMMAND',
    defaultHomeDir: '.codex',
    defaultCommand: 'codex',
  },
  claude: {
    displayName: 'Claude Code',
    description: 'Local Claude Code Agent SDK runtime.',
    defaultTransport: 'sdk',
    homeEnvVar: 'CLAUDE_HOME',
    commandEnvVar: 'CLAUDE_COMMAND',
    defaultHomeDir: '.claude',
    defaultCommand: 'claude',
  },
  opencode: {
    displayName: 'OpenCode',
    description: 'Local OpenCode runtime.',
    defaultTransport: 'sdk',
    homeEnvVar: 'OPENCODE_HOME',
    commandEnvVar: 'OPENCODE_COMMAND',
    defaultHomeDir: '.opencode',
    defaultCommand: 'opencode',
  },
};

export function isAgentBackendId(value: unknown): value is AgentBackendIdDto {
  return (
    typeof value === 'string' &&
    agentBackendIds.includes(value as AgentBackendIdDto)
  );
}

export function normalizeAgentBackendId(value: unknown): AgentBackendIdDto | null {
  return isAgentBackendId(value) ? value : null;
}
