import type {
  AgentSessionDetail,
  AgentSessionSummary,
  AgentProviderId,
  AgentTurn,
  ReadAgentSessionOptions,
  StartAgentSessionResult,
} from '../../../packages/agent-runtime/src/index';
import {
  isRemoteThreadBootstrapError,
} from '../../../packages/agent-runtime/src/index';
import type {
  ApprovalMode,
  AgentBackendIdDto,
  CreateThreadInput,
  CollaborationModeDto,
  ReasoningEffortDto,
  ResumeThreadInput,
  SandboxModeDto,
  SendThreadPromptInput,
  ThreadSourceDto,
  ThreadTurnDto,
  UpdateThreadSettingsInput,
} from '../../../packages/shared/src/index';
import {
  normalizeAgentBackendId,
} from '../../../packages/shared/src/index';
import {
  ensureFastModeSupported,
  normalizeReasoningEffort,
  performanceModeForFastMode,
  ThreadProviderRuntimeCoordinator,
} from './thread-provider-runtime-coordinator';
import { HttpError } from './app';
import {
  defaultSandboxModeForApprovalMode,
  normalizeCollaborationMode,
  normalizeSandboxMode,
} from './dto';

interface StartThreadSessionResult {
  provider: AgentProviderId;
  normalizedTitle: string;
  response: StartAgentSessionResult;
  reasoningEffort: ReasoningEffortDto | null;
  sandboxMode: SandboxModeDto;
  fastMode: boolean;
}

type ResumeThreadSessionResult =
  | {
      status: 'resumed';
      response: StartAgentSessionResult;
      effectiveModel: string | null;
      resumedReasoning: ReasoningEffortDto | null;
      sandboxMode: SandboxModeDto;
      modelChanged: boolean;
    }
  | {
      status: 'bootstrap_unavailable';
      error: unknown;
    };

interface InterruptedThreadTurnResult {
  providerSessionId: string;
  turnId: string;
  interruptedTurn: AgentTurn | null;
}

interface ResolvedThreadSettings {
  model: string | null;
  reasoningEffort: ReasoningEffortDto | null;
  fastMode: boolean;
  collaborationMode: CollaborationModeDto;
  sandboxMode: SandboxModeDto | null;
  fastModeChanged: boolean;
  modelChanged: boolean;
}

interface ResolvedPromptTurnConfig {
  effectiveModel: string | null;
  normalizedReasoning: ReasoningEffortDto | null;
  collaborationMode: CollaborationModeDto;
  sandboxMode: SandboxModeDto;
  performanceMode: 'fast' | 'standard';
  supportsRunningTurnInput: boolean;
}

interface ThreadListRemoteSyncResult {
  loadedProviderSessionIds: Set<string>;
  remoteSessions: AgentSessionSummary[];
}

interface ForkThreadSessionResult {
  forkedSession: AgentSessionDetail;
  selectedSourceTurnId: string | null;
  selectedSourceTurnIndex: number | null;
}

export interface LocalImportSessionResult {
  provider: AgentProviderId;
  source: ThreadSourceDto;
  sessionId: string;
  cwd: string;
  title: string;
  model: string | null;
  summaryText: string | null;
  fastMode: boolean;
}

export interface ThreadPerformanceModeSettings {
  readFastMode(): boolean;
  writeFastMode(enabled: boolean): Promise<unknown>;
}

export interface ThreadLocalSessionLookup {
  findSession(sessionId: string): Promise<{
    sessionId: string;
    cwd: string;
    title: string | null;
    model: string | null;
    rolloutPath: string | null;
    turns: ThreadTurnDto[];
  } | null>;
  findImportSession(
    sessionId: string,
    input: { fastMode: boolean; provider?: string | null },
  ): Promise<LocalImportSessionResult | null>;
}

export class ThreadSessionCoordinator {
  constructor(
    private readonly providerRuntime: ThreadProviderRuntimeCoordinator,
    private readonly performanceModeSettings: ThreadPerformanceModeSettings,
    private readonly localSessionLookup: ThreadLocalSessionLookup,
  ) {}

  async startThreadSession(input: {
    workspacePath: string;
    threadInput: CreateThreadInput;
    defaultTitle: string;
  }): Promise<StartThreadSessionResult> {
    const provider = this.providerRuntime.normalizeProvider(input.threadInput.provider);
    const normalizedTitle = input.threadInput.title?.trim() || input.defaultTitle;
    const runtime = this.providerRuntime.runtimeForProvider(provider);
    const modelRecords = await runtime.listModels().catch(() => []);
    const reasoningEffort = this.providerRuntime.normalizeReasoningForModel(
      modelRecords,
      input.threadInput.model,
      input.threadInput.reasoningEffort ?? null,
    );
    const sandboxMode = defaultSandboxModeForApprovalMode(input.threadInput.approvalMode);
    const fastMode = this.providerRuntime.runtimeSupportsFastMode(provider)
      ? this.performanceModeSettings.readFastMode()
      : false;
    if (this.providerRuntime.runtimeSupportsFastMode(provider)) {
      ensureFastModeSupported(input.threadInput.model, fastMode, modelRecords);
    }
    const response = await runtime.startSession({
      cwd: input.workspacePath,
      model: input.threadInput.model,
      reasoningEffort,
      approvalMode: input.threadInput.approvalMode,
      sandboxMode,
      performanceMode: performanceModeForFastMode(fastMode),
    });

    return {
      provider,
      normalizedTitle,
      response,
      reasoningEffort,
      sandboxMode,
      fastMode,
    };
  }

  async listRemoteThreadSessions(): Promise<ThreadListRemoteSyncResult> {
    const loadedProviderSessionIds = new Set<string>();
    const remoteSessions: AgentSessionSummary[] = [];

    for (const runtime of this.providerRuntime.allRuntimes()) {
      try {
        for (const providerSessionId of await runtime.listLoadedSessions()) {
          loadedProviderSessionIds.add(providerSessionId);
        }
        remoteSessions.push(...(await runtime.listSessions()));
      } catch {
        // Keep local state if a provider runtime is unavailable.
      }
    }

    return {
      loadedProviderSessionIds,
      remoteSessions,
    };
  }

  async findLocalFallbackSession(providerSessionId: string) {
    return this.localSessionLookup.findSession(providerSessionId);
  }

  async resolveLocalImportSession(input: {
    provider: string | null | undefined;
    sessionId: string;
  }): Promise<LocalImportSessionResult | null> {
    const provider = normalizeAgentBackendId(input.provider) ?? 'codex';
    if (provider !== 'codex') {
      return this.resolveRuntimeImportSession(provider, input.sessionId);
    }

    return this.localSessionLookup.findImportSession(input.sessionId, {
      fastMode: this.performanceModeSettings.readFastMode(),
      provider,
    });
  }

  private async resolveRuntimeImportSession(
    provider: AgentBackendIdDto,
    sessionId: string,
  ): Promise<LocalImportSessionResult | null> {
    try {
      const session = await this.providerRuntime
        .runtimeForProvider(provider)
        .readSession(sessionId);
      if (!session.cwd) {
        return null;
      }
      return {
        provider,
        source: 'supervisor',
        sessionId,
        cwd: session.cwd,
        title: session.title?.trim() || session.preview?.trim() || 'Untitled imported session',
        model: null,
        summaryText: session.preview,
        fastMode: this.providerRuntime.runtimeSupportsFastMode(provider)
          ? this.performanceModeSettings.readFastMode()
          : false,
      };
    } catch {
      return null;
    }
  }

  async readRemoteSession(input: {
    provider: string | null | undefined;
    providerSessionId: string;
    options: ReadAgentSessionOptions;
  }): Promise<AgentSessionDetail | null> {
    const runtime = this.providerRuntime.runtimeForProvider(input.provider);
    try {
      return await runtime.readSession(input.providerSessionId, input.options);
    } catch (error) {
      if (!isRemoteThreadBootstrapError(error)) {
        throw error;
      }
      return null;
    }
  }

  async resumeRemoteSession(input: {
    provider: string | null | undefined;
    providerSessionId: string;
  }): Promise<AgentSessionDetail> {
    const response = await this.providerRuntime
      .runtimeForProvider(input.provider)
      .resumeSession({
        providerSessionId: input.providerSessionId,
      });
    return response.session;
  }

  async resumeThreadSession(input: {
    provider: string | null | undefined;
    providerSessionId: string;
    resumeInput: ResumeThreadInput;
    currentModel: string | null | undefined;
    currentReasoningEffort: string | null | undefined;
    currentSandboxMode: string | null | undefined;
    approvalMode: ApprovalMode | null | undefined;
    fastMode: unknown;
  }): Promise<ResumeThreadSessionResult> {
    const runtime = this.providerRuntime.runtimeForProvider(input.provider);
    const sandboxMode =
      input.resumeInput.sandboxMode ??
      normalizeSandboxMode(input.currentSandboxMode) ??
      defaultSandboxModeForApprovalMode(input.approvalMode);
    const fastMode = this.providerRuntime.fastModeForProvider(input.provider, input.fastMode);
    const modelRecords = await runtime.listModels().catch(() => []);
    let response: StartAgentSessionResult;
    try {
      ensureFastModeSupported(
        input.resumeInput.model ?? input.currentModel ?? null,
        fastMode,
        modelRecords,
      );
      response = await runtime.resumeSession({
        providerSessionId: input.providerSessionId,
        model: input.resumeInput.model ?? input.currentModel ?? null,
        sandboxMode,
        performanceMode: performanceModeForFastMode(fastMode),
      });
    } catch (error) {
      if (!isRemoteThreadBootstrapError(error)) {
        throw error;
      }

      return { status: 'bootstrap_unavailable', error };
    }

    const effectiveModel =
      input.resumeInput.model ?? input.currentModel ?? response.model ?? null;
    const resumedReasoning = this.providerRuntime.normalizeReasoningForModel(
      modelRecords,
      effectiveModel,
      normalizeReasoningEffort(input.currentReasoningEffort) ??
        normalizeReasoningEffort(response.reasoningEffort),
    );

    return {
      status: 'resumed',
      response,
      effectiveModel,
      resumedReasoning,
      sandboxMode: normalizeSandboxMode(response.sandboxMode) ?? sandboxMode,
      modelChanged: Boolean(input.resumeInput.model && input.resumeInput.model !== input.currentModel),
    };
  }

  async compactThreadSession(input: {
    provider: string | null | undefined;
    providerSessionId: string;
  }): Promise<void> {
    const runtime = this.providerRuntime.runtimeForProvider(input.provider);
    if (!runtime.compactSession) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support context compaction.',
      });
    }
    await runtime.compactSession(input.providerSessionId);
  }

  async forkThreadSession(input: {
    provider: string | null | undefined;
    providerSessionId: string;
    mode: 'latest' | 'turn';
    turnId?: string;
    turnOptions: Array<{ turnId: string; turnIndex: number }>;
  }): Promise<ForkThreadSessionResult> {
    const selectedTurn =
      input.mode === 'turn'
        ? input.turnOptions.find((turn) => turn.turnId === input.turnId)
        : input.turnOptions.at(-1) ?? null;

    if (input.mode === 'turn' && !selectedTurn) {
      throw new HttpError(404, {
        code: 'not_found',
        message: 'The selected fork turn was not found.',
      });
    }

    const runtime = this.providerRuntime.runtimeForProvider(input.provider);
    if (!runtime.forkSession) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support session fork.',
      });
    }

    let forkedSession = await runtime.forkSession({
      providerSessionId: input.providerSessionId,
      atTurnId: selectedTurn?.turnId ?? null,
    });
    const turnsToRollback =
      selectedTurn == null
        ? 0
        : Math.max(0, input.turnOptions.length - selectedTurn.turnIndex);
    if (turnsToRollback > 0) {
      if (!runtime.rollbackSession) {
        throw new HttpError(409, {
          code: 'conflict',
          message: 'This backend does not support rollback after fork.',
        });
      }
      forkedSession = await runtime.rollbackSession({
        providerSessionId: forkedSession.providerSessionId,
        count: turnsToRollback,
      });
    }

    return {
      forkedSession,
      selectedSourceTurnId: selectedTurn?.turnId ?? null,
      selectedSourceTurnIndex: selectedTurn?.turnIndex ?? null,
    };
  }

  async interruptThreadTurn(input: {
    provider: string | null | undefined;
    providerSessionId: string;
    providerTurnId: string | null | undefined;
    requestedTurnId?: string;
  }): Promise<InterruptedThreadTurnResult> {
    const turnId = input.requestedTurnId ?? input.providerTurnId;
    if (!turnId) {
      throw new HttpError(400, {
        code: 'bad_request',
        message: 'There is no active turn to interrupt.',
      });
    }

    const interruptedTurn = await this.providerRuntime
      .runtimeForProvider(input.provider)
      .interruptTurn({
        providerSessionId: input.providerSessionId,
        providerTurnId: turnId,
      });

    return {
      providerSessionId: input.providerSessionId,
      turnId,
      interruptedTurn,
    };
  }

  async resolveThreadSettings(input: {
    provider: string | null | undefined;
    currentModel: string | null | undefined;
    currentReasoningEffort: string | null | undefined;
    currentFastMode: unknown;
    currentCollaborationMode: string | null | undefined;
    currentSandboxMode: string | null | undefined;
    settings: UpdateThreadSettingsInput;
  }): Promise<ResolvedThreadSettings> {
    const modelRecords = await this.providerRuntime.listProviderModels(input.provider);
    const fallbackModel = modelRecords.find((entry) => entry.isDefault) ?? modelRecords[0] ?? null;
    const supportsFastMode = this.providerRuntime.runtimeSupportsFastMode(input.provider);
    const currentFastMode = this.providerRuntime.fastModeForProvider(
      input.provider,
      input.currentFastMode,
    );
    const nextFastMode =
      supportsFastMode && input.settings.fastMode !== undefined
        ? input.settings.fastMode
        : currentFastMode;
    const currentModel = input.currentModel ?? fallbackModel?.model ?? null;
    const currentReasoning = normalizeReasoningEffort(input.currentReasoningEffort);
    const nextModel = input.settings.model ?? currentModel;
    const requestedReasoning =
      input.settings.reasoningEffort !== undefined
        ? normalizeReasoningEffort(input.settings.reasoningEffort)
        : currentReasoning;
    const nextReasoning = this.providerRuntime.normalizeReasoningForModel(
      modelRecords,
      nextModel,
      requestedReasoning,
    );
    const nextCollaborationMode =
      input.settings.collaborationMode !== undefined
        ? normalizeCollaborationMode(input.settings.collaborationMode)
        : normalizeCollaborationMode(input.currentCollaborationMode);
    const nextSandboxMode =
      input.settings.sandboxMode !== undefined
        ? normalizeSandboxMode(input.settings.sandboxMode)
        : normalizeSandboxMode(input.currentSandboxMode);
    ensureFastModeSupported(nextModel, nextFastMode, modelRecords);

    if (supportsFastMode && currentFastMode !== nextFastMode) {
      await this.performanceModeSettings.writeFastMode(nextFastMode);
    }

    return {
      model: nextModel,
      reasoningEffort: nextReasoning,
      fastMode: nextFastMode,
      collaborationMode: nextCollaborationMode,
      sandboxMode: nextSandboxMode,
      fastModeChanged: supportsFastMode && currentFastMode !== nextFastMode,
      modelChanged: nextModel !== input.currentModel,
    };
  }

  async resolvePromptTurnConfig(input: {
    provider: string | null | undefined;
    currentModel: string | null | undefined;
    currentReasoningEffort: string | null | undefined;
    currentFastMode: unknown;
    currentCollaborationMode: string | null | undefined;
    currentSandboxMode: string | null | undefined;
    approvalMode: ApprovalMode | null | undefined;
    promptInput?: Pick<
      SendThreadPromptInput,
      'model' | 'reasoningEffort' | 'collaborationMode' | 'sandboxMode'
    >;
  }): Promise<ResolvedPromptTurnConfig> {
    const runtime = this.providerRuntime.runtimeForProvider(input.provider);
    const modelRecords = await runtime.listModels().catch(() => []);
    const defaultModel = modelRecords.find((entry) => entry.isDefault) ?? modelRecords[0] ?? null;
    const effectiveModel =
      input.promptInput?.model ?? input.currentModel ?? defaultModel?.model ?? null;
    const requestedReasoning =
      input.promptInput?.reasoningEffort !== undefined
        ? normalizeReasoningEffort(input.promptInput.reasoningEffort)
        : normalizeReasoningEffort(input.currentReasoningEffort);
    const normalizedReasoning = this.providerRuntime.normalizeReasoningForModel(
      modelRecords,
      effectiveModel,
      requestedReasoning,
    );
    const collaborationMode =
      input.promptInput?.collaborationMode ?? normalizeCollaborationMode(input.currentCollaborationMode);
    const sandboxMode =
      (input.promptInput?.sandboxMode !== undefined
        ? normalizeSandboxMode(input.promptInput.sandboxMode)
        : normalizeSandboxMode(input.currentSandboxMode)) ??
      defaultSandboxModeForApprovalMode(input.approvalMode);
    const fastMode = this.providerRuntime.fastModeForProvider(
      input.provider,
      input.currentFastMode,
    );
    ensureFastModeSupported(effectiveModel, fastMode, modelRecords);

    return {
      effectiveModel,
      normalizedReasoning,
      collaborationMode,
      sandboxMode,
      performanceMode: performanceModeForFastMode(fastMode),
      supportsRunningTurnInput: Boolean(runtime.sendInput && runtime.capabilities.turns.steer),
    };
  }
}
