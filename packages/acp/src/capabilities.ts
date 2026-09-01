import type * as acp from '@agentclientprotocol/sdk';

import type { AgentProviderCapabilities } from '../../agent-runtime/src/types';
import type { AcpAgentOptionMetadataDto } from '../../shared/src/index';
import {
  REMOTE_CODEX_HARNESS_EXTENSION_META_KEY,
  type HarnessExtensionDescriptor,
} from './extensions';

export interface AcpNegotiatedCapabilitySnapshot {
  protocolVersion: number;
  agentInfo: {
    name: string;
    title: string | null;
    version: string | null;
  } | null;
  agentCapabilities: acp.AgentCapabilities;
  harnessExtensions: HarnessExtensionDescriptor[];
  legacyExtensions: {
    steering: { supported: boolean } | null;
    goal: {
      version: string | number | null;
      controlMethod: string | null;
      actions: string[];
    } | null;
  };
}

export interface AcpAgentCapabilitySnapshot {
  provider: 'acp';
  agentId: string;
  availability: AcpAgentOptionMetadataDto['availability'];
  negotiated: AcpNegotiatedCapabilitySnapshot | null;
  effectiveCapabilities: AgentProviderCapabilities | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function harnessExtensions(value: unknown): HarnessExtensionDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) {
      return [];
    }
    const id = stringValue(candidate.id);
    const version = candidate.version;
    const stability = candidate.stability;
    const methods = Array.isArray(candidate.methods)
      ? candidate.methods.filter((item): item is string => typeof item === 'string')
      : [];
    const events = Array.isArray(candidate.events)
      ? candidate.events.filter((item): item is string => typeof item === 'string')
      : [];
    if (
      !id ||
      !Number.isInteger(version) ||
      Number(version) < 1 ||
      (stability !== 'experimental' && stability !== 'stable')
    ) {
      return [];
    }
    return [{
      id,
      version: Number(version),
      stability,
      methods,
      events,
    }];
  });
}

function legacyExtensions(meta: Record<string, unknown>) {
  const steering = isRecord(meta.steering)
    ? { supported: meta.steering.supported === true }
    : null;
  const goal = isRecord(meta.goal)
    ? {
        version:
          typeof meta.goal.version === 'string' || typeof meta.goal.version === 'number'
            ? meta.goal.version
            : null,
        controlMethod: stringValue(meta.goal.controlMethod),
        actions: Array.isArray(meta.goal.actions)
          ? meta.goal.actions.filter((item): item is string => typeof item === 'string')
          : [],
      }
    : null;
  return { steering, goal };
}

export function snapshotAcpInitializeResponse(
  response: acp.InitializeResponse | null,
): AcpNegotiatedCapabilitySnapshot | null {
  if (!response) {
    return null;
  }
  const meta = isRecord(response._meta) ? response._meta : {};
  return {
    protocolVersion: response.protocolVersion,
    agentInfo: response.agentInfo
      ? {
          name: response.agentInfo.name,
          title: response.agentInfo.title ?? null,
          version: response.agentInfo.version ?? null,
        }
      : null,
    agentCapabilities: structuredClone(response.agentCapabilities ?? {}),
    harnessExtensions: harnessExtensions(
      meta[REMOTE_CODEX_HARNESS_EXTENSION_META_KEY],
    ),
    legacyExtensions: legacyExtensions(meta),
  };
}

export function snapshotAcpAgentCapabilities(input: {
  agentId: string;
  availability: AcpAgentOptionMetadataDto['availability'];
  negotiated?: AcpNegotiatedCapabilitySnapshot | null;
  effectiveCapabilities: AgentProviderCapabilities;
}): AcpAgentCapabilitySnapshot {
  const ready = input.availability === 'ready';
  return {
    provider: 'acp',
    agentId: input.agentId,
    availability: input.availability,
    negotiated: ready ? input.negotiated ?? null : null,
    effectiveCapabilities: ready
      ? structuredClone(input.effectiveCapabilities)
      : null,
  };
}
