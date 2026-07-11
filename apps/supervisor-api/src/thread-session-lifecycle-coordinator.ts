import {
  getWorkspaceRecordById,
  getThreadRecordById,
  listThreadTurnMetadataByThreadId,
  updateThreadRecord,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import type {
  ApprovalMode,
  AgentBackendIdDto,
  ReasoningEffortDto,
  ResumeThreadInput,
} from '../../../packages/shared/src/index';
import { AgentRuntimeError } from '../../../packages/agent-runtime/src/index';
import { HttpError } from './app';
import { buildThreadPatch } from './dto';
import { ThreadSessionCoordinator } from './thread-session-coordinator';

interface ThreadSessionLifecycleCallbacks {
  invalidateThreadDetailCache(localThreadId: string): void;
  requireProviderSessionId(record: {
    providerSessionId?: string | null;
  }): string;
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
      if (!this.canRecreateUnmaterializedThread(record, resumed.error)) {
        return;
      }
      const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
      const model = input.model ?? record.model;
      if (!workspace || !model) {
        return;
      }
      const recreated = await this.sessionCoordinator.startThreadSession({
        workspacePath: workspace.absPath,
        threadInput: {
          workspaceId: workspace.id,
          title: record.title,
          provider: record.provider as AgentBackendIdDto,
          model,
          reasoningEffort: record.reasoningEffort as ReasoningEffortDto | null,
          approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
        },
        defaultTitle: record.title,
      });
      updateThreadRecord(this.db, record.id, {
        ...buildThreadPatch(
          recreated.response.session,
          model,
          recreated.response.reasoningEffort ?? recreated.reasoningEffort,
        ),
        providerSessionId: recreated.response.providerSessionId,
        sandboxMode: recreated.sandboxMode,
        isConnected: true,
      });
      this.callbacks.invalidateThreadDetailCache(localThreadId);
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

  private canRecreateUnmaterializedThread(
    record: { id: string; provider: string; source: string },
    error: unknown,
  ) {
    return (
      record.provider === 'codex' &&
      record.source === 'supervisor' &&
      listThreadTurnMetadataByThreadId(this.db, record.id).length === 0 &&
      error instanceof AgentRuntimeError &&
      error.provider === 'codex' &&
      error.code === 'remote_error' &&
      /thread not loaded|no rollout found/i.test(error.message)
    );
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
