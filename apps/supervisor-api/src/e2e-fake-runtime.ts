import { EventEmitter } from 'node:events';
import type {
  AgentActionRequestResponseInput,
  AgentPendingProviderRequest,
  AgentProviderRequest,
  AgentProviderRequestMapping,
  AgentSessionDetail,
  AgentHistoryItem,
  AgentRuntime,
  AgentRuntimeEvent,
  AgentTurn,
} from '../../../packages/agent-runtime/src/index';

type StoredE2ESession = AgentSessionDetail;
type StoredProviderRequest = {
  providerSessionId: string;
  providerTurnId: string;
  assistantText: string;
};

const provider = 'claude' as const;
const firstDelta = 'IOS_STREAM_DELTA_READY';
const secondDelta = ' IOS_STREAM_COMPLETED';
const approvalPromptMarker = 'IOS_PENDING_APPROVAL';
const questionPromptMarker = 'IOS_PENDING_QUESTION';
const planPromptMarker = 'IOS_PENDING_PLAN';

export class E2EFakeRuntime extends EventEmitter implements AgentRuntime {
  readonly provider = provider;
  readonly displayName = 'E2E Fake Runtime';
  readonly description = 'Deterministic runtime for live iOS and web end-to-end tests.';
  readonly capabilities: AgentRuntime['capabilities'] = {
    sessions: { list: true, read: true, resume: true, importLocal: false },
    turns: { start: true, streamInput: false, steer: false, interrupt: true, compact: false },
    branching: { fork: false, hardRollback: false, resumeAt: false, rewindFiles: false },
    controls: {
      planMode: false,
      permissionRequests: false,
      sandboxMode: true,
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
    usage: { contextWindow: true, tokenUsage: true, costUsd: true },
  };
  readonly managementSchema: AgentRuntime['managementSchema'] = {
    hostConfigFiles: [],
    toolboxItems: [],
    hookCommandTemplates: [],
    providerConfigFormat: 'none',
    mcpConfigFormat: 'none',
    configArchives: false,
    buildRestart: false,
  };
  readonly installation: AgentRuntime['installation'] = {
    packageName: 'remote-codex-e2e-fake-runtime',
    installed: true,
    installedVersion: 'test',
    latestVersion: null,
    installCommand: '',
    updateCommand: '',
    busy: false,
    lastError: null,
  };

  private readonly sessions = new Map<string, StoredE2ESession>();
  private readonly providerRequests = new Map<string | number, StoredProviderRequest>();
  private activeTurnId: string | null = null;
  private startedAt: string | null = null;

  getStatus(): ReturnType<AgentRuntime['getStatus']> {
    return {
      state: 'ready',
      transport: 'none',
      lastStartedAt: this.startedAt,
      lastError: null,
      restartCount: 0,
    };
  }

  async start() {
    this.startedAt = new Date().toISOString();
  }

  async stop() {
    this.activeTurnId = null;
  }

  async listModels() {
    return [
      {
        id: 'ios-e2e-stream',
        model: 'ios-e2e-stream',
        displayName: 'iOS E2E Stream',
        description: 'Deterministic streaming test model.',
        isDefault: true,
        hidden: false,
        supportedReasoningEfforts: [
          { reasoningEffort: 'low', description: 'Low' },
          { reasoningEffort: 'medium', description: 'Medium' },
          { reasoningEffort: 'high', description: 'High' },
        ],
        defaultReasoningEffort: 'medium',
      },
    ];
  }

  async listSessions() {
    return [...this.sessions.values()].map((session) => ({
      provider,
      providerSessionId: session.providerSessionId,
      cwd: session.cwd,
      title: session.title,
      preview: session.preview,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: session.status,
      rawSession: session,
    }));
  }

  async listLoadedSessions() {
    return [...this.sessions.keys()];
  }

  async readSession(providerSessionId: string) {
    const session = this.sessions.get(providerSessionId);
    if (!session) {
      throw new Error(`E2E fake session missing: ${providerSessionId}`);
    }
    return session;
  }

  async startSession(input: Parameters<AgentRuntime['startSession']>[0]) {
    const providerSessionId = `e2e-session-${this.sessions.size + 1}`;
    const now = new Date().toISOString();
    const session = {
      provider,
      providerSessionId,
      cwd: input.cwd,
      title: null,
      preview: null,
      createdAt: now,
      updatedAt: now,
      status: 'idle' as const,
      turns: [],
      totalTurnCount: 0,
      rawSession: null,
    };
    this.sessions.set(providerSessionId, session);
    return {
      provider,
      providerSessionId,
      model: input.model,
      reasoningEffort: input.reasoningEffort ?? null,
      sandboxMode: input.sandboxMode ?? null,
      session,
      rawSession: session,
    };
  }

  async resumeSession(input: Parameters<AgentRuntime['resumeSession']>[0]) {
    const session = await this.readSession(input.providerSessionId);
    return {
      provider,
      providerSessionId: input.providerSessionId,
      model: input.model ?? null,
      reasoningEffort: null,
      sandboxMode: input.sandboxMode ?? null,
      session,
      rawSession: session,
    };
  }

  async startTurn(input: Parameters<AgentRuntime['startTurn']>[0]) {
    const session = await this.readSession(input.providerSessionId);
    const providerTurnId = `e2e-turn-${session.turns.length + 1}`;
    const now = new Date().toISOString();
    const userItem: AgentHistoryItem = {
      id: `${providerTurnId}:user`,
      createdAt: now,
      kind: 'userMessage',
      text: input.prompt,
    };
    const assistantItem: AgentHistoryItem = {
      id: `${providerTurnId}:assistant`,
      createdAt: now,
      kind: 'agentMessage',
      text: '',
      status: 'running',
    };
    const turn: AgentTurn = {
      providerTurnId,
      startedAt: now,
      status: 'inProgress' as const,
      error: null,
      items: input.hidden ? [] : [userItem],
      rawTurn: null,
    };

    session.turns.push(turn);
    session.totalTurnCount = session.turns.length;
    session.status = 'running';
    session.updatedAt = now;
    session.preview = input.prompt;
    this.activeTurnId = providerTurnId;

    this.emitRuntimeEvent({
      type: 'turn.started',
      provider,
      providerSessionId: input.providerSessionId,
      turn,
    });

    if (input.prompt.includes(approvalPromptMarker)) {
      setTimeout(() => {
        if (turn.status !== 'inProgress') {
          return;
        }
        const requestId = `${providerTurnId}:approval`;
        this.providerRequests.set(requestId, {
          providerSessionId: input.providerSessionId,
          providerTurnId,
          assistantText: 'IOS_PENDING_APPROVAL_RESOLVED',
        });
        this.emit('provider-request', {
          provider,
          id: requestId,
          method: 'item/commandExecution/requestApproval',
          params: {
            providerSessionId: input.providerSessionId,
            providerTurnId,
            itemId: `${providerTurnId}:approval-item`,
            command: 'printf ios-e2e-approval',
            cwd: session.cwd,
            reason: 'iOS E2E approval request.',
          },
        } satisfies AgentProviderRequest);
      }, 250);
      return turn;
    }

    if (input.prompt.includes(questionPromptMarker)) {
      setTimeout(() => {
        if (turn.status !== 'inProgress') {
          return;
        }
        const requestId = `${providerTurnId}:question`;
        this.providerRequests.set(requestId, {
          providerSessionId: input.providerSessionId,
          providerTurnId,
          assistantText: 'IOS_PENDING_QUESTION_RESOLVED',
        });
        this.emit('provider-request', {
          provider,
          id: requestId,
          method: 'tool/AskUserQuestion',
          params: {
            providerSessionId: input.providerSessionId,
            providerTurnId,
            toolUseId: `${providerTurnId}:question-item`,
          },
        } satisfies AgentProviderRequest);
      }, 250);
      return turn;
    }

    if (input.prompt.includes(planPromptMarker)) {
      const planItem: AgentHistoryItem = {
        id: `${providerTurnId}:plan`,
        createdAt: now,
        kind: 'plan',
        text: '1. Verify the iOS pending request path.\n2. Keep plan mode active until the user decides.',
        status: 'completed',
      };
      setTimeout(() => {
        if (turn.status !== 'inProgress') {
          return;
        }
        turn.items.push(planItem);
        this.emitRuntimeEvent({
          type: 'item.started',
          provider,
          providerSessionId: input.providerSessionId,
          providerTurnId,
          item: { ...planItem },
        });
        this.completeTurn(input.providerSessionId, providerTurnId);
      }, 250);
      return turn;
    }

    setTimeout(() => {
      if (turn.status !== 'inProgress') {
        return;
      }
      assistantItem.text = firstDelta;
      turn.items.push(assistantItem);
      this.emitRuntimeEvent({
        type: 'item.started',
        provider,
        providerSessionId: input.providerSessionId,
        providerTurnId,
        item: { ...assistantItem },
      });
      this.emitRuntimeEvent({
        type: 'output.delta',
        provider,
        providerSessionId: input.providerSessionId,
        providerTurnId,
        itemId: assistantItem.id,
        delta: firstDelta,
      });
    }, 250);

    setTimeout(() => {
      if (turn.status !== 'inProgress') {
        return;
      }
      assistantItem.text = `${firstDelta}${secondDelta}`;
      assistantItem.status = 'completed';
      turn.status = 'completed';
      session.status = 'idle';
      session.updatedAt = new Date().toISOString();
      this.activeTurnId = null;
      this.emitRuntimeEvent({
        type: 'output.delta',
        provider,
        providerSessionId: input.providerSessionId,
        providerTurnId,
        itemId: assistantItem.id,
        delta: secondDelta,
      });
      this.emitRuntimeEvent({
        type: 'item.completed',
        provider,
        providerSessionId: input.providerSessionId,
        providerTurnId,
        item: { ...assistantItem },
      });
      this.emitRuntimeEvent({
        type: 'turn.completed',
        provider,
        providerSessionId: input.providerSessionId,
        turn,
      });
    }, 20_000);

    return turn;
  }

  async interruptTurn(input: Parameters<AgentRuntime['interruptTurn']>[0]) {
    const session = await this.readSession(input.providerSessionId);
    const turn = session.turns.find((entry) => entry.providerTurnId === input.providerTurnId);
    if (!turn) {
      return null;
    }
    turn.status = 'interrupted';
    session.status = 'interrupted';
    this.activeTurnId = null;
    return turn;
  }

  async listMcpServers() {
    return [];
  }

  mapProviderRequest(request: AgentProviderRequest): AgentProviderRequestMapping | null {
    if (request.provider !== provider || !isRecord(request.params)) {
      return null;
    }
    const providerSessionId = stringValue(request.params.providerSessionId);
    const providerTurnId = stringValue(request.params.providerTurnId);
    if (!providerSessionId) {
      return null;
    }
    if (request.method === 'item/commandExecution/requestApproval') {
      const requestId = String(request.id);
      const description = [
        stringValue(request.params.reason),
        stringValue(request.params.command) ? `Command: ${stringValue(request.params.command)}` : null,
        stringValue(request.params.cwd) ? `CWD: ${stringValue(request.params.cwd)}` : null,
      ].filter(Boolean).join('\n');
      return {
        providerRequestId: request.id,
        providerSessionId,
        autoApprovedResult: null,
        pendingRequest: {
          providerRequestId: request.id,
          responseKind: 'commandExecutionApproval',
          request: {
            id: requestId,
            kind: 'requestUserInput',
            title: 'Command approval required',
            description: description || 'iOS E2E approval request.',
            turnId: providerTurnId,
            itemId: stringValue(request.params.itemId),
            createdAt: new Date().toISOString(),
            questions: [
              {
                id: 'approval',
                header: 'Command approval required',
                question: description || 'iOS E2E approval request.',
                isOther: false,
                isSecret: false,
                options: [
                  { label: 'Allow', description: 'Permit this action and continue the current turn.' },
                  { label: 'Deny', description: 'Decline this action.' },
                ],
              },
            ],
          },
        },
      };
    }
    if (request.method === 'tool/AskUserQuestion') {
      const requestId = String(request.id);
      return {
        providerRequestId: request.id,
        providerSessionId,
        autoApprovedResult: null,
        pendingRequest: {
          providerRequestId: request.id,
          responseKind: 'askUserQuestion',
          request: {
            id: requestId,
            kind: 'requestUserInput',
            title: 'Mode',
            description: 'Which iOS E2E path should continue?',
            turnId: providerTurnId,
            itemId: stringValue(request.params.toolUseId),
            createdAt: new Date().toISOString(),
            questions: [
              {
                id: 'question-1',
                header: 'Mode',
                question: 'Which iOS E2E path should continue?',
                isOther: true,
                isSecret: false,
                options: [
                  { label: 'Short', description: 'Keep the response concise.' },
                  { label: 'Detailed', description: 'Include more context.' },
                ],
              },
            ],
          },
          responsePayload: {
            continueAsPrompt: false,
          },
        },
      };
    }
    return null;
  }

  buildProviderRequestResponse(
    pending: AgentPendingProviderRequest,
    input: AgentActionRequestResponseInput,
  ) {
    if (pending.responseKind === 'commandExecutionApproval') {
      const answer = input.answers.approval?.answers[0]?.trim().toLowerCase();
      return { decision: answer === 'allow' ? 'accept' : 'deny' };
    }
    return {
      kind: pending.responseKind,
      answers: input.answers,
    };
  }

  respondToProviderRequest(id: string | number, result: unknown) {
    void result;
    const request = this.providerRequests.get(id);
    if (!request) {
      return;
    }
    this.providerRequests.delete(id);
    const session = this.sessions.get(request.providerSessionId);
    const turn = session?.turns.find((entry) => entry.providerTurnId === request.providerTurnId);
    if (!session || !turn || turn.status !== 'inProgress') {
      return;
    }
    const assistantItem: AgentHistoryItem = {
      id: `${request.providerTurnId}:assistant`,
      createdAt: new Date().toISOString(),
      kind: 'agentMessage',
      text: request.assistantText,
      status: 'completed',
    };
    turn.items.push(assistantItem);
    this.emitRuntimeEvent({
      type: 'item.started',
      provider,
      providerSessionId: request.providerSessionId,
      providerTurnId: request.providerTurnId,
      item: { ...assistantItem },
    });
    this.completeTurn(request.providerSessionId, request.providerTurnId);
  }

  private completeTurn(providerSessionId: string, providerTurnId: string) {
    const session = this.sessions.get(providerSessionId);
    const turn = session?.turns.find((entry) => entry.providerTurnId === providerTurnId);
    if (!session || !turn || turn.status !== 'inProgress') {
      return;
    }
    turn.status = 'completed';
    session.status = 'idle';
    session.updatedAt = new Date().toISOString();
    this.activeTurnId = null;
    this.emitRuntimeEvent({
      type: 'turn.completed',
      provider,
      providerSessionId,
      turn,
    });
  }

  private emitRuntimeEvent(event: AgentRuntimeEvent) {
    this.emit('event', event);
  }
}

export function isE2EFakeRuntimeEnabled(env: NodeJS.ProcessEnv = process.env) {
  const value = env.REMOTE_CODEX_E2E_FAKE_RUNTIME;
  return value ? ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) : false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}
