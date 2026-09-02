import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import * as acp from '@agentclientprotocol/sdk';

import {
  AgentRuntimeError,
  type AgentActionRequestResponseInput,
  type AgentHistoryItem,
  type AgentGoal,
  type AgentModel,
  type AgentPendingProviderRequest,
  type AgentProviderCapabilities,
  type AgentProviderRequest,
  type AgentProviderRequestMapping,
  type AgentRuntime,
  type AgentRuntimeEvent,
  type AgentRuntimeManagementSchema,
  type AgentRuntimeStatus,
  type AgentSessionDetail,
  type AgentSessionHistoryCoverage,
  type AgentSessionSummary,
  type AgentTurn,
  type InterruptAgentTurnInput,
  type ReadAgentSessionOptions,
  type ResumeAgentSessionInput,
  type SendAgentInputInput,
  type SetAgentGoalInput,
  type StartAgentSessionInput,
  type StartAgentSessionResult,
  type StartAgentTurnInput,
} from '../../agent-runtime/src/index';
import {
  parseCommandLine,
  spawnProcess,
} from '../../process-runtime/src/index';
import type { AgentBackendInstallationDto } from '../../shared/src/index';
import {
  AcpTurnItemMapper,
  type AcpMappedItemUpdate,
} from './item-mapper';
import { snapshotAcpInitializeResponse } from './capabilities';
import { buildAcpPromptContent } from './prompt-content';
import { HarnessExtensionRegistry } from './extension-registry';
import {
  REMOTE_CODEX_HARNESS_EXTENSION_EVENT_METHOD,
  type HarnessExtensionCallEnvelope,
  type HarnessExtensionEventEnvelope,
} from './extensions';
import { AcpSessionHydrator } from './session-hydrator';
import { AcpTerminalService } from './terminal-service';
import { resolveAcpWorkspacePath } from './workspace-boundary';
import {
  normalizeAcpEffort,
  standardAcpHarnessAdapter,
  type AcpHarnessAdapter,
  type AcpHarnessSessionProjection,
} from './harness-adapters';

interface AcpRuntimeOptions {
  command: string;
  harnessAdapter?: AcpHarnessAdapter;
  startupTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  clientInfo?: {
    name: string;
    title?: string;
    version?: string;
  };
}

interface AcpSessionState {
  providerSessionId: string;
  cwd: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  model: string | null;
  reasoningEffort: string | null;
  sandboxMode: string | null;
  status: AgentSessionSummary['status'];
  turns: AgentTurn[];
  activeMapper: AcpTurnItemMapper | null;
  modes: acp.SessionModeState | null;
  configOptions: acp.SessionConfigOption[];
  harnessState: unknown;
  availableCommands: acp.AvailableCommand[];
  hydrationCoverage: AgentSessionHistoryCoverage | null;
  goal: AgentGoal | null;
}

interface PendingPermission {
  params: acp.RequestPermissionRequest;
  resolve: (response: acp.RequestPermissionResponse) => void;
  timer: NodeJS.Timeout;
}

export const acpCapabilities: AgentProviderCapabilities = {
  sessions: {
    list: false,
    read: true,
    resume: false,
    importLocal: false,
    load: false,
    close: false,
    delete: false,
  },
  turns: {
    start: true,
    streamInput: false,
    steer: false,
    interrupt: true,
    compact: false,
  },
  branching: {
    fork: false,
    hardRollback: false,
    resumeAt: false,
    rewindFiles: false,
  },
  controls: {
    planMode: true,
    permissionRequests: true,
    sandboxMode: true,
    performanceMode: false,
    goals: false,
  },
  management: {
    models: false,
    mcpStatus: false,
    skills: false,
    hooks: false,
    hookTrust: false,
    hostConfigFiles: false,
    providerSettings: false,
  },
  usage: {
    contextWindow: true,
    tokenUsage: true,
    costUsd: false,
  },
};

const acpManagementSchema: AgentRuntimeManagementSchema = {
  hostConfigFiles: [],
  toolboxItems: [],
  hookCommandTemplates: [],
  providerConfigFormat: 'none',
  mcpConfigFormat: 'none',
  configArchives: false,
  buildRestart: false,
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function cloneCapabilities(): AgentProviderCapabilities {
  return structuredClone(acpCapabilities);
}

export function applyNegotiatedAcpCapabilities(
  target: AgentProviderCapabilities,
  capabilities: acp.AgentCapabilities | null | undefined,
) {
  target.sessions.list = Boolean(capabilities?.sessionCapabilities?.list);
  target.sessions.load = capabilities?.loadSession === true;
  target.sessions.resume = Boolean(
    capabilities?.loadSession || capabilities?.sessionCapabilities?.resume,
  );
  target.sessions.close = Boolean(capabilities?.sessionCapabilities?.close);
  target.sessions.delete = Boolean(capabilities?.sessionCapabilities?.delete);
  // Imported ACP sessions need Supervisor-owned stable history before import is safe.
  target.sessions.importLocal = false;
  target.branching.fork = Boolean(capabilities?.sessionCapabilities?.fork);
  return target;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function allSelectOptions(option: acp.SessionConfigOption) {
  if (option.type !== 'select') {
    return [];
  }
  return option.options.flatMap((entry) =>
    'options' in entry ? entry.options : [entry],
  );
}

function configOptionByCategory(
  options: acp.SessionConfigOption[],
  category: 'model' | 'thought_level',
) {
  const hints = category === 'model'
    ? ['model']
    : ['thought', 'reasoning', 'effort'];
  const candidates = options.filter((option) =>
    option.category === category ||
    hints.some((hint) => option.id.toLowerCase().includes(hint)),
  );
  if (category === 'thought_level') {
    const reasoningSelect = candidates.find(
      (option) =>
        option.type === 'select' &&
        allSelectOptions(option).some((entry) =>
          normalizeAcpEffort(entry.value),
        ),
    );
    if (reasoningSelect) {
      return reasoningSelect;
    }
  }
  return candidates[0] ?? null;
}

function reasoningOptions(configOptions: acp.SessionConfigOption[]) {
  const option = configOptionByCategory(configOptions, 'thought_level');
  if (!option || option.type !== 'select') {
    return {
      efforts: [] as AgentModel['supportedReasoningEfforts'],
      defaultEffort: null,
    };
  }
  const efforts = allSelectOptions(option).flatMap((entry) => {
    const effort = normalizeAcpEffort(entry.value);
    return effort
      ? [{ reasoningEffort: effort, description: entry.description ?? '' }]
      : [];
  });
  return {
    efforts: efforts.filter(
      (entry, index) =>
        efforts.findIndex((candidate) => candidate.reasoningEffort === entry.reasoningEffort) === index,
    ),
    defaultEffort: normalizeAcpEffort(option.currentValue),
  };
}

function modelsFromConfigOptions(
  configOptions: acp.SessionConfigOption[],
): AgentModel[] {
  const modelOption = configOptionByCategory(configOptions, 'model');
  if (!modelOption || modelOption.type !== 'select') {
    return [];
  }
  const reasoning = reasoningOptions(configOptions);
  const supportsPerformanceMode = configOptions.some(
    (option) => option.id === 'fast-mode' || option.id === 'fast',
  );
  return allSelectOptions(modelOption).map((option) => ({
    id: option.value,
    model: option.value,
    displayName: option.name || option.value,
    description: option.description ?? '',
    isDefault: option.value === modelOption.currentValue,
    hidden: false,
    supportsPerformanceMode,
    supportedReasoningEfforts: reasoning.efforts,
    defaultReasoningEffort: reasoning.defaultEffort,
    selectionKind: 'model',
  }));
}

function permissionOptions(params: acp.RequestPermissionRequest) {
  return params.options.map((option) => ({
    id: option.optionId,
    name: option.name,
    kind: option.kind,
  }));
}

function selectedPermission(optionId: string): acp.RequestPermissionResponse {
  return {
    outcome: {
      outcome: 'selected',
      optionId,
    },
  };
}

function cancelledPermission(): acp.RequestPermissionResponse {
  return { outcome: { outcome: 'cancelled' } };
}

function promptUsagePayload(usage: acp.Usage) {
  const normalized = {
    totalTokens: usage.totalTokens,
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedReadTokens ?? 0,
    cacheWriteInputTokens: usage.cachedWriteTokens ?? 0,
    outputTokens: usage.outputTokens,
    reasoningOutputTokens: usage.thoughtTokens ?? 0,
  };
  return {
    total: normalized,
    last: normalized,
  };
}

function sliceSessionTurns(
  turns: AgentTurn[],
  options: ReadAgentSessionOptions,
) {
  const limit = options.limit;
  if (limit === undefined && !options.beforeTurnId) {
    return turns;
  }
  const beforeIndex = options.beforeTurnId
    ? turns.findIndex((turn) => turn.providerTurnId === options.beforeTurnId)
    : -1;
  const exclusiveEnd = beforeIndex >= 0 ? beforeIndex : turns.length;
  const start = Math.max(0, exclusiveEnd - (limit ?? 10));
  return turns.slice(start, exclusiveEnd);
}

function sessionDetail(
  state: AcpSessionState,
  options: ReadAgentSessionOptions = {},
): AgentSessionDetail {
  const turns = sliceSessionTurns(state.turns, options);
  return {
    provider: 'acp',
    providerSessionId: state.providerSessionId,
    cwd: state.cwd,
    title: state.title,
    preview: state.turns.at(-1)?.items.findLast((item) => item.kind === 'agentMessage')?.text ?? null,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    status: state.status,
    turns: turns.map((turn) => ({
      ...turn,
      items: turn.items.map((item) => ({ ...item })),
    })),
    totalTurnCount: state.turns.length,
    ...(state.hydrationCoverage
      ? { historyCoverage: { ...state.hydrationCoverage } }
      : {}),
  };
}

function sessionSummaryFromInfo(info: acp.SessionInfo): AgentSessionSummary {
  return {
    provider: 'acp',
    providerSessionId: info.sessionId,
    cwd: info.cwd,
    title: info.title ?? null,
    preview: null,
    createdAt: null,
    updatedAt: info.updatedAt ?? null,
    status: 'not_loaded',
    rawSession: info,
  };
}

export class AcpRuntimeAdapter extends EventEmitter implements AgentRuntime {
  readonly provider = 'acp' as const;
  readonly displayName = 'ACP Agent';
  readonly description = 'Generic Agent Client Protocol runtime over stdio.';
  readonly capabilities = cloneCapabilities();
  readonly managementSchema = acpManagementSchema;
  readonly installation: AgentBackendInstallationDto = {
    packageName: null,
    installed: true,
    installedVersion: null,
    latestVersion: null,
    installCommand: null,
    updateCommand: null,
    busy: false,
    lastError: null,
  };

  private readonly sessions = new Map<string, AcpSessionState>();
  private readonly knownSessions = new Map<string, AgentSessionSummary>();
  private readonly pendingPermissions = new Map<number, PendingPermission>();
  private readonly hydrators = new Map<string, AcpSessionHydrator>();
  private readonly extensionRegistry = new HarnessExtensionRegistry();
  private readonly terminalService: AcpTerminalService;
  private readonly harnessAdapter: AcpHarnessAdapter;
  private child: ChildProcess | null = null;
  private connection: acp.ClientConnection | null = null;
  private context: acp.ClientContext | null = null;
  private initializeResponse: acp.InitializeResponse | null = null;
  private startupPromise: Promise<void> | null = null;
  private stopping = false;
  private permissionSequence = 0;
  private status: AgentRuntimeStatus = {
    state: 'stopped',
    transport: 'stdio',
    lastStartedAt: null,
    lastError: null,
    restartCount: 0,
  };

  constructor(private readonly options: AcpRuntimeOptions) {
    super();
    this.harnessAdapter = options.harnessAdapter ?? standardAcpHarnessAdapter;
    this.extensionRegistry.on(
      'event',
      (event: HarnessExtensionEventEnvelope) => this.emitRuntimeEvent({
        type: 'harness.extension',
        provider: 'acp',
        providerSessionId: event.providerSessionId,
        providerTurnId: event.providerTurnId,
        providerItemId: event.providerItemId,
        extensionId: event.extensionId,
        extensionVersion: event.extensionVersion,
        event: event.event,
        operationId: event.operationId,
        sequence: event.sequence,
        payload: event.payload,
      }),
    );
    this.terminalService = new AcpTerminalService(
      (sessionId) => this.sessions.get(sessionId)?.cwd ?? null,
      (operation) => this.emit('fs-operation', operation),
    );
  }

  getStatus() {
    return { ...this.status };
  }

  getProtocolSnapshot() {
    return snapshotAcpInitializeResponse(this.initializeResponse);
  }

  async start() {
    if (this.status.state === 'ready') {
      return;
    }
    if (this.startupPromise) {
      return this.startupPromise;
    }
    this.startupPromise = this.startConnection();
    try {
      await this.startupPromise;
    } finally {
      this.startupPromise = null;
    }
  }

  private async startConnection() {
    this.stopping = false;
    this.status = {
      ...this.status,
      state: 'starting',
      lastError: null,
      restartCount: this.status.lastStartedAt ? this.status.restartCount + 1 : 0,
    };
    this.emit('status', this.getStatus());

    try {
      const parsed = parseCommandLine(this.options.command);
      const child = spawnProcess({
        command: parsed.command,
        args: parsed.args,
        env: { ...process.env, ...this.options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.child = child;
      child.stderr?.on('data', (chunk: Buffer | string) => {
        this.emit('stderr', Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk);
      });
      child.on('error', (error) => this.markFailed(error));
      child.on('close', (code, signal) => {
        if (!this.stopping && this.status.state !== 'failed') {
          this.markFailed(new Error(
            `ACP agent exited unexpectedly (code ${code ?? 'null'}, signal ${signal ?? 'none'}).`,
          ));
        }
      });
      if (!child.stdin || !child.stdout) {
        throw new Error('ACP agent did not expose stdio pipes.');
      }

      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
      );
      const app = acp
        .client({ name: this.options.clientInfo?.name ?? 'remote-codex-supervisor' })
        .onRequest(acp.methods.client.session.requestPermission, (request) =>
          this.requestPermission(request.params))
        .onNotification(acp.methods.client.session.update, (notification) =>
          this.handleSessionUpdate(notification.params))
        .onNotification<HarnessExtensionEventEnvelope>(
          REMOTE_CODEX_HARNESS_EXTENSION_EVENT_METHOD,
          (params) => params as HarnessExtensionEventEnvelope,
          (notification) => {
            this.extensionRegistry.handleEvent(
              'acp-agent',
              notification.params,
            );
          },
        )
        .onRequest(acp.methods.client.fs.readTextFile, (request) =>
          this.readTextFile(request.params))
        .onRequest(acp.methods.client.fs.writeTextFile, (request) =>
          this.writeTextFile(request.params))
        .onRequest(acp.methods.client.terminal.create, (request) =>
          this.terminalService.create(request.params))
        .onRequest(acp.methods.client.terminal.output, (request) =>
          this.terminalService.output(request.params))
        .onRequest(acp.methods.client.terminal.waitForExit, (request) =>
          this.terminalService.waitForExit(request.params))
        .onRequest(acp.methods.client.terminal.kill, (request) =>
          this.terminalService.kill(request.params))
        .onRequest(acp.methods.client.terminal.release, (request) =>
          this.terminalService.release(request.params));
      this.connection = app.connect(stream);
      this.context = this.connection.agent;
      const initialize = this.context.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {
          fs: this.harnessAdapter.fsCapabilities ?? {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: true,
          session: {
            compaction: {},
            configOptions: { boolean: {} },
          },
          plan: {},
          ...(this.harnessAdapter.initializeClientMeta
            ? { _meta: this.harnessAdapter.initializeClientMeta }
            : {}),
        },
        clientInfo: {
          name: this.options.clientInfo?.name ?? 'remote-codex-supervisor',
          version: this.options.clientInfo?.version ?? '0.1.0',
          ...(this.options.clientInfo?.title ? { title: this.options.clientInfo.title } : {}),
        },
      }) as Promise<acp.InitializeResponse>;
      const initializeResponse = await this.withStartupTimeout(initialize);
      this.initializeResponse = initializeResponse;
      this.resetCapabilities();
      this.applyAgentCapabilities(initializeResponse.agentCapabilities);
      this.registerNegotiatedExtensions(initializeResponse);
      this.status = {
        ...this.status,
        state: 'ready',
        lastStartedAt: new Date().toISOString(),
        lastError: null,
      };
      this.installation.installed = true;
      this.installation.installedVersion = initializeResponse.agentInfo
        ? [initializeResponse.agentInfo.name, initializeResponse.agentInfo.version]
            .filter(Boolean)
            .join(' ')
        : 'ACP';
      this.installation.lastError = null;
      this.emit('status', this.getStatus());
    } catch (error) {
      this.markFailed(error);
      this.connection?.close(error);
      this.child?.kill('SIGTERM');
      this.connection = null;
      this.context = null;
      this.child = null;
      throw new AgentRuntimeError(
        `Unable to start ACP agent: ${errorMessage(error)}`,
        'acp',
        'provider_unavailable',
        { command: this.options.command },
        error,
      );
    }
  }

  async stop() {
    this.stopping = true;
    this.terminalService.stop();
    this.settleActiveTurns('interrupted', 'ACP runtime stopped.');
    this.cancelPendingPermissions();
    this.hydrators.clear();
    await this.closeLoadedSessionsBeforeStop();
    this.extensionRegistry.unregisterOwner('acp-agent');
    this.connection?.close();
    this.child?.kill('SIGTERM');
    this.connection = null;
    this.context = null;
    this.initializeResponse = null;
    this.child = null;
    this.sessions.clear();
    this.status = {
      ...this.status,
      state: 'stopped',
      lastError: null,
    };
    this.emit('status', this.getStatus());
  }

  private async closeLoadedSessionsBeforeStop() {
    if (
      !this.context ||
      !this.initializeResponse?.agentCapabilities?.sessionCapabilities?.close
    ) {
      return;
    }
    const sessionIds = [...this.sessions.keys()];
    const results = await Promise.allSettled(sessionIds.map((sessionId) =>
      this.context!.request(acp.methods.agent.session.close, { sessionId })));
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.emit(
          'warning',
          `Unable to close ACP session ${sessionIds[index] ?? 'unknown'} before stop: ${errorMessage(result.reason)}`,
        );
      }
    });
  }

  async listModels(): Promise<AgentModel[]> {
    return [{
      id: 'default',
      model: 'default',
      displayName: 'Agent default',
      description: 'Use the model configured by the ACP agent.',
      isDefault: true,
      hidden: false,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
    }];
  }

  async inspectModelOptions(cwd: string): Promise<AgentModel[]> {
    const context = await this.requireContext();
    const adapterModels = await this.harnessAdapter.listModels?.(context);
    if (adapterModels && adapterModels.length > 0) {
      return adapterModels;
    }
    const sessionCapabilities =
      this.initializeResponse?.agentCapabilities?.sessionCapabilities;
    if (!sessionCapabilities?.delete) {
      const normalizedCwd = path.resolve(cwd);
      const loadedSession = [...this.sessions.values()].find(
        (session) =>
          session.cwd === normalizedCwd &&
          (session.configOptions.length > 0 || session.harnessState !== null),
      );
      if (!loadedSession) {
        return this.listModels();
      }
      if (loadedSession.harnessState && this.harnessAdapter.modelsFromState) {
        return this.harnessAdapter.modelsFromState(loadedSession.harnessState);
      }
      const loadedModels = modelsFromConfigOptions(loadedSession.configOptions);
      if (loadedModels.length > 0) {
        return loadedModels;
      }
      const reasoning = reasoningOptions(loadedSession.configOptions);
      const supportsPerformanceMode = loadedSession.configOptions.some(
        (option) => option.id === 'fast-mode' || option.id === 'fast',
      );
      return [{
        id: 'default',
        model: 'default',
        displayName: 'Agent default',
        description: 'Use the model configured by the ACP agent.',
        isDefault: true,
        hidden: false,
        supportsPerformanceMode,
        supportedReasoningEfforts: reasoning.efforts,
        defaultReasoningEffort: reasoning.defaultEffort,
        selectionKind: 'model',
      }];
    }
    const response = await context.request(acp.methods.agent.session.new, {
      cwd: path.resolve(cwd),
      mcpServers: [],
      _meta: { yoloMode: false, remoteCodexCapabilityProbe: true },
    });
    let configOptions = response.configOptions ?? [];
    this.updateCapabilitiesFromConfigOptions(configOptions);
    const supportsPerformanceMode = configOptions.some(
      (option) => option.id === 'fast-mode' || option.id === 'fast',
    );
    try {
      const harnessProjection = this.harnessAdapter.projectSession?.(response);
      if (harnessProjection) {
        return harnessProjection.models;
      }
      const modelOption = configOptionByCategory(configOptions, 'model');
      if (!modelOption || modelOption.type !== 'select') {
        const reasoning = reasoningOptions(configOptions);
        return [{
          id: 'default',
          model: 'default',
          displayName: 'Agent default',
          description: 'Use the model configured by the ACP agent.',
          isDefault: true,
          hidden: false,
          supportsPerformanceMode,
          supportedReasoningEfforts: reasoning.efforts,
          defaultReasoningEffort: reasoning.defaultEffort,
          selectionKind: 'model',
        }];
      }

      const models: AgentModel[] = [];
      for (const option of allSelectOptions(modelOption)) {
        if (option.value !== modelOption.currentValue) {
          try {
            const updated = await context.request(acp.methods.agent.session.setConfigOption, {
              sessionId: response.sessionId,
              configId: modelOption.id,
              value: option.value,
            });
            configOptions = updated.configOptions;
          } catch {
            configOptions = response.configOptions ?? [];
          }
        }
        const reasoning = reasoningOptions(configOptions);
        models.push({
          id: option.value,
          model: option.value,
          displayName: option.name || option.value,
          description: option.description ?? '',
          isDefault: option.value === modelOption.currentValue,
          hidden: false,
          supportsPerformanceMode,
          supportedReasoningEfforts: reasoning.efforts,
          defaultReasoningEffort: reasoning.defaultEffort,
          selectionKind: 'model',
        });
      }
      return models;
    } finally {
      await context.request(acp.methods.agent.session.delete, {
        sessionId: response.sessionId,
      }).catch(() => undefined);
    }
  }

  async listSessions(): Promise<AgentSessionSummary[]> {
    const context = await this.requireContext();
    const canList = Boolean(this.initializeResponse?.agentCapabilities?.sessionCapabilities?.list);
    if (!canList) {
      return [...this.sessions.values()].map((state) => sessionDetail(state));
    }

    const sessions: AgentSessionSummary[] = [];
    let cursor: string | null | undefined;
    do {
      const response = await context.request(acp.methods.agent.session.list, {
        ...(cursor ? { cursor } : {}),
      });
      for (const info of response.sessions) {
        const loaded = this.sessions.get(info.sessionId);
        if (loaded) {
          loaded.title = info.title ?? loaded.title;
          loaded.updatedAt = info.updatedAt ?? loaded.updatedAt;
        }
        const summary = loaded
          ? sessionDetail(loaded)
          : sessionSummaryFromInfo(info);
        sessions.push(summary);
        this.knownSessions.set(summary.providerSessionId, summary);
      }
      cursor = response.nextCursor;
    } while (cursor);
    return sessions;
  }

  async listLoadedSessions() {
    return [...this.sessions.keys()];
  }

  async closeSession(providerSessionId: string) {
    if (!this.initializeResponse?.agentCapabilities?.sessionCapabilities?.close) {
      throw new AgentRuntimeError(
        'ACP agent does not support session/close.',
        'acp',
        'request_failed',
      );
    }
    await (await this.requireContext()).request(acp.methods.agent.session.close, {
      sessionId: providerSessionId,
    });
    this.sessions.delete(providerSessionId);
  }

  async deleteSession(providerSessionId: string) {
    if (!this.initializeResponse?.agentCapabilities?.sessionCapabilities?.delete) {
      throw new AgentRuntimeError(
        'ACP agent does not support session/delete.',
        'acp',
        'request_failed',
      );
    }
    await (await this.requireContext()).request(acp.methods.agent.session.delete, {
      sessionId: providerSessionId,
    });
    this.sessions.delete(providerSessionId);
    this.knownSessions.delete(providerSessionId);
  }

  async sendInput(input: SendAgentInputInput): Promise<AgentTurn | null> {
    const state = this.sessions.get(input.providerSessionId);
    if (!state?.activeMapper || state.activeMapper.turnId !== input.providerTurnId) {
      return null;
    }
    if (!this.extensionRegistry.supports('acp.steering', 1, 'steer')) {
      throw new AgentRuntimeError(
        'The selected ACP agent does not support running-turn steering.',
        'acp',
        'request_failed',
      );
    }
    const prompt = await buildAcpPromptContent({
      prompt: input.prompt,
      workspacePath: input.workspacePath ?? state.cwd,
      promptCapabilities: this.initializeResponse?.agentCapabilities?.promptCapabilities,
    });
    const operationId = randomUUID();
    await this.extensionRegistry.invoke({
      extensionId: 'acp.steering',
      extensionVersion: 1,
      method: 'steer',
      operationId,
      idempotencyKey: `${input.providerSessionId}:${input.providerTurnId}:steer:${operationId}`,
      params: {
        providerSessionId: input.providerSessionId,
        prompt,
      },
    });
    return state.activeMapper.turn();
  }

  async compactSession(providerSessionId: string) {
    const operationId = randomUUID();
    await this.extensionRegistry.invoke({
      extensionId: 'codex.control',
      extensionVersion: 1,
      method: 'compact',
      operationId,
      idempotencyKey: `${providerSessionId}:compact:${operationId}`,
      params: { providerSessionId },
      timeoutMs: 180_000,
    });
  }

  async forkSession(input: { providerSessionId: string; atTurnId?: string | null }) {
    if (!this.initializeResponse?.agentCapabilities?.sessionCapabilities?.fork) {
      throw new AgentRuntimeError(
        'The selected ACP agent does not support session/fork.',
        'acp',
        'request_failed',
      );
    }
    const source = this.sessions.get(input.providerSessionId) ??
      await this.restoreSession(input.providerSessionId);
    const response = await (await this.requireContext()).request(
      acp.methods.agent.session.fork,
      {
        sessionId: source.providerSessionId,
        cwd: source.cwd,
        mcpServers: [],
      },
    );
    const now = new Date().toISOString();
    this.knownSessions.set(response.sessionId, {
      provider: 'acp',
      providerSessionId: response.sessionId,
      cwd: source.cwd,
      title: source.title,
      preview: source.turns.at(-1)?.items
        .filter((item) => item.kind === 'agentMessage')
        .map((item) => item.text)
        .join('\n') || null,
      createdAt: now,
      updatedAt: now,
      status: 'not_loaded',
    });
    const forked = await this.restoreSession(response.sessionId);
    if (forked.turns.length === 0 && source.turns.length > 0) {
      forked.turns = structuredClone(source.turns);
      forked.hydrationCoverage = null;
    }
    forked.modes = response.modes ?? forked.modes;
    forked.configOptions = response.configOptions ?? forked.configOptions;
    this.applyHarnessProjection(forked, response);
    this.syncStateFromConfigOptions(forked);
    return sessionDetail(forked);
  }

  async getGoal(providerSessionId: string) {
    return this.sessions.get(providerSessionId)?.goal ?? null;
  }

  async setGoal(input: SetAgentGoalInput) {
    const state = this.sessions.get(input.providerSessionId);
    if (!state) {
      throw new AgentRuntimeError('ACP session is not loaded.', 'acp', 'request_failed');
    }
    if (input.tokenBudget !== undefined && input.tokenBudget !== null) {
      throw new AgentRuntimeError(
        'Codex ACP goal control does not expose token budgets.',
        'acp',
        'request_failed',
      );
    }
    const action: { action: 'set'; objective: string } |
      { action: 'pause' | 'resume' | 'clear' } | null = input.objective?.trim()
      ? { action: 'set', objective: input.objective.trim() }
      : input.status === 'paused'
        ? { action: 'pause' }
        : input.status === 'active'
          ? { action: 'resume' }
          : null;
    if (!action) {
      throw new AgentRuntimeError(
        'Codex ACP goal update requires an objective, pause, or resume action.',
        'acp',
        'request_failed',
      );
    }
    await this.invokeAcpGoal(input.providerSessionId, action);
    if (!state.goal) {
      throw new AgentRuntimeError(
        'Codex ACP completed goal control without publishing a goal snapshot.',
        'acp',
        'invalid_response',
      );
    }
    return state.goal;
  }

  async clearGoal(providerSessionId: string) {
    const state = this.sessions.get(providerSessionId);
    if (!state) {
      return false;
    }
    const existed = Boolean(state.goal);
    await this.invokeAcpGoal(providerSessionId, { action: 'clear' });
    return existed;
  }

  listHarnessExtensions() {
    return this.extensionRegistry.list();
  }

  invokeHarnessExtension<T = unknown>(input: {
    extensionId: string;
    extensionVersion: number;
    method: string;
    operationId: string;
    idempotencyKey: string;
    params: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
  }) {
    return this.extensionRegistry.invoke<T>(input);
  }

  async readSession(
    providerSessionId: string,
    options: ReadAgentSessionOptions = {},
  ): Promise<AgentSessionDetail> {
    const state = this.sessions.get(providerSessionId) ??
      await this.restoreSession(providerSessionId);
    return sessionDetail(state, options);
  }

  async startSession(input: StartAgentSessionInput): Promise<StartAgentSessionResult> {
    const context = await this.requireContext();
    const response = await context.request(acp.methods.agent.session.new, {
      cwd: path.resolve(input.cwd),
      mcpServers: [],
      _meta: {
        yoloMode: input.approvalMode === 'yolo',
        ...(this.harnessAdapter.sessionNewMeta?.({
          ...(input.reasoningEffort !== undefined
            ? { reasoningEffort: input.reasoningEffort }
            : {}),
        }) ?? {}),
      },
    });
    const now = new Date().toISOString();
    const harnessProjection = this.harnessAdapter.projectSession?.(response);
    const state: AcpSessionState = {
      providerSessionId: response.sessionId,
      cwd: path.resolve(input.cwd),
      title: null,
      createdAt: now,
      updatedAt: now,
      model: null,
      reasoningEffort: null,
      sandboxMode: input.sandboxMode ?? null,
      status: 'idle',
      turns: [],
      activeMapper: null,
      modes: response.modes ?? null,
      configOptions: response.configOptions ?? [],
      harnessState: harnessProjection?.state ?? null,
      availableCommands: [],
      hydrationCoverage: null,
      goal: null,
    };
    if (harnessProjection) {
      state.model = harnessProjection.model;
      state.reasoningEffort = harnessProjection.reasoningEffort;
    }
    this.sessions.set(state.providerSessionId, state);
    this.syncStateFromConfigOptions(state);
    this.knownSessions.set(state.providerSessionId, sessionDetail(state));
    await this.applySessionSettings(
      state,
      input.model,
      input.reasoningEffort,
      input.sandboxMode,
      undefined,
      input.performanceMode,
    );
    const session = sessionDetail(state);
    return {
      provider: 'acp',
      agentId: null,
      providerSessionId: state.providerSessionId,
      model: state.model,
      reasoningEffort: state.reasoningEffort,
      sandboxMode: state.sandboxMode,
      session,
      rawSession: response,
    };
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<StartAgentSessionResult> {
    const existing = this.sessions.get(input.providerSessionId);
    const state = existing ?? await this.restoreSession(input.providerSessionId);
    await this.applySessionSettings(
      state,
      input.model,
      undefined,
      input.sandboxMode,
      undefined,
      input.performanceMode,
    );
    state.status = 'idle';
    state.updatedAt = new Date().toISOString();
    const session = sessionDetail(state);
    return {
      provider: 'acp',
      providerSessionId: state.providerSessionId,
      model: state.model,
      reasoningEffort: state.reasoningEffort,
      sandboxMode: state.sandboxMode,
      session,
    };
  }

  async startTurn(input: StartAgentTurnInput): Promise<AgentTurn> {
    const state = this.sessions.get(input.providerSessionId);
    if (!state) {
      throw new AgentRuntimeError(
        `ACP session is not loaded: ${input.providerSessionId}`,
        'acp',
        'request_failed',
      );
    }
    if (state.activeMapper) {
      throw new AgentRuntimeError('ACP session already has an active turn.', 'acp', 'request_failed');
    }
    await this.applySessionSettings(
      state,
      input.model,
      input.reasoningEffort,
      input.sandboxMode,
      input.collaborationMode,
      input.performanceMode,
    );

    const prompt = await buildAcpPromptContent({
      prompt: input.prompt,
      workspacePath: input.workspacePath ?? state.cwd,
      promptCapabilities: this.initializeResponse?.agentCapabilities?.promptCapabilities,
      ...(input.content ? { content: input.content } : {}),
    });
    const promptPreamble = [
      this.harnessAdapter.promptPreamble,
      input.developerInstructions?.trim(),
    ].filter((value): value is string => Boolean(value));
    if (promptPreamble.length > 0) {
      prompt.unshift({ type: 'text', text: `${promptPreamble.join('\n\n')}\n\n` });
    }
    const context = await this.requireContext();

    const turnId = input.displayTurnId ?? randomUUID();
    const startedAt = new Date().toISOString();
    const initialItems: AgentHistoryItem[] = input.hidden
      ? []
      : [{
          id: `${turnId}:user`,
          kind: 'userMessage',
          text: input.displayPrompt ?? input.prompt,
          createdAt: startedAt,
        }];
    const mapper = new AcpTurnItemMapper(turnId, initialItems);
    const startedTurn = { ...mapper.turn(), startedAt };
    state.activeMapper = mapper;
    state.status = 'running';
    state.updatedAt = startedAt;
    state.turns.push(startedTurn);
    this.emitRuntimeEvent({
      type: 'turn.started',
      provider: 'acp',
      providerSessionId: state.providerSessionId,
      turn: startedTurn,
    });

    void Promise.resolve().then(() =>
      context.request(acp.methods.agent.session.prompt, {
        sessionId: state.providerSessionId,
        prompt,
      }),
    ).then(
      (response) => this.completePrompt(state, mapper, response),
      (error) => this.failPrompt(state, mapper, error),
    );
    return startedTurn;
  }

  async interruptTurn(input: InterruptAgentTurnInput): Promise<AgentTurn | null> {
    const state = this.sessions.get(input.providerSessionId);
    if (!state?.activeMapper) {
      return null;
    }
    const mapper = state.activeMapper;
    const context = await this.requireContext();
    await context.notify(acp.methods.agent.session.cancel, {
      sessionId: input.providerSessionId,
    });
    return this.finishPrompt(state, mapper, 'interrupted', null);
  }

  mapProviderRequest(
    request: AgentProviderRequest,
    options: { approvalMode: 'yolo' | 'guarded' },
  ): AgentProviderRequestMapping | null {
    if (request.method !== acp.methods.client.session.requestPermission || !isRecord(request.params)) {
      return null;
    }
    const params = request.params as acp.RequestPermissionRequest;
    const choices = permissionOptions(params);
    const allow = choices.find((option) => option.kind === 'allow_always')
      ?? choices.find((option) => option.kind === 'allow_once');
    if (options.approvalMode === 'yolo' && allow) {
      return {
        providerRequestId: request.id,
        providerSessionId: params.sessionId,
        autoApprovedResult: selectedPermission(allow.id),
        pendingRequest: null,
      };
    }

    const turnId = this.sessions.get(params.sessionId)?.activeMapper?.turnId ?? null;
    return {
      providerRequestId: request.id,
      providerSessionId: params.sessionId,
      autoApprovedResult: null,
      pendingRequest: {
        providerRequestId: request.id,
        responseKind: 'acpPermission',
        responsePayload: { options: choices },
        request: {
          id: `acp-permission:${request.id}`,
          kind: 'requestUserInput',
          title: 'Permission required',
          description: params.toolCall.title ?? null,
          turnId,
          itemId: params.toolCall.toolCallId,
          createdAt: new Date().toISOString(),
          questions: [{
            id: 'permission',
            header: 'Permission',
            question: params.toolCall.title ?? 'Allow this tool call?',
            isOther: false,
            isSecret: false,
            options: choices.map((choice) => ({
              label: choice.name,
              description: choice.kind.replaceAll('_', ' '),
            })),
          }],
        },
      },
    };
  }

  buildProviderRequestResponse(
    pending: AgentPendingProviderRequest,
    input: AgentActionRequestResponseInput,
  ) {
    const options = Array.isArray(pending.responsePayload?.options)
      ? pending.responsePayload.options.filter(isRecord)
      : [];
    const answer = Object.values(input.answers).flatMap((entry) => entry.answers)[0] ?? '';
    const selected = options.find((option) => option.name === answer || option.id === answer);
    return selected && typeof selected.id === 'string'
      ? selectedPermission(selected.id)
      : cancelledPermission();
  }

  respondToProviderRequest(id: string | number, result: unknown) {
    const numericId = Number(id);
    const pending = this.pendingPermissions.get(numericId);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pendingPermissions.delete(numericId);
    pending.resolve(result as acp.RequestPermissionResponse);
  }

  private async restoreSession(providerSessionId: string) {
    const context = await this.requireContext();
    let summary = this.knownSessions.get(providerSessionId) ?? null;
    if (!summary) {
      summary = (await this.listSessions()).find(
        (candidate) => candidate.providerSessionId === providerSessionId,
      ) ?? null;
    }
    if (!summary?.cwd) {
      throw new AgentRuntimeError(
        `ACP session working directory is unavailable: ${providerSessionId}`,
        'acp',
        'request_failed',
      );
    }

    const now = new Date().toISOString();
    const state: AcpSessionState = {
      providerSessionId,
      cwd: summary.cwd,
      title: summary.title,
      createdAt: summary.createdAt ?? now,
      updatedAt: summary.updatedAt ?? now,
      model: null,
      reasoningEffort: null,
      sandboxMode: null,
      status: 'not_loaded',
      turns: [],
      activeMapper: null,
      modes: null,
      configOptions: [],
      harnessState: null,
      availableCommands: [],
      hydrationCoverage: null,
      goal: null,
    };
    this.sessions.set(providerSessionId, state);
    try {
      const capabilities = this.initializeResponse?.agentCapabilities;
      if (capabilities?.loadSession) {
        const hydrator = new AcpSessionHydrator(providerSessionId);
        this.hydrators.set(providerSessionId, hydrator);
        try {
          const response = await context.request(acp.methods.agent.session.load, {
            sessionId: providerSessionId,
            cwd: summary.cwd,
            mcpServers: [],
          });
          state.modes = response.modes ?? null;
          state.configOptions = response.configOptions ?? [];
          this.applyHarnessProjection(state, response);
          state.turns = hydrator.complete();
          state.hydrationCoverage = hydrator.coverage();
          this.syncStateFromConfigOptions(state);
        } finally {
          this.hydrators.delete(providerSessionId);
        }
      } else if (capabilities?.sessionCapabilities?.resume) {
        const response = await context.request(acp.methods.agent.session.resume, {
          sessionId: providerSessionId,
          cwd: summary.cwd,
          mcpServers: [],
        });
        state.modes = response.modes ?? null;
        state.configOptions = response.configOptions ?? [];
        this.applyHarnessProjection(state, response);
        this.syncStateFromConfigOptions(state);
      } else {
        throw new Error('ACP agent does not support session/load or session/resume.');
      }
      state.status = 'idle';
      return state;
    } catch (error) {
      this.sessions.delete(providerSessionId);
      throw new AgentRuntimeError(
        `Unable to restore ACP session: ${errorMessage(error)}`,
        'acp',
        'request_failed',
        { providerSessionId },
        error,
      );
    }
  }

  private async applySessionSettings(
    state: AcpSessionState,
    model?: string | null,
    reasoningEffort?: string | null,
    sandboxMode?: string | null,
    collaborationMode?: 'default' | 'plan' | null,
    performanceMode?: 'standard' | 'fast' | null,
  ) {
    if (model && model !== 'default') {
      state.model = await this.setConfigOption(state, 'model', model);
    }
    if (
      reasoningEffort &&
      normalizeAcpEffort(reasoningEffort) !== state.reasoningEffort
    ) {
      const applied = await this.setConfigOption(
        state,
        'thought_level',
        reasoningEffort,
      );
      state.reasoningEffort = normalizeAcpEffort(applied);
    }
    if (sandboxMode !== undefined) {
      state.sandboxMode = sandboxMode;
    }
    if (performanceMode) {
      await this.setFastMode(state, performanceMode === 'fast');
    }

    const modes = state.modes?.availableModes ?? [];
    if (modes.length === 0) {
      return;
    }
    const preferred = collaborationMode === 'plan'
      ? ['plan', 'architect', 'ask']
      : sandboxMode === 'read-only'
        ? ['read-only', 'readonly', 'ask']
        : sandboxMode === 'danger-full-access'
          ? ['agent-full-access', 'full-access', 'yolo']
          : ['agent', 'code', 'build'];
    const mode = preferred
      .map((id) => modes.find((candidate) => candidate.id.toLowerCase() === id))
      .find(Boolean);
    if (mode && mode.id !== state.modes?.currentModeId) {
      const context = await this.requireContext();
      await context.request(acp.methods.agent.session.setMode, {
        sessionId: state.providerSessionId,
        modeId: mode.id,
      });
      state.modes = { ...state.modes!, currentModeId: mode.id };
    }
  }

  private async setConfigOption(
    state: AcpSessionState,
    category: 'model' | 'thought_level',
    value: string,
  ) {
    const option = configOptionByCategory(state.configOptions, category);
    if ((!option || option.type !== 'select') && category === 'model') {
      if (!state.harnessState || !this.harnessAdapter.applyModel) {
        throw new AgentRuntimeError(
          'ACP agent does not expose a model config option.',
          'acp',
          'request_failed',
        );
      }
      const projection = await this.harnessAdapter.applyModel({
        context: await this.requireContext(),
        sessionId: state.providerSessionId,
        state: state.harnessState,
        model: value,
      });
      if (projection) {
        this.applyHarnessProjectionValue(state, projection);
      }
      return value;
    }
    if ((!option || option.type !== 'select') && category === 'thought_level') {
      if (state.harnessState && this.harnessAdapter.applyReasoningEffort) {
        const projection = await this.harnessAdapter.applyReasoningEffort({
          context: await this.requireContext(),
          sessionId: state.providerSessionId,
          cwd: state.cwd,
          state: state.harnessState,
          reasoningEffort: value,
        });
        if (projection) {
          this.applyHarnessProjectionValue(state, projection);
          return projection.reasoningEffort ?? value;
        }
      }
    }
    if (!option || option.type !== 'select') {
      throw new AgentRuntimeError(
        `ACP agent does not expose a ${category} config option.`,
        'acp',
        'request_failed',
      );
    }
    const selected = allSelectOptions(option).find((candidate) =>
      candidate.value === value ||
      candidate.name.toLowerCase() === value.toLowerCase() ||
      (category === 'thought_level' &&
        normalizeAcpEffort(candidate.value) === normalizeAcpEffort(value)),
    );
    if (!selected) {
      throw new AgentRuntimeError(
        `ACP agent rejected unknown ${category} option: ${value}`,
        'acp',
        'request_failed',
      );
    }
    if (selected.value === option.currentValue) {
      return selected.value;
    }
    const context = await this.requireContext();
    const response = await context.request(acp.methods.agent.session.setConfigOption, {
      sessionId: state.providerSessionId,
      configId: option.id,
      value: selected.value,
    });
    state.configOptions = response.configOptions;
    this.applyHarnessProjection(state, response);
    return selected.value;
  }

  private syncStateFromConfigOptions(state: AcpSessionState) {
    this.updateCapabilitiesFromConfigOptions(state.configOptions);
    const modelOption = configOptionByCategory(state.configOptions, 'model');
    if (modelOption?.type === 'select') {
      state.model = modelOption.currentValue;
    }
    const thoughtOption = configOptionByCategory(
      state.configOptions,
      'thought_level',
    );
    if (thoughtOption?.type === 'select') {
      state.reasoningEffort = normalizeAcpEffort(thoughtOption.currentValue);
    }
  }

  private applyHarnessProjection(state: AcpSessionState, response: unknown) {
    const projection = this.harnessAdapter.projectSession?.(response);
    if (projection) {
      this.applyHarnessProjectionValue(state, projection);
    }
  }

  private applyHarnessProjectionValue(
    state: AcpSessionState,
    projection: AcpHarnessSessionProjection,
  ) {
    state.harnessState = projection.state;
    state.model = projection.model;
    state.reasoningEffort = projection.reasoningEffort;
  }

  private updateCapabilitiesFromConfigOptions(
    configOptions: acp.SessionConfigOption[],
  ) {
    this.capabilities.management.models ||= Boolean(
      configOptionByCategory(configOptions, 'model'),
    );
    this.capabilities.controls.performanceMode ||= configOptions.some(
      (option) => option.id === 'fast-mode' || option.id === 'fast',
    );
  }

  private async setFastMode(state: AcpSessionState, enabled: boolean) {
    const option = state.configOptions.find(
      (candidate) =>
        candidate.id === 'fast-mode' || candidate.id === 'fast',
    );
    if (!option) {
      throw new AgentRuntimeError(
        'The selected ACP agent does not expose fast mode.',
        'acp',
        'request_failed',
      );
    }
    const value = option.type === 'boolean'
      ? enabled
      : allSelectOptions(option).find((candidate) =>
          enabled
            ? ['on', 'true', 'fast'].includes(candidate.value.toLowerCase())
            : ['off', 'false', 'standard'].includes(candidate.value.toLowerCase()))?.value;
    if (value === undefined || value === option.currentValue) {
      return;
    }
    const response = await (await this.requireContext()).request(
      acp.methods.agent.session.setConfigOption,
      option.type === 'boolean'
        ? {
            sessionId: state.providerSessionId,
            configId: option.id,
            type: 'boolean',
            value: value as boolean,
          }
        : {
            sessionId: state.providerSessionId,
            configId: option.id,
            value: value as string,
          },
    );
    state.configOptions = response.configOptions;
    this.updateCapabilitiesFromConfigOptions(state.configOptions);
  }

  private handleSessionUpdate(notification: acp.SessionNotification) {
    const state = this.sessions.get(notification.sessionId);
    if (!state) {
      return;
    }
    state.updatedAt = new Date().toISOString();
    const notificationMeta = (
      notification as acp.SessionNotification & { _meta?: unknown }
    )._meta;
    const update = notificationMeta
      ? {
          ...notification.update,
          _meta: notificationMeta,
        } as acp.SessionUpdate
      : notification.update;
    const hydrator = this.hydrators.get(notification.sessionId);
    if (update.sessionUpdate === 'config_option_update') {
      state.configOptions = update.configOptions;
      this.syncStateFromConfigOptions(state);
    } else if (update.sessionUpdate === 'current_mode_update' && state.modes) {
      state.modes = { ...state.modes, currentModeId: update.currentModeId };
    } else if (update.sessionUpdate === 'available_commands_update') {
      state.availableCommands = update.availableCommands;
    } else if (update.sessionUpdate === 'session_info_update') {
      if (update.title !== undefined) {
        state.title = update.title;
        if (update.title && !hydrator) {
          this.emitRuntimeEvent({
            type: 'session.title.updated',
            provider: 'acp',
            providerSessionId: state.providerSessionId,
            title: update.title,
          });
        }
      }
      const goal = this.goalFromSessionInfoUpdate(
        state.providerSessionId,
        update,
      );
      if (goal !== undefined) {
        state.goal = goal;
        if (!hydrator) {
          this.emitRuntimeEvent(goal
            ? {
                type: 'goal.updated',
                provider: 'acp',
                providerSessionId: state.providerSessionId,
                providerTurnId: state.activeMapper?.turnId ?? null,
                goal,
              }
            : {
                type: 'goal.cleared',
                provider: 'acp',
                providerSessionId: state.providerSessionId,
              });
        }
      }
    }

    if (hydrator) {
      hydrator.apply(update);
      return;
    }

    const mapper = state.activeMapper;
    if (!mapper) {
      return;
    }
    const mapped = mapper.apply(update);
    for (const itemUpdate of mapped.itemUpdates) {
      this.emitItemUpdate(state, mapper.turnId, itemUpdate);
    }
    for (const delta of mapped.outputDeltas) {
      this.emitRuntimeEvent({
        type: 'output.delta',
        provider: 'acp',
        providerSessionId: state.providerSessionId,
        providerTurnId: mapper.turnId,
        itemId: delta.itemId,
        delta: delta.delta,
        ...(delta.createdAt ? { createdAt: delta.createdAt } : {}),
      });
    }
    if (mapped.planUpdate) {
      this.emitRuntimeEvent({
        type: 'plan.updated',
        provider: 'acp',
        providerSessionId: state.providerSessionId,
        providerTurnId: mapper.turnId,
        explanation: mapped.planUpdate.explanation,
        plan: mapped.planUpdate.plan,
      });
    }
    if (mapped.usage) {
      this.emitRuntimeEvent({
        type: 'usage.updated',
        provider: 'acp',
        providerSessionId: state.providerSessionId,
        providerTurnId: mapper.turnId,
        usage: {
          last: { totalTokens: mapped.usage.used },
          modelContextWindow: mapped.usage.size,
          ...(mapped.usage.cost ? { cost: mapped.usage.cost } : {}),
        },
      });
    }
  }

  private completePrompt(
    state: AcpSessionState,
    mapper: AcpTurnItemMapper,
    response: acp.PromptResponse,
  ) {
    if (state.activeMapper !== mapper) {
      return;
    }
    if (response.usage) {
      this.emitRuntimeEvent({
        type: 'usage.updated',
        provider: 'acp',
        providerSessionId: state.providerSessionId,
        providerTurnId: mapper.turnId,
        usage: promptUsagePayload(response.usage),
      });
    }
    const status = response.stopReason === 'cancelled' ? 'interrupted' : 'completed';
    this.finishPrompt(state, mapper, status, response);
  }

  private failPrompt(state: AcpSessionState, mapper: AcpTurnItemMapper, error: unknown) {
    const message = errorMessage(error);
    this.finishPrompt(state, mapper, 'failed', error, message);
  }

  private finishPrompt(
    state: AcpSessionState,
    mapper: AcpTurnItemMapper,
    status: 'completed' | 'interrupted' | 'failed',
    rawTurn: unknown,
    error?: string,
  ) {
    if (state.activeMapper !== mapper) {
      return mapper.turn(status);
    }
    const completed = mapper.complete(status, error);
    for (const itemUpdate of completed.updates) {
      this.emitItemUpdate(state, mapper.turnId, itemUpdate);
    }
    const turn = {
      ...completed.turn,
      startedAt: state.turns.find((candidate) => candidate.providerTurnId === mapper.turnId)?.startedAt ?? null,
      rawTurn,
    };
    this.replaceTurn(state, turn);
    state.activeMapper = null;
    state.status = status === 'completed' ? 'idle' : status;
    state.updatedAt = new Date().toISOString();
    this.emitRuntimeEvent({
      type: 'turn.completed',
      provider: 'acp',
      providerSessionId: state.providerSessionId,
      turn,
    });
    return turn;
  }

  private replaceTurn(state: AcpSessionState, turn: AgentTurn) {
    const index = state.turns.findIndex((candidate) => candidate.providerTurnId === turn.providerTurnId);
    if (index >= 0) {
      state.turns[index] = turn;
    } else {
      state.turns.push(turn);
    }
  }

  private emitItemUpdate(
    state: AcpSessionState,
    providerTurnId: string,
    update: AcpMappedItemUpdate,
  ) {
    this.emitRuntimeEvent({
      type: update.completed ? 'item.completed' : 'item.started',
      provider: 'acp',
      providerSessionId: state.providerSessionId,
      providerTurnId,
      item: update.item,
    });
  }

  private requestPermission(params: acp.RequestPermissionRequest) {
    const id = ++this.permissionSequence;
    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingPermissions.delete(id);
        resolve(cancelledPermission());
      }, 5 * 60 * 1000);
      timer.unref();
      this.pendingPermissions.set(id, { params, resolve, timer });
      this.emit('provider-request', {
        provider: 'acp',
        id,
        method: acp.methods.client.session.requestPermission,
        params,
        rawRequest: params,
      } satisfies AgentProviderRequest);
    });
  }

  private async readTextFile(params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`ACP session workspace not found: ${params.sessionId}`);
    }
    const filePath = await resolveAcpWorkspacePath(session.cwd, params.path);
    this.emit('fs-operation', {
      operation: 'fs.readTextFile',
      sessionId: params.sessionId,
      path: filePath,
    });
    const content = await fs.readFile(filePath, 'utf8');
    if (params.line === undefined && params.limit === undefined) {
      return { content };
    }
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const start = Math.max(0, (params.line ?? 1) - 1);
    const end = params.limit == null ? undefined : start + Math.max(0, params.limit);
    return { content: lines.slice(start, end).join('\n') };
  }

  private async writeTextFile(params: acp.WriteTextFileRequest) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`ACP session workspace not found: ${params.sessionId}`);
    }
    const filePath = await resolveAcpWorkspacePath(session.cwd, params.path);
    this.emit('fs-operation', {
      operation: 'fs.writeTextFile',
      sessionId: params.sessionId,
      path: filePath,
    });
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, params.content, 'utf8');
    return {};
  }

  private async requireContext() {
    await this.start();
    if (!this.context || this.status.state !== 'ready') {
      throw new AgentRuntimeError('ACP agent is not connected.', 'acp', 'client_closed');
    }
    return this.context;
  }

  private applyAgentCapabilities(capabilities: acp.AgentCapabilities | null | undefined) {
    applyNegotiatedAcpCapabilities(this.capabilities, capabilities);
  }

  private resetCapabilities() {
    const baseline = cloneCapabilities();
    for (const section of Object.keys(baseline) as Array<keyof AgentProviderCapabilities>) {
      Object.assign(this.capabilities[section], baseline[section]);
    }
  }

  private goalFromSessionInfoUpdate(
    providerSessionId: string,
    update: Extract<acp.SessionUpdate, { sessionUpdate: 'session_info_update' }>,
  ): AgentGoal | null | undefined {
    const meta = isRecord(update._meta) ? update._meta : null;
    if (!meta || !Object.hasOwn(meta, 'goal')) {
      return undefined;
    }
    if (meta.goal === null) {
      return null;
    }
    if (!isRecord(meta.goal)) {
      return undefined;
    }
    const objective = typeof meta.goal.objective === 'string'
      ? meta.goal.objective.trim()
      : '';
    if (!objective) {
      return undefined;
    }
    return {
      providerSessionId,
      objective,
      status: typeof meta.goal.status === 'string' ? meta.goal.status : 'active',
      tokenBudget: typeof meta.goal.tokenBudget === 'number'
        ? meta.goal.tokenBudget
        : null,
      tokensUsed: typeof meta.goal.tokensUsed === 'number' ? meta.goal.tokensUsed : 0,
      timeUsedSeconds: typeof meta.goal.timeUsedSeconds === 'number'
        ? meta.goal.timeUsedSeconds
        : 0,
      createdAt: typeof meta.goal.createdAt === 'number'
        ? meta.goal.createdAt
        : Date.now(),
      updatedAt: typeof meta.goal.updatedAt === 'number'
        ? meta.goal.updatedAt
        : Date.now(),
      rawGoal: structuredClone(meta.goal),
    };
  }

  private async invokeAcpGoal(
    providerSessionId: string,
    action: { action: 'set'; objective: string } | { action: 'pause' | 'resume' | 'clear' },
  ) {
    if (!this.extensionRegistry.supports('acp.goal', 1, action.action)) {
      throw new AgentRuntimeError(
        'The selected ACP agent does not expose goal control.',
        'acp',
        'request_failed',
      );
    }
    const operationId = randomUUID();
    await this.extensionRegistry.invoke({
      extensionId: 'acp.goal',
      extensionVersion: 1,
      method: action.action,
      operationId,
      idempotencyKey: `${providerSessionId}:goal:${operationId}`,
      params: { providerSessionId, ...action },
      timeoutMs: 180_000,
    });
  }

  private async runControlPrompt(
    providerSessionId: string,
    prompt: string,
    signal: AbortSignal,
  ) {
    const state = this.sessions.get(providerSessionId);
    if (!state || state.activeMapper) {
      throw new AgentRuntimeError(
        'ACP control prompt requires an idle loaded session.',
        'acp',
        'request_failed',
      );
    }
    let startedTurnId: string | null = null;
    let cleanupCompletion!: () => void;
    const completed = new Promise<Extract<AgentRuntimeEvent, { type: 'turn.completed' }>>(
      (resolve, reject) => {
        const cleanup = () => {
          this.off('event', onEvent);
          signal.removeEventListener('abort', onAbort);
        };
        const onEvent = (event: AgentRuntimeEvent) => {
          if (
            event.type === 'turn.completed' &&
            event.providerSessionId === providerSessionId &&
            (!startedTurnId || event.turn.providerTurnId === startedTurnId)
          ) {
            cleanup();
            resolve(event);
          }
        };
        const onAbort = () => {
          cleanup();
          reject(signal.reason ?? new Error('ACP control prompt cancelled.'));
        };
        cleanupCompletion = cleanup;
        this.on('event', onEvent);
        signal.addEventListener('abort', onAbort, { once: true });
      },
    );
    try {
      const turn = await this.startTurn({
        providerSessionId,
        prompt,
        hidden: true,
      });
      startedTurnId = turn.providerTurnId;
      const event = await completed;
      if (event.turn.status === 'failed') {
        throw new Error(event.turn.error?.message ?? 'ACP control prompt failed.');
      }
      return { providerTurnId: event.turn.providerTurnId, status: event.turn.status };
    } catch (error) {
      cleanupCompletion();
      throw error;
    }
  }

  private registerNegotiatedExtensions(response: acp.InitializeResponse) {
    const snapshot = snapshotAcpInitializeResponse(response);
    if (!snapshot || !this.context) {
      return;
    }
    const wireTransport = {
      request: (method: string, params: unknown, signal: AbortSignal) =>
        this.context!.request<unknown, typeof params>(method, params, {
          cancellationSignal: signal,
        }),
    };
    for (const descriptor of snapshot.harnessExtensions) {
      this.extensionRegistry.register({
        ownerId: 'acp-agent',
        descriptor,
        transport: wireTransport,
      });
    }
    if (snapshot.legacyExtensions.steering?.supported) {
      this.extensionRegistry.register({
        ownerId: 'acp-agent',
        descriptor: {
          id: 'acp.steering',
          version: 1,
          stability: 'experimental',
          methods: ['steer'],
          events: [],
        },
        transport: wireTransport,
        wireMethods: { steer: '_session/steering' },
        paramMappers: {
          steer: (envelope) => {
            const params = isRecord(envelope.params) ? envelope.params : {};
            return {
              sessionId: params.providerSessionId,
              prompt: params.prompt,
            };
          },
        },
        capabilityPatch: { turns: { steer: true } },
      });
    }
    const goal = snapshot.legacyExtensions.goal;
    const goalVersion = typeof goal?.version === 'number'
      ? goal.version
      : goal?.version === '1'
        ? 1
        : null;
    if (
      goal?.controlMethod &&
      goalVersion === 1 &&
      goal.actions.includes('set') &&
      goal.actions.includes('clear')
    ) {
      const actions = goal.actions.filter((action) =>
        ['set', 'pause', 'resume', 'clear'].includes(action));
      this.extensionRegistry.register({
        ownerId: 'acp-agent',
          descriptor: {
            id: 'acp.goal',
            version: goalVersion,
          stability: 'experimental',
          methods: actions,
          events: [],
        },
        transport: wireTransport,
        wireMethods: Object.fromEntries(actions.map((action) => [action, goal.controlMethod!])),
        paramMappers: Object.fromEntries(actions.map((action) => [
          action,
          (envelope: HarnessExtensionCallEnvelope) => {
            const params = isRecord(envelope.params) ? envelope.params : {};
            return {
              sessionId: params.providerSessionId,
              action,
              ...(action === 'set' ? { objective: params.objective } : {}),
            };
          },
        ])),
        capabilityPatch: { controls: { goals: true } },
      });
    }
    this.harnessAdapter.registerExtensions?.({
      registry: this.extensionRegistry,
      snapshot,
      runControlPrompt: (providerSessionId, prompt, signal) =>
        this.runControlPrompt(providerSessionId, prompt, signal),
    });
    const effective = this.extensionRegistry.effectiveCapabilities(this.capabilities);
    for (const section of Object.keys(effective) as Array<keyof AgentProviderCapabilities>) {
      Object.assign(this.capabilities[section], effective[section]);
    }
  }

  private withStartupTimeout<T>(promise: Promise<T>) {
    const timeoutMs = this.options.startupTimeoutMs ?? 10_000;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`ACP initialize timed out after ${timeoutMs}ms.`)),
        timeoutMs,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  private markFailed(error: unknown) {
    const message = errorMessage(error);
    this.settleActiveTurns('failed', message);
    this.cancelPendingPermissions();
    this.status = {
      ...this.status,
      state: 'failed',
      lastError: message,
    };
    this.installation.lastError = message;
    this.emit('status', this.getStatus());
  }

  private cancelPendingPermissions() {
    for (const [id, permission] of this.pendingPermissions) {
      clearTimeout(permission.timer);
      permission.resolve(cancelledPermission());
      this.pendingPermissions.delete(id);
    }
  }

  private settleActiveTurns(
    status: 'failed' | 'interrupted',
    error: string,
  ) {
    for (const state of this.sessions.values()) {
      const mapper = state.activeMapper;
      if (!mapper) {
        continue;
      }
      const completed = mapper.complete(status, error);
      for (const itemUpdate of completed.updates) {
        this.emitItemUpdate(state, mapper.turnId, itemUpdate);
      }
      const turn = {
        ...completed.turn,
        startedAt: state.turns.find(
          (candidate) => candidate.providerTurnId === mapper.turnId,
        )?.startedAt ?? null,
      };
      this.replaceTurn(state, turn);
      state.activeMapper = null;
      state.status = status;
      state.updatedAt = new Date().toISOString();
      this.emitRuntimeEvent({
        type: 'turn.completed',
        provider: 'acp',
        providerSessionId: state.providerSessionId,
        turn,
      });
    }
  }

  private emitRuntimeEvent(event: AgentRuntimeEvent) {
    this.emit('event', event);
  }
}
