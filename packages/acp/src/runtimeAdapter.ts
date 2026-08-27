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
  type AgentSessionSummary,
  type AgentTurn,
  type InterruptAgentTurnInput,
  type ResumeAgentSessionInput,
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
import { AcpTerminalService } from './terminal-service';

interface AcpRuntimeOptions {
  command: string;
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
  availableCommands: acp.AvailableCommand[];
}

interface PendingPermission {
  params: acp.RequestPermissionRequest;
  resolve: (response: acp.RequestPermissionResponse) => void;
  timer: NodeJS.Timeout;
}

const acpCapabilities: AgentProviderCapabilities = {
  sessions: {
    list: true,
    read: true,
    resume: true,
    importLocal: false,
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
  return options.find((option) =>
    option.category === category ||
    hints.some((hint) => option.id.toLowerCase().includes(hint)),
  ) ?? null;
}

function normalizeAcpEffort(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'max':
    case 'ultra':
      return normalized;
    case 'xhigh':
    case 'extra_high':
      return 'xhigh';
    default:
      return null;
  }
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

function sessionDetail(state: AcpSessionState): AgentSessionDetail {
  return {
    provider: 'acp',
    providerSessionId: state.providerSessionId,
    cwd: state.cwd,
    title: state.title,
    preview: state.turns.at(-1)?.items.findLast((item) => item.kind === 'agentMessage')?.text ?? null,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    status: state.status,
    turns: state.turns,
    totalTurnCount: state.turns.length,
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
  private readonly terminalService: AcpTerminalService;
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
    this.terminalService = new AcpTerminalService(
      (sessionId) => this.sessions.get(sessionId)?.cwd ?? null,
    );
  }

  getStatus() {
    return { ...this.status };
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
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
          session: {
            compaction: {},
            configOptions: { boolean: {} },
          },
          plan: {},
        },
        clientInfo: {
          name: this.options.clientInfo?.name ?? 'remote-codex-supervisor',
          version: this.options.clientInfo?.version ?? '0.1.0',
          ...(this.options.clientInfo?.title ? { title: this.options.clientInfo.title } : {}),
        },
      }) as Promise<acp.InitializeResponse>;
      const initializeResponse = await this.withStartupTimeout(initialize);
      this.initializeResponse = initializeResponse;
      this.applyAgentCapabilities(initializeResponse.agentCapabilities);
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
    for (const [id, permission] of this.pendingPermissions) {
      clearTimeout(permission.timer);
      permission.resolve(cancelledPermission());
      this.pendingPermissions.delete(id);
    }
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
    const response = await context.request(acp.methods.agent.session.new, {
      cwd: path.resolve(cwd),
      mcpServers: [],
      _meta: { yoloMode: false, remoteCodexCapabilityProbe: true },
    });
    let configOptions = response.configOptions ?? [];
    try {
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
          supportedReasoningEfforts: reasoning.efforts,
          defaultReasoningEffort: reasoning.defaultEffort,
          selectionKind: 'model',
        });
      }
      return models;
    } finally {
      if (this.initializeResponse?.agentCapabilities?.sessionCapabilities?.close) {
        await context.request(acp.methods.agent.session.close, {
          sessionId: response.sessionId,
        }).catch(() => undefined);
      }
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

  async readSession(
    providerSessionId: string,
  ): Promise<AgentSessionDetail> {
    const state = this.sessions.get(providerSessionId);
    if (state) {
      return sessionDetail(state);
    }
    throw new AgentRuntimeError(
      'ACP session history is owned by the Remote Codex supervisor and is not materialized in this runtime process.',
      'acp',
      'request_failed',
      { historyUnavailable: true, providerSessionId },
    );
  }

  async startSession(input: StartAgentSessionInput): Promise<StartAgentSessionResult> {
    const context = await this.requireContext();
    const response = await context.request(acp.methods.agent.session.new, {
      cwd: path.resolve(input.cwd),
      mcpServers: [],
      _meta: {
        yoloMode: input.approvalMode === 'yolo',
      },
    });
    const now = new Date().toISOString();
    const state: AcpSessionState = {
      providerSessionId: response.sessionId,
      cwd: path.resolve(input.cwd),
      title: null,
      createdAt: now,
      updatedAt: now,
      model: input.model === 'default' ? null : input.model,
      reasoningEffort: input.reasoningEffort ?? null,
      sandboxMode: input.sandboxMode ?? null,
      status: 'idle',
      turns: [],
      activeMapper: null,
      modes: response.modes ?? null,
      configOptions: response.configOptions ?? [],
      availableCommands: [],
    };
    this.sessions.set(state.providerSessionId, state);
    this.knownSessions.set(state.providerSessionId, sessionDetail(state));
    await this.applySessionSettings(state, input.model, input.reasoningEffort, input.sandboxMode);
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
    await this.applySessionSettings(state, input.model, undefined, input.sandboxMode);
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
    );

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

    const prompt = input.developerInstructions?.trim()
      ? `${input.developerInstructions.trim()}\n\n${input.prompt}`
      : input.prompt;
    const context = await this.requireContext();
    void context.request(acp.methods.agent.session.prompt, {
      sessionId: state.providerSessionId,
      prompt: [{ type: 'text', text: prompt }],
    }).then(
      (response) => this.completePrompt(state, mapper, response),
      (error) => this.failPrompt(state, mapper, error),
    );
    return startedTurn;
  }

  async interruptTurn(input: InterruptAgentTurnInput): Promise<AgentTurn | null> {
    const state = this.sessions.get(input.providerSessionId);
    if (!state?.activeMapper || state.activeMapper.turnId !== input.providerTurnId) {
      return null;
    }
    const context = await this.requireContext();
    await context.notify(acp.methods.agent.session.cancel, {
      sessionId: input.providerSessionId,
    });
    return state.activeMapper.turn('interrupted');
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
      availableCommands: [],
    };
    this.sessions.set(providerSessionId, state);
    try {
      const capabilities = this.initializeResponse?.agentCapabilities;
      if (capabilities?.loadSession) {
        const response = await context.request(acp.methods.agent.session.load, {
          sessionId: providerSessionId,
          cwd: summary.cwd,
          mcpServers: [],
        });
        state.modes = response.modes ?? null;
        state.configOptions = response.configOptions ?? [];
      } else if (capabilities?.sessionCapabilities?.resume) {
        const response = await context.request(acp.methods.agent.session.resume, {
          sessionId: providerSessionId,
          cwd: summary.cwd,
          mcpServers: [],
        });
        state.modes = response.modes ?? null;
        state.configOptions = response.configOptions ?? [];
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
  ) {
    if (model && model !== 'default') {
      await this.setConfigOption(state, 'model', model);
      state.model = model;
    }
    if (reasoningEffort) {
      await this.setConfigOption(state, 'thought_level', reasoningEffort);
      state.reasoningEffort = reasoningEffort;
    }
    if (sandboxMode !== undefined) {
      state.sandboxMode = sandboxMode;
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
    const option = state.configOptions.find((candidate) =>
      candidate.category === category || candidate.id.toLowerCase().includes(category === 'model' ? 'model' : 'thought'),
    );
    if ((!option || option.type !== 'select') && category === 'model') {
      const context = await this.requireContext();
      await context.request('session/set_model', {
        sessionId: state.providerSessionId,
        modelId: value,
      });
      return;
    }
    if (!option || option.type !== 'select') {
      return;
    }
    const selected = allSelectOptions(option).find((candidate) =>
      candidate.value === value || candidate.name.toLowerCase() === value.toLowerCase(),
    );
    if (!selected || selected.value === option.currentValue) {
      return;
    }
    const context = await this.requireContext();
    const response = await context.request(acp.methods.agent.session.setConfigOption, {
      sessionId: state.providerSessionId,
      configId: option.id,
      value: selected.value,
    });
    state.configOptions = response.configOptions;
  }

  private handleSessionUpdate(notification: acp.SessionNotification) {
    const state = this.sessions.get(notification.sessionId);
    if (!state) {
      return;
    }
    state.updatedAt = new Date().toISOString();
    const update = notification.update;
    if (update.sessionUpdate === 'config_option_update') {
      state.configOptions = update.configOptions;
    } else if (update.sessionUpdate === 'current_mode_update' && state.modes) {
      state.modes = { ...state.modes, currentModeId: update.currentModeId };
    } else if (update.sessionUpdate === 'available_commands_update') {
      state.availableCommands = update.availableCommands;
    } else if (update.sessionUpdate === 'session_info_update') {
      if (update.title !== undefined) {
        state.title = update.title;
        if (update.title) {
          this.emitRuntimeEvent({
            type: 'session.title.updated',
            provider: 'acp',
            providerSessionId: state.providerSessionId,
            title: update.title,
          });
        }
      }
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
    const completed = mapper.complete(status);
    for (const itemUpdate of completed.updates) {
      this.emitItemUpdate(state, mapper.turnId, itemUpdate);
    }
    const turn = {
      ...completed.turn,
      startedAt: state.turns.find((candidate) => candidate.providerTurnId === mapper.turnId)?.startedAt ?? null,
      rawTurn: response,
    };
    this.replaceTurn(state, turn);
    state.activeMapper = null;
    state.status = status === 'interrupted' ? 'interrupted' : 'idle';
    state.updatedAt = new Date().toISOString();
    this.emitRuntimeEvent({
      type: 'turn.completed',
      provider: 'acp',
      providerSessionId: state.providerSessionId,
      turn,
    });
  }

  private failPrompt(state: AcpSessionState, mapper: AcpTurnItemMapper, error: unknown) {
    if (state.activeMapper !== mapper) {
      return;
    }
    const message = errorMessage(error);
    const completed = mapper.complete('failed', message);
    for (const itemUpdate of completed.updates) {
      this.emitItemUpdate(state, mapper.turnId, itemUpdate);
    }
    const turn = {
      ...completed.turn,
      startedAt: state.turns.find((candidate) => candidate.providerTurnId === mapper.turnId)?.startedAt ?? null,
      rawTurn: error,
    };
    this.replaceTurn(state, turn);
    state.activeMapper = null;
    state.status = 'failed';
    state.updatedAt = new Date().toISOString();
    this.emitRuntimeEvent({
      type: 'turn.completed',
      provider: 'acp',
      providerSessionId: state.providerSessionId,
      turn,
    });
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
    if (!path.isAbsolute(params.path)) {
      throw new Error('ACP file paths must be absolute.');
    }
    const content = await fs.readFile(params.path, 'utf8');
    if (params.line === undefined && params.limit === undefined) {
      return { content };
    }
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const start = Math.max(0, (params.line ?? 1) - 1);
    const end = params.limit == null ? undefined : start + Math.max(0, params.limit);
    return { content: lines.slice(start, end).join('\n') };
  }

  private async writeTextFile(params: acp.WriteTextFileRequest) {
    if (!path.isAbsolute(params.path)) {
      throw new Error('ACP file paths must be absolute.');
    }
    await fs.mkdir(path.dirname(params.path), { recursive: true });
    await fs.writeFile(params.path, params.content, 'utf8');
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
    this.capabilities.sessions.list = Boolean(capabilities?.sessionCapabilities?.list);
    // Imported ACP sessions have no supervisor-owned item history yet. Keep
    // import disabled until replayed updates can be assigned stable turn ids.
    this.capabilities.sessions.importLocal = false;
    this.capabilities.branching.fork = false;
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
    this.status = {
      ...this.status,
      state: 'failed',
      lastError: message,
    };
    this.installation.lastError = message;
    this.emit('status', this.getStatus());
  }

  private emitRuntimeEvent(event: AgentRuntimeEvent) {
    this.emit('event', event);
  }
}
