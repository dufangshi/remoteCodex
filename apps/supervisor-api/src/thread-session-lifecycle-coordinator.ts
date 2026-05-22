import {
  getThreadRecordById,
  updateThreadRecord,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import type {
  ApprovalMode,
  ResumeThreadInput,
} from '../../../packages/shared/src/index';
import { HttpError } from './app';
import { buildThreadPatch } from './dto';
import { ThreadSessionCoordinator } from './thread-session-coordinator';

interface ThreadSessionLifecycleCallbacks {
  invalidateThreadDetailCache(localThreadId: string): void;
  requireProviderSessionId(record: { providerSessionId?: string | null }): string;
  resetThreadContextUsage(localThreadId: string): void;
}

export class ThreadSessionLifecycleCoordinator {
  constructor(
    private readonly db: DatabaseClient,
    private readonly sessionCoordinator: ThreadSessionCoordinator,
    private readonly callbacks: ThreadSessionLifecycleCallbacks,
  ) {}

  async resumeThread(localThreadId: string, input: ResumeThreadInput = {}) {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    const providerSessionId = this.callbacks.requireProviderSessionId(record);

    const resumed = await this.sessionCoordinator.resumeThreadSession({
      provider: record.provider,
      providerSessionId,
      resumeInput: input,
      currentModel: record.model,
      currentReasoningEffort: record.reasoningEffort,
      currentSandboxMode: record.sandboxMode,
      approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
      fastMode: record.fastMode,
    });
    if (resumed.status === 'bootstrap_unavailable') {
      return;
    }

    updateThreadRecord(
      this.db,
      record.id,
      buildThreadPatch(
        resumed.response.session,
        resumed.effectiveModel,
        resumed.resumedReasoning,
      ),
    );
    updateThreadRecord(this.db, record.id, {
      sandboxMode: resumed.sandboxMode,
      providerSessionId: resumed.response.providerSessionId,
    });

    updateThreadRecord(this.db, record.id, {
      isConnected: true,
    });
    if (resumed.modelChanged) {
      this.callbacks.resetThreadContextUsage(record.id);
    }
    this.callbacks.invalidateThreadDetailCache(localThreadId);
  }

  disconnectThread(localThreadId: string) {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    updateThreadRecord(this.db, record.id, {
      isConnected: false,
    });
    this.callbacks.invalidateThreadDetailCache(localThreadId);
  }
}
