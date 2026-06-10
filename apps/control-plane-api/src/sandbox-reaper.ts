import type { SandboxManager, SandboxProvisionResult } from './adapters';
import type { ControlPlaneRepository } from './repository';

const reaperStates = ['starting', 'stopping', 'running', 'degraded', 'failed'];

export interface SandboxReaperPolicy {
  staleStartingMs: number;
  staleStoppingMs: number;
  failedRuntimeTtlMs: number;
  idleTimeoutMs: number;
}

export interface SandboxReaperDecision {
  sandboxId: string;
  action: 'status_checked' | 'stop_requested' | 'marked_stopped' | 'skipped' | 'error';
  reason: string;
  state: string;
}

export interface SandboxReaperRun {
  checked: number;
  decisions: SandboxReaperDecision[];
}

export const defaultSandboxReaperPolicy: SandboxReaperPolicy = {
  staleStartingMs: 15 * 60 * 1000,
  staleStoppingMs: 10 * 60 * 1000,
  failedRuntimeTtlMs: 60 * 60 * 1000,
  idleTimeoutMs: 4 * 60 * 60 * 1000,
};

export class SandboxReaper {
  constructor(
    private readonly input: {
      repository: ControlPlaneRepository;
      sandboxManager: SandboxManager;
      policy?: Partial<SandboxReaperPolicy>;
      now?: () => Date;
    },
  ) {}

  async runOnce(): Promise<SandboxReaperRun> {
    const policy = { ...defaultSandboxReaperPolicy, ...this.input.policy };
    const now = this.input.now?.() ?? new Date();
    const sandboxes = this.input.repository.listSandboxesByStates(reaperStates);
    const decisions: SandboxReaperDecision[] = [];

    for (const sandbox of sandboxes) {
      try {
        decisions.push(await this.reconcileSandbox(sandbox, policy, now));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.input.repository.audit(sandbox.userId, 'sandbox.reaper_error', 'sandbox', sandbox.id, {
          state: sandbox.state,
          message,
        });
        decisions.push({
          sandboxId: sandbox.id,
          action: 'error',
          reason: message,
          state: sandbox.state,
        });
      }
    }
    decisions.push(...(await this.reconcileOrphanRuntimeResources()));

    return {
      checked: sandboxes.length,
      decisions,
    };
  }

  private async reconcileOrphanRuntimeResources(): Promise<SandboxReaperDecision[]> {
    if (!this.input.sandboxManager.listRuntimeResources) {
      return [];
    }
    const resources = await this.input.sandboxManager.listRuntimeResources();
    const decisions: SandboxReaperDecision[] = [];
    for (const resource of resources) {
      if (this.input.repository.hasSandbox(resource.sandboxId)) {
        continue;
      }
      if (!this.input.sandboxManager.cleanupRuntimeResource) {
        decisions.push({
          sandboxId: resource.sandboxId,
          action: 'skipped',
          reason: 'orphan_runtime_cleanup_unavailable',
          state: resource.state ?? 'unknown',
        });
        continue;
      }
      const result = await this.input.sandboxManager.cleanupRuntimeResource({
        sandboxId: resource.sandboxId,
        ...(resource.userId === undefined ? {} : { userId: resource.userId }),
        reason: 'orphan_runtime',
      });
      this.input.repository.audit(resource.userId ?? null, 'sandbox.orphan_runtime_cleaned', 'sandbox', resource.sandboxId, {
        labels: resource.labels ?? {},
        result,
      });
      decisions.push({
        sandboxId: resource.sandboxId,
        action: 'stop_requested',
        reason: 'orphan_runtime',
        state: result.state,
      });
    }
    return decisions;
  }

  private async reconcileSandbox(
    sandbox: ReturnType<ControlPlaneRepository['listSandboxes']>[number],
    policy: SandboxReaperPolicy,
    now: Date,
  ): Promise<SandboxReaperDecision> {
    const updatedAgeMs = ageMs(sandbox.updatedAt, now);
    const lastSeenAgeMs = ageMs(sandbox.lastSeenAt ?? sandbox.lastStartedAt ?? sandbox.updatedAt, now);

    if (sandbox.state === 'starting' && updatedAgeMs >= policy.staleStartingMs) {
      const result = await this.input.sandboxManager.getSandboxStatus({
        sandboxId: sandbox.id,
        userId: sandbox.userId,
      });
      this.input.repository.updateSandboxState(sandbox.id, normalizeStatusResult(result, 'stale starting reconciliation'));
      return {
        sandboxId: sandbox.id,
        action: 'status_checked',
        reason: 'stale_starting',
        state: result.state,
      };
    }

    if (sandbox.state === 'stopping' && updatedAgeMs >= policy.staleStoppingMs) {
      const result = await this.input.sandboxManager.getSandboxStatus({
        sandboxId: sandbox.id,
        userId: sandbox.userId,
      });
      if (result.state === 'stopped') {
        this.input.repository.updateSandboxState(sandbox.id, normalizeStatusResult(result, 'stale stopping reconciliation'));
        return {
          sandboxId: sandbox.id,
          action: 'marked_stopped',
          reason: 'stale_stopping_runtime_absent',
          state: 'stopped',
        };
      }
      const stopResult = await this.input.sandboxManager.stopSandbox({
        sandboxId: sandbox.id,
        userId: sandbox.userId,
      });
      this.input.repository.updateSandboxState(sandbox.id, {
        ...stopResult,
        statusReason: stopResult.statusReason ?? 'Reaper retried stale stopping sandbox cleanup.',
      });
      return {
        sandboxId: sandbox.id,
        action: 'stop_requested',
        reason: 'stale_stopping_runtime_present',
        state: stopResult.state,
      };
    }

    if (
      (sandbox.state === 'running' || sandbox.state === 'degraded') &&
      lastSeenAgeMs >= policy.idleTimeoutMs
    ) {
      const result = await this.input.sandboxManager.stopSandbox({
        sandboxId: sandbox.id,
        userId: sandbox.userId,
      });
      this.input.repository.updateSandboxState(sandbox.id, {
        ...result,
        statusReason: result.statusReason ?? 'Sandbox stopped after idle timeout.',
      });
      return {
        sandboxId: sandbox.id,
        action: 'stop_requested',
        reason: 'idle_timeout',
        state: result.state,
      };
    }

    if (sandbox.state === 'failed' && updatedAgeMs >= policy.failedRuntimeTtlMs) {
      const result = await this.input.sandboxManager.stopSandbox({
        sandboxId: sandbox.id,
        userId: sandbox.userId,
      });
      this.input.repository.updateSandboxState(sandbox.id, {
        ...result,
        statusReason: result.statusReason ?? 'Reaper cleaned failed sandbox runtime after TTL.',
      });
      return {
        sandboxId: sandbox.id,
        action: 'stop_requested',
        reason: 'failed_runtime_ttl',
        state: result.state,
      };
    }

    return {
      sandboxId: sandbox.id,
      action: 'skipped',
      reason: 'within_policy',
      state: sandbox.state,
    };
  }
}

function normalizeStatusResult(result: SandboxProvisionResult, fallbackReason: string) {
  return {
    ...result,
    statusReason: result.statusReason ?? fallbackReason,
  };
}

function ageMs(value: string | null, now: Date) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }
  return now.getTime() - timestamp;
}
