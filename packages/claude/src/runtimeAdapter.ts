import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';

import {
  getSessionInfo as sdkGetSessionInfo,
  getSessionMessages as sdkGetSessionMessages,
  listSessions as sdkListSessions,
  query as sdkQuery,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  ListSessionsOptions,
  McpServerStatus,
  ModelInfo,
  Options as ClaudeQueryOptions,
  PermissionMode,
  Query,
  SDKMessage,
  SDKSessionInfo,
  SessionMessage,
} from '@anthropic-ai/claude-agent-sdk';

import type {
  AgentHistoryItem,
  AgentMcpServer,
  AgentModel,
  AgentProviderCapabilities,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeManagementSchema,
  AgentRuntimeStatus,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTurn,
  InterruptAgentTurnInput,
  ResumeAgentSessionInput,
  StartAgentSessionInput,
  StartAgentSessionResult,
  StartAgentTurnInput,
} from '../../agent-runtime/src/index';
import { AgentRuntimeError } from '../../agent-runtime/src/index';
import {
  assistantMessageToHistoryItems,
  buildAgentTurn,
  hiddenInitPrompt,
  isHiddenInitMessage,
  messageContentText,
  partialReasoningDelta,
  partialTextDelta,
  resultForToolUse,
  toolUseFromPartialStart,
  toolUseToHistoryItem,
  toolResultBlocks,
  userMessageToHistoryItem,
} from './historyItems';

type ClaudeQueryFunction = typeof sdkQuery;
type ClaudeListSessionsFunction = typeof sdkListSessions;
type ClaudeGetSessionMessagesFunction = typeof sdkGetSessionMessages;
type ClaudeGetSessionInfoFunction = typeof sdkGetSessionInfo;

export interface ClaudeRuntimeAdapterOptions {
  home: string;
  command?: string;
  clientInfo?: {
    name: string;
    title?: string;
    version?: string;
  };
  query?: ClaudeQueryFunction;
  listSessions?: ClaudeListSessionsFunction;
  getSessionMessages?: ClaudeGetSessionMessagesFunction;
  getSessionInfo?: ClaudeGetSessionInfoFunction;
}

interface ActiveClaudeTurn {
  providerSessionId: string;
  providerTurnId: string;
  startedAt: string;
  query: Query;
  items: Map<string, AgentHistoryItem>;
  itemOrder: string[];
  emittedItems: Set<string>;
  currentStreamMessageId: string | null;
  interrupted: boolean;
  completed: boolean;
}

export const claudeCapabilities: AgentProviderCapabilities = {
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
    permissionRequests: false,
    sandboxMode: false,
    performanceMode: false,
    goals: false,
  },
  management: {
    models: true,
    mcpStatus: true,
    skills: false,
    hooks: false,
    hookTrust: false,
    hostConfigFiles: false,
    providerSettings: false,
  },
  usage: {
    contextWindow: false,
    tokenUsage: false,
    costUsd: false,
  },
};

const DEFAULT_CLAUDE_MODELS: AgentModel[] = [
  {
    id: 'sonnet',
    model: 'sonnet',
    displayName: 'Claude Sonnet',
    description: 'Claude Code default Sonnet model alias.',
    isDefault: true,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Low effort' },
      { reasoningEffort: 'medium', description: 'Medium effort' },
      { reasoningEffort: 'high', description: 'High effort' },
      { reasoningEffort: 'xhigh', description: 'Extra high effort' },
    ],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'sonnet-1m',
    model: 'sonnet[1m]',
    displayName: 'Claude Sonnet 1M',
    description: 'Claude Code Sonnet with the 1M token context beta enabled.',
    isDefault: false,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Low effort' },
      { reasoningEffort: 'medium', description: 'Medium effort' },
      { reasoningEffort: 'high', description: 'High effort' },
      { reasoningEffort: 'xhigh', description: 'Extra high effort' },
    ],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'opus',
    model: 'opus',
    displayName: 'Claude Opus',
    description: 'Claude Code Opus model alias.',
    isDefault: false,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Low effort' },
      { reasoningEffort: 'medium', description: 'Medium effort' },
      { reasoningEffort: 'high', description: 'High effort' },
      { reasoningEffort: 'xhigh', description: 'Extra high effort' },
    ],
    defaultReasoningEffort: 'medium',
  },
  {
    id: 'haiku',
    model: 'haiku',
    displayName: 'Claude Haiku',
    description: 'Claude Code Haiku model alias.',
    isDefault: false,
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toIsoFromMs(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return new Date(value).toISOString();
}

function isoFromUuidV7(value: string | null | undefined) {
  const normalized = value?.replace(/-/g, '').trim();
  if (!normalized || normalized.length !== 32 || normalized[12] !== '7') {
    return null;
  }

  const timestampHex = normalized.slice(0, 12);
  const timestamp = Number.parseInt(timestampHex, 16);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function mapModelInfo(model: ModelInfo, index: number): AgentModel {
  return {
    id: model.value,
    model: model.value,
    displayName: model.displayName,
    description: model.description,
    isDefault: index === 0,
    hidden: false,
    supportedReasoningEfforts: (model.supportedEffortLevels ?? []).map((effort) => ({
      reasoningEffort: effort === 'max' ? 'xhigh' : effort,
      description: `${effort} effort`,
    })),
    defaultReasoningEffort: model.supportsEffort ? 'medium' : null,
  };
}

function withClaudeCodeModelAliases(models: AgentModel[]) {
  const output = [...models];
  const defaultSonnet = DEFAULT_CLAUDE_MODELS[0]!;
  const oneMillionSonnet = DEFAULT_CLAUDE_MODELS[1]!;
  const hasSonnetAlias = output.some((model) => model.model === 'sonnet');
  if (!hasSonnetAlias) {
    output.unshift(defaultSonnet);
  }
  if (!output.some((model) => model.model === 'sonnet[1m]')) {
    output.splice(1, 0, oneMillionSonnet);
  }
  return output.map((model, index) => ({
    ...model,
    isDefault: index === 0,
  }));
}

function normalizeClaudeModelForQuery(model: string | null | undefined) {
  return model === 'sonnet[1m]' ? 'sonnet' : model;
}

function shouldEnableOneMillionContext(model: string | null | undefined) {
  return model === 'sonnet[1m]';
}

function displayClaudeModel(
  requestedModel: string | null | undefined,
  runtimeModel: string | null | undefined,
) {
  return shouldEnableOneMillionContext(requestedModel)
    ? requestedModel!
    : runtimeModel ?? requestedModel ?? null;
}

function permissionModeForInput(
  input: Pick<StartAgentSessionInput, 'approvalMode'> & {
    collaborationMode?: StartAgentTurnInput['collaborationMode'];
  },
): { permissionMode: PermissionMode; allowDangerouslySkipPermissions?: boolean } {
  if (input.collaborationMode === 'plan') {
    return { permissionMode: 'plan' };
  }
  if (input.approvalMode === 'yolo') {
    return {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    };
  }
  return { permissionMode: 'dontAsk' };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isHiddenInitSessionText(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return (
    normalized === hiddenInitPrompt().toLowerCase() ||
    normalized === 'initialize remote codex session'
  );
}

function sessionSummaryFromInfo(info: SDKSessionInfo): AgentSessionSummary {
  const firstPrompt = info.firstPrompt && !isHiddenInitSessionText(info.firstPrompt)
    ? info.firstPrompt
    : null;
  const summary = info.summary && !isHiddenInitSessionText(info.summary)
    ? info.summary
    : null;
  return {
    provider: 'claude',
    providerSessionId: info.sessionId,
    cwd: info.cwd ?? '',
    title: info.customTitle ?? summary,
    preview: firstPrompt ?? summary,
    createdAt: toIsoFromMs(info.createdAt),
    updatedAt: toIsoFromMs(info.lastModified),
    status: 'idle',
    rawSession: info,
  };
}

function queryResultStatus(message: SDKMessage): AgentTurn['status'] | null {
  if (message.type !== 'result') {
    return null;
  }
  return message.subtype === 'success' ? 'completed' : 'failed';
}

function queryResultError(message: SDKMessage): string | null {
  if (message.type !== 'result' || message.subtype === 'success') {
    return null;
  }
  return message.errors?.join('\n') || message.stop_reason || 'Claude turn failed.';
}

function assistantMessagePayload(message: SDKMessage) {
  return message.type === 'assistant' ? message.message : null;
}

function messageIdFromPayload(message: unknown) {
  return isRecord(message) && typeof message.id === 'string' && message.id
    ? message.id
    : null;
}

function messageUuid(message: SDKMessage | SessionMessage, fallback: string) {
  return typeof message.uuid === 'string' && message.uuid ? message.uuid : fallback;
}

function streamMessageId(event: unknown) {
  if (!isRecord(event) || event.type !== 'message_start') {
    return null;
  }
  const message = event.message;
  return messageIdFromPayload(message);
}

function addOrUpdateItem(state: ActiveClaudeTurn, item: AgentHistoryItem) {
  if (!state.items.has(item.id)) {
    state.itemOrder.push(item.id);
  }
  state.items.set(item.id, item);
}

function orderedItems(state: ActiveClaudeTurn) {
  return state.itemOrder
    .map((id) => state.items.get(id))
    .filter((item): item is AgentHistoryItem => Boolean(item));
}

function queryOptionsForRuntime(
  input: {
    home: string;
    command: string | undefined;
    clientApp: string;
    cwd?: string | null | undefined;
    model?: string | null | undefined;
    reasoningEffort?: string | null | undefined;
    resume?: string | null | undefined;
    approvalMode: StartAgentSessionInput['approvalMode'];
    collaborationMode?: StartAgentTurnInput['collaborationMode'] | undefined;
    includePartialMessages?: boolean | undefined;
    tools?: ClaudeQueryOptions['tools'] | undefined;
    maxTurns?: number | undefined;
  },
): ClaudeQueryOptions {
  const permission = permissionModeForInput(input);
  const options: ClaudeQueryOptions = {
    includeHookEvents: false,
    permissionMode: permission.permissionMode,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: input.home,
      CLAUDE_HOME: input.home,
      CLAUDE_AGENT_SDK_CLIENT_APP: input.clientApp,
    },
  };
  if (input.cwd) {
    options.cwd = input.cwd;
  }
  if (input.model) {
    const model = normalizeClaudeModelForQuery(input.model);
    if (model) {
      options.model = model;
    }
  }
  if (shouldEnableOneMillionContext(input.model)) {
    options.betas = ['context-1m-2025-08-07'];
  }
  if (input.reasoningEffort) {
    const effort = input.reasoningEffort === 'xhigh' ? 'max' : input.reasoningEffort;
    if (['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) {
      options.effort = effort as NonNullable<ClaudeQueryOptions['effort']>;
    }
  }
  if (input.resume) {
    options.resume = input.resume;
  }
  if (input.includePartialMessages !== undefined) {
    options.includePartialMessages = input.includePartialMessages;
  }
  if (input.maxTurns !== undefined) {
    options.maxTurns = input.maxTurns;
  }
  if (input.tools !== undefined) {
    options.tools = input.tools;
  }
  if (permission.allowDangerouslySkipPermissions) {
    options.allowDangerouslySkipPermissions = true;
  }
  options.pathToClaudeCodeExecutable = input.command?.trim() || 'claude';
  return options;
}

export class ClaudeRuntimeAdapter extends EventEmitter implements AgentRuntime {
  readonly provider = 'claude' as const;
  readonly displayName = 'Claude';
  readonly description = 'Local Claude Code Agent SDK runtime.';
  readonly capabilities = claudeCapabilities;
  readonly managementSchema: AgentRuntimeManagementSchema = {
    hostConfigFiles: [],
    toolboxItems: [
      { action: 'mcp', command: '/mcp', label: 'MCP', panel: 'mcp' },
    ],
    hookCommandTemplates: [],
    providerConfigFormat: 'none',
    mcpConfigFormat: 'none',
    configArchives: false,
    buildRestart: false,
  };

  private status: AgentRuntimeStatus = {
    state: 'stopped',
    transport: 'sdk',
    lastStartedAt: null,
    lastError: null,
    restartCount: 0,
  };
  private readonly queryFactory: ClaudeQueryFunction;
  private readonly listSessionsFn: ClaudeListSessionsFunction;
  private readonly getSessionMessagesFn: ClaudeGetSessionMessagesFunction;
  private readonly getSessionInfoFn: ClaudeGetSessionInfoFunction;
  private readonly activeTurns = new Map<string, ActiveClaudeTurn>();
  private readonly knownSessionIds = new Set<string>();
  private readonly sessionCwds = new Map<string, string>();
  private readonly sessionModels = new Map<string, string | null>();
  private readonly sessionApprovalModes = new Map<string, StartAgentSessionInput['approvalMode']>();
  private readonly clientApp: string;

  constructor(private readonly options: ClaudeRuntimeAdapterOptions) {
    super();
    this.queryFactory = options.query ?? sdkQuery;
    this.listSessionsFn = options.listSessions ?? sdkListSessions;
    this.getSessionMessagesFn = options.getSessionMessages ?? sdkGetSessionMessages;
    this.getSessionInfoFn = options.getSessionInfo ?? sdkGetSessionInfo;
    this.clientApp = [
      options.clientInfo?.name ?? 'remote-codex-supervisor',
      options.clientInfo?.version,
    ].filter(Boolean).join('/');
  }

  getStatus(): AgentRuntimeStatus {
    return { ...this.status };
  }

  async start() {
    await fs.mkdir(this.options.home, { recursive: true });
    this.status = {
      ...this.status,
      state: 'ready',
      lastStartedAt: new Date().toISOString(),
      lastError: null,
      restartCount: this.status.state === 'stopped' ? this.status.restartCount : this.status.restartCount + 1,
    };
    this.emit('status', this.getStatus());
  }

  async stop() {
    for (const state of this.activeTurns.values()) {
      state.interrupted = true;
      state.query.close();
    }
    this.activeTurns.clear();
    this.status = {
      ...this.status,
      state: 'stopped',
      lastError: null,
    };
    this.emit('status', this.getStatus());
  }

  async listModels(): Promise<AgentModel[]> {
    const active = [...this.activeTurns.values()][0];
    if (!active) {
      return DEFAULT_CLAUDE_MODELS;
    }

    try {
      const models = await active.query.supportedModels();
      return withClaudeCodeModelAliases(models.map(mapModelInfo));
    } catch {
      return DEFAULT_CLAUDE_MODELS;
    }
  }

  async listSessions(): Promise<AgentSessionSummary[]> {
    const sessions = await this.withClaudeConfigEnv(() => this.listSessionsFn({} as ListSessionsOptions));
    return sessions.map((session) => {
      this.knownSessionIds.add(session.sessionId);
      return sessionSummaryFromInfo(session);
    });
  }

  async listLoadedSessions(): Promise<string[]> {
    for (const state of this.activeTurns.values()) {
      this.knownSessionIds.add(state.providerSessionId);
    }
    try {
      const sessions = await this.listSessions();
      for (const session of sessions) {
        this.knownSessionIds.add(session.providerSessionId);
      }
    } catch {
      // Keep in-memory known sessions if Claude's local history cannot be read.
    }
    return [...this.knownSessionIds];
  }

  async readSession(
    providerSessionId: string,
    _options: { limit?: number; beforeTurnId?: string | null } = {},
  ): Promise<AgentSessionDetail> {
    const [info, messages] = await this.withClaudeConfigEnv(async () => Promise.all([
      this.getSessionInfoFn(providerSessionId, {} as GetSessionInfoOptions),
      this.getSessionMessagesFn(providerSessionId, {
        includeSystemMessages: true,
      } as GetSessionMessagesOptions),
    ]));
    this.knownSessionIds.add(providerSessionId);
    const summary = info
      ? sessionSummaryFromInfo(info)
      : {
          provider: 'claude' as const,
          providerSessionId,
          cwd: this.sessionCwds.get(providerSessionId) ?? '',
          title: null,
          preview: null,
          createdAt: null,
          updatedAt: null,
          status: 'idle' as const,
          rawSession: null,
        };

    return {
      ...summary,
      cwd: summary.cwd || this.sessionCwds.get(providerSessionId) || '',
      turns: this.sessionMessagesToTurns(messages),
    };
  }

  async startSession(input: StartAgentSessionInput): Promise<StartAgentSessionResult> {
    await fs.mkdir(this.options.home, { recursive: true });
    const query = this.queryFactory({
      prompt: hiddenInitPrompt(),
      options: queryOptionsForRuntime({
        home: this.options.home,
        command: this.options.command,
        clientApp: this.clientApp,
        cwd: input.cwd,
        model: input.model,
        approvalMode: input.approvalMode,
        includePartialMessages: false,
        tools: [],
        maxTurns: 1,
      }),
    });

    let providerSessionId: string | null = null;
    let model: string | null = input.model;
    const rawMessages: SDKMessage[] = [];
    try {
      for await (const message of query) {
        rawMessages.push(message);
        if (message.type === 'system' && message.subtype === 'init') {
          providerSessionId = message.session_id;
          model = displayClaudeModel(input.model, message.model ?? model);
          this.sessionCwds.set(providerSessionId, message.cwd);
        } else if ('session_id' in message && typeof message.session_id === 'string') {
          providerSessionId ??= message.session_id;
        }
      }
    } catch (error) {
      this.markFailed(error);
      throw new AgentRuntimeError(errorMessage(error), 'claude', 'request_failed', undefined, error);
    } finally {
      query.close();
    }

    if (!providerSessionId) {
      throw new AgentRuntimeError(
        'Claude did not return a session id during initialization.',
        'claude',
        'invalid_response',
      );
    }

    this.sessionCwds.set(providerSessionId, input.cwd);
    this.knownSessionIds.add(providerSessionId);
    this.sessionModels.set(providerSessionId, displayClaudeModel(input.model, model));
    this.sessionApprovalModes.set(providerSessionId, input.approvalMode);
    const session: AgentSessionDetail = {
      provider: 'claude',
      providerSessionId,
      cwd: input.cwd,
      title: null,
      preview: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'idle',
      turns: [],
      rawSession: rawMessages,
    };
    return {
      provider: 'claude',
      providerSessionId,
      model: displayClaudeModel(input.model, model),
      reasoningEffort: null,
      sandboxMode: input.sandboxMode ?? null,
      session,
      rawSession: rawMessages,
    };
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<StartAgentSessionResult> {
    const session = await this.readSession(input.providerSessionId);
    this.knownSessionIds.add(input.providerSessionId);
    if (input.model !== undefined) {
      this.sessionModels.set(input.providerSessionId, displayClaudeModel(input.model, input.model));
    }
    return {
      provider: 'claude',
      providerSessionId: input.providerSessionId,
      model: displayClaudeModel(
        input.model,
        input.model ?? this.sessionModels.get(input.providerSessionId) ?? null,
      ),
      reasoningEffort: null,
      sandboxMode: input.sandboxMode ?? null,
      session,
      rawSession: session.rawSession,
    };
  }

  async startTurn(input: StartAgentTurnInput): Promise<AgentTurn> {
    const providerTurnId = randomUUID();
    const startedAt = new Date().toISOString();
    const cwd = input.workspacePath ?? this.sessionCwds.get(input.providerSessionId) ?? undefined;
    const approvalMode = this.sessionApprovalModes.get(input.providerSessionId) ?? 'guarded';
    const query = this.queryFactory({
      prompt: input.prompt,
      options: queryOptionsForRuntime({
        home: this.options.home,
        command: this.options.command,
        clientApp: this.clientApp,
        cwd,
        model: input.model ?? this.sessionModels.get(input.providerSessionId) ?? undefined,
        reasoningEffort: input.reasoningEffort,
        resume: input.providerSessionId,
        approvalMode,
        collaborationMode: input.collaborationMode,
        includePartialMessages: true,
        tools: { type: 'preset', preset: 'claude_code' },
      }),
    });
    const userItem = userMessageToHistoryItem(`${providerTurnId}:user`, {
      content: input.prompt,
    });
    const state: ActiveClaudeTurn = {
      providerSessionId: input.providerSessionId,
      providerTurnId,
      startedAt,
      query,
      items: new Map([[userItem.id, userItem]]),
      itemOrder: [userItem.id],
      emittedItems: new Set(),
      currentStreamMessageId: null,
      interrupted: false,
      completed: false,
    };
    this.knownSessionIds.add(input.providerSessionId);
    this.activeTurns.set(providerTurnId, state);
    this.emitRuntimeEvent({
      type: 'turn.started',
      provider: 'claude',
      providerSessionId: input.providerSessionId,
            turn: buildAgentTurn({
              providerTurnId,
              startedAt,
              status: 'inProgress',
              items: [userItem],
      }),
    });
    void this.consumeQuery(state);
    return buildAgentTurn({
      providerTurnId,
      startedAt,
      status: 'inProgress',
      items: [userItem],
    });
  }

  async interruptTurn(input: InterruptAgentTurnInput): Promise<AgentTurn | null> {
    const state =
      this.activeTurns.get(input.providerTurnId) ??
      [...this.activeTurns.values()].find(
        (entry) => entry.providerSessionId === input.providerSessionId,
      ) ??
      null;
    if (!state) {
      return null;
    }

    state.interrupted = true;
    try {
      await state.query.interrupt();
    } catch {
      // Some SDK query modes cannot interrupt; close still terminates the child process.
    }
    state.query.close();
    state.completed = true;
    this.activeTurns.delete(state.providerTurnId);
    this.knownSessionIds.add(state.providerSessionId);
    return buildAgentTurn({
      providerTurnId: state.providerTurnId,
      startedAt: state.startedAt,
      status: 'interrupted',
      items: orderedItems(state),
    });
  }

  async listMcpServers(): Promise<AgentMcpServer[]> {
    const active = [...this.activeTurns.values()][0];
    if (!active) {
      return [];
    }
    const servers = await active.query.mcpServerStatus();
    return servers.map((server) => this.mapMcpServer(server));
  }

  private async consumeQuery(state: ActiveClaudeTurn) {
    const rawMessages: SDKMessage[] = [];
    try {
      for await (const message of state.query) {
        rawMessages.push(message);
        if (state.completed) {
          continue;
        }
        this.consumeMessage(state, message);
        const status = queryResultStatus(message);
        if (status) {
          state.completed = true;
          this.activeTurns.delete(state.providerTurnId);
          this.emitRuntimeEvent({
            type: 'turn.completed',
            provider: 'claude',
            providerSessionId: state.providerSessionId,
            turn: buildAgentTurn({
              providerTurnId: state.providerTurnId,
              startedAt: state.startedAt,
              status: state.interrupted ? 'interrupted' : status,
              error: queryResultError(message),
              items: orderedItems(state),
              rawTurn: rawMessages,
            }),
          });
        }
      }

      if (!state.completed) {
        state.completed = true;
        this.activeTurns.delete(state.providerTurnId);
        this.emitRuntimeEvent({
          type: 'turn.completed',
          provider: 'claude',
          providerSessionId: state.providerSessionId,
          turn: buildAgentTurn({
            providerTurnId: state.providerTurnId,
            startedAt: state.startedAt,
            status: state.interrupted ? 'interrupted' : 'completed',
            items: orderedItems(state),
            rawTurn: rawMessages,
          }),
        });
      }
    } catch (error) {
      this.activeTurns.delete(state.providerTurnId);
      if (state.interrupted) {
        return;
      }
      this.emitRuntimeEvent({
        type: 'turn.failed',
        provider: 'claude',
        providerSessionId: state.providerSessionId,
        providerTurnId: state.providerTurnId,
        error: errorMessage(error),
      });
    }
  }

  private consumeMessage(state: ActiveClaudeTurn, message: SDKMessage) {
    if (message.type === 'system' && message.subtype === 'init') {
      this.sessionCwds.set(message.session_id, message.cwd);
      this.sessionModels.set(message.session_id, message.model);
      return;
    }

    if (message.type === 'stream_event') {
      const nextStreamMessageId = streamMessageId(message.event);
      if (nextStreamMessageId) {
        state.currentStreamMessageId = nextStreamMessageId;
      }
      const activeMessageId = state.currentStreamMessageId ?? messageUuid(message, state.providerTurnId);
      const toolItem = toolUseFromPartialStart({
        messageId: activeMessageId,
        event: message.event,
      });
      if (toolItem) {
        addOrUpdateItem(state, toolItem);
        this.emitItem(state, toolItem, 'item.started');
        return;
      }

      const reasoningItem = partialReasoningDelta({
        messageId: activeMessageId,
        event: message.event,
      });
      if (reasoningItem) {
        const existing = state.items.get(reasoningItem.id);
        const nextItem: AgentHistoryItem = existing?.kind === 'reasoning'
          ? {
              ...existing,
              text: `${existing.text}${reasoningItem.text}`,
              status: reasoningItem.status ?? existing.status ?? null,
            }
          : reasoningItem;
        addOrUpdateItem(state, nextItem);
        this.emitItem(state, nextItem, existing ? 'item.completed' : 'item.started', {
          force: Boolean(existing),
        });
        return;
      }

      const delta = partialTextDelta({
        messageId: activeMessageId,
        event: message.event,
      });
      if (delta) {
        const existing = state.items.get(delta.itemId);
        const nextItem: AgentHistoryItem = existing?.kind === 'agentMessage'
          ? {
              ...existing,
              text: `${existing.text}${delta.delta}`,
            }
          : {
              id: delta.itemId,
              kind: 'agentMessage',
              text: delta.delta,
            };
        addOrUpdateItem(state, nextItem);
        this.emitRuntimeEvent({
          type: 'output.delta',
          provider: 'claude',
          providerSessionId: state.providerSessionId,
          providerTurnId: state.providerTurnId,
          itemId: delta.itemId,
          delta: delta.delta,
        });
      }
      return;
    }

    if (message.type === 'user') {
      const toolResults = toolResultBlocks(message.message);
      if (toolResults.length > 0) {
        for (const toolResult of toolResults) {
          const item = resultForToolUse({
            toolUseId: toolResult.toolUseId,
            result: message.tool_use_result ?? toolResult.result,
            previous: state.items.get(toolResult.toolUseId) ?? null,
          });
          addOrUpdateItem(state, item);
          this.emitItem(state, item, 'item.completed');
        }
        return;
      }
    }

    if (message.type === 'assistant') {
      const payload = assistantMessagePayload(message);
      const assistantMessageId = messageIdFromPayload(payload) ?? messageUuid(message, state.providerTurnId);
      for (const item of assistantMessageToHistoryItems({
        messageId: assistantMessageId,
        message: payload,
      })) {
        const existing = state.items.get(item.id);
        addOrUpdateItem(state, item);
        if (item.kind !== 'agentMessage' && !existing) {
          this.emitItem(state, item, 'item.started');
        } else if (item.kind !== 'agentMessage' && existing) {
          this.emitItem(state, item, 'item.started', { force: true });
        }
      }
      return;
    }

    if (message.type === 'user' && message.parent_tool_use_id) {
      const item = resultForToolUse({
        toolUseId: message.parent_tool_use_id,
        result: message.tool_use_result ?? message.message,
        previous: state.items.get(message.parent_tool_use_id) ?? null,
      });
      addOrUpdateItem(state, item);
      this.emitItem(state, item, 'item.completed');
      return;
    }

    if (message.type === 'tool_progress') {
      if (!state.items.has(message.tool_use_id)) {
        const item = toolUseToHistoryItem({
          id: message.tool_use_id,
          name: message.tool_name,
          toolInput: {
            elapsed_time_seconds: message.elapsed_time_seconds,
          },
          status: 'running',
        });
        addOrUpdateItem(state, item);
        this.emitItem(state, item, 'item.started');
      }
      return;
    }

    if (message.type === 'system' && message.subtype === 'permission_denied') {
      const previous = state.items.get(message.tool_use_id);
      const item: AgentHistoryItem = previous
        ? {
            ...previous,
            status: 'denied',
            detailText: [previous.detailText ?? previous.text, '', message.message].join('\n'),
          }
        : {
            id: message.tool_use_id,
            kind: 'toolCall',
            text: `${message.tool_name} denied`,
            detailText: message.message,
            status: 'denied',
          };
      addOrUpdateItem(state, item);
      this.emitItem(state, item, 'item.completed');
    }
  }

  private emitItem(
    state: ActiveClaudeTurn,
    item: AgentHistoryItem,
    type: 'item.started' | 'item.completed',
    options: { force?: boolean } = {},
  ) {
    if (type === 'item.started') {
      if (state.emittedItems.has(item.id) && !options.force) {
        return;
      }
      state.emittedItems.add(item.id);
    }
    this.emitRuntimeEvent({
      type,
      provider: 'claude',
      providerSessionId: state.providerSessionId,
      providerTurnId: state.providerTurnId,
      item,
    });
  }

  private emitRuntimeEvent(event: AgentRuntimeEvent) {
    this.emit('event', event);
  }

  private mapMcpServer(server: McpServerStatus): AgentMcpServer {
    return {
      name: server.name,
      authStatus: server.status === 'needs-auth' ? 'notLoggedIn' : 'unsupported',
      tools: (server.tools ?? []).map((tool) => ({
        name: tool.name,
        title: tool.name,
        description: tool.description ?? null,
      })),
      resourceCount: 0,
      resourceTemplateCount: 0,
    };
  }

  private sessionMessagesToTurns(messages: SessionMessage[]): AgentTurn[] {
    const turns: AgentTurn[] = [];
    let current: {
      providerTurnId: string;
      startedAt: string | null;
      items: AgentHistoryItem[];
      itemsById: Map<string, AgentHistoryItem>;
    } | null = null;
    let skippingHiddenInit = false;

    const upsertCurrentItem = (item: AgentHistoryItem) => {
      if (!current) {
        current = {
          providerTurnId: randomUUID(),
          startedAt: null,
          items: [],
          itemsById: new Map(),
        };
      }
      const existingIndex = current.items.findIndex((entry) => entry.id === item.id);
      if (existingIndex >= 0) {
        current.items[existingIndex] = item;
      } else {
        current.items.push(item);
      }
      current.itemsById.set(item.id, item);
    };

    for (const message of messages) {
      if (message.type === 'user') {
        const toolResults = toolResultBlocks(message.message);
        if (toolResults.length > 0) {
          for (const toolResult of toolResults) {
            const previous = current?.itemsById.get(toolResult.toolUseId) ?? null;
            upsertCurrentItem(resultForToolUse({
              toolUseId: toolResult.toolUseId,
              result: toolResult.result,
              previous,
            }));
          }
          continue;
        }
      }

      if (message.type === 'user' && !message.parent_tool_use_id) {
        if (isHiddenInitMessage(message.message)) {
          skippingHiddenInit = true;
          current = null;
          continue;
        }
        skippingHiddenInit = false;
        if (current && current.items.length > 0) {
          turns.push(buildAgentTurn({
            providerTurnId: current.providerTurnId,
            startedAt: current.startedAt,
            status: 'completed',
            items: current.items,
          }));
        }
        const userItem = userMessageToHistoryItem(message.uuid, message.message);
        current = {
          providerTurnId: `claude-turn-${message.uuid}`,
          startedAt: isoFromUuidV7(message.uuid),
          items: [userItem],
          itemsById: new Map([[message.uuid, userItem]]),
        };
        continue;
      }

      if (skippingHiddenInit && message.type === 'assistant') {
        continue;
      }

      if (message.type === 'assistant') {
        for (const item of assistantMessageToHistoryItems({
          messageId: message.uuid,
          message: message.message,
        })) {
          upsertCurrentItem(item);
        }
        continue;
      }

      if (message.type === 'user' && message.parent_tool_use_id) {
        const previous = current?.itemsById.get(message.parent_tool_use_id) ?? null;
        upsertCurrentItem(resultForToolUse({
          toolUseId: message.parent_tool_use_id,
          result: isRecord(message.message) && 'content' in message.message
            ? message.message.content
            : message.message,
          previous,
        }));
      }
    }

    if (current && current.items.length > 0) {
      turns.push(buildAgentTurn({
        providerTurnId: current.providerTurnId,
        startedAt: current.startedAt,
        status: 'completed',
        items: current.items,
      }));
    }
    return turns;
  }

  private async withClaudeConfigEnv<T>(callback: () => Promise<T>): Promise<T> {
    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const previousClaudeHome = process.env.CLAUDE_HOME;
    process.env.CLAUDE_CONFIG_DIR = this.options.home;
    process.env.CLAUDE_HOME = this.options.home;
    try {
      return await callback();
    } finally {
      if (previousConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
      if (previousClaudeHome === undefined) {
        delete process.env.CLAUDE_HOME;
      } else {
        process.env.CLAUDE_HOME = previousClaudeHome;
      }
    }
  }

  private markFailed(error: unknown) {
    this.status = {
      ...this.status,
      state: 'failed',
      lastError: errorMessage(error),
    };
    this.emit('status', this.getStatus());
  }
}
