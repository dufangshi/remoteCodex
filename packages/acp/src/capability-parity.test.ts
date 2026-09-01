import { describe, expect, it } from 'vitest';

import { codexCapabilities } from '../../codex/src/runtimeAdapter';
import type { AgentProviderCapabilities } from '../../agent-runtime/src/types';
import { snapshotAcpAgentCapabilities } from './capabilities';
import {
  acpCapabilities,
  applyNegotiatedAcpCapabilities,
} from './runtimeAdapter';

interface CapabilityDifference {
  capability: string;
  nativeCodex: boolean;
  codexAcp: boolean;
  decision: 'approved-baseline-gap';
}

function capabilityFlags(
  value: AgentProviderCapabilities,
  prefix = '',
): Map<string, boolean> {
  const flags = new Map<string, boolean>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'boolean') {
      flags.set(path, child);
      continue;
    }
    for (const [nestedKey, nestedValue] of Object.entries(child)) {
      if (typeof nestedValue === 'boolean') {
        flags.set(`${path}.${nestedKey}`, nestedValue);
      }
    }
  }
  return flags;
}

function capabilityDifferences(): CapabilityDifference[] {
  const nativeFlags = capabilityFlags(codexCapabilities);
  const acpFlags = capabilityFlags(applyNegotiatedAcpCapabilities(
    structuredClone(acpCapabilities),
    {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      sessionCapabilities: {
        list: {},
        resume: {},
        close: {},
        delete: {},
      },
    },
  ));
  return [...nativeFlags.entries()].flatMap(([capability, nativeCodex]) => {
    const codexAcp = acpFlags.get(capability);
    return codexAcp === undefined || codexAcp === nativeCodex
      ? []
      : [{
          capability,
          nativeCodex,
          codexAcp,
          decision: 'approved-baseline-gap' as const,
        }];
  });
}

describe('native Codex and Codex ACP capability baseline', () => {
  it('requires every current capability difference to remain explicit', () => {
    expect(capabilityDifferences()).toEqual([
      { capability: 'sessions.importLocal', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'turns.steer', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'turns.compact', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'branching.fork', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'branching.hardRollback', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'controls.sandboxMode', nativeCodex: false, codexAcp: true, decision: 'approved-baseline-gap' },
      { capability: 'controls.performanceMode', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'controls.goals', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'management.models', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'management.mcpStatus', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'management.skills', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'management.hooks', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'management.hookTrust', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
      { capability: 'management.hostConfigFiles', nativeCodex: true, codexAcp: false, decision: 'approved-baseline-gap' },
    ]);
  });

  it('does not present unavailable ACP agents as effective capability owners', () => {
    expect(snapshotAcpAgentCapabilities({
      agentId: 'codex',
      availability: 'adapter_missing',
      effectiveCapabilities: acpCapabilities,
    })).toEqual({
      provider: 'acp',
      agentId: 'codex',
      availability: 'adapter_missing',
      negotiated: null,
      effectiveCapabilities: null,
    });
  });
});
