package com.remotecodex.android.ui.presentation

import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.MessageAuthor
import com.remotecodex.android.ui.model.MessagePreview
import com.remotecodex.android.ui.model.LivePlanPreview
import com.remotecodex.android.ui.model.PendingRequestPreview
import com.remotecodex.android.ui.model.PlanStepStatus
import com.remotecodex.android.ui.model.PendingRequestOptionPreview
import com.remotecodex.android.ui.model.ReasoningPreview
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.model.TurnPreview
import com.remotecodex.android.ui.model.ComposerActiveView
import com.remotecodex.android.ui.model.ComposerAttachmentKindPreview
import com.remotecodex.android.ui.model.ComposerContextAvailability
import com.remotecodex.android.ui.model.ComposerContextPreview
import com.remotecodex.android.ui.model.ComposerForkTurnOptionsPreview
import com.remotecodex.android.ui.model.ComposerGoalPanelPreview
import com.remotecodex.android.ui.model.ComposerHookEventNamePreview
import com.remotecodex.android.ui.model.ComposerHookHandlerTypePreview
import com.remotecodex.android.ui.model.ComposerHookScopePreview
import com.remotecodex.android.ui.model.ComposerHookSourcePreview
import com.remotecodex.android.ui.model.ComposerHookTrustStatusPreview
import com.remotecodex.android.ui.model.ComposerHooksPanelModePreview
import com.remotecodex.android.ui.model.ComposerHooksPanelPreview
import com.remotecodex.android.ui.model.ComposerMcpAuthStatusPreview
import com.remotecodex.android.ui.model.ComposerMcpPanelModePreview
import com.remotecodex.android.ui.model.ComposerMcpPanelPreview
import com.remotecodex.android.ui.model.ComposerModelOptionPreview
import com.remotecodex.android.ui.model.ComposerPanelLoadStatusPreview
import com.remotecodex.android.ui.model.ComposerPromptAttachmentPreview
import com.remotecodex.android.ui.model.ComposerPromptPreview
import com.remotecodex.android.ui.model.ComposerReasoningEffortOptionPreview
import com.remotecodex.android.ui.model.ComposerShellControlPreview
import com.remotecodex.android.ui.model.ComposerSkillScopePreview
import com.remotecodex.android.ui.model.ComposerSkillsPanelPreview
import com.remotecodex.android.ui.model.ComposerSlashPanelViewPreview
import com.remotecodex.android.ui.model.ComposerToolboxActionPreview
import com.remotecodex.android.ui.model.ComposerToolboxItemPreview
import com.remotecodex.android.ui.model.ThreadGoalPreview
import com.remotecodex.android.ui.model.ThreadGoalStatusPreview
import com.remotecodex.android.ui.model.ThreadDetailPreview
import com.remotecodex.android.ui.model.TimelineNotePreview
import com.remotecodex.android.ui.model.TimelineSteerPreview
import kotlin.math.round

enum class MessageStatusTone {
    Neutral,
    Running,
    Success,
    Danger,
}

data class MessageStatusModel(
    val label: String,
    val tone: MessageStatusTone,
    val accessibilityLabel: String = "Status: $label",
)

data class GraphChatMessageFrameState(
    val isUser: Boolean,
    val senderLabel: String?,
    val headerStatus: MessageStatusModel?,
    val footerStatus: MessageStatusModel?,
    val showReasoningBeforeContent: Boolean,
    val showFooterMetadata: Boolean,
    val showCopyAction: Boolean,
    val timeLabel: String?,
)

data class GraphChatReasoningAttachmentProjection(
    val messages: List<MessagePreview>,
    val unattachedReasoningItems: List<ReasoningPreview>,
)

sealed interface GraphChatReasoningProjectionInput {
    data class Message(
        val key: String,
        val message: MessagePreview,
    ) : GraphChatReasoningProjectionInput

    data class Reasoning(
        val key: String,
        val reasoning: ReasoningPreview,
    ) : GraphChatReasoningProjectionInput
}

data class GraphChatReasoningState(
    val visible: Boolean,
    val title: String,
    val subtitle: String,
    val text: String,
    val running: Boolean,
    val copyLabel: String,
    val copyAccessibilityLabel: String,
)

enum class PlanStepStatusTone {
    Success,
    Running,
    Danger,
    Pending,
    Unknown,
}

data class PlanStepStatusPresentationState(
    val label: String,
    val accessibilityLabel: String,
    val tone: PlanStepStatusTone,
    val running: Boolean,
)

data class GraphChatLivePlanCardState(
    val title: String,
    val badgeLabel: String,
    val explanation: String?,
    val steps: List<LivePlanStepState>,
)

data class LivePlanStepState(
    val number: Int,
    val text: String,
    val status: PlanStepStatus,
)

data class GraphChatTurnFrameState(
    val indexLabel: String,
    val indexTone: ComposerStatusTone,
    val timeLabel: String,
    val statusLabel: String,
    val status: ThreadStatus,
    val tokenSummary: String?,
    val collapseAccessibilityLabel: String,
    val collapseTitle: String,
    val collapsedSummary: String,
)

data class GraphChatThreadUsageFooterState(
    val transcriptLabel: String,
    val usageLabel: String,
    val accessibilityLabel: String,
)

data class GraphChatHistoryGroupFrameState(
    val title: String,
    val subtitle: String,
    val countBadgeLabel: String,
    val running: Boolean,
    val fileChangeSummarySegments: List<FileChangeSummarySegment>,
    val toggleAccessibilityLabel: String,
    val toggleTargetLabel: String,
)

enum class GraphChatHistoryStatusTone {
    Neutral,
    Running,
    Success,
    Danger,
}

data class GraphChatHistoryStatusState(
    val label: String,
    val tone: GraphChatHistoryStatusTone,
    val accessibilityLabel: String = "Status: $label",
)

data class GraphChatHistoryItemFrameState(
    val title: String,
    val status: GraphChatHistoryStatusState?,
    val summary: String,
    val running: Boolean,
    val runningLabel: String,
    val showDetail: Boolean,
    val showFileChangeDelta: Boolean,
    val fileChangeSummarySegments: List<FileChangeSummarySegment>,
    val fileChangeCanOpen: Boolean,
    val fileChangeOpenAccessibilityLabel: String?,
    val showImagePreview: Boolean,
    val showAction: Boolean,
    val actionLabel: String?,
    val actionAccessibilityLabel: String?,
    val detailTitle: String,
    val showCopy: Boolean,
    val copyText: String,
)

data class GraphChatImageHistoryState(
    val previewLabel: String,
    val assetPath: String?,
    val fallbackSummary: String,
    val openTitle: String,
    val openText: String,
    val pathAccessibilityLabel: String?,
    val copyAccessibilityLabel: String?,
)

data class PendingRequestCardState(
    val title: String,
    val description: String,
    val riskLabel: String,
    val commandLabel: String,
    val command: String,
    val questions: List<PendingRequestQuestionState>,
    val denyLabel: String,
    val approveLabel: String,
    val submitLabel: String,
    val approveAccessibilityLabel: String,
    val submitAccessibilityLabel: String,
    val denyAccessibilityLabel: String,
    val disabledSubmitAccessibilityLabel: String,
)

data class PendingRequestQuestionState(
    val id: String,
    val header: String,
    val question: String,
    val options: List<PendingRequestOptionState>,
    val multiSelect: Boolean,
    val otherLabel: String?,
)

data class PendingRequestOptionState(
    val rawLabel: String,
    val displayLabel: String,
    val description: String,
    val recommended: Boolean,
)

fun pendingRequestQuestionHasAnswer(
    question: PendingRequestQuestionState,
    selectedLabels: Set<String>,
    customAnswer: String,
): Boolean {
    if (question.options.isEmpty() && question.otherLabel == null) {
        return customAnswer.trim().isNotEmpty()
    }
    val otherLabel = question.otherLabel
    if (selectedLabels.isEmpty()) {
        return false
    }
    if (selectedLabels.size == 1 && otherLabel != null && otherLabel in selectedLabels) {
        return customAnswer.trim().isNotEmpty()
    }
    return true
}

enum class TimelineNoteToneState {
    Activity,
    Answered,
}

data class TimelineNoteCardState(
    val label: String,
    val title: String,
    val summaryLines: List<String>,
    val timeLabel: String?,
    val tone: TimelineNoteToneState,
)

enum class PendingSteerToneState {
    QueuedUserMessage,
    Warning,
}

data class AuxiliaryUserNoteCardState(
    val statusLabel: String,
    val footerStatus: MessageStatusModel?,
    val text: String,
    val timeLabel: String?,
    val tone: PendingSteerToneState,
)

data class ContextCompactionHistoryState(
    val primaryText: String,
    val secondaryText: String?,
    val running: Boolean,
)

enum class FileChangeSummaryTone {
    Files,
    Added,
    Removed,
    Neutral,
}

data class FileChangeSummarySegment(
    val label: String,
    val tone: FileChangeSummaryTone,
)

data class InlinePreviewSummary(
    val firstLine: String,
    val showGap: Boolean,
    val isTruncated: Boolean,
)

data class HookHistorySummary(
    val eventTitle: String,
    val hookLabel: String,
    val hookMetaLabel: String,
    val displayText: String,
    val firstLine: String,
    val showGap: Boolean,
    val showMetaLabel: Boolean,
    val outputBacked: Boolean,
)

data class ArtifactHistorySummary(
    val title: String,
    val summary: String,
    val detailText: String,
    val typeLabel: String,
    val rendererLabel: String?,
    val inspectLabel: String?,
    val inspectAccessibilityLabel: String?,
    val collapsedToggleLabel: String,
    val expandedToggleLabel: String,
)

enum class ComposerStatusTone {
    Neutral,
    Running,
    Success,
    Danger,
    Warning,
}

data class ComposerStatusChipModel(
    val label: String,
    val tone: ComposerStatusTone,
)

enum class ComposerPrimaryActionKind {
    Send,
    Stop,
    Connecting,
}

data class ComposerActionState(
    val primaryLabel: String,
    val primaryKind: ComposerPrimaryActionKind,
    val interruptLabel: String,
    val showInterrupt: Boolean,
    val sendEnabled: Boolean,
)

data class ComposerJumpLatestState(
    val visible: Boolean,
    val active: Boolean,
    val accessibilityLabel: String,
    val title: String,
)

data class ComposerFrameState(
    val activeView: ComposerActiveView,
    val formTestTag: String?,
    val jumpLatest: ComposerJumpLatestState,
    val showPromptSlot: Boolean,
    val showGoalSlot: Boolean,
    val showShellPromptSlot: Boolean,
    val errorMessage: String?,
)

data class ComposerContextUsageState(
    val modelLabel: String,
    val usageLabel: String,
    val remainingLabel: String,
    val progressFraction: Float,
    val available: Boolean,
)

data class ComposerPromptAttachmentState(
    val label: String,
    val kind: ComposerAttachmentActionKind,
)

enum class ComposerPromptAttachmentTokenTone {
    Photo,
    File,
}

sealed interface ComposerPromptSegmentState {
    data class Text(
        val key: String,
        val text: String,
    ) : ComposerPromptSegmentState

    data class Attachment(
        val key: String,
        val attachment: ComposerPromptAttachmentState,
        val clientId: String,
        val placeholder: String,
        val tone: ComposerPromptAttachmentTokenTone,
        val newlyInserted: Boolean = false,
        val restoresCaretAfterInsert: Boolean = false,
        val stateDescription: String,
    ) : ComposerPromptSegmentState
}

data class ComposerSubmitAttachmentState(
    val clientId: String,
    val kind: ComposerAttachmentActionKind,
    val name: String,
    val placeholder: String,
)

data class ComposerSubmitInputState(
    val prompt: String,
    val attachments: List<ComposerSubmitAttachmentState> = emptyList(),
)

data class ComposerPromptSelectionRange(
    val start: Int,
    val end: Int,
)

data class ComposerAttachmentInsertionState(
    val prompt: String,
    val selection: ComposerPromptSelectionRange,
    val insertedPlaceholders: List<String>,
    val insertedAttachments: List<ComposerPromptAttachmentPreview> = emptyList(),
    val insertedAttachmentClientIds: List<String> = emptyList(),
)

enum class ComposerPromptPasteActionKind {
    Ignore,
    InsertText,
    AppendFiles,
}

data class ComposerPromptPasteActionState(
    val kind: ComposerPromptPasteActionKind,
    val preventDefault: Boolean,
    val text: String? = null,
    val fileCount: Int = 0,
)

enum class ComposerPromptFileTransferActionKind {
    Ignore,
    AcceptFiles,
}

data class ComposerPromptFileTransferActionState(
    val kind: ComposerPromptFileTransferActionKind,
    val preventDefault: Boolean,
    val activateDragTarget: Boolean,
    val fileCount: Int = 0,
)

data class ComposerPromptKeyDownActionState(
    val preventDefault: Boolean,
    val submit: Boolean,
)

data class ComposerPromptSlotState(
    val chatVisible: Boolean,
    val shellVisible: Boolean,
    val text: String,
    val placeholder: String,
    val showPlaceholder: Boolean,
    val disabled: Boolean,
    val canInterrupt: Boolean,
    val interruptLabel: String,
    val sendButtonLabel: String,
    val sendDisabled: Boolean,
    val attachmentChips: List<ComposerPromptAttachmentState>,
    val inputModeLabel: String,
    val promptSegments: List<ComposerPromptSegmentState> = emptyList(),
)

data class ComposerShellPromptInputState(
    val text: String,
    val placeholder: String,
    val showPlaceholder: Boolean,
    val interruptLabel: String,
    val interruptEnabled: Boolean,
    val sendLabel: String,
    val sendEnabled: Boolean,
    val sendAccessibilityLabel: String,
    val minLines: Int,
)

enum class ComposerToolbarMenuState {
    Slash,
    Attachments,
    Model,
    Effort,
    ShellTools,
}

data class ComposerToolbarButtonState(
    val visible: Boolean,
    val selected: Boolean,
    val enabled: Boolean,
    val label: String,
)

data class ComposerToolbarState(
    val slashButton: ComposerToolbarButtonState,
    val attachmentButton: ComposerToolbarButtonState,
    val shellToolsButton: ComposerToolbarButtonState,
    val modelButton: ComposerToolbarButtonState,
    val effortButton: ComposerToolbarButtonState,
    val viewToggleButton: ComposerToolbarButtonState,
    val shellPromptLabel: String?,
)

data class ComposerSettingsState(
    val modelLabel: String,
    val modelEnabled: Boolean,
    val effortLabel: String,
    val effortEnabled: Boolean,
    val effortTitle: String,
    val settingsBusy: Boolean = false,
    val planVisible: Boolean,
    val planSelected: Boolean,
    val updateActions: ComposerSettingsActionState = ComposerSettingsActionState(),
)

data class ComposerSettingsActionState(
    val displayedCollaborationMode: String = "default",
    val closeMenuOnSuccess: Boolean = true,
    val resetOptimisticModeOnHostChange: Boolean = true,
)

data class ComposerSendButtonState(
    val label: String,
    val accessibilityLabel: String,
    val title: String,
    val enabled: Boolean,
    val primaryKind: ComposerPrimaryActionKind,
)

data class ComposerSettingsToolbarState(
    val modelButton: ComposerToolbarButtonState,
    val modelTitle: String,
    val modelMenuExpanded: Boolean,
    val effortButton: ComposerToolbarButtonState,
    val effortTitle: String,
    val effortMenuExpanded: Boolean,
    val planButton: ComposerToolbarButtonState,
    val planPressed: Boolean,
    val sendButton: ComposerSendButtonState,
    val updateActions: ComposerSettingsActionState,
)

data class ComposerSettingsUpdateDecisionState(
    val optimisticMode: String?,
    val rollbackMode: String?,
    val shouldRollbackMode: Boolean,
    val closeMenuOnSuccess: Boolean,
)

data class ComposerSelectionOptionState(
    val label: String,
    val detail: String,
    val selected: Boolean,
)

enum class ComposerAttachmentActionKind {
    Photo,
    File,
}

enum class ComposerShellToolTone {
    Neutral,
    Info,
    Danger,
}

enum class ComposerShellToolKind {
    Paste,
    Copy,
    Clear,
    CtrlC,
    CtrlD,
    Esc,
    Tab,
    Up,
    Down,
}

data class ComposerAttachmentActionState(
    val label: String,
    val detail: String,
    val kind: ComposerAttachmentActionKind,
)

data class ComposerAttachmentPanelState(
    val open: Boolean,
    val triggerLabel: String,
    val triggerAccessibilityLabel: String,
    val menuVisible: Boolean,
    val actions: List<ComposerAttachmentActionState>,
    val actionCountLabel: String,
    val queuedAttachments: List<ComposerPromptAttachmentState>,
    val queuedCountLabel: String,
    val emptyMessage: String?,
    val previewLifecycle: ComposerAttachmentPreviewLifecycleState,
)

data class ComposerAttachmentPreviewLifecycleState(
    val previewablePhotoClientIds: List<String>,
    val clearsPreviewsInShellView: Boolean,
    val reusesCachedPreviewUrls: Boolean,
    val revokesRemovedPreviewUrls: Boolean,
    val revokesPreviewUrlsOnDispose: Boolean,
    val stateDescription: String,
)

const val COMPOSER_DRAFT_SYNC_DELAY_MS = 180L

enum class ComposerDraftSyncModeState {
    Immediate,
    Deferred,
}

enum class ComposerDraftSyncEventState {
    Update,
    Flush,
    HostRefresh,
    Dispose,
}

data class ComposerDraftState(
    val prompt: String,
    val attachments: List<ComposerPromptAttachmentPreview> = emptyList(),
)

data class ComposerDraftControlState(
    val controlled: Boolean,
    val promptAvailable: Boolean,
    val attachmentsAvailable: Boolean,
    val hostChangeAvailable: Boolean,
    val shellViewForcesUncontrolled: Boolean,
    val localDraftSourceLabel: String,
    val stateDescription: String,
)

data class ComposerDraftSyncDecisionState(
    val controlled: Boolean,
    val event: ComposerDraftSyncEventState,
    val shouldSendToHost: Boolean,
    val shouldScheduleDeferredSync: Boolean,
    val shouldClearPendingTimer: Boolean,
    val shouldUpdateLastSentSignature: Boolean,
    val delayMillis: Long?,
    val nextSignature: String,
    val stateDescription: String,
)

data class ComposerShellToolState(
    val label: String,
    val kind: ComposerShellToolKind,
    val tone: ComposerShellToolTone,
    val enabled: Boolean,
)

data class ComposerShellToolsPanelState(
    val menuVisible: Boolean,
    val title: String,
    val subtitle: String,
    val columnCount: Int,
    val clipboardTools: List<ComposerShellToolState>,
    val controlTools: List<ComposerShellToolState>,
    val tools: List<ComposerShellToolState>,
)

enum class ComposerToolboxItemTone {
    Neutral,
    Active,
    Disabled,
}

enum class ComposerToolboxActionDecisionKind {
    ToggleFast,
    RunCompact,
    EnterGoalCompose,
    ExitGoalCompose,
    OpenPanel,
    Noop,
}

data class ComposerToolboxActionDecisionState(
    val kind: ComposerToolboxActionDecisionKind,
    val targetFastMode: Boolean? = null,
    val targetPanel: ComposerSlashPanelViewState? = null,
    val closeMenu: Boolean = false,
)

enum class ComposerSlashPanelViewState {
    Root,
    Skills,
    Mcp,
    Hooks,
    Fork,
    ForkTurns,
}

data class ComposerToolboxItemState(
    val command: String,
    val label: String,
    val status: String,
    val description: String,
    val enabled: Boolean,
    val tone: ComposerToolboxItemTone,
    val actionDecision: ComposerToolboxActionDecisionState = ComposerToolboxActionDecisionState(
        ComposerToolboxActionDecisionKind.Noop,
    ),
)

data class ComposerSlashToolboxPanelState(
    val menuVisible: Boolean,
    val triggerAccessibilityLabel: String,
    val triggerTitle: String,
    val surfaceVisible: Boolean,
    val title: String,
    val subtitle: String,
    val view: ComposerSlashPanelViewState,
    val showRootItems: Boolean,
    val items: List<ComposerToolboxItemState>,
    val emptyMessage: String?,
)

data class ComposerMenuLifecycleState(
    val shouldResetSlashPanelView: Boolean,
    val shouldResetMcpPanelMode: Boolean,
    val shouldClearMcpConfigStatus: Boolean,
    val shouldClearHookConfigStatus: Boolean,
    val targetSlashPanelView: ComposerSlashPanelViewState?,
    val targetMcpPanelMode: ComposerMcpPanelModePreview?,
)

enum class ComposerForkActionKind {
    Latest,
    SelectedTurn,
}

data class ComposerForkActionState(
    val label: String,
    val status: String,
    val enabled: Boolean,
    val kind: ComposerForkActionKind,
    val startsBusy: Boolean = false,
    val closesMenuOnSuccess: Boolean = true,
    val closesMenuOnFailure: Boolean = false,
)

data class ComposerForkPanelState(
    val actions: List<ComposerForkActionState>,
    val showIdleOnlyNotice: Boolean,
    val notice: String?,
    val turnPicker: ComposerForkTurnPickerState = ComposerForkTurnPickerState(),
    val lifecycle: ComposerForkLifecycleState = ComposerForkLifecycleState(
        forkBusy = false,
        shouldClearBusyWhenLeavingForkTurns = false,
        busyWhileRunning = true,
        closeMenuOnSuccess = true,
        closeMenuOnFailure = false,
    ),
)

data class ComposerForkTurnPickerRowState(
    val turnId: String,
    val title: String,
    val status: String,
    val enabled: Boolean,
)

data class ComposerForkTurnPickerState(
    val loadingMessage: String? = null,
    val errorMessage: String? = null,
    val rows: List<ComposerForkTurnPickerRowState> = emptyList(),
    val emptyMessage: String? = null,
)

data class ComposerForkLifecycleState(
    val forkBusy: Boolean,
    val shouldClearBusyWhenLeavingForkTurns: Boolean,
    val busyWhileRunning: Boolean,
    val closeMenuOnSuccess: Boolean,
    val closeMenuOnFailure: Boolean,
)

data class ComposerSkillRowState(
    val displayName: String,
    val scopeLabel: String,
    val invokeName: String,
    val copyLabel: String,
    val copyAccessibilityLabel: String,
    val copyTitle: String,
    val description: String,
    val copied: Boolean,
    val enabled: Boolean,
)

data class ComposerSkillErrorState(
    val message: String,
    val path: String,
)

data class ComposerSkillsPanelState(
    val loadingMessage: String?,
    val errorMessage: String?,
    val skills: List<ComposerSkillRowState>,
    val errors: List<ComposerSkillErrorState>,
    val emptyMessage: String?,
    val copyLifecycle: ComposerSkillsCopyLifecycleState,
)

data class ComposerSkillsCopyLifecycleState(
    val copiedSkillName: String?,
    val copiedInvokeName: String?,
    val clipboardText: String?,
    val shouldClearCopiedState: Boolean,
    val clearDelayMillis: Long,
)

enum class ComposerMcpStatusTone {
    Neutral,
    Error,
    Success,
}

data class ComposerMcpStatusMessageState(
    val message: String,
    val tone: ComposerMcpStatusTone,
)

data class ComposerMcpAddOptionState(
    val title: String,
    val modeLabel: String,
    val description: String,
    val targetMode: ComposerMcpPanelModePreview,
    val clearsConfigStatus: Boolean,
    val preparesRawBlock: Boolean,
)

data class ComposerMcpServerRowState(
    val name: String,
    val countsLabel: String,
    val authLabel: String,
    val toolPreview: String?,
)

data class ComposerMcpFormState(
    val title: String,
    val primaryLabel: String,
    val primaryEnabled: Boolean,
    val fields: List<Pair<String, String>>,
    val backTargetMode: ComposerMcpPanelModePreview,
    val configBusy: Boolean,
)

data class ComposerMcpPanelState(
    val configSourceTitle: String,
    val configSourceLabel: String,
    val showAddAction: Boolean,
    val mode: ComposerMcpPanelModePreview,
    val statusMessages: List<ComposerMcpStatusMessageState>,
    val addOptions: List<ComposerMcpAddOptionState>,
    val servers: List<ComposerMcpServerRowState>,
    val form: ComposerMcpFormState?,
    val emptyMessage: String?,
    val lifecycle: ComposerMcpPanelLifecycleState,
)

data class ComposerMcpPanelLifecycleState(
    val configEditingAvailable: Boolean,
    val configBusy: Boolean,
    val addTargetMode: ComposerMcpPanelModePreview?,
    val clearsConfigStatusOnAdd: Boolean,
    val backTargetMode: ComposerMcpPanelModePreview?,
    val stateDescription: String,
)

data class ComposerHookStatusMessageState(
    val message: String,
    val tone: ComposerMcpStatusTone,
    val path: String? = null,
)

data class ComposerHookFormState(
    val editingLabel: String?,
    val primaryLabel: String,
    val primaryEnabled: Boolean,
    val fields: List<Pair<String, String>>,
    val backTargetMode: ComposerHooksPanelModePreview,
    val clearsEditingTargetOnBack: Boolean,
    val configBusy: Boolean,
)

data class ComposerHookActionState(
    val label: String,
    val enabled: Boolean,
    val kind: ComposerHookActionKind,
    val clearsConfigStatus: Boolean,
)

enum class ComposerHookActionKind {
    Edit,
    Trust,
    Untrust,
}

data class ComposerHookRowState(
    val title: String,
    val commandLabel: String,
    val statusMessage: String?,
    val editAction: ComposerHookActionState?,
    val trustAction: ComposerHookActionState?,
    val trustLabel: String,
    val sourceLabel: String,
    val enabledLabel: String,
    val timeoutLabel: String,
)

data class ComposerHooksPanelState(
    val configSourceTitle: String,
    val configSourceLabel: String,
    val showAddAction: Boolean,
    val mode: ComposerHooksPanelModePreview,
    val statusMessages: List<ComposerHookStatusMessageState>,
    val form: ComposerHookFormState?,
    val hooks: List<ComposerHookRowState>,
    val emptyMessage: String?,
    val lifecycle: ComposerHooksPanelLifecycleState,
)

data class ComposerHooksPanelLifecycleState(
    val hostConfigFilesAvailable: Boolean,
    val hookTrustAvailable: Boolean,
    val configBusy: Boolean,
    val addTargetMode: ComposerHooksPanelModePreview?,
    val resetsFormOnAdd: Boolean,
    val clearsConfigStatusOnAdd: Boolean,
    val backTargetMode: ComposerHooksPanelModePreview?,
    val clearsEditingTargetOnBack: Boolean,
    val stateDescription: String,
)

data class ComposerGoalComposeCardState(
    val visible: Boolean,
    val label: String,
    val tokenBudgetInputLabel: String,
    val tokenBudgetLabel: String,
    val tokenBudgetPlaceholder: String,
    val errorMessage: String?,
    val primaryLabel: String,
    val primaryEnabled: Boolean,
    val cancelLabel: String,
    val lifecycle: ComposerGoalComposeLifecycleState,
)

data class ComposerCurrentGoalState(
    val title: String,
    val objective: String,
    val statusLabel: String,
    val tokenBudgetLabel: String?,
    val tokenUsageLabel: String?,
)

data class ComposerGoalPanelState(
    val statusLabel: String,
    val description: String,
    val composeCard: ComposerGoalComposeCardState,
    val currentGoal: ComposerCurrentGoalState?,
    val notice: ComposerHookStatusMessageState?,
    val lifecycle: ComposerGoalPanelLifecycleState,
)

data class ComposerGoalComposeLifecycleState(
    val seedsTokenBudgetFromCurrentGoal: Boolean,
    val clearsLocalErrorOnEnter: Boolean,
    val clearsLocalErrorOnExit: Boolean,
    val clearsDraftOnSuccess: Boolean,
    val exitsComposeOnSuccess: Boolean,
    val keepsComposeOpenOnFailure: Boolean,
    val focusesPromptOnEnter: Boolean,
)

data class ComposerGoalPanelLifecycleState(
    val composeMode: Boolean,
    val updateAvailable: Boolean,
    val busy: Boolean,
    val canSubmit: Boolean,
    val canCancel: Boolean,
    val closeMenuOnEnter: Boolean,
    val resetSlashPanelOnEnter: Boolean,
    val openGoalOnEnter: Boolean,
    val stateDescription: String,
)

fun buildComposerGoalPanelState(
    panel: ComposerGoalPanelPreview,
): ComposerGoalPanelState {
    val currentGoal = panel.currentGoal
    val composeCard = ComposerGoalComposeCardState(
        visible = panel.composeMode,
        label = "Goal",
        tokenBudgetInputLabel = "Max tokens (k)",
        tokenBudgetLabel = formatGoalTokenBudgetThousands(panel.tokenBudget),
        tokenBudgetPlaceholder = "Optional",
        errorMessage = panel.localError?.takeIf { it.isNotBlank() },
        primaryLabel = if (panel.busy) "Setting..." else "Set goal",
        primaryEnabled = panel.updateAvailable && !panel.busy,
        cancelLabel = "Cancel",
        lifecycle = buildComposerGoalComposeLifecycleState(panel),
    )
    val statusLabel = when {
        panel.composeMode -> "Composing"
        currentGoal != null -> goalStatusLabel(currentGoal.status)
        panel.updateAvailable -> "Open"
        else -> "Unavailable"
    }
    val notice = when {
        !panel.updateAvailable -> ComposerHookStatusMessageState(
            "/goal is unavailable in this view.",
            ComposerMcpStatusTone.Error,
        )
        panel.fastMode -> ComposerHookStatusMessageState(
            "Fast mode is on. Turn it off from the slash toolbox to edit reasoning.",
            ComposerMcpStatusTone.Neutral,
        )
        else -> null
    }
    return ComposerGoalPanelState(
        statusLabel = statusLabel,
        description = "Create or update the active thread goal.",
        composeCard = composeCard,
        currentGoal = currentGoal?.let(::buildComposerCurrentGoalState),
        notice = notice,
        lifecycle = buildComposerGoalPanelLifecycleState(panel),
    )
}

private fun buildComposerGoalComposeLifecycleState(
    panel: ComposerGoalPanelPreview,
): ComposerGoalComposeLifecycleState {
    return ComposerGoalComposeLifecycleState(
        seedsTokenBudgetFromCurrentGoal = panel.currentGoal?.tokenBudget != null,
        clearsLocalErrorOnEnter = true,
        clearsLocalErrorOnExit = true,
        clearsDraftOnSuccess = true,
        exitsComposeOnSuccess = true,
        keepsComposeOpenOnFailure = true,
        focusesPromptOnEnter = true,
    )
}

private fun buildComposerGoalPanelLifecycleState(
    panel: ComposerGoalPanelPreview,
): ComposerGoalPanelLifecycleState {
    return ComposerGoalPanelLifecycleState(
        composeMode = panel.composeMode,
        updateAvailable = panel.updateAvailable,
        busy = panel.busy,
        canSubmit = panel.composeMode && panel.updateAvailable && !panel.busy,
        canCancel = panel.composeMode && !panel.busy,
        closeMenuOnEnter = true,
        resetSlashPanelOnEnter = true,
        openGoalOnEnter = true,
        stateDescription = buildComposerGoalPanelStateDescription(panel),
    )
}

private fun buildComposerGoalPanelStateDescription(panel: ComposerGoalPanelPreview): String {
    val mode = if (panel.composeMode) "compose" else "summary"
    val availability = if (panel.updateAvailable) "available" else "unavailable"
    val busy = if (panel.busy) ", setting" else ""
    return "Goal panel: $mode, $availability$busy"
}

private fun buildComposerCurrentGoalState(goal: ThreadGoalPreview): ComposerCurrentGoalState {
    val tokenBudgetLabel = goal.tokenBudget?.let { "${formatGoalTokenBudgetThousands(it)}k budget" }
    val tokenUsageLabel = goal.tokenBudget?.let { budget ->
        "${formatContextTokenKilocount(goal.tokensUsed)} / ${formatContextTokenKilocount(budget)} used"
    }
    return ComposerCurrentGoalState(
        title = "Current goal",
        objective = goal.objective,
        statusLabel = goalStatusLabel(goal.status),
        tokenBudgetLabel = tokenBudgetLabel,
        tokenUsageLabel = tokenUsageLabel,
    )
}

fun buildComposerHooksPanelState(
    panel: ComposerHooksPanelPreview,
): ComposerHooksPanelState {
    val statusMessages = buildList {
        if (panel.status == ComposerPanelLoadStatusPreview.Loading && panel.hooks.isEmpty()) {
            add(ComposerHookStatusMessageState("Loading hooks...", ComposerMcpStatusTone.Neutral))
        }
        panel.error?.takeIf { it.isNotBlank() }?.let { error ->
            add(ComposerHookStatusMessageState(error, ComposerMcpStatusTone.Error))
        }
        panel.configError?.takeIf { it.isNotBlank() }?.let { error ->
            add(ComposerHookStatusMessageState(error, ComposerMcpStatusTone.Error))
        }
        panel.configSuccess?.takeIf { it.isNotBlank() }?.let { success ->
            add(ComposerHookStatusMessageState(success, ComposerMcpStatusTone.Success))
        }
        if (panel.mode == ComposerHooksPanelModePreview.List) {
            panel.warnings.forEach { warning ->
                add(ComposerHookStatusMessageState(warning, ComposerMcpStatusTone.Neutral))
            }
            panel.errors.forEach { error ->
                add(ComposerHookStatusMessageState(error.message, ComposerMcpStatusTone.Error, path = error.path))
            }
        }
    }
    val hooks = if (panel.mode == ComposerHooksPanelModePreview.List) {
        panel.hooks.map { hook ->
            val editable = editableHookTargetAvailable(hook.source, hook.handlerType, hook.command, hook.isManaged)
            val canUntrust = panel.hookTrustAvailable &&
                hook.trustStatus == ComposerHookTrustStatusPreview.Trusted &&
                !hook.isManaged
            val canTrust = panel.hookTrustAvailable &&
                !hook.isManaged &&
                hook.currentHash?.isNotBlank() == true &&
                (hook.trustStatus == ComposerHookTrustStatusPreview.Untrusted ||
                    hook.trustStatus == ComposerHookTrustStatusPreview.Modified)
            ComposerHookRowState(
                title = buildString {
                    append(hookEventLabel(hook.eventName))
                    hook.matcher?.takeIf { it.isNotBlank() }?.let { matcher ->
                        append(" · ")
                        append(matcher)
                    }
                },
                commandLabel = hook.command?.takeIf { it.isNotBlank() } ?: hook.handlerType.name.lowercase(),
                statusMessage = hook.statusMessage?.takeIf { it.isNotBlank() },
                editAction = if (editable) {
                    ComposerHookActionState(
                        label = "Edit",
                        enabled = true,
                        kind = ComposerHookActionKind.Edit,
                        clearsConfigStatus = true,
                    )
                } else {
                    null
                },
                trustAction = when {
                    canUntrust -> ComposerHookActionState(
                        label = "Untrust",
                        enabled = !panel.configBusy,
                        kind = ComposerHookActionKind.Untrust,
                        clearsConfigStatus = true,
                    )
                    canTrust -> ComposerHookActionState(
                        label = "Trust",
                        enabled = !panel.configBusy,
                        kind = ComposerHookActionKind.Trust,
                        clearsConfigStatus = true,
                    )
                    else -> null
                },
                trustLabel = hookTrustLabel(hook.trustStatus),
                sourceLabel = hookSourceLabel(hook.source),
                enabledLabel = if (hook.enabled) "Enabled" else "Disabled",
                timeoutLabel = "${hook.timeoutSec}s",
            )
        }
    } else {
        emptyList()
    }
    val empty = panel.mode == ComposerHooksPanelModePreview.List &&
        panel.status != ComposerPanelLoadStatusPreview.Loading &&
        panel.error.isNullOrBlank() &&
        panel.hooks.isEmpty()

    return ComposerHooksPanelState(
        configSourceTitle = "Hook config sources",
        configSourceLabel = panel.projectHooksPath?.takeIf { it.isNotBlank() } ?: "<workspace hooks config>",
        showAddAction = panel.mode == ComposerHooksPanelModePreview.List && panel.hostConfigFilesAvailable,
        mode = panel.mode,
        statusMessages = statusMessages,
        form = buildComposerHookFormState(panel),
        hooks = hooks,
        emptyMessage = if (empty) "No hooks configured for this workspace." else null,
        lifecycle = buildComposerHooksPanelLifecycleState(panel),
    )
}

private fun buildComposerHooksPanelLifecycleState(
    panel: ComposerHooksPanelPreview,
): ComposerHooksPanelLifecycleState {
    val addVisible = panel.mode == ComposerHooksPanelModePreview.List && panel.hostConfigFilesAvailable
    val backTarget = when (panel.mode) {
        ComposerHooksPanelModePreview.Add,
        ComposerHooksPanelModePreview.Edit,
        -> ComposerHooksPanelModePreview.List
        ComposerHooksPanelModePreview.List -> null
    }
    return ComposerHooksPanelLifecycleState(
        hostConfigFilesAvailable = panel.hostConfigFilesAvailable,
        hookTrustAvailable = panel.hookTrustAvailable,
        configBusy = panel.configBusy,
        addTargetMode = if (addVisible) ComposerHooksPanelModePreview.Add else null,
        resetsFormOnAdd = addVisible,
        clearsConfigStatusOnAdd = addVisible,
        backTargetMode = backTarget,
        clearsEditingTargetOnBack = backTarget != null,
        stateDescription = buildComposerHooksPanelStateDescription(panel),
    )
}

private fun buildComposerHooksPanelStateDescription(panel: ComposerHooksPanelPreview): String {
    val mode = when (panel.mode) {
        ComposerHooksPanelModePreview.List -> "list"
        ComposerHooksPanelModePreview.Add -> "add form"
        ComposerHooksPanelModePreview.Edit -> "edit form"
    }
    val editing = if (panel.hostConfigFilesAvailable) "editing available" else "editing unavailable"
    val trust = if (panel.hookTrustAvailable) "trust available" else "trust unavailable"
    val busy = if (panel.configBusy) ", saving" else ""
    return "Hooks panel: $mode, $editing, $trust$busy"
}

private fun buildComposerHookFormState(panel: ComposerHooksPanelPreview): ComposerHookFormState? {
    if (panel.mode != ComposerHooksPanelModePreview.Add && panel.mode != ComposerHooksPanelModePreview.Edit) {
        return null
    }
    val form = panel.form
    val editingLabel = if (panel.mode == ComposerHooksPanelModePreview.Edit) {
        val eventName = form.editingEventName ?: form.eventName
        val scope = form.editingScope ?: form.scope
        "Editing ${hookEventJsonKey(eventName)} in ${hookScopeLabel(scope).lowercase()} hooks.json"
    } else {
        null
    }
    return ComposerHookFormState(
        editingLabel = editingLabel,
        primaryLabel = when {
            panel.configBusy -> "Saving..."
            panel.mode == ComposerHooksPanelModePreview.Edit -> "Update Hook"
            else -> "Write Hook"
        },
        primaryEnabled = !panel.configBusy,
        fields = listOf(
            "Scope" to hookScopeLabel(form.scope),
            "Event" to hookEventLabel(form.eventName),
            "Matcher" to form.matcher,
            "Command" to form.command,
            "Timeout" to "${form.timeoutSec}s",
            "Status" to form.statusMessage,
        ),
        backTargetMode = ComposerHooksPanelModePreview.List,
        clearsEditingTargetOnBack = true,
        configBusy = panel.configBusy,
    )
}

private fun editableHookTargetAvailable(
    source: ComposerHookSourcePreview,
    handlerType: ComposerHookHandlerTypePreview,
    command: String?,
    isManaged: Boolean,
): Boolean {
    val scopeAvailable = source == ComposerHookSourcePreview.User || source == ComposerHookSourcePreview.Project
    return scopeAvailable &&
        handlerType == ComposerHookHandlerTypePreview.Command &&
        !command.isNullOrBlank() &&
        !isManaged
}

fun hookSourceLabel(source: ComposerHookSourcePreview): String {
    return when (source) {
        ComposerHookSourcePreview.CloudRequirements -> "Cloud"
        ComposerHookSourcePreview.LegacyManagedConfigFile,
        ComposerHookSourcePreview.LegacyManagedConfigMdm,
        -> "Managed"
        ComposerHookSourcePreview.SessionFlags -> "Session"
        ComposerHookSourcePreview.System -> "System"
        ComposerHookSourcePreview.User -> "User"
        ComposerHookSourcePreview.Project -> "Project"
        ComposerHookSourcePreview.Mdm -> "Mdm"
        ComposerHookSourcePreview.Plugin -> "Plugin"
        ComposerHookSourcePreview.Unknown -> "Unknown"
    }
}

fun hookTrustLabel(status: ComposerHookTrustStatusPreview): String {
    return when (status) {
        ComposerHookTrustStatusPreview.Managed -> "Managed"
        ComposerHookTrustStatusPreview.Modified -> "Modified"
        ComposerHookTrustStatusPreview.Trusted -> "Trusted"
        ComposerHookTrustStatusPreview.Untrusted -> "Review"
    }
}

fun hookEventLabel(eventName: ComposerHookEventNamePreview): String {
    return hookEventJsonKey(eventName)
}

fun hookEventJsonKey(eventName: ComposerHookEventNamePreview): String {
    return when (eventName) {
        ComposerHookEventNamePreview.PreToolUse -> "PreToolUse"
        ComposerHookEventNamePreview.PermissionRequest -> "PermissionRequest"
        ComposerHookEventNamePreview.PostToolUse -> "PostToolUse"
        ComposerHookEventNamePreview.PreCompact -> "PreCompact"
        ComposerHookEventNamePreview.PostCompact -> "PostCompact"
        ComposerHookEventNamePreview.SessionStart -> "SessionStart"
        ComposerHookEventNamePreview.UserPromptSubmit -> "UserPromptSubmit"
        ComposerHookEventNamePreview.Stop -> "Stop"
    }
}

fun hookScopeLabel(scope: ComposerHookScopePreview): String {
    return when (scope) {
        ComposerHookScopePreview.Project -> "Project"
        ComposerHookScopePreview.Global -> "Global"
    }
}

fun buildComposerMcpPanelState(
    panel: ComposerMcpPanelPreview,
): ComposerMcpPanelState {
    val statusMessages = buildList {
        if (panel.status == ComposerPanelLoadStatusPreview.Loading && panel.servers.isEmpty()) {
            add(ComposerMcpStatusMessageState("Loading MCP servers...", ComposerMcpStatusTone.Neutral))
        }
        panel.error?.takeIf { it.isNotBlank() }?.let { error ->
            add(ComposerMcpStatusMessageState(error, ComposerMcpStatusTone.Error))
        }
        panel.configError?.takeIf { it.isNotBlank() }?.let { error ->
            add(ComposerMcpStatusMessageState(error, ComposerMcpStatusTone.Error))
        }
        panel.configSuccess?.takeIf { it.isNotBlank() }?.let { success ->
            add(ComposerMcpStatusMessageState(success, ComposerMcpStatusTone.Success))
        }
    }
    val servers = if (panel.mode == ComposerMcpPanelModePreview.List) {
        panel.servers.map { server ->
            ComposerMcpServerRowState(
                name = server.name,
                countsLabel = "${server.tools.size} tools · ${server.resourceCount} resources · ${server.resourceTemplateCount} templates",
                authLabel = authStatusLabel(server.authStatus),
                toolPreview = server.tools
                    .take(4)
                    .map { it.title?.takeIf { title -> title.isNotBlank() } ?: it.name }
                    .takeIf { it.isNotEmpty() }
                    ?.joinToString(" · "),
            )
        }
    } else {
        emptyList()
    }
    val empty = panel.mode == ComposerMcpPanelModePreview.List &&
        panel.status != ComposerPanelLoadStatusPreview.Loading &&
        panel.error.isNullOrBlank() &&
        panel.servers.isEmpty()

    return ComposerMcpPanelState(
        configSourceTitle = "MCP config source",
        configSourceLabel = panel.configPath?.takeIf { it.isNotBlank() } ?: "<provider config>",
        showAddAction = panel.mode == ComposerMcpPanelModePreview.List && panel.configEditing,
        mode = panel.mode,
        statusMessages = statusMessages,
        addOptions = if (panel.mode == ComposerMcpPanelModePreview.Add) buildComposerMcpAddOptions() else emptyList(),
        servers = servers,
        form = buildComposerMcpFormState(panel),
        emptyMessage = if (empty) "No MCP servers available right now." else null,
        lifecycle = buildComposerMcpPanelLifecycleState(panel),
    )
}

private fun buildComposerMcpPanelLifecycleState(
    panel: ComposerMcpPanelPreview,
): ComposerMcpPanelLifecycleState {
    val addVisible = panel.mode == ComposerMcpPanelModePreview.List && panel.configEditing
    val backTarget = when (panel.mode) {
        ComposerMcpPanelModePreview.Http,
        ComposerMcpPanelModePreview.Stdio,
        -> ComposerMcpPanelModePreview.Add
        ComposerMcpPanelModePreview.List,
        ComposerMcpPanelModePreview.Add,
        -> null
    }
    return ComposerMcpPanelLifecycleState(
        configEditingAvailable = panel.configEditing,
        configBusy = panel.configBusy,
        addTargetMode = if (addVisible) ComposerMcpPanelModePreview.Add else null,
        clearsConfigStatusOnAdd = addVisible,
        backTargetMode = backTarget,
        stateDescription = buildComposerMcpPanelStateDescription(panel),
    )
}

private fun buildComposerMcpPanelStateDescription(panel: ComposerMcpPanelPreview): String {
    val mode = when (panel.mode) {
        ComposerMcpPanelModePreview.List -> "list"
        ComposerMcpPanelModePreview.Add -> "add choices"
        ComposerMcpPanelModePreview.Http -> "HTTP form"
        ComposerMcpPanelModePreview.Stdio -> "stdio form"
    }
    val editing = if (panel.configEditing) "editing available" else "editing unavailable"
    val busy = if (panel.configBusy) ", saving" else ""
    return "MCP panel: $mode, $editing$busy"
}

private fun buildComposerMcpAddOptions(): List<ComposerMcpAddOptionState> {
    return listOf(
        ComposerMcpAddOptionState(
            title = "HTTP / Streamable HTTP",
            modeLabel = "Form",
            description = "Add an MCP server with a name and URL, then write the matching block into provider config.",
            targetMode = ComposerMcpPanelModePreview.Http,
            clearsConfigStatus = true,
            preparesRawBlock = false,
        ),
        ComposerMcpAddOptionState(
            title = "stdio / raw block",
            modeLabel = "TOML",
            description = "Write a single [mcp_servers.name] block, then save it back into provider config.",
            targetMode = ComposerMcpPanelModePreview.Stdio,
            clearsConfigStatus = true,
            preparesRawBlock = true,
        ),
    )
}

private fun buildComposerMcpFormState(panel: ComposerMcpPanelPreview): ComposerMcpFormState? {
    return when (panel.mode) {
        ComposerMcpPanelModePreview.Http -> ComposerMcpFormState(
            title = "HTTP MCP",
            primaryLabel = if (panel.configBusy) "Saving..." else "Write HTTP MCP",
            primaryEnabled = !panel.configBusy,
            fields = listOf(
                "MCP name" to panel.httpName,
                "URL" to panel.httpUrl,
            ),
            backTargetMode = ComposerMcpPanelModePreview.Add,
            configBusy = panel.configBusy,
        )
        ComposerMcpPanelModePreview.Stdio -> ComposerMcpFormState(
            title = "MCP block for provider config",
            primaryLabel = if (panel.configBusy) "Saving..." else "Write raw block",
            primaryEnabled = !panel.configBusy,
            fields = listOf(
                "MCP block for provider config" to panel.rawBlock,
            ),
            backTargetMode = ComposerMcpPanelModePreview.Add,
            configBusy = panel.configBusy,
        )
        ComposerMcpPanelModePreview.List,
        ComposerMcpPanelModePreview.Add,
        -> null
    }
}

fun authStatusLabel(status: ComposerMcpAuthStatusPreview): String {
    return when (status) {
        ComposerMcpAuthStatusPreview.BearerToken -> "Token"
        ComposerMcpAuthStatusPreview.OAuth -> "OAuth"
        ComposerMcpAuthStatusPreview.NotLoggedIn -> "Login"
        ComposerMcpAuthStatusPreview.Unsupported -> "Public"
    }
}

fun buildComposerSkillsPanelState(
    panel: ComposerSkillsPanelPreview,
): ComposerSkillsPanelState {
    val copyLifecycle = buildComposerSkillsCopyLifecycleState(panel.copiedSkillName)
    val skills = panel.skills.map { skill ->
        val invokeName = "$${skill.name}"
        val copied = panel.copiedSkillName == skill.name
        ComposerSkillRowState(
            displayName = skill.displayName?.takeIf { it.isNotBlank() } ?: skill.name,
            scopeLabel = skillScopeLabel(skill.scope),
            invokeName = invokeName,
            copyLabel = if (copied) "Copied $invokeName" else invokeName,
            copyAccessibilityLabel = "Copy $invokeName",
            copyTitle = "Copy $invokeName",
            description = skill.interfaceShortDescription
                ?.takeIf { it.isNotBlank() }
                ?: skill.shortDescription
                    ?.takeIf { it.isNotBlank() }
                ?: skill.description,
            copied = copied,
            enabled = skill.enabled,
        )
    }
    val errors = panel.errors.map { error ->
        ComposerSkillErrorState(
            message = error.message,
            path = error.path,
        )
    }
    val loading = panel.status == ComposerPanelLoadStatusPreview.Loading && panel.skills.isEmpty()
    val empty = panel.status != ComposerPanelLoadStatusPreview.Loading &&
        panel.error.isNullOrBlank() &&
        skills.isEmpty() &&
        errors.isEmpty()

    return ComposerSkillsPanelState(
        loadingMessage = if (loading) "Loading skills..." else null,
        errorMessage = panel.error?.takeIf { it.isNotBlank() },
        skills = skills,
        errors = errors,
        emptyMessage = if (empty) "No skills available right now." else null,
        copyLifecycle = copyLifecycle,
    )
}

fun buildComposerSkillsCopyLifecycleState(
    copiedSkillName: String?,
): ComposerSkillsCopyLifecycleState {
    val copiedName = copiedSkillName?.takeIf { it.isNotBlank() }
    val invokeName = copiedName?.let { "\$$it" }
    return ComposerSkillsCopyLifecycleState(
        copiedSkillName = copiedName,
        copiedInvokeName = invokeName,
        clipboardText = invokeName,
        shouldClearCopiedState = copiedName != null,
        clearDelayMillis = 1_400L,
    )
}

fun skillScopeLabel(scope: ComposerSkillScopePreview): String {
    return when (scope) {
        ComposerSkillScopePreview.Repo -> "Repo"
        ComposerSkillScopePreview.System -> "System"
        ComposerSkillScopePreview.Admin -> "Admin"
        ComposerSkillScopePreview.User -> "User"
    }
}

fun buildComposerForkPanelState(
    busy: Boolean,
    forkBusy: Boolean,
    slashPanelView: ComposerSlashPanelViewPreview = ComposerSlashPanelViewPreview.Root,
    forkTurnOptions: ComposerForkTurnOptionsPreview = ComposerForkTurnOptionsPreview(),
): ComposerForkPanelState {
    val enabled = !(busy || forkBusy)
    val lifecycle = buildComposerForkLifecycleState(
        forkBusy = forkBusy,
        slashPanelView = slashPanelView,
    )
    return ComposerForkPanelState(
        actions = listOf(
            ComposerForkActionState(
                label = "Fork from latest",
                status = if (forkBusy) "Forking" else "Run",
                enabled = enabled,
                kind = ComposerForkActionKind.Latest,
                startsBusy = enabled,
                closesMenuOnSuccess = true,
                closesMenuOnFailure = false,
            ),
            ComposerForkActionState(
                label = "Fork from selected turn",
                status = "Pick",
                enabled = enabled,
                kind = ComposerForkActionKind.SelectedTurn,
                startsBusy = enabled,
                closesMenuOnSuccess = true,
                closesMenuOnFailure = false,
            ),
        ),
        showIdleOnlyNotice = busy,
        notice = if (busy) "Fork is only available while the thread is idle." else null,
        turnPicker = buildComposerForkTurnPickerState(
            options = forkTurnOptions,
            forkBusy = forkBusy,
        ),
        lifecycle = lifecycle,
    )
}

fun buildComposerForkTurnPickerState(
    options: ComposerForkTurnOptionsPreview,
    forkBusy: Boolean,
): ComposerForkTurnPickerState {
    val loading = options.status == ComposerPanelLoadStatusPreview.Loading && options.turns.isEmpty()
    val error = options.error?.takeIf { it.isNotBlank() }
    val rows = options.turns.map { turn ->
        ComposerForkTurnPickerRowState(
            turnId = turn.turnId,
            title = "Turn ${turn.turnIndex}",
            status = if (forkBusy) "Forking" else turn.status,
            enabled = !forkBusy,
        )
    }
    val empty = options.status != ComposerPanelLoadStatusPreview.Loading &&
        error == null &&
        rows.isEmpty()
    return ComposerForkTurnPickerState(
        loadingMessage = if (loading) "Loading turns..." else null,
        errorMessage = error,
        rows = rows,
        emptyMessage = if (empty) "No turns available to fork yet." else null,
    )
}

fun buildComposerForkLifecycleState(
    forkBusy: Boolean,
    slashPanelView: ComposerSlashPanelViewPreview,
): ComposerForkLifecycleState {
    return ComposerForkLifecycleState(
        forkBusy = forkBusy,
        shouldClearBusyWhenLeavingForkTurns = forkBusy && slashPanelView != ComposerSlashPanelViewPreview.ForkTurns,
        busyWhileRunning = true,
        closeMenuOnSuccess = true,
        closeMenuOnFailure = false,
    )
}

fun buildComposerToolboxItems(
    items: List<ComposerToolboxItemPreview>,
    fastMode: Boolean,
    compactBusy: Boolean,
    goalComposeMode: Boolean,
    goalStatus: ThreadGoalStatusPreview?,
    busy: Boolean,
    settingsBusy: Boolean,
    forkBusy: Boolean,
): List<ComposerToolboxItemState> {
    return items.map { item ->
        val enabled = !composerToolboxItemDisabled(
            action = item.action,
            settingsBusy = settingsBusy,
            compactBusy = compactBusy,
            busy = busy,
            forkBusy = forkBusy,
        )
        ComposerToolboxItemState(
            command = item.command,
            label = item.label,
            status = composerToolboxItemStatus(
                action = item.action,
                fastMode = fastMode,
                compactBusy = compactBusy,
                goalComposeMode = goalComposeMode,
                goalStatus = goalStatus,
                busy = busy,
            ),
            description = item.description?.takeIf { it.isNotBlank() } ?: item.label,
            enabled = enabled,
            tone = composerToolboxItemTone(
                action = item.action,
                enabled = enabled,
                fastMode = fastMode,
                goalComposeMode = goalComposeMode,
                goalStatus = goalStatus,
            ),
            actionDecision = buildComposerToolboxActionDecision(
                action = item.action,
                fastMode = fastMode,
                goalComposeMode = goalComposeMode,
            ),
        )
    }
}

fun buildComposerToolboxActionDecision(
    action: ComposerToolboxActionPreview,
    fastMode: Boolean,
    goalComposeMode: Boolean,
): ComposerToolboxActionDecisionState {
    return when (action) {
        ComposerToolboxActionPreview.Fast -> ComposerToolboxActionDecisionState(
            kind = ComposerToolboxActionDecisionKind.ToggleFast,
            targetFastMode = !fastMode,
        )
        ComposerToolboxActionPreview.Compact -> ComposerToolboxActionDecisionState(
            kind = ComposerToolboxActionDecisionKind.RunCompact,
            closeMenu = true,
        )
        ComposerToolboxActionPreview.Goal -> if (goalComposeMode) {
            ComposerToolboxActionDecisionState(
                kind = ComposerToolboxActionDecisionKind.ExitGoalCompose,
                closeMenu = true,
            )
        } else {
            ComposerToolboxActionDecisionState(
                kind = ComposerToolboxActionDecisionKind.EnterGoalCompose,
            )
        }
        ComposerToolboxActionPreview.Fork -> ComposerToolboxActionDecisionState(
            kind = ComposerToolboxActionDecisionKind.OpenPanel,
            targetPanel = ComposerSlashPanelViewState.Fork,
        )
        ComposerToolboxActionPreview.Skills -> ComposerToolboxActionDecisionState(
            kind = ComposerToolboxActionDecisionKind.OpenPanel,
            targetPanel = ComposerSlashPanelViewState.Skills,
        )
        ComposerToolboxActionPreview.Mcp -> ComposerToolboxActionDecisionState(
            kind = ComposerToolboxActionDecisionKind.OpenPanel,
            targetPanel = ComposerSlashPanelViewState.Mcp,
        )
        ComposerToolboxActionPreview.Hooks -> ComposerToolboxActionDecisionState(
            kind = ComposerToolboxActionDecisionKind.OpenPanel,
            targetPanel = ComposerSlashPanelViewState.Hooks,
        )
    }
}

fun buildComposerSlashToolboxPanelState(
    open: Boolean,
    view: ComposerSlashPanelViewPreview,
    items: List<ComposerToolboxItemState>,
): ComposerSlashToolboxPanelState {
    val viewState = slashPanelViewState(view)
    return ComposerSlashToolboxPanelState(
        menuVisible = open,
        triggerAccessibilityLabel = "Open slash toolbox",
        triggerTitle = "Open slash toolbox",
        surfaceVisible = open,
        title = "Slash toolbox",
        subtitle = "Thread actions",
        view = viewState,
        showRootItems = viewState == ComposerSlashPanelViewState.Root,
        items = items,
        emptyMessage = if (viewState == ComposerSlashPanelViewState.Root && items.isEmpty()) {
            "No backend tools are available for this thread."
        } else {
            null
        },
    )
}

private fun slashPanelViewState(view: ComposerSlashPanelViewPreview): ComposerSlashPanelViewState {
    return when (view) {
        ComposerSlashPanelViewPreview.Root -> ComposerSlashPanelViewState.Root
        ComposerSlashPanelViewPreview.Skills -> ComposerSlashPanelViewState.Skills
        ComposerSlashPanelViewPreview.Mcp -> ComposerSlashPanelViewState.Mcp
        ComposerSlashPanelViewPreview.Hooks -> ComposerSlashPanelViewState.Hooks
        ComposerSlashPanelViewPreview.Fork -> ComposerSlashPanelViewState.Fork
        ComposerSlashPanelViewPreview.ForkTurns -> ComposerSlashPanelViewState.ForkTurns
    }
}

fun buildComposerMenuLifecycleState(
    openMenu: ComposerToolbarMenuState?,
    slashPanelView: ComposerSlashPanelViewPreview,
): ComposerMenuLifecycleState {
    val slashOpen = openMenu == ComposerToolbarMenuState.Slash
    val viewingMcp = slashOpen && slashPanelView == ComposerSlashPanelViewPreview.Mcp
    return ComposerMenuLifecycleState(
        shouldResetSlashPanelView = !slashOpen && slashPanelView != ComposerSlashPanelViewPreview.Root,
        shouldResetMcpPanelMode = !viewingMcp,
        shouldClearMcpConfigStatus = !viewingMcp,
        shouldClearHookConfigStatus = !slashOpen,
        targetSlashPanelView = if (!slashOpen && slashPanelView != ComposerSlashPanelViewPreview.Root) {
            ComposerSlashPanelViewState.Root
        } else {
            null
        },
        targetMcpPanelMode = if (!viewingMcp) ComposerMcpPanelModePreview.List else null,
    )
}

private fun composerToolboxItemStatus(
    action: ComposerToolboxActionPreview,
    fastMode: Boolean,
    compactBusy: Boolean,
    goalComposeMode: Boolean,
    goalStatus: ThreadGoalStatusPreview?,
    busy: Boolean,
): String {
    return when (action) {
        ComposerToolboxActionPreview.Fast -> if (fastMode) "On" else "Off"
        ComposerToolboxActionPreview.Compact -> if (compactBusy) "Busy" else "Run"
        ComposerToolboxActionPreview.Goal -> when {
            goalComposeMode -> "Composing"
            goalStatus != null -> goalStatusLabel(goalStatus)
            else -> "Open"
        }
        ComposerToolboxActionPreview.Fork -> if (busy) "Idle only" else "Open"
        ComposerToolboxActionPreview.Skills,
        ComposerToolboxActionPreview.Mcp,
        ComposerToolboxActionPreview.Hooks,
        -> "View"
    }
}

private fun composerToolboxItemDisabled(
    action: ComposerToolboxActionPreview,
    settingsBusy: Boolean,
    compactBusy: Boolean,
    busy: Boolean,
    forkBusy: Boolean,
): Boolean {
    return when (action) {
        ComposerToolboxActionPreview.Fast -> settingsBusy
        ComposerToolboxActionPreview.Compact -> compactBusy || busy
        ComposerToolboxActionPreview.Fork -> busy || forkBusy
        else -> false
    }
}

private fun composerToolboxItemTone(
    action: ComposerToolboxActionPreview,
    enabled: Boolean,
    fastMode: Boolean,
    goalComposeMode: Boolean,
    goalStatus: ThreadGoalStatusPreview?,
): ComposerToolboxItemTone {
    if (!enabled) {
        return ComposerToolboxItemTone.Disabled
    }
    val active = (action == ComposerToolboxActionPreview.Fast && fastMode) ||
        (action == ComposerToolboxActionPreview.Goal &&
            (goalComposeMode || goalStatus == ThreadGoalStatusPreview.Active))
    return if (active) ComposerToolboxItemTone.Active else ComposerToolboxItemTone.Neutral
}

fun goalStatusLabel(status: ThreadGoalStatusPreview): String {
    return when (status) {
        ThreadGoalStatusPreview.Active -> "Active"
        ThreadGoalStatusPreview.Paused -> "Paused"
        ThreadGoalStatusPreview.BudgetLimited -> "Budget"
        ThreadGoalStatusPreview.Complete -> "Complete"
        ThreadGoalStatusPreview.Terminated -> "Terminated"
    }
}

fun parseGoalTokenBudgetThousands(value: String): Int? {
    val normalized = value.trim()
    if (normalized.isEmpty()) {
        return null
    }
    val thousands = normalized.toDoubleOrNull()
    if (thousands == null || !thousands.isFinite() || thousands <= 0) {
        return Int.MIN_VALUE
    }
    return round(thousands * 1_000).toInt()
}

fun formatGoalTokenBudgetThousands(value: Int?): String {
    val budget = value ?: return ""
    if (budget <= 0) {
        return ""
    }
    val thousands = budget / 1_000.0
    return if (thousands % 1.0 == 0.0) {
        thousands.toInt().toString()
    } else {
        val rounded = round(thousands * 10) / 10
        if (rounded % 1.0 == 0.0) rounded.toInt().toString() else rounded.toString()
    }
}

fun buildComposerShellTools(
    busy: Boolean,
    shellControl: ComposerShellControlPreview,
): List<ComposerShellToolState> {
    val shellInputEnabled = shellControl.shellInputEnabled
    val commandRunning = shellControl.commandRunning
    return listOf(
        ComposerShellToolState("PASTE", ComposerShellToolKind.Paste, ComposerShellToolTone.Neutral, enabled = true),
        ComposerShellToolState("COPY", ComposerShellToolKind.Copy, ComposerShellToolTone.Neutral, enabled = true),
        ComposerShellToolState("CLEAR", ComposerShellToolKind.Clear, ComposerShellToolTone.Info, enabled = !busy),
        ComposerShellToolState("CTRL-C", ComposerShellToolKind.CtrlC, ComposerShellToolTone.Danger, enabled = shellInputEnabled && commandRunning),
        ComposerShellToolState("CTRL-D", ComposerShellToolKind.CtrlD, ComposerShellToolTone.Neutral, enabled = shellInputEnabled),
        ComposerShellToolState("ESC", ComposerShellToolKind.Esc, ComposerShellToolTone.Neutral, enabled = shellInputEnabled),
        ComposerShellToolState("TAB", ComposerShellToolKind.Tab, ComposerShellToolTone.Neutral, enabled = shellInputEnabled),
        ComposerShellToolState("UP", ComposerShellToolKind.Up, ComposerShellToolTone.Neutral, enabled = shellInputEnabled),
        ComposerShellToolState("DOWN", ComposerShellToolKind.Down, ComposerShellToolTone.Neutral, enabled = shellInputEnabled),
    )
}

fun buildComposerShellToolsPanelState(
    open: Boolean,
    tools: List<ComposerShellToolState>,
): ComposerShellToolsPanelState {
    val clipboardTools = tools.filter { tool ->
        tool.kind == ComposerShellToolKind.Paste || tool.kind == ComposerShellToolKind.Copy
    }
    val controlTools = tools.filterNot { tool ->
        tool.kind == ComposerShellToolKind.Paste || tool.kind == ComposerShellToolKind.Copy
    }
    return ComposerShellToolsPanelState(
        menuVisible = open,
        title = "Shell tools",
        subtitle = "${clipboardTools.size} clipboard · ${controlTools.size} controls",
        columnCount = 2,
        clipboardTools = clipboardTools,
        controlTools = controlTools,
        tools = tools,
    )
}

fun buildComposerAttachmentActions(): List<ComposerAttachmentActionState> {
    return listOf(
        ComposerAttachmentActionState(
            label = "Photo",
            detail = "Camera or image library",
            kind = ComposerAttachmentActionKind.Photo,
        ),
        ComposerAttachmentActionState(
            label = "File",
            detail = "Workspace or local file",
            kind = ComposerAttachmentActionKind.File,
        ),
    )
}

fun buildComposerAttachmentPanelState(
    open: Boolean,
    prompt: ComposerPromptPreview,
    isShellView: Boolean = false,
): ComposerAttachmentPanelState {
    val queuedAttachments = prompt.attachments.map(::buildComposerPromptAttachmentState)
    return ComposerAttachmentPanelState(
        open = open,
        triggerLabel = "Add attachment",
        triggerAccessibilityLabel = "Add attachment",
        menuVisible = open,
        actions = buildComposerAttachmentActions(),
        actionCountLabel = "2 actions",
        queuedAttachments = queuedAttachments,
        queuedCountLabel = when (queuedAttachments.size) {
            0 -> "No queued attachments"
            1 -> "1 queued attachment"
            else -> "${queuedAttachments.size} queued attachments"
        },
        emptyMessage = if (queuedAttachments.isEmpty()) "No queued attachments." else null,
        previewLifecycle = buildComposerAttachmentPreviewLifecycleState(
            attachments = prompt.attachments,
            isShellView = isShellView,
        ),
    )
}

fun buildComposerAttachmentPreviewLifecycleState(
    attachments: List<ComposerPromptAttachmentPreview>,
    isShellView: Boolean,
): ComposerAttachmentPreviewLifecycleState {
    val previewablePhotoClientIds = if (isShellView) {
        emptyList()
    } else {
        attachments
            .filter { attachment -> attachment.kind == com.remotecodex.android.ui.model.ComposerAttachmentKindPreview.Photo }
            .map { attachment -> attachment.clientId }
    }
    return ComposerAttachmentPreviewLifecycleState(
        previewablePhotoClientIds = previewablePhotoClientIds,
        clearsPreviewsInShellView = isShellView,
        reusesCachedPreviewUrls = true,
        revokesRemovedPreviewUrls = true,
        revokesPreviewUrlsOnDispose = true,
        stateDescription = when {
            isShellView -> "Attachment previews cleared in shell view"
            previewablePhotoClientIds.isEmpty() -> "No photo previews"
            previewablePhotoClientIds.size == 1 -> "1 photo preview"
            else -> "${previewablePhotoClientIds.size} photo previews"
        },
    )
}

fun buildComposerDraftControlState(
    isShellView: Boolean,
    draftPromptAvailable: Boolean,
    draftAttachmentsAvailable: Boolean,
    hostDraftChangeAvailable: Boolean,
): ComposerDraftControlState {
    val controlled = !isShellView &&
        draftPromptAvailable &&
        draftAttachmentsAvailable &&
        hostDraftChangeAvailable
    val missing = mutableListOf<String>()
    if (!draftPromptAvailable) {
        missing += "prompt"
    }
    if (!draftAttachmentsAvailable) {
        missing += "attachments"
    }
    if (!hostDraftChangeAvailable) {
        missing += "host callback"
    }
    return ComposerDraftControlState(
        controlled = controlled,
        promptAvailable = draftPromptAvailable,
        attachmentsAvailable = draftAttachmentsAvailable,
        hostChangeAvailable = hostDraftChangeAvailable,
        shellViewForcesUncontrolled = isShellView,
        localDraftSourceLabel = if (controlled) "Host draft" else "Local draft",
        stateDescription = when {
            controlled -> "Composer draft controlled by host"
            isShellView -> "Shell draft is local"
            missing.isEmpty() -> "Composer draft is local"
            else -> "Composer draft is local: missing ${missing.joinToString(", ")}"
        },
    )
}

fun buildComposerDraftState(
    prompt: String?,
    attachments: List<ComposerPromptAttachmentPreview>?,
): ComposerDraftState {
    return ComposerDraftState(
        prompt = prompt.orEmpty(),
        attachments = attachments.orEmpty(),
    )
}

fun composerDraftSignature(draft: ComposerDraftState): String {
    val attachmentSignature = draft.attachments.joinToString(separator = "\u001d") { attachment ->
        val kind = when (attachment.kind) {
            com.remotecodex.android.ui.model.ComposerAttachmentKindPreview.Photo -> "photo"
            com.remotecodex.android.ui.model.ComposerAttachmentKindPreview.File -> "file"
        }
        "${attachment.clientId}\u001e$kind\u001e${attachment.placeholder}\u001e${attachment.name}"
    }
    return "${draft.prompt}\u001f$attachmentSignature"
}

fun deriveComposerDraftSyncDecision(
    controlState: ComposerDraftControlState,
    event: ComposerDraftSyncEventState,
    nextDraft: ComposerDraftState,
    lastSentSignature: String,
    hasPendingTimer: Boolean,
    syncMode: ComposerDraftSyncModeState = ComposerDraftSyncModeState.Immediate,
): ComposerDraftSyncDecisionState {
    val nextSignature = composerDraftSignature(nextDraft)
    if (!controlState.controlled) {
        return ComposerDraftSyncDecisionState(
            controlled = false,
            event = event,
            shouldSendToHost = false,
            shouldScheduleDeferredSync = false,
            shouldClearPendingTimer = false,
            shouldUpdateLastSentSignature = false,
            delayMillis = null,
            nextSignature = nextSignature,
            stateDescription = "Local draft only",
        )
    }

    if (event == ComposerDraftSyncEventState.HostRefresh) {
        return ComposerDraftSyncDecisionState(
            controlled = true,
            event = event,
            shouldSendToHost = false,
            shouldScheduleDeferredSync = false,
            shouldClearPendingTimer = hasPendingTimer,
            shouldUpdateLastSentSignature = true,
            delayMillis = null,
            nextSignature = nextSignature,
            stateDescription = "Host draft refresh accepted",
        )
    }

    val duplicate = nextSignature == lastSentSignature
    val immediate = event == ComposerDraftSyncEventState.Flush ||
        event == ComposerDraftSyncEventState.Dispose ||
        syncMode == ComposerDraftSyncModeState.Immediate
    val shouldSendToHost = immediate && !duplicate
    val shouldScheduleDeferredSync = event == ComposerDraftSyncEventState.Update &&
        syncMode == ComposerDraftSyncModeState.Deferred
    return ComposerDraftSyncDecisionState(
        controlled = true,
        event = event,
        shouldSendToHost = shouldSendToHost,
        shouldScheduleDeferredSync = shouldScheduleDeferredSync,
        shouldClearPendingTimer = hasPendingTimer,
        shouldUpdateLastSentSignature = shouldSendToHost,
        delayMillis = if (shouldScheduleDeferredSync) COMPOSER_DRAFT_SYNC_DELAY_MS else null,
        nextSignature = nextSignature,
        stateDescription = when {
            shouldSendToHost -> "Controlled draft syncs now"
            shouldScheduleDeferredSync -> "Controlled draft sync deferred"
            duplicate -> "Controlled draft already synced"
            else -> "Controlled draft unchanged"
        },
    )
}

fun buildComposerModelOptions(
    currentModel: String?,
    options: List<ComposerModelOptionPreview>,
): List<ComposerSelectionOptionState> {
    return options.map { option ->
        val defaultEffort = option.defaultReasoningEffort
            ?.takeIf { it.isNotBlank() }
            ?.let { "default ${formatReasoningEffortLabel(it)}" }
            ?: "available"
        ComposerSelectionOptionState(
            label = option.model,
            detail = if (option.model == currentModel) "current" else defaultEffort,
            selected = option.model == currentModel,
        )
    }
}

fun buildComposerReasoningEffortOptions(
    currentEffort: String?,
    options: List<ComposerReasoningEffortOptionPreview>,
): List<ComposerSelectionOptionState> {
    return options.map { option ->
        val label = formatReasoningEffortLabel(option.reasoningEffort)
        ComposerSelectionOptionState(
            label = label,
            detail = if (option.reasoningEffort == currentEffort) "current" else "available",
            selected = option.reasoningEffort == currentEffort,
        )
    }
}

fun buildComposerSettingsState(
    context: ComposerContextPreview,
    reasoningEffort: String?,
    supportedReasoningEffortCount: Int,
    modelOptionCount: Int = 1,
    settingsBusy: Boolean,
    fastMode: Boolean,
    planModeAvailable: Boolean,
    planModeActive: Boolean,
    collaborationMode: String = if (planModeActive) "plan" else "default",
    optimisticCollaborationMode: String? = null,
): ComposerSettingsState {
    val supportedEfforts = supportedReasoningEffortCount.coerceAtLeast(0)
    val availableModels = modelOptionCount.coerceAtLeast(0)
    val modelLabel = context.model.takeIf { it.isNotBlank() } ?: "Select model"
    val modelEnabled = !settingsBusy && availableModels > 0
    val effortEnabled = modelEnabled && supportedEfforts > 0
    val effortTitle = when {
        fastMode -> "Fast mode is on. Turn it off from the slash toolbox to edit reasoning."
        supportedEfforts == 0 -> "The selected model does not expose adjustable reasoning effort."
        else -> "Select reasoning effort"
    }

    return ComposerSettingsState(
        modelLabel = modelLabel,
        modelEnabled = modelEnabled,
        effortLabel = formatReasoningEffortLabel(reasoningEffort),
        effortEnabled = effortEnabled,
        effortTitle = effortTitle,
        settingsBusy = settingsBusy,
        planVisible = planModeAvailable,
        planSelected = planModeAvailable && planModeActive,
        updateActions = ComposerSettingsActionState(
            displayedCollaborationMode = optimisticCollaborationMode ?: collaborationMode,
            closeMenuOnSuccess = true,
            resetOptimisticModeOnHostChange = true,
        ),
    )
}

fun buildComposerSettingsToolbarState(
    settingsState: ComposerSettingsState,
    openMenu: ComposerToolbarMenuState?,
    actionState: ComposerActionState,
    activeView: ComposerActiveView,
    promptDisabled: Boolean,
    goalComposeMode: Boolean,
    goalBusy: Boolean,
): ComposerSettingsToolbarState {
    val isChatView = activeView == ComposerActiveView.Chat
    return ComposerSettingsToolbarState(
        modelButton = ComposerToolbarButtonState(
            visible = isChatView,
            selected = openMenu == ComposerToolbarMenuState.Model,
            enabled = settingsState.modelEnabled,
            label = settingsState.modelLabel,
        ),
        modelTitle = settingsState.modelLabel,
        modelMenuExpanded = openMenu == ComposerToolbarMenuState.Model,
        effortButton = ComposerToolbarButtonState(
            visible = isChatView,
            selected = openMenu == ComposerToolbarMenuState.Effort,
            enabled = settingsState.effortEnabled,
            label = settingsState.effortLabel,
        ),
        effortTitle = settingsState.effortTitle,
        effortMenuExpanded = openMenu == ComposerToolbarMenuState.Effort,
        planButton = ComposerToolbarButtonState(
            visible = isChatView && settingsState.planVisible,
            selected = settingsState.planSelected,
            enabled = !settingsState.settingsBusy,
            label = "Plan",
        ),
        planPressed = settingsState.planSelected,
        sendButton = ComposerSendButtonState(
            label = actionState.primaryLabel,
            accessibilityLabel = if (goalComposeMode) "Set goal" else "Send Prompt",
            title = actionState.primaryLabel,
            enabled = actionState.sendEnabled && !goalBusy && if (isChatView) !promptDisabled else true,
            primaryKind = actionState.primaryKind,
        ),
        updateActions = settingsState.updateActions,
    )
}

fun deriveComposerSettingsUpdateDecision(
    nextCollaborationMode: String?,
    previousOptimisticMode: String?,
): ComposerSettingsUpdateDecisionState {
    return ComposerSettingsUpdateDecisionState(
        optimisticMode = nextCollaborationMode,
        rollbackMode = if (nextCollaborationMode != null) previousOptimisticMode else null,
        shouldRollbackMode = nextCollaborationMode != null,
        closeMenuOnSuccess = true,
    )
}

fun formatReasoningEffortLabel(value: String?): String {
    val normalized = value?.trim().orEmpty()
    if (normalized.isEmpty()) {
        return "Auto"
    }
    return normalized.replaceFirstChar { char ->
        if (char.isLowerCase()) char.titlecase() else char.toString()
    }
}

fun buildComposerContextUsageState(context: ComposerContextPreview): ComposerContextUsageState {
    val available = context.availability == ComposerContextAvailability.Available &&
        context.modelContextWindow > 0
    val usedTokens = context.tokensInContextWindow.coerceAtLeast(0)
    val contextTokens = context.modelContextWindow.coerceAtLeast(0)
    val remainingTokens = (contextTokens - usedTokens).coerceAtLeast(0)
    val percent = context.remainingPercent.coerceIn(0, 100)

    return ComposerContextUsageState(
        modelLabel = context.model.takeIf { it.isNotBlank() } ?: "Select model",
        usageLabel = if (available) {
            "${formatContextTokenKilocount(usedTokens)} / ${formatContextTokenKilocount(contextTokens)}"
        } else {
            "Context unavailable"
        },
        remainingLabel = if (available) {
            "${formatContextTokenKilocount(remainingTokens)} left · ${percent}% context left"
        } else {
            "Context usage unavailable"
        },
        progressFraction = if (available) percent / 100f else 0f,
        available = available,
    )
}

fun buildComposerPromptSlotState(
    prompt: ComposerPromptPreview,
    activeView: ComposerActiveView,
    actionState: ComposerActionState,
    busy: Boolean,
    goalBusy: Boolean,
    goalComposeMode: Boolean = false,
): ComposerPromptSlotState {
    val isShellView = activeView == ComposerActiveView.Shell
    val placeholder = when {
        goalComposeMode && !isShellView -> "Describe the goal the backend should continue working toward..."
        else -> prompt.placeholder.takeIf { it.isNotBlank() } ?: "Ask Codex"
    }
    val promptSendDisabled = if (isShellView) {
        !actionState.sendEnabled || goalBusy || busy
    } else {
        !actionState.sendEnabled || goalBusy || busy || prompt.disabled
    }
    val activeAttachments = if (isShellView) {
        emptyList()
    } else {
        activePromptAttachments(prompt.text, prompt.attachments)
    }
    return ComposerPromptSlotState(
        chatVisible = !isShellView,
        shellVisible = isShellView,
        text = prompt.text,
        placeholder = placeholder,
        showPlaceholder = prompt.text.isBlank(),
        disabled = prompt.disabled,
        canInterrupt = actionState.showInterrupt || actionState.primaryKind == ComposerPrimaryActionKind.Stop,
        interruptLabel = actionState.interruptLabel,
        sendButtonLabel = actionState.primaryLabel,
        sendDisabled = promptSendDisabled,
        attachmentChips = activeAttachments.map(::buildComposerPromptAttachmentState),
        inputModeLabel = if (isShellView) "Shell input" else "Prompt",
        promptSegments = if (isShellView) {
            emptyList()
        } else {
            tokenizeComposerPrompt(prompt.text, prompt.attachments)
        },
    )
}

fun buildComposerShellPromptInputState(
    promptSlotState: ComposerPromptSlotState,
): ComposerShellPromptInputState? {
    if (!promptSlotState.shellVisible) {
        return null
    }
    return ComposerShellPromptInputState(
        text = promptSlotState.text,
        placeholder = promptSlotState.placeholder,
        showPlaceholder = promptSlotState.text.isBlank(),
        interruptLabel = promptSlotState.interruptLabel,
        interruptEnabled = promptSlotState.canInterrupt,
        sendLabel = promptSlotState.sendButtonLabel,
        sendEnabled = !promptSlotState.sendDisabled,
        sendAccessibilityLabel = "Send Shell Input",
        minLines = 2,
    )
}

fun buildComposerSubmitInputState(
    prompt: ComposerPromptPreview,
    activeView: ComposerActiveView,
): ComposerSubmitInputState? {
    val isShellView = activeView == ComposerActiveView.Shell
    if (isShellView) {
        return ComposerSubmitInputState(prompt = prompt.text)
    }

    val normalizedPrompt = prompt.text.trim()
    if (normalizedPrompt.isEmpty()) {
        return null
    }
    val activeAttachments = prompt.attachments
        .filter { attachment -> normalizedPrompt.contains(attachment.placeholder) }
        .map(::buildComposerSubmitAttachmentState)
    return ComposerSubmitInputState(
        prompt = normalizedPrompt,
        attachments = activeAttachments,
    )
}

fun normalizePromptText(value: String): String {
    return value.replace('\u00a0', ' ')
}

fun normalizeAttachmentLabel(name: String): String {
    return name
        .trim()
        .replace(Regex("[\\[\\]\\n\\r\\t]+"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()
        .ifEmpty { "attachment" }
}

fun buildAttachmentPlaceholder(
    kind: ComposerAttachmentActionKind,
    name: String,
    usedPlaceholders: Set<String>,
): String {
    val token = when (kind) {
        ComposerAttachmentActionKind.Photo -> "PHOTO"
        ComposerAttachmentActionKind.File -> "FILE"
    }
    val label = normalizeAttachmentLabel(name)
    var suffix = 0
    while (true) {
        val candidateLabel = if (suffix == 0) label else "$label (${suffix + 1})"
        val placeholder = "[$token $candidateLabel]"
        if (!usedPlaceholders.contains(placeholder)) {
            return placeholder
        }
        suffix += 1
    }
}

fun buildAttachmentInsertionText(
    basePrompt: String,
    selection: ComposerPromptSelectionRange,
    placeholders: List<String>,
): String {
    if (placeholders.isEmpty()) {
        return ""
    }
    val safeRange = selection.normalizedFor(basePrompt)
    val beforeChar = if (safeRange.start > 0) basePrompt[safeRange.start - 1] else null
    val afterChar = if (safeRange.end < basePrompt.length) basePrompt[safeRange.end] else null
    val needsLeadingSpace = beforeChar != null && !beforeChar.isWhitespace()
    val needsTrailingSpace = afterChar == null || !afterChar.isWhitespace()
    return buildString {
        if (needsLeadingSpace) {
            append(' ')
        }
        append(placeholders.joinToString(" "))
        if (needsTrailingSpace) {
            append(' ')
        }
    }
}

fun buildAttachmentInsertionState(
    prompt: String,
    existingAttachments: List<ComposerPromptAttachmentPreview>,
    fileNames: List<String>,
    kind: ComposerAttachmentActionKind,
    selection: ComposerPromptSelectionRange?,
    buildClientId: (Int, ComposerAttachmentActionKind, String) -> String = { index, _, _ -> "attachment-${index + 1}" },
): ComposerAttachmentInsertionState {
    val usedPlaceholders = existingAttachments.mapTo(mutableSetOf()) { it.placeholder }
    val insertedAttachments = fileNames.mapIndexed { index, fileName ->
        val placeholder = buildAttachmentPlaceholder(kind, fileName, usedPlaceholders)
        usedPlaceholders.add(placeholder)
        ComposerPromptAttachmentPreview(
            clientId = buildClientId(index, kind, fileName),
            kind = kind.toPreviewKind(),
            name = normalizeAttachmentLabel(fileName),
            placeholder = placeholder,
        )
    }
    val placeholders = insertedAttachments.map { attachment -> attachment.placeholder }
    val range = (selection ?: ComposerPromptSelectionRange(prompt.length, prompt.length)).normalizedFor(prompt)
    val insertionText = buildAttachmentInsertionText(prompt, range, placeholders)
    val nextPrompt = prompt.replaceRange(range.start, range.end, insertionText)
    val trailingSpacerOffset = if (insertionText.endsWith(" ")) 1 else 0
    val nextCaret = range.start + insertionText.length - trailingSpacerOffset
    return ComposerAttachmentInsertionState(
        prompt = nextPrompt,
        selection = ComposerPromptSelectionRange(nextCaret, nextCaret),
        insertedPlaceholders = placeholders,
        insertedAttachments = insertedAttachments,
        insertedAttachmentClientIds = insertedAttachments.map { attachment -> attachment.clientId },
    )
}

fun buildDroppedAttachmentInsertionState(
    prompt: String,
    existingAttachments: List<ComposerPromptAttachmentPreview>,
    droppedFiles: List<Pair<String, ComposerAttachmentActionKind>>,
    selection: ComposerPromptSelectionRange?,
    buildClientId: (Int, ComposerAttachmentActionKind, String) -> String = { index, _, _ -> "attachment-${index + 1}" },
): ComposerAttachmentInsertionState {
    val orderedFiles = orderDroppedAttachmentFiles(droppedFiles)
    val usedPlaceholders = existingAttachments.mapTo(mutableSetOf()) { it.placeholder }
    val insertedAttachments = orderedFiles.mapIndexed { index, file ->
        val placeholder = buildAttachmentPlaceholder(file.second, file.first, usedPlaceholders)
        usedPlaceholders.add(placeholder)
        ComposerPromptAttachmentPreview(
            clientId = buildClientId(index, file.second, file.first),
            kind = file.second.toPreviewKind(),
            name = normalizeAttachmentLabel(file.first),
            placeholder = placeholder,
        )
    }
    val placeholders = insertedAttachments.map { attachment -> attachment.placeholder }
    val range = (selection ?: ComposerPromptSelectionRange(prompt.length, prompt.length)).normalizedFor(prompt)
    val insertionText = buildAttachmentInsertionText(prompt, range, placeholders)
    val nextPrompt = prompt.replaceRange(range.start, range.end, insertionText)
    val trailingSpacerOffset = if (insertionText.endsWith(" ")) 1 else 0
    val nextCaret = range.start + insertionText.length - trailingSpacerOffset
    return ComposerAttachmentInsertionState(
        prompt = nextPrompt,
        selection = ComposerPromptSelectionRange(nextCaret, nextCaret),
        insertedPlaceholders = placeholders,
        insertedAttachments = insertedAttachments,
        insertedAttachmentClientIds = insertedAttachments.map { attachment -> attachment.clientId },
    )
}

fun orderDroppedAttachmentFiles(
    files: List<Pair<String, ComposerAttachmentActionKind>>,
): List<Pair<String, ComposerAttachmentActionKind>> {
    return files.filter { file -> file.second == ComposerAttachmentActionKind.Photo } +
        files.filter { file -> file.second == ComposerAttachmentActionKind.File }
}

private fun ComposerAttachmentActionKind.toPreviewKind(): ComposerAttachmentKindPreview {
    return when (this) {
        ComposerAttachmentActionKind.Photo -> ComposerAttachmentKindPreview.Photo
        ComposerAttachmentActionKind.File -> ComposerAttachmentKindPreview.File
    }
}

fun derivePromptPasteAction(
    fileCount: Int,
    plainText: String,
    htmlText: String,
    htmlToText: (String) -> String,
): ComposerPromptPasteActionState {
    if (fileCount > 0) {
        return ComposerPromptPasteActionState(
            kind = ComposerPromptPasteActionKind.AppendFiles,
            preventDefault = true,
            fileCount = fileCount,
        )
    }
    val text = plainText.ifEmpty { htmlToText(htmlText) }
    if (text.isEmpty() && htmlText.isEmpty()) {
        return ComposerPromptPasteActionState(
            kind = ComposerPromptPasteActionKind.Ignore,
            preventDefault = false,
        )
    }
    return ComposerPromptPasteActionState(
        kind = ComposerPromptPasteActionKind.InsertText,
        preventDefault = true,
        text = text,
    )
}

fun derivePromptFileDragAction(hasFiles: Boolean): ComposerPromptFileTransferActionState {
    return if (hasFiles) {
        ComposerPromptFileTransferActionState(
            kind = ComposerPromptFileTransferActionKind.AcceptFiles,
            preventDefault = true,
            activateDragTarget = true,
        )
    } else {
        ComposerPromptFileTransferActionState(
            kind = ComposerPromptFileTransferActionKind.Ignore,
            preventDefault = false,
            activateDragTarget = false,
        )
    }
}

fun derivePromptDropAction(fileCount: Int): ComposerPromptFileTransferActionState {
    return if (fileCount > 0) {
        ComposerPromptFileTransferActionState(
            kind = ComposerPromptFileTransferActionKind.AcceptFiles,
            preventDefault = true,
            activateDragTarget = true,
            fileCount = fileCount,
        )
    } else {
        ComposerPromptFileTransferActionState(
            kind = ComposerPromptFileTransferActionKind.Ignore,
            preventDefault = false,
            activateDragTarget = false,
        )
    }
}

fun derivePromptKeyDownAction(
    key: String,
    metaKey: Boolean,
    ctrlKey: Boolean,
    busy: Boolean,
    disabled: Boolean,
): ComposerPromptKeyDownActionState {
    val isSubmitShortcut = key == "Enter" && (metaKey || ctrlKey)
    return ComposerPromptKeyDownActionState(
        preventDefault = isSubmitShortcut,
        submit = isSubmitShortcut && !busy && !disabled,
    )
}

fun buildComposerToolbarState(
    activeView: ComposerActiveView,
    openMenu: ComposerToolbarMenuState?,
    settingsState: ComposerSettingsState,
    canToggleShellView: Boolean,
    shellPromptLabel: String?,
): ComposerToolbarState {
    val isShellView = activeView == ComposerActiveView.Shell
    return ComposerToolbarState(
        slashButton = ComposerToolbarButtonState(
            visible = !isShellView,
            selected = openMenu == ComposerToolbarMenuState.Slash,
            enabled = !isShellView,
            label = if (openMenu == ComposerToolbarMenuState.Slash) "Close slash toolbox" else "Open slash toolbox",
        ),
        attachmentButton = ComposerToolbarButtonState(
            visible = !isShellView,
            selected = openMenu == ComposerToolbarMenuState.Attachments,
            enabled = !isShellView,
            label = if (openMenu == ComposerToolbarMenuState.Attachments) "Close attachment menu" else "Add attachment",
        ),
        shellToolsButton = ComposerToolbarButtonState(
            visible = isShellView,
            selected = openMenu == ComposerToolbarMenuState.ShellTools,
            enabled = isShellView,
            label = if (openMenu == ComposerToolbarMenuState.ShellTools) "Close shell tools" else "Open shell tools",
        ),
        modelButton = ComposerToolbarButtonState(
            visible = !isShellView,
            selected = openMenu == ComposerToolbarMenuState.Model,
            enabled = settingsState.modelEnabled,
            label = settingsState.modelLabel,
        ),
        effortButton = ComposerToolbarButtonState(
            visible = !isShellView,
            selected = openMenu == ComposerToolbarMenuState.Effort,
            enabled = settingsState.effortEnabled,
            label = settingsState.effortLabel,
        ),
        viewToggleButton = ComposerToolbarButtonState(
            visible = canToggleShellView,
            selected = isShellView,
            enabled = canToggleShellView,
            label = if (isShellView) "Switch to chat" else "Switch to shell",
        ),
        shellPromptLabel = shellPromptLabel?.takeIf { isShellView && it.isNotBlank() },
    )
}

fun buildComposerFrameState(
    activeView: ComposerActiveView,
    followTail: Boolean,
    goalComposeMode: Boolean,
    error: String?,
): ComposerFrameState {
    val isShellView = activeView == ComposerActiveView.Shell
    return ComposerFrameState(
        activeView = activeView,
        formTestTag = if (isShellView) null else "chat-composer",
        jumpLatest = buildComposerJumpLatestState(activeView, followTail),
        showPromptSlot = !isShellView,
        showGoalSlot = goalComposeMode && !isShellView,
        showShellPromptSlot = isShellView,
        errorMessage = error?.trim()?.takeIf { it.isNotEmpty() },
    )
}

private fun buildComposerSubmitAttachmentState(
    attachment: ComposerPromptAttachmentPreview,
): ComposerSubmitAttachmentState {
    return ComposerSubmitAttachmentState(
        clientId = attachment.clientId,
        kind = when (attachment.kind) {
            com.remotecodex.android.ui.model.ComposerAttachmentKindPreview.Photo -> ComposerAttachmentActionKind.Photo
            com.remotecodex.android.ui.model.ComposerAttachmentKindPreview.File -> ComposerAttachmentActionKind.File
        },
        name = attachmentDisplayLabel(attachment.name, attachment.placeholder),
        placeholder = attachment.placeholder,
    )
}

private fun activePromptAttachments(
    promptText: String,
    attachments: List<ComposerPromptAttachmentPreview>,
): List<ComposerPromptAttachmentPreview> {
    return attachments.filter { attachment ->
        promptText.isBlank() || promptText.contains(attachment.placeholder)
    }
}

fun tokenizeComposerPrompt(
    promptText: String,
    attachments: List<ComposerPromptAttachmentPreview>,
    pendingInsertedAttachmentClientIds: List<String> = emptyList(),
): List<ComposerPromptSegmentState> {
    if (promptText.isEmpty()) {
        return emptyList()
    }

    val pendingIds = pendingInsertedAttachmentClientIds.toSet()
    val lastPendingId = pendingInsertedAttachmentClientIds.lastOrNull()
    val placeholders = attachments
        .filter { attachment -> attachment.placeholder.isNotEmpty() }
        .sortedByDescending { attachment -> attachment.placeholder.length }
    val segments = mutableListOf<ComposerPromptSegmentState>()
    var cursor = 0
    var textIndex = 0

    while (cursor < promptText.length) {
        val matchingAttachment = placeholders.firstOrNull { attachment ->
            promptText.startsWith(attachment.placeholder, cursor)
        }
        if (matchingAttachment != null) {
            val attachmentState = buildComposerPromptAttachmentState(matchingAttachment)
            val newlyInserted = pendingIds.contains(matchingAttachment.clientId)
            segments += ComposerPromptSegmentState.Attachment(
                key = "${matchingAttachment.clientId}-$cursor",
                attachment = attachmentState,
                clientId = matchingAttachment.clientId,
                placeholder = matchingAttachment.placeholder,
                tone = attachmentState.kind.toPromptAttachmentTokenTone(),
                newlyInserted = newlyInserted,
                restoresCaretAfterInsert = matchingAttachment.clientId == lastPendingId,
                stateDescription = buildComposerPromptAttachmentSegmentStateDescription(
                    attachmentState = attachmentState,
                    newlyInserted = newlyInserted,
                    restoresCaretAfterInsert = matchingAttachment.clientId == lastPendingId,
                ),
            )
            cursor += matchingAttachment.placeholder.length
            continue
        }

        var nextTokenIndex = promptText.length
        placeholders.forEach { attachment ->
            val candidateIndex = promptText.indexOf(attachment.placeholder, cursor)
            if (candidateIndex != -1 && candidateIndex < nextTokenIndex) {
                nextTokenIndex = candidateIndex
            }
        }

        val text = promptText.substring(cursor, nextTokenIndex)
        if (text.isNotEmpty()) {
            segments += ComposerPromptSegmentState.Text(
                key = "text-$textIndex",
                text = text,
            )
            textIndex += 1
        }
        cursor = nextTokenIndex
    }

    return segments
}

private fun ComposerAttachmentActionKind.toPromptAttachmentTokenTone(): ComposerPromptAttachmentTokenTone {
    return when (this) {
        ComposerAttachmentActionKind.Photo -> ComposerPromptAttachmentTokenTone.Photo
        ComposerAttachmentActionKind.File -> ComposerPromptAttachmentTokenTone.File
    }
}

private fun buildComposerPromptAttachmentSegmentStateDescription(
    attachmentState: ComposerPromptAttachmentState,
    newlyInserted: Boolean,
    restoresCaretAfterInsert: Boolean,
): String {
    val type = when (attachmentState.kind) {
        ComposerAttachmentActionKind.Photo -> "Photo"
        ComposerAttachmentActionKind.File -> "File"
    }
    val inserted = if (newlyInserted) ", newly inserted" else ""
    val caret = if (restoresCaretAfterInsert) ", caret resumes after this attachment" else ""
    return "$type attachment ${attachmentState.label}$inserted$caret"
}

private fun buildComposerPromptAttachmentState(
    attachment: ComposerPromptAttachmentPreview,
): ComposerPromptAttachmentState {
    return ComposerPromptAttachmentState(
        label = attachmentDisplayLabel(attachment.name, attachment.placeholder),
        kind = when (attachment.kind) {
            com.remotecodex.android.ui.model.ComposerAttachmentKindPreview.Photo -> ComposerAttachmentActionKind.Photo
            com.remotecodex.android.ui.model.ComposerAttachmentKindPreview.File -> ComposerAttachmentActionKind.File
        },
    )
}

fun attachmentDisplayLabel(
    name: String,
    placeholder: String,
): String {
    val normalizedName = name.trim()
    if (normalizedName.isNotEmpty()) {
        return normalizedName.substringAfterLast('/').substringAfterLast('\\')
    }
    val normalizedPlaceholder = placeholder.trim()
    val label = when {
        normalizedPlaceholder.startsWith("[PHOTO ") -> normalizedPlaceholder.removePrefix("[PHOTO ")
        normalizedPlaceholder.startsWith("[FILE ") -> normalizedPlaceholder.removePrefix("[FILE ")
        normalizedPlaceholder.startsWith("[") -> normalizedPlaceholder.removePrefix("[")
        else -> normalizedPlaceholder
    }.removeSuffix("]").trim()
    return label.ifEmpty { "attachment" }
}

private fun ComposerPromptSelectionRange.normalizedFor(value: String): ComposerPromptSelectionRange {
    val safeStart = start.coerceIn(0, value.length)
    val safeEnd = end.coerceIn(0, value.length)
    return if (safeStart <= safeEnd) {
        ComposerPromptSelectionRange(safeStart, safeEnd)
    } else {
        ComposerPromptSelectionRange(safeEnd, safeStart)
    }
}

fun formatContextTokenKilocount(value: Int): String {
    val safeValue = value.coerceAtLeast(0)
    if (safeValue < 1_000) {
        return safeValue.toString()
    }
    val whole = safeValue / 1_000
    val tenths = (safeValue % 1_000) / 100
    return if (tenths == 0) {
        "${whole}k"
    } else {
        "$whole.${tenths}k"
    }
}

fun buildComposerJumpLatestState(
    activeView: ComposerActiveView,
    followTail: Boolean,
): ComposerJumpLatestState {
    val visible = activeView == ComposerActiveView.Chat
    return ComposerJumpLatestState(
        visible = visible,
        active = visible && followTail,
        accessibilityLabel = "Jump to latest",
        title = if (followTail) "Latest turn is in view" else "Jump to the latest messages",
    )
}

fun buildComposerActionState(
    threadConnected: Boolean,
    busy: Boolean,
    activeView: ComposerActiveView,
    canInterrupt: Boolean,
): ComposerActionState {
    val isShellView = activeView == ComposerActiveView.Shell
    val interruptLabel = if (isShellView) "Send Ctrl-C" else "Stop Current Turn"
    val sendLabel = when {
        !threadConnected && busy -> "Connecting..."
        !threadConnected -> "Send"
        busy && !isShellView -> "Sending..."
        else -> "Send"
    }
    val primaryKind = when {
        canInterrupt && !isShellView -> ComposerPrimaryActionKind.Stop
        !threadConnected && busy -> ComposerPrimaryActionKind.Connecting
        else -> ComposerPrimaryActionKind.Send
    }

    return ComposerActionState(
        primaryLabel = if (primaryKind == ComposerPrimaryActionKind.Stop) interruptLabel else sendLabel,
        primaryKind = primaryKind,
        interruptLabel = interruptLabel,
        showInterrupt = canInterrupt && isShellView,
        sendEnabled = !(busy && isShellView),
    )
}

fun buildComposerStatusStrip(
    threadConnected: Boolean,
    busy: Boolean,
    followTail: Boolean,
    activeView: ComposerActiveView,
    workspaceModeLabel: String?,
): List<ComposerStatusChipModel> {
    val connectionChip = when {
        !threadConnected && busy -> ComposerStatusChipModel("Connecting", ComposerStatusTone.Warning)
        !threadConnected -> ComposerStatusChipModel("Offline", ComposerStatusTone.Danger)
        busy -> ComposerStatusChipModel("Running", ComposerStatusTone.Running)
        else -> ComposerStatusChipModel("Connected", ComposerStatusTone.Success)
    }
    val followChip = ComposerStatusChipModel(
        label = if (followTail) "Following" else "Paused",
        tone = if (followTail) ComposerStatusTone.Success else ComposerStatusTone.Neutral,
    )
    val viewChip = ComposerStatusChipModel(
        label = when (activeView) {
            ComposerActiveView.Chat -> "Chat"
            ComposerActiveView.Shell -> "Shell"
        },
        tone = ComposerStatusTone.Neutral,
    )
    val workspaceChip = workspaceModeLabel
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.let { ComposerStatusChipModel(it, ComposerStatusTone.Neutral) }

    return buildList {
        add(connectionChip)
        add(followChip)
        add(viewChip)
        if (workspaceChip != null) {
            add(workspaceChip)
        }
    }
}

fun threadStatusLabel(status: ThreadStatus): String {
    return when (status) {
        ThreadStatus.Running -> "Running"
        ThreadStatus.Complete -> "Complete"
        ThreadStatus.Failed -> "Failed"
        ThreadStatus.Waiting -> "Waiting"
    }
}

fun graphChatMessageStatusModel(status: String?): MessageStatusModel? {
    val label = status?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val normalized = label.lowercase()
    val tone = when {
        normalized.contains("running") ||
            normalized.contains("generating") ||
            normalized.contains("steering") -> MessageStatusTone.Running
        normalized.contains("failed") ||
            normalized.contains("error") -> MessageStatusTone.Danger
        normalized.contains("accepted") ||
            normalized.contains("complete") -> MessageStatusTone.Success
        else -> MessageStatusTone.Neutral
    }
    return MessageStatusModel(label = label, tone = tone)
}

fun graphChatMessageStatusModel(status: ThreadStatus?): MessageStatusModel? {
    return status?.let { graphChatMessageStatusModel(threadStatusLabel(it)) }
}

fun buildGraphChatMessageFrameState(
    author: MessageAuthor,
    status: ThreadStatus?,
    timeLabel: String?,
    copyText: String?,
): GraphChatMessageFrameState {
    val isUser = author == MessageAuthor.User
    val normalizedTimeLabel = timeLabel?.trim()?.takeIf { it.isNotEmpty() }
    val messageStatus = graphChatMessageStatusModel(status)
    val headerStatus = if (isUser) {
        null
    } else {
        messageStatus ?: graphChatMessageStatusModel("Complete")
    }
    val footerStatus = if (isUser) messageStatus else null

    return GraphChatMessageFrameState(
        isUser = isUser,
        senderLabel = if (isUser) null else "Assistant",
        headerStatus = headerStatus,
        footerStatus = footerStatus,
        showReasoningBeforeContent = !isUser,
        showFooterMetadata = isUser && (footerStatus != null || normalizedTimeLabel != null),
        showCopyAction = !isUser && !copyText.isNullOrBlank(),
        timeLabel = normalizedTimeLabel,
    )
}

fun isGraphChatQueuedLikeUserStatus(status: String?): Boolean {
    val normalized = status?.trim() ?: return false
    return normalized == "Steering" ||
        normalized == "Accepted" ||
        normalized == "Awaiting response"
}

fun buildGraphChatReasoningState(items: List<ReasoningPreview>): GraphChatReasoningState {
    val reasoningText = items
        .map { it.text.trim() }
        .filter { it.isNotEmpty() }
        .joinToString(separator = "\n\n")
    val running = items.any { it.status == ToolStatus.Running }
    val itemCount = items.size

    return GraphChatReasoningState(
        visible = reasoningText.isNotEmpty(),
        title = if (running) "Thinking..." else "Thought Process",
        subtitle = "$itemCount reasoning item${if (itemCount == 1) "" else "s"}",
        text = reasoningText,
        running = running,
        copyLabel = "Copy thoughts",
        copyAccessibilityLabel = "Copy reasoning text",
    )
}

fun attachGraphChatReasoningToAgentMessages(
    messages: List<MessagePreview>,
    reasoningItems: List<ReasoningPreview>,
): GraphChatReasoningAttachmentProjection {
    return projectGraphChatMessagesWithReasoning(
        buildList {
            messages.forEachIndexed { index, message ->
                add(GraphChatReasoningProjectionInput.Message("message:$index", message))
            }
            reasoningItems.forEachIndexed { index, reasoning ->
                add(GraphChatReasoningProjectionInput.Reasoning("reasoning:$index", reasoning))
            }
        },
    )
}

fun projectGraphChatMessagesWithReasoning(
    inputs: List<GraphChatReasoningProjectionInput>,
): GraphChatReasoningAttachmentProjection {
    val output = mutableListOf<MessagePreview>()
    val pendingReasoning = mutableListOf<ReasoningPreview>()

    fun attachReasoningToLastAgent(): Boolean {
        if (pendingReasoning.isEmpty()) {
            return true
        }
        val lastAgentIndex = output.lastIndex
        if (lastAgentIndex < 0 || output[lastAgentIndex].author != MessageAuthor.Assistant) {
            return false
        }
        val message = output[lastAgentIndex]
        output[lastAgentIndex] = message.copy(
            reasoningItems = message.reasoningItems + pendingReasoning.toList(),
        )
        pendingReasoning.clear()
        return true
    }

    inputs.forEach { input ->
        when (input) {
            is GraphChatReasoningProjectionInput.Message -> {
                val message = input.message
                if (message.author == MessageAuthor.Assistant) {
                    output += if (pendingReasoning.isNotEmpty()) {
                        message.copy(reasoningItems = message.reasoningItems + pendingReasoning.toList())
                    } else {
                        message
                    }
                    pendingReasoning.clear()
                } else {
                    output += message
                }
            }
            is GraphChatReasoningProjectionInput.Reasoning -> {
                pendingReasoning += input.reasoning
                attachReasoningToLastAgent()
            }
        }
    }

    return GraphChatReasoningAttachmentProjection(
        messages = output,
        unattachedReasoningItems = pendingReasoning,
    )
}

fun exportStatusLabel(status: ThreadStatus): String {
    return when (status) {
        ThreadStatus.Running -> "running"
        ThreadStatus.Complete -> "completed"
        ThreadStatus.Failed -> "failed"
        ThreadStatus.Waiting -> "waiting"
    }
}

fun toolStatusLabel(status: ToolStatus): String {
    return when (status) {
        ToolStatus.Running -> "Running"
        ToolStatus.Completed -> "Done"
        ToolStatus.Failed -> "Failed"
    }
}

fun toolResultStatusLabel(status: ToolStatus): String {
    return when (status) {
        ToolStatus.Running -> "Running"
        ToolStatus.Completed -> "Completed"
        ToolStatus.Failed -> "Failed"
    }
}

fun planStepStatusLabel(status: PlanStepStatus): String {
    return when (status) {
        PlanStepStatus.Completed -> "Done"
        PlanStepStatus.Running -> "Running"
        PlanStepStatus.Failed -> "Failed"
        PlanStepStatus.Pending -> "Pending"
        PlanStepStatus.Unknown -> "Unknown"
    }
}

fun planStepStatusAccessibilityLabel(status: PlanStepStatus): String {
    val statusLabel = when (status) {
        PlanStepStatus.Completed -> "Completed"
        PlanStepStatus.Running -> "In progress"
        PlanStepStatus.Failed -> "Failed"
        PlanStepStatus.Pending -> "Pending"
        PlanStepStatus.Unknown -> "Unknown"
    }
    return "Plan step status: $statusLabel"
}

fun buildPlanStepStatusPresentationState(status: PlanStepStatus): PlanStepStatusPresentationState {
    return PlanStepStatusPresentationState(
        label = planStepStatusLabel(status),
        accessibilityLabel = planStepStatusAccessibilityLabel(status),
        tone = when (status) {
            PlanStepStatus.Completed -> PlanStepStatusTone.Success
            PlanStepStatus.Running -> PlanStepStatusTone.Running
            PlanStepStatus.Failed -> PlanStepStatusTone.Danger
            PlanStepStatus.Pending -> PlanStepStatusTone.Pending
            PlanStepStatus.Unknown -> PlanStepStatusTone.Unknown
        },
        running = status == PlanStepStatus.Running,
    )
}

fun buildGraphChatLivePlanCardState(livePlan: LivePlanPreview): GraphChatLivePlanCardState {
    return GraphChatLivePlanCardState(
        title = "Plan update",
        badgeLabel = "Live",
        explanation = livePlan.explanation?.trim()?.takeIf { it.isNotEmpty() },
        steps = livePlan.steps.mapIndexed { index, step ->
            LivePlanStepState(
                number = index + 1,
                text = step.step,
                status = step.status,
            )
        },
    )
}

fun buildGraphChatTurnFrameState(
    turn: TurnPreview,
    collapsed: Boolean,
): GraphChatTurnFrameState {
    val statusLabel = turn.statusLabel.trim().ifEmpty { "complete" }
    val messageCount = turn.messages.size
    val messageLabel = if (messageCount == 1) "1 message" else "$messageCount messages"
    val livePlanLabel = if (turn.livePlan != null) " · live plan" else ""
    return GraphChatTurnFrameState(
        indexLabel = if (turn.optimistic) "SENDING" else "TURN ${turn.index}",
        indexTone = if (turn.optimistic) ComposerStatusTone.Warning else ComposerStatusTone.Neutral,
        timeLabel = turn.timeLabel.trim(),
        statusLabel = statusLabel,
        status = if (statusLabel.equals("running", ignoreCase = true)) {
            ThreadStatus.Running
        } else {
            ThreadStatus.Complete
        },
        tokenSummary = turn.tokenSummary.trim().takeIf { it.isNotEmpty() },
        collapseAccessibilityLabel = "${if (collapsed) "Expand" else "Collapse"} turn ${turn.index}",
        collapseTitle = if (collapsed) "Expand turn" else "Collapse turn",
        collapsedSummary = "Turn collapsed · $messageLabel$livePlanLabel",
    )
}

fun buildGraphChatThreadUsageFooterState(
    detail: ThreadDetailPreview,
): GraphChatThreadUsageFooterState {
    return buildGraphChatThreadUsageFooterState(
        turnCount = detail.turns.size,
        itemLabel = detail.items,
        usageLabel = detail.usage,
    )
}

fun buildGraphChatThreadUsageFooterState(
    turnCount: Int,
    itemLabel: String,
    usageLabel: String,
): GraphChatThreadUsageFooterState {
    val turnLabel = "$turnCount turn${if (turnCount == 1) "" else "s"}"
    val normalizedItemLabel = itemLabel.trim().takeIf { it.isNotEmpty() } ?: "0 items"
    val usage = usageLabel.trim().takeIf { it.isNotEmpty() } ?: "waiting for agent usage"
    val usageText = "Usage $usage"
    val transcriptLabel = "$turnLabel | $normalizedItemLabel"
    return GraphChatThreadUsageFooterState(
        transcriptLabel = transcriptLabel,
        usageLabel = usageText,
        accessibilityLabel = "$transcriptLabel. $usageText",
    )
}

fun historyItemLabel(kind: HistoryItemKind): String {
    return when (kind) {
        HistoryItemKind.Plan -> "Plan"
        HistoryItemKind.Context -> "Context"
        HistoryItemKind.Command -> "Command"
        HistoryItemKind.ToolCall -> "Tool"
        HistoryItemKind.AgentTool -> "Agent"
        HistoryItemKind.SkillTool -> "Skill"
        HistoryItemKind.WebSearch -> "Web Search"
        HistoryItemKind.FileRead -> "File Read"
        HistoryItemKind.FileChange -> "File Change"
        HistoryItemKind.Image -> "Image"
        HistoryItemKind.Artifact -> "Artifact"
        HistoryItemKind.Hook -> "Hook"
        HistoryItemKind.Generic -> "Other"
    }
}

fun historyItemShortLabel(kind: HistoryItemKind): String {
    return when (kind) {
        HistoryItemKind.Plan -> "PLAN"
        HistoryItemKind.Context -> "CTX"
        HistoryItemKind.Command -> "CMD"
        HistoryItemKind.ToolCall -> "TOOL"
        HistoryItemKind.AgentTool -> "AGT"
        HistoryItemKind.SkillTool -> "SKL"
        HistoryItemKind.WebSearch -> "WEB"
        HistoryItemKind.FileRead -> "READ"
        HistoryItemKind.FileChange -> "DIFF"
        HistoryItemKind.Image -> "IMG"
        HistoryItemKind.Artifact -> "ART"
        HistoryItemKind.Hook -> "HOOK"
        HistoryItemKind.Generic -> "INFO"
    }
}

fun historyGroupRowOrdinalLabel(kind: HistoryItemKind, index: Int): String? {
    val number = index + 1
    return when (kind) {
        HistoryItemKind.Command -> "Step $number"
        HistoryItemKind.WebSearch -> "Search $number"
        HistoryItemKind.FileRead -> "Read $number"
        HistoryItemKind.FileChange -> null
        else -> "Item $number"
    }
}

fun shouldShowHistoryGroupRowTitle(kind: HistoryItemKind): Boolean {
    return when (kind) {
        HistoryItemKind.Command,
        HistoryItemKind.WebSearch,
        HistoryItemKind.FileRead,
        HistoryItemKind.FileChange,
        -> false
        else -> true
    }
}

fun buildGraphChatHistoryGroupFrameState(
    kind: HistoryItemKind,
    countLabel: String,
    statusLabel: String?,
    itemCount: Int,
    expanded: Boolean,
    changedFiles: Int? = null,
    addedLines: Int? = null,
    removedLines: Int? = null,
): GraphChatHistoryGroupFrameState {
    val trimmedCountLabel = countLabel.trim()
    val trimmedStatusLabel = statusLabel?.trim()?.takeIf { it.isNotEmpty() }
    val subtitle = listOfNotNull(
        trimmedCountLabel.takeIf { it.isNotEmpty() },
        trimmedStatusLabel,
    ).joinToString(" · ").ifBlank {
        "$itemCount ${if (itemCount == 1) "entry" else "entries"}"
    }
    val toggleVerb = if (expanded) "Collapse" else "Expand"
    val toggleTarget = trimmedCountLabel.ifEmpty {
        "$itemCount ${historyGroupToggleNoun(kind, itemCount)}"
    }

    return GraphChatHistoryGroupFrameState(
        title = "Batch",
        subtitle = subtitle,
        countBadgeLabel = graphChatHistoryGroupCountLabel(trimmedCountLabel.ifEmpty { toggleTarget }),
        running = isRunningHistoryStatusLabel(trimmedStatusLabel),
        fileChangeSummarySegments = if (kind == HistoryItemKind.FileChange) {
            fileChangeSummarySegments(
                changedFiles = changedFiles,
                addedLines = addedLines,
                removedLines = removedLines,
                previewText = countLabel,
            )
        } else {
            emptyList()
        },
        toggleAccessibilityLabel = "$toggleVerb $toggleTarget",
        toggleTargetLabel = toggleTarget,
    )
}

private fun historyGroupToggleNoun(kind: HistoryItemKind, count: Int): String {
    val singular = when (kind) {
        HistoryItemKind.Command -> "command entry"
        HistoryItemKind.WebSearch -> "web search entry"
        HistoryItemKind.FileRead -> "file read entry"
        HistoryItemKind.FileChange -> "file change entry"
        else -> "entry"
    }
    return if (count == 1) singular else "${singular}s"
}

fun isRunningHistoryStatusLabel(statusLabel: String?): Boolean {
    val normalized = statusLabel?.trim()?.lowercase() ?: return false
    return normalized == "running" ||
        normalized == "in_progress" ||
        normalized == "in progress" ||
        normalized == "pending"
}

fun graphChatHistoryGroupCountLabel(countLabel: String): String {
    return Regex("\\d+").find(countLabel)?.value ?: countLabel.trim().take(2).uppercase()
}

fun graphChatHistoryStatusState(status: ToolStatus?): GraphChatHistoryStatusState? {
    return status?.let { graphChatHistoryStatusState(toolStatusLabel(it)) }
}

fun graphChatHistoryStatusState(statusLabel: String?): GraphChatHistoryStatusState? {
    val label = statusLabel?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val normalized = label.lowercase()
    return when {
        normalized == "completed" ||
            normalized == "complete" ||
            normalized == "done" ||
            normalized == "success" ||
            normalized == "succeeded" -> GraphChatHistoryStatusState(
            label = "Completed",
            tone = GraphChatHistoryStatusTone.Success,
        )
        normalized == "failed" ||
            normalized == "failure" ||
            normalized == "error" ||
            normalized == "errored" -> GraphChatHistoryStatusState(
            label = "Failed",
            tone = GraphChatHistoryStatusTone.Danger,
        )
        isRunningHistoryStatusLabel(label) -> GraphChatHistoryStatusState(
            label = label,
            tone = GraphChatHistoryStatusTone.Running,
        )
        else -> GraphChatHistoryStatusState(
            label = label,
            tone = GraphChatHistoryStatusTone.Neutral,
        )
    }
}

fun buildGraphChatHistoryItemFrameState(
    kind: HistoryItemKind,
    title: String,
    status: ToolStatus?,
    meta: String?,
    summary: String,
    detail: String?,
    actionLabel: String?,
    hasDeferredDetail: Boolean = false,
    changedFiles: Int? = null,
    addedLines: Int? = null,
    removedLines: Int? = null,
): GraphChatHistoryItemFrameState {
    val normalizedSummary = graphChatHistoryItemSummary(kind, summary)
    val normalizedDetail = detail?.takeIf { it.isNotBlank() }
    val toolAction = graphChatHistoryToolActionState(kind)
    val normalizedAction = toolAction?.label
        ?: actionLabel?.trim()?.takeIf { it.isNotEmpty() }
    val isFileChange = kind == HistoryItemKind.FileChange
    val showAction = normalizedAction != null &&
        kind != HistoryItemKind.Artifact &&
        !isFileChange
    val displayTitle = toolAction?.eventTitle ?: title
    val detailTitle = toolAction?.detailTitle
        ?: normalizedAction
        ?: title
    val copyText = graphChatHistoryItemCopyText(
        title = displayTitle,
        meta = meta,
        status = status,
        summary = summary,
        detail = detail,
    )

    return GraphChatHistoryItemFrameState(
        title = displayTitle,
        status = graphChatHistoryStatusState(status),
        summary = normalizedSummary,
        running = status == ToolStatus.Running,
        runningLabel = "Running from thread events",
        showDetail = normalizedDetail != null &&
            kind != HistoryItemKind.Artifact &&
            kind != HistoryItemKind.Hook &&
            !isFileChange,
        showFileChangeDelta = isFileChange,
        fileChangeSummarySegments = if (isFileChange) {
            fileChangeSummarySegments(
                changedFiles = changedFiles,
                addedLines = addedLines,
                removedLines = removedLines,
                previewText = summary,
            )
        } else {
            emptyList()
        },
        fileChangeCanOpen = isFileChange && (normalizedDetail != null || hasDeferredDetail),
        fileChangeOpenAccessibilityLabel = if (isFileChange && (normalizedDetail != null || hasDeferredDetail)) {
            "Open file change details"
        } else {
            null
        },
        showImagePreview = kind == HistoryItemKind.Image,
        showAction = showAction,
        actionLabel = normalizedAction?.takeIf { showAction },
        actionAccessibilityLabel = normalizedAction
            ?.takeIf { showAction }
            ?.let { toolAction?.accessibilityLabel ?: "Open ${it.lowercase()}" },
        detailTitle = detailTitle,
        showCopy = copyText.isNotBlank(),
        copyText = copyText,
    )
}

data class GraphChatHistoryToolActionState(
    val eventTitle: String,
    val label: String,
    val accessibilityLabel: String,
    val detailTitle: String,
)

fun graphChatHistoryToolActionState(kind: HistoryItemKind): GraphChatHistoryToolActionState? {
    return when (kind) {
        HistoryItemKind.Command -> GraphChatHistoryToolActionState(
            eventTitle = "command",
            label = "Command Output",
            accessibilityLabel = "Open full command",
            detailTitle = "Command Output",
        )
        HistoryItemKind.ToolCall -> GraphChatHistoryToolActionState(
            eventTitle = "tool_call",
            label = "Tool Call Details",
            accessibilityLabel = "Open full tool call",
            detailTitle = "Tool Call Details",
        )
        HistoryItemKind.AgentTool -> GraphChatHistoryToolActionState(
            eventTitle = "agent",
            label = "Agent Details",
            accessibilityLabel = "Open agent details",
            detailTitle = "Agent Details",
        )
        HistoryItemKind.SkillTool -> GraphChatHistoryToolActionState(
            eventTitle = "skill",
            label = "Skill Details",
            accessibilityLabel = "Open skill details",
            detailTitle = "Skill Details",
        )
        HistoryItemKind.WebSearch -> GraphChatHistoryToolActionState(
            eventTitle = "web_search",
            label = "Web Search Details",
            accessibilityLabel = "Open full web search",
            detailTitle = "Web Search Details",
        )
        HistoryItemKind.FileRead -> GraphChatHistoryToolActionState(
            eventTitle = "file_read",
            label = "File Read Details",
            accessibilityLabel = "Open full file read",
            detailTitle = "File Read Details",
        )
        else -> null
    }
}

fun graphChatHistoryItemSummary(kind: HistoryItemKind, summary: String): String {
    return if (kind == HistoryItemKind.FileChange) {
        formatTrailingPathLabel(summary, maxLength = 48)
    } else {
        summary
    }
}

fun graphChatHistoryGroupRowSummary(kind: HistoryItemKind, summary: String): String {
    return if (kind == HistoryItemKind.FileChange) {
        formatTrailingPathLabel(summary, maxLength = 34)
    } else {
        summary
    }
}

fun graphChatHistoryGroupRowDetailTitle(
    kind: HistoryItemKind,
    index: Int,
    meta: String?,
    actionLabel: String?,
    title: String,
): String {
    val number = index + 1
    val baseTitle = when (kind) {
        HistoryItemKind.Command -> "Command Output"
        HistoryItemKind.WebSearch -> "Web Search"
        HistoryItemKind.FileRead -> "File Read"
        HistoryItemKind.FileChange -> "File Change"
        else -> meta?.trim()?.takeIf { it.isNotEmpty() }
            ?: actionLabel?.trim()?.takeIf { it.isNotEmpty() }
            ?: title
    }
    return "$baseTitle $number"
}

fun graphChatHistoryDetailText(
    kind: HistoryItemKind,
    title: String,
    summary: String,
    detail: String?,
    hasDeferredDetail: Boolean = false,
): String {
    val normalizedDetail = detail?.trim()?.takeIf { it.isNotEmpty() }
    if (normalizedDetail != null) {
        return normalizedDetail
    }
    return if (kind == HistoryItemKind.FileChange && hasDeferredDetail) {
        title.trim().takeIf { it.isNotEmpty() } ?: summary
    } else {
        summary
    }
}

fun graphChatHistoryItemCopyText(
    title: String,
    meta: String?,
    status: ToolStatus?,
    summary: String,
    detail: String?,
): String {
    return buildString {
        appendLine(title)
        meta?.takeIf { it.isNotBlank() }?.let { appendLine(it) }
        status?.let { appendLine(toolStatusLabel(it)) }
        summary.takeIf { it.isNotBlank() }?.let { appendLine(it) }
        detail?.takeIf { it.isNotBlank() }?.let {
            if (isNotEmpty()) appendLine()
            appendLine(it)
        }
    }.trim()
}

fun buildGraphChatImageHistoryState(
    text: String,
    detail: String?,
    assetPath: String?,
    imageLabel: String?,
): GraphChatImageHistoryState {
    val normalizedText = text.trim()
    val normalizedDetail = detail?.trim()?.takeIf { it.isNotEmpty() }
    val normalizedAssetPath = assetPath?.trim()?.takeIf { it.isNotEmpty() } ?: normalizedDetail
    val previewLabel = imageLabel?.trim()?.takeIf { it.isNotEmpty() }
        ?: normalizedText.takeIf { it.isNotEmpty() }
        ?: "Image preview"
    val openText = normalizedAssetPath ?: normalizedText.ifEmpty { "Image preview" }

    return GraphChatImageHistoryState(
        previewLabel = previewLabel,
        assetPath = normalizedAssetPath,
        fallbackSummary = normalizedText.ifEmpty { "Image preview" },
        openTitle = "Image Path",
        openText = openText,
        pathAccessibilityLabel = normalizedAssetPath?.let { "Open image path" },
        copyAccessibilityLabel = normalizedAssetPath?.let { "Copy image path" },
    )
}

fun buildPendingRequestCardState(request: PendingRequestPreview): PendingRequestCardState {
    val title = request.title.trim().ifEmpty { "Answer Required" }
    val description = request.description.trim()
    val riskLabel = request.riskLabel.trim().ifEmpty { "Permission required" }
    val command = request.command.trim()
    val questions = request.questions.mapIndexedNotNull { index, question ->
        val id = question.id?.trim()
        val header = question.header.trim()
        val questionText = question.question.trim()
        if (header.isEmpty() && questionText.isEmpty()) {
            null
        } else {
            PendingRequestQuestionState(
                id = id?.takeIf { it.isNotEmpty() } ?: "question-$index",
                header = header.ifEmpty { "Question" },
                question = questionText,
                options = question.options.mapNotNull(::buildPendingRequestOptionState),
                multiSelect = question.multiSelect,
                otherLabel = if (question.allowOther) "Not from above" else null,
            )
        }
    }

    return PendingRequestCardState(
        title = title,
        description = description,
        riskLabel = riskLabel,
        commandLabel = "Requested action",
        command = command,
        questions = questions,
        denyLabel = "Deny",
        approveLabel = "Approve",
        submitLabel = "Submit",
        denyAccessibilityLabel = "Deny $title",
        approveAccessibilityLabel = "Approve $title",
        submitAccessibilityLabel = "Submit $title",
        disabledSubmitAccessibilityLabel = "Answer each question before submitting $title",
    )
}

private fun buildPendingRequestOptionState(
    option: PendingRequestOptionPreview,
): PendingRequestOptionState? {
    val rawLabel = option.label.trim()
    if (rawLabel.isEmpty()) {
        return null
    }
    val recommendedPattern = Regex("\\s*\\(recommended\\)\\s*$", RegexOption.IGNORE_CASE)
    val displayLabel = rawLabel.replace(recommendedPattern, "").trim().ifEmpty { rawLabel }
    return PendingRequestOptionState(
        rawLabel = rawLabel,
        displayLabel = displayLabel,
        description = option.description.trim(),
        recommended = recommendedPattern.containsMatchIn(rawLabel),
    )
}

fun buildTimelineNoteCardState(
    note: TimelineNotePreview,
    tone: TimelineNoteToneState,
): TimelineNoteCardState {
    val title = note.title.trim().ifEmpty {
        if (tone == TimelineNoteToneState.Activity) "System" else "Resolved"
    }
    val summaryLines = note.summaryLines
        .map { line -> line.trim() }
        .filter { line -> line.isNotEmpty() }
        .map { line ->
            if (tone == TimelineNoteToneState.Answered && !line.startsWith("You selected ")) {
                "You selected $line"
            } else {
                line
            }
        }

    return TimelineNoteCardState(
        label = if (tone == TimelineNoteToneState.Activity) "Activity" else "Resolved",
        title = title,
        summaryLines = summaryLines,
        timeLabel = note.timeLabel?.trim()?.takeIf { it.isNotEmpty() },
        tone = tone,
    )
}

fun buildPendingSteerCardState(steer: TimelineSteerPreview): AuxiliaryUserNoteCardState {
    val statusLabel = steer.statusLabel?.trim()?.takeIf { it.isNotEmpty() } ?: "Queued"
    return AuxiliaryUserNoteCardState(
        statusLabel = statusLabel,
        footerStatus = graphChatMessageStatusModel(statusLabel),
        text = steer.prompt.trim(),
        timeLabel = steer.timeLabel.trim().takeIf { it.isNotEmpty() },
        tone = if (isGraphChatQueuedLikeUserStatus(statusLabel)) {
            PendingSteerToneState.QueuedUserMessage
        } else {
            PendingSteerToneState.Warning
        },
    )
}

fun buildEphemeralUserNoteCardState(text: String): AuxiliaryUserNoteCardState {
    return AuxiliaryUserNoteCardState(
        statusLabel = "",
        footerStatus = null,
        text = text.trim(),
        timeLabel = null,
        tone = PendingSteerToneState.QueuedUserMessage,
    )
}

fun buildContextCompactionHistoryState(
    text: String,
    status: ToolStatus?,
    detailText: String?,
): ContextCompactionHistoryState {
    val normalizedText = text.trim()
    val running = status == ToolStatus.Running || normalizedText == "Compacting context"
    val primaryText = if (running) "Compacting context" else "Context compacted"
    val secondaryText = detailText
        ?.trim()
        ?.takeIf { it.isNotEmpty() && it != primaryText }

    return ContextCompactionHistoryState(
        primaryText = primaryText,
        secondaryText = secondaryText,
        running = running,
    )
}

fun isScrollableHistoryItem(kind: HistoryItemKind): Boolean {
    return kind == HistoryItemKind.Command || kind == HistoryItemKind.Context
}

fun fileChangeSummarySegments(
    changedFiles: Int?,
    addedLines: Int?,
    removedLines: Int?,
    previewText: String?,
): List<FileChangeSummarySegment> {
    val structured = buildList {
        changedFiles?.takeIf { it > 0 }?.let { files ->
            add(FileChangeSummarySegment("${files} ${if (files == 1) "file" else "files"}", FileChangeSummaryTone.Files))
        }
        addedLines?.takeIf { it > 0 }?.let { lines ->
            add(FileChangeSummarySegment("+$lines", FileChangeSummaryTone.Added))
        }
        removedLines?.takeIf { it > 0 }?.let { lines ->
            add(FileChangeSummarySegment("-$lines", FileChangeSummaryTone.Removed))
        }
    }

    if (structured.isNotEmpty()) {
        return structured
    }

    val fallback = previewText?.trim()?.takeIf { it.isNotEmpty() } ?: return emptyList()
    return fallback
        .replace(Regex("\\bfiles changed\\b", RegexOption.IGNORE_CASE), "files")
        .replace(Regex("\\bfile changed\\b", RegexOption.IGNORE_CASE), "file")
        .split('·')
        .mapNotNull { segment ->
            val label = segment.trim()
            if (label.isEmpty()) {
                null
            } else {
                FileChangeSummarySegment(label, FileChangeSummaryTone.Neutral)
            }
        }
}

fun projectRelativePathLabel(label: String): String {
    val normalized = label.trim()
    if (normalized.isEmpty()) {
        return ""
    }

    val suffixMatch = Regex("(, \\+\\d+ more.*)$").find(normalized)
    val suffix = suffixMatch?.value.orEmpty()
    val base = if (suffix.isNotEmpty()) normalized.dropLast(suffix.length) else normalized
    val slashNormalized = base.replace('\\', '/')
    if (!slashNormalized.startsWith('/')) {
        return slashNormalized.removePrefix("./") + suffix
    }

    val markers = listOf(
        "/apps/",
        "/packages/",
        "/src/",
        "/test/",
        "/tests/",
        "/docs/",
        "/config/",
        "/scripts/",
        "/e2e/",
        "/.agents/",
        "/.codex/",
    )
    markers.forEach { marker ->
        val index = slashNormalized.indexOf(marker)
        if (index >= 0) {
            return slashNormalized.substring(index + 1) + suffix
        }
    }

    return normalized
}

fun formatTrailingPathLabel(label: String, maxLength: Int = 42): String {
    val normalized = projectRelativePathLabel(label)
    if (normalized.isEmpty()) {
        return ""
    }

    val safeMaxLength = maxLength.coerceAtLeast(8)
    val suffixMatch = Regex("(, \\+\\d+ more.*)$").find(normalized)
    val suffix = suffixMatch?.value.orEmpty()
    val base = if (suffix.isNotEmpty()) normalized.dropLast(suffix.length) else normalized
    if (base.length <= safeMaxLength) {
        return base + suffix
    }

    val segments = base.replace('\\', '/').split('/').filter { it.isNotBlank() }
    if (segments.size > 1) {
        val keptSegments = ArrayDeque<String>()
        var currentLength = suffix.length + 4
        for (index in segments.indices.reversed()) {
            val candidate = segments[index]
            val nextLength = currentLength + candidate.length + if (keptSegments.isNotEmpty()) 1 else 0
            if (keptSegments.isNotEmpty() && nextLength > safeMaxLength) {
                break
            }
            keptSegments.addFirst(candidate)
            currentLength = nextLength
        }

        if (keptSegments.isNotEmpty()) {
            return ".../${keptSegments.joinToString("/")}$suffix"
        }
    }

    val tailLength = (safeMaxLength - suffix.length - 3).coerceAtLeast(1)
    return "..." + base.takeLast(tailLength) + suffix
}

fun summarizeInlinePreviewText(text: String): InlinePreviewSummary {
    val lines = text.replace("\r\n", "\n").split('\n').toMutableList()
    while (lines.size > 1 && lines.last().trim().isEmpty()) {
        lines.removeAt(lines.lastIndex)
    }

    val firstLine = lines.firstOrNull().orEmpty()
    val truncated = lines.size > 1
    return InlinePreviewSummary(
        firstLine = firstLine,
        showGap = truncated,
        isTruncated = truncated,
    )
}

fun hookHistorySummary(
    text: String,
    hookEventLabel: String?,
    hookStatusMessage: String?,
    previewText: String?,
    hookOutput: String?,
): HookHistorySummary {
    val outputText = hookOutput
        ?.lines()
        ?.map { it.trim() }
        ?.filter { it.isNotEmpty() }
        ?.joinToString("\n")
        ?.trim()
        .orEmpty()
    val baseText = text.trim()
    val hookLabel = hookEventLabel
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.let { "$it hook" }
        ?: baseText
    val eventTitle = hookEventLabel
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.let { "${it}_hook" }
        ?: "hook"
    val status = hookStatusMessage?.trim().orEmpty()
    val preview = previewText?.trim().orEmpty()
    val fallbackText = status
        .ifEmpty { preview.takeIf { it.isNotEmpty() && it != status }.orEmpty() }
        .ifEmpty { baseText }
    val summaryText = outputText.ifEmpty {
        fallbackText.takeIf { it.isNotEmpty() && it != hookLabel } ?: hookLabel
    }
    val summary = summarizeInlinePreviewText(summaryText)
    val firstLine = if (outputText.isNotEmpty()) {
        summary.firstLine
    } else if (summary.firstLine.isNotEmpty() && summary.firstLine != hookLabel) {
        "$hookLabel · ${summary.firstLine}"
    } else {
        hookLabel
    }

    return HookHistorySummary(
        eventTitle = eventTitle,
        hookLabel = hookLabel,
        hookMetaLabel = hookLabel.uppercase(),
        displayText = firstLine,
        firstLine = firstLine,
        showGap = outputText.isNotEmpty() && summary.showGap,
        showMetaLabel = outputText.isNotEmpty(),
        outputBacked = outputText.isNotEmpty(),
    )
}

fun artifactHistorySummary(
    text: String,
    previewText: String?,
    artifactType: String?,
    artifactTitle: String?,
    artifactSummary: String?,
    hasRenderer: Boolean,
    actionLabel: String? = null,
): ArtifactHistorySummary {
    val title = artifactTitle?.trim()?.takeIf { it.isNotEmpty() } ?: text.trim()
    val summary = artifactSummary?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?: previewText?.trim()?.takeIf { it.isNotEmpty() }
        ?: text.trim()
    val detailText = previewText?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?: artifactSummary?.trim()?.takeIf { it.isNotEmpty() }
        ?: text.trim()
    val typeLabel = artifactType?.trim()?.takeIf { it.isNotEmpty() } ?: "artifact"
    return ArtifactHistorySummary(
        title = title,
        summary = summary,
        detailText = detailText,
        typeLabel = typeLabel,
        rendererLabel = if (hasRenderer) null else "No renderer",
        inspectLabel = actionLabel
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.let { "Inspect" },
        inspectAccessibilityLabel = actionLabel
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?.let { "Open artifact inspector for $title" },
        collapsedToggleLabel = "Open",
        expandedToggleLabel = "Hide",
    )
}
