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
    if (this.config.runtimeRole !== 'worker') {
      throw new WorkerControlPlaneSyncError(
        'Session checkpoints can only be sent from worker mode.',
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

    const url = new URL(
      `/api/internal/sessions/${encodeURIComponent(input.sessionId)}/checkpoint`,
      this.config.controlPlaneBaseUrl,
    );
    const body = JSON.stringify({
      userId: this.config.userId,
      sandboxId: this.config.sandboxId,
      ...(input.workerSessionId !== undefined ? { workerSessionId: input.workerSessionId } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-remote-codex-service-token': this.config.controlPlaneServiceToken,
          },
          body,
        });
        if (response.ok) {
          return await response.json() as WorkerSessionCheckpointResult;
        }
        if (response.status < 500 || attempt === this.maxAttempts) {
          throw new WorkerControlPlaneSyncError(
            `Control-plane checkpoint failed with status ${response.status}.`,
            'checkpoint_rejected',
            response.status,
          );
        }
        lastError = new WorkerControlPlaneSyncError(
          `Control-plane checkpoint failed with status ${response.status}.`,
          'checkpoint_retryable',
          response.status,
        );
      } catch (error) {
        if (error instanceof WorkerControlPlaneSyncError && error.code === 'checkpoint_rejected') {
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
      lastError instanceof Error ? lastError.message : 'Control-plane checkpoint failed.',
      'checkpoint_failed',
    );
  }
}
