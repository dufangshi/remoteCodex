import type { AgentProviderCapabilities } from '../../agent-runtime/src/index';
import type { AcpNegotiatedCapabilitySnapshot } from './capabilities';

export type AcpHarnessContractCapability =
  | 'sessions.list'
  | 'sessions.load'
  | 'sessions.resume'
  | 'sessions.close'
  | 'sessions.delete'
  | 'turns.steer'
  | 'turns.compact'
  | 'branching.fork'
  | 'branching.hardRollback'
  | 'controls.performanceMode'
  | 'controls.goals';

function capabilityValue(
  capabilities: AgentProviderCapabilities,
  capability: AcpHarnessContractCapability,
) {
  const [section, key] = capability.split('.') as [
    keyof AgentProviderCapabilities,
    string,
  ];
  return capabilities[section][
    key as keyof AgentProviderCapabilities[typeof section]
  ] === true;
}

export function assertAcpHarnessContract(input: {
  negotiated: AcpNegotiatedCapabilitySnapshot | null;
  effectiveCapabilities: AgentProviderCapabilities;
  expectedAgentName: string;
  required: AcpHarnessContractCapability[];
  unsupported?: AcpHarnessContractCapability[];
}) {
  const actualAgentName = input.negotiated?.agentInfo?.name ?? null;
  if (actualAgentName !== input.expectedAgentName) {
    throw new Error(
      `ACP harness contract expected ${input.expectedAgentName}, received ` +
      `${actualAgentName ?? 'unknown'}.`,
    );
  }
  const missing = input.required.filter(
    (capability) => !capabilityValue(input.effectiveCapabilities, capability),
  );
  const unexpectedlySupported = (input.unsupported ?? []).filter(
    (capability) => capabilityValue(input.effectiveCapabilities, capability),
  );
  if (missing.length > 0 || unexpectedlySupported.length > 0) {
    throw new Error(
      `ACP harness contract mismatch: missing=${missing.join(',') || 'none'}; ` +
      `unexpected=${unexpectedlySupported.join(',') || 'none'}.`,
    );
  }
  return {
    agentName: actualAgentName,
    protocolVersion: input.negotiated!.protocolVersion,
    required: [...input.required],
    unsupported: [...(input.unsupported ?? [])],
  };
}
