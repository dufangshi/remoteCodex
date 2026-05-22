import fs from 'node:fs/promises';
import path from 'node:path';

import {
  AgentRuntime,
  AgentRuntimeRegistry,
  AgentProviderId,
  AgentProviderRequest,
  AgentRuntimeEvent,
  AgentSessionDetail,
  AgentTurn,
} from '../../../packages/agent-runtime/src/index';
import {
  createThreadRecord,
  DatabaseClient,
  getThreadRecordByProviderSessionId,
  getThreadRecordById,
  getWorkspaceRecordById,
  listThreadTurnMetadataByThreadId,
  listThreadRecords,
  upsertThreadTurnMetadata,
  updateThreadRecord
} from '../../../packages/db/src/index';
import {
  ApprovalMode,
  CollaborationModeDto,
  CreateThreadInput,
  ExportThreadPdfInput,
  ForkThreadInput,
  ImportThreadInput,
  CreateThreadHookInput,
  ModelOptionDto,
  ReasoningEffortDto,
  RespondThreadActionRequestInput,
  ResumeThreadInput,
  SendThreadPromptInput,
  ThreadActionRequestDto,
  ThreadContextUsageDto,
  ThreadDetailDto,
  ThreadDto,
  ThreadEventEnvelope,
  ThreadEventPayloadMap,
  ThreadExportTurnOptionsDto,
  ThreadForkResultDto,
  ThreadForkTurnOptionDto,
  ThreadGoalDto,
  ThreadHooksDto,
  TrustThreadHookInput,
  ThreadHistoryItemDetailDto,
  ThreadLiveItemsDto,
  ThreadLivePlanDto,
  ThreadMcpServersDto,
  ThreadSkillsDto,
  ThreadTurnDto,
  truncateAutoThreadTitle,
  UntrustThreadHookInput,
  UpdateThreadGoalInput,
  UpdateThreadHookInput,
  UpdateThreadSettingsInput
} from '../../../packages/shared/src/index';
import { HttpError } from './app';
import { SupervisorEventBus } from './event-bus';
import { ThreadAuxiliaryStateStore } from './thread-auxiliary-state-store';
import {
  ThreadGoalCoordinator,
} from './thread-goal-coordinator';
import { ThreadLiveStateStore } from './thread-live-state-store';
import { ThreadRuntimeEventProjector } from './thread-runtime-event-projector';
import {
  ProviderRequestCoordinator,
} from './provider-request-coordinator';
import {
  buildThreadContextUsageFromPayload,
  createUnavailableThreadContextUsage,
  normalizePricingTier,
  stringifyStoredThreadTurnTokenUsageState,
  ThreadContextTokenUsagePayload,
  ThreadUsageAccounting,
} from './thread-usage-accounting';
import {
  agentTurnToThreadTurnDto,
} from './thread-history-items';
import {
  ThreadDetailAssembler,
  type ThreadTurnMetadataRecord,
} from './thread-detail-assembler';
import {
  normalizeReasoningEffort,
  ThreadProviderRuntimeCoordinator,
} from './thread-provider-runtime-coordinator';
import {
  ThreadManagementCoordinator,
  type ThreadHookFileManagement,
} from './thread-management-coordinator';
import { ThreadPromptTurnCoordinator } from './thread-prompt-turn-coordinator';
import {
  ThreadSessionCoordinator,
  type ThreadLocalSessionLookup,
  type ThreadPerformanceModeSettings,
} from './thread-session-coordinator';
import { ThreadSessionLifecycleCoordinator } from './thread-session-lifecycle-coordinator';
import { ThreadHistoryPersistenceCoordinator } from './thread-history-persistence-coordinator';
import { ThreadDeletionCoordinator } from './thread-deletion-coordinator';
import { ThreadExportCoordinator } from './thread-export-coordinator';
import {
  buildThreadPatch,
  defaultSandboxModeForApprovalMode,
  normalizeCollaborationMode,
  normalizeSandboxMode,
  toThreadDto as threadRecordToThreadDto,
  toWorkspaceDto,
} from './dto';
import { ThreadForkCoordinator } from './thread-fork-coordinator';
import {
  ThreadAttachmentCoordinator,
  type UploadedPromptAttachment,
} from './thread-attachment-coordinator';
import { ThreadImportCoordinator } from './thread-import-coordinator';
import {
  ProviderFeatureCoordinator,
  type ProviderGoalFeatureAdapter,
} from './provider-feature-coordinator';
import type { PluginService } from './plugins/plugin-service';

const DEFAULT_THREAD_TITLE = 'Untitled thread';
const GENERIC_REMOTE_THREAD_TITLE = 'Thread';
const IMPLEMENT_APPROVED_PLAN_PROMPT = 'Implement the approved plan.';
const LOCAL_PLAN_DECISION_PREFIX = 'plan-decision:';
const FAST_MODE_NOTE_ON = 'Fast mode on';
const FAST_MODE_NOTE_OFF = 'Fast mode off';

interface SendPromptOptions {
  displayPrompt?: string | null;
}

async function pathExists(absPath: string) {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

export class ThreadService {
  private readonly liveState = new ThreadLiveStateStore();
  private readonly detailAssembler: ThreadDetailAssembler;
  private readonly usageAccounting: ThreadUsageAccounting;
  private readonly requestCoordinator: ProviderRequestCoordinator;
  private readonly runtimeEventProjector: ThreadRuntimeEventProjector;
  private readonly auxiliaryState: ThreadAuxiliaryStateStore;
  private readonly providerRuntime: ThreadProviderRuntimeCoordinator;
  private readonly managementCoordinator: ThreadManagementCoordinator;
  private readonly promptTurnCoordinator: ThreadPromptTurnCoordinator;
  private readonly sessionCoordinator: ThreadSessionCoordinator;
  private readonly sessionLifecycleCoordinator: ThreadSessionLifecycleCoordinator;
  private readonly goalCoordinator: ThreadGoalCoordinator;
  private readonly historyPersistence: ThreadHistoryPersistenceCoordinator;
  private readonly deletionCoordinator: ThreadDeletionCoordinator;
  private readonly exportCoordinator: ThreadExportCoordinator;
  private readonly forkCoordinator: ThreadForkCoordinator;
  private readonly attachmentCoordinator: ThreadAttachmentCoordinator;
  private readonly importCoordinator: ThreadImportCoordinator;

  constructor(
    private readonly db: DatabaseClient,
    agentRuntimes: AgentRuntimeRegistry,
    private readonly eventBus: SupervisorEventBus,
    localSessionStore: ThreadLocalSessionLookup,
    private readonly workspaceRoot: string,
    providerManagement: ThreadHookFileManagement &
      ProviderGoalFeatureAdapter &
      ThreadPerformanceModeSettings,
    private readonly pluginService?: PluginService,
  ) {
    this.providerRuntime = new ThreadProviderRuntimeCoordinator(agentRuntimes);
    this.historyPersistence = new ThreadHistoryPersistenceCoordinator(db, this.liveState);
    this.attachmentCoordinator = new ThreadAttachmentCoordinator(db);
    this.managementCoordinator = new ThreadManagementCoordinator(providerManagement, {
      runtimeForProvider: (provider) => this.runtimeForProvider(provider),
    });
    this.sessionCoordinator = new ThreadSessionCoordinator(
      this.providerRuntime,
      providerManagement,
      localSessionStore,
    );
    this.sessionLifecycleCoordinator = new ThreadSessionLifecycleCoordinator(
      db,
      this.sessionCoordinator,
      {
        invalidateThreadDetailCache: (localThreadId) =>
          this.invalidateThreadDetailCache(localThreadId),
        requireProviderSessionId: (record) => this.requireProviderSessionId(record),
        resetThreadContextUsage: (localThreadId) =>
          this.resetThreadContextUsage(localThreadId),
      },
    );
    this.importCoordinator = new ThreadImportCoordinator(
      db,
      this.sessionCoordinator,
      workspaceRoot,
    );
    this.promptTurnCoordinator = new ThreadPromptTurnCoordinator(
      db,
      this.liveState,
      this.providerRuntime,
      {
        runtimeForProvider: (provider) => this.runtimeForProvider(provider),
        resetThreadContextUsage: (localThreadId, emitEvent) =>
          this.resetThreadContextUsage(localThreadId, emitEvent),
        invalidateThreadDetailCache: (localThreadId) =>
          this.invalidateThreadDetailCache(localThreadId),
        emitThreadUpdated: (localThreadId, payload) =>
          this.emitThreadEvent('thread.updated', localThreadId, payload),
        toThreadDto: (record, loadedIds) => this.toThreadDto(record, loadedIds),
      },
    );
    this.detailAssembler = new ThreadDetailAssembler({
      liveState: this.liveState,
      callbacks: {
        buildThreadPatch: (remoteSession, model, reasoningEffort) =>
          buildThreadPatch(remoteSession, model, reasoningEffort),
        findLocalSession: (providerSessionId) =>
          this.sessionCoordinator.findLocalFallbackSession(providerSessionId),
        getUpdatedThreadRecord: (localThreadId) =>
          getThreadRecordById(this.db, localThreadId)!,
        listPersistedHistoryItemsByTurnId: (localThreadId) =>
          this.historyPersistence.listPersistedHistoryItemsByTurnId(localThreadId),
        materializeHiddenRuntimeTurns: (localThreadId, turns) =>
          this.materializeHiddenRuntimeTurns(localThreadId, turns),
        readRemoteSession: async (record, options) => {
          if (!this.optionalRuntimeForProvider(record.provider)) {
            return null;
          }
          const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
          return this.sessionCoordinator.readRemoteSession({
            provider: record.provider,
            providerSessionId: this.requireProviderSessionId(record),
            options: {
              ...options,
              localThreadId: record.id,
              ...(workspace ? { workspacePath: workspace.absPath } : {}),
            },
          });
        },
        resumeRemoteSession: async (record) => {
          return this.sessionCoordinator.resumeRemoteSession({
            provider: record.provider,
            providerSessionId: this.requireProviderSessionId(record),
          });
        },
        syncAfterRemoteSession: (localThreadId, remoteSession) => {
          const updated = getThreadRecordById(this.db, localThreadId)!;
          this.syncPendingPlanDecisionRequest(
            updated.id,
            updated.collaborationMode,
            remoteSession,
          );
          this.auxiliaryState.reconcilePendingSteers(updated.id, remoteSession);
        },
        updateThreadRecord: (localThreadId, patch) =>
          updateThreadRecord(this.db, localThreadId, patch),
      },
    });
    this.usageAccounting = new ThreadUsageAccounting(db);
    const providerFeatures = new ProviderFeatureCoordinator(
      this.providerRuntime,
      providerManagement,
    );
    this.goalCoordinator = new ThreadGoalCoordinator(db, providerFeatures, {
      emitThreadEvent: (type, threadId, payload) =>
        this.emitThreadEvent(type, threadId, payload),
      ensureThreadLoaded: (record) =>
        this.ensureThreadLoadedForProviderOperation(record),
      requireProviderSessionId: (record) => this.requireProviderSessionId(record),
      runtimeForProvider: (provider) => this.runtimeForProvider(provider),
    });
    this.auxiliaryState = new ThreadAuxiliaryStateStore(db, {
      cachedTurns: (localThreadId) => this.detailAssembler.cachedTurns(localThreadId),
      emitPendingSteerUpdated: (localThreadId, turnId) =>
        this.emitThreadEvent('thread.updated', localThreadId, {
          reason: 'pending_steer_updated',
          ...(turnId ? { turnId } : {}),
        }),
      invalidateThreadDetailCache: (localThreadId) =>
        this.invalidateThreadDetailCache(localThreadId),
    });
    this.requestCoordinator = new ProviderRequestCoordinator({
      emitThreadEvent: (type, threadId, payload) =>
        this.emitThreadEvent(type, threadId, payload),
      findRecordByProviderSessionId: (provider, providerSessionId) =>
        this.findRecordByProviderSessionId(provider, providerSessionId),
      normalizeCollaborationMode,
      runtimeForProvider: (provider) => this.runtimeForProvider(provider),
    });
    this.deletionCoordinator = new ThreadDeletionCoordinator(
      db,
      this.requestCoordinator,
      this.usageAccounting,
      this.liveState,
      this.auxiliaryState,
      {
        invalidateThreadDetailCache: (localThreadId) =>
          this.invalidateThreadDetailCache(localThreadId),
      },
    );
    this.exportCoordinator = new ThreadExportCoordinator(
      db,
      this.detailAssembler,
      {
        requireProviderSessionId: (record) => this.requireProviderSessionId(record),
        toThreadDto: (record, loadedIds) => this.toThreadDto(record, loadedIds),
      },
    );
    this.forkCoordinator = new ThreadForkCoordinator(
      db,
      this.detailAssembler,
      this.sessionCoordinator,
      {
        buildThreadPatch: (remoteSession, model, reasoningEffort) =>
          buildThreadPatch(remoteSession, model, reasoningEffort),
        fastModeForProvider: (provider, fastMode) =>
          this.fastModeForProvider(provider, fastMode),
        getThreadDetail: (localThreadId) => this.getThreadDetail(localThreadId),
        invalidateThreadDetailCache: (localThreadId) =>
          this.invalidateThreadDetailCache(localThreadId),
        normalizeCollaborationMode,
        normalizeReasoningEffort,
        normalizeSandboxMode,
        providerForRecord: (record) => this.providerForRecord(record),
        requireProviderSessionId: (record) => this.requireProviderSessionId(record),
      },
    );
    this.runtimeEventProjector = new ThreadRuntimeEventProjector({
      db,
      liveState: this.liveState,
      usageAccounting: this.usageAccounting,
      callbacks: {
        appendLiveAgentMessageDelta: (input) =>
          this.appendLiveAgentMessageDelta(
            input.localThreadId,
            input.turnId,
            input.itemId,
            input.delta,
            input.sequence,
          ),
        clearPendingPlanDecisionRequests: (localThreadId, emitEvents) =>
          this.clearPendingPlanDecisionRequests(localThreadId, emitEvents),
        clearPendingSteersForTurn: (localThreadId, turnId) =>
          this.auxiliaryState.clearPendingSteersForTurn(localThreadId, turnId),
        clearTerminalPendingRequests: (localThreadId, emitEvents) =>
          this.clearTerminalPendingRequests(localThreadId, emitEvents),
        copyRuntimeTurnTokenUsageToDisplayTurn: (localThreadId, runtimeTurnId, displayTurnId) =>
          this.historyPersistence.copyRuntimeTurnTokenUsageToDisplayTurn(
            localThreadId,
            runtimeTurnId,
            displayTurnId,
          ),
        createPendingPlanDecisionRequest: (localThreadId, turnId, emitEvents) =>
          this.createPendingPlanDecisionRequest(localThreadId, turnId, emitEvents),
        deletePersistedHistoryItemsForTurn: (localThreadId, turnId) =>
          this.historyPersistence.deletePersistedHistoryItemsForTurn(localThreadId, turnId),
        dismissPlanDecisionTurn: (localThreadId) =>
          this.requestCoordinator.dismissPlanDecisionTurn(localThreadId),
        emitThreadEvent: (type, threadId, payload) =>
          this.emitThreadEvent(type, threadId, payload),
        fastModeForProvider: (provider, fastMode) =>
          this.fastModeForProvider(provider, fastMode),
        hasPendingAskUserQuestion: (localThreadId) =>
          this.hasPendingAskUserQuestion(localThreadId),
        invalidateThreadDetailCache: (localThreadId) =>
          this.invalidateThreadDetailCache(localThreadId),
        listThreadGoalHistory: (localThreadId) =>
          this.goalCoordinator.listThreadGoalHistory(localThreadId),
        normalizeCollaborationMode,
        normalizeReasoningEffort,
        normalizeThreadGoalStatusForThread: (goal, record) =>
          this.goalCoordinator.normalizeThreadGoalStatusForThread(goal, record),
        persistLiveHistoryItem: (localThreadId, turnId, item) =>
          this.historyPersistence.persistLiveHistoryItem(localThreadId, turnId, item),
        persistRuntimeTurnItemsAsDisplayTurn: (localThreadId, runtimeTurnId, displayTurnId, items) =>
          this.historyPersistence.persistRuntimeTurnItemsAsDisplayTurn(
            localThreadId,
            runtimeTurnId,
            displayTurnId,
            items,
          ),
        persistThreadGoalSnapshot: (localThreadId, goal) =>
          this.goalCoordinator.persistThreadGoalSnapshot(localThreadId, goal),
        resetThreadContextUsage: (localThreadId, emitEvent) =>
          this.resetThreadContextUsage(localThreadId, emitEvent),
        setThreadContextUsage: (localThreadId, usage, emitEvent) =>
          this.setThreadContextUsage(localThreadId, usage, emitEvent),
        toThreadGoalDtoFromAgentGoal: (goal) =>
          this.goalCoordinator.toThreadGoalDtoFromAgentGoal(goal),
        toThreadGoalDtoFromRecord: (record) =>
          this.goalCoordinator.toThreadGoalDtoFromRecord(record),
      },
    });
    for (const runtime of this.providerRuntime.allRuntimes()) {
      runtime.on('event', (event) => {
        void this.handleRuntimeEvent(event as AgentRuntimeEvent);
      });
      runtime.on('provider-request', (request) => {
        void this.handleProviderRequest(request as AgentProviderRequest);
      });
    }
  }

  private normalizeProvider(provider: string | null | undefined): AgentProviderId {
    return this.providerRuntime.normalizeProvider(provider);
  }

  private runtimeForProvider(provider: string | null | undefined): AgentRuntime {
    return this.providerRuntime.runtimeForProvider(provider);
  }

  private optionalRuntimeForProvider(provider: string | null | undefined): AgentRuntime | null {
    return this.providerRuntime.optionalRuntimeForProvider(provider);
  }

  private providerForRecord(record: { provider?: string | null | undefined }): AgentProviderId {
    return this.providerRuntime.providerForRecord(record);
  }

  private requireProviderSessionId(record: { providerSessionId?: string | null }) {
    if (!record.providerSessionId) {
      throw new HttpError(503, {
        code: 'service_unavailable',
        message: 'Thread is missing its provider session identifier.',
      });
    }
    return record.providerSessionId;
  }

  private materializeHiddenRuntimeTurns(
    localThreadId: string,
    turns: AgentTurn[],
  ) {
    for (const turn of this.liveState.hiddenRemoteTurns(localThreadId, turns)) {
      const displayTurnId =
        this.liveState.displayTurnIdForRuntimeTurn(localThreadId, turn.providerTurnId) ??
        turn.providerTurnId;
      if (displayTurnId === turn.providerTurnId) {
        continue;
      }

      const dto = agentTurnToThreadTurnDto(
        turn,
        new Map<string, ThreadHistoryItemDetailDto>(),
      );
      this.historyPersistence.persistRuntimeTurnItemsAsDisplayTurn(
        localThreadId,
        turn.providerTurnId,
        displayTurnId,
        dto.items,
      );
    }
  }

  private findRecordByProviderSessionId(provider: string | null | undefined, providerSessionId: string) {
    return getThreadRecordByProviderSessionId(
      this.db,
      this.providerForRecord({ provider }),
      providerSessionId,
    );
  }

  private runtimeSupportsFastMode(provider: string | null | undefined): boolean {
    return this.providerRuntime.runtimeSupportsFastMode(provider);
  }

  private fastModeForProvider(provider: string | null | undefined, fastMode: unknown): boolean {
    return this.providerRuntime.fastModeForProvider(provider, fastMode);
  }

  private performanceModeForRecord(record: { provider?: string | null; fastMode?: unknown }) {
    return this.providerRuntime.performanceModeForRecord(record);
  }

  private async handleProviderRequest(request: AgentProviderRequest) {
    await this.handleProviderRuntimeRequest(request);
  }

  private async listLoadedProviderSessionIds(provider: string | null | undefined = 'codex') {
    return this.providerRuntime.listLoadedProviderSessionIds(provider);
  }

  private async listProviderModels(provider: string | null | undefined = 'codex') {
    return this.providerRuntime.listProviderModels(provider);
  }

  private invalidateThreadDetailCache(localThreadId: string) {
    this.detailAssembler.invalidate(localThreadId);
  }

  private getThreadContextUsage(localThreadId: string): ThreadContextUsageDto {
    return this.usageAccounting.getThreadContextUsage(localThreadId);
  }

  private setThreadContextUsage(
    localThreadId: string,
    usage: ThreadContextUsageDto,
    emitEvent = false,
  ) {
    this.usageAccounting.setThreadContextUsage(localThreadId, usage);
    if (!emitEvent) {
      return;
    }

    this.emitThreadEvent('thread.context.updated', localThreadId, {
      contextUsage: usage,
    });
  }

  private resetThreadContextUsage(localThreadId: string, emitEvent = false) {
    this.usageAccounting.resetThreadContextUsage(localThreadId);
    if (!emitEvent) {
      return;
    }

    this.emitThreadEvent('thread.context.updated', localThreadId, {
      contextUsage: this.usageAccounting.getThreadContextUsage(localThreadId),
    });
  }

  async listModels(): Promise<ModelOptionDto[]> {
    return this.providerRuntime.listProviderModelOptions('codex');
  }

  async listThreads(): Promise<ThreadDto[]> {
    const { loadedProviderSessionIds, remoteSessions } =
      await this.sessionCoordinator.listRemoteThreadSessions();
    for (const remoteSession of remoteSessions) {
      const local = this.findRecordByProviderSessionId(
        remoteSession.provider,
        remoteSession.providerSessionId,
      );
      if (!local) {
        continue;
      }

      updateThreadRecord(
        this.db,
        local.id,
        buildThreadPatch(remoteSession, local.model, local.reasoningEffort),
      );
    }

    return listThreadRecords(this.db).map((record) =>
      this.toThreadDto(record, loadedProviderSessionIds),
    );
  }

  async createThread(input: CreateThreadInput): Promise<ThreadDto> {
    const workspace = getWorkspaceRecordById(this.db, input.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found.'
      });
    }

    const session = await this.sessionCoordinator.startThreadSession({
      workspacePath: workspace.absPath,
      threadInput: input,
      defaultTitle: DEFAULT_THREAD_TITLE,
    });

    const created = createThreadRecord(this.db, {
      workspaceId: workspace.id,
      provider: session.provider,
      providerSessionId: session.response.providerSessionId,
      title: session.normalizedTitle,
      model: input.model,
      reasoningEffort: session.reasoningEffort,
      collaborationMode: 'default',
      approvalMode: input.approvalMode,
      sandboxMode: normalizeSandboxMode(session.response.sandboxMode) ?? session.sandboxMode,
      summaryText: session.response.session.preview ?? null,
      fastMode: session.fastMode,
      source: 'supervisor',
      isConnected: true,
    });

    updateThreadRecord(this.db, created.id, {
      ...buildThreadPatch(
        session.response.session,
        input.model,
        session.response.reasoningEffort ?? session.reasoningEffort
      ),
      title:
        session.normalizedTitle === DEFAULT_THREAD_TITLE &&
        session.response.session.title &&
        session.response.session.title.trim() !== GENERIC_REMOTE_THREAD_TITLE
          ? truncateAutoThreadTitle(session.response.session.title)
          : session.normalizedTitle,
    });

    const record = getThreadRecordById(this.db, created.id)!;
    return this.toThreadDto(record, new Set([session.response.providerSessionId]));
  }

  async importThread(sessionId: ImportThreadInput['sessionId']): Promise<ThreadDetailDto> {
    const localThreadId = await this.importCoordinator.importLocalCodexThread(sessionId);
    return this.getThreadDetail(localThreadId);
  }

  async getThreadDetail(
    localThreadId: string,
    options: { limit?: number; beforeTurnId?: string } = {},
  ): Promise<ThreadDetailDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.'
      });
    }

    this.requireProviderSessionId(record);
    const loadedIds = await this.listLoadedProviderSessionIds(record.provider);
    const workspacePathStatus = (await pathExists(workspace.absPath)) ? 'present' : 'missing';
    const turnMetadataById = new Map<string, ThreadTurnMetadataRecord>(
      listThreadTurnMetadataByThreadId(this.db, localThreadId).map((entry) => [
        entry.turnId,
        {
          model: entry.model ?? null,
          reasoningEffort: entry.reasoningEffort ?? null,
          reasoningEffortAvailable: entry.reasoningEffortAvailable ?? null,
          pricingModelKey: entry.pricingModelKey ?? null,
          pricingTierKey: normalizePricingTier(entry.pricingTierKey),
          tokenUsageJson: entry.tokenUsageJson ?? null,
          createdAt: entry.createdAt ?? null,
        },
      ]),
    );
    const cachedDetail = await this.detailAssembler.buildCacheEntry({
      localThreadId,
      record,
      turnMetadataById,
      options,
    });
    const updated = getThreadRecordById(this.db, record.id)!;
    const enrichedTurns = this.pluginService?.enrichTurnsWithArtifacts({
      threadId: updated.id,
      workspacePath: workspace.absPath,
      turns: cachedDetail.turns,
    }) ?? cachedDetail.turns;
    const pagedTurns = this.detailAssembler.sliceTurns(enrichedTurns, options);
    this.syncPendingPlanDecisionRequestFromTurns(
      updated.id,
      updated.collaborationMode,
      enrichedTurns,
    );
    const liveItems = this.liveState.getLiveItems(
      updated.id,
      enrichedTurns,
      pagedTurns.turns,
    );
    const goalHistory = this.goalCoordinator.listThreadGoalHistory(updated.id);
    const remoteGoal =
      updated.isConnected === false || !this.optionalRuntimeForProvider(updated.provider)
        ? null
        : await this.goalCoordinator.getThreadGoalForRecord(updated).catch(() => null);
    const goal =
      remoteGoal ?? this.goalCoordinator.localGoalSnapshotForFallback(goalHistory);
    const pendingRequests = this.listPendingRequests(updated.id);
    return {
      thread: this.toThreadDto(updated, loadedIds),
      workspace: toWorkspaceDto(workspace),
      workspacePathStatus,
      turns: pagedTurns.turns,
      totalTurnCount: cachedDetail.totalTurnCount,
      pendingRequests,
      pendingSteers: this.auxiliaryState.listPendingSteers(updated.id),
      answeredRequestNotes: this.auxiliaryState.listAnsweredRequestNotes(updated.id),
      activityNotes: this.auxiliaryState.listActivityNotes(updated.id),
      goal,
      goalHistory,
      livePlan: this.liveState.getLivePlan(updated.id),
      liveItems,
    };
  }

  async listThreadExportTurns(localThreadId: string): Promise<ThreadExportTurnOptionsDto> {
    return this.exportCoordinator.listThreadExportTurns(localThreadId);
  }

  async exportThreadPdf(
    localThreadId: string,
    input: ExportThreadPdfInput,
  ): Promise<{ buffer: Buffer; filename: string }> {
    return this.exportCoordinator.exportThreadPdf(localThreadId, input);
  }

  async exportThreadTranscript(
    localThreadId: string,
    input: ExportThreadPdfInput,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    return this.exportCoordinator.exportThreadTranscript(localThreadId, input);
  }

  async getThreadGoal(localThreadId: string): Promise<ThreadGoalDto | null> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    return this.goalCoordinator.getThreadGoal(record);
  }

  async updateThreadGoal(
    localThreadId: string,
    input: UpdateThreadGoalInput,
  ): Promise<ThreadGoalDto | null> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    return this.goalCoordinator.updateThreadGoal(record, input);
  }

  async clearThreadGoal(
    localThreadId: string,
  ): Promise<{ cleared: boolean; goalHistory: ThreadGoalDto[] }> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    return this.goalCoordinator.clearThreadGoal(record);
  }

  private async ensureThreadLoadedForProviderOperation(record: {
    id: string;
    providerSessionId: string | null;
    provider?: string | null;
    model?: string | null;
    sandboxMode?: string | null;
    approvalMode?: string | null;
  }) {
    if (!record.providerSessionId) {
      return;
    }

    const loadedIds = await this.listLoadedProviderSessionIds(record.provider);
    if (loadedIds.has(record.providerSessionId)) {
      return;
    }

    const resumeInput: ResumeThreadInput = {};
    if (record.model) {
      resumeInput.model = record.model;
    }
    const normalizedSandboxMode = normalizeSandboxMode(record.sandboxMode);
    if (normalizedSandboxMode) {
      resumeInput.sandboxMode = normalizedSandboxMode;
    }
    await this.resumeThread(record.id, resumeInput);
  }

  async getThreadHistoryItemDetail(
    localThreadId: string,
    itemId: string,
  ): Promise<ThreadHistoryItemDetailDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    this.requireProviderSessionId(record);

    const turnMetadataById = new Map<string, ThreadTurnMetadataRecord>(
      listThreadTurnMetadataByThreadId(this.db, localThreadId).map((entry) => [
        entry.turnId,
        {
          model: entry.model ?? null,
          reasoningEffort: entry.reasoningEffort ?? null,
          reasoningEffortAvailable: entry.reasoningEffortAvailable ?? null,
          pricingModelKey: entry.pricingModelKey ?? null,
          pricingTierKey: normalizePricingTier(entry.pricingTierKey),
          tokenUsageJson: entry.tokenUsageJson ?? null,
          createdAt: entry.createdAt ?? null,
        },
      ]),
    );
    const cachedDetail = await this.detailAssembler.buildCacheEntry({
      localThreadId,
      record,
      turnMetadataById,
    });
    const detail = cachedDetail.deferredDetails.get(itemId);
    if (!detail) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Detailed history item was not found for this thread.',
      });
    }

    return detail;
  }

  async preparePromptAttachments(
    localThreadId: string,
    input: SendThreadPromptInput,
    attachments: UploadedPromptAttachment[],
  ): Promise<SendThreadPromptInput> {
    return this.attachmentCoordinator.preparePromptAttachments(
      localThreadId,
      input,
      attachments,
    );
  }

  async resumeThread(localThreadId: string, input: ResumeThreadInput = {}): Promise<ThreadDetailDto> {
    await this.sessionLifecycleCoordinator.resumeThread(localThreadId, input);
    return this.getThreadDetail(localThreadId);
  }

  async disconnectThread(localThreadId: string): Promise<ThreadDetailDto> {
    this.sessionLifecycleCoordinator.disconnectThread(localThreadId);
    return this.getThreadDetail(localThreadId);
  }

  async sendPrompt(
    localThreadId: string,
    input: SendThreadPromptInput,
    options: SendPromptOptions = {},
  ): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }
    const providerSessionId = this.requireProviderSessionId(record);

    await this.importCoordinator.assertImportedThreadReadyForPrompt({
      source: record.source,
      provider: record.provider,
      providerSessionId,
      listLoadedProviderSessionIds: (provider) =>
        this.listLoadedProviderSessionIds(provider),
    });

    if (record.isConnected === false) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Connect this thread before sending a new prompt.'
      });
    }

    const prompt = input.prompt.trim();
    const displayPrompt = options.displayPrompt?.trim() || prompt;
    if (!prompt) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Prompt cannot be empty.'
      });
    }

    this.clearPendingPlanDecisionRequests(localThreadId, true);

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found.',
      });
    }
    const turnConfig = await this.sessionCoordinator.resolvePromptTurnConfig({
      provider: record.provider,
      currentModel: record.model,
      currentReasoningEffort: record.reasoningEffort,
      currentFastMode: record.fastMode,
      currentCollaborationMode: record.collaborationMode,
      currentSandboxMode: record.sandboxMode,
      approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
      promptInput: input,
    });
    const connectedRecord = {
      ...record,
      providerSessionId,
    };

    if (record.providerTurnId && record.status === 'running') {
      if (!turnConfig.supportsRunningTurnInput) {
        throw new HttpError(409, {
          code: 'conflict',
          message: 'This backend does not support sending input while a turn is running.',
        });
      }
      return this.promptTurnCoordinator.steerOrStartPromptTurn(localThreadId, {
        ...connectedRecord,
        providerTurnId: record.providerTurnId,
      }, {
        prompt,
        displayPrompt,
        clientRequestId: input.clientRequestId ?? null,
        effectiveModel: turnConfig.effectiveModel,
        normalizedReasoning: turnConfig.normalizedReasoning,
        collaborationMode: turnConfig.collaborationMode,
        sandboxMode: turnConfig.sandboxMode,
        performanceMode: turnConfig.performanceMode,
        workspacePath: workspace.absPath,
      });
    }

    return this.promptTurnCoordinator.startPromptTurn(localThreadId, connectedRecord, {
      prompt,
      displayPrompt,
      effectiveModel: turnConfig.effectiveModel,
      normalizedReasoning: turnConfig.normalizedReasoning,
      collaborationMode: turnConfig.collaborationMode,
      sandboxMode: turnConfig.sandboxMode,
      performanceMode: turnConfig.performanceMode,
      workspacePath: workspace.absPath,
    });
  }

  async updateThreadSettings(
    localThreadId: string,
    input: UpdateThreadSettingsInput
  ): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const nextSettings = await this.sessionCoordinator.resolveThreadSettings({
      provider: record.provider,
      currentModel: record.model,
      currentReasoningEffort: record.reasoningEffort,
      currentFastMode: record.fastMode,
      currentCollaborationMode: record.collaborationMode,
      currentSandboxMode: record.sandboxMode,
      settings: input,
    });

    if (nextSettings.collaborationMode !== 'plan') {
      this.clearPendingPlanDecisionRequests(localThreadId, true);
    }

    if (nextSettings.fastModeChanged) {
      this.auxiliaryState.appendActivityNote(localThreadId, {
        kind: 'fastMode',
        text: nextSettings.fastMode ? FAST_MODE_NOTE_ON : FAST_MODE_NOTE_OFF,
      });
    }

    updateThreadRecord(this.db, localThreadId, {
      model: nextSettings.model,
      reasoningEffort: nextSettings.reasoningEffort,
      fastMode: nextSettings.fastMode,
      collaborationMode: nextSettings.collaborationMode,
      sandboxMode: nextSettings.sandboxMode,
    });
    if (nextSettings.modelChanged) {
      this.resetThreadContextUsage(localThreadId);
    }

    const updated = getThreadRecordById(this.db, localThreadId)!;
    const loadedIds = await this.listLoadedProviderSessionIds(record.provider);
    this.emitThreadEvent('thread.updated', updated.id, {
      model: updated.model,
      reasoningEffort: updated.reasoningEffort,
      fastMode: nextSettings.fastMode,
      collaborationMode: updated.collaborationMode,
      sandboxMode: updated.sandboxMode,
    });

    return this.toThreadDto(updated, loadedIds);
  }

  async updateThreadTitle(localThreadId: string, title: string): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'Thread title cannot be empty.'
      });
    }

    updateThreadRecord(this.db, localThreadId, {
      title: normalizedTitle
    });

    const updated = getThreadRecordById(this.db, localThreadId)!;
    const loadedIds = await this.listLoadedProviderSessionIds(record.provider);

    this.emitThreadEvent('thread.updated', updated.id, {
      title: updated.title
    });

    return this.toThreadDto(updated, loadedIds);
  }

  async compactThread(localThreadId: string): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }
    const providerSessionId = this.requireProviderSessionId(record);

    if (record.isConnected === false) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'Connect this thread before compacting its context.',
      });
    }

    const loadedIds = await this.listLoadedProviderSessionIds(record.provider);
    if (!loadedIds.has(providerSessionId)) {
      const resumeInput: ResumeThreadInput = {};
      if (record.model) {
        resumeInput.model = record.model;
      }
      const normalizedSandboxMode = normalizeSandboxMode(record.sandboxMode);
      if (normalizedSandboxMode) {
        resumeInput.sandboxMode = normalizedSandboxMode;
      }
      await this.resumeThread(localThreadId, resumeInput);
    }

    await this.sessionCoordinator.compactThreadSession({
      provider: record.provider,
      providerSessionId,
    });

    const updated = getThreadRecordById(this.db, localThreadId)!;
    const refreshedLoadedIds = await this.listLoadedProviderSessionIds(record.provider);
    return this.toThreadDto(updated, refreshedLoadedIds);
  }

  async listForkTurnOptions(localThreadId: string): Promise<ThreadForkTurnOptionDto[]> {
    return this.forkCoordinator.listForkTurnOptions(localThreadId);
  }

  async forkThread(
    localThreadId: string,
    input: ForkThreadInput,
  ): Promise<ThreadForkResultDto> {
    return this.forkCoordinator.forkThread(localThreadId, input);
  }

  async listThreadSkills(localThreadId: string): Promise<ThreadSkillsDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    return this.managementCoordinator.listThreadSkills({
      provider: record.provider,
      workspacePath: workspace.absPath,
    });
  }

  async listThreadMcpServers(localThreadId: string): Promise<ThreadMcpServersDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    return this.managementCoordinator.listThreadMcpServers({
      provider: record.provider,
    });
  }

  async listThreadHooks(localThreadId: string): Promise<ThreadHooksDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    return this.managementCoordinator.listThreadHooks({
      provider: record.provider,
      workspacePath: workspace.absPath,
    });
  }

  async createThreadHook(
    localThreadId: string,
    input: CreateThreadHookInput,
  ): Promise<ThreadHooksDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    return this.managementCoordinator.createThreadHook({
      provider: record.provider,
      workspacePath: workspace.absPath,
      hook: input,
    });
  }

  async updateThreadHook(
    localThreadId: string,
    input: UpdateThreadHookInput,
  ): Promise<ThreadHooksDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    return this.managementCoordinator.updateThreadHook({
      provider: record.provider,
      workspacePath: workspace.absPath,
      hook: input,
    });
  }

  async trustThreadHook(
    localThreadId: string,
    input: TrustThreadHookInput,
  ): Promise<ThreadHooksDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    return this.managementCoordinator.trustThreadHook({
      provider: record.provider,
      workspacePath: workspace.absPath,
      hook: input,
    });
  }

  async untrustThreadHook(
    localThreadId: string,
    input: UntrustThreadHookInput,
  ): Promise<ThreadHooksDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.',
      });
    }

    const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
    if (!workspace) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Workspace was not found for this thread.',
      });
    }

    return this.managementCoordinator.untrustThreadHook({
      provider: record.provider,
      workspacePath: workspace.absPath,
      hook: input,
    });
  }

  async interruptThread(localThreadId: string, requestedTurnId?: string): Promise<ThreadDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }
    const providerSessionId = this.requireProviderSessionId(record);
    const interruptInput: {
      provider: string | null | undefined;
      providerSessionId: string;
      providerTurnId: string | null | undefined;
      requestedTurnId?: string;
    } = {
      provider: record.provider,
      providerSessionId,
      providerTurnId: record.providerTurnId,
    };
    if (requestedTurnId !== undefined) {
      interruptInput.requestedTurnId = requestedTurnId;
    }
    const interruption = await this.sessionCoordinator.interruptThreadTurn(interruptInput);

    updateThreadRecord(this.db, localThreadId, {
      providerTurnId: null,
      status: interruption.interruptedTurn?.status === 'failed' ? 'failed' : 'interrupted',
      lastError: interruption.interruptedTurn?.error?.message ?? null,
      lastTurnCompletedAt: new Date().toISOString()
    });
    this.liveState.setLivePlan(localThreadId, null);
    this.liveState.setLiveItems(localThreadId, null);
    this.auxiliaryState.clearPendingSteersForTurn(localThreadId, interruption.turnId);
    this.invalidateThreadDetailCache(localThreadId);

    const updated = getThreadRecordById(this.db, localThreadId)!;
    return this.toThreadDto(updated, new Set([interruption.providerSessionId]));
  }

  async deleteThread(localThreadId: string): Promise<{ id: string }> {
    return this.deletionCoordinator.deleteThread(localThreadId);
  }

  async respondToRequest(
    localThreadId: string,
    requestId: string,
    input: RespondThreadActionRequestInput
  ): Promise<ThreadDetailDto> {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Thread was not found.'
      });
    }

    const requestResponse = this.requestCoordinator.respondToRequest(
      localThreadId,
      requestId,
      input,
    );
    let resolvedRequestResponse = requestResponse;
    if (!resolvedRequestResponse && requestId.startsWith(LOCAL_PLAN_DECISION_PREFIX)) {
      await this.syncPendingPlanDecisionRequestFromCurrentDetail(localThreadId);
      resolvedRequestResponse = this.requestCoordinator.respondToRequest(
        localThreadId,
        requestId,
        input,
      );
    }

    if (!resolvedRequestResponse) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'Request was not found for this thread.'
      });
    }

    if (resolvedRequestResponse.source === 'server') {
      const pending = resolvedRequestResponse.pending;
      this.requestCoordinator.respondToProviderRequest(record.provider, pending, input);
      if (resolvedRequestResponse.continuationPrompt) {
        const providerSessionId = this.requireProviderSessionId(record);
        const connectedRecord = {
          ...record,
          providerSessionId,
        };
        const workspace = getWorkspaceRecordById(this.db, record.workspaceId);
        if (!workspace) {
          throw new HttpError(404, {
            code: 'not_found',
            message: 'Workspace was not found.',
          });
        }
        const turnConfig = await this.sessionCoordinator.resolvePromptTurnConfig({
          provider: record.provider,
          currentModel: record.model,
          currentReasoningEffort: record.reasoningEffort,
          currentFastMode: record.fastMode,
          currentCollaborationMode: record.collaborationMode,
          currentSandboxMode: record.sandboxMode,
          approvalMode: (record.approvalMode ?? 'yolo') as ApprovalMode,
        });
        await this.promptTurnCoordinator.startPromptTurn(localThreadId, connectedRecord, {
          prompt: resolvedRequestResponse.continuationPrompt,
          effectiveModel: turnConfig.effectiveModel,
          normalizedReasoning: turnConfig.normalizedReasoning,
          collaborationMode: turnConfig.collaborationMode,
          sandboxMode: turnConfig.sandboxMode,
          performanceMode: turnConfig.performanceMode,
          workspacePath: workspace.absPath,
          hidden: true,
          displayTurnId: pending.request.turnId,
        });
      }
    } else if (resolvedRequestResponse.selectedAction === 'implement') {
        await this.importCoordinator.ensureImportedThreadConnectedForImplementation({
          source: record.source,
          provider: record.provider,
          providerSessionId: this.requireProviderSessionId(record),
          model: record.model,
          listLoadedProviderSessionIds: (provider) =>
            this.listLoadedProviderSessionIds(provider),
          resumeThread: (input) => this.resumeThread(localThreadId, input),
        });
        await this.updateThreadSettings(localThreadId, {
          collaborationMode: 'default'
        });
        await this.sendPrompt(localThreadId, {
          prompt: IMPLEMENT_APPROVED_PLAN_PROMPT,
          collaborationMode: 'default'
        });
    }

    this.auxiliaryState.appendAnsweredRequestNote(
      localThreadId,
      resolvedRequestResponse.answeredNote,
    );

    this.requestCoordinator.emitRequestResolved(localThreadId, requestId);

    return this.getThreadDetail(localThreadId);
  }

  private async handleRuntimeEvent(event: AgentRuntimeEvent) {
    await this.runtimeEventProjector.handleRuntimeEvent(event);
  }

  private async handleProviderRuntimeRequest(request: AgentProviderRequest) {
    this.requestCoordinator.handleProviderRuntimeRequest(request);
  }

  private toThreadDto(record: any, loadedIds: Set<string>): ThreadDto {
    return threadRecordToThreadDto(record, loadedIds, {
      fastModeForProvider: (provider, fastMode) =>
        this.fastModeForProvider(provider, fastMode),
      getThreadContextUsage: (localThreadId) =>
        this.getThreadContextUsage(localThreadId),
    });
  }

  private emitThreadEvent<Type extends keyof ThreadEventPayloadMap>(
    type: Type,
    threadId: string,
    payload: ThreadEventPayloadMap[Type],
  ) {
    this.eventBus.emitThreadEvent({
      type,
      threadId,
      timestamp: new Date().toISOString(),
      payload
    } as ThreadEventEnvelope);
  }

  private listPendingRequests(
    localThreadId: string,
    options: { hideAnsweredProviderQuestions?: boolean } = {},
  ): ThreadActionRequestDto[] {
    return this.requestCoordinator.listPendingRequests(localThreadId, options);
  }

  private appendLiveAgentMessageDelta(
    localThreadId: string,
    turnId: string,
    itemId: string,
    delta: string,
    sequence: number,
  ) {
    this.liveState.appendLiveAgentMessageDelta({
      localThreadId,
      turnId,
      itemId,
      delta,
      sequence,
    });
  }

  private createPendingPlanDecisionRequest(
    localThreadId: string,
    turnId: string,
    emitEvents: boolean
  ) {
    this.requestCoordinator.createPendingPlanDecisionRequest(
      localThreadId,
      turnId,
      emitEvents,
    );
  }

  private clearPendingPlanDecisionRequests(localThreadId: string, emitEvents: boolean) {
    this.requestCoordinator.clearPendingPlanDecisionRequests(localThreadId, emitEvents);
  }

  private clearTerminalPendingRequests(localThreadId: string, emitEvents: boolean) {
    this.requestCoordinator.clearTerminalPendingRequests(localThreadId, emitEvents);
  }

  private hasPendingAskUserQuestion(localThreadId: string) {
    return this.requestCoordinator.hasPendingAskUserQuestion(localThreadId);
  }

  private syncPendingPlanDecisionRequest(
    localThreadId: string,
    collaborationMode: string | null | undefined,
    remoteSession: AgentSessionDetail
  ) {
    this.requestCoordinator.syncPendingPlanDecisionRequest({
      localThreadId,
      collaborationMode,
      latestTurn: remoteSession.turns.at(-1) ?? null,
    });
  }

  private syncPendingPlanDecisionRequestFromTurns(
    localThreadId: string,
    collaborationMode: string | null | undefined,
    turns: ThreadTurnDto[],
  ) {
    const latestTurn = turns.at(-1) ?? null;
    this.requestCoordinator.syncPendingPlanDecisionRequest({
      localThreadId,
      collaborationMode,
      latestTurn: latestTurn
        ? {
            providerTurnId: latestTurn.id,
            status: latestTurn.status,
            items: latestTurn.items.map((item) => ({ kind: item.kind })),
          }
        : null,
    });
  }

  private async syncPendingPlanDecisionRequestFromCurrentDetail(
    localThreadId: string,
  ) {
    const record = getThreadRecordById(this.db, localThreadId);
    if (!record) {
      return;
    }

    const turnMetadataById = new Map<string, ThreadTurnMetadataRecord>(
      listThreadTurnMetadataByThreadId(this.db, localThreadId).map((entry) => [
        entry.turnId,
        {
          model: entry.model ?? null,
          reasoningEffort: entry.reasoningEffort ?? null,
          reasoningEffortAvailable: entry.reasoningEffortAvailable ?? null,
          pricingModelKey: entry.pricingModelKey ?? null,
          pricingTierKey: normalizePricingTier(entry.pricingTierKey),
          tokenUsageJson: entry.tokenUsageJson ?? null,
          createdAt: entry.createdAt ?? null,
        },
      ]),
    );
    const cachedDetail = await this.detailAssembler.buildCacheEntry({
      localThreadId,
      record,
      turnMetadataById,
    });
    const updated = getThreadRecordById(this.db, localThreadId) ?? record;
    this.syncPendingPlanDecisionRequestFromTurns(
      updated.id,
      updated.collaborationMode,
      cachedDetail.turns,
    );
  }

}
