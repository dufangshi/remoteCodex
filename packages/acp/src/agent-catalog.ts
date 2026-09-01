import type {
  AcpAgentOptionMetadataDto,
} from '../../shared/src/index';
import type { AgentModel } from '../../agent-runtime/src/index';
import {
  parseCommandLine,
  resolveExecutable,
  runProcess,
} from '../../process-runtime/src/index';

export interface AcpAgentDefinition {
  id: string;
  displayName: string;
  description: string;
  transport: AcpAgentOptionMetadataDto['transport'];
  baseCommand: string;
  baseProbeCommand: string;
  serverCommand: string;
  serverProbeCommand: string;
  installCommand: string | null;
  modelListCommand?: string | null;
}

export interface AcpAgentCatalogEntry extends AcpAgentDefinition {
  availability: AcpAgentOptionMetadataDto['availability'];
  baseVersion: string | null;
  serverVersion: string | null;
  busy: boolean;
  statusMessage: string;
}

const builtinAcpAgents: AcpAgentDefinition[] = [
  {
    id: 'grok',
    displayName: 'Grok Build',
    description: 'xAI Grok coding agent with native ACP support.',
    transport: 'native',
    baseCommand: 'grok',
    baseProbeCommand: 'grok --version',
    serverCommand: 'grok agent stdio',
    serverProbeCommand: 'grok agent stdio --help',
    installCommand: null,
    modelListCommand: 'grok models',
  },
  {
    id: 'cursor',
    displayName: 'Cursor Agent',
    description: 'Cursor CLI coding agent with native ACP support.',
    transport: 'native',
    baseCommand: 'cursor-agent',
    baseProbeCommand: 'cursor-agent --version',
    serverCommand: 'cursor-agent acp',
    serverProbeCommand: 'cursor-agent acp --help',
    installCommand: null,
  },
  {
    id: 'codex',
    displayName: 'OpenAI Codex',
    description: 'Local Codex CLI connected through the ACP adapter.',
    transport: 'adapter',
    baseCommand: 'codex',
    baseProbeCommand: 'codex --version',
    serverCommand: 'codex-acp',
    serverProbeCommand: 'codex-acp --version',
    installCommand: 'npm install -g @agentclientprotocol/codex-acp@latest',
  },
  {
    id: 'claude',
    displayName: 'Claude Agent',
    description: 'Claude Code connected through the Claude Agent ACP adapter.',
    transport: 'adapter',
    baseCommand: 'claude',
    baseProbeCommand: 'claude --version',
    serverCommand: 'claude-agent-acp',
    serverProbeCommand: 'claude-agent-acp --version',
    installCommand: 'npm install -g @agentclientprotocol/claude-agent-acp@latest',
  },
  {
    id: 'gemini',
    displayName: 'Gemini CLI',
    description: 'Google Gemini CLI with native ACP support.',
    transport: 'native',
    baseCommand: 'gemini',
    baseProbeCommand: 'gemini --version',
    serverCommand: 'gemini --acp',
    serverProbeCommand: 'gemini --acp --help',
    installCommand: null,
  },
  {
    id: 'copilot',
    displayName: 'GitHub Copilot CLI',
    description: 'GitHub Copilot CLI with native ACP support.',
    transport: 'native',
    baseCommand: 'copilot',
    baseProbeCommand: 'copilot --version',
    serverCommand: 'copilot --acp',
    serverProbeCommand: 'copilot --acp --help',
    installCommand: null,
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    description: 'OpenCode coding agent with native ACP support.',
    transport: 'native',
    baseCommand: 'opencode',
    baseProbeCommand: 'opencode --version',
    serverCommand: 'opencode acp',
    serverProbeCommand: 'opencode acp --help',
    installCommand: null,
    modelListCommand: 'opencode models',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek Harness',
    description: 'DeepSeek Harness connected through its ACP bridge.',
    transport: 'adapter',
    baseCommand: 'dsh',
    baseProbeCommand: 'dsh --version',
    serverCommand: 'dsh-acp',
    serverProbeCommand: 'dsh-acp --version',
    installCommand: 'npm install -g @openma/deepseek-harness-acp@latest',
  },
];

function firstOutputLine(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

function commandError(result: Awaited<ReturnType<typeof runProcess>>) {
  return firstOutputLine(result.stderr) ?? firstOutputLine(result.stdout);
}

async function probeCommand(commandLine: string, timeoutMs = 4_000) {
  const parsed = parseCommandLine(commandLine);
  const executable = await resolveExecutable(parsed.command);
  if (!executable) {
    return { available: false, version: null, error: null, executable: null };
  }
  const result = await runProcess({
    command: parsed.command,
    args: parsed.args,
    timeoutMs,
    maxOutputBytes: 64 * 1024,
  });
  return {
    available: result.code === 0,
    version: result.code === 0
      ? firstOutputLine(result.stdout) ?? firstOutputLine(result.stderr)
      : null,
    error: result.code === 0 ? null : commandError(result),
    executable,
  };
}

function customDefinition(command: string | null | undefined) {
  const normalized = command?.trim();
  if (!normalized || normalized === 'grok agent stdio') {
    return null;
  }
  const parsed = parseCommandLine(normalized);
  return {
    id: 'custom',
    displayName: 'Custom ACP Agent',
    description: 'ACP stdio server configured through ACP_COMMAND.',
    transport: 'custom' as const,
    baseCommand: parsed.command,
    baseProbeCommand: `${parsed.command} --version`,
    serverCommand: normalized,
    serverProbeCommand: `${normalized} --help`,
    installCommand: null,
  } satisfies AcpAgentDefinition;
}

export class AcpAgentCatalog {
  private readonly definitions: AcpAgentDefinition[];
  private readonly busyAgents = new Set<string>();
  private readonly installErrors = new Map<string, string>();
  private cached: { at: number; entries: AcpAgentCatalogEntry[] } | null = null;

  constructor(input: {
    customCommand?: string | null;
    definitions?: AcpAgentDefinition[];
  } = {}) {
    const custom = customDefinition(input.customCommand);
    const definitions = input.definitions ?? builtinAcpAgents;
    this.definitions = custom ? [...definitions, custom] : definitions;
  }

  definition(agentId: string) {
    return this.definitions.find((definition) => definition.id === agentId) ?? null;
  }

  async list(options: { force?: boolean } = {}) {
    if (!options.force && this.cached && Date.now() - this.cached.at < 5_000) {
      return this.cached.entries;
    }
    const entries = await Promise.all(this.definitions.map((definition) =>
      this.inspect(definition),
    ));
    this.cached = { at: Date.now(), entries };
    return entries;
  }

  async installAdapter(agentId: string) {
    const definition = this.definition(agentId);
    if (!definition) {
      throw new Error(`Unknown ACP agent: ${agentId}`);
    }
    const current = await this.inspect(definition);
    if (current.availability === 'base_missing') {
      throw new Error(
        `${definition.displayName} is not installed. Install the base agent first. Probe: ${definition.baseProbeCommand}`,
      );
    }
    if (!definition.installCommand) {
      throw new Error(`${definition.displayName} does not use an installable ACP adapter.`);
    }

    this.busyAgents.add(agentId);
    this.installErrors.delete(agentId);
    this.cached = null;
    try {
      const parsed = parseCommandLine(definition.installCommand);
      const result = await runProcess({
        command: parsed.command,
        args: parsed.args,
        timeoutMs: 2 * 60_000,
        maxOutputBytes: 2 * 1024 * 1024,
      });
      if (result.code !== 0) {
        throw new Error(
          commandError(result) ??
          `${definition.installCommand} failed with exit code ${result.code ?? 'unknown'}.`,
        );
      }
      const refreshed = await this.inspect(definition);
      if (refreshed.availability !== 'ready') {
        throw new Error(
          `ACP adapter installed, but its probe still failed: ${definition.serverProbeCommand}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.installErrors.set(agentId, message);
      throw error;
    } finally {
      this.busyAgents.delete(agentId);
      this.cached = null;
    }
  }

  async listCommandModels(agentId: string): Promise<AgentModel[]> {
    const definition = this.definition(agentId);
    if (!definition?.modelListCommand) {
      return [];
    }
    const parsed = parseCommandLine(definition.modelListCommand);
    const result = await runProcess({
      command: parsed.command,
      args: parsed.args,
      timeoutMs: 15_000,
      maxOutputBytes: 512 * 1024,
    });
    if (result.code !== 0) {
      return [];
    }
    const output = `${result.stdout}\n${result.stderr}`;
    const defaultModel = output.match(/^Default model:\s*(\S+)/m)?.[1] ?? null;
    const models = output.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^\s*[-*]\s+(\S+?)(?:\s+\(default\))?\s*$/)
        ?? line.match(/^\s*([A-Za-z0-9._-]+\/[A-Za-z0-9._:/-]+)\s*$/);
      if (!match?.[1]) {
        return [];
      }
      const model = match[1];
      return [{
        id: model,
        model,
        displayName: model,
        description: '',
        isDefault: model === defaultModel || line.trim().startsWith('*'),
        hidden: false,
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        selectionKind: 'model' as const,
      }];
    });
    return models.filter(
      (model, index) => models.findIndex((candidate) => candidate.model === model.model) === index,
    );
  }

  private async inspect(definition: AcpAgentDefinition): Promise<AcpAgentCatalogEntry> {
    const base = await probeCommand(definition.baseProbeCommand);
    const busy = this.busyAgents.has(definition.id);
    const installError = this.installErrors.get(definition.id) ?? null;
    if (!base.available) {
      return {
        ...definition,
        availability: 'base_missing',
        baseVersion: null,
        serverVersion: null,
        busy,
        statusMessage: installError ??
          `Install the base agent first. Probe: ${definition.baseProbeCommand}`,
      };
    }

    const serverExecutable = parseCommandLine(definition.serverCommand).command;
    if (definition.transport === 'adapter' && !(await resolveExecutable(serverExecutable))) {
      return {
        ...definition,
        availability: 'adapter_missing',
        baseVersion: base.version,
        serverVersion: null,
        busy,
        statusMessage: installError ??
          `Base agent detected. Install its ACP adapter. Probe: ${definition.serverProbeCommand}`,
      };
    }

    const server = await probeCommand(definition.serverProbeCommand);
    if (!server.available) {
      return {
        ...definition,
        availability: 'server_unavailable',
        baseVersion: base.version,
        serverVersion: null,
        busy,
        statusMessage: installError ?? server.error ??
          `ACP server probe failed: ${definition.serverProbeCommand}`,
      };
    }

    return {
      ...definition,
      availability: 'ready',
      baseVersion: base.version,
      serverVersion: server.version,
      busy,
      statusMessage: `Ready. ACP command: ${definition.serverCommand}`,
    };
  }
}

export function acpAgentMetadata(entry: AcpAgentCatalogEntry): AcpAgentOptionMetadataDto {
  return {
    transport: entry.transport,
    availability: entry.availability,
    baseCommand: entry.baseCommand,
    baseProbeCommand: entry.baseProbeCommand,
    serverCommand: entry.serverCommand,
    serverProbeCommand: entry.serverProbeCommand,
    baseVersion: entry.baseVersion,
    serverVersion: entry.serverVersion,
    installCommand: entry.installCommand,
    busy: entry.busy,
    statusMessage: entry.statusMessage,
  };
}
