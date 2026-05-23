import { EventEmitter } from 'node:events';
import type {
  AgentBackendIdDto,
  AgentBackendInstallationDto,
  ThreadHistoryItemDto,
} from '../../shared/src/index';

export const transientAgentHistoryItemSymbol: unique symbol = Symbol(
  'remoteCodex.transientAgentHistoryItem',
);

export type AgentProviderId = AgentBackendIdDto;

export type AgentRuntimeErrorCode =
  | 'provider_unavailable'
  | 'request_timeout'
  | 'request_failed'
  | 'remote_error'
  | 'client_closed'
  | 'invalid_response';

export class AgentRuntimeError extends Error {
  constructor(
    message: string,
    public readonly provider: AgentProviderId,
    public readonly code: AgentRuntimeErrorCode = 'request_failed',
    public readonly details?: Record<string, unknown>,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentRuntimeError';
  }
}

export interface AgentRuntimeStatus {
  state: 'starting' | 'ready' | 'degraded' | 'stopped' | 'failed';
  transport: 'stdio' | 'sdk' | 'none';
  lastStartedAt: string | null;
  lastError: string | null;
  restartCount: number;
}

export interface AgentProviderCapabilities {
  sessions: {
    list: boolean;
    read: boolean;
    resume: boolean;
    importLocal: boolean;
  };
  turns: {
    start: boolean;
    streamInput: boolean;
    steer: boolean;
    interrupt: boolean;
    compact: boolean;
  };
  branching: {
    fork: boolean;
    hardRollback: boolean;
    resumeAt: boolean;
    rewindFiles: boolean;
  };
  controls: {
    planMode: boolean;
    permissionRequests: boolean;
    sandboxMode: boolean;
    performanceMode: boolean;
    goals: boolean;
  };
  management: {
    models: boolean;
    mcpStatus: boolean;
    skills: boolean;
    hooks: boolean;
    hookTrust: boolean;
    hostConfigFiles: boolean;
    providerSettings: boolean;
  };
  usage: {
    contextWindow: boolean;
    tokenUsage: boolean;
    costUsd: boolean;
  };
}

export interface AgentRuntimeDescriptor {
  provider: AgentProviderId;
  displayName: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
  status: AgentRuntimeStatus;
  capabilities: AgentProviderCapabilities;
  managementSchema: AgentRuntimeManagementSchema;
  installation: AgentBackendInstallationDto;
}

export interface AgentRuntimeConfigFileSchema {
  name: string;
  label: string;
  description: string;
  roles?: Array<'runtime' | 'auth' | 'mcp' | 'hooks' | 'providerSettings'>;
}

export type AgentRuntimeToolboxAction =
  | 'fast'
  | 'compact'
  | 'goal'
  | 'fork'
  | 'skills'
  | 'mcp'
  | 'hooks';

export interface AgentRuntimeToolboxItemSchema {
  action: AgentRuntimeToolboxAction;
  command: string;
  label: string;
  description?: string | null;
  panel?: 'fork' | 'skills' | 'mcp' | 'hooks' | null;
}

export type AgentRuntimeHookEventName =
  | 'preToolUse'
  | 'permissionRequest'
  | 'postToolUse'
  | 'preCompact'
  | 'postCompact'
  | 'sessionStart'
  | 'userPromptSubmit'
  | 'stop';

export interface AgentRuntimeHookCommandTemplate {
  eventName: AgentRuntimeHookEventName;
  command: string;
}

export interface AgentRuntimeManagementSchema {
  hostConfigFiles: AgentRuntimeConfigFileSchema[];
  toolboxItems: AgentRuntimeToolboxItemSchema[];
  hookCommandTemplates: AgentRuntimeHookCommandTemplate[];
  providerConfigFormat: 'toml' | 'json' | 'none';
  mcpConfigFormat: 'codex-toml' | 'claude-json' | 'none';
  configArchives: boolean;
  buildRestart: boolean;
}

export interface AgentModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  hidden: boolean;
  supportsPerformanceMode?: boolean;
  supportedReasoningEfforts: Array<{
    reasoningEffort: string;
    description: string;
  }>;
  defaultReasoningEffort: string | null;
}

export type AgentSessionStatus =
  | 'idle'
  | 'running'
  | 'interrupted'
  | 'failed'
  | 'not_loaded'
  | 'system_error';

export interface AgentSessionSummary {
  provider: AgentProviderId;
  providerSessionId: string;
  cwd: string;
  title: string | null;
  preview: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  status: AgentSessionStatus;
  rawSession?: unknown;
}

export type AgentHistoryItem = ThreadHistoryItemDto & {
  [transientAgentHistoryItemSymbol]?: true;
};

export function markTransientAgentHistoryItem<T extends ThreadHistoryItemDto>(
  item: T,
): T & AgentHistoryItem {
  Object.defineProperty(item, transientAgentHistoryItemSymbol, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return item as T & AgentHistoryItem;
}

export function isTransientAgentHistoryItem(
  item: ThreadHistoryItemDto,
): item is AgentHistoryItem & { [transientAgentHistoryItemSymbol]: true } {
  return Boolean((item as AgentHistoryItem)[transientAgentHistoryItemSymbol]);
}

export type AgentTurnItem = AgentHistoryItem;

export interface AgentTurn {
  providerTurnId: string;
  rawTurnId?: string;
  startedAt?: string | null;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: { message?: string } | null;
  items: AgentHistoryItem[];
  rawTurn?: unknown;
}

export interface AgentSessionDetail extends AgentSessionSummary {
  turns: AgentTurn[];
  totalTurnCount?: number | null;
}

export interface ReadAgentSessionOptions {
  limit?: number;
  beforeTurnId?: string | null;
  localThreadId?: string;
  workspacePath?: string;
}

export interface StartAgentSessionInput {
  cwd: string;
  model: string;
  approvalMode: 'yolo' | 'guarded';
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  performanceMode?: 'standard' | 'fast' | null;
}

export interface StartAgentSessionResult {
  provider: AgentProviderId;
  providerSessionId: string;
  model: string | null;
  reasoningEffort?: string | null;
  sandboxMode?: string | null;
  session: AgentSessionDetail;
  rawSession?: unknown;
}

export interface ResumeAgentSessionInput {
  providerSessionId: string;
  model?: string | null;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  performanceMode?: 'standard' | 'fast' | null;
}

export interface StartAgentTurnInput {
  providerSessionId: string;
  prompt: string;
  displayPrompt?: string | null;
  developerInstructions?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  collaborationMode?: 'default' | 'plan' | null;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  workspacePath?: string | null;
  performanceMode?: 'standard' | 'fast' | null;
  hidden?: boolean;
  displayTurnId?: string | null;
}

export interface SendAgentInputInput {
  providerSessionId: string;
  providerTurnId: string;
  prompt: string;
}

export interface InterruptAgentTurnInput {
  providerSessionId: string;
  providerTurnId: string;
}

export interface AgentGoal {
  providerSessionId: string;
  objective: string;
  status: string;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
  rawGoal?: unknown;
}

export interface SetAgentGoalInput {
  providerSessionId: string;
  objective?: string | null;
  status?: string | null;
  tokenBudget?: number | null;
}

export interface AgentSkill {
  name: string;
  description: string;
  shortDescription: string | null;
  interface: {
    displayName: string | null;
    shortDescription: string | null;
    brandColor: string | null;
    defaultPrompt: string | null;
  } | null;
  path: string;
  scope: string;
  enabled: boolean;
}

export interface AgentSkillError {
  path: string;
  message: string;
}

export interface AgentSkillsListEntry {
  cwd: string;
  skills: AgentSkill[];
  errors: AgentSkillError[];
}

export interface AgentMcpTool {
  name: string;
  title: string | null;
  description: string | null;
}

export interface AgentMcpServer {
  name: string;
  authStatus: string;
  tools: AgentMcpTool[];
  resourceCount: number;
  resourceTemplateCount: number;
}

export interface AgentHook {
  key: string;
  eventName: string;
  handlerType: string;
  matcher: string | null;
  command: string | null;
  timeoutSec: number;
  statusMessage: string | null;
  sourcePath: string;
  source: string;
  pluginId: string | null;
  displayOrder: number;
  enabled: boolean;
  isManaged: boolean;
  currentHash: string;
  trustStatus: string;
}

export interface AgentHookError {
  path: string;
  message: string;
}

export interface AgentHooksListEntry {
  cwd: string;
  hooks: AgentHook[];
  warnings: string[];
  errors: AgentHookError[];
}

export interface AgentProviderNotification {
  provider: AgentProviderId;
  method: string;
  params?: unknown;
  rawNotification?: unknown;
}

export interface AgentRuntimeStatusChangedEvent {
  type: 'session.status.changed';
  provider: AgentProviderId;
  providerSessionId: string;
  status: AgentSessionStatus;
  rawStatus?: unknown;
}

export interface AgentRuntimeTitleUpdatedEvent {
  type: 'session.title.updated';
  provider: AgentProviderId;
  providerSessionId: string;
  title: string;
}

export interface AgentRuntimeGoalUpdatedEvent {
  type: 'goal.updated';
  provider: AgentProviderId;
  providerSessionId: string;
  providerTurnId: string | null;
  goal: AgentGoal;
}

export interface AgentRuntimeGoalClearedEvent {
  type: 'goal.cleared';
  provider: AgentProviderId;
  providerSessionId: string;
}

export interface AgentRuntimeUsageUpdatedEvent {
  type: 'usage.updated';
  provider: AgentProviderId;
  providerSessionId: string;
  providerTurnId: string;
  usage: unknown;
}

export interface AgentRuntimeTurnStartedEvent {
  type: 'turn.started';
  provider: AgentProviderId;
  providerSessionId: string;
  turn: AgentTurn;
}

export interface AgentRuntimeHookEvent {
  type: 'hook.started' | 'hook.completed';
  provider: AgentProviderId;
  providerSessionId: string;
  providerTurnId: string | null;
  item: AgentHistoryItem;
  rawHookRun?: unknown;
}

export interface AgentRuntimeItemEvent {
  type: 'item.started' | 'item.completed';
  provider: AgentProviderId;
  providerSessionId: string;
  providerTurnId: string;
  item: AgentHistoryItem;
}

export interface AgentRuntimePlanUpdatedEvent {
  type: 'plan.updated';
  provider: AgentProviderId;
  providerSessionId: string;
  providerTurnId: string;
  explanation: string | null;
  plan: Array<{ step: string; status: string }>;
}

export interface AgentRuntimeOutputDeltaEvent {
  type: 'output.delta';
  provider: AgentProviderId;
  providerSessionId: string;
  providerTurnId: string;
  itemId: string;
  delta: string;
}

export interface AgentRuntimeTurnCompletedEvent {
  type: 'turn.completed';
  provider: AgentProviderId;
  providerSessionId: string;
  turn: AgentTurn;
}

export interface AgentRuntimeTurnFailedEvent {
  type: 'turn.failed';
  provider: AgentProviderId;
  providerSessionId: string;
  providerTurnId: string;
  error: string;
  willRetry?: boolean;
}

export type AgentRuntimeEvent =
  | AgentRuntimeStatusChangedEvent
  | AgentRuntimeTitleUpdatedEvent
  | AgentRuntimeGoalUpdatedEvent
  | AgentRuntimeGoalClearedEvent
  | AgentRuntimeUsageUpdatedEvent
  | AgentRuntimeTurnStartedEvent
  | AgentRuntimeHookEvent
  | AgentRuntimeItemEvent
  | AgentRuntimePlanUpdatedEvent
  | AgentRuntimeOutputDeltaEvent
  | AgentRuntimeTurnCompletedEvent
  | AgentRuntimeTurnFailedEvent;

export interface AgentProviderRequest {
  provider: AgentProviderId;
  id: string | number;
  method: string;
  params?: unknown;
  rawRequest?: unknown;
}

export interface AgentActionQuestionOption {
  label: string;
  description: string;
}

export interface AgentActionQuestion {
  id: string;
  header: string;
  question: string;
  multiSelect?: boolean;
  isOther: boolean;
  isSecret: boolean;
  options: AgentActionQuestionOption[] | null;
}

export interface AgentActionRequest {
  id: string;
  kind: 'requestUserInput';
  title: string;
  description: string | null;
  turnId: string | null;
  itemId: string | null;
  createdAt: string;
  questions: AgentActionQuestion[];
}

export interface AgentActionRequestResponseInput {
  answers: Record<string, { answers: string[] }>;
}

export interface AgentPendingProviderRequest {
  providerRequestId: string | number;
  responseKind: string;
  responsePayload?: Record<string, unknown>;
  request: AgentActionRequest;
}

export interface AgentProviderRequestMapping {
  providerRequestId: string | number;
  providerSessionId: string;
  autoApprovedResult: unknown | null;
  pendingRequest: AgentPendingProviderRequest | null;
}

export interface AgentRuntime extends EventEmitter {
  readonly provider: AgentProviderId;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: AgentProviderCapabilities;
  readonly managementSchema: AgentRuntimeManagementSchema;
  readonly installation: AgentBackendInstallationDto;

  getStatus(): AgentRuntimeStatus;
  start(): Promise<void>;
  stop(): Promise<void>;

  listModels(): Promise<AgentModel[]>;
  listSessions(): Promise<AgentSessionSummary[]>;
  listLoadedSessions(): Promise<string[]>;
  readSession(
    providerSessionId: string,
    options?: ReadAgentSessionOptions,
  ): Promise<AgentSessionDetail>;
  startSession(input: StartAgentSessionInput): Promise<StartAgentSessionResult>;
  resumeSession(input: ResumeAgentSessionInput): Promise<StartAgentSessionResult>;

  startTurn(input: StartAgentTurnInput): Promise<AgentTurn>;
  sendInput?(input: SendAgentInputInput): Promise<AgentTurn | null>;
  interruptTurn(input: InterruptAgentTurnInput): Promise<AgentTurn | null>;

  compactSession?(providerSessionId: string): Promise<void>;
  forkSession?(input: { providerSessionId: string; atTurnId?: string | null }): Promise<AgentSessionDetail>;
  rollbackSession?(input: { providerSessionId: string; count: number }): Promise<AgentSessionDetail>;

  listMcpServers?(): Promise<AgentMcpServer[]>;
  listSkills?(input?: { cwds?: string[]; forceReload?: boolean }): Promise<AgentSkillsListEntry[]>;
  listHooks?(input?: { cwds?: string[] }): Promise<AgentHooksListEntry[]>;
  setHookTrust?(input: { key: string; trustedHash: string | null }): Promise<unknown>;
  mapProviderRequest?(
    request: AgentProviderRequest,
    options: { approvalMode: 'yolo' | 'guarded' },
  ): AgentProviderRequestMapping | null;
  buildProviderRequestResponse?(
    pending: AgentPendingProviderRequest,
    input: AgentActionRequestResponseInput,
  ): unknown;
  respondToProviderRequest?(id: string | number, result: unknown): void;
  getGoal?(providerSessionId: string): Promise<AgentGoal | null>;
  setGoal?(input: SetAgentGoalInput): Promise<AgentGoal>;
  clearGoal?(providerSessionId: string): Promise<boolean>;
}
