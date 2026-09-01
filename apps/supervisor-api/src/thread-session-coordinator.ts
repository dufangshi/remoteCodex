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
  performanceMode: 'fast' | 'standard' | null;
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
  agentId?: string | null;
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
  watchSession?(
    sessionId: string,
    onChange: () => void,
  ): Promise<() => void>;
}

export class ThreadSessionCoordinator {
  constructor(
    private readonly providerRuntime: ThreadProviderRuntimeCoordinator,
    private readonly performanceModeSettings: ThreadPerformanceModeSettings,
    private readonly localSessionLookup: ThreadLocalSessionLookup,
  ) {}

  private async listSessionModels(input: {
    provider: string | null | undefined;
    agentId?: string | null | undefined;
    workspacePath?: string | null | undefined;
  }) {
    const runtime = this.providerRuntime.runtimeForProvider(input.provider);
    if (input.agentId && input.workspacePath && runtime.listModelsForAgent) {
      return runtime.listModelsForAgent(input.agentId, input.workspacePath);
    }
    return runtime.listModels();
  }

  async startThreadSession(input: {
    workspacePath: string;
    threadInput: CreateThreadInput;
    defaultTitle: string;
  }): Promise<StartThreadSessionResult> {
    const provider = this.providerRuntime.normalizeProvider(input.threadInput.provider);
    const normalizedTitle = input.threadInput.title?.trim() || input.defaultTitle;
    const runtime = this.providerRuntime.runtimeForProvider(provider);
    const modelRecords = await this.listSessionModels({
      provider,
      agentId: input.threadInput.agentId,
      workspacePath: input.workspacePath,
    }).catch(() => []);
    const effectiveModel = input.threadInput.model === 'default'
      ? modelRecords.find((model) => model.isDefault)?.model ?? input.threadInput.model
      : input.threadInput.model;
    const reasoningEffort = this.providerRuntime.normalizeReasoningForModel(
      modelRecords,
      effectiveModel,
      input.threadInput.reasoningEffort ?? null,
    );
    const sandboxMode = defaultSandboxModeForApprovalMode(input.threadInput.approvalMode);
    const capabilityScope = {
      agentId: input.threadInput.agentId ?? null,
    };
    const supportsFastMode = this.providerRuntime.runtimeSupportsFastMode(
      provider,
      capabilityScope,
    );
    const fastMode = supportsFastMode
      ? this.performanceModeSettings.readFastMode()
      : false;
    if (supportsFastMode) {
      ensureFastModeSupported(effectiveModel, fastMode, modelRecords);
    }
    const response = await runtime.startSession({
      cwd: input.workspacePath,
      ...(input.threadInput.agentId ? { agentId: input.threadInput.agentId } : {}),
      model: effectiveModel,
      reasoningEffort,
      approvalMode: input.threadInput.approvalMode,
      sandboxMode,
      ...(supportsFastMode
        ? { performanceMode: performanceModeForFastMode(fastMode) }
        : {}),
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

  async listImportSessions(
    provider: string | null | undefined,
    agentId?: string | null,
  ) {
    const runtime = this.providerRuntime.runtimeForProvider(provider);
    return runtime.listImportSessions
      ? runtime.listImportSessions(agentId)
      : runtime.listSessions();
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
        agentId: session.agentId ?? null,
        source: 'local_provider_import',
        sessionId,
        cwd: session.cwd,
        title: session.title?.trim() || session.preview?.trim() || 'Untitled imported session',
        model: null,
        summaryText: session.preview,
        fastMode: this.providerRuntime.runtimeSupportsFastMode(provider, {
          agentId: session.agentId ?? null,
          providerSessionId: sessionId,
        })
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
    agentId?: string | null;
    workspacePath?: string | null;
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
    const modelRecords = await this.listSessionModels({
      provider: input.provider,
      agentId: input.agentId,
      workspacePath: input.workspacePath,
    }).catch(() => []);
    const capabilityScope = {
      agentId: input.agentId ?? null,
      providerSessionId: input.providerSessionId,
    };
    const supportsFastMode = this.providerRuntime.runtimeSupportsFastMode(
      input.provider,
      capabilityScope,
    );
    const fastMode = this.providerRuntime.fastModeForProvider(
      input.provider,
      input.fastMode,
      capabilityScope,
    );
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
        ...(supportsFastMode
          ? { performanceMode: performanceModeForFastMode(fastMode) }
          : {}),
      });
    } catch (error) {
      if (!isRemoteThreadBootstrapError(error)) {
        throw error;
      }

      return { status: 'bootstrap_unavailable', error };
    }

    const effectiveModel =
      input.resumeInput.model ?? input.currentModel ?? response.model ?? null;
    const resumedModelRecords = await this.listSessionModels({
      provider: input.provider,
      agentId: input.agentId,
      workspacePath: input.workspacePath,
    }).catch(() => modelRecords);
    const resumedReasoning = this.providerRuntime.normalizeReasoningForModel(
      resumedModelRecords,
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
    agentId?: string | null;
    providerSessionId: string;
  }): Promise<void> {
    const runtime = this.providerRuntime.runtimeForProvider(input.provider);
    const capabilities = this.providerRuntime.capabilitiesFor(input);
    if (!runtime.compactSession || !capabilities.turns.compact) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support context compaction.',
      });
    }
    await runtime.compactSession(input.providerSessionId);
  }

  async forkThreadSession(input: {
    provider: string | null | undefined;
    agentId?: string | null;
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
    const capabilities = this.providerRuntime.capabilitiesFor(input);
    if (!runtime.forkSession || !capabilities.branching.fork) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend does not support session fork.',
      });
    }

    const turnsToRollback =
      selectedTurn == null
        ? 0
        : Math.max(0, input.turnOptions.length - selectedTurn.turnIndex);
    const rollbackSession = runtime.rollbackSession?.bind(runtime);
    if (turnsToRollback > 0 && !rollbackSession) {
      throw new HttpError(409, {
        code: 'conflict',
        message: 'This backend supports latest-session fork only.',
      });
    }

    let forkedSession = await runtime.forkSession({
      providerSessionId: input.providerSessionId,
      atTurnId: selectedTurn?.turnId ?? null,
    });
    if (turnsToRollback > 0) {
      forkedSession = await rollbackSession!({
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
    agentId?: string | null;
    workspacePath?: string | null;
    currentModel: string | null | undefined;
    currentReasoningEffort: string | null | undefined;
    currentFastMode: unknown;
    currentCollaborationMode: string | null | undefined;
    currentSandboxMode: string | null | undefined;
    settings: UpdateThreadSettingsInput;
  }): Promise<ResolvedThreadSettings> {
    const modelRecords = await this.listSessionModels({
      provider: input.provider,
      agentId: input.agentId,
      workspacePath: input.workspacePath,
    });
    const fallbackModel = modelRecords.find((entry) => entry.isDefault) ?? modelRecords[0] ?? null;
    const capabilityScope = {
      agentId: input.agentId ?? null,
      providerSessionId: null,
    };
    const supportsFastMode = this.providerRuntime.runtimeSupportsFastMode(
      input.provider,
      capabilityScope,
    );
    if (input.settings.fastMode === true && !supportsFastMode) {
      ensureFastModeSupported(
        input.settings.model ?? input.currentModel ?? null,
        true,
        modelRecords,
      );
    }
    const currentFastMode = this.providerRuntime.fastModeForProvider(
      input.provider,
      input.currentFastMode,
      capabilityScope,
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
    agentId?: string | null;
    workspacePath?: string | null;
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
    const modelRecords = await this.listSessionModels({
      provider: input.provider,
      agentId: input.agentId,
      workspacePath: input.workspacePath,
    }).catch(() => []);
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
    const capabilities = this.providerRuntime.capabilitiesFor({
      provider: input.provider,
      agentId: input.agentId ?? null,
    });
    const supportsFastMode = capabilities.controls.performanceMode;
    const fastMode = this.providerRuntime.fastModeForProvider(
      input.provider,
      input.currentFastMode,
      { agentId: input.agentId ?? null },
    );
    ensureFastModeSupported(effectiveModel, fastMode, modelRecords);

    return {
      effectiveModel,
      normalizedReasoning,
      collaborationMode,
      sandboxMode,
      performanceMode: supportsFastMode
        ? performanceModeForFastMode(fastMode)
        : null,
      supportsRunningTurnInput: Boolean(runtime.sendInput && capabilities.turns.steer),
    };
  }
}
