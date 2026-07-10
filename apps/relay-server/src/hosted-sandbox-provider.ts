import type { RelayHostedSandboxCapabilityDto } from '../../../packages/shared/src/index';
import type { RelayServerConfig } from './config';

export interface HostedSandboxProvider {
  capability(signal?: AbortSignal): Promise<RelayHostedSandboxCapabilityDto>;
}

export class DisabledHostedSandboxProvider implements HostedSandboxProvider {
  async capability(): Promise<RelayHostedSandboxCapabilityDto> {
    return {
      provider: 'disabled',
      configured: false,
      reachable: false,
      available: false,
      reasonCode: 'hosted_sandbox_disabled',
      reason: 'Hosted supervisor VMs are not configured on this relay.',
      checkedAt: new Date().toISOString(),
    };
  }
}

class PendingIncusHostedSandboxProvider implements HostedSandboxProvider {
  constructor(private readonly config: RelayServerConfig['hostedSandbox']) {}

  async capability(): Promise<RelayHostedSandboxCapabilityDto> {
    const configured = Boolean(this.config.agentUrl && this.config.agentToken);
    return {
      provider: 'incus',
      configured,
      reachable: false,
      available: false,
      reasonCode: configured
        ? 'incus_host_agent_not_connected'
        : 'incus_host_agent_not_configured',
      reason: configured
        ? 'The Incus host-agent client is not enabled in this relay build yet.'
        : 'The Incus provider requires a host-agent URL and token.',
      checkedAt: new Date().toISOString(),
    };
  }
}

export function createHostedSandboxProvider(
  config: RelayServerConfig['hostedSandbox'],
): HostedSandboxProvider {
  return config.provider === 'incus'
    ? new PendingIncusHostedSandboxProvider(config)
    : new DisabledHostedSandboxProvider();
}

export class HostedSandboxCapabilityService {
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;

  constructor(
    private readonly provider: HostedSandboxProvider,
    private readonly options: {
      timeoutMs: number;
      failureThreshold?: number;
      circuitResetMs?: number;
      now?: () => number;
    },
  ) {}

  async read(): Promise<RelayHostedSandboxCapabilityDto> {
    const now = this.options.now ?? Date.now;
    const failureThreshold = this.options.failureThreshold ?? 2;
    const circuitResetMs = this.options.circuitResetMs ?? 30_000;
    if (
      this.circuitOpenedAt !== null &&
      now() - this.circuitOpenedAt < circuitResetMs
    ) {
      return unavailableCapability(
        'hosted_provider_circuit_open',
        'Hosted supervisor VM operations are temporarily unavailable after repeated provider failures.',
      );
    }
    if (this.circuitOpenedAt !== null) {
      this.circuitOpenedAt = null;
      this.consecutiveFailures = 0;
    }

    const controller = new AbortController();
    let timeout: NodeJS.Timeout | null = null;
    try {
      const capability = await Promise.race([
        this.provider.capability(controller.signal),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error('Hosted sandbox provider request timed out.'));
          }, this.options.timeoutMs);
        }),
      ]);
      this.consecutiveFailures = 0;
      this.circuitOpenedAt = null;
      return capability;
    } catch (error) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= failureThreshold) {
        this.circuitOpenedAt = now();
      }
      const timedOut = controller.signal.aborted;
      return unavailableCapability(
        timedOut ? 'hosted_provider_timeout' : 'hosted_provider_unreachable',
        timedOut
          ? 'The hosted supervisor VM provider did not respond in time.'
          : 'The hosted supervisor VM provider could not be reached.',
      );
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

function unavailableCapability(
  reasonCode: string,
  reason: string,
): RelayHostedSandboxCapabilityDto {
  return {
    provider: 'incus',
    configured: true,
    reachable: false,
    available: false,
    reasonCode,
    reason,
    checkedAt: new Date().toISOString(),
  };
}
