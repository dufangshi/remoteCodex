# Agent Runtime Provider Abstraction

## 背景

当前 Remote Codex Supervisor 的主链路是：

```text
CodexAppServerManager -> ThreadService -> shared DTO/API -> Web UI
```

这条链路已经能稳定服务 Codex，但它把 Codex app-server 的概念直接暴露到了业务层。历史上的耦合点包括：

- `packages/codex/src/appServerManager.ts` 固定启动 `codex app-server --listen stdio://`，并直接调用 `thread/start`、`turn/start`、`turn/steer`、`thread/goal/*` 等 Codex JSON-RPC 方法。
- `apps/supervisor-api/src/thread-service.ts` 历史上直接依赖 `CodexAppServerManager`，并按 Codex notification method 更新本地 DB 和 WebSocket 事件；完成态应通过 `AgentRuntime` registry 和 provider envelopes 接收 provider 事件。
- `packages/db/src/schema.ts` 使用 Codex 命名的远端 session/turn 字段。
- `packages/shared/src/index.ts` 和前端 API 暴露 Codex 命名的 session 字段和 `/api/codex/*` 等 Codex 入口。
- Codex host config、hooks trust、fast mode、local Codex session import 都是 provider-specific 能力。

因此，兼容 Claude 的第一步不应该是直接接入 Claude Agent SDK。更稳的路线是先建立一个 provider-neutral Agent Runtime 抽象，把 Codex app-server 包成第一个 adapter，并保持现有 Codex 行为不变。Claude adapter 只在抽象边界稳定后再接入。

## 目标

1. 先把 `ThreadService` 从 `CodexAppServerManager` 解耦。
2. 建立一个 Codex 和 Claude 都能合理实现的 `AgentRuntime` 抽象。
3. 第一阶段只实现 Codex adapter，功能行为与当前 Codex 路径保持一致。
4. 使用能力声明控制 UI 和 API，不把 Claude 差异硬塞进 Codex-only 功能。
5. 迁移 DB/DTO/API 到 provider-neutral 字段，不保留旧字段兼容；现有 Codex session 通过迁移脚本搬到新字段。

## 非目标

第一阶段不做：

- 不接入 Claude Agent SDK。
- 不重命名整个产品。
- 不改写 Codex host config 管理面。
- 不要求 Claude 复刻 `/goal`、Codex rollback、Codex hooks trust、fast mode 等 Codex-only 能力。
- 不把 Claude adapter 伪装成 `CodexAppServerManager` 作为长期方案。

## 设计原则

### 1. 抽象先行，Codex 先实现

先创建 provider-neutral runtime contract，再让 Codex 通过 adapter 适配这个 contract。只有当 Codex adapter 跑通并且现有测试基本保持稳定后，才进入 Claude adapter。

这样可以避免两类风险：

- 为了赶 Claude MVP，在 `ThreadService` 内堆大量 `if provider === 'claude'`。
- Claude 事件模型还没稳定时，反向污染现有 Codex 行为。

### 2. Provider-specific 能力不能假装通用

Codex 和 Claude 都有 session、streaming、tool use、MCP、permission、hooks 等能力，但语义并不完全相同。

因此抽象层只放真正共有的稳定概念：

- session
- turn/run
- history item
- assistant delta
- tool item
- permission request
- interruption
- usage snapshot
- provider capability

下列能力必须通过 capabilities 显式声明：

- goals
- hard rollback
- fork
- file checkpoint / rewind
- compact
- fast service tier
- host config editing
- local session import
- hook trust management
- provider-specific settings management

### 3. 本地 Thread 仍是产品核心对象

UI 和 DB 的主对象仍然叫 thread。它是 Remote Codex Supervisor 的本地工作单元，绑定 workspace、shell、timeline、notifications、exports 和 viewer state。

Provider 的远端对象统一称为 `providerSessionId`。Codex adapter 把它映射到 Codex `threadId`；Claude adapter 将来映射到 Claude `session_id`。

### 4. 字段迁移不保留旧兼容

第一阶段要把 DB schema、shared DTO、API payload 和前端状态统一迁移到 provider-neutral 字段。旧 Codex 字段只允许出现在历史迁移脚本中，用来把已有数据搬到新字段；迁移完成后的应用代码、测试 fixture 和 DTO 不再读取或输出旧字段。

目标字段：

- `threads.provider`
- `threads.providerSessionId`
- `threads.providerTurnId`
- `threadGoals.providerSessionId`
- `ThreadDto.provider`
- `ThreadDto.providerSessionId`
- `ThreadDto.activeTurnId`
- provider-neutral status/model/capabilities DTO

Runtime 管理入口不再保留 `/api/codex/*` 作为完成态兼容层。现有 UI 和测试必须走 provider-neutral route；Codex 只是 `:provider = codex` 的一个实现。

## 包结构建议

推荐拆成三个层次：

```text
packages/agent-runtime/
  src/types.ts
  src/events.ts
  src/index.ts

packages/agent-runtime-codex/
  src/codexRuntimeAdapter.ts
  src/codexEventMapper.ts
  src/index.ts

packages/agent-runtime-claude/
  src/claudeRuntimeAdapter.ts
  src/claudeEventMapper.ts
  src/index.ts
```

第一阶段只需要：

```text
packages/agent-runtime/
packages/agent-runtime-codex/
```

当前落地采用低 churn 路线：先不移动 `packages/codex`，而是在 `packages/codex` 内新增 `CodexRuntimeAdapter`、Codex event mapper 和 Codex provider request mapper。等 `ThreadService` 解耦稳定后，再决定是否重命名包。

## AgentRuntime Contract

当前实现位于 `packages/agent-runtime/src/types.ts`。核心 contract 形态如下；`rawSession`、`rawTurn` 等 opaque 字段只用于 adapter 和 provider-specific mapper，主业务路径不能把它们 cast 回 Codex 类型。

```ts
export type AgentProviderId = 'codex' | 'claude';

export interface AgentRuntimeStatus {
  state: 'starting' | 'ready' | 'degraded' | 'stopped' | 'failed';
  transport: 'stdio' | 'sdk' | 'none';
  lastStartedAt: string | null;
  lastError: string | null;
  restartCount?: number;
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

export interface AgentRuntimeManagementSchema {
  hostConfigFiles: Array<{
    name: string;
    label: string;
    description: string;
    roles?: Array<'runtime' | 'auth' | 'mcp' | 'hooks' | 'providerSettings'>;
  }>;
  toolboxItems: AgentRuntimeToolboxItemSchema[];
  configArchives: boolean;
  buildRestart: boolean;
}

export interface AgentProviderNotification {
  provider: AgentProviderId;
  method: string;
  params?: unknown;
  rawNotification?: unknown;
}

export interface AgentProviderRequest {
  provider: AgentProviderId;
  id: string | number;
  method: string;
  params?: unknown;
  rawRequest?: unknown;
}

export interface AgentModel {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  isDefault: boolean;
  hidden?: boolean;
  supportedReasoningEfforts?: string[];
  defaultReasoningEffort?: string | null;
}

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

export type AgentSessionStatus =
  | 'idle'
  | 'running'
  | 'interrupted'
  | 'failed'
  | 'not_loaded'
  | 'system_error';

export interface AgentTurn {
  providerTurnId: string;
  rawTurnId?: string;
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: { message?: string } | null;
  items: AgentTurnItem[];
  rawTurn?: unknown;
}

export interface AgentSessionDetail extends AgentSessionSummary {
  turns: AgentTurn[];
}

export class AgentRuntimeError extends Error {
  provider: AgentProviderId;
  code:
    | 'provider_unavailable'
    | 'request_timeout'
    | 'request_failed'
    | 'remote_error'
    | 'client_closed'
    | 'invalid_response';
  details?: Record<string, unknown>;
  cause?: unknown;
}

export interface StartAgentSessionInput {
  cwd: string;
  model: string;
  approvalMode: 'yolo' | 'guarded';
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' | null;
  serviceTier?: 'fast' | null;
}

export interface StartAgentSessionResult {
  provider: AgentProviderId;
  providerSessionId: string;
  model: string | null;
  reasoningEffort?: string | null;
  sandboxMode?: string | null;
  session: AgentSessionDetail;
}

export interface ResumeAgentSessionInput {
  providerSessionId: string;
  model?: string | null;
  sandboxMode?: string | null;
  serviceTier?: 'fast' | null;
}

export interface StartAgentTurnInput {
  providerSessionId: string;
  prompt: string;
  model?: string | null;
  reasoningEffort?: string | null;
  collaborationMode?: 'default' | 'plan';
  sandboxMode?: string | null;
  serviceTier?: 'fast' | null;
  cwd: string;
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

export interface AgentRuntime {
  readonly provider: AgentProviderId;
  readonly displayName: string;
  readonly description: string;
  readonly capabilities: AgentProviderCapabilities;
  readonly managementSchema: AgentRuntimeManagementSchema;

  getStatus(): AgentRuntimeStatus;
  start(): Promise<void>;
  stop(): Promise<void>;

  listModels(): Promise<AgentModel[]>;
  listSessions(): Promise<AgentSessionSummary[]>;
  listLoadedSessions(): Promise<string[]>;
  readSession(providerSessionId: string): Promise<AgentSessionDetail>;
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
  mapProviderRequest?(
    request: AgentProviderRequest,
    options: { approvalMode: 'yolo' | 'guarded' },
  ): AgentProviderRequestMapping | null;
  buildProviderRequestResponse?(
    pending: AgentPendingProviderRequest,
    input: AgentActionRequestResponseInput,
  ): unknown;
  respondToProviderRequest?(id: string | number, result: unknown): void;
}
```

## AgentEvent Contract

`ThreadService` 不应该订阅裸 Codex JSON-RPC notification/request。第一阶段由 adapter 发出 provider-neutral runtime event，并把 provider request 保持在统一 envelope 内：

- `AgentRuntimeEvent`
- `AgentProviderRequest`

Codex adapter 把 Codex JSON-RPC notification 映射为 `AgentRuntimeEvent`。未来 Claude adapter 也发同一类 event，不需要伪装成 Codex JSON-RPC。

```ts
export type AgentRuntimeEvent =
  | {
      type: 'session.started';
      provider: AgentProviderId;
      providerSessionId: string;
      session: AgentSessionDetail;
    }
  | {
      type: 'session.status.changed';
      provider: AgentProviderId;
      providerSessionId: string;
      status: AgentSessionStatus;
    }
  | {
      type: 'session.title.updated';
      provider: AgentProviderId;
      providerSessionId: string;
      title: string;
    }
  | {
      type: 'turn.started';
      provider: AgentProviderId;
      providerSessionId: string;
      turn: AgentTurn;
    }
  | {
      type: 'item.started';
      provider: AgentProviderId;
      providerSessionId: string;
      providerTurnId: string;
      item: AgentHistoryItem;
    }
  | {
      type: 'item.completed';
      provider: AgentProviderId;
      providerSessionId: string;
      providerTurnId: string;
      item: AgentHistoryItem;
    }
  | {
      type: 'item.delta';
      provider: AgentProviderId;
      providerSessionId: string;
      providerTurnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: 'plan.updated';
      provider: AgentProviderId;
      providerSessionId: string;
      providerTurnId: string;
      explanation: string | null;
      plan: Array<{ step: string; status: string }>;
    }
  | {
      type: 'permission.requested';
      provider: AgentProviderId;
      providerSessionId: string;
      providerTurnId: string | null;
      request: AgentPermissionRequest;
    }
  | {
      type: 'usage.updated';
      provider: AgentProviderId;
      providerSessionId: string;
      providerTurnId: string;
      usage: AgentUsageSnapshot;
    }
  | {
      type: 'turn.completed';
      provider: AgentProviderId;
      providerSessionId: string;
      turn: AgentTurn;
    }
  | {
      type: 'turn.failed';
      provider: AgentProviderId;
      providerSessionId: string;
      providerTurnId: string;
      error: string;
      willRetry?: boolean;
    };
```

Codex adapter 的工作是把现有事件映射成这些 event：

| Codex event | AgentEvent |
| --- | --- |
| `thread/status/changed` | `session.status.changed` |
| `thread/name/updated` | `session.title.updated` |
| `turn/started` | `turn.started` |
| `hook/started` | `item.started` |
| `hook/completed` | `item.completed` |
| `item/started` | `item.started` |
| `item/completed` | `item.completed` |
| `item/agentMessage/delta` | `item.delta` |
| `turn/plan/updated` | `plan.updated` |
| `thread/tokenUsage/updated` | `usage.updated` |
| `turn/completed` | `turn.completed` |
| `error` | `turn.failed` |

Codex server-initiated JSON-RPC request 当前通过 runtime 的 `provider-request` envelope 进入 `ThreadService`，再调用 runtime 提供的 `mapProviderRequest()`、`buildProviderRequestResponse()` 和 `respondToProviderRequest()`。Codex request id、approval response payload 和 MCP elicitation 细节留在 `packages/codex/src/requestMapper.ts`；`ThreadService` 只登记统一的 pending request，并通过 runtime responder 回写 provider。

Runtime 调用失败必须通过 provider-neutral `AgentRuntimeError` 穿过应用边界。Codex adapter 可以在内部捕获 `JsonRpcClientError` 并保存在 `cause` 中，供 Codex-specific handler 读取细节；`app.ts`、routes 和通用服务不能直接判断 Codex JSON-RPC error 类型。

## Codex Adapter 第一阶段

第一阶段的 Codex adapter 不改变 Codex 行为，只做包装和映射：

```text
ThreadService
  -> AgentRuntime
     -> CodexRuntimeAdapter
        -> CodexAppServerManager
           -> codex app-server JSON-RPC
```

Codex adapter 需要保证：

- `provider = 'codex'`
- `providerSessionId` 映射 Codex app-server 的 `threadId`
- `providerTurnId` 映射 Codex app-server 的 `turnId`
- `startSession()` 内部仍调用 `thread/start`
- `readSession()` 内部仍调用 `thread/read`
- `resumeSession()` 内部仍调用 `thread/resume`
- `startTurn()` 内部仍调用 `turn/start`
- `sendInput()` 在 Codex 中映射为 `turn/steer`
- `interruptTurn()` 内部仍调用 `turn/interrupt`
- `compactSession()` 内部仍调用 `thread/compact/start`
- `forkSession()` 内部仍调用 `thread/fork`
- `rollbackSession()` 内部仍调用 `thread/rollback`
- goals、hook trust、provider request response 作为 optional runtime capability 暴露；Codex adapter 负责映射到 `thread/goal/*`、`hooks/trust/*` 和 server-initiated JSON-RPC request response。非 Codex provider 可以不声明这些 capability。
- fast mode 仍是 thread settings / provider capability 的组合，不要求所有 provider 等价实现。

Codex capabilities 建议：

```ts
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
```

## Claude Adapter 兼容性约束

虽然第一阶段不接 Claude，但抽象必须能容纳 Claude Agent SDK。

Claude adapter 将来应满足：

- `provider = 'claude'`
- `providerSessionId = Claude session_id`
- `startSession()` 基于 `query({ prompt, options })` 创建 session，并从 init/system message 中捕获 `session_id`。
- `resumeSession()` 基于 SDK resume/session options。
- `startTurn()` 对新 Query 使用 prompt；对活跃 Query 优先用 `streamInput()`。
- `interruptTurn()` 调用活跃 Query 的 `interrupt()`，必要时 `close()`。
- `listSessions()`、`readSession()` 优先使用 SDK 提供的 session/history API，而不是手扫 `.claude` 文件。
- `forkSession()` 可基于 SDK 的 fork/resume-at 能力实现，但必须声明它不是 Codex hard rollback。
- `rewindFiles()` 是 Claude-specific capability，不应映射成 Codex `thread/rollback`。
- `permission.requested` 由 `canUseTool`、permission prompt tool 或等价 callback 生成。
- Claude host settings、`CLAUDE.md`、skills、commands、MCP settings 应走 provider-specific 管理面。

Claude capabilities 预期大致是：

```ts
export const claudeCapabilities: AgentProviderCapabilities = {
  sessions: {
    list: true,
    read: true,
    resume: true,
    importLocal: false,
  },
  turns: {
    start: true,
    streamInput: true,
    steer: false,
    interrupt: true,
    compact: false,
  },
  branching: {
    fork: true,
    hardRollback: false,
    resumeAt: true,
    rewindFiles: true,
  },
  controls: {
    planMode: true,
    permissionRequests: true,
    sandboxMode: false,
    fastServiceTier: false,
    goals: false,
  },
  management: {
    models: true,
    mcpStatus: true,
    skills: true,
    hooks: true,
    hookTrust: false,
    hostConfigFiles: false,
    providerSettings: true,
  },
  usage: {
    contextWindow: false,
    tokenUsage: true,
    costUsd: true,
  },
};
```

具体值应在正式接 Claude 时按 SDK 当前文档和真实行为校准。

## DB 迁移计划

第一阶段直接迁移到 provider-neutral schema。迁移可以分两步落库：先新增并回填 provider 字段，再 rebuild table 删除旧 Codex 字段；但最终 schema 不保留旧字段。

```sql
ALTER TABLE threads ADD COLUMN provider TEXT NOT NULL DEFAULT 'codex';
ALTER TABLE threads ADD COLUMN provider_session_id TEXT;
ALTER TABLE threads ADD COLUMN provider_turn_id TEXT;
```

迁移时回填：

```sql
UPDATE threads
SET provider = 'codex',
    provider_session_id = codex_thread_id,
    provider_turn_id = codex_turn_id
WHERE provider_session_id IS NULL;
```

回填后 rebuild `threads`，删除历史 Codex 列，只保留：

- `provider`
- `provider_session_id`
- `provider_turn_id`

`thread_goals` 同样 rebuild：把历史 Codex session 列迁移为 `provider_session_id`，最终只保留 provider-neutral 字段。Goals 仍是 Codex capability，但本地记录不再使用 Codex 命名。

后续可以再补：

- `thread_turn_metadata.provider`
- `thread_turn_metadata.provider_model_key`
- `thread_provider_state` 表，用于保存 provider-specific opaque state。

## DTO/API 迁移计划

第一阶段 DTO 只保留 provider-neutral 字段：

```ts
export interface ThreadDto {
  id: string;
  workspaceId: string;

  provider: 'codex' | 'claude';
  providerSessionId: string | null;
  activeTurnId: string | null;

  providerCapabilities?: AgentProviderCapabilities;
}
```

新增 provider-neutral API：

```text
GET  /api/agent-runtimes
GET  /api/agent-runtimes/:provider/status
POST /api/agent-runtimes/:provider/restart
GET  /api/agent-runtimes/:provider/models
POST /api/agent-runtimes/:provider/build-restart
```

Thread routes 可以先保持 URL 不变：

```text
POST /api/threads/start
POST /api/threads/:id/prompt
POST /api/threads/:id/interrupt
```

但 request body 需要预留：

```ts
interface CreateThreadInput {
  workspaceId: string;
  title?: string;
  provider?: 'codex' | 'claude'; // default 'codex' in first stage
  model: string;
  approvalMode: ApprovalMode;
}
```

第一阶段服务端只接受或默认 `provider = 'codex'`。如果传入 `claude`，应返回明确的 `501 not implemented` 或 `409 provider unavailable`，不要静默 fallback 到 Codex。

## ThreadService 迁移步骤

### Step 1: 引入 Runtime Registry

新增一个 registry：

```ts
export class AgentRuntimeRegistry {
  constructor(private readonly runtimes: AgentRuntime[]) {}

  get(provider: AgentProviderId): AgentRuntime {
    const runtime = this.runtimes.find((entry) => entry.provider === provider);
    if (!runtime) {
      throw new Error(`Agent provider is not configured: ${provider}`);
    }
    return runtime;
  }

  list() {
    return this.runtimes.map((runtime) => ({
      provider: runtime.provider,
      capabilities: runtime.capabilities,
      status: runtime.getStatus(),
    }));
  }
}
```

`buildApp()` 通过 runtime bootstrap 获得 registry、provider host homes 和 provider-specific local import stores，而不是在应用入口直接构造 `CodexAppServerManager` 或把它注入业务服务。第一阶段 bootstrap 只注册 Codex runtime。

### Step 2: ThreadService 改为依赖 AgentRuntime

`ThreadService` 不再构造时绑定 `CodexAppServerManager`，而是通过每个 thread 的 `provider` 选择 runtime。

迁移顺序：

1. `listModels()` 改为 `runtime.listModels()`，默认使用 Codex runtime。
2. `createThread()` 改为 `runtime.startSession()`。
3. `getThreadDetail()` 内部读 `providerSessionId`，调用 `runtime.readSession()`。
4. `resumeThread()` 改为 `runtime.resumeSession()`。
5. `sendPrompt()` 改为 `runtime.startTurn()` 或 `runtime.sendInput()`。
6. `interruptTurn()` 改为 `runtime.interruptTurn()`。
7. `handleNotification()` 改为 `handleAgentEvent()`。

每一步都保持 Codex adapter 输出与当前 Codex DTO 一致。

### Step 3: Codex-only 功能留在 Codex 服务边界

以下功能第一阶段不要强行通用化：

- `getThreadGoal()`
- `updateThreadGoal()`
- `clearThreadGoal()`
- `ensureGoalsFeatureEnabled()`
- `writeCodexFastMode()`
- Codex host config archive
- Codex hooks trust
- `LocalCodexSessionStore`

这些功能可以保留在 `CodexProviderService` 或 `CodexManagementService`，并由 capabilities 控制 UI 显示。

### Step 4: 前端只做 provider-aware，不做 Claude UI

第一阶段前端只需要：

- 展示 `provider` 和 `providerSessionId`，不再读取旧 Codex session 字段。
- 把 “Copy Codex session ID” 改为 provider-aware 文案，例如 “Copy session ID”；Codex 细节可以留在 tooltip 或 secondary label。
- 从 provider-neutral models/status API 获取数据；完成态不保留旧 `/api/codex/*` runtime 管理入口。
- Slash 工具箱由 backend `managementSchema.toolboxItems` 声明工具槽位，再由 capabilities 和依赖注入的 provider config callbacks 决定是否可用；前端不能把 Codex 的 `/fast`、`/goal`、`/hooks` 等列表当作全局默认。
- Hooks 面板里的默认命令模板也必须来自 backend `managementSchema.hookCommandTemplates`。Codex 可以声明当前 Stop hook JSON 输出模板，但前端组件不能内置 Codex hook 命令作为全局默认。
- 对 Codex-only 控件加 capability guard。

Settings 需要提供 backend selector，默认 Codex；后端未配置的 provider 可以显示为不可用，但不能让不可用 provider 的 Codex-only 工具露出。

## 权限模型迁移

当前 pending request UI 可以保留，但内部记录要从 Codex server request id 泛化：

```ts
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

interface PendingAgentRequestRecord {
  provider: AgentProviderId;
  providerSessionId: string;
  providerTurnId: string | null;
  providerRequestId: string | number;
  responseKind: string;
  request: ThreadActionRequestDto;
  respond: (input: RespondThreadActionRequestInput) => Promise<void>;
}
```

Codex adapter 的 `respondToProviderRequest()` 内部调用 JSON-RPC `respondToServerRequest(id, result)`。

Claude adapter 将来的 `respond` 内部 resolve `canUseTool` 或 permission callback。

这样 UI 不关心 provider 的批准机制，只关心统一的 `ThreadActionRequestDto`。

## 历史 Item 模型

`ThreadHistoryItemDto` 目前已经比较接近 provider-neutral，可以继续使用：

- `userMessage`
- `agentMessage`
- `image`
- `plan`
- `contextCompaction`
- `reasoning`
- `commandExecution`
- `webSearch`
- `fileChange`
- `hook`
- `toolCall`
- `other`

需要新增或保留几个 provider-aware 字段：

```ts
interface ThreadHistoryItemDto {
  provider?: 'codex' | 'claude';
  providerItemType?: string | null;
  providerToolName?: string | null;
  providerRawKind?: string | null;
}
```

第一阶段可以不暴露 raw payload，只记录必要的 item type/tool name，方便后续 Claude tool mapping。

## 附件策略

当前附件策略是把上传文件写到 workspace `.temp/threads/<threadId>/...`，然后把 prompt placeholder 改写成 `[PHOTO ./path]` 或 `[FILE ./path]`。

第一阶段保持 Codex 行为不变。抽象层需要预留：

```ts
interface AgentPromptAttachment {
  kind: 'photo' | 'file';
  originalName: string;
  absPath: string;
  relativePath: string;
  mimeType?: string | null;
}
```

Codex adapter 可以继续把附件作为 prompt text path token。Claude adapter 将来应按 SDK 支持的输入形态决定是传路径、结构化 content，还是禁用附件能力。

## 测试策略

第一阶段必须以“不破坏 Codex”为核心验收。

### Unit tests

- `CodexRuntimeAdapter` 方法到 `CodexAppServerManager` 方法的映射。
- Codex notification 到 `AgentEvent` 的映射。
- pending permission request 的 provider-neutral 记录和 response。
- Codex raw history item 到 `ThreadHistoryItemDto` 的映射。
- `ThreadService` 在 Codex provider 下创建、读取、发送、停止的行为不变。

### API tests

- 新 `/api/agent-runtimes/codex/status`、`/api/agent-runtimes/codex/models`、`/api/agent-runtimes/codex/build-restart` 可用。
- 应用代码和测试 fixture 不再依赖旧 `/api/codex/*` runtime 管理路由。
- `POST /api/threads/start` 默认创建 Codex thread。
- `POST /api/threads/start` 传 `provider: 'claude'` 时返回明确 provider unavailable，而不是创建 Codex thread。

### Migration tests

- 旧数据库迁移后 `provider = 'codex'`。
- 历史 Codex session id 能回填到 `provider_session_id`。
- 历史 Codex turn id 能回填到 `provider_turn_id`。
- `threads` 最终 schema 不再包含历史 Codex session/turn 列。
- `thread_goals` 最终 schema 使用 `provider_session_id`。
- `ThreadDto` 不再输出旧 Codex session 字段。

### Integration smoke

- 真实 `codex app-server` 下创建 thread。
- 发送 prompt 并接收 streaming delta。
- interrupt 生效。
- resume/read 旧 thread 生效。
- `/goal`、`/fast`、`/skills`、`/mcp`、hooks trust 至少做冒烟，确认 Codex-only 路径未被 runtime 抽象破坏。

## 实施阶段

### Phase A: Runtime Contract

- 新增 `AgentRuntime`、`AgentEvent`、capabilities 类型。
- 新增 `AgentRuntimeRegistry`。
- 不改现有行为。
- Codex 仍直接由旧路径驱动。

### Phase B: Codex Adapter

- 新增 `CodexRuntimeAdapter` 包装 `CodexAppServerManager`。
- Codex adapter 输出 provider-neutral notification/request envelope，原始 Codex payload 只保存在 raw 字段中。
- 测试 adapter 映射。

### Phase C: ThreadService 改造

- `ThreadService` 依赖 registry/runtime。
- 创建、读取、恢复、发送、停止改走 `AgentRuntime`。
- Codex-only 功能暂留 provider-specific helper/adapter 边界。
- Codex raw turn/item timeline 映射放在 `apps/supervisor-api/src/codex/history-items.ts`，不要留在主 `ThreadService`。
- Codex raw server request/approval 映射放在 `packages/codex/src/requestMapper.ts`，由 `CodexRuntimeAdapter` 通过 `mapProviderRequest()`、`buildProviderRequestResponse()` 和 `respondToProviderRequest()` 暴露；`ThreadService` 只负责登记本地 pending request 和调用 runtime responder。
- 确保现有 Codex tests 通过。

### Phase D: DB/DTO/API 字段迁移

- 新增 `provider`、`providerSessionId`、`providerTurnId`。
- 新增 provider-neutral runtime status/models API。
- rebuild DB 表移除旧 Codex session/turn 字段。
- shared DTO 和前端 fixture 移除旧 Codex session 字段。
- 移除旧 `/api/codex/*` runtime 管理入口；应用代码和测试只能走 provider-neutral route。

### Phase E: Capability Guards

- 前端根据 capabilities 控制显示：
  - Codex provider 显示 goals、fast、compact、fork、Codex config、Codex hooks trust。
  - 非 Codex provider 默认隐藏这些入口。
- 第一阶段仍然只配置 Codex runtime。

### Phase F: Claude Readiness Review

在真正写 Claude adapter 前，必须完成一次 review：

- Codex 全量 smoke 是否通过。
- `ThreadService` 是否已经不直接依赖 `CodexAppServerManager`。
- 是否仍有应用代码或测试 fixture 直接读取旧 Codex session/turn 字段。
- capabilities 是否能隐藏 Codex-only UI。
- DB 中 provider fields 是否完整回填。
- 是否有明确的 Claude auth/settings/product naming 决策。

只有这些通过后，才开始 `packages/agent-runtime-claude`。

## 风险与约束

### 不要做 Big Bang rename

项目名、包名、路由名、DTO 名可以逐步迁移。第一阶段强行把所有 `Codex` 文案和类型改成 `Agent` 会制造巨大测试 churn，也容易破坏已工作的 Codex 功能。

### 不要把 goals 做成假通用能力

Codex `/goal` 是上游 app-server 原语。Claude 没有同名等价能力。第一阶段 goals 继续是 Codex capability，非 Codex provider 隐藏。

### 不要把 rollback 语义混在一起

Codex `thread/rollback`、Claude `forkSession/resumeSessionAt/rewindFiles` 是不同语义：

- Codex rollback 偏 thread history 裁剪。
- Claude rewind 偏文件 checkpoint 回滚。
- Claude fork/resumeAt 偏 session 分支或从历史点继续。

UI 可以共用“分支/恢复”入口，但底层 capability 必须区分。

### 不要把 permission request 绑定到 JSON-RPC id

Codex approval 是 server-initiated JSON-RPC request。Claude approval 更可能是 SDK callback/promise。统一 pending request 模型应保存 provider-neutral request id 和 responder callback。

### 不要在接 Claude 前改坏 Codex host management

`~/.codex/config.toml`、`auth.json`、Codex hooks trust、fast mode 都是现有核心功能。第一阶段只加 guard 和边界，不做功能重写。

## 第一阶段完成标准

第一阶段完成时，应满足：

- Codex 是通过 `AgentRuntime` 路径运行，而不是 `ThreadService -> CodexAppServerManager` 直连。
- 数据库新 thread 写入 `provider = 'codex'`、`providerSessionId` 和 `providerTurnId`。
- 数据库最终 schema 不保留旧 Codex session/turn 字段。
- shared DTO 和前端状态不再输出或依赖旧 Codex session 字段。
- 旧 `/api/codex/*` runtime 管理入口不作为完成态保留；现有 UI、API helper 和测试都走 provider-neutral route。
- 新 provider-neutral API 可返回 Codex runtime status/models/capabilities。
- 现有 Codex 创建、恢复、发送、停止、streaming、compact、fork、goal、fast、skills、MCP、hooks trust 冒烟通过。
- 前端没有暴露不可用的 Claude 入口。
- Claude adapter 仍未接入，但抽象层已有明确落点。

## 当前落地状态

当前实现已经落到代码中的边界：

- `packages/agent-runtime` 提供 `AgentRuntime`、`AgentRuntimeRegistry`、capabilities、management schema、provider-neutral `AgentRuntimeEvent`、provider request envelope 和 `AgentRuntimeError`。
- `packages/codex/src/runtimeAdapter.ts` 提供第一阶段唯一启用的 Codex adapter，包装 `CodexAppServerManager`，并声明 Codex 的 toolbox、host config、hook command templates 和 capabilities。
- `packages/codex/src/runtimeAdapter.ts` 把 Codex JSON-RPC notification 映射成 provider-neutral `AgentRuntimeEvent`；主业务服务不再 switch Codex notification method。
- `apps/supervisor-api/src/agent-runtime-bootstrap.ts` 负责注册 runtime；应用生命周期启动/停止 registry 中的 runtime。
- `apps/supervisor-api/src/thread-service.ts` 通过 runtime registry 创建、读取、恢复、发送、停止和管理 session/turn，不再直接注入 `CodexAppServerManager`。
- `apps/supervisor-api/src/thread-service.ts` 监听 runtime `event`，按 `AgentRuntimeEvent.type` 更新本地 DB/WebSocket 事件。
- `apps/supervisor-api/src/thread-service.ts` 的 detail 构建、list、resume、fork 和 pending steer 对账使用 `AgentSessionDetail` / `AgentTurn`，不再把 `rawSession` cast 回 Codex thread/turn 类型。
- Codex-specific history item 映射已移入 `packages/codex/src/historyItems.ts` 和 `packages/codex/src/hookHistory.ts`；`CodexRuntimeAdapter` 输出的 `AgentTurn.items`、`item.started/completed`、`hook.started/completed` 已经是 provider-neutral history item，不再要求 `ThreadService` 理解 Codex raw turn item schema。
- Codex-specific approval/server request 映射已移入 `packages/codex/src/requestMapper.ts`，并由 `packages/codex/src/runtimeAdapter.ts` 作为 runtime-level mapping/response methods 暴露。
- Codex JSON-RPC error unwrap/classification 已移入 `apps/supervisor-api/src/codex/runtime-errors.ts`；app 边界只识别 provider-neutral `AgentRuntimeError`。
- DB、shared DTO、API helper 和前端状态使用 `provider`、`providerSessionId`、`providerTurnId` / `activeTurnId`，旧 Codex session/turn 字段只允许出现在历史 migration 中。
- Runtime 管理 API 走 `/api/agent-runtimes/:provider/*`；旧 `/api/codex/*` 管理路由不保留为完成态兼容层。
- 前端 settings 有 backend selector，默认 `codex`；slash toolbox、host config、build restart、hook command templates 由 runtime capabilities/management schema 驱动。

当前仍属于 Codex adapter 内部或待继续收口的部分：

- `ThreadService` 仍会接收 runtime `provider-request` envelope，但 provider-specific schema mapping 已在 runtime adapter 内完成；后续如果要进一步收口，可以把 pending request 创建也改为 runtime 直接发 `permission.requested` event。
- Codex-only 产品功能仍保留 provider guard：local Codex import、`/goal`、fast mode、hooks trust、Codex host config、Codex rollback/fork。
- Claude adapter 尚未实现；第一阶段只要求抽象边界能合理承接 Claude，不能为了 Claude 牺牲现有 Codex 行为。
