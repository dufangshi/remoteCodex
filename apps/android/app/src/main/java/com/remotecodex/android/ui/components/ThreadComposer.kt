package com.remotecodex.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.ComposerSlashPanelViewPreview
import com.remotecodex.android.ui.model.ComposerPreview
import com.remotecodex.android.ui.model.ComposerHookEventNamePreview
import com.remotecodex.android.ui.model.ComposerHookFormPreview
import com.remotecodex.android.ui.model.ComposerHookHandlerTypePreview
import com.remotecodex.android.ui.model.ComposerHookPreview
import com.remotecodex.android.ui.model.ComposerHookScopePreview
import com.remotecodex.android.ui.model.ComposerHookSourcePreview
import com.remotecodex.android.ui.model.ComposerHookTrustStatusPreview
import com.remotecodex.android.ui.model.ComposerHooksPanelModePreview
import com.remotecodex.android.ui.model.ComposerMcpPanelModePreview
import com.remotecodex.android.ui.model.ComposerMcpAuthStatusPreview
import com.remotecodex.android.ui.model.ComposerMcpServerPreview
import com.remotecodex.android.ui.model.ComposerMcpToolPreview
import com.remotecodex.android.ui.model.ComposerPromptPreview
import com.remotecodex.android.ui.model.ThreadGoalPreview
import com.remotecodex.android.ui.model.ThreadGoalStatusPreview
import com.remotecodex.android.ui.presentation.ComposerActionState
import com.remotecodex.android.ui.presentation.ComposerAttachmentActionKind
import com.remotecodex.android.ui.presentation.ComposerAttachmentActionState
import com.remotecodex.android.ui.presentation.ComposerAttachmentPanelState
import com.remotecodex.android.ui.presentation.ComposerContextUsageState
import com.remotecodex.android.ui.presentation.ComposerForkActionState
import com.remotecodex.android.ui.presentation.ComposerForkActionKind
import com.remotecodex.android.ui.presentation.ComposerForkLifecycleState
import com.remotecodex.android.ui.presentation.ComposerForkPanelState
import com.remotecodex.android.ui.presentation.ComposerForkTurnPickerRowState
import com.remotecodex.android.ui.presentation.ComposerFrameState
import com.remotecodex.android.ui.presentation.ComposerGoalComposeCardState
import com.remotecodex.android.ui.presentation.ComposerGoalPanelState
import com.remotecodex.android.ui.presentation.ComposerCurrentGoalState
import com.remotecodex.android.ui.presentation.ComposerHookActionKind
import com.remotecodex.android.ui.presentation.ComposerHookFormState
import com.remotecodex.android.ui.presentation.ComposerHookRowState
import com.remotecodex.android.ui.presentation.ComposerHooksPanelState
import com.remotecodex.android.ui.presentation.ComposerHookStatusMessageState
import com.remotecodex.android.ui.presentation.ComposerJumpLatestState
import com.remotecodex.android.ui.presentation.ComposerMcpAddOptionState
import com.remotecodex.android.ui.presentation.ComposerMcpFormState
import com.remotecodex.android.ui.presentation.ComposerMcpPanelState
import com.remotecodex.android.ui.presentation.ComposerMcpServerRowState
import com.remotecodex.android.ui.presentation.ComposerMcpStatusMessageState
import com.remotecodex.android.ui.presentation.ComposerMcpStatusTone
import com.remotecodex.android.ui.presentation.ComposerMenuLifecycleState
import com.remotecodex.android.ui.presentation.ComposerPrimaryActionKind
import com.remotecodex.android.ui.presentation.ComposerPromptAttachmentState
import com.remotecodex.android.ui.presentation.ComposerPromptAttachmentTokenTone
import com.remotecodex.android.ui.presentation.ComposerPromptSegmentState
import com.remotecodex.android.ui.presentation.ComposerShellPromptInputState
import com.remotecodex.android.ui.presentation.ComposerPromptSlotState
import com.remotecodex.android.ui.presentation.ComposerSendButtonState
import com.remotecodex.android.ui.presentation.ComposerSettingsState
import com.remotecodex.android.ui.presentation.ComposerSettingsToolbarState
import com.remotecodex.android.ui.presentation.ComposerSelectionOptionState
import com.remotecodex.android.ui.presentation.ComposerShellToolKind
import com.remotecodex.android.ui.presentation.ComposerShellToolState
import com.remotecodex.android.ui.presentation.ComposerShellToolsPanelState
import com.remotecodex.android.ui.presentation.ComposerShellToolTone
import com.remotecodex.android.ui.presentation.ComposerSlashPanelViewState
import com.remotecodex.android.ui.presentation.ComposerSlashToolboxPanelState
import com.remotecodex.android.ui.presentation.ComposerSkillErrorState
import com.remotecodex.android.ui.presentation.ComposerSkillRowState
import com.remotecodex.android.ui.presentation.ComposerSkillsPanelState
import com.remotecodex.android.ui.presentation.ComposerStatusChipModel
import com.remotecodex.android.ui.presentation.ComposerStatusTone
import com.remotecodex.android.ui.presentation.ComposerToolboxActionDecisionKind
import com.remotecodex.android.ui.presentation.ComposerToolboxActionDecisionState
import com.remotecodex.android.ui.presentation.ComposerToolboxItemState
import com.remotecodex.android.ui.presentation.ComposerToolboxItemTone
import com.remotecodex.android.ui.presentation.ComposerToolbarButtonState
import com.remotecodex.android.ui.presentation.ComposerToolbarMenuState
import com.remotecodex.android.ui.presentation.ComposerToolbarState
import com.remotecodex.android.ui.presentation.buildComposerActionState
import com.remotecodex.android.ui.presentation.buildComposerAttachmentPanelState
import com.remotecodex.android.ui.presentation.buildAttachmentInsertionState
import com.remotecodex.android.ui.presentation.buildComposerContextUsageState
import com.remotecodex.android.ui.presentation.buildComposerForkPanelState
import com.remotecodex.android.ui.presentation.buildComposerFrameState
import com.remotecodex.android.ui.presentation.buildComposerGoalPanelState
import com.remotecodex.android.ui.presentation.buildComposerHooksPanelState
import com.remotecodex.android.ui.presentation.buildComposerMenuLifecycleState
import com.remotecodex.android.ui.presentation.buildComposerMcpPanelState
import com.remotecodex.android.ui.presentation.buildComposerModelOptions
import com.remotecodex.android.ui.presentation.buildComposerPromptSlotState
import com.remotecodex.android.ui.presentation.buildComposerReasoningEffortOptions
import com.remotecodex.android.ui.presentation.buildComposerSettingsState
import com.remotecodex.android.ui.presentation.buildComposerSettingsToolbarState
import com.remotecodex.android.ui.presentation.buildComposerShellPromptInputState
import com.remotecodex.android.ui.presentation.buildComposerShellTools
import com.remotecodex.android.ui.presentation.buildComposerShellToolsPanelState
import com.remotecodex.android.ui.presentation.buildComposerSlashToolboxPanelState
import com.remotecodex.android.ui.presentation.buildComposerSkillsPanelState
import com.remotecodex.android.ui.presentation.buildComposerStatusStrip
import com.remotecodex.android.ui.presentation.buildComposerSubmitInputState
import com.remotecodex.android.ui.presentation.buildComposerToolbarState
import com.remotecodex.android.ui.presentation.buildComposerToolboxItems
import com.remotecodex.android.ui.theme.ThreadColors

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ThreadComposer(
    modifier: Modifier = Modifier,
    composer: ComposerPreview = ComposerPreview(),
) {
    var openMenu by remember { mutableStateOf<ComposerMenu?>(null) }
    var slashPanelView by remember(composer.slashPanelView) { mutableStateOf(composer.slashPanelView.toPanelViewState()) }
    var copiedSkillName by remember(composer.skillsPanel.copiedSkillName) { mutableStateOf(composer.skillsPanel.copiedSkillName) }
    var mcpPanelMode by remember(composer.mcpPanel.mode) { mutableStateOf(composer.mcpPanel.mode) }
    var mcpPanelServers by remember(composer.mcpPanel.servers) { mutableStateOf(composer.mcpPanel.servers) }
    var mcpPanelSuccess by remember(composer.mcpPanel.configSuccess) { mutableStateOf(composer.mcpPanel.configSuccess) }
    var hooksPanelMode by remember(composer.hooksPanel.mode) { mutableStateOf(composer.hooksPanel.mode) }
    var hooksPanelForm by remember(composer.hooksPanel.form) { mutableStateOf(composer.hooksPanel.form) }
    var hooksPanelHooks by remember(composer.hooksPanel.hooks) { mutableStateOf(composer.hooksPanel.hooks) }
    var hooksPanelSuccess by remember(composer.hooksPanel.configSuccess) { mutableStateOf(composer.hooksPanel.configSuccess) }
    var forkPreviewStatus by remember(composer.forkTurnOptions) { mutableStateOf<String?>(null) }
    var selectedModel by remember(composer.context.model) { mutableStateOf(composer.context.model) }
    var selectedReasoningEffort by remember(composer.reasoningEffort) { mutableStateOf(composer.reasoningEffort) }
    var draftPrompt by remember(composer.prompt) { mutableStateOf(composer.prompt) }
    var planModeSelected by remember(composer.planModeActive) { mutableStateOf(composer.planModeActive) }
    var fastModeSelected by remember(composer.fastMode) { mutableStateOf(composer.fastMode) }
    var goalComposeMode by remember(composer.goalComposeMode, composer.goalPanel.composeMode) {
        mutableStateOf(composer.goalComposeMode || composer.goalPanel.composeMode)
    }
    var goalLocalError by remember(composer.goalPanel.localError) { mutableStateOf(composer.goalPanel.localError) }
    var goalPreviewStatus by remember { mutableStateOf<String?>(null) }
    var currentGoalPreview by remember(composer.goalPanel.currentGoal) { mutableStateOf(composer.goalPanel.currentGoal) }
    var fastModePreviewStatus by remember { mutableStateOf<String?>(null) }
    var compactBusyPreview by remember(composer.compactBusy) { mutableStateOf(composer.compactBusy) }
    var compactPreviewStatus by remember { mutableStateOf<String?>(null) }
    var shellToolPreviewStatus by remember { mutableStateOf<String?>(null) }
    val selectedContext = composer.context.copy(model = selectedModel)
    val queuedAttachmentCount = draftPrompt.attachments.size
    val statusChips = buildComposerStatusStrip(
        threadConnected = composer.threadConnected,
        busy = composer.busy,
        followTail = composer.followTail,
        activeView = composer.activeView,
        workspaceModeLabel = composer.workspaceModeLabel,
    )
    val actionState = buildComposerActionState(
        threadConnected = composer.threadConnected,
        busy = composer.busy,
        activeView = composer.activeView,
        canInterrupt = composer.canInterrupt,
    )
    val contextState = buildComposerContextUsageState(composer.context)
    val promptSlotState = buildComposerPromptSlotState(
        prompt = draftPrompt,
        activeView = composer.activeView,
        actionState = actionState,
        busy = composer.busy,
        goalBusy = composer.goalPanel.busy,
        goalComposeMode = goalComposeMode,
    )
    val shellPromptInputState = buildComposerShellPromptInputState(promptSlotState)
    val submitInputState = buildComposerSubmitInputState(
        prompt = draftPrompt,
        activeView = composer.activeView,
    )
    val attachmentPanelState = buildComposerAttachmentPanelState(
        open = openMenu == ComposerMenu.Attachments,
        prompt = draftPrompt,
    )
    val settingsState = buildComposerSettingsState(
        context = selectedContext,
        reasoningEffort = selectedReasoningEffort,
        supportedReasoningEffortCount = composer.supportedReasoningEffortCount,
        modelOptionCount = composer.modelOptions.size,
        settingsBusy = composer.settingsBusy,
        fastMode = fastModeSelected,
        planModeAvailable = composer.planModeAvailable,
        planModeActive = planModeSelected,
    )
    val settingsToolbarState = buildComposerSettingsToolbarState(
        settingsState = settingsState,
        openMenu = openMenu.toToolbarMenuState(),
        actionState = actionState,
        activeView = composer.activeView,
        promptDisabled = composer.prompt.disabled,
        goalComposeMode = goalComposeMode,
        goalBusy = composer.goalPanel.busy,
    )
    val toolbarState = buildComposerToolbarState(
        activeView = composer.activeView,
        openMenu = openMenu.toToolbarMenuState(),
        settingsState = settingsState,
        canToggleShellView = true,
        shellPromptLabel = composer.prompt.text.ifBlank { null },
    )
    val modelOptions = buildComposerModelOptions(
        currentModel = selectedModel,
        options = composer.modelOptions,
    )
    val reasoningEffortOptions = buildComposerReasoningEffortOptions(
        currentEffort = selectedReasoningEffort,
        options = composer.reasoningEffortOptions,
    )
    val shellTools = buildComposerShellTools(
        busy = composer.busy,
        shellControl = composer.shellControl,
    )
    val shellToolsPanelState = buildComposerShellToolsPanelState(
        open = openMenu == ComposerMenu.ShellTools,
        tools = shellTools,
    )
    val toolboxItems = buildComposerToolboxItems(
        items = composer.toolboxItems,
        fastMode = fastModeSelected,
        compactBusy = compactBusyPreview,
        goalComposeMode = goalComposeMode,
        goalStatus = composer.goalStatus,
        busy = composer.busy,
        settingsBusy = composer.settingsBusy,
        forkBusy = composer.forkBusy,
    )
    val slashToolboxPanelState = buildComposerSlashToolboxPanelState(
        open = openMenu == ComposerMenu.Slash,
        view = slashPanelView.toPreviewPanelView(),
        items = toolboxItems,
    )
    val menuLifecycleState = buildComposerMenuLifecycleState(
        openMenu = openMenu.toToolbarMenuState(),
        slashPanelView = slashPanelView.toPreviewPanelView(),
    )
    val forkPanelState = buildComposerForkPanelState(
        busy = composer.busy,
        forkBusy = composer.forkBusy,
        slashPanelView = slashPanelView.toPreviewPanelView(),
        forkTurnOptions = composer.forkTurnOptions,
    )
    val goalPanelState = buildComposerGoalPanelState(
        composer.goalPanel.copy(
            composeMode = goalComposeMode,
            localError = goalLocalError,
            currentGoal = currentGoalPreview,
            fastMode = fastModeSelected || composer.goalPanel.fastMode,
        ),
    )
    val frameState = buildComposerFrameState(
        activeView = composer.activeView,
        followTail = composer.followTail,
        goalComposeMode = goalPanelState.composeCard.visible,
        error = composer.error,
    )
    val skillsPanelState = buildComposerSkillsPanelState(
        composer.skillsPanel.copy(copiedSkillName = copiedSkillName),
    )
    val mcpPanelState = buildComposerMcpPanelState(
        composer.mcpPanel.copy(
            mode = mcpPanelMode,
            configSuccess = mcpPanelSuccess,
            servers = mcpPanelServers,
        ),
    )
    val hooksPanelState = buildComposerHooksPanelState(
        composer.hooksPanel.copy(
            mode = hooksPanelMode,
            form = hooksPanelForm,
            configSuccess = hooksPanelSuccess,
            hooks = hooksPanelHooks,
        ),
    )
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
            .then(frameState.formTestTag?.let { Modifier.testTag(it) } ?: Modifier)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (openMenu != null) {
            when (openMenu) {
                ComposerMenu.Slash -> SlashToolboxPanel(
                    panelState = slashToolboxPanelState,
                    menuLifecycleState = menuLifecycleState,
                    forkPanelState = forkPanelState,
                    skillsPanelState = skillsPanelState,
                    mcpPanelState = mcpPanelState,
                    hooksPanelState = hooksPanelState,
                    onSlashPanelViewChange = { view ->
                        slashPanelView = view
                    },
                    onCopySkill = { skillName ->
                        copiedSkillName = skillName
                    },
                    onForkLatest = {
                        forkPreviewStatus = "Fork preview started from latest turn"
                        slashPanelView = ComposerSlashPanelViewState.Root
                        openMenu = null
                    },
                    onForkTurn = { turnTitle ->
                        forkPreviewStatus = "Fork preview started from $turnTitle"
                        slashPanelView = ComposerSlashPanelViewState.Root
                        openMenu = null
                    },
                    onMcpPanelModeChange = { mode ->
                        mcpPanelMode = mode
                        mcpPanelSuccess = null
                    },
                    onMcpSave = { form ->
                        val savedServer = form.toPreviewMcpServer()
                        mcpPanelServers = mcpPanelServers.filterNot { it.name == savedServer.name } + savedServer
                        mcpPanelSuccess = when (form.mode) {
                            ComposerMcpPanelModePreview.Http -> "HTTP MCP written: ${savedServer.name}"
                            ComposerMcpPanelModePreview.Stdio -> "Raw MCP block written: ${savedServer.name}"
                            ComposerMcpPanelModePreview.List,
                            ComposerMcpPanelModePreview.Add,
                            -> "MCP config updated: ${savedServer.name}"
                        }
                        mcpPanelMode = ComposerMcpPanelModePreview.List
                    },
                    onHooksPanelModeChange = { mode ->
                        hooksPanelMode = mode
                    },
                    onHookEdit = { form ->
                        hooksPanelForm = form
                        hooksPanelMode = ComposerHooksPanelModePreview.Edit
                        hooksPanelSuccess = null
                    },
                    onHookTrustChange = { key, nextStatus, label ->
                        hooksPanelHooks = hooksPanelHooks.map { hook ->
                            if (hook.key == key) {
                                hook.copy(trustStatus = nextStatus)
                            } else {
                                hook
                            }
                        }
                        hooksPanelSuccess = label
                    },
                    onHookSave = { form ->
                        val savedHook = form.toPreviewHook()
                        if (hooksPanelMode == ComposerHooksPanelModePreview.Edit) {
                            val targetScope = form.editingScope ?: form.scope
                            val targetEventName = form.editingEventName ?: form.eventName
                            hooksPanelHooks = hooksPanelHooks.map { hook ->
                                if (hook.source.toHookScopePreview() == targetScope && hook.eventName == targetEventName) {
                                    savedHook.copy(
                                        key = hook.key,
                                        trustStatus = hook.trustStatus,
                                        currentHash = hook.currentHash,
                                    )
                                } else {
                                    hook
                                }
                            }
                            hooksPanelSuccess = "Hook updated: ${savedHook.eventName.toHookActionLabel()}"
                        } else {
                            val existingKeys = hooksPanelHooks.map { it.key }.toSet()
                            val uniqueHook = savedHook.copy(key = savedHook.key.uniqueHookKey(existingKeys))
                            hooksPanelHooks = hooksPanelHooks + uniqueHook
                            hooksPanelSuccess = "Hook written: ${uniqueHook.eventName.toHookActionLabel()}"
                        }
                        hooksPanelMode = ComposerHooksPanelModePreview.List
                    },
                    onToolboxAction = { actionDecision ->
                        when (actionDecision.kind) {
                            ComposerToolboxActionDecisionKind.OpenPanel -> {
                                actionDecision.targetPanel?.let { targetPanel ->
                                    slashPanelView = targetPanel
                                }
                            }
                            ComposerToolboxActionDecisionKind.RunCompact -> {
                                compactBusyPreview = true
                                compactPreviewStatus = "Compact preview started"
                                if (actionDecision.closeMenu) {
                                    slashPanelView = ComposerSlashPanelViewState.Root
                                    openMenu = null
                                }
                            }
                            ComposerToolboxActionDecisionKind.ExitGoalCompose -> {
                                goalComposeMode = false
                                goalLocalError = null
                                openMenu = null
                            }
                            ComposerToolboxActionDecisionKind.EnterGoalCompose -> {
                                goalComposeMode = true
                                goalLocalError = null
                                goalPreviewStatus = null
                                slashPanelView = ComposerSlashPanelViewState.Root
                                openMenu = null
                            }
                            ComposerToolboxActionDecisionKind.ToggleFast -> {
                                val nextFastMode = actionDecision.targetFastMode ?: !fastModeSelected
                                fastModeSelected = nextFastMode
                                fastModePreviewStatus = if (nextFastMode) {
                                    "Fast mode preview on"
                                } else {
                                    "Fast mode preview off"
                                }
                            }
                            ComposerToolboxActionDecisionKind.Noop,
                            -> Unit
                        }
                    },
                )
                ComposerMenu.Attachments -> AttachmentPanel(
                    panelState = attachmentPanelState,
                    onPickAttachment = { kind ->
                        val insertion = buildAttachmentInsertionState(
                            prompt = draftPrompt.text,
                            existingAttachments = draftPrompt.attachments,
                            fileNames = listOf(kind.previewAttachmentFileName()),
                            kind = kind,
                            selection = null,
                            buildClientId = { index, actionKind, fileName ->
                                val prefix = when (actionKind) {
                                    ComposerAttachmentActionKind.Photo -> "preview-photo"
                                    ComposerAttachmentActionKind.File -> "preview-file"
                                }
                                "$prefix-${draftPrompt.attachments.size + index + 1}-${fileName.hashCode().toString().replace("-", "m")}"
                            },
                        )
                        draftPrompt = draftPrompt.copy(
                            text = insertion.prompt,
                            attachments = draftPrompt.attachments + insertion.insertedAttachments,
                        )
                        openMenu = null
                    },
                )
                ComposerMenu.Model -> ModelPickerPanel(
                    settingsState = settingsState,
                    modelOptions = modelOptions,
                    onSelectModel = { model ->
                        selectedModel = model
                        selectedReasoningEffort = composer.modelOptions
                            .firstOrNull { it.model == model }
                            ?.defaultReasoningEffort
                            ?: selectedReasoningEffort
                        openMenu = null
                    },
                )
                ComposerMenu.Effort -> EffortPickerPanel(
                    settingsState = settingsState,
                    effortOptions = reasoningEffortOptions,
                    onSelectEffort = { effort ->
                        selectedReasoningEffort = effort
                        openMenu = null
                    },
                )
                ComposerMenu.ShellTools -> ShellToolsPanel(
                    panelState = shellToolsPanelState,
                    onToolClick = { tool ->
                        shellToolPreviewStatus = tool.toShellToolPreviewStatus()
                    },
                )
                null -> Unit
            }
        }

        ComposerJumpLatestButton(state = frameState.jumpLatest)
        forkPreviewStatus?.let { status ->
            ComposerPreviewFeedback(message = status)
        }
        goalPreviewStatus?.let { status ->
            ComposerPreviewFeedback(message = status)
        }
        fastModePreviewStatus?.let { status ->
            ComposerPreviewFeedback(message = status)
        }
        compactPreviewStatus?.let { status ->
            ComposerPreviewFeedback(message = status)
        }
        shellToolPreviewStatus?.let { status ->
            ComposerPreviewFeedback(message = status)
        }
        ComposerToolbarRow(
            toolbarState = toolbarState,
            settingsToolbarState = settingsToolbarState,
            attachmentPanelState = attachmentPanelState,
            slashToolboxPanelState = slashToolboxPanelState,
            onToggleMenu = { menu ->
                val nextMenu = openMenu.toggle(menu)
                if (nextMenu != ComposerMenu.Slash) {
                    slashPanelView = ComposerSlashPanelViewState.Root
                    copiedSkillName = composer.skillsPanel.copiedSkillName
                    mcpPanelMode = composer.mcpPanel.mode
                    mcpPanelServers = composer.mcpPanel.servers
                    mcpPanelSuccess = composer.mcpPanel.configSuccess
                    hooksPanelMode = composer.hooksPanel.mode
                    hooksPanelForm = composer.hooksPanel.form
                    hooksPanelHooks = composer.hooksPanel.hooks
                    hooksPanelSuccess = composer.hooksPanel.configSuccess
                }
                openMenu = nextMenu
            },
        )
        ComposerFrameSlotsPreview(
            frameState = frameState,
            contextState = contextState,
            promptSlotState = promptSlotState,
            shellPromptInputState = shellPromptInputState,
            goalPanelState = goalPanelState,
            onCancelGoal = {
                goalComposeMode = false
                goalLocalError = null
            },
            onSubmitGoal = {
                val objective = draftPrompt.text.trim()
                if (objective.isBlank()) {
                    goalLocalError = "Goal objective cannot be empty."
                    goalPreviewStatus = null
                } else if (!composer.goalPanel.updateAvailable) {
                    goalLocalError = "/goal is unavailable in this view."
                    goalPreviewStatus = null
                } else {
                    goalLocalError = null
                    goalComposeMode = false
                    goalPreviewStatus = "Goal preview set: $objective"
                    currentGoalPreview = ThreadGoalPreview(
                        objective = objective,
                        status = ThreadGoalStatusPreview.Active,
                        tokenBudget = composer.goalPanel.tokenBudget,
                        tokensUsed = 0,
                    )
                    draftPrompt = draftPrompt.copy(text = "", attachments = emptyList())
                }
            },
            submitReady = submitInputState != null,
        )
        ComposerStatusStrip(chips = statusChips)
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (settingsToolbarState.planButton.visible) {
                ComposerModeChip(
                    label = settingsToolbarState.planButton.label,
                    selected = settingsToolbarState.planButton.selected,
                    pressed = settingsToolbarState.planPressed,
                    onClick = { planModeSelected = !planModeSelected },
                )
            }
            ComposerModeChip(label = queuedAttachmentCount.attachmentCountLabel(), selected = queuedAttachmentCount > 0)
            Box(modifier = Modifier.weight(1f))
            if (toolbarState.viewToggleButton.visible) {
                ComposerViewToggleButton(
                    icon = if (toolbarState.viewToggleButton.selected) ComposerToolIcon.Chat else ComposerToolIcon.Terminal,
                    label = if (toolbarState.viewToggleButton.selected) "Chat" else "Shell",
                )
            }
            ComposerActionControls(
                actionState = actionState,
                sendButtonState = settingsToolbarState.sendButton,
            )
        }
    }
}

@Composable
private fun ComposerJumpLatestButton(state: ComposerJumpLatestState) {
    if (!state.visible) {
        return
    }
    val foreground = if (state.active) ThreadColors.Info else ThreadColors.ForegroundSoft
    val background = if (state.active) ThreadColors.InfoSoft.copy(alpha = 0.18f) else ThreadColors.SurfaceStrong.copy(alpha = 0.74f)
    val border = if (state.active) ThreadColors.Info.copy(alpha = 0.36f) else ThreadColors.BorderStrong
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier
                .semantics {
                    contentDescription = state.accessibilityLabel
                    stateDescription = state.title
                }
                .clip(RoundedCornerShape(999.dp))
                .background(background)
                .border(1.dp, border, RoundedCornerShape(999.dp))
                .padding(horizontal = 16.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            ComposerJumpLatestGlyph(color = foreground)
        }
    }
}

@Composable
private fun ComposerToolbarRow(
    toolbarState: ComposerToolbarState,
    settingsToolbarState: ComposerSettingsToolbarState,
    attachmentPanelState: ComposerAttachmentPanelState,
    slashToolboxPanelState: ComposerSlashToolboxPanelState,
    onToggleMenu: (ComposerMenu) -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ToolbarIconButton(
            state = toolbarState.slashButton.copy(
                label = slashToolboxPanelState.triggerAccessibilityLabel,
            ),
            icon = ComposerToolIcon.Slash,
            onClick = { onToggleMenu(ComposerMenu.Slash) },
        )
        ToolbarIconButton(
            state = toolbarState.attachmentButton.copy(
                label = attachmentPanelState.triggerAccessibilityLabel,
            ),
            icon = ComposerToolIcon.Plus,
            onClick = { onToggleMenu(ComposerMenu.Attachments) },
        )
        ToolbarIconButton(
            state = toolbarState.shellToolsButton,
            icon = ComposerToolIcon.Terminal,
            onClick = { onToggleMenu(ComposerMenu.ShellTools) },
        )
        ToolbarIconButton(
            state = toolbarState.viewToggleButton,
            icon = if (toolbarState.viewToggleButton.selected) ComposerToolIcon.Chat else ComposerToolIcon.Terminal,
            onClick = {},
        )
        toolbarState.shellPromptLabel?.let { label ->
            GraphInputGroupText(
                text = label,
                modifier = Modifier.weight(1f),
            )
        } ?: Box(modifier = Modifier.weight(1f))
        ToolbarInlineToggle(
            state = settingsToolbarState.modelButton,
            onClick = { onToggleMenu(ComposerMenu.Model) },
            modifier = Modifier.weight(1.25f, fill = false),
            title = settingsToolbarState.modelTitle,
            expanded = settingsToolbarState.modelMenuExpanded,
        )
        ToolbarInlineToggle(
            state = settingsToolbarState.effortButton,
            onClick = { onToggleMenu(ComposerMenu.Effort) },
            title = settingsToolbarState.effortTitle,
            expanded = settingsToolbarState.effortMenuExpanded,
        )
    }
}

@Composable
private fun ToolbarIconButton(
    state: ComposerToolbarButtonState,
    icon: ComposerToolIcon,
    onClick: () -> Unit,
) {
    if (!state.visible) {
        return
    }
    ComposerIcon(
        icon = icon,
        selected = state.selected,
        enabled = state.enabled,
        label = state.label,
        onClick = onClick,
    )
}

@Composable
private fun ToolbarInlineToggle(
    state: ComposerToolbarButtonState,
    modifier: Modifier = Modifier,
    title: String = state.label,
    expanded: Boolean = state.selected,
    onClick: () -> Unit,
) {
    if (!state.visible) {
        return
    }
    InlineToggle(
        label = state.label,
        selected = state.selected,
        enabled = state.enabled,
        onClick = onClick,
        modifier = modifier,
        title = title,
        expanded = expanded,
    )
}

@Composable
private fun ComposerJumpLatestGlyph(color: Color) {
    Canvas(modifier = Modifier.size(14.dp)) {
        val strokeWidth = 1.5.dp.toPx()
        drawLine(
            color = color,
            start = Offset(size.width * 0.25f, size.height * 0.38f),
            end = Offset(size.width * 0.50f, size.height * 0.64f),
            strokeWidth = strokeWidth,
            cap = StrokeCap.Round,
        )
        drawLine(
            color = color,
            start = Offset(size.width * 0.75f, size.height * 0.38f),
            end = Offset(size.width * 0.50f, size.height * 0.64f),
            strokeWidth = strokeWidth,
            cap = StrokeCap.Round,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ComposerStatusStrip(chips: List<ComposerStatusChipModel>) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        chips.forEach { chip ->
            ComposerStatusChip(chip = chip)
        }
    }
}

@Composable
private fun ComposerStatusChip(chip: ComposerStatusChipModel) {
    val foreground = when (chip.tone) {
        ComposerStatusTone.Neutral -> ThreadColors.ForegroundMuted
        ComposerStatusTone.Running -> ThreadColors.Warning
        ComposerStatusTone.Success -> ThreadColors.Success
        ComposerStatusTone.Danger -> ThreadColors.Danger
        ComposerStatusTone.Warning -> ThreadColors.Warning
    }
    val background = when (chip.tone) {
        ComposerStatusTone.Neutral -> ThreadColors.SurfaceStrong
        ComposerStatusTone.Running -> ThreadColors.WarningSoft.copy(alpha = 0.58f)
        ComposerStatusTone.Success -> ThreadColors.SuccessSoft.copy(alpha = 0.56f)
        ComposerStatusTone.Danger -> ThreadColors.DangerSoft.copy(alpha = 0.58f)
        ComposerStatusTone.Warning -> ThreadColors.WarningSoft.copy(alpha = 0.58f)
    }
    val border = when (chip.tone) {
        ComposerStatusTone.Neutral -> ThreadColors.Border
        else -> foreground.copy(alpha = 0.38f)
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (chip.tone != ComposerStatusTone.Neutral) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(foreground),
            )
        }
        Text(
            text = chip.label,
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ComposerFrameSlotsPreview(
    frameState: ComposerFrameState,
    contextState: ComposerContextUsageState,
    promptSlotState: ComposerPromptSlotState,
    shellPromptInputState: ComposerShellPromptInputState?,
    goalPanelState: ComposerGoalPanelState,
    onCancelGoal: () -> Unit,
    onSubmitGoal: () -> Unit,
    submitReady: Boolean,
) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (frameState.showPromptSlot) {
            ComposerInputGroupPreview(
                contextState = contextState,
                promptSlotState = promptSlotState,
                submitReady = submitReady,
            )
        }
        if (frameState.showGoalSlot) {
            GoalComposePreviewCard(
                state = goalPanelState.composeCard,
                onCancelGoal = onCancelGoal,
                onSubmitGoal = onSubmitGoal,
            )
        }
        if (frameState.showShellPromptSlot && shellPromptInputState != null) {
            ShellPromptInputPreview(state = shellPromptInputState)
        }
        frameState.errorMessage?.let { message ->
            ComposerFrameError(message = message)
        }
    }
}

@Composable
private fun ComposerPreviewFeedback(message: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { contentDescription = message }
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.SuccessSoft.copy(alpha = 0.56f))
            .border(1.dp, ThreadColors.Success.copy(alpha = 0.34f), RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(ThreadColors.Success),
        )
        Text(
            text = message,
            modifier = Modifier.weight(1f),
            color = ThreadColors.Success,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ShellPromptInputPreview(state: ComposerShellPromptInputState) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(14.dp))
            .padding(10.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(end = 52.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = if (state.showPlaceholder) state.placeholder else state.text,
                color = if (state.showPlaceholder) ThreadColors.ForegroundMuted else ThreadColors.CodeForeground,
                style = MaterialTheme.typography.bodySmall,
                minLines = state.minLines,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "Shell input",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        ComposerShellInterruptButton(
            label = state.interruptLabel,
            enabled = state.interruptEnabled,
            modifier = Modifier.align(Alignment.TopEnd),
        )
        ComposerShellSendButton(
            label = state.sendLabel,
            enabled = state.sendEnabled,
            accessibilityLabel = state.sendAccessibilityLabel,
            modifier = Modifier.align(Alignment.BottomEnd),
        )
    }
}

@Composable
private fun ComposerShellInterruptButton(
    label: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
) {
    val foreground = if (enabled) ThreadColors.Danger else ThreadColors.ForegroundMuted.copy(alpha = 0.58f)
    val background = if (enabled) ThreadColors.DangerSoft.copy(alpha = 0.56f) else ThreadColors.Surface.copy(alpha = 0.42f)
    val border = if (enabled) ThreadColors.Danger.copy(alpha = 0.42f) else ThreadColors.Border.copy(alpha = 0.54f)
    Row(
        modifier = modifier
            .size(34.dp)
            .semantics { contentDescription = label }
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(999.dp)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(foreground),
        )
    }
}

@Composable
private fun ComposerShellSendButton(
    label: String,
    enabled: Boolean,
    accessibilityLabel: String,
    modifier: Modifier = Modifier,
) {
    val background = if (enabled) ThreadColors.Primary else ThreadColors.SurfaceStrong
    val foreground = if (enabled) ThreadColors.PrimaryForeground else ThreadColors.ForegroundMuted
    val border = if (enabled) ThreadColors.Primary else ThreadColors.Border
    Row(
        modifier = modifier
            .semantics { contentDescription = accessibilityLabel }
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(999.dp))
            .padding(horizontal = 12.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = label.ifBlank { accessibilityLabel },
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ComposerFrameError(message: String) {
    Text(
        text = message,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.DangerSoft.copy(alpha = 0.58f))
            .border(1.dp, ThreadColors.Danger.copy(alpha = 0.38f), RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 9.dp),
        color = ThreadColors.Danger,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ComposerInputGroupPreview(
    contextState: ComposerContextUsageState,
    promptSlotState: ComposerPromptSlotState,
    submitReady: Boolean,
) {
    GraphInputGroup(
        blockStart = {
            if (promptSlotState.attachmentChips.isNotEmpty()) {
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    promptSlotState.attachmentChips.forEach { attachment ->
                        AttachmentChip(attachment = attachment)
                    }
                }
            }
        },
        control = {
            ComposerPromptControl(state = promptSlotState)
            ContextProgressPreview(contextState = contextState)
        },
        blockEnd = {
            GraphInputGroupAddonRow {
                GraphInputGroupAddon(label = promptSlotState.inputModeLabel)
                GraphInputGroupAddon(label = "Markdown")
                Box(modifier = Modifier.weight(1f))
                if (promptSlotState.shellVisible) {
                    GraphInputGroupText(text = if (promptSlotState.sendDisabled) "Shell send disabled" else "Shell ready")
                } else {
                    GraphInputGroupText(text = if (submitReady) contextState.usageLabel else "Nothing to send")
                }
            }
        },
    )
}

@Composable
private fun ComposerPromptControl(state: ComposerPromptSlotState) {
    val foreground = if (state.disabled) ThreadColors.ForegroundMuted else ThreadColors.ForegroundSoft
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (state.showPlaceholder || state.promptSegments.isEmpty()) {
                Text(
                    text = if (state.showPlaceholder) state.placeholder else state.text,
                    modifier = Modifier.weight(1f),
                    color = if (state.showPlaceholder) ThreadColors.ForegroundMuted else foreground,
                    style = if (state.shellVisible) MaterialTheme.typography.bodyMedium else MaterialTheme.typography.bodyLarge,
                    maxLines = if (state.shellVisible) 3 else 4,
                    overflow = TextOverflow.Ellipsis,
                )
            } else {
                ComposerPromptSegmentsPreview(
                    segments = state.promptSegments,
                    modifier = Modifier.weight(1f),
                )
            }
            if (state.canInterrupt) {
                ComposerMiniStopButton(label = state.interruptLabel)
            }
        }
        if (state.shellVisible) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                GraphBadge(label = state.sendButtonLabel, variant = GraphBadgeVariant.Default)
                GraphBadge(
                    label = if (state.sendDisabled) "Disabled" else "Ready",
                    variant = GraphBadgeVariant.Outline,
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ComposerPromptSegmentsPreview(
    segments: List<ComposerPromptSegmentState>,
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier.semantics {
            contentDescription = "Prompt with ${segments.size} segments"
        },
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        segments.forEach { segment ->
            when (segment) {
                is ComposerPromptSegmentState.Text -> ComposerPromptTextSegment(segment.text)
                is ComposerPromptSegmentState.Attachment -> ComposerPromptAttachmentSegment(segment)
            }
        }
    }
}

@Composable
private fun ComposerPromptTextSegment(text: String) {
    Text(
        text = text,
        color = ThreadColors.ForegroundSoft,
        style = MaterialTheme.typography.bodyLarge,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun ComposerPromptAttachmentSegment(segment: ComposerPromptSegmentState.Attachment) {
    if (segment.tone == ComposerPromptAttachmentTokenTone.Photo) {
        ComposerPromptPhotoAttachmentSegment(segment = segment)
        return
    }
    ComposerPromptFileAttachmentSegment(segment = segment)
}

@Composable
private fun ComposerPromptPhotoAttachmentSegment(segment: ComposerPromptSegmentState.Attachment) {
    Row(
        modifier = Modifier
            .promptAttachmentTokenSemantics(segment)
            .clip(RoundedCornerShape(12.dp))
            .background(
                when {
                    segment.newlyInserted -> ThreadColors.Primary.copy(alpha = 0.14f)
                    else -> ThreadColors.Info.copy(alpha = 0.14f)
                },
            )
            .border(
                1.dp,
                when {
                    segment.restoresCaretAfterInsert -> ThreadColors.Primary.copy(alpha = 0.58f)
                    else -> ThreadColors.SurfaceStrong
                },
                RoundedCornerShape(12.dp),
            )
            .padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(
            modifier = Modifier
                .size(width = 78.dp, height = 56.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(ThreadColors.CodeBackground)
                .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(9.dp)),
            contentAlignment = Alignment.Center,
        ) {
            AttachmentTileGlyph(
                icon = AttachmentTileIcon.Photo,
                color = if (segment.newlyInserted) ThreadColors.Primary else ThreadColors.Info,
            )
        }
        Text(
            text = segment.attachment.label,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ComposerPromptFileAttachmentSegment(segment: ComposerPromptSegmentState.Attachment) {
    Row(
        modifier = Modifier
            .promptAttachmentTokenSemantics(segment)
            .clip(RoundedCornerShape(9.dp))
            .background(
                if (segment.newlyInserted) ThreadColors.Primary.copy(alpha = 0.14f) else ThreadColors.SurfaceStrong,
            )
            .border(
                1.dp,
                when {
                    segment.restoresCaretAfterInsert -> ThreadColors.Primary.copy(alpha = 0.58f)
                    else -> ThreadColors.BorderStrong
                },
                RoundedCornerShape(9.dp),
            )
            .padding(horizontal = 7.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        AttachmentTileGlyph(
            icon = AttachmentTileIcon.File,
            color = if (segment.newlyInserted) ThreadColors.Primary else ThreadColors.Info,
        )
        Text(
            text = segment.attachment.label,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun Modifier.promptAttachmentTokenSemantics(
    segment: ComposerPromptSegmentState.Attachment,
): Modifier {
    return semantics {
        contentDescription = segment.stateDescription
        stateDescription = if (segment.restoresCaretAfterInsert) {
            "Caret resumes after this attachment"
        } else if (segment.newlyInserted) {
            "Newly inserted attachment"
        } else {
            "Prompt attachment"
        }
    }
}

@Composable
private fun ComposerMiniStopButton(label: String) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.DangerSoft.copy(alpha = 0.58f))
            .border(1.dp, ThreadColors.Danger.copy(alpha = 0.42f), RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(ThreadColors.Danger),
        )
        Text(
            text = label,
            color = ThreadColors.Danger,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ContextProgressPreview(contextState: ComposerContextUsageState) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        GraphSlider(fraction = contextState.progressFraction, enabled = contextState.available)
        Text(
            text = contextState.remainingLabel,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun AttachmentChip(
    icon: AttachmentTileIcon,
    name: String,
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        AttachmentTileGlyph(icon = icon, color = ThreadColors.Info)
        Text(
            text = name,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun AttachmentChip(attachment: ComposerPromptAttachmentState) {
    AttachmentChip(
        icon = when (attachment.kind) {
            ComposerAttachmentActionKind.Photo -> AttachmentTileIcon.Photo
            ComposerAttachmentActionKind.File -> AttachmentTileIcon.File
        },
        name = attachment.label,
    )
}

@Composable
private fun ContextUsageRow() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Context window",
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            Text(
                text = "85.2k left",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
            )
        }
        ContextProgressPreview(
            contextState = ComposerContextUsageState(
                modelLabel = "gpt-5.4",
                usageLabel = "42.8k / 128k",
                remainingLabel = "85.2k left · 67% context left",
                progressFraction = 0.67f,
                available = true,
            ),
        )
    }
}

@Composable
private fun ValueSliderPreview(
    label: String,
    valueLabel: String,
    fraction: Float,
) {
    GraphLabeledSlider(label = label, valueLabel = valueLabel, fraction = fraction)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AttachmentPreviewStrip(
    attachments: List<ComposerPromptAttachmentState>,
    emptyMessage: String?,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "Queued attachments",
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
        if (attachments.isEmpty()) {
            Text(
                text = emptyMessage ?: "No queued attachments.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        } else {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                attachments.forEach { attachment ->
                    AttachmentChip(attachment = attachment)
                }
            }
        }
    }
}

@Composable
private fun ComposerIcon(
    icon: ComposerToolIcon,
    selected: Boolean,
    enabled: Boolean = true,
    label: String,
    onClick: () -> Unit,
) {
    val background = when {
        selected -> ThreadColors.Primary
        enabled -> ThreadColors.Panel
        else -> ThreadColors.SurfaceStrong
    }
    val foreground = when {
        selected -> ThreadColors.PrimaryForeground
        enabled -> ThreadColors.ForegroundSoft
        else -> ThreadColors.ForegroundMuted.copy(alpha = 0.58f)
    }
    Box(
        modifier = Modifier
            .size(34.dp)
            .semantics { contentDescription = label }
            .clip(CircleShape)
            .background(background)
            .border(1.dp, if (selected) ThreadColors.Primary else ThreadColors.Border, CircleShape)
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        ComposerToolGlyph(icon = icon, color = foreground)
    }
}

@Composable
private fun ComposerToolGlyph(icon: ComposerToolIcon, color: Color) {
    Canvas(modifier = Modifier.size(16.dp)) {
        val strokeWidth = 1.5.dp.toPx()
        val terminalStrokeWidth = 1.35.dp.toPx()
        val w = size.width
        val h = size.height
        fun line(
            startX: Float,
            startY: Float,
            endX: Float,
            endY: Float,
            width: Float = strokeWidth,
        ) {
            drawLine(
                color = color,
                start = Offset(w * startX, h * startY),
                end = Offset(w * endX, h * endY),
                strokeWidth = width,
                cap = StrokeCap.Round,
            )
        }

        when (icon) {
            ComposerToolIcon.Slash -> {
                line(0.67f, 0.16f, 0.33f, 0.84f)
                line(0.27f, 0.33f, 0.41f, 0.33f)
                line(0.59f, 0.67f, 0.73f, 0.67f)
            }
            ComposerToolIcon.Plus -> {
                line(0.50f, 0.20f, 0.50f, 0.80f)
                line(0.20f, 0.50f, 0.80f, 0.50f)
            }
            ComposerToolIcon.Terminal -> {
                line(0.25f, 0.31f, 0.38f, 0.44f, terminalStrokeWidth)
                line(0.38f, 0.44f, 0.25f, 0.56f, terminalStrokeWidth)
                line(0.48f, 0.59f, 0.75f, 0.59f, terminalStrokeWidth)
            }
            ComposerToolIcon.Chat -> {
                line(0.19f, 0.28f, 0.19f, 0.55f, terminalStrokeWidth)
                line(0.19f, 0.28f, 0.31f, 0.18f, terminalStrokeWidth)
                line(0.31f, 0.18f, 0.69f, 0.18f, terminalStrokeWidth)
                line(0.69f, 0.18f, 0.81f, 0.28f, terminalStrokeWidth)
                line(0.81f, 0.28f, 0.81f, 0.55f, terminalStrokeWidth)
                line(0.81f, 0.55f, 0.69f, 0.65f, terminalStrokeWidth)
                line(0.69f, 0.65f, 0.50f, 0.65f, terminalStrokeWidth)
                line(0.50f, 0.65f, 0.31f, 0.82f, terminalStrokeWidth)
                line(0.31f, 0.82f, 0.31f, 0.65f, terminalStrokeWidth)
                line(0.31f, 0.65f, 0.19f, 0.55f, terminalStrokeWidth)
            }
            ComposerToolIcon.Send -> {
                line(0.50f, 0.82f, 0.50f, 0.18f, 1.8.dp.toPx())
                line(0.25f, 0.43f, 0.50f, 0.18f, 1.8.dp.toPx())
                line(0.75f, 0.43f, 0.50f, 0.18f, 1.8.dp.toPx())
            }
        }
    }
}

@Composable
private fun ComposerActionControls(
    actionState: ComposerActionState,
    sendButtonState: ComposerSendButtonState,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        if (actionState.showInterrupt) {
            ComposerInterruptButton(label = actionState.interruptLabel)
        }
        ComposerPrimaryActionButton(sendButtonState = sendButtonState)
    }
}

@Composable
private fun ComposerInterruptButton(label: String) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.DangerSoft.copy(alpha = 0.58f))
            .border(1.dp, ThreadColors.Danger.copy(alpha = 0.42f), RoundedCornerShape(999.dp))
            .padding(horizontal = 9.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(ThreadColors.Danger),
        )
        Text(
            text = label,
            color = ThreadColors.Danger,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ComposerPrimaryActionButton(sendButtonState: ComposerSendButtonState) {
    val enabled = sendButtonState.enabled
    val isStop = sendButtonState.primaryKind == ComposerPrimaryActionKind.Stop
    val isConnecting = sendButtonState.primaryKind == ComposerPrimaryActionKind.Connecting
    val background = when {
        isStop -> ThreadColors.Danger
        isConnecting -> ThreadColors.WarningSoft
        enabled -> ThreadColors.Primary
        else -> ThreadColors.SurfaceStrong
    }
    val foreground = when {
        isStop -> ThreadColors.PrimaryForeground
        isConnecting -> ThreadColors.Warning
        enabled -> ThreadColors.PrimaryForeground
        else -> ThreadColors.ForegroundMuted
    }
    val border = when {
        isStop -> ThreadColors.Danger
        isConnecting -> ThreadColors.Warning.copy(alpha = 0.46f)
        enabled -> ThreadColors.Primary
        else -> ThreadColors.Border
    }
    val horizontalPadding = if (sendButtonState.label == "Send") 0.dp else 11.dp
    Row(
        modifier = Modifier
            .then(
                if (sendButtonState.label == "Send") {
                    Modifier.size(36.dp)
                } else {
                    Modifier
                },
            )
            .semantics {
                contentDescription = sendButtonState.accessibilityLabel
                stateDescription = sendButtonState.title
            }
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(999.dp))
            .padding(horizontal = horizontalPadding, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (sendButtonState.label == "Send") {
            Arrangement.Center
        } else {
            Arrangement.spacedBy(7.dp)
        },
    ) {
        ComposerPrimaryActionGlyph(kind = sendButtonState.primaryKind, color = foreground)
        if (sendButtonState.label != "Send") {
            Text(
                text = sendButtonState.label,
                color = foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ComposerPrimaryActionGlyph(
    kind: ComposerPrimaryActionKind,
    color: Color,
) {
    when (kind) {
        ComposerPrimaryActionKind.Stop -> Box(
            modifier = Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(color),
        )
        ComposerPrimaryActionKind.Send -> ComposerToolGlyph(icon = ComposerToolIcon.Send, color = color)
        ComposerPrimaryActionKind.Connecting -> Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(color),
        )
    }
}

@Composable
private fun ComposerViewToggleButton(
    icon: ComposerToolIcon,
    label: String,
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .padding(horizontal = 9.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        ComposerToolGlyph(icon = icon, color = ThreadColors.ForegroundSoft)
        Text(
            text = label,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun InlineToggle(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    title: String = label,
    expanded: Boolean = selected,
) {
    val background = if (selected) ThreadColors.SurfaceStrong else ThreadColors.Panel
    val foreground = if (enabled) ThreadColors.ForegroundSoft else ThreadColors.ForegroundMuted.copy(alpha = 0.62f)
    Text(
        text = label,
        modifier = modifier
            .semantics {
                contentDescription = label
                stateDescription = if (expanded) "$title expanded" else title
                this.selected = selected
            }
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 9.dp, vertical = 7.dp),
        color = foreground,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun ComposerModeChip(
    label: String,
    selected: Boolean,
    pressed: Boolean = selected,
    onClick: (() -> Unit)? = null,
) {
    val background = if (selected) ThreadColors.WarningSoft else ThreadColors.SurfaceStrong
    val foreground = if (selected) ThreadColors.Warning else ThreadColors.ForegroundMuted
    val stateLabel = if (pressed) "pressed" else "not pressed"
    Text(
        text = label,
        modifier = Modifier
            .semantics {
                contentDescription = "$label $stateLabel"
                stateDescription = if (pressed) "Pressed" else "Not pressed"
                this.selected = selected
            }
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .then(onClick?.let { Modifier.clickable(onClick = it) } ?: Modifier)
            .padding(horizontal = 10.dp, vertical = 6.dp),
        color = foreground,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun SlashToolboxPanel(
    panelState: ComposerSlashToolboxPanelState,
    menuLifecycleState: ComposerMenuLifecycleState,
    forkPanelState: ComposerForkPanelState,
    skillsPanelState: ComposerSkillsPanelState,
    mcpPanelState: ComposerMcpPanelState,
    hooksPanelState: ComposerHooksPanelState,
    onSlashPanelViewChange: (ComposerSlashPanelViewState) -> Unit,
    onCopySkill: (String) -> Unit,
    onMcpPanelModeChange: (ComposerMcpPanelModePreview) -> Unit,
    onMcpSave: (ComposerMcpFormState) -> Unit,
    onHooksPanelModeChange: (ComposerHooksPanelModePreview) -> Unit,
    onHookEdit: (ComposerHookFormPreview) -> Unit,
    onHookTrustChange: (String, ComposerHookTrustStatusPreview, String) -> Unit,
    onHookSave: (ComposerHookFormPreview) -> Unit,
    onToolboxAction: (ComposerToolboxActionDecisionState) -> Unit,
    onForkLatest: () -> Unit,
    onForkTurn: (String) -> Unit,
) {
    if (!panelState.surfaceVisible) {
        return
    }
    ComposerMenuSurface(
        title = panelState.title,
        subtitle = panelState.subtitle,
        stateDescription = composerMenuLifecycleDescription(menuLifecycleState),
    ) {
        if (panelState.showRootItems) {
            if (panelState.items.isEmpty()) {
                EmptyToolboxState(message = panelState.emptyMessage.orEmpty())
            } else {
                panelState.items.forEach { item ->
                    ToolboxRow(
                        item = item,
                        onClick = { onToolboxAction(item.actionDecision) },
                    )
                }
            }
            return@ComposerMenuSurface
        }
        when (panelState.view) {
            ComposerSlashPanelViewState.Root -> Unit
            ComposerSlashPanelViewState.Fork -> ForkPreviewGroup(
                forkPanelState = forkPanelState,
                showTurnPicker = false,
                onSlashPanelViewChange = onSlashPanelViewChange,
                onForkLatest = onForkLatest,
                onForkTurn = onForkTurn,
            )
            ComposerSlashPanelViewState.ForkTurns -> ForkPreviewGroup(
                forkPanelState = forkPanelState,
                showTurnPicker = true,
                onForkLatest = onForkLatest,
                onForkTurn = onForkTurn,
            )
            ComposerSlashPanelViewState.Skills -> SkillsPreviewGroup(
                skillsPanelState = skillsPanelState,
                onCopySkill = onCopySkill,
            )
            ComposerSlashPanelViewState.Mcp -> McpPreviewGroup(
                mcpPanelState = mcpPanelState,
                onMcpPanelModeChange = onMcpPanelModeChange,
                onMcpSave = onMcpSave,
            )
            ComposerSlashPanelViewState.Hooks -> HooksPreviewGroup(
                hooksPanelState = hooksPanelState,
                onHooksPanelModeChange = onHooksPanelModeChange,
                onHookEdit = onHookEdit,
                onHookTrustChange = onHookTrustChange,
                onHookSave = onHookSave,
            )
        }
    }
}

@Composable
private fun GoalPreviewGroup(goalPanelState: ComposerGoalPanelState) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { stateDescription = goalPanelState.lifecycle.stateDescription }
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "/goal",
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            GraphBadge(
                label = goalPanelState.statusLabel,
                variant = GraphBadgeVariant.Default,
            )
        }
        Text(
            text = goalPanelState.description,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        GoalComposePreviewCard(state = goalPanelState.composeCard)
        goalPanelState.currentGoal?.let { goal ->
            GoalStatusPreviewRow(goal = goal)
        }
        goalPanelState.notice?.let { notice ->
            HookStatusRow(
                message = notice.message,
                tone = goalNoticeTone(notice.tone),
            )
        }
    }
}

@Composable
private fun GoalComposePreviewCard(
    state: ComposerGoalComposeCardState,
    onCancelGoal: (() -> Unit)? = null,
    onSubmitGoal: (() -> Unit)? = null,
) {
    if (!state.visible) {
        return
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = state.label,
                color = ThreadColors.CodeForeground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
            GraphBadge(
                label = if (state.tokenBudgetLabel.isBlank()) {
                    "${state.tokenBudgetInputLabel}: ${state.tokenBudgetPlaceholder}"
                } else {
                    "${state.tokenBudgetInputLabel}: ${state.tokenBudgetLabel}"
                },
                variant = GraphBadgeVariant.Outline,
            )
        }
        Text(
            text = "Describe the goal the backend should continue working toward.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        state.errorMessage?.let { message ->
            HookStatusRow(message = message, tone = HookStatusTone.Error)
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (onCancelGoal != null) {
                GoalComposeActionBadge(
                    label = state.cancelLabel,
                    onClick = onCancelGoal,
                )
            } else {
                GraphBadge(label = state.cancelLabel, variant = GraphBadgeVariant.Outline)
            }
            if (onSubmitGoal != null && state.primaryEnabled) {
                GoalComposeActionBadge(
                    label = state.primaryLabel,
                    onClick = onSubmitGoal,
                    contentDescription = "Submit goal",
                    primary = true,
                )
            } else if (onSubmitGoal == null || !state.primaryEnabled) {
                GraphBadge(
                    label = state.primaryLabel,
                    variant = if (state.primaryEnabled) GraphBadgeVariant.Default else GraphBadgeVariant.Outline,
                )
            }
        }
    }
}

@Composable
private fun GoalComposeActionBadge(
    label: String,
    onClick: () -> Unit,
    contentDescription: String = label,
    primary: Boolean = false,
) {
    Text(
        text = label,
        modifier = Modifier
            .semantics { this.contentDescription = contentDescription }
            .clip(RoundedCornerShape(999.dp))
            .background(if (primary) ThreadColors.Primary else ThreadColors.SurfaceStrong)
            .border(
                1.dp,
                if (primary) ThreadColors.Primary else ThreadColors.Border,
                RoundedCornerShape(999.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 4.dp),
        color = if (primary) ThreadColors.PrimaryForeground else ThreadColors.ForegroundMuted,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GoalStatusPreviewRow(goal: ComposerCurrentGoalState) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = goal.title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            GraphBadge(label = goal.statusLabel, variant = GraphBadgeVariant.Outline)
        }
        Text(
            text = goal.objective,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            goal.tokenBudgetLabel?.let { label ->
                GraphBadge(label = label, variant = GraphBadgeVariant.Outline)
            }
            goal.tokenUsageLabel?.let { label ->
                GraphBadge(label = label, variant = GraphBadgeVariant.Outline)
            }
        }
    }
}

@Composable
private fun ForkPreviewGroup(
    forkPanelState: ComposerForkPanelState,
    showTurnPicker: Boolean,
    onSlashPanelViewChange: (ComposerSlashPanelViewState) -> Unit = {},
    onForkLatest: () -> Unit = {},
    onForkTurn: (String) -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .semantics {
                stateDescription = composerForkLifecycleDescription(forkPanelState.lifecycle)
            }
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "/fork",
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            GraphBadge(
                label = if (forkPanelState.showIdleOnlyNotice) "Idle only" else "Open",
                variant = GraphBadgeVariant.Outline,
            )
        }
        Text(
            text = forkPanelState.notice ?: "Start a new thread from the latest or selected turn.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        forkPanelState.actions.forEach { action ->
            ForkActionRow(
                action = action,
                onClick = {
                    when (action.kind) {
                        ComposerForkActionKind.Latest -> onForkLatest()
                        ComposerForkActionKind.SelectedTurn -> onSlashPanelViewChange(ComposerSlashPanelViewState.ForkTurns)
                    }
                },
            )
        }
        if (showTurnPicker) {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                forkPanelState.turnPicker.loadingMessage?.let { message ->
                    ForkTurnMessageRow(message = message, error = false)
                }
                forkPanelState.turnPicker.errorMessage?.let { message ->
                    ForkTurnMessageRow(message = message, error = true)
                }
                forkPanelState.turnPicker.rows.forEach { item ->
                    ForkTurnRow(
                        item = item,
                        onClick = { onForkTurn(item.title) },
                    )
                }
                forkPanelState.turnPicker.emptyMessage?.let { message ->
                    ForkTurnMessageRow(message = message, error = false)
                }
            }
        }
    }
}

private fun composerForkLifecycleDescription(
    state: ComposerForkLifecycleState,
): String {
    val running = if (state.forkBusy) "fork busy" else "fork idle"
    val reset = if (state.shouldClearBusyWhenLeavingForkTurns) ", clear busy after leaving turn picker" else ""
    val success = if (state.closeMenuOnSuccess) ", close on success" else ""
    val failure = if (state.closeMenuOnFailure) ", close on failure" else ", keep open on failure"
    return "$running$reset$success$failure"
}

@Composable
private fun ForkActionRow(
    action: ComposerForkActionState,
    onClick: () -> Unit,
) {
    val foreground = if (action.enabled) ThreadColors.ForegroundSoft else ThreadColors.ForegroundMuted.copy(alpha = 0.58f)
    val background = if (action.enabled) ThreadColors.SurfaceStrong else ThreadColors.Surface.copy(alpha = 0.58f)
    val border = if (action.enabled) ThreadColors.Border else ThreadColors.Border.copy(alpha = 0.62f)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(10.dp))
            .then(if (action.enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = action.label,
            modifier = Modifier.weight(1f),
            color = foreground,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = action.status,
            color = if (action.enabled) ThreadColors.ForegroundMuted else ThreadColors.ForegroundMuted.copy(alpha = 0.58f),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

@Composable
private fun ForkTurnRow(
    item: ComposerForkTurnPickerRowState,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .then(if (item.enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = item.title,
            modifier = Modifier.weight(1f),
            color = if (item.enabled) ThreadColors.CodeForeground else ThreadColors.ForegroundMuted.copy(alpha = 0.58f),
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        GraphBadge(
            label = item.status,
            variant = GraphBadgeVariant.Outline,
        )
    }
}

@Composable
private fun ForkTurnMessageRow(
    message: String,
    error: Boolean,
) {
    val foreground = if (error) ThreadColors.Danger else ThreadColors.ForegroundMuted
    val background = if (error) ThreadColors.DangerSoft.copy(alpha = 0.56f) else ThreadColors.CodeBackground
    val border = if (error) ThreadColors.Danger.copy(alpha = 0.34f) else ThreadColors.BorderStrong
    Text(
        text = message,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        color = foreground,
        style = MaterialTheme.typography.labelSmall,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun SkillsPreviewGroup(
    skillsPanelState: ComposerSkillsPanelState,
    onCopySkill: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "/skills",
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            GraphBadge(
                label = "Open",
                variant = GraphBadgeVariant.Outline,
            )
        }
        Text(
            text = "Inspect skills and copy invocation names.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        skillsPanelState.loadingMessage?.let { message ->
            SkillPanelMessageRow(message = message)
        }
        skillsPanelState.errorMessage?.let { message ->
            SkillWarningRow(
                message = message,
                path = "",
                error = true,
            )
        }
        skillsPanelState.skills.forEach { item ->
            SkillPreviewRow(
                item = item,
                onCopySkill = onCopySkill,
            )
        }
        skillsPanelState.errors.forEach { error ->
            SkillWarningRow(
                message = error.message,
                path = error.path,
            )
        }
        skillsPanelState.emptyMessage?.let { message ->
            SkillPanelMessageRow(message = message)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SkillPreviewRow(
    item: ComposerSkillRowState,
    onCopySkill: (String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = "Skill ${item.displayName}"
                stateDescription = skillCopyStateDescription(item)
            }
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Text(
            text = item.displayName,
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            GraphBadge(
                label = item.scopeLabel,
                variant = GraphBadgeVariant.Outline,
            )
            ComposerPanelActionBadge(
                label = item.copyLabel,
                accessibilityLabel = item.copyAccessibilityLabel,
                onClick = { onCopySkill(item.invokeName.removePrefix("\$")) },
            )
        }
        Text(
            text = item.description,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun skillCopyStateDescription(item: ComposerSkillRowState): String {
    return if (item.copied) {
        "${item.copyTitle}, copied"
    } else {
        item.copyTitle
    }
}

@Composable
private fun SkillPanelMessageRow(message: String) {
    Text(
        text = message,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        color = ThreadColors.ForegroundMuted,
        style = MaterialTheme.typography.labelSmall,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun SkillWarningRow(
    message: String,
    path: String,
    error: Boolean = false,
) {
    val foreground = if (error) ThreadColors.Danger else ThreadColors.Warning
    val background = if (error) ThreadColors.DangerSoft.copy(alpha = 0.56f) else ThreadColors.WarningSoft.copy(alpha = 0.52f)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .border(1.dp, foreground.copy(alpha = 0.34f), RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = message,
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (path.isNotBlank()) {
            Text(
                text = path,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun McpPreviewGroup(
    mcpPanelState: ComposerMcpPanelState,
    onMcpPanelModeChange: (ComposerMcpPanelModePreview) -> Unit,
    onMcpSave: (ComposerMcpFormState) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { stateDescription = mcpPanelState.lifecycle.stateDescription }
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = "/mcp",
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "${mcpPanelState.configSourceTitle} · ${mcpPanelState.configSourceLabel}",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (mcpPanelState.showAddAction) {
                ComposerPanelActionBadge(
                    label = "Add MCP",
                    onClick = { onMcpPanelModeChange(ComposerMcpPanelModePreview.Add) },
                )
            }
        }
        mcpPanelState.statusMessages.forEach { message ->
            McpStatusMessageRow(message = message)
        }
        mcpPanelState.addOptions.forEach { option ->
            McpAddOptionRow(
                option = option,
                onClick = { onMcpPanelModeChange(option.targetMode) },
            )
        }
        mcpPanelState.form?.let { form ->
            McpFormPreview(
                form = form,
                onBack = { onMcpPanelModeChange(form.backTargetMode) },
                onSave = { onMcpSave(form) },
            )
        }
        mcpPanelState.servers.forEach { item ->
            McpServerRow(item = item)
        }
        mcpPanelState.emptyMessage?.let { message ->
            McpPanelMessageRow(message = message)
        }
    }
}

@Composable
private fun McpStatusMessageRow(message: ComposerMcpStatusMessageState) {
    val foreground = when (message.tone) {
        ComposerMcpStatusTone.Neutral -> ThreadColors.ForegroundMuted
        ComposerMcpStatusTone.Error -> ThreadColors.Danger
        ComposerMcpStatusTone.Success -> ThreadColors.Success
    }
    val background = when (message.tone) {
        ComposerMcpStatusTone.Neutral -> ThreadColors.CodeBackground
        ComposerMcpStatusTone.Error -> ThreadColors.DangerSoft.copy(alpha = 0.56f)
        ComposerMcpStatusTone.Success -> ThreadColors.SuccessSoft.copy(alpha = 0.54f)
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .border(1.dp, foreground.copy(alpha = 0.34f), RoundedCornerShape(10.dp))
            .padding(10.dp),
    ) {
        Text(
            text = message.message,
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = if (message.tone == ComposerMcpStatusTone.Neutral) FontWeight.Normal else FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun McpPanelMessageRow(message: String) {
    Text(
        text = message,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        color = ThreadColors.ForegroundMuted,
        style = MaterialTheme.typography.labelSmall,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun ComposerPanelActionBadge(
    label: String,
    accessibilityLabel: String = label,
    onClick: () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .semantics {
                contentDescription = accessibilityLabel
                role = Role.Button
            },
        shape = RoundedCornerShape(999.dp),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = ThreadColors.SurfaceStrong,
            contentColor = ThreadColors.ForegroundSoft,
        ),
        border = androidx.compose.foundation.BorderStroke(1.dp, ThreadColors.Border),
        contentPadding = PaddingValues(horizontal = 9.dp, vertical = 6.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun McpAddOptionRow(
    option: ComposerMcpAddOptionState,
    onClick: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick)
            .semantics {
                contentDescription = option.title
                role = Role.Button
            }
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = option.title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = option.modeLabel,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
        }
        Text(
            text = option.description,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun McpFormPreview(
    form: ComposerMcpFormState,
    onBack: () -> Unit,
    onSave: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = form.title,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        form.fields.forEach { (label, value) ->
            HookFieldPreview(
                label = label,
                value = value.ifBlank { "Not set" },
                mono = true,
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ComposerPanelActionBadge(label = "Back", onClick = onBack)
            if (form.primaryEnabled) {
                ComposerPanelActionBadge(label = form.primaryLabel, onClick = onSave)
            } else {
                GraphBadge(label = form.primaryLabel, variant = GraphBadgeVariant.Outline)
            }
        }
    }
}

@Composable
private fun McpServerRow(item: ComposerMcpServerRowState) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = item.name,
                    color = ThreadColors.CodeForeground,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = item.countsLabel,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            GraphBadge(
                label = item.authLabel,
                variant = GraphBadgeVariant.Outline,
            )
        }
        item.toolPreview?.let { preview ->
            Text(
                text = preview,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HooksPreviewGroup(
    hooksPanelState: ComposerHooksPanelState,
    onHooksPanelModeChange: (ComposerHooksPanelModePreview) -> Unit,
    onHookEdit: (ComposerHookFormPreview) -> Unit,
    onHookTrustChange: (String, ComposerHookTrustStatusPreview, String) -> Unit,
    onHookSave: (ComposerHookFormPreview) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .semantics { stateDescription = hooksPanelState.lifecycle.stateDescription }
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = "/hooks",
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "${hooksPanelState.configSourceTitle} · ${hooksPanelState.configSourceLabel}",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (hooksPanelState.showAddAction) {
                ComposerPanelActionBadge(
                    label = "Add Hook",
                    onClick = { onHooksPanelModeChange(ComposerHooksPanelModePreview.Add) },
                )
            }
        }
        hooksPanelState.statusMessages.forEach { message ->
            HookPanelStatusRow(message = message)
        }
        hooksPanelState.form?.let { form ->
            HookFormPreview(
                form = form,
                onBack = { onHooksPanelModeChange(form.backTargetMode) },
                onSave = { onHookSave(form.form) },
            )
        }
        hooksPanelState.hooks.forEach { item ->
            HookPreviewRow(
                item = item,
                onEdit = onHookEdit,
                onTrustChange = onHookTrustChange,
            )
        }
        hooksPanelState.emptyMessage?.let { message ->
            HookPanelMessageRow(message = message)
        }
    }
}

@Composable
private fun HookPanelStatusRow(message: ComposerHookStatusMessageState) {
    HookStatusRow(
        message = if (message.path.isNullOrBlank()) message.message else "${message.message} · ${message.path}",
        tone = goalNoticeTone(message.tone),
    )
}

private fun goalNoticeTone(tone: ComposerMcpStatusTone): HookStatusTone {
    return when (tone) {
        ComposerMcpStatusTone.Error -> HookStatusTone.Error
        ComposerMcpStatusTone.Success -> HookStatusTone.Success
        ComposerMcpStatusTone.Neutral -> HookStatusTone.Warning
    }
}

@Composable
private fun HookPanelMessageRow(message: String) {
    Text(
        text = message,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        color = ThreadColors.ForegroundMuted,
        style = MaterialTheme.typography.labelSmall,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun HookFormPreview(
    form: ComposerHookFormState,
    onBack: () -> Unit,
    onSave: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        form.editingLabel?.let { label ->
            HookFieldPreview(label = "Editing", value = label)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            form.fields.take(2).forEach { (label, value) ->
                HookFieldPreview(label = label, value = value, modifier = Modifier.weight(1f))
            }
        }
        form.fields.drop(2).take(2).forEach { (label, value) ->
            HookFieldPreview(label = label, value = value, mono = label == "Command")
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            form.fields.drop(4).forEach { (label, value) ->
                HookFieldPreview(label = label, value = value, modifier = Modifier.weight(1f))
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ComposerPanelActionBadge(label = "Back", onClick = onBack)
            if (form.primaryEnabled) {
                ComposerPanelActionBadge(label = form.primaryLabel, onClick = onSave)
            } else {
                GraphBadge(label = form.primaryLabel, variant = GraphBadgeVariant.Outline)
            }
        }
    }
}

@Composable
private fun HookFieldPreview(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    mono: Boolean = false,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(9.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(9.dp))
            .padding(horizontal = 9.dp, vertical = 7.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            text = label,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = value,
            color = ThreadColors.CodeForeground,
            style = if (mono) MaterialTheme.typography.labelSmall else MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HookPreviewRow(
    item: ComposerHookRowState,
    onEdit: (ComposerHookFormPreview) -> Unit,
    onTrustChange: (String, ComposerHookTrustStatusPreview, String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Text(
            text = item.title,
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = item.commandLabel,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        item.statusMessage?.let { statusMessage ->
            Text(
                text = statusMessage,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item.editAction?.let { action ->
                item.editForm?.let { form ->
                    ComposerPanelActionBadge(
                        label = action.label,
                        accessibilityLabel = "${action.label} ${item.title}",
                        onClick = { onEdit(form) },
                    )
                }
            }
            item.trustAction?.let { action ->
                if (action.enabled) {
                    ComposerPanelActionBadge(
                        label = action.label,
                        accessibilityLabel = "${action.label} ${item.title}",
                        onClick = {
                            when (action.kind) {
                                ComposerHookActionKind.Trust -> onTrustChange(
                                    item.key,
                                    ComposerHookTrustStatusPreview.Trusted,
                                    "Hook trusted: ${item.title}",
                                )
                                ComposerHookActionKind.Untrust -> onTrustChange(
                                    item.key,
                                    ComposerHookTrustStatusPreview.Untrusted,
                                    "Hook marked for review: ${item.title}",
                                )
                                ComposerHookActionKind.Edit -> Unit
                            }
                        },
                    )
                } else {
                    GraphBadge(label = action.label, variant = GraphBadgeVariant.Outline)
                }
            }
            GraphBadge(label = item.trustLabel, variant = GraphBadgeVariant.Outline)
            GraphBadge(label = item.sourceLabel, variant = GraphBadgeVariant.Outline)
            GraphBadge(label = item.enabledLabel, variant = GraphBadgeVariant.Outline)
            GraphBadge(label = item.timeoutLabel, variant = GraphBadgeVariant.Outline)
        }
    }
}

@Composable
private fun HookStatusRow(
    message: String,
    tone: HookStatusTone,
) {
    val foreground = when (tone) {
        HookStatusTone.Warning -> ThreadColors.Warning
        HookStatusTone.Error -> ThreadColors.Danger
        HookStatusTone.Success -> ThreadColors.Success
    }
    val background = when (tone) {
        HookStatusTone.Warning -> ThreadColors.WarningSoft.copy(alpha = 0.52f)
        HookStatusTone.Error -> ThreadColors.DangerSoft.copy(alpha = 0.56f)
        HookStatusTone.Success -> ThreadColors.SuccessSoft.copy(alpha = 0.54f)
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .border(1.dp, foreground.copy(alpha = 0.34f), RoundedCornerShape(10.dp))
            .padding(10.dp),
    ) {
        Text(
            text = message,
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun AttachmentPanel(
    panelState: ComposerAttachmentPanelState,
    onPickAttachment: (ComposerAttachmentActionKind) -> Unit,
) {
    ComposerMenuSurface(
        title = panelState.triggerLabel,
        subtitle = "${panelState.actionCountLabel} · ${panelState.queuedCountLabel}",
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            panelState.actions.forEach { action ->
                AttachmentButton(
                    action = action,
                    modifier = Modifier.weight(1f),
                    onClick = { onPickAttachment(action.kind) },
                )
            }
        }
        AttachmentPreviewStrip(
            attachments = panelState.queuedAttachments,
            emptyMessage = panelState.emptyMessage,
        )
    }
}

@Composable
private fun ModelPickerPanel(
    settingsState: ComposerSettingsState,
    modelOptions: List<ComposerSelectionOptionState>,
    onSelectModel: (String) -> Unit,
) {
    ComposerMenuSurface(title = "Model", subtitle = "Runtime preference") {
        ContextUsageRow()
        settingsState.modelDisabledReason?.let { reason ->
            ComposerMenuNotice(text = reason)
        }
        if (modelOptions.isEmpty()) {
            ComposerEmptyMenuRow(text = "Model choices will appear here once the thread reports available runtimes.")
        } else {
            modelOptions.forEach { option ->
                SelectionRow(
                    label = option.label,
                    detail = option.detail,
                    selected = option.selected,
                    onClick = { onSelectModel(option.value) },
                )
            }
        }
    }
}

@Composable
private fun EffortPickerPanel(
    settingsState: ComposerSettingsState,
    effortOptions: List<ComposerSelectionOptionState>,
    onSelectEffort: (String) -> Unit,
) {
    ComposerMenuSurface(title = "Reasoning effort", subtitle = "Per-thread setting") {
        ValueSliderPreview(
            label = "Effort budget",
            valueLabel = settingsState.effortLabel,
            fraction = if (settingsState.effortEnabled) 0.58f else 0f,
        )
        Text(
            text = settingsState.effortTitle,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        effortOptions.forEach { option ->
            SelectionRow(
                label = option.label,
                detail = option.detail,
                selected = option.selected,
                onClick = { onSelectEffort(option.value) },
            )
        }
    }
}

@Composable
private fun ComposerMenuNotice(text: String) {
    Text(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.WarningSoft.copy(alpha = 0.42f))
            .border(1.dp, ThreadColors.Warning.copy(alpha = 0.24f), RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        color = ThreadColors.Warning,
        style = MaterialTheme.typography.labelSmall,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun ComposerEmptyMenuRow(text: String) {
    Text(
        text = text,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.Surface.copy(alpha = 0.42f))
            .border(1.dp, ThreadColors.Border.copy(alpha = 0.72f), RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        color = ThreadColors.ForegroundMuted,
        style = MaterialTheme.typography.labelSmall,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ShellToolsPanel(
    panelState: ComposerShellToolsPanelState,
    onToolClick: (ComposerShellToolState) -> Unit,
) {
    ComposerMenuSurface(title = panelState.title, subtitle = panelState.subtitle) {
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            maxItemsInEachRow = panelState.columnCount,
        ) {
            panelState.tools.forEach { item ->
                ShellToolPill(
                    item = item,
                    modifier = Modifier.weight(1f),
                    onClick = { onToolClick(item) },
                )
            }
        }
    }
}

@Composable
private fun ComposerMenuSurface(
    title: String,
    subtitle: String,
    stateDescription: String? = null,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(
                stateDescription?.let { description ->
                    Modifier.semantics { this.stateDescription = description }
                } ?: Modifier,
            )
            .clip(RoundedCornerShape(16.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(16.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    color = ThreadColors.CodeForeground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = subtitle,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(ThreadColors.Info),
            )
        }
        content()
    }
}

@Composable
private fun EmptyToolboxState(message: String) {
    Text(
        text = message,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        color = ThreadColors.ForegroundMuted,
        style = MaterialTheme.typography.labelSmall,
    )
}

@Composable
private fun ToolboxRow(
    item: ComposerToolboxItemState,
    onClick: () -> Unit,
) {
    val foreground = when (item.tone) {
        ComposerToolboxItemTone.Active -> ThreadColors.Warning
        ComposerToolboxItemTone.Disabled -> ThreadColors.ForegroundMuted.copy(alpha = 0.58f)
        ComposerToolboxItemTone.Neutral -> ThreadColors.Foreground
    }
    val background = when (item.tone) {
        ComposerToolboxItemTone.Active -> ThreadColors.WarningSoft.copy(alpha = 0.52f)
        ComposerToolboxItemTone.Disabled -> ThreadColors.Surface.copy(alpha = 0.58f)
        ComposerToolboxItemTone.Neutral -> ThreadColors.Surface
    }
    val border = when (item.tone) {
        ComposerToolboxItemTone.Active -> ThreadColors.Warning.copy(alpha = 0.34f)
        ComposerToolboxItemTone.Disabled -> ThreadColors.Border.copy(alpha = 0.62f)
        ComposerToolboxItemTone.Neutral -> ThreadColors.Border
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .semantics {
                contentDescription = item.label
                stateDescription = toolboxActionDecisionDescription(item.actionDecision)
            }
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(12.dp))
            .then(if (item.enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = item.command,
                modifier = Modifier.weight(1f),
                color = foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            GraphBadge(
                label = item.status,
                variant = GraphBadgeVariant.Outline,
            )
        }
        Text(
            text = item.description,
            color = if (item.enabled) ThreadColors.ForegroundMuted else ThreadColors.ForegroundMuted.copy(alpha = 0.58f),
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private fun toolboxActionDecisionDescription(
    decision: ComposerToolboxActionDecisionState,
): String {
    return when (decision.kind) {
        ComposerToolboxActionDecisionKind.ToggleFast -> {
            if (decision.targetFastMode == true) "Turn fast mode on" else "Turn fast mode off"
        }
        ComposerToolboxActionDecisionKind.RunCompact -> "Run compact"
        ComposerToolboxActionDecisionKind.EnterGoalCompose -> "Enter goal compose"
        ComposerToolboxActionDecisionKind.ExitGoalCompose -> "Exit goal compose"
        ComposerToolboxActionDecisionKind.OpenPanel -> "Open ${toolboxPanelLabel(decision)} panel"
        ComposerToolboxActionDecisionKind.Noop -> "No action"
    }
}

private fun toolboxPanelLabel(decision: ComposerToolboxActionDecisionState): String {
    return when (decision.targetPanel) {
        ComposerSlashPanelViewState.Fork -> "fork"
        ComposerSlashPanelViewState.ForkTurns -> "fork turns"
        ComposerSlashPanelViewState.Skills -> "skills"
        ComposerSlashPanelViewState.Mcp -> "MCP"
        ComposerSlashPanelViewState.Hooks -> "hooks"
        ComposerSlashPanelViewState.Root,
        null,
        -> "panel"
    }
}

private fun composerMenuLifecycleDescription(
    state: ComposerMenuLifecycleState,
): String {
    val actions = buildList {
        if (state.shouldResetSlashPanelView) {
            add("reset slash panel")
        }
        if (state.shouldResetMcpPanelMode) {
            add("reset MCP panel")
        }
        if (state.shouldClearMcpConfigStatus) {
            add("clear MCP status")
        }
        if (state.shouldClearHookConfigStatus) {
            add("clear hook status")
        }
    }
    return if (actions.isEmpty()) "menu state retained" else actions.joinToString(", ")
}

@Composable
private fun AttachmentButton(
    action: ComposerAttachmentActionState,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val icon = when (action.kind) {
        ComposerAttachmentActionKind.Photo -> AttachmentTileIcon.Photo
        ComposerAttachmentActionKind.File -> AttachmentTileIcon.File
    }
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(
            modifier = Modifier
                .size(30.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(ThreadColors.SurfaceStrong)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(9.dp)),
            contentAlignment = Alignment.Center,
        ) {
            AttachmentTileGlyph(icon = icon, color = ThreadColors.Info)
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = action.label,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = action.detail,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun AttachmentTileGlyph(icon: AttachmentTileIcon, color: Color) {
    Canvas(modifier = Modifier.size(15.dp)) {
        val strokeWidth = 1.35.dp.toPx()
        val w = size.width
        val h = size.height
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
            drawLine(
                color = color,
                start = Offset(w * x1, h * y1),
                end = Offset(w * x2, h * y2),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round,
            )
        }

        when (icon) {
            AttachmentTileIcon.Photo -> {
                line(0.18f, 0.26f, 0.82f, 0.26f)
                line(0.82f, 0.26f, 0.82f, 0.78f)
                line(0.82f, 0.78f, 0.18f, 0.78f)
                line(0.18f, 0.78f, 0.18f, 0.26f)
                drawCircle(
                    color = color,
                    radius = w * 0.07f,
                    center = Offset(w * 0.66f, h * 0.40f),
                )
                line(0.25f, 0.70f, 0.42f, 0.52f)
                line(0.42f, 0.52f, 0.55f, 0.66f)
                line(0.55f, 0.66f, 0.66f, 0.56f)
                line(0.66f, 0.56f, 0.76f, 0.70f)
            }
            AttachmentTileIcon.File -> {
                line(0.28f, 0.18f, 0.62f, 0.18f)
                line(0.62f, 0.18f, 0.76f, 0.34f)
                line(0.76f, 0.34f, 0.76f, 0.82f)
                line(0.76f, 0.82f, 0.28f, 0.82f)
                line(0.28f, 0.82f, 0.28f, 0.18f)
                line(0.62f, 0.18f, 0.62f, 0.34f)
                line(0.62f, 0.34f, 0.76f, 0.34f)
                line(0.38f, 0.50f, 0.66f, 0.50f)
                line(0.38f, 0.64f, 0.62f, 0.64f)
            }
        }
    }
}

@Composable
private fun SelectionRow(
    label: String,
    detail: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) ThreadColors.WarningSoft else ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        GraphSelectionGlyph(
            selected = selected,
            tone = GraphSelectionTone.Warning,
            contentDescription = if (selected) "$label selected" else "$label available",
        )
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            color = if (selected) ThreadColors.Warning else ThreadColors.Foreground,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = detail,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun ShellToolPill(
    item: ComposerShellToolState,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val foreground = when (item.tone) {
        ComposerShellToolTone.Neutral -> ThreadColors.ForegroundSoft
        ComposerShellToolTone.Info -> ThreadColors.Info
        ComposerShellToolTone.Danger -> ThreadColors.Danger
    }
    val background = when (item.tone) {
        ComposerShellToolTone.Neutral -> ThreadColors.Surface
        ComposerShellToolTone.Info -> ThreadColors.InfoSoft.copy(alpha = 0.50f)
        ComposerShellToolTone.Danger -> ThreadColors.DangerSoft.copy(alpha = 0.52f)
    }
    val border = when (item.tone) {
        ComposerShellToolTone.Neutral -> ThreadColors.Border
        ComposerShellToolTone.Info -> ThreadColors.Info.copy(alpha = 0.36f)
        ComposerShellToolTone.Danger -> ThreadColors.Danger.copy(alpha = 0.40f)
    }
    Text(
        text = item.label,
        modifier = modifier
            .semantics {
                contentDescription = item.label
                stateDescription = if (item.enabled) "Available" else "Disabled"
            }
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(999.dp))
            .then(if (item.enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = if (item.enabled) foreground else ThreadColors.ForegroundMuted.copy(alpha = 0.56f),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
    )
}

private fun ComposerMenu?.toggle(target: ComposerMenu): ComposerMenu? {
    return if (this == target) null else target
}

private fun ComposerShellToolState.toShellToolPreviewStatus(): String {
    return when (kind) {
        ComposerShellToolKind.Paste -> "Shell paste preview"
        ComposerShellToolKind.Copy -> "Shell output copied"
        ComposerShellToolKind.Clear -> "Shell clear preview"
        ComposerShellToolKind.CtrlC -> "Sent Ctrl-C preview"
        ComposerShellToolKind.CtrlD -> "Sent Ctrl-D preview"
        ComposerShellToolKind.Esc -> "Sent ESC preview"
        ComposerShellToolKind.Tab -> "Sent TAB preview"
        ComposerShellToolKind.Up -> "Sent UP preview"
        ComposerShellToolKind.Down -> "Sent DOWN preview"
    }
}

private fun ComposerMenu?.toToolbarMenuState(): ComposerToolbarMenuState? {
    return when (this) {
        ComposerMenu.Slash -> ComposerToolbarMenuState.Slash
        ComposerMenu.Attachments -> ComposerToolbarMenuState.Attachments
        ComposerMenu.Model -> ComposerToolbarMenuState.Model
        ComposerMenu.Effort -> ComposerToolbarMenuState.Effort
        ComposerMenu.ShellTools -> ComposerToolbarMenuState.ShellTools
        null -> null
    }
}

private fun ComposerSlashPanelViewPreview.toPanelViewState(): ComposerSlashPanelViewState {
    return when (this) {
        ComposerSlashPanelViewPreview.Root -> ComposerSlashPanelViewState.Root
        ComposerSlashPanelViewPreview.Skills -> ComposerSlashPanelViewState.Skills
        ComposerSlashPanelViewPreview.Mcp -> ComposerSlashPanelViewState.Mcp
        ComposerSlashPanelViewPreview.Hooks -> ComposerSlashPanelViewState.Hooks
        ComposerSlashPanelViewPreview.Fork -> ComposerSlashPanelViewState.Fork
        ComposerSlashPanelViewPreview.ForkTurns -> ComposerSlashPanelViewState.ForkTurns
    }
}

private fun ComposerSlashPanelViewState.toPreviewPanelView(): ComposerSlashPanelViewPreview {
    return when (this) {
        ComposerSlashPanelViewState.Root -> ComposerSlashPanelViewPreview.Root
        ComposerSlashPanelViewState.Skills -> ComposerSlashPanelViewPreview.Skills
        ComposerSlashPanelViewState.Mcp -> ComposerSlashPanelViewPreview.Mcp
        ComposerSlashPanelViewState.Hooks -> ComposerSlashPanelViewPreview.Hooks
        ComposerSlashPanelViewState.Fork -> ComposerSlashPanelViewPreview.Fork
        ComposerSlashPanelViewState.ForkTurns -> ComposerSlashPanelViewPreview.ForkTurns
    }
}

private fun ComposerHookFormPreview.toPreviewHook(): ComposerHookPreview {
    return ComposerHookPreview(
        key = "preview-${scope.name.lowercase()}-${eventName.name.lowercase()}-${matcher.ifBlank { "any" }.lowercase()}",
        eventName = eventName,
        handlerType = ComposerHookHandlerTypePreview.Command,
        matcher = matcher.ifBlank { null },
        command = command,
        timeoutSec = timeoutSec.toIntOrNull() ?: 30,
        statusMessage = statusMessage.ifBlank { null },
        source = when (scope) {
            ComposerHookScopePreview.Global -> ComposerHookSourcePreview.User
            ComposerHookScopePreview.Project -> ComposerHookSourcePreview.Project
        },
        enabled = true,
        isManaged = false,
        currentHash = "preview-hash-${eventName.name.lowercase()}",
        trustStatus = ComposerHookTrustStatusPreview.Modified,
    )
}

private fun ComposerMcpFormState.toPreviewMcpServer(): ComposerMcpServerPreview {
    val serverName = when (mode) {
        ComposerMcpPanelModePreview.Http -> httpName?.takeIf { it.isNotBlank() } ?: "http-preview"
        ComposerMcpPanelModePreview.Stdio -> rawBlock?.extractMcpServerName() ?: "raw-preview"
        ComposerMcpPanelModePreview.List,
        ComposerMcpPanelModePreview.Add,
        -> "preview"
    }
    return ComposerMcpServerPreview(
        name = serverName,
        authStatus = ComposerMcpAuthStatusPreview.Unsupported,
        tools = listOf(
            ComposerMcpToolPreview(
                name = "${serverName.replace('-', '_')}_preview_tool",
                title = "Preview tool",
            ),
        ),
        resourceCount = if (mode == ComposerMcpPanelModePreview.Stdio) 1 else 0,
        resourceTemplateCount = 0,
    )
}

private fun String.extractMcpServerName(): String? {
    val match = Regex("""\[mcp_servers\.([A-Za-z0-9_-]+)]""").find(this)
    return match?.groupValues?.getOrNull(1)?.takeIf { it.isNotBlank() }
}

private fun ComposerHookSourcePreview.toHookScopePreview(): ComposerHookScopePreview {
    return when (this) {
        ComposerHookSourcePreview.User -> ComposerHookScopePreview.Global
        else -> ComposerHookScopePreview.Project
    }
}

private fun String.uniqueHookKey(existingKeys: Set<String>): String {
    if (this !in existingKeys) {
        return this
    }
    var index = 2
    while ("$this-$index" in existingKeys) {
        index += 1
    }
    return "$this-$index"
}

private fun ComposerHookEventNamePreview.toHookActionLabel(): String {
    return when (this) {
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

private enum class ComposerMenu {
    Slash,
    Attachments,
    Model,
    Effort,
    ShellTools,
}

private enum class HookStatusTone {
    Warning,
    Error,
    Success,
}

private enum class AttachmentTileIcon {
    Photo,
    File,
}

private fun Int.attachmentCountLabel(): String {
    return when (this) {
        0 -> "No files"
        1 -> "1 file"
        else -> "$this files"
    }
}

private fun ComposerAttachmentActionKind.previewAttachmentFileName(): String {
    return when (this) {
        ComposerAttachmentActionKind.Photo -> "android-preview.png"
        ComposerAttachmentActionKind.File -> "android-client-notes.txt"
    }
}

private enum class ComposerToolIcon {
    Slash,
    Plus,
    Terminal,
    Chat,
    Send,
}
