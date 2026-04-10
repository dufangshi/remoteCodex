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
}

export interface VersionDto {
  name: string;
  version: string;
}

export interface HealthDto {
  status: 'ok';
  timestamp: string;
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

export type ThreadStatusDto =
  | 'idle'
  | 'running'
  | 'interrupted'
  | 'failed'
  | 'not_loaded'
  | 'system_error';

export interface ThreadDto {
  id: string;
  workspaceId: string;
  codexThreadId: string | null;
  source: ThreadSourceDto;
  title: string;
  model: string | null;
  approvalMode: ApprovalMode;
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
}

export interface ThreadHistoryItemDto {
  id: string;
  kind:
    | 'userMessage'
    | 'agentMessage'
    | 'plan'
    | 'reasoning'
    | 'commandExecution'
    | 'fileChange'
    | 'toolCall'
    | 'other';
  text: string;
  status?: string | null;
}

export interface ThreadTurnDto {
  id: string;
  startedAt: string | null;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: string | null;
  items: ThreadHistoryItemDto[];
}

export interface ThreadDetailDto {
  thread: ThreadDto;
  workspace: WorkspaceDto;
  workspacePathStatus: 'present' | 'missing';
  turns: ThreadTurnDto[];
}

export interface CreateThreadInput {
  workspaceId: string;
  title?: string;
  model: string;
  approvalMode: ApprovalMode;
}

export interface ImportThreadInput {
  sessionId: string;
}

export interface SendThreadPromptInput {
  prompt: string;
}

export interface InterruptTurnInput {
  turnId?: string;
}

export interface ThreadEventEnvelope {
  type:
    | 'thread.updated'
    | 'thread.turn.started'
    | 'thread.output.delta'
    | 'thread.turn.completed'
    | 'thread.turn.failed';
  threadId: string;
  timestamp: string;
  payload: Record<string, unknown>;
}
