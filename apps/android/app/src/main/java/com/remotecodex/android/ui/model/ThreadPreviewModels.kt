package com.remotecodex.android.ui.model

enum class ThreadStatus {
    Running,
    Complete,
    Failed,
    Waiting,
}

enum class MessageAuthor {
    User,
    Assistant,
}

enum class ToolStatus {
    Running,
    Completed,
    Failed,
}

enum class PlanStepStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Unknown,
}

data class StatusBadgeModel(
    val label: String,
    val status: ThreadStatus,
)

data class ToolCallPreview(
    val name: String,
    val status: ToolStatus,
    val parameters: List<Pair<String, String>>,
    val result: String?,
)

data class MessagePreview(
    val author: MessageAuthor,
    val status: ThreadStatus?,
    val timeLabel: String,
    val text: String,
    val richText: String = text,
    val toolCall: ToolCallPreview? = null,
    val reasoningItems: List<ReasoningPreview> = emptyList(),
    val historyItems: List<HistoryItemPreview> = emptyList(),
    val historyGroups: List<HistoryGroupPreview> = emptyList(),
)

data class ReasoningPreview(
    val text: String,
    val status: ToolStatus,
)

enum class HistoryItemKind {
    Plan,
    Context,
    Command,
    ToolCall,
    AgentTool,
    SkillTool,
    WebSearch,
    FileRead,
    FileChange,
    Image,
    Artifact,
    Hook,
    Generic,
}

data class HistoryItemPreview(
    val id: String? = null,
    val kind: HistoryItemKind,
    val title: String,
    val status: ToolStatus?,
    val summary: String,
    val detail: String?,
    val actionLabel: String?,
    val meta: String? = null,
    val changedFiles: Int? = null,
    val addedLines: Int? = null,
    val removedLines: Int? = null,
    val assetPath: String? = null,
    val imageLabel: String? = null,
    val hookEventLabel: String? = null,
    val hookStatusMessage: String? = null,
    val hookOutput: String? = null,
    val artifactType: String? = null,
    val artifactTitle: String? = null,
    val artifactSummary: String? = null,
    val artifactHasRenderer: Boolean = true,
    val hasDeferredDetail: Boolean = false,
)

data class HistoryGroupPreview(
    val kind: HistoryItemKind,
    val title: String,
    val countLabel: String,
    val statusLabel: String?,
    val items: List<HistoryItemPreview>,
    val changedFiles: Int? = null,
    val addedLines: Int? = null,
    val removedLines: Int? = null,
    val expandedByDefault: Boolean = false,
)

data class DetailPreview(
    val title: String,
    val text: String,
    val image: DetailImagePreview? = null,
)

data class DetailImagePreview(
    val path: String,
    val contentType: String?,
    val bytes: ByteArray,
    val filename: String? = null,
)

data class InlineImagePreview(
    val source: String,
    val contentType: String?,
    val bytes: ByteArray,
    val filename: String? = null,
)

sealed interface DetailRequest {
    val fallback: DetailPreview

    data class Local(
        override val fallback: DetailPreview,
    ) : DetailRequest

    data class HistoryItem(
        val itemId: String,
        override val fallback: DetailPreview,
    ) : DetailRequest

    data class ImageAsset(
        val path: String,
        override val fallback: DetailPreview,
    ) : DetailRequest
}

data class TurnPreview(
    val index: Int,
    val timeLabel: String,
    val statusLabel: String,
    val tokenSummary: String,
    val messages: List<MessagePreview>,
    val livePlan: LivePlanPreview? = null,
    val optimistic: Boolean = false,
)

data class LivePlanPreview(
    val title: String,
    val explanation: String?,
    val steps: List<LivePlanStepPreview>,
)

data class LivePlanStepPreview(
    val step: String,
    val status: PlanStepStatus,
)

data class ExportTurnPreview(
    val id: String,
    val number: Int,
    val timeLabel: String,
    val status: ThreadStatus,
    val promptPreview: String,
    val selected: Boolean = true,
)

data class ThreadDetailPreview(
    val title: String,
    val workspace: String,
    val branch: String,
    val runtime: String,
    val usage: String,
    val items: String,
    val rooms: List<ThreadRoomPreview>,
    val turns: List<TurnPreview>,
    val timelineAuxiliary: TimelineAuxiliaryPreview = TimelineAuxiliaryPreview(),
    val pendingRequests: List<PendingRequestPreview> = emptyList(),
    val exportTurns: List<ExportTurnPreview> = emptyList(),
    val workspacePreview: WorkspacePreview,
    val shellPreview: ShellPreview,
    val composer: ComposerPreview = ComposerPreview(),
)

data class ComposerPreview(
    val activeView: ComposerActiveView = ComposerActiveView.Chat,
    val busy: Boolean = true,
    val threadConnected: Boolean = true,
    val followTail: Boolean = true,
    val canInterrupt: Boolean = true,
    val error: String? = null,
    val workspaceModeLabel: String = "workspace write",
    val prompt: ComposerPromptPreview = ComposerPromptPreview(),
    val context: ComposerContextPreview = ComposerContextPreview(),
    val reasoningEffort: String = "medium",
    val supportedReasoningEffortCount: Int = 3,
    val settingsBusy: Boolean = false,
    val fastMode: Boolean = false,
    val planModeAvailable: Boolean = true,
    val planModeActive: Boolean = false,
    val modelOptions: List<ComposerModelOptionPreview> = defaultComposerModelOptions,
    val reasoningEffortOptions: List<ComposerReasoningEffortOptionPreview> = defaultComposerReasoningEffortOptions,
    val shellControl: ComposerShellControlPreview = ComposerShellControlPreview(),
    val compactBusy: Boolean = false,
    val forkBusy: Boolean = false,
    val forkTurnOptions: ComposerForkTurnOptionsPreview = ComposerForkTurnOptionsPreview(),
    val goalComposeMode: Boolean = false,
    val goalStatus: ThreadGoalStatusPreview? = ThreadGoalStatusPreview.Active,
    val goalPanel: ComposerGoalPanelPreview = ComposerGoalPanelPreview(),
    val slashPanelView: ComposerSlashPanelViewPreview = ComposerSlashPanelViewPreview.Root,
    val toolboxItems: List<ComposerToolboxItemPreview> = defaultComposerToolboxItems,
    val skillsPanel: ComposerSkillsPanelPreview = ComposerSkillsPanelPreview(),
    val mcpPanel: ComposerMcpPanelPreview = ComposerMcpPanelPreview(),
    val hooksPanel: ComposerHooksPanelPreview = ComposerHooksPanelPreview(),
)

data class ComposerShellControlPreview(
    val shellInputEnabled: Boolean = true,
    val commandRunning: Boolean = true,
)

enum class ComposerAttachmentKindPreview {
    Photo,
    File,
}

data class ComposerPromptAttachmentPreview(
    val clientId: String,
    val kind: ComposerAttachmentKindPreview,
    val name: String,
    val placeholder: String,
)

data class ComposerPromptPreview(
    val text: String = "",
    val placeholder: String = "Ask the backend to inspect, modify, or explain code...",
    val disabled: Boolean = false,
    val attachments: List<ComposerPromptAttachmentPreview> = defaultComposerPromptAttachments,
)

val defaultComposerPromptAttachments = listOf(
    ComposerPromptAttachmentPreview(
        clientId = "photo-shell-preview",
        kind = ComposerAttachmentKindPreview.Photo,
        name = "shell-preview.png",
        placeholder = "[PHOTO shell-preview.png]",
    ),
    ComposerPromptAttachmentPreview(
        clientId = "file-android-client-architecture",
        kind = ComposerAttachmentKindPreview.File,
        name = "android-client-architecture.md",
        placeholder = "[FILE android-client-architecture.md]",
    ),
)

enum class ThreadGoalStatusPreview {
    Active,
    Paused,
    BudgetLimited,
    Complete,
    Terminated,
}

data class ThreadGoalPreview(
    val objective: String,
    val status: ThreadGoalStatusPreview,
    val tokenBudget: Int? = null,
    val tokensUsed: Int = 0,
)

data class ComposerGoalPanelPreview(
    val composeMode: Boolean = false,
    val tokenBudget: Int? = 12_500,
    val busy: Boolean = false,
    val localError: String? = null,
    val updateAvailable: Boolean = true,
    val currentGoal: ThreadGoalPreview? = defaultThreadGoalPreview,
    val fastMode: Boolean = false,
)

data class ComposerForkTurnOptionsPreview(
    val status: ComposerPanelLoadStatusPreview = ComposerPanelLoadStatusPreview.Ready,
    val error: String? = null,
    val turns: List<ComposerForkTurnOptionPreview> = defaultComposerForkTurnOptions,
)

data class ComposerForkTurnOptionPreview(
    val turnId: String,
    val turnIndex: Int,
    val status: String,
)

val defaultComposerForkTurnOptions = listOf(
    ComposerForkTurnOptionPreview(turnId = "turn-12", turnIndex = 12, status = "completed"),
    ComposerForkTurnOptionPreview(turnId = "turn-11", turnIndex = 11, status = "interrupted"),
    ComposerForkTurnOptionPreview(turnId = "turn-10", turnIndex = 10, status = "failed"),
)

val defaultThreadGoalPreview = ThreadGoalPreview(
    objective = "Keep Android client parity moving through composer and control surface gaps.",
    status = ThreadGoalStatusPreview.Active,
    tokenBudget = 12_500,
    tokensUsed = 4_200,
)

enum class ComposerToolboxActionPreview {
    Fast,
    Compact,
    Goal,
    Fork,
    Skills,
    Mcp,
    Hooks,
}

enum class ComposerSlashPanelViewPreview {
    Root,
    Skills,
    Mcp,
    Hooks,
    Fork,
    ForkTurns,
}

data class ComposerToolboxItemPreview(
    val action: ComposerToolboxActionPreview,
    val command: String,
    val label: String,
    val description: String?,
)

val defaultComposerToolboxItems = listOf(
    ComposerToolboxItemPreview(
        action = ComposerToolboxActionPreview.Fast,
        command = "/fast",
        label = "Fast mode",
        description = "Toggle fast execution defaults for this thread.",
    ),
    ComposerToolboxItemPreview(
        action = ComposerToolboxActionPreview.Compact,
        command = "/compact",
        label = "Compact thread",
        description = "Run backend context compaction when the thread is idle.",
    ),
    ComposerToolboxItemPreview(
        action = ComposerToolboxActionPreview.Goal,
        command = "/goal",
        label = "Goal",
        description = "Create or update the active thread goal.",
    ),
    ComposerToolboxItemPreview(
        action = ComposerToolboxActionPreview.Fork,
        command = "/fork",
        label = "Fork",
        description = "Start a new thread from the latest or selected turn.",
    ),
    ComposerToolboxItemPreview(
        action = ComposerToolboxActionPreview.Skills,
        command = "/skills",
        label = "Skills",
        description = "Inspect skills and copy invocation names.",
    ),
    ComposerToolboxItemPreview(
        action = ComposerToolboxActionPreview.Mcp,
        command = "/mcp",
        label = "MCP",
        description = "Inspect and add MCP server configuration.",
    ),
    ComposerToolboxItemPreview(
        action = ComposerToolboxActionPreview.Hooks,
        command = "/hooks",
        label = "Hooks",
        description = "Inspect, edit, and trust agent hooks.",
    ),
)

enum class ComposerPanelLoadStatusPreview {
    Idle,
    Loading,
    Ready,
    Failed,
}

enum class ComposerSkillScopePreview {
    Repo,
    System,
    Admin,
    User,
}

data class ComposerSkillPreview(
    val name: String,
    val displayName: String? = null,
    val scope: ComposerSkillScopePreview,
    val description: String,
    val shortDescription: String? = null,
    val interfaceShortDescription: String? = null,
    val path: String,
    val enabled: Boolean = true,
)

data class ComposerSkillErrorPreview(
    val path: String,
    val message: String,
)

data class ComposerSkillsPanelPreview(
    val status: ComposerPanelLoadStatusPreview = ComposerPanelLoadStatusPreview.Ready,
    val error: String? = null,
    val skills: List<ComposerSkillPreview> = defaultComposerSkillPreviews,
    val errors: List<ComposerSkillErrorPreview> = defaultComposerSkillErrors,
    val copiedSkillName: String? = "android-client",
)

val defaultComposerSkillPreviews = listOf(
    ComposerSkillPreview(
        name = "android-client",
        displayName = "Android Client Work",
        scope = ComposerSkillScopePreview.Repo,
        description = "Builds and verifies native Android surfaces against the supervisor UI.",
        interfaceShortDescription = "Builds and verifies native Android surfaces against the supervisor UI.",
        path = "~/.codex/skills/android-client/SKILL.md",
    ),
    ComposerSkillPreview(
        name = "openai-docs",
        displayName = "OpenAI Docs",
        scope = ComposerSkillScopePreview.User,
        description = "Looks up current OpenAI API guidance and returns source-backed answers.",
        shortDescription = "Looks up current OpenAI API guidance.",
        path = "~/.codex/skills/openai-docs/SKILL.md",
    ),
)

val defaultComposerSkillErrors = listOf(
    ComposerSkillErrorPreview(
        path = "~/.codex/skills/local-experiment/SKILL.md",
        message = "Skill metadata incomplete",
    ),
)

enum class ComposerMcpPanelModePreview {
    List,
    Add,
    Http,
    Stdio,
}

enum class ComposerMcpAuthStatusPreview {
    Unsupported,
    NotLoggedIn,
    BearerToken,
    OAuth,
}

data class ComposerMcpToolPreview(
    val name: String,
    val title: String? = null,
)

data class ComposerMcpServerPreview(
    val name: String,
    val authStatus: ComposerMcpAuthStatusPreview,
    val tools: List<ComposerMcpToolPreview>,
    val resourceCount: Int,
    val resourceTemplateCount: Int,
)

data class ComposerMcpPanelPreview(
    val mode: ComposerMcpPanelModePreview = ComposerMcpPanelModePreview.List,
    val status: ComposerPanelLoadStatusPreview = ComposerPanelLoadStatusPreview.Ready,
    val error: String? = null,
    val configPath: String? = "~/.codex/config.toml",
    val configEditing: Boolean = true,
    val configError: String? = null,
    val configSuccess: String? = null,
    val configBusy: Boolean = false,
    val httpName: String = "openaiDeveloperDocs",
    val httpUrl: String = "https://developers.openai.com/mcp",
    val rawBlock: String = "[mcp_servers.docs]\ncommand = \"npx\"\nargs = [\"-y\", \"@modelcontextprotocol/server-filesystem\"]",
    val servers: List<ComposerMcpServerPreview> = defaultComposerMcpServers,
)

val defaultComposerMcpServers = listOf(
    ComposerMcpServerPreview(
        name = "openaiDeveloperDocs",
        authStatus = ComposerMcpAuthStatusPreview.Unsupported,
        tools = listOf(
            ComposerMcpToolPreview(name = "search_openai_docs", title = "Search docs"),
            ComposerMcpToolPreview(name = "fetch_openai_doc", title = "Fetch doc"),
            ComposerMcpToolPreview(name = "get_openapi_spec", title = "OpenAPI spec"),
            ComposerMcpToolPreview(name = "list_api_endpoints", title = "Endpoint list"),
        ),
        resourceCount = 0,
        resourceTemplateCount = 0,
    ),
    ComposerMcpServerPreview(
        name = "local-workspace",
        authStatus = ComposerMcpAuthStatusPreview.BearerToken,
        tools = listOf(
            ComposerMcpToolPreview(name = "read_file", title = "Read file"),
            ComposerMcpToolPreview(name = "list_resources", title = "List resources"),
            ComposerMcpToolPreview(name = "inspect_schema", title = "Inspect schema"),
            ComposerMcpToolPreview(name = "run_task", title = "Run task"),
            ComposerMcpToolPreview(name = "write_note", title = "Write note"),
        ),
        resourceCount = 3,
        resourceTemplateCount = 2,
    ),
)

enum class ComposerHooksPanelModePreview {
    List,
    Add,
    Edit,
}

enum class ComposerHookScopePreview {
    Project,
    Global,
}

enum class ComposerHookEventNamePreview {
    PreToolUse,
    PermissionRequest,
    PostToolUse,
    PreCompact,
    PostCompact,
    SessionStart,
    UserPromptSubmit,
    Stop,
}

enum class ComposerHookHandlerTypePreview {
    Command,
    Prompt,
    Agent,
}

enum class ComposerHookSourcePreview {
    System,
    User,
    Project,
    Mdm,
    SessionFlags,
    Plugin,
    CloudRequirements,
    LegacyManagedConfigFile,
    LegacyManagedConfigMdm,
    Unknown,
}

enum class ComposerHookTrustStatusPreview {
    Managed,
    Untrusted,
    Trusted,
    Modified,
}

data class ComposerHookPreview(
    val key: String,
    val eventName: ComposerHookEventNamePreview,
    val handlerType: ComposerHookHandlerTypePreview,
    val matcher: String?,
    val command: String?,
    val timeoutSec: Int,
    val statusMessage: String?,
    val source: ComposerHookSourcePreview,
    val enabled: Boolean,
    val isManaged: Boolean,
    val currentHash: String?,
    val trustStatus: ComposerHookTrustStatusPreview,
)

data class ComposerHookErrorPreview(
    val path: String,
    val message: String,
)

data class ComposerHookFormPreview(
    val scope: ComposerHookScopePreview = ComposerHookScopePreview.Project,
    val eventName: ComposerHookEventNamePreview = ComposerHookEventNamePreview.PreToolUse,
    val matcher: String = "Bash",
    val command: String = "scripts/check-command.sh",
    val timeoutSec: String = "30",
    val statusMessage: String = "Checking shell command",
    val editingScope: ComposerHookScopePreview? = null,
    val editingEventName: ComposerHookEventNamePreview? = null,
)

data class ComposerHooksPanelPreview(
    val mode: ComposerHooksPanelModePreview = ComposerHooksPanelModePreview.List,
    val status: ComposerPanelLoadStatusPreview = ComposerPanelLoadStatusPreview.Ready,
    val error: String? = null,
    val configError: String? = null,
    val configSuccess: String? = null,
    val configBusy: Boolean = false,
    val hostConfigFilesAvailable: Boolean = true,
    val hookTrustAvailable: Boolean = true,
    val projectHooksPath: String? = ".codex/hooks.json",
    val warnings: List<String> = defaultComposerHookWarnings,
    val errors: List<ComposerHookErrorPreview> = defaultComposerHookErrors,
    val hooks: List<ComposerHookPreview> = defaultComposerHookPreviews,
    val form: ComposerHookFormPreview = ComposerHookFormPreview(),
)

val defaultComposerHookWarnings = listOf(
    "Project hook changed since last trust.",
)

val defaultComposerHookErrors = emptyList<ComposerHookErrorPreview>()

val defaultComposerHookPreviews = listOf(
    ComposerHookPreview(
        key = "project-pretooluse-bash",
        eventName = ComposerHookEventNamePreview.PreToolUse,
        handlerType = ComposerHookHandlerTypePreview.Command,
        matcher = "Bash",
        command = "scripts/check-command.sh",
        timeoutSec = 30,
        statusMessage = "Checking shell command",
        source = ComposerHookSourcePreview.Project,
        enabled = true,
        isManaged = false,
        currentHash = "hash-project",
        trustStatus = ComposerHookTrustStatusPreview.Modified,
    ),
    ComposerHookPreview(
        key = "global-userpromptsubmit",
        eventName = ComposerHookEventNamePreview.UserPromptSubmit,
        handlerType = ComposerHookHandlerTypePreview.Command,
        matcher = null,
        command = "scripts/log-prompt.sh",
        timeoutSec = 10,
        statusMessage = "Prompt audit",
        source = ComposerHookSourcePreview.User,
        enabled = true,
        isManaged = false,
        currentHash = "hash-global",
        trustStatus = ComposerHookTrustStatusPreview.Trusted,
    ),
)

data class ComposerModelOptionPreview(
    val model: String,
    val defaultReasoningEffort: String?,
)

data class ComposerReasoningEffortOptionPreview(
    val reasoningEffort: String,
)

val defaultComposerModelOptions = listOf(
    ComposerModelOptionPreview(model = "gpt-5.4", defaultReasoningEffort = "medium"),
    ComposerModelOptionPreview(model = "gpt-5-codex", defaultReasoningEffort = "high"),
    ComposerModelOptionPreview(model = "gpt-4.1", defaultReasoningEffort = "low"),
)

val defaultComposerReasoningEffortOptions = listOf(
    ComposerReasoningEffortOptionPreview(reasoningEffort = "low"),
    ComposerReasoningEffortOptionPreview(reasoningEffort = "medium"),
    ComposerReasoningEffortOptionPreview(reasoningEffort = "high"),
)

data class ComposerContextPreview(
    val model: String = "gpt-5.4",
    val tokensInContextWindow: Int = 42_800,
    val modelContextWindow: Int = 128_000,
    val remainingPercent: Int = 67,
    val availability: ComposerContextAvailability = ComposerContextAvailability.Available,
)

enum class ComposerContextAvailability {
    Available,
    Unavailable,
}

enum class ComposerActiveView {
    Chat,
    Shell,
}

data class TimelineAuxiliaryPreview(
    val canLoadEarlier: Boolean = false,
    val loadingEarlier: Boolean = false,
    val answeredRequestNotes: List<TimelineNotePreview> = emptyList(),
    val activityNotes: List<TimelineNotePreview> = emptyList(),
    val pendingSteers: List<TimelineSteerPreview> = emptyList(),
    val ephemeralUserNote: String? = null,
)

data class TimelineNotePreview(
    val title: String,
    val summaryLines: List<String>,
    val timeLabel: String? = null,
    val actionLabel: String? = null,
    val sortKey: String? = null,
    val turnId: String? = null,
    val itemId: String? = null,
    val sourceRequestId: String? = null,
)

data class TimelineSteerPreview(
    val prompt: String,
    val statusLabel: String?,
    val timeLabel: String,
)

data class AppShellPreview(
    val productName: String,
    val supervisorLabel: String,
    val connectionLabel: String,
    val defaultBackend: String,
    val navigationItems: List<AppShellNavigationItemPreview>,
    val plugins: List<PluginPreview>,
    val renderers: List<RendererPreview>,
)

data class AppShellNavigationItemPreview(
    val label: String,
    val detail: String,
    val active: Boolean = false,
)

data class PluginPreview(
    val name: String,
    val description: String,
    val capabilities: String,
    val source: String,
    val enabled: Boolean,
)

data class RendererPreview(
    val name: String,
    val description: String,
    val status: String,
)

data class ThreadRoomPreview(
    val id: String,
    val title: String,
    val workspaceLabel: String,
    val status: ThreadStatus,
    val updatedLabel: String,
    val sessionId: String?,
    val active: Boolean = false,
)

enum class PendingRequestKindPreview {
    Approval,
    RequestUserInput,
    PlanDecision,
}

data class PendingRequestPreview(
    val id: String,
    val title: String,
    val description: String,
    val command: String,
    val riskLabel: String,
    val kind: PendingRequestKindPreview = PendingRequestKindPreview.Approval,
    val sortKey: String? = null,
    val busy: Boolean = false,
    val busySelectedOptionLabel: String? = null,
    val turnId: String? = null,
    val itemId: String? = null,
    val questions: List<PendingRequestQuestionPreview> = emptyList(),
)

data class PendingRequestQuestionPreview(
    val header: String,
    val question: String,
    val options: List<PendingRequestOptionPreview> = emptyList(),
    val multiSelect: Boolean = false,
    val allowOther: Boolean = false,
    val id: String? = null,
)

data class PendingRequestOptionPreview(
    val label: String,
    val description: String,
)

enum class WorkspaceNodeKind {
    Directory,
    File,
    Artifact,
    Event,
}

data class WorkspaceNodePreview(
    val name: String,
    val path: String,
    val kind: WorkspaceNodeKind,
    val depth: Int,
    val selected: Boolean = false,
    val expanded: Boolean = false,
)

data class WorkspaceFilePreview(
    val title: String,
    val language: String,
    val sizeLabel: String,
    val truncatedLabel: String?,
    val content: String,
    val path: String = "",
    val sizeBytes: Long? = null,
    val nextOffset: Long? = null,
    val truncated: Boolean = truncatedLabel != null,
)

data class ArtifactPreview(
    val id: String,
    val title: String,
    val type: String,
    val summary: String,
    val format: String,
    val sourcePreview: String,
    val atomCount: Int?,
    val frameCount: Int?,
)

data class WorkspacePreview(
    val title: String,
    val rootLabel: String,
    val nodes: List<WorkspaceNodePreview>,
    val selectedFile: WorkspaceFilePreview,
    val toolEvents: List<ToolCallPreview>,
    val artifact: ArtifactPreview,
    val garbageFiles: List<String> = emptyList(),
    val statusMessage: String? = null,
)

data class ShellPreview(
    val title: String,
    val status: String,
    val prompt: String,
    val lines: List<String>,
    val controls: List<String>,
    val processes: List<ShellProcessPreview>,
    val activeProcessId: String,
    val viewerId: String? = null,
    val connectionLabel: String,
    val inputEnabled: Boolean,
    val commandRunning: Boolean,
)

data class ShellProcessPreview(
    val id: String,
    val label: String,
    val cwd: String,
    val status: String,
    val runningCommand: String?,
    val active: Boolean = false,
)
