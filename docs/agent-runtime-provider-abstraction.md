# Agent Runtime Provider Abstraction

## 背景

当前 Remote Codex Supervisor 的主链路是：

```text
CodexAppServerManager -> ThreadService -> shared DTO/API -> Web UI
```

这条链路已经能稳定服务 Codex，但它把 Codex app-server 的概念直接暴露到了业务层：

- `packages/codex/src/appServerManager.ts` 固定启动 `codex app-server --listen stdio://`，并直接调用 `thread/start`、`turn/start`、`turn/steer`、`thread/goal/*` 等 Codex JSON-RPC 方法。
- `apps/supervisor-api/src/codex/thread-service.ts` 直接依赖 `CodexAppServerManager`，并按 Codex notification method 更新本地 DB 和 WebSocket 事件。
- `packages/db/src/schema.ts` 使用 `codex_thread_id`、`codex_turn_id`。
- `packages/shared/src/index.ts` 和前端 API 暴露 `CodexStatusDto`、`codexThreadId`、`/api/codex/*` 等 Codex 命名。
- Codex host config、hooks trust、fast mode、local Codex session import 都是 provider-specific 能力。

因此，兼容 Claude 的第一步不应该是直接接入 Claude Agent SDK。更稳的路线是先建立一个 provider-neutral Agent Runtime 抽象，把 Codex app-server 包成第一个 adapter，并保持现有 Codex 行为不变。Claude adapter 只在抽象边界稳定后再接入。

## 目标

1. 先把 `ThreadService` 从 `CodexAppServerManager` 解耦。
2. 建立一个 Codex 和 Claude 都能合理实现的 `AgentRuntime` 抽象。
3. 第一阶段只实现 Codex adapter，功能行为与当前 Codex 路径保持一致。
4. 使用能力声明控制 UI 和 API，不把 Claude 差异硬塞进 Codex-only 功能。
5. 通过 additive DB/DTO/API 迁移保留向后兼容，避免破坏现有 Codex session。

## 非目标

第一阶段不做：

- 不接入 Claude Agent SDK。
- 不移除 `codexThreadId`、`codexTurnId` 等旧字段。
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

### 4. 迁移必须 additive

第一阶段所有 schema/API 迁移都应该新增字段，不能直接删旧字段。

建议保留：

- `threads.codexThreadId`
- `threads.codexTurnId`
- `threadGoals.codexThreadId`
- `/api/codex/*`
- `ThreadDto.codexThreadId`

同时新增：

- `threads.provider`
- `threads.providerSessionId`
- `threads.providerTurnId`
- `ThreadDto.provider`
- `ThreadDto.providerSessionId`
- provider-neutral status/model/capabilities DTO

旧字段继续给现有前端和测试使用，直到 provider-neutral 字段完全覆盖。

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

也可以为了降低 churn，先不移动 `packages/codex`，而是在 `packages/codex` 内新增 `CodexRuntimeAdapter`。等 `ThreadService` 解耦完成后，再决定是否重命名包。

## AgentRuntime Contract 草案

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
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: string | null;
  items: AgentHistoryItem[];
}

export interface AgentSessionDetail extends AgentSessionSummary {
  turns: AgentTurn[];
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
  readonly capabilities: AgentProviderCapabilities;

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
  listSkills?(input?: { cwds?: string[]; forceReload?: boolean }): Promise<AgentSkillsList[]>;
  listHooks?(input?: { cwds?: string[] }): Promise<AgentHooksList[]>;
}
```

## AgentEvent Contract 草案

`ThreadService` 不应该再 switch Codex JSON-RPC method。adapter 应把 provider 原始事件转换为统一事件：

```ts
export type AgentEvent =
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

Codex server-initiated JSON-RPC request 应映射为 `permission.requested`。第一阶段可以先在 adapter 内继续保留 Codex request id，并提供 `respondToPermissionRequest()` 或等价方法；但 `ThreadService` 不应再直接调用 `respondToServerRequest(id, result)`。

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
- `providerSessionId = codexThreadId`
- `providerTurnId = codexTurnId`
- `startSession()` 内部仍调用 `thread/start`
- `readSession()` 内部仍调用 `thread/read`
- `resumeSession()` 内部仍调用 `thread/resume`
- `startTurn()` 内部仍调用 `turn/start`
- `sendInput()` 在 Codex 中映射为 `turn/steer`
- `interruptTurn()` 内部仍调用 `turn/interrupt`
- `compactSession()` 内部仍调用 `thread/compact/start`
- `forkSession()` 内部仍调用 `thread/fork`
- `rollbackSession()` 内部仍调用 `thread/rollback`
- goals、fast mode、hook trust 可以先留在 Codex-specific service，不必硬塞进通用 runtime。

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

第一阶段新增字段，不删除旧字段：

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

后续可以再补：

- `thread_turn_metadata.provider`
- `thread_turn_metadata.provider_model_key`
- `thread_goals.provider_session_id`
- `thread_provider_state` 表，用于保存 provider-specific opaque state。

`threadGoals.codexThreadId` 第一阶段先不动，因为 goals 仍是 Codex-only 能力。真正接 Claude 时，Claude provider 不应创建 `threadGoals` 记录，除非先做 provider-neutral goal 产品设计。

## DTO/API 迁移计划

第一阶段 DTO 采用并行字段：

```ts
export interface ThreadDto {
  id: string;
  workspaceId: string;

  provider: 'codex' | 'claude';
  providerSessionId: string | null;
  providerTurnId?: string | null;

  // Legacy compatibility.
  codexThreadId: string | null;

  providerCapabilities?: AgentProviderCapabilities;
}
```

新增 provider-neutral API：

```text
GET  /api/agent-runtimes
GET  /api/agent-runtimes/:provider/status
POST /api/agent-runtimes/:provider/restart
GET  /api/agent-runtimes/:provider/models
```

旧 API 保留为 Codex alias：

```text
GET  /api/codex/status  -> /api/agent-runtimes/codex/status
POST /api/codex/restart -> /api/agent-runtimes/codex/restart
GET  /api/codex/models  -> /api/agent-runtimes/codex/models
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

`buildApp()` 注入 registry，而不是直接注入 `CodexAppServerManager` 给业务服务。第一阶段 registry 只有 Codex runtime。

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

- 展示 `provider` 和 `providerSessionId` 时兼容旧字段。
- 把 “Copy Codex session ID” 改为 provider-aware 文案，例如 “Copy session ID”；Codex 细节可以留在 tooltip 或 secondary label。
- 从 provider-neutral models/status API 获取数据，旧 API 保留。
- 对 Codex-only 控件加 capability guard。

不需要新增 Claude provider 选择器，除非后端已经能返回可用 provider 列表。

## 权限模型迁移

当前 pending request UI 可以保留，但内部记录要从 Codex server request id 泛化：

```ts
interface PendingAgentRequestRecord {
  provider: AgentProviderId;
  providerSessionId: string;
  providerTurnId: string | null;
  requestId: string;
  responseKind: string;
  request: ThreadActionRequestDto;
  respond: (input: RespondThreadActionRequestInput) => Promise<void>;
}
```

Codex adapter 的 `respond` 内部调用 JSON-RPC `client.respond(id, result)`。

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
- `ThreadService` 在 Codex provider 下创建、读取、发送、停止的行为不变。

### API tests

- 旧 `/api/codex/status`、`/api/codex/models` 仍可用。
- 新 `/api/agent-runtimes/codex/status`、`/api/agent-runtimes/codex/models` 可用。
- `POST /api/threads/start` 默认创建 Codex thread。
- `POST /api/threads/start` 传 `provider: 'claude'` 时返回明确 provider unavailable，而不是创建 Codex thread。

### Migration tests

- 旧数据库中只有 `codex_thread_id` 时，迁移后 `provider = 'codex'`。
- 旧数据库中 `codex_thread_id` 能回填到 `provider_session_id`。
- 旧 DTO 的 `codexThreadId` 仍然有值。

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
- Codex adapter 输出 provider-neutral events。
- 测试 adapter 映射。

### Phase C: ThreadService 改造

- `ThreadService` 依赖 registry/runtime。
- 创建、读取、恢复、发送、停止改走 `AgentRuntime`。
- Codex-only 功能暂留原 Codex 管理服务。
- 确保现有 Codex tests 通过。

### Phase D: DB/DTO/API 并行字段

- 新增 `provider`、`providerSessionId`、`providerTurnId`。
- 新增 provider-neutral runtime status/models API。
- 旧 Codex API 保留 alias。
- 前端使用新字段但兼容旧字段。

### Phase E: Capability Guards

- 前端根据 capabilities 控制显示：
  - Codex provider 显示 goals、fast、compact、fork、Codex config、Codex hooks trust。
  - 非 Codex provider 默认隐藏这些入口。
- 第一阶段仍然只配置 Codex runtime。

### Phase F: Claude Readiness Review

在真正写 Claude adapter 前，必须完成一次 review：

- Codex 全量 smoke 是否通过。
- `ThreadService` 是否已经不直接依赖 `CodexAppServerManager`。
- 是否仍有新代码直接读取 `codexThreadId` 作为主路径。
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
- 数据库新 thread 同时写入 `provider = 'codex'` 和 `providerSessionId = codexThreadId`。
- 旧 Codex API 和旧 DTO 字段仍然可用。
- 新 provider-neutral API 可返回 Codex runtime status/models/capabilities。
- 现有 Codex 创建、恢复、发送、停止、streaming、compact、fork、goal、fast、skills、MCP、hooks trust 冒烟通过。
- 前端没有暴露不可用的 Claude 入口。
- Claude adapter 仍未接入，但抽象层已有明确落点。

