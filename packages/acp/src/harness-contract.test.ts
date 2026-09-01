import { describe, expect, it } from 'vitest';

import type { AgentProviderCapabilities } from '../../agent-runtime/src/index';
import type { AcpNegotiatedCapabilitySnapshot } from './capabilities';
import { acpCapabilities } from './runtimeAdapter';
import { assertAcpHarnessContract } from './harness-contract';

function negotiated(name: string): AcpNegotiatedCapabilitySnapshot {
  return {
    protocolVersion: 1,
    agentInfo: { name, title: null, version: 'test' },
    agentCapabilities: {},
    harnessExtensions: [],
    legacyExtensions: { steering: null, goal: null },
  };
}

function capabilities(
  patch: Partial<AgentProviderCapabilities>,
): AgentProviderCapabilities {
  const value = structuredClone(acpCapabilities);
  for (const section of Object.keys(patch) as Array<keyof AgentProviderCapabilities>) {
    Object.assign(value[section], patch[section]);
  }
  return value;
}

describe('ACP harness contract kit', () => {
  it('validates the Codex extension profile', () => {
    expect(assertAcpHarnessContract({
      negotiated: negotiated('@agentclientprotocol/codex-acp'),
      effectiveCapabilities: capabilities({
        sessions: { ...acpCapabilities.sessions, list: true, load: true, resume: true },
        turns: { ...acpCapabilities.turns, steer: true, compact: true },
        controls: { ...acpCapabilities.controls, goals: true, performanceMode: true },
      }),
      expectedAgentName: '@agentclientprotocol/codex-acp',
      required: [
        'sessions.list',
        'sessions.load',
        'sessions.resume',
        'turns.steer',
        'turns.compact',
        'controls.goals',
        'controls.performanceMode',
      ],
      unsupported: ['branching.fork', 'branching.hardRollback'],
    })).toMatchObject({ protocolVersion: 1 });
  });

  it('validates a portable fork profile without Codex-only compact', () => {
    expect(assertAcpHarnessContract({
      negotiated: negotiated('@agentclientprotocol/claude-agent-acp'),
      effectiveCapabilities: capabilities({
        sessions: { ...acpCapabilities.sessions, list: true, load: true, resume: true },
        turns: { ...acpCapabilities.turns, steer: true },
        branching: { ...acpCapabilities.branching, fork: true },
        controls: { ...acpCapabilities.controls, goals: true },
      }),
      expectedAgentName: '@agentclientprotocol/claude-agent-acp',
      required: [
        'sessions.list',
        'sessions.load',
        'sessions.resume',
        'turns.steer',
        'branching.fork',
        'controls.goals',
      ],
      unsupported: ['turns.compact', 'branching.hardRollback'],
    })).toMatchObject({ protocolVersion: 1 });
  });

  it('fails closed when a required capability disappears', () => {
    expect(() => assertAcpHarnessContract({
      negotiated: negotiated('minimal-agent'),
      effectiveCapabilities: capabilities({}),
      expectedAgentName: 'minimal-agent',
      required: ['sessions.resume'],
    })).toThrow(/missing=sessions\.resume/);
  });
});
