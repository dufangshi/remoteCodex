import { describe, expect, it } from 'vitest';

import {
  AcpAgentCatalog,
  type AcpAgentDefinition,
} from './agent-catalog';

const nodeCommand = `"${process.execPath}"`;

function definition(
  input: Partial<AcpAgentDefinition> & Pick<AcpAgentDefinition, 'id'>,
): AcpAgentDefinition {
  return {
    id: input.id,
    displayName: input.displayName ?? input.id,
    description: input.description ?? input.id,
    transport: input.transport ?? 'native',
    baseCommand: input.baseCommand ?? process.execPath,
    baseProbeCommand: input.baseProbeCommand ?? `${nodeCommand} --version`,
    serverCommand: input.serverCommand ?? process.execPath,
    serverProbeCommand: input.serverProbeCommand ?? `${nodeCommand} --version`,
    installCommand: input.installCommand ?? null,
  };
}

describe('AcpAgentCatalog', () => {
  it('distinguishes ready, missing base, and missing adapter agents', async () => {
    const catalog = new AcpAgentCatalog({
      definitions: [
        definition({ id: 'ready' }),
        definition({
          id: 'missing-base',
          baseCommand: 'remote-codex-missing-base',
          baseProbeCommand: 'remote-codex-missing-base --version',
          serverCommand: 'remote-codex-missing-base',
          serverProbeCommand: 'remote-codex-missing-base acp --help',
        }),
        definition({
          id: 'missing-adapter',
          transport: 'adapter',
          serverCommand: 'remote-codex-missing-adapter',
          serverProbeCommand: 'remote-codex-missing-adapter --version',
          installCommand: 'npm install -g example-acp-adapter',
        }),
      ],
    });

    const entries = await catalog.list({ force: true });
    expect(entries.map((entry) => [entry.id, entry.availability])).toEqual([
      ['ready', 'ready'],
      ['missing-base', 'base_missing'],
      ['missing-adapter', 'adapter_missing'],
    ]);
    expect(entries[1]?.statusMessage).toContain('Install the base agent first');
    expect(entries[2]?.statusMessage).toContain('Install its ACP adapter');
  });
});
