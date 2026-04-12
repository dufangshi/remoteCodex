export type ApiErrorCode =
  | 'bad_request'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
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

export interface CodexStatusDto {
  state: 'starting' | 'ready' | 'degraded' | 'stopped' | 'failed';
  transport: 'stdio';
  lastStartedAt: string | null;
  lastError: string | null;
  restartCount: number;
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

export type CodexHostFileNameDto = 'config.toml' | 'auth.json';

export interface CodexHostFileDto {
  name: CodexHostFileNameDto;
  path: string;
  exists: boolean;
  content: string;
}

export interface UpdateCodexHostFileInput {
  content: string;
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

export interface CreateWorkspaceInput {
  absPath: string;
  label?: string;
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
  codexThreadId: string | null;
  source: ThreadSourceDto;
  title: string;
  model: string | null;
  reasoningEffort: ReasoningEffortDto | null;
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
    | 'toolCall'
    | 'other';
  text: string;
  previewText?: string;
  detailText?: string | null;
  hasDeferredDetail?: boolean | null;
  status?: string | null;
  assetPath?: string | null;
  changedFiles?: number | null;
  addedLines?: number | null;
  removedLines?: number | null;
}

export interface ThreadHistoryItemDetailDto {
  id: string;
  kind: ThreadHistoryItemDto['kind'];
  title: string;
  text: string;
}

export interface ThreadTurnDto {
  id: string;
  startedAt: string | null;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: string | null;
  model?: string | null;
  reasoningEffort?: ReasoningEffortDto | null;
  reasoningEffortAvailable?: boolean | null;
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

export interface ThreadDetailDto {
  thread: ThreadDto;
  workspace: WorkspaceDto;
  workspacePathStatus: 'present' | 'missing';
  turns: ThreadTurnDto[];
  totalTurnCount?: number;
  pendingRequests: ThreadActionRequestDto[];
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
  model: string;
  approvalMode: ApprovalMode;
}

export interface UpdateThreadSettingsInput {
  model?: string;
  reasoningEffort?: ReasoningEffortDto | null;
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
    | 'thread.turn.started'
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
