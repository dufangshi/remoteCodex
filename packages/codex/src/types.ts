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
}

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
  status?: string | null;
  changes?: unknown[];
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

export interface ThreadStartInput {
  cwd: string;
  model: string;
  approvalPolicy: 'never' | 'on-request';
}

export interface TurnStartInput {
  threadId: string;
  prompt: string;
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
  | { method: 'turn/started'; params: { threadId: string; turn: CodexTurnRecord } }
  | { method: 'turn/completed'; params: { threadId: string; turn: CodexTurnRecord } }
  | { method: 'item/agentMessage/delta'; params: CodexOutputDeltaEvent }
  | { method: 'error'; params: { error: { message?: string }; willRetry: boolean; threadId: string; turnId: string } }
  | { method: string; params: Record<string, unknown> };
