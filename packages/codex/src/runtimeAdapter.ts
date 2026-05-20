import { EventEmitter } from 'node:events';

import type {
  AgentModel,
  AgentGoal,
  AgentProviderCapabilities,
  AgentProviderNotification,
  AgentProviderRequest,
  AgentPendingProviderRequest,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentRuntimeManagementSchema,
  AgentRuntimeStatus,
  AgentSessionDetail,
  AgentSessionStatus,
  AgentSessionSummary,
  AgentTurn,
  InterruptAgentTurnInput,
  ResumeAgentSessionInput,
  SendAgentInputInput,
  SetAgentGoalInput,
  StartAgentSessionInput,
  StartAgentSessionResult,
  StartAgentTurnInput,
} from '../../agent-runtime/src/index';
import {
  buildCodexProviderRequestResponse,
  mapCodexProviderRequest,
} from './requestMapper';
import {
  codexHookRunToHistoryItem,
} from './hookHistory';
import {
  codexTurnToAgentTurn,
  liveCodexItemToHistoryItem,
} from './historyItems';
import { AgentRuntimeError } from '../../agent-runtime/src/index';
import {
  AppServerStatusSnapshot,
  CodexAppServerManager,
  CodexThreadRecord,
  CodexThreadStatus,
  CodexThreadGoalRecord,
  CodexTurnRecord,
  CodexTurnItem,
  CodexServerEvent,
  ReasoningEffort,
  SandboxPolicy,
  SandboxMode,
  ThreadResumeInput,
  ThreadStartInput,
  TurnStartInput,
  JsonRpcClientError,
} from './index';

export const codexCapabilities: AgentProviderCapabilities = {
  sessions: {
    list: true,
    read: true,
    resume: true,
    importLocal: true,
  },
  turns: {
    start: true,
    streamInput: false,
    steer: true,
    interrupt: true,
    compact: true,
  },
  branching: {
    fork: true,
    hardRollback: true,
    resumeAt: false,
    rewindFiles: false,
  },
  controls: {
    planMode: true,
    permissionRequests: true,
    sandboxMode: true,
    fastServiceTier: true,
    goals: true,
  },
  management: {
    models: true,
    mcpStatus: true,
    skills: true,
    hooks: true,
    hookTrust: true,
    hostConfigFiles: true,
    providerSettings: false,
  },
  usage: {
    contextWindow: true,
    tokenUsage: true,
    costUsd: false,
  },
};

function toIsoFromEpoch(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const epochMs = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(epochMs).toISOString();
}

function normalizeStatus(status: CodexThreadStatus): AgentSessionStatus {
  switch (status.type) {
    case 'active':
      return 'running';
    case 'idle':
      return 'idle';
    case 'notLoaded':
      return 'not_loaded';
    case 'systemError':
      return 'system_error';
    default:
      return 'system_error';
  }
}

function mapStatus(status: AppServerStatusSnapshot): AgentRuntimeStatus {
  return {
    state: status.state,
    transport: status.transport,
    lastStartedAt: status.lastStartedAt,
    lastError: status.lastError,
    restartCount: status.restartCount,
  };
}

function mapModel(model: Awaited<ReturnType<CodexAppServerManager['listModels']>>[number]): AgentModel {
  return {
    id: model.id,
    model: model.model,
    displayName: model.displayName,
    description: model.description,
    isDefault: model.isDefault,
    hidden: model.hidden,
    supportedReasoningEfforts: model.supportedReasoningEfforts.map((entry) => ({
      reasoningEffort: entry.reasoningEffort,
      description: entry.description,
    })),
    defaultReasoningEffort: model.defaultReasoningEffort,
  };
}

function mapTurn(turn: CodexTurnRecord): AgentTurn {
  return codexTurnToAgentTurn(turn);
}

function mapGoal(goal: CodexThreadGoalRecord): AgentGoal {
  return {
    providerSessionId: goal.threadId,
    objective: goal.objective,
    status: goal.status,
    tokenBudget: goal.tokenBudget,
    tokensUsed: goal.tokensUsed,
    timeUsedSeconds: goal.timeUsedSeconds,
    createdAt: goal.createdAt,
    updatedAt: goal.updatedAt,
    rawGoal: goal,
  };
}

function mapSession(thread: CodexThreadRecord): AgentSessionDetail {
  return {
    provider: 'codex',
    providerSessionId: thread.id,
    cwd: thread.cwd,
    title: thread.name,
    preview: thread.preview,
    createdAt: toIsoFromEpoch(thread.createdAt),
    updatedAt: toIsoFromEpoch(thread.updatedAt),
    status: normalizeStatus(thread.status),
    turns: thread.turns.map(mapTurn),
    rawSession: thread,
  };
}

function mapCodexNotification(event: CodexServerEvent): AgentRuntimeEvent | null {
  switch (event.method) {
    case 'thread/status/changed': {
      const params = event.params as { threadId: string; status: CodexThreadStatus };
      return {
        type: 'session.status.changed',
        provider: 'codex',
        providerSessionId: params.threadId,
        status: normalizeStatus(params.status),
        rawStatus: params.status,
      };
    }
    case 'thread/name/updated': {
      const params = event.params as { threadId: string; threadName?: string };
      return params.threadName
        ? {
            type: 'session.title.updated',
            provider: 'codex',
            providerSessionId: params.threadId,
            title: params.threadName,
          }
        : null;
    }
    case 'thread/goal/updated': {
      const params = event.params as {
        threadId: string;
        turnId: string | null;
        goal: CodexThreadGoalRecord;
      };
      return {
        type: 'goal.updated',
        provider: 'codex',
        providerSessionId: params.threadId,
        providerTurnId: params.turnId,
        goal: mapGoal(params.goal),
      };
    }
    case 'thread/goal/cleared': {
      const params = event.params as { threadId: string };
      return {
        type: 'goal.cleared',
        provider: 'codex',
        providerSessionId: params.threadId,
      };
    }
    case 'thread/tokenUsage/updated': {
      const params = event.params as {
        threadId: string;
        turnId: string;
        tokenUsage: unknown;
      };
      return {
        type: 'usage.updated',
        provider: 'codex',
        providerSessionId: params.threadId,
        providerTurnId: params.turnId,
        usage: params.tokenUsage,
      };
    }
    case 'turn/started': {
      const params = event.params as { threadId: string; turn: CodexTurnRecord };
      return {
        type: 'turn.started',
        provider: 'codex',
        providerSessionId: params.threadId,
        turn: mapTurn(params.turn),
      };
    }
    case 'hook/started': {
      const params = event.params as {
        threadId: string;
        turnId: string | null;
        run: unknown;
      };
      return {
        type: 'hook.started',
        provider: 'codex',
        providerSessionId: params.threadId,
        providerTurnId: params.turnId,
        item: codexHookRunToHistoryItem(
          params.run as Parameters<typeof codexHookRunToHistoryItem>[0],
        ),
        rawHookRun: params.run,
      };
    }
    case 'hook/completed': {
      const params = event.params as {
        threadId: string;
        turnId: string | null;
        run: unknown;
      };
      return {
        type: 'hook.completed',
        provider: 'codex',
        providerSessionId: params.threadId,
        providerTurnId: params.turnId,
        item: codexHookRunToHistoryItem(
          params.run as Parameters<typeof codexHookRunToHistoryItem>[0],
        ),
        rawHookRun: params.run,
      };
    }
    case 'item/started': {
      const params = event.params as {
        threadId: string;
        turnId: string;
        item: CodexTurnItem;
      };
      const item = liveCodexItemToHistoryItem(params.item, 'started');
      return item ? {
        type: 'item.started',
        provider: 'codex',
        providerSessionId: params.threadId,
        providerTurnId: params.turnId,
        item,
      } : null;
    }
    case 'item/completed': {
      const params = event.params as {
        threadId: string;
        turnId: string;
        item: CodexTurnItem;
      };
      const item = liveCodexItemToHistoryItem(params.item, 'completed');
      return item ? {
        type: 'item.completed',
        provider: 'codex',
        providerSessionId: params.threadId,
        providerTurnId: params.turnId,
        item,
      } : null;
    }
    case 'turn/plan/updated': {
      const params = event.params as {
        threadId: string;
        turnId: string;
        explanation: string | null;
        plan: Array<{ step: string; status: string }>;
      };
      return {
        type: 'plan.updated',
        provider: 'codex',
        providerSessionId: params.threadId,
        providerTurnId: params.turnId,
        explanation: params.explanation,
        plan: params.plan,
      };
    }
    case 'item/agentMessage/delta': {
      const params = event.params as {
        threadId: string;
        turnId: string;
        itemId: string;
        delta: string;
      };
      return {
        type: 'output.delta',
        provider: 'codex',
        providerSessionId: params.threadId,
        providerTurnId: params.turnId,
        itemId: params.itemId,
        delta: params.delta,
      };
    }
    case 'turn/completed': {
      const params = event.params as { threadId: string; turn: CodexTurnRecord };
      return {
        type: 'turn.completed',
        provider: 'codex',
        providerSessionId: params.threadId,
        turn: mapTurn(params.turn),
      };
    }
    case 'error': {
      const params = event.params as {
        threadId: string;
        turnId: string;
        error: { message?: string };
        willRetry: boolean;
      };
      return {
        type: 'turn.failed',
        provider: 'codex',
        providerSessionId: params.threadId,
        providerTurnId: params.turnId,
        error: params.error.message ?? 'Turn failed unexpectedly.',
        willRetry: params.willRetry,
      };
    }
    default:
      return null;
  }
}

function mapCodexRuntimeError(error: unknown): never {
  if (error instanceof AgentRuntimeError) {
    throw error;
  }

  if (error instanceof JsonRpcClientError) {
    throw new AgentRuntimeError(
      error.message,
      'codex',
      error.code === 'request_timeout'
        ? 'request_timeout'
        : error.code === 'remote_error'
          ? 'remote_error'
          : error.code === 'client_closed'
            ? 'client_closed'
            : error.code === 'app_server_unavailable'
              ? 'provider_unavailable'
              : 'request_failed',
      error.details,
      error,
    );
  }

  if (error instanceof Error) {
    throw new AgentRuntimeError(error.message, 'codex', 'request_failed', undefined, error);
  }

  throw new AgentRuntimeError('Codex runtime request failed.', 'codex', 'request_failed', undefined, error);
}

async function codexRuntimeCall<T>(callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    mapCodexRuntimeError(error);
  }
}

export class CodexRuntimeAdapter extends EventEmitter implements AgentRuntime {
  readonly provider = 'codex' as const;
  readonly displayName = 'Codex';
  readonly description = 'Local Codex app-server runtime.';
  readonly capabilities = codexCapabilities;
  readonly managementSchema: AgentRuntimeManagementSchema = {
    hostConfigFiles: [
      {
        name: 'config.toml',
        label: 'config.toml',
        description: 'Runtime configuration',
        roles: ['runtime', 'mcp'],
      },
      {
        name: 'auth.json',
        label: 'auth.json',
        description: 'Authentication state',
        roles: ['auth'],
      },
    ],
    toolboxItems: [
      { action: 'fast', command: '/fast', label: 'Fast mode' },
      { action: 'compact', command: '/compact', label: 'Compact context' },
      { action: 'goal', command: '/goal', label: 'Goal' },
      { action: 'fork', command: '/fork', label: 'Fork', panel: 'fork' },
      { action: 'skills', command: '/skills', label: 'Skills', panel: 'skills' },
      { action: 'mcp', command: '/mcp', label: 'MCP', panel: 'mcp' },
      { action: 'hooks', command: '/hooks', label: 'Hooks', panel: 'hooks' },
    ],
    hookCommandTemplates: [
      {
        eventName: 'preToolUse',
        command:
          'node -e "process.stdin.resume(); process.stdin.on(\'end\', () => console.error(\'remote-codex hook ran\'))"',
      },
      {
        eventName: 'stop',
        command:
          'node -e \'process.stdin.resume(); process.stdin.on("end", () => console.log(JSON.stringify({ systemMessage: "remote-codex hook ran" })))\'',
      },
    ],
    configArchives: true,
    buildRestart: true,
  };

  constructor(readonly manager: CodexAppServerManager) {
    super();
    this.manager.on('status', (status) => {
      this.emit('status', mapStatus(status));
    });
    this.manager.on('notification', (event) => {
      const runtimeEvent = mapCodexNotification(event);
      if (runtimeEvent) {
        this.emit('event', runtimeEvent);
      }
      this.emit('provider-notification', {
        provider: 'codex',
        method: event.method,
        params: event.params,
        rawNotification: event,
      } satisfies AgentProviderNotification);
    });
    this.manager.on('request', (request) => {
      this.emit('provider-request', {
        provider: 'codex',
        id: request.id,
        method: request.method,
        params: request.params,
        rawRequest: request,
      } satisfies AgentProviderRequest);
    });
    this.manager.on('stderr', (message) => {
      this.emit('stderr', message);
    });
    this.manager.on('warning', (warning) => {
      this.emit('warning', warning);
    });
  }

  getStatus(): AgentRuntimeStatus {
    return mapStatus(this.manager.getStatus());
  }

  start() {
    return codexRuntimeCall(() => this.manager.start());
  }

  stop() {
    return codexRuntimeCall(() => this.manager.stop());
  }

  async listModels(): Promise<AgentModel[]> {
    return (await codexRuntimeCall(() => this.manager.listModels())).map(mapModel);
  }

  async listSessions(): Promise<AgentSessionSummary[]> {
    return (await codexRuntimeCall(() => this.manager.listThreads())).map((thread) => {
      const session = mapSession(thread);
      return {
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        cwd: session.cwd,
        title: session.title,
        preview: session.preview,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        status: session.status,
        rawSession: thread,
      };
    });
  }

  listLoadedSessions() {
    return codexRuntimeCall(() => this.manager.listLoadedThreads());
  }

  async readSession(providerSessionId: string): Promise<AgentSessionDetail> {
    return mapSession(await codexRuntimeCall(() => this.manager.readThread(providerSessionId)));
  }

  async startSession(input: StartAgentSessionInput): Promise<StartAgentSessionResult> {
    const startInput: ThreadStartInput = {
      cwd: input.cwd,
      model: input.model,
      approvalPolicy: input.approvalMode === 'guarded' ? 'on-request' : 'never',
    };
    if (input.sandboxMode !== undefined) {
      startInput.sandbox = input.sandboxMode as SandboxMode | null;
    }
    if (input.serviceTier !== undefined) {
      startInput.serviceTier = input.serviceTier;
    }

    const response = await codexRuntimeCall(() => this.manager.startThread(startInput));
    return {
      provider: 'codex',
      providerSessionId: response.thread.id,
      model: response.model,
      reasoningEffort: response.reasoningEffort ?? null,
      sandboxMode: response.sandbox ?? null,
      session: mapSession(response.thread),
      rawSession: response.thread,
    };
  }

  async resumeSession(input: ResumeAgentSessionInput): Promise<StartAgentSessionResult> {
    const resumeInput: ThreadResumeInput = {
      threadId: input.providerSessionId,
    };
    if (input.model !== undefined) {
      resumeInput.model = input.model;
    }
    if (input.sandboxMode !== undefined) {
      resumeInput.sandbox = input.sandboxMode as SandboxMode | null;
    }
    if (input.serviceTier !== undefined) {
      resumeInput.serviceTier = input.serviceTier;
    }

    const response = await codexRuntimeCall(() => this.manager.resumeThread(resumeInput));
    return {
      provider: 'codex',
      providerSessionId: response.thread.id,
      model: response.model,
      reasoningEffort: response.reasoningEffort ?? null,
      sandboxMode: response.sandbox ?? null,
      session: mapSession(response.thread),
      rawSession: response.thread,
    };
  }

  async startTurn(input: StartAgentTurnInput): Promise<AgentTurn> {
    const turnInput: TurnStartInput = {
      threadId: input.providerSessionId,
      prompt: input.prompt,
    };
    if (input.model !== undefined) {
      turnInput.model = input.model;
    }
    if (input.reasoningEffort !== undefined) {
      turnInput.effort = input.reasoningEffort as ReasoningEffort | null;
    }
    if (input.collaborationMode !== undefined) {
      turnInput.collaborationMode = input.collaborationMode;
    }
    if (input.sandboxPolicy !== undefined) {
      turnInput.sandboxPolicy = input.sandboxPolicy as SandboxPolicy | null;
    }
    if (input.serviceTier !== undefined) {
      turnInput.serviceTier = input.serviceTier;
    }

    return mapTurn(await codexRuntimeCall(() => this.manager.startTurn(turnInput)));
  }

  async sendInput(input: SendAgentInputInput): Promise<AgentTurn | null> {
    const turn = await codexRuntimeCall(() => this.manager.steerTurn({
      threadId: input.providerSessionId,
      turnId: input.providerTurnId,
      prompt: input.prompt,
    }));
    return turn ? mapTurn(turn) : null;
  }

  async interruptTurn(input: InterruptAgentTurnInput): Promise<AgentTurn | null> {
    const turn = await codexRuntimeCall(() => this.manager.interruptTurn(
      input.providerSessionId,
      input.providerTurnId,
    ));
    return turn ? mapTurn(turn) : null;
  }

  compactSession(providerSessionId: string) {
    return codexRuntimeCall(() => this.manager.compactThread(providerSessionId));
  }

  async forkSession(input: { providerSessionId: string }): Promise<AgentSessionDetail> {
    return mapSession(await codexRuntimeCall(() => this.manager.forkThread({
      threadId: input.providerSessionId,
    })));
  }

  async rollbackSession(input: { providerSessionId: string; count: number }): Promise<AgentSessionDetail> {
    return mapSession(await codexRuntimeCall(() => this.manager.rollbackThread({
      threadId: input.providerSessionId,
      count: input.count,
    })));
  }

  listMcpServers() {
    return codexRuntimeCall(() => this.manager.listMcpServers());
  }

  listSkills(input: { cwds?: string[]; forceReload?: boolean } = {}) {
    return codexRuntimeCall(() => this.manager.listSkills(input));
  }

  listHooks(input: { cwds?: string[] } = {}) {
    return codexRuntimeCall(() => this.manager.listHooks(input));
  }

  setHookTrust(input: { key: string; trustedHash: string | null }) {
    return codexRuntimeCall(() => this.manager.setHookTrust(input));
  }

  mapProviderRequest(request: AgentProviderRequest, options: { approvalMode: 'yolo' | 'guarded' }) {
    return mapCodexProviderRequest(request, options.approvalMode);
  }

  buildProviderRequestResponse(
    pending: AgentPendingProviderRequest,
    input: { answers: Record<string, { answers: string[] }> },
  ) {
    return buildCodexProviderRequestResponse(pending, input);
  }

  respondToProviderRequest(id: string | number, result: unknown) {
    this.manager.respondToServerRequest(Number(id), result);
  }

  async getGoal(providerSessionId: string): Promise<AgentGoal | null> {
    const goal = await codexRuntimeCall(() => this.manager.getThreadGoal(providerSessionId));
    return goal ? mapGoal(goal) : null;
  }

  async setGoal(input: SetAgentGoalInput): Promise<AgentGoal> {
    return mapGoal(
      await codexRuntimeCall(() => this.manager.setThreadGoal({
        threadId: input.providerSessionId,
        ...(input.objective !== undefined ? { objective: input.objective } : {}),
        ...(input.status !== undefined ? { status: input.status as CodexThreadGoalRecord['status'] | null } : {}),
        ...(input.tokenBudget !== undefined ? { tokenBudget: input.tokenBudget } : {}),
      })),
    );
  }

  clearGoal(providerSessionId: string) {
    return codexRuntimeCall(() => this.manager.clearThreadGoal(providerSessionId));
  }
}
