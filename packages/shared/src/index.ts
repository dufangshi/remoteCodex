export type ApiErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'conflict'
  | 'codex_goal_error'
  | 'forbidden'
  | 'goal_feature_disabled'
  | 'internal_error'
  | 'service_unavailable';

export interface ApiErrorShape {
  code: ApiErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface RuntimeConfigDto {
  appName: string;
  appVersion: string;
  host: string;
  port: number;
  workspaceRoot: string;
  environment: string;
}

export type AgentBackendIdDto = 'codex' | 'claude';

export interface AgentRuntimeStatusDto {
  state: 'starting' | 'ready' | 'degraded' | 'stopped' | 'failed';
  transport: 'stdio' | 'sdk' | 'none';
  lastStartedAt: string | null;
  lastError: string | null;
  restartCount: number;
}

export interface AgentProviderCapabilitiesDto {
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
    fastServiceTier: boolean;
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

export interface AgentBackendDto {
  provider: AgentBackendIdDto;
  displayName: string;
  description: string;
  enabled: boolean;
  isDefault: boolean;
  status: AgentRuntimeStatusDto;
  capabilities: AgentProviderCapabilitiesDto;
  managementSchema: AgentBackendManagementSchemaDto;
}

export interface AgentBackendConfigFileSchemaDto {
  name: string;
  label: string;
  description: string;
  roles?: Array<'runtime' | 'auth' | 'mcp' | 'hooks' | 'providerSettings'>;
}

export type AgentBackendToolboxActionDto =
  | 'fast'
  | 'compact'
  | 'goal'
  | 'fork'
  | 'skills'
  | 'mcp'
  | 'hooks';

export interface AgentBackendToolboxItemSchemaDto {
  action: AgentBackendToolboxActionDto;
  command: string;
  label: string;
  description?: string | null;
  panel?: 'fork' | 'skills' | 'mcp' | 'hooks' | null;
}

export interface AgentBackendHookCommandTemplateDto {
  eventName: AgentHookEventNameDto;
  command: string;
}

export interface AgentBackendManagementSchemaDto {
  hostConfigFiles: AgentBackendConfigFileSchemaDto[];
  toolboxItems: AgentBackendToolboxItemSchemaDto[];
  hookCommandTemplates: AgentBackendHookCommandTemplateDto[];
  configArchives: boolean;
  buildRestart: boolean;
}

export interface ModelOptionDto {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  hidden: boolean;
  supportedReasoningEfforts: ReasoningEffortOptionDto[];
  defaultReasoningEffort: ReasoningEffortDto;
}

export interface VersionDto {
  name: string;
  version: string;
}

export interface HealthDto {
  status: 'ok';
  timestamp: string;
}

export type ProviderHostFileNameDto = string;

export interface ProviderHostFileDto {
  name: ProviderHostFileNameDto;
  path: string;
  exists: boolean;
  content: string;
}

export interface UpdateProviderHostFileInput {
  content: string;
}

export interface ProviderHostConfigArchiveFileDto {
  name: ProviderHostFileNameDto;
  exists: boolean;
}

export interface ProviderHostConfigArchiveDto {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  files: Record<string, ProviderHostConfigArchiveFileDto>;
}

export interface CreateProviderHostConfigArchiveInput {
  label?: string;
}

export interface RenameProviderHostConfigArchiveInput {
  label: string;
}

export interface ApplyProviderHostConfigArchiveResultDto {
  archive: ProviderHostConfigArchiveDto;
  status: AgentRuntimeStatusDto;
}

export interface WorkspaceDto {
  id: string;
  hostId: string;
  label: string;
  absPath: string;
  isFavorite: boolean;
  createdAt: string;
  lastOpenedAt: string | null;
}

export interface CreateWorkspaceFromPathInput {
  absPath: string;
  label?: string;
}

export interface CreateWorkspaceFromGitInput {
  gitUrl: string;
  label?: string;
}

export type CreateWorkspaceInput = CreateWorkspaceFromPathInput | CreateWorkspaceFromGitInput;

export interface WorkspaceSettingsDto {
  workspaceRoot: string;
  devHome: string;
  defaultBackend: AgentBackendIdDto;
}

export interface UpdateWorkspaceSettingsInput {
  devHome: string;
  defaultBackend?: AgentBackendIdDto;
}

export interface UpdateWorkspaceInput {
  label: string;
}

export type ThreadSourceDto = 'supervisor' | 'local_codex_import';

export interface UpdateWorkspaceFavoriteInput {
  isFavorite: boolean;
}

export interface WorkspaceTreeNodeDto {
  name: string;
  absPath: string;
  kind: 'file' | 'directory';
  hasChildren: boolean;
  isHidden: boolean;
}

export interface WorkspaceTreeDto {
  rootPath: string;
  currentPath: string;
  nodes: WorkspaceTreeNodeDto[];
}

export type ApprovalMode = 'yolo' | 'guarded';
export type ReasoningEffortDto = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type CollaborationModeDto = 'default' | 'plan';
export type SandboxModeDto = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface ReasoningEffortOptionDto {
  reasoningEffort: ReasoningEffortDto;
  description: string;
}

export type ThreadStatusDto =
  | 'idle'
  | 'running'
  | 'interrupted'
  | 'failed'
  | 'not_loaded'
  | 'system_error';

export interface ThreadContextUsageDto {
  availability: 'available' | 'unavailable';
  remainingPercent: number | null;
  tokensInContextWindow: number | null;
  modelContextWindow: number | null;
  updatedAt: string | null;
}

export interface ThreadDto {
  id: string;
  workspaceId: string;
  provider: AgentBackendIdDto;
  providerSessionId: string | null;
  source: ThreadSourceDto;
  title: string;
  model: string | null;
  reasoningEffort: ReasoningEffortDto | null;
  fastMode?: boolean;
  collaborationMode: CollaborationModeDto;
  approvalMode: ApprovalMode;
  sandboxMode?: SandboxModeDto | null;
  status: ThreadStatusDto;
  summaryText: string | null;
  lastError: string | null;
  activeTurnId: string | null;
  isLoaded: boolean;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  lastTurnStartedAt: string | null;
  lastTurnCompletedAt: string | null;
  contextUsage?: ThreadContextUsageDto;
}

export interface ThreadHistoryItemDto {
  id: string;
  kind:
    | 'userMessage'
    | 'agentMessage'
    | 'image'
    | 'plan'
    | 'contextCompaction'
    | 'reasoning'
    | 'commandExecution'
    | 'webSearch'
    | 'fileChange'
    | 'hook'
    | 'toolCall'
    | 'other';
  text: string;
  previewText?: string;
  detailText?: string | null;
  hasDeferredDetail?: boolean | null;
  sequence?: number | null;
  status?: string | null;
  assetPath?: string | null;
  changedFiles?: number | null;
  addedLines?: number | null;
  removedLines?: number | null;
  hookEventName?: string | null;
  hookEventLabel?: string | null;
  hookHandlerType?: string | null;
  hookScope?: string | null;
  hookSource?: string | null;
  hookSourcePath?: string | null;
  hookStatusMessage?: string | null;
  hookOutputEntries?: Array<{
    kind: string;
    text: string;
  }> | null;
}

export interface ThreadHistoryItemDetailDto {
  id: string;
  kind: ThreadHistoryItemDto['kind'];
  title: string;
  text: string;
}

export interface ThreadTurnTokenBreakdownDto {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface ThreadTurnTokenUsageDto {
  total: ThreadTurnTokenBreakdownDto;
  last: ThreadTurnTokenBreakdownDto;
  modelContextWindow: number | null;
}

export type ThreadTurnPricingTierDto = 'standard' | 'fast';

export interface ThreadTurnPriceEstimateDto {
  pricingModelKey: string;
  pricingTierKey: ThreadTurnPricingTierDto;
  currency: 'USD';
  inputUsd: number;
  cachedInputUsd: number;
  outputUsd: number;
  totalUsd: number;
}

export interface ThreadTurnDto {
  id: string;
  startedAt: string | null;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: string | null;
  model?: string | null;
  reasoningEffort?: ReasoningEffortDto | null;
  reasoningEffortAvailable?: boolean | null;
  tokenUsage?: ThreadTurnTokenUsageDto | null;
  priceEstimate?: ThreadTurnPriceEstimateDto | null;
  items: ThreadHistoryItemDto[];
}

export interface ThreadActionQuestionOptionDto {
  label: string;
  description: string;
}

export interface ThreadActionQuestionDto {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: ThreadActionQuestionOptionDto[] | null;
}

export interface ThreadActionRequestDto {
  id: string;
  kind: 'requestUserInput' | 'planDecision';
  title: string;
  description: string | null;
  turnId: string | null;
  itemId: string | null;
  createdAt: string;
  questions: ThreadActionQuestionDto[];
}

export interface ThreadAnsweredRequestNoteDto {
  id: string;
  turnId: string | null;
  title: string;
  summaryLines: string[];
  createdAt: string;
}

export interface ThreadActivityNoteDto {
  id: string;
  kind: 'fastMode' | 'forkCreated' | 'forkSource';
  createdAt: string;
  text?: string;
  anchorTurnId?: string | null;
  linkedThreadId?: string;
  linkedThreadTitle?: string | null;
  turnIndex?: number | null;
}

export type AgentSkillScopeDto = 'user' | 'repo' | 'system' | 'admin';

export interface AgentSkillInterfaceDto {
  displayName?: string;
  shortDescription?: string;
  brandColor?: string;
  defaultPrompt?: string;
}

export interface AgentSkillDto {
  name: string;
  description: string;
  shortDescription?: string;
  interface?: AgentSkillInterfaceDto;
  path: string;
  scope: AgentSkillScopeDto;
  enabled: boolean;
}

export interface AgentSkillErrorDto {
  path: string;
  message: string;
}

export interface ThreadSkillsDto {
  cwd: string;
  skills: AgentSkillDto[];
  errors: AgentSkillErrorDto[];
}

export type AgentMcpAuthStatusDto =
  | 'unsupported'
  | 'notLoggedIn'
  | 'bearerToken'
  | 'oAuth';

export interface AgentMcpToolDto {
  name: string;
  title: string | null;
  description: string | null;
}

export interface AgentMcpServerDto {
  name: string;
  authStatus: AgentMcpAuthStatusDto;
  tools: AgentMcpToolDto[];
  resourceCount: number;
  resourceTemplateCount: number;
}

export interface ThreadMcpServersDto {
  servers: AgentMcpServerDto[];
}

export type AgentHookEventNameDto =
  | 'preToolUse'
  | 'permissionRequest'
  | 'postToolUse'
  | 'preCompact'
  | 'postCompact'
  | 'sessionStart'
  | 'userPromptSubmit'
  | 'stop';

export type AgentHookHandlerTypeDto = 'command' | 'prompt' | 'agent';
export type AgentHookSourceDto =
  | 'system'
  | 'user'
  | 'project'
  | 'mdm'
  | 'sessionFlags'
  | 'plugin'
  | 'cloudRequirements'
  | 'legacyManagedConfigFile'
  | 'legacyManagedConfigMdm'
  | 'unknown';
export type AgentHookTrustStatusDto = 'managed' | 'untrusted' | 'trusted' | 'modified';

export interface AgentHookDto {
  key: string;
  eventName: AgentHookEventNameDto;
  handlerType: AgentHookHandlerTypeDto;
  matcher: string | null;
  command: string | null;
  timeoutSec: number;
  statusMessage: string | null;
  sourcePath: string;
  source: AgentHookSourceDto;
  pluginId: string | null;
  displayOrder: number;
  enabled: boolean;
  isManaged: boolean;
  currentHash: string;
  trustStatus: AgentHookTrustStatusDto;
}

export interface AgentHookErrorDto {
  path: string;
  message: string;
}

export interface ThreadHooksDto {
  cwd: string;
  hooks: AgentHookDto[];
  warnings: string[];
  errors: AgentHookErrorDto[];
  globalHooksPath: string;
  projectHooksPath: string;
}

export interface CreateThreadHookInput {
  scope: 'global' | 'project';
  eventName: AgentHookEventNameDto;
  matcher?: string | null;
  command: string;
  timeoutSec?: number | null;
  statusMessage?: string | null;
}

export interface ThreadHookTargetInput {
  scope: 'global' | 'project';
  eventName: AgentHookEventNameDto;
  matcher?: string | null;
  command: string;
  timeoutSec?: number | null;
  statusMessage?: string | null;
}

export interface UpdateThreadHookInput extends CreateThreadHookInput {
  target: ThreadHookTargetInput;
}

export interface TrustThreadHookInput {
  key: string;
  currentHash: string;
}

export interface UntrustThreadHookInput {
  key: string;
}

export type ThreadGoalStatusDto =
  | 'active'
  | 'paused'
  | 'budgetLimited'
  | 'complete'
  | 'terminated';

export interface ThreadGoalDto {
  threadId: string;
  localGoalId?: string | null;
  objective: string;
  status: ThreadGoalStatusDto;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface UpdateThreadGoalInput {
  objective?: string | null;
  status?: ThreadGoalStatusDto | null;
  tokenBudget?: number | null;
}

export interface ThreadLivePlanDto {
  turnId: string;
  explanation: string | null;
  plan: Array<{ step: string; status: string }>;
  updatedAt: string;
}

export interface ThreadPendingSteerDto {
  id: string;
  clientRequestId: string | null;
  turnId: string;
  prompt: string;
  createdAt: string;
}

export interface ThreadLiveItemsDto {
  turnId: string;
  items: ThreadHistoryItemDto[];
  updatedAt: string;
}

export interface ThreadDetailDto {
  thread: ThreadDto;
  workspace: WorkspaceDto;
  workspacePathStatus: 'present' | 'missing';
  turns: ThreadTurnDto[];
  totalTurnCount?: number;
  pendingRequests: ThreadActionRequestDto[];
  pendingSteers: ThreadPendingSteerDto[];
  answeredRequestNotes?: ThreadAnsweredRequestNoteDto[];
  activityNotes?: ThreadActivityNoteDto[];
  goal?: ThreadGoalDto | null;
  goalHistory?: ThreadGoalDto[];
  livePlan?: ThreadLivePlanDto | null;
  liveItems?: ThreadLiveItemsDto | null;
}

export interface ThreadExportTurnOptionDto {
  turnId: string;
  turnNumber: number;
  startedAt: string | null;
  status: ThreadTurnDto['status'];
  userPromptPreview: string;
}

export interface ThreadExportTurnOptionsDto {
  turns: ThreadExportTurnOptionDto[];
  totalTurnCount: number;
}

export type ThreadExportPdfModeDto = 'latest' | 'selected';
export type ThreadExportPdfProfileDto = 'review' | 'technical';
export type ThreadExportFormatDto = 'pdf' | 'html';

export interface ExportThreadPdfInput {
  format?: ThreadExportFormatDto;
  mode: ThreadExportPdfModeDto;
  limit?: number;
  turnIds?: string[];
  profile?: ThreadExportPdfProfileDto;
  options?: {
    includeTokenAndPrice?: boolean;
    includeCommandOutput?: boolean;
    includeAbsolutePaths?: boolean;
  };
}

export interface ThreadForkTurnOptionDto {
  turnId: string;
  turnIndex: number;
  startedAt: string | null;
  status: ThreadTurnDto['status'];
}

export interface ForkThreadInput {
  mode: 'latest' | 'turn';
  turnId?: string;
}

export interface ThreadForkResultDto {
  thread: ThreadDetailDto;
  sourceThreadId: string;
  sourceTurnId: string | null;
  sourceTurnIndex: number | null;
}

export type ShellStatusDto =
  | 'not_created'
  | 'creating'
  | 'running'
  | 'attached'
  | 'detached'
  | 'exited'
  | 'not_found'
  | 'workspace_missing';

export interface ShellSessionDto {
  id: string;
  threadId: string;
  workspaceId: string;
  tmuxSessionName: string;
  cwd: string;
  status: Exclude<ShellStatusDto, 'not_created' | 'workspace_missing'>;
  attachedViewerId: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string | null;
}

export interface ThreadShellStateDto {
  threadId: string;
  workspaceId: string;
  workspacePathStatus: 'present' | 'missing';
  state: ShellStatusDto;
  shell: ShellSessionDto | null;
}

export interface ShellCreateInput {
  cols?: number;
  rows?: number;
}

export interface ShellAttachInput {
  cols: number;
  rows: number;
}

export interface ShellDetachInput {
  viewerId: string;
}

export interface ShellInputInput {
  viewerId: string;
  data: string;
}

export interface ShellResizeInput {
  viewerId: string;
  cols: number;
  rows: number;
}

export interface CreateThreadInput {
  workspaceId: string;
  title?: string;
  provider?: AgentBackendIdDto;
  model: string;
  approvalMode: ApprovalMode;
}

export interface UpdateThreadSettingsInput {
  model?: string;
  reasoningEffort?: ReasoningEffortDto | null;
  fastMode?: boolean;
  collaborationMode?: CollaborationModeDto;
  sandboxMode?: SandboxModeDto | null;
}

export interface UpdateThreadInput {
  title: string;
}

export interface ImportThreadInput {
  sessionId: string;
}

export interface SendThreadPromptInput {
  prompt: string;
  clientRequestId?: string;
  model?: string;
  reasoningEffort?: ReasoningEffortDto | null;
  collaborationMode?: CollaborationModeDto;
  sandboxMode?: SandboxModeDto | null;
}

export type PromptAttachmentKindDto = 'photo' | 'file';

export interface PromptAttachmentManifestEntryDto {
  clientId: string;
  kind: PromptAttachmentKindDto;
  originalName: string;
  placeholder: string;
}

export interface InterruptTurnInput {
  turnId?: string;
}

export interface ResumeThreadInput {
  model?: string;
  sandboxMode?: SandboxModeDto | null;
}

export interface ThreadActionRequestAnswerDto {
  answers: string[];
}

export interface RespondThreadActionRequestInput {
  answers: Record<string, ThreadActionRequestAnswerDto>;
}

export interface ThreadEventEnvelope {
  type:
    | 'thread.updated'
    | 'thread.context.updated'
    | 'thread.goal.updated'
    | 'thread.goal.cleared'
    | 'thread.turn.token.updated'
    | 'thread.turn.started'
    | 'thread.item.started'
    | 'thread.item.completed'
    | 'thread.plan.updated'
    | 'thread.request.created'
    | 'thread.request.resolved'
    | 'thread.output.delta'
    | 'thread.turn.completed'
    | 'thread.turn.failed';
  threadId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface ShellEventEnvelope {
  type:
    | 'shell.connected'
    | 'shell.status'
    | 'shell.output'
    | 'shell.detached'
    | 'shell.exited'
    | 'shell.error';
  shellId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface SupervisorConnectedEnvelope {
  type: 'supervisor.connected';
  timestamp: string;
}

export interface SupervisorPongEnvelope {
  type: 'supervisor.pong';
  timestamp: string;
  payload: {
    requestTimestamp: string | null;
  };
}

export type SupervisorSocketServerEnvelope =
  | SupervisorConnectedEnvelope
  | SupervisorPongEnvelope
  | ThreadEventEnvelope
  | ShellEventEnvelope;

export type SupervisorSocketClientEnvelope =
  | {
      type: 'supervisor.ping';
      timestamp: string;
    }
  | {
      type: 'shell.attach';
      shellId: string;
      cols: number;
      rows: number;
    }
  | {
      type: 'shell.detach';
      shellId: string;
      viewerId: string;
    }
  | {
      type: 'shell.input';
      shellId: string;
      viewerId: string;
      data: string;
    }
  | {
      type: 'shell.resize';
      shellId: string;
      viewerId: string;
      cols: number;
      rows: number;
    }
  | {
      type: 'shell.clear';
      shellId: string;
      viewerId: string;
    };
