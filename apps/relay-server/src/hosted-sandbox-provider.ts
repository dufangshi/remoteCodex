import type {
  RelayHostedCodexFilesDto,
  RelayHostedCodexConfigDto,
  RelayHostedSandboxCapabilityDto,
} from '../../../packages/shared/src/index';
import type { RelayServerConfig } from './config';

export interface HostedSandboxProvider {
  capability(signal?: AbortSignal): Promise<RelayHostedSandboxCapabilityDto>;
  inventory(): Promise<HostedSandboxProviderInventory>;
  createCredential(
    openaiApiKey: string,
    idempotencyKey: string,
  ): Promise<string>;
  deleteCredential(
    credentialRef: string,
    idempotencyKey: string,
  ): Promise<void>;
  create(
    input: HostedSandboxCreateInput,
    idempotencyKey: string,
  ): Promise<HostedSandboxInstance>;
  status(id: string): Promise<HostedSandboxInstance>;
  start(id: string, idempotencyKey: string): Promise<HostedSandboxInstance>;
  stop(id: string, idempotencyKey: string): Promise<HostedSandboxInstance>;
  snapshot(id: string, name: string, idempotencyKey: string): Promise<void>;
  delete(id: string, idempotencyKey: string): Promise<void>;
  provision(
    input: HostedSandboxProvisionInput,
    idempotencyKey: string,
  ): Promise<void>;
  readCodexFiles(id: string): Promise<RelayHostedCodexFilesDto>;
  writeCodexFiles(
    id: string,
    files: RelayHostedCodexFilesDto,
    idempotencyKey: string,
  ): Promise<void>;
}

export interface HostedSandboxProviderInventory {
  instances: Array<{ id: string; status: string; snapshots: string[] }>;
  credentials: Array<{ credentialRef: string; createdAt: string }>;
  checkedAt: string;
}

export interface HostedSandboxCreateInput {
  id: string;
  imageVersion: string;
  resources: { cpuCount: number; memoryMiB: number; diskGiB: number };
}

export interface HostedSandboxProvisionInput {
  id: string;
  relayServerUrl: string;
  relayAgentToken: string;
  credentialRef: string;
  codexConfig: RelayHostedCodexConfigDto;
  localAdminUsername?: string;
}

export interface HostedSandboxInstance {
  id: string;
  name: string;
  status: string;
  statusCode: number | null;
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

  inventory(): Promise<HostedSandboxProviderInventory> {
    return this.disabled();
  }

  createCredential(
    _openaiApiKey: string,
    _idempotencyKey: string,
  ): Promise<string> {
    return this.disabled();
  }
  deleteCredential(
    _credentialRef: string,
    _idempotencyKey: string,
  ): Promise<void> {
    return this.disabled();
  }
  create(
    _input: HostedSandboxCreateInput,
    _idempotencyKey: string,
  ): Promise<HostedSandboxInstance> {
    return this.disabled();
  }
  status(_id: string): Promise<HostedSandboxInstance> {
    return this.disabled();
  }
  start(_id: string, _idempotencyKey: string): Promise<HostedSandboxInstance> {
    return this.disabled();
  }
  stop(_id: string, _idempotencyKey: string): Promise<HostedSandboxInstance> {
    return this.disabled();
  }
  snapshot(_id: string, _name: string, _idempotencyKey: string): Promise<void> {
    return this.disabled();
  }
  delete(_id: string, _idempotencyKey: string): Promise<void> {
    return this.disabled();
  }
  provision(
    _input: HostedSandboxProvisionInput,
    _idempotencyKey: string,
  ): Promise<void> {
    return this.disabled();
  }
  readCodexFiles(_id: string): Promise<RelayHostedCodexFilesDto> {
    return this.disabled();
  }
  writeCodexFiles(
    _id: string,
    _files: RelayHostedCodexFilesDto,
    _idempotencyKey: string,
  ): Promise<void> {
    return this.disabled();
  }

  private disabled<T>(): Promise<T> {
    return Promise.reject(new Error('Hosted sandbox provider is disabled.'));
  }
}

export class IncusHostedSandboxProvider implements HostedSandboxProvider {
  constructor(private readonly config: RelayServerConfig['hostedSandbox']) {}

  async capability(
    signal?: AbortSignal,
  ): Promise<RelayHostedSandboxCapabilityDto> {
    const result = await this.request<{
      available: boolean;
      credentialStoreReady?: boolean;
      limits?: {
        maxInstances: number;
        maxRunningInstances: number;
      };
      capacity?: {
        totalInstances: number;
        runningInstances: number;
      };
      metrics?: RelayHostedSandboxCapabilityDto['metrics'];
      alerts?: RelayHostedSandboxCapabilityDto['alerts'];
    }>('/v1/capability', signal ? { signal } : {});
    const available = result.available && result.credentialStoreReady === true;
    return {
      provider: 'incus',
      configured: true,
      reachable: true,
      available,
      reasonCode: available ? null : 'incus_host_agent_not_ready',
      reason: available
        ? null
        : 'Incus or encrypted credential storage is not ready.',
      checkedAt: new Date().toISOString(),
      ...(result.limits ? { limits: result.limits } : {}),
      ...(result.capacity ? { capacity: result.capacity } : {}),
      ...(result.metrics ? { metrics: result.metrics } : {}),
      ...(result.alerts ? { alerts: result.alerts } : {}),
    };
  }

  inventory() {
    return this.request<HostedSandboxProviderInventory>('/v1/inventory');
  }

  async createCredential(openaiApiKey: string, idempotencyKey: string) {
    const result = await this.request<{ credentialRef: string }>(
      '/v1/credentials',
      { method: 'POST', idempotencyKey, body: { openaiApiKey } },
    );
    return result.credentialRef;
  }

  async deleteCredential(credentialRef: string, idempotencyKey: string) {
    await this.request(`/v1/credentials/${encodeURIComponent(credentialRef)}`, {
      method: 'DELETE',
      idempotencyKey,
    });
  }

  create(input: HostedSandboxCreateInput, idempotencyKey: string) {
    return this.request<HostedSandboxInstance>('/v1/instances', {
      method: 'POST',
      idempotencyKey,
      body: input,
    });
  }

  status(id: string) {
    return this.request<HostedSandboxInstance>(
      `/v1/instances/${encodeURIComponent(id)}`,
    );
  }

  start(id: string, idempotencyKey: string) {
    return this.instanceMutation(id, 'start', idempotencyKey);
  }

  stop(id: string, idempotencyKey: string) {
    return this.instanceMutation(id, 'stop', idempotencyKey);
  }

  async snapshot(id: string, name: string, idempotencyKey: string) {
    await this.request(`/v1/instances/${encodeURIComponent(id)}/snapshots`, {
      method: 'POST',
      idempotencyKey,
      body: { name },
    });
  }

  async delete(id: string, idempotencyKey: string) {
    await this.request(`/v1/instances/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      idempotencyKey,
    });
  }

  async provision(input: HostedSandboxProvisionInput, idempotencyKey: string) {
    await this.request(
      `/v1/instances/${encodeURIComponent(input.id)}/provision`,
      {
        method: 'POST',
        idempotencyKey,
        body: {
          relayServerUrl: input.relayServerUrl,
          relayAgentToken: input.relayAgentToken,
          credentialRef: input.credentialRef,
          codexConfig: input.codexConfig,
          localAdminUsername: input.localAdminUsername ?? 'admin',
        },
      },
    );
  }

  readCodexFiles(id: string) {
    return this.request<RelayHostedCodexFilesDto>(
      `/v1/instances/${encodeURIComponent(id)}/backends/codex/files`,
    );
  }

  async writeCodexFiles(
    id: string,
    files: RelayHostedCodexFilesDto,
    idempotencyKey: string,
  ) {
    await this.request(
      `/v1/instances/${encodeURIComponent(id)}/backends/codex/files`,
      { method: 'PUT', idempotencyKey, body: files },
    );
  }

  private instanceMutation(
    id: string,
    action: 'start' | 'stop',
    idempotencyKey: string,
  ) {
    return this.request<HostedSandboxInstance>(
      `/v1/instances/${encodeURIComponent(id)}/${action}`,
      { method: 'POST', idempotencyKey },
    );
  }

  private async request<T = unknown>(
    pathname: string,
    options: {
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
      idempotencyKey?: string;
      body?: unknown;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    if (!this.config.agentUrl || !this.config.agentToken) {
      throw new Error('Incus host-agent is not configured.');
    }
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.agentToken}`,
    };
    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const request: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    };
    const response = await fetch(
      `${this.config.agentUrl.replace(/\/$/, '')}${pathname}`,
      request,
    );
    if (!response.ok) {
      throw new Error(
        `Incus host-agent request failed with ${response.status}.`,
      );
    }
    return (await response.json()) as T;
  }
}

export function createHostedSandboxProvider(
  config: RelayServerConfig['hostedSandbox'],
): HostedSandboxProvider {
  return config.provider === 'incus'
    ? new IncusHostedSandboxProvider(config)
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
