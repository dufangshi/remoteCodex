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
)

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
    val pendingRequest: PendingRequestPreview,
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
    val workspaceModeLabel: String = "workspace write",
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
)

data class ComposerShellControlPreview(
    val shellInputEnabled: Boolean = true,
    val commandRunning: Boolean = true,
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

data class PendingRequestPreview(
    val title: String,
    val description: String,
    val command: String,
    val riskLabel: String,
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
)

data class ShellPreview(
    val title: String,
    val status: String,
    val prompt: String,
    val lines: List<String>,
    val controls: List<String>,
    val processes: List<ShellProcessPreview>,
    val activeProcessId: String,
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
