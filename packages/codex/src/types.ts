export type JsonRpcId = number;

export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: TParams;
}

export interface JsonRpcSuccess<TResult = unknown> {
  jsonrpc?: '2.0';
  id: JsonRpcId;
  result: TResult;
}

export interface JsonRpcFailure {
  jsonrpc?: '2.0';
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc?: '2.0';
  method: string;
  params: TParams;
}

export interface CodexClientInfo {
  name: string;
  title: string;
  version: string;
}

export interface AppServerStatusSnapshot {
  state: 'starting' | 'ready' | 'degraded' | 'stopped' | 'failed';
  transport: 'stdio';
  lastStartedAt: string | null;
  lastError: string | null;
  restartCount: number;
}

export interface CodexModelRecord {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  isDefault: boolean;
  supportedReasoningEfforts: Array<{
    reasoningEffort: ReasoningEffort;
    description: string;
  }>;
  defaultReasoningEffort: ReasoningEffort;
}

export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

export type CollaborationModeKind = 'default' | 'plan';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ServiceTier = 'fast' | 'flex';
export type SkillScope = 'user' | 'repo' | 'system' | 'admin';
export type McpAuthStatus = 'unsupported' | 'notLoggedIn' | 'bearerToken' | 'oAuth';
export type NetworkAccess = 'restricted' | 'enabled';
export type ReadOnlyAccess =
  | {
      type: 'restricted';
      includePlatformDefaults: boolean;
      readableRoots: string[];
    }
  | {
      type: 'fullAccess';
    };
export type SandboxPolicy =
  | {
      type: 'dangerFullAccess';
    }
  | {
      type: 'readOnly';
      access: ReadOnlyAccess;
      networkAccess: boolean;
    }
  | {
      type: 'externalSandbox';
      networkAccess: NetworkAccess;
    }
  | {
      type: 'workspaceWrite';
      writableRoots: string[];
      readOnlyAccess: ReadOnlyAccess;
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

export type CodexThreadStatus =
  | { type: 'notLoaded' }
  | { type: 'idle' }
  | { type: 'systemError' }
  | { type: 'active'; activeFlags: string[] };

export type CodexTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress';

export interface CodexTurnItem {
  type: string;
  id: string;
  text?: string;
  phase?: string | null;
  content?: Array<{ type: string; text?: string }>;
  summary?: string[];
  command?: string;
  aggregatedOutput?: string | null;
  query?: string;
  queries?: string[];
  action?: unknown;
  result?: unknown;
  sources?: unknown;
  status?: string | null;
  changes?: unknown[];
  [key: string]: unknown;
}

export interface CodexTurnRecord {
  id: string;
  status: CodexTurnStatus;
  error: { message?: string } | null;
  items: CodexTurnItem[];
}

export interface CodexThreadRecord {
  id: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  status: CodexThreadStatus;
  cwd: string;
  name: string | null;
  turns: CodexTurnRecord[];
}

export interface CodexSkillRecord {
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
  scope: SkillScope;
  enabled: boolean;
}

export interface CodexSkillErrorRecord {
  path: string;
  message: string;
}

export interface CodexSkillsListEntry {
  cwd: string;
  skills: CodexSkillRecord[];
  errors: CodexSkillErrorRecord[];
}

export interface CodexMcpToolRecord {
  name: string;
  title: string | null;
  description: string | null;
}

export interface CodexMcpServerRecord {
  name: string;
  authStatus: McpAuthStatus;
  tools: CodexMcpToolRecord[];
  resourceCount: number;
  resourceTemplateCount: number;
}

export interface ThreadStartInput {
  cwd: string;
  model: string;
  approvalPolicy: 'never' | 'on-request';
  sandbox?: SandboxMode | null;
  serviceTier?: ServiceTier | null;
}

export interface ThreadResumeInput {
  threadId: string;
  model?: string | null;
  sandbox?: SandboxMode | null;
  serviceTier?: ServiceTier | null;
}

export interface TurnStartInput {
  threadId: string;
  prompt: string;
  model?: string | null;
  effort?: ReasoningEffort | null;
  collaborationMode?: CollaborationModeKind | null;
  sandboxPolicy?: SandboxPolicy | null;
  serviceTier?: ServiceTier | null;
}

export interface TurnSteerInput {
  threadId: string;
  turnId: string;
  prompt: string;
}

export interface ThreadCompactInput {
  threadId: string;
}

export interface CodexServerRequest {
  method: string;
  id: number;
  params: Record<string, unknown>;
}

export interface CodexTurnStartedEvent {
  threadId: string;
  turnId: string;
}

export interface CodexOutputDeltaEvent {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface CodexTokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface CodexThreadTokenUsageEvent {
  threadId: string;
  turnId: string;
  tokenUsage: {
    total: CodexTokenUsageBreakdown;
    last: CodexTokenUsageBreakdown;
    modelContextWindow: number | null;
  };
}

export interface CodexErrorEvent {
  threadId: string;
  turnId: string;
  message: string;
  willRetry: boolean;
}

export type CodexServerEvent =
  | { method: 'thread/started'; params: { thread: CodexThreadRecord } }
  | { method: 'thread/status/changed'; params: { threadId: string; status: CodexThreadStatus } }
  | { method: 'thread/name/updated'; params: { threadId: string; threadName?: string } }
  | { method: 'thread/tokenUsage/updated'; params: CodexThreadTokenUsageEvent }
  | { method: 'turn/started'; params: { threadId: string; turn: CodexTurnRecord } }
  | { method: 'item/started'; params: { threadId: string; turnId: string; item: CodexTurnItem } }
  | { method: 'item/completed'; params: { threadId: string; turnId: string; item: CodexTurnItem } }
  | { method: 'turn/plan/updated'; params: { threadId: string; turnId: string; explanation: string | null; plan: Array<{ step: string; status: string }> } }
  | { method: 'turn/completed'; params: { threadId: string; turn: CodexTurnRecord } }
  | { method: 'item/agentMessage/delta'; params: CodexOutputDeltaEvent }
  | { method: 'error'; params: { error: { message?: string }; willRetry: boolean; threadId: string; turnId: string } }
  | { method: string; params: Record<string, unknown> };
