import { setTimeout as delay } from 'node:timers/promises';

import { RuntimeConfig } from '../../../packages/config/src/index';

export interface WorkerSessionCheckpointInput {
  sessionId: string;
  workerSessionId?: string | null | undefined;
  status?: 'created' | 'active' | 'idle' | 'archived' | 'deleted' | undefined;
}
export interface WorkerSessionCheckpointResult {
  session: {
    id: string;
    userId: string;
    sandboxId: string;
    workerSessionId: string | null;
    status: string;
    lastActivityAt: string | null;
  };
}

export interface WorkerHarnessUsageEventInput {
  workspaceId?: string | null | undefined;
  sessionId?: string | null | undefined;
  threadId?: string | null | undefined;
  turnId?: string | null | undefined;
  module: 'estructural' | 'quntur' | 'farmaco';
  tool?: string | null | undefined;
  runId?: string | null | undefined;
  jobId?: string | null | undefined;
  externalEventId?: string | null | undefined;
  computeUnits?: number | null | undefined;
  costUsd?: number | null | undefined;
  status?: string | null | undefined;
  metadata?: Record<string, unknown> | null | undefined;
  occurredAt?: string | null | undefined;
}

export interface WorkerHarnessQuotaCheckInput {
  workspaceId?: string | null | undefined;
  sessionId?: string | null | undefined;
  module: 'estructural' | 'quntur' | 'farmaco';
  tool?: string | null | undefined;
  estimatedComputeUnits?: number | null | undefined;
  estimatedCostUsd?: number | null | undefined;
}

export interface WorkerHarnessQuotaCheckResult {
  allowed: boolean;
  denial?: {
    reason: string;
    quotaProfile: string;
    limit: number;
    used: number;
  };
}

export interface WorkerHarnessUsageEventResult {
  harnessUsageEvent: {
    id: string;
    userId: string;
    sandboxId: string;
    workspaceId: string | null;
    sessionId: string | null;
    provider: string;
    module: string;
    tool: string | null;
    runId: string | null;
    jobId: string | null;
    externalEventId: string | null;
    computeUnits: number;
    costUsd: number;
    status: string;
    metadataJson: string;
    occurredAt: string;
    importedAt: string;
  };
}

export interface WorkerControlPlaneSyncOptions {
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  initialBackoffMs?: number;
}

export class WorkerControlPlaneSyncError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
  }
}

export class WorkerControlPlaneSyncClient {
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly initialBackoffMs: number;

  constructor(
    private readonly config: RuntimeConfig,
    options: WorkerControlPlaneSyncOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.initialBackoffMs = options.initialBackoffMs ?? 250;
  }

  async checkpointSession(input: WorkerSessionCheckpointInput): Promise<WorkerSessionCheckpointResult> {
    const url = new URL(
      `/api/internal/sessions/${encodeURIComponent(input.sessionId)}/checkpoint`,
      this.config.controlPlaneBaseUrl ?? 'http://127.0.0.1',
    );
    const body = this.internalRequestBody({
      userId: this.config.userId,
      sandboxId: this.config.sandboxId,
      ...(input.workerSessionId !== undefined ? { workerSessionId: input.workerSessionId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    return this.postWithRetry<WorkerSessionCheckpointResult>(url, body, {
      rejectedCode: 'checkpoint_rejected',
      retryableCode: 'checkpoint_retryable',
      failedCode: 'checkpoint_failed',
      label: 'Control-plane checkpoint',
    });
  }

  async recordHarnessUsageEvent(input: WorkerHarnessUsageEventInput): Promise<WorkerHarnessUsageEventResult> {
    const body = this.internalRequestBody({
      ...input,
      userId: this.config.userId,
      sandboxId: this.config.sandboxId,
    });
    const url = new URL('/api/internal/harness/usage-events', this.config.controlPlaneBaseUrl!);
    return this.postWithRetry<WorkerHarnessUsageEventResult>(url, body, {
      rejectedCode: 'harness_usage_rejected',
      retryableCode: 'harness_usage_retryable',
      failedCode: 'harness_usage_failed',
      label: 'Harness usage event',
    });
  }

  async checkHarnessQuota(input: WorkerHarnessQuotaCheckInput): Promise<WorkerHarnessQuotaCheckResult> {
    const body = this.internalRequestBody({
      ...input,
      userId: this.config.userId,
      sandboxId: this.config.sandboxId,
    });
    const url = new URL('/api/internal/harness/quota/check', this.config.controlPlaneBaseUrl!);
    return this.postWithRetry<WorkerHarnessQuotaCheckResult>(url, body, {
      rejectedCode: 'harness_quota_rejected',
      retryableCode: 'harness_quota_retryable',
      failedCode: 'harness_quota_failed',
      label: 'Harness quota check',
    });
  }

  private internalRequestBody(payload: Record<string, unknown>) {
    if (this.config.runtimeRole !== 'worker') {
      throw new WorkerControlPlaneSyncError(
        'Control-plane sync can only be sent from worker mode.',
        'not_worker',
      );
    }
    if (!this.config.controlPlaneBaseUrl || !this.config.controlPlaneServiceToken) {
      throw new WorkerControlPlaneSyncError(
        'Control-plane sync is not configured for this worker.',
        'not_configured',
      );
    }
    if (!this.config.userId || !this.config.sandboxId) {
      throw new WorkerControlPlaneSyncError(
        'Worker identity is missing user or sandbox id.',
        'identity_missing',
      );
    }
    return JSON.stringify(payload);
  }

  private async postWithRetry<T>(
    url: URL,
    body: string,
    errors: {
      rejectedCode: string;
      retryableCode: string;
      failedCode: string;
      label: string;
    },
  ): Promise<T> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-remote-codex-service-token': this.config.controlPlaneServiceToken!,
          },
          body,
        });
        if (response.ok) {
          return await response.json() as T;
        }
        if (response.status < 500 || attempt === this.maxAttempts) {
          throw new WorkerControlPlaneSyncError(
            `${errors.label} sync failed with status ${response.status}.`,
            errors.rejectedCode,
            response.status,
          );
        }
        lastError = new WorkerControlPlaneSyncError(
          `${errors.label} sync failed with status ${response.status}.`,
          errors.retryableCode,
          response.status,
        );
      } catch (error) {
        if (error instanceof WorkerControlPlaneSyncError && error.code === errors.rejectedCode) {
          throw error;
        }
        lastError = error;
        if (attempt === this.maxAttempts) {
          break;
        }
      }
      await delay(this.initialBackoffMs * attempt);
    }

    throw new WorkerControlPlaneSyncError(
      lastError instanceof Error ? lastError.message : `${errors.label} sync failed.`,
      errors.failedCode,
    );
  }
}
