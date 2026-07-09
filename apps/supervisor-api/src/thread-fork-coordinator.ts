import {
  createThreadForkRecord,
  createThreadRecord,
  getThreadRecordById,
  updateThreadRecord,
  type DatabaseClient,
} from '../../../packages/db/src/index';
import type {
  AgentProviderId,
} from '../../../packages/agent-runtime/src/index';
import type {
  ApprovalMode,
  ForkThreadInput,
  ThreadDetailDto,
  ThreadForkResultDto,
  ThreadForkTurnOptionDto,
} from '../../../packages/shared/src/index';
import { HttpError } from './app';
import {
  ThreadDetailAssembler,
} from './thread-detail-assembler';
import { ThreadSessionCoordinator } from './thread-session-coordinator';
import { listThreadTurnMetadataMap } from './thread-turn-metadata';

interface ThreadForkCallbacks {
  requireProviderSessionId(record: { providerSessionId?: string | null }): string;
  providerForRecord(record: { provider?: string | null | undefined }): AgentProviderId;
  fastModeForProvider(provider: string | null | undefined, fastMode: unknown): boolean;
  normalizeCollaborationMode(value: string | null | undefined): 'default' | 'plan';
  normalizeSandboxMode(value: string | null | undefined): 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  normalizeReasoningEffort(value: string | null | undefined):
    | 'none'
    | 'minimal'
    | 'low'
    | 'medium'
    | 'high'
    | 'xhigh'
    | 'max'
    | 'ultra'
    | null;
  buildThreadPatch(
    remoteSession: Parameters<ThreadSessionCoordinator['forkThreadSession']>[0] extends never
      ? never
      : Awaited<ReturnType<ThreadSessionCoordinator['forkThreadSession']>>['forkedSession'],
    model: string | null | undefined,
    reasoningEffort: string | null | undefined,
  ): Record<string, unknown>;
  invalidateThreadDetailCache(localThreadId: string): void;
  getThreadDetail(localThreadId: string): Promise<ThreadDetailDto>;
}

const DEFAULT_THREAD_TITLE = 'Untitled thread';

export class ThreadForkCoordinator {
  constructor(
    private readonly db: DatabaseClient,
    private readonly detailAssembler: ThreadDetailAssembler,
    private readonly sessionCoordinator: ThreadSessionCoordinator,
    private readonly callbacks: ThreadForkCallbacks,
  ) {}

  async listForkTurnOptions(localThreadId: string): Promise<ThreadForkTurnOptionDto[]> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    this.callbacks.requireProviderSessionId(record);

    const turnMetadataById = listThreadTurnMetadataMap(this.db, localThreadId);
    const cachedDetail = await this.detailAssembler.buildCacheEntry({
      localThreadId,
      record,
      turnMetadataById,
    });

    return cachedDetail.turns.map((turn, index) => ({
      turnId: turn.id,
      turnIndex: index + 1,
      startedAt: turn.startedAt,
      status: turn.status,
    }));
  }

  async forkThread(
    localThreadId: string,
    input: ForkThreadInput,
  ): Promise<ThreadForkResultDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    const providerSessionId = this.callbacks.requireProviderSessionId(record);

    if (record.status === 'running') {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Cannot fork a thread while it is still running.',
      });
    }

    const turnOptions = await this.listForkTurnOptions(localThreadId);
    const forkResult = await this.sessionCoordinator.forkThreadSession({
      provider: record.provider,
      providerSessionId,
      mode: input.mode,
      ...(input.turnId ? { turnId: input.turnId } : {}),
      turnOptions,
    });
    const forkedSession = forkResult.forkedSession;

    const forkTitleBase = record.title.trim() || DEFAULT_THREAD_TITLE;
    const created = createThreadRecord(this.db, {
      workspaceId: record.workspaceId,
      provider: this.callbacks.providerForRecord(record),
      providerSessionId: forkedSession.providerSessionId,
      title: `${forkTitleBase} / fork`,
      model: record.model,
      reasoningEffort: record.reasoningEffort,
      fastMode: this.callbacks.fastModeForProvider(record.provider, record.fastMode),
      fastBaseModel: record.fastBaseModel,
      fastBaseReasoningEffort: record.fastBaseReasoningEffort,
      collaborationMode: this.callbacks.normalizeCollaborationMode(record.collaborationMode),
      approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
      sandboxMode: this.callbacks.normalizeSandboxMode(record.sandboxMode),
      summaryText: forkedSession.preview,
      source: 'supervisor',
      isConnected: true,
    });

    updateThreadRecord(this.db, created.id, {
      ...this.callbacks.buildThreadPatch(
        forkedSession,
        record.model,
        this.callbacks.normalizeReasoningEffort(record.reasoningEffort),
      ),
      title: `${forkTitleBase} / fork`,
    });

    createThreadForkRecord(this.db, {
      sourceThreadId: localThreadId,
      sourceTurnId: forkResult.selectedSourceTurnId,
      sourceTurnIndex: forkResult.selectedSourceTurnIndex,
      forkedThreadId: created.id,
    });

    this.callbacks.invalidateThreadDetailCache(localThreadId);
    this.callbacks.invalidateThreadDetailCache(created.id);

    return {
      thread: await this.callbacks.getThreadDetail(created.id),
      sourceThreadId: localThreadId,
      sourceTurnId: forkResult.selectedSourceTurnId,
      sourceTurnIndex: forkResult.selectedSourceTurnIndex,
    };
  }
}
