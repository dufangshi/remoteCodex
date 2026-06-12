import crypto from 'node:crypto';

import type { FastifyBaseLogger } from 'fastify';

import type { RuntimeConfig } from '../../../packages/config/src/index';
import type { DatabaseClient } from '../../../packages/db/src/client';
import {
  getHarnessJobWatchByJobId,
  getHarnessNotifyRegistration,
  getThreadRecordById,
  listPendingHarnessJobWatches,
  listThreadRecords,
  updateHarnessJobWatch,
  upsertHarnessJobWatch,
  upsertHarnessNotifyRegistration,
} from '../../../packages/db/src/repositories';
import { HttpError } from './app';
import type { ThreadService } from './thread-service';
import type { WorkerHarnessClient } from './worker-harness-client';

const JOB_ID_FROM_MESSAGE_PATTERN = /^id:\s*(\S+)\s*$/m;

function timingSafeEqualString(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export interface HarnessWakeupCallbackInput {
  hookToken: string;
  rawBody: Buffer;
  signature: string | null;
}

export class HarnessWakeupService {
  private reconcileInFlight: Promise<void> | null = null;
  private reconcileQueued = false;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly db: DatabaseClient,
    private readonly harnessClient: WorkerHarnessClient,
    private readonly threadService: ThreadService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  enabled() {
    return Boolean(
      this.config.harnessEnabled &&
      this.config.harnessWakeupCallbackBaseUrl &&
      this.harnessClient.configured().keyPresent,
    );
  }

  private requireEnabled() {
    if (!this.enabled()) {
      throw new HttpError(409, {
        code: 'conflict',
        message:
          'Harness wakeup is not configured. REMOTE_CODEX_HARNESS_WAKEUP_CALLBACK_BASE_URL and the Harness key are required.',
      });
    }
  }

  private buildCallbackUrl(hookToken: string) {
    const base = this.config.harnessWakeupCallbackBaseUrl!.replace(/\/+$/, '');
    const userSuffix = this.config.userId
      ? `?u=${encodeURIComponent(this.config.userId)}`
      : '';
    return `${base}/harness-notify/${hookToken}${userSuffix}`;
  }

  async ensureRegistration() {
    this.requireEnabled();
    const existing = getHarnessNotifyRegistration(this.db);
    if (existing) {
      const desiredUrl = this.buildCallbackUrl(existing.hookToken);
      if (existing.callbackUrl === desiredUrl) {
        return existing;
      }
      await this.harnessClient.registerNotifyCallback({
        agentId: existing.agentId,
        callback: desiredUrl,
        secret: existing.secret,
      });
      return upsertHarnessNotifyRegistration(this.db, {
        agentId: existing.agentId,
        hookToken: existing.hookToken,
        secret: existing.secret,
        callbackUrl: desiredUrl,
      });
    }

    const { agentId } = await this.harnessClient.whoami();
    const hookToken = crypto.randomBytes(32).toString('hex');
    const secret = crypto.randomBytes(32).toString('hex');
    const callbackUrl = this.buildCallbackUrl(hookToken);
    await this.harnessClient.registerNotifyCallback({
      agentId,
      callback: callbackUrl,
      secret,
    });
    return upsertHarnessNotifyRegistration(this.db, {
      agentId,
      hookToken,
      secret,
      callbackUrl,
    });
  }

  async getWakeupInfo() {
    if (!this.enabled()) {
      return { enabled: false as const };
    }
    const registration = await this.ensureRegistration();
    return {
      enabled: true as const,
      notifyTo: registration.agentId,
    };
  }

  async watchJob(input: { jobId: string; threadId?: string | null; title?: string | null }) {
    this.requireEnabled();
    const jobId = input.jobId.trim();
    if (!jobId) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'jobId is required.',
      });
    }

    let threadId = input.threadId?.trim() || null;
    if (!threadId) {
      const runningThreads = listThreadRecords(this.db).filter(
        (thread) => thread.status === 'running',
      );
      if (runningThreads.length === 1) {
        threadId = runningThreads[0]!.id;
      }
    }
    if (!threadId) {
      throw new HttpError(400, {
        code: 'bad_request',
        message:
          'threadId is required when it cannot be inferred from a single running thread.',
      });
    }
    if (!getThreadRecordById(this.db, threadId)) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const registration = await this.ensureRegistration();
    const watch = upsertHarnessJobWatch(this.db, {
      jobId,
      threadId,
      title: input.title ?? null,
    });
    return {
      watch,
      notifyTo: registration.agentId,
    };
  }

  verifyCallback(input: HarnessWakeupCallbackInput) {
    const registration = getHarnessNotifyRegistration(this.db);
    if (!registration || !timingSafeEqualString(registration.hookToken, input.hookToken)) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Unknown harness hook.',
      });
    }
    const expected = crypto
      .createHmac('sha256', registration.secret)
      .update(input.rawBody)
      .digest('hex');
    if (!input.signature || !timingSafeEqualString(expected, input.signature.trim())) {
      throw new HttpError(403, {
        code: 'forbidden',
        message: 'Invalid harness hook signature.',
      });
    }

    let payload: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(input.rawBody.toString('utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>;
      }
    } catch {
      // Callback bodies are informational; reconcile does not depend on them.
    }
    return payload;
  }

  handleCallback(input: HarnessWakeupCallbackInput) {
    const payload = this.verifyCallback(input);
    this.scheduleReconcile();
    return {
      accepted: true,
      type: typeof payload.type === 'string' ? payload.type : null,
    };
  }

  scheduleReconcile() {
    if (this.reconcileInFlight) {
      this.reconcileQueued = true;
      return;
    }
    this.reconcileInFlight = this.reconcile()
      .catch((error) => {
        this.logger.error({ err: error }, 'Harness wakeup reconcile failed.');
      })
      .finally(() => {
        this.reconcileInFlight = null;
        if (this.reconcileQueued) {
          this.reconcileQueued = false;
          this.scheduleReconcile();
        }
      });
  }

  async waitForReconcile() {
    while (this.reconcileInFlight) {
      await this.reconcileInFlight;
    }
  }

  async reconcile() {
    const watches = listPendingHarnessJobWatches(this.db);
    for (const watch of watches) {
      try {
        const job = await this.harnessClient.getComputeJob(watch.jobId);
        updateHarnessJobWatch(this.db, watch.id, {
          lastJobStatus: job.status,
        });
        if (!job.terminal) {
          continue;
        }
        await this.wakeThread(watch, job);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          { jobId: watch.jobId, threadId: watch.threadId, err: error },
          'Harness wakeup delivery attempt failed; will retry on the next callback.',
        );
        updateHarnessJobWatch(this.db, watch.id, { lastError: message });
      }
    }
    await this.acknowledgeNotifications();
  }

  private async wakeThread(
    watch: ReturnType<typeof listPendingHarnessJobWatches>[number],
    job: { jobId: string; status: string | null; title: string | null; reason: string | null },
  ) {
    const thread = getThreadRecordById(this.db, watch.threadId);
    if (!thread) {
      updateHarnessJobWatch(this.db, watch.id, {
        status: 'failed',
        lastError: 'Thread was not found.',
      });
      return;
    }

    if (thread.isConnected === false) {
      await this.threadService.resumeThread(watch.threadId);
    }

    const title = watch.title ?? job.title;
    const prompt = [
      `[Harness job wakeup] Compute job ${job.jobId}${title ? ` ("${title}")` : ''} finished with status: ${job.status}.`,
      job.reason ? `Reason: ${job.reason}.` : null,
      `Retrieve details and outputs from the ElAgente Harness API (GET /compute/jobs/${job.jobId}, output files under GET /compute/jobs/${job.jobId}/files/...) using the INACT_X_APP_KEY env var, then continue the original task.`,
    ]
      .filter(Boolean)
      .join(' ');

    await this.threadService.sendPrompt(watch.threadId, { prompt });
    updateHarnessJobWatch(this.db, watch.id, {
      status: 'delivered',
      lastError: null,
      deliveredAt: new Date().toISOString(),
    });
  }

  private async acknowledgeNotifications() {
    let notifications;
    try {
      notifications = await this.harnessClient.listUnreadNotifications();
    } catch (error) {
      this.logger.warn({ err: error }, 'Harness wakeup inbox listing failed.');
      return;
    }
    for (const notification of notifications) {
      if (notification.from !== 'jobs') {
        continue;
      }
      const jobId = JOB_ID_FROM_MESSAGE_PATTERN.exec(notification.message)?.[1] ?? null;
      const watch = jobId ? getHarnessJobWatchByJobId(this.db, jobId) : null;
      if (watch && watch.status === 'pending') {
        continue;
      }
      try {
        await this.harnessClient.markNotificationRead(notification.id);
      } catch (error) {
        this.logger.warn(
          { notificationId: notification.id, err: error },
          'Harness wakeup notification acknowledgement failed.',
        );
      }
    }
  }
}
