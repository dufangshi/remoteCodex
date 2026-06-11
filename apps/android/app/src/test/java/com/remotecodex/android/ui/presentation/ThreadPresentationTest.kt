package com.remotecodex.android.ui.presentation

import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.MessageAuthor
import com.remotecodex.android.ui.model.PlanStepStatus
import com.remotecodex.android.ui.model.ComposerActiveView
import com.remotecodex.android.ui.model.ComposerContextAvailability
import com.remotecodex.android.ui.model.ComposerContextPreview
import com.remotecodex.android.ui.model.ComposerForkTurnOptionPreview
import com.remotecodex.android.ui.model.ComposerForkTurnOptionsPreview
import com.remotecodex.android.ui.model.ComposerGoalPanelPreview
import com.remotecodex.android.ui.model.ComposerHookErrorPreview
import com.remotecodex.android.ui.model.ComposerHookEventNamePreview
import com.remotecodex.android.ui.model.ComposerHookFormPreview
import com.remotecodex.android.ui.model.ComposerHookHandlerTypePreview
import com.remotecodex.android.ui.model.ComposerHookPreview
import com.remotecodex.android.ui.model.ComposerHookScopePreview
import com.remotecodex.android.ui.model.ComposerHookSourcePreview
import com.remotecodex.android.ui.model.ComposerHookTrustStatusPreview
import com.remotecodex.android.ui.model.ComposerHooksPanelModePreview
import com.remotecodex.android.ui.model.ComposerHooksPanelPreview
import com.remotecodex.android.ui.model.ComposerMcpAuthStatusPreview
import com.remotecodex.android.ui.model.ComposerMcpPanelModePreview
import com.remotecodex.android.ui.model.ComposerMcpPanelPreview
import com.remotecodex.android.ui.model.ComposerMcpServerPreview
import com.remotecodex.android.ui.model.ComposerMcpToolPreview
import com.remotecodex.android.ui.model.ComposerModelOptionPreview
import com.remotecodex.android.ui.model.ComposerPanelLoadStatusPreview
import com.remotecodex.android.ui.model.ComposerPromptAttachmentPreview
import com.remotecodex.android.ui.model.ComposerPromptPreview
import com.remotecodex.android.ui.model.ComposerReasoningEffortOptionPreview
import com.remotecodex.android.ui.model.ComposerShellControlPreview
import com.remotecodex.android.ui.model.ComposerSkillErrorPreview
import com.remotecodex.android.ui.model.ComposerSkillPreview
import com.remotecodex.android.ui.model.ComposerSkillScopePreview
import com.remotecodex.android.ui.model.ComposerSkillsPanelPreview
import com.remotecodex.android.ui.model.ComposerSlashPanelViewPreview
import com.remotecodex.android.ui.model.ComposerToolboxActionPreview
import com.remotecodex.android.ui.model.ComposerToolboxItemPreview
import com.remotecodex.android.ui.model.ComposerAttachmentKindPreview
import com.remotecodex.android.ui.model.ReasoningPreview
import com.remotecodex.android.ui.model.ThreadGoalPreview
import com.remotecodex.android.ui.model.ThreadGoalStatusPreview
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.model.TurnPreview
import com.remotecodex.android.ui.model.LivePlanPreview
import com.remotecodex.android.ui.model.LivePlanStepPreview
import com.remotecodex.android.ui.model.MessagePreview
import com.remotecodex.android.ui.model.PendingRequestPreview
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ThreadPresentationTest {
    @Test
    fun classifiesGraphChatRunningMessageStatuses() {
        listOf("Running", "Generating", "Steering update").forEach { status ->
            assertEquals(
                MessageStatusModel(status, MessageStatusTone.Running),
                graphChatMessageStatusModel(status),
            )
        }
    }

    @Test
    fun classifiesGraphChatTerminalMessageStatuses() {
        assertEquals(
            MessageStatusModel("Complete", MessageStatusTone.Success),
            graphChatMessageStatusModel("Complete"),
        )
        assertEquals(
            MessageStatusModel("Accepted", MessageStatusTone.Success),
            graphChatMessageStatusModel("Accepted"),
        )
        assertEquals(
            MessageStatusModel("Failed", MessageStatusTone.Danger),
            graphChatMessageStatusModel("Failed"),
        )
        assertEquals(
            MessageStatusModel("Error", MessageStatusTone.Danger),
            graphChatMessageStatusModel("Error"),
        )
    }

    @Test
    fun classifiesNeutralAndMissingGraphChatMessageStatuses() {
        assertEquals(
            MessageStatusModel("Queued", MessageStatusTone.Neutral),
            graphChatMessageStatusModel(" Queued "),
        )
        assertNull(graphChatMessageStatusModel(""))
        assertNull(graphChatMessageStatusModel(null as String?))
    }

    @Test
    fun mapsThreadStatusForMessageBadges() {
        assertEquals(
            MessageStatusModel("Running", MessageStatusTone.Running),
            graphChatMessageStatusModel(ThreadStatus.Running),
        )
        assertEquals(
            MessageStatusModel("Complete", MessageStatusTone.Success),
            graphChatMessageStatusModel(ThreadStatus.Complete),
        )
    }

    @Test
    fun buildsAssistantMessageFrameWithDefaultCompleteStatus() {
        assertEquals(
            GraphChatMessageFrameState(
                isUser = false,
                senderLabel = "Assistant",
                headerStatus = MessageStatusModel("Complete", MessageStatusTone.Success),
                footerStatus = null,
                showReasoningBeforeContent = true,
                showFooterMetadata = false,
                showCopyAction = true,
                timeLabel = "10:24",
            ),
            buildGraphChatMessageFrameState(
                author = MessageAuthor.Assistant,
                status = null,
                timeLabel = " 10:24 ",
                copyText = "Finished.",
            ),
        )
    }

    @Test
    fun buildsAssistantMessageFrameWithoutCopyActionForBlankText() {
        assertEquals(
            GraphChatMessageFrameState(
                isUser = false,
                senderLabel = "Assistant",
                headerStatus = MessageStatusModel("Running", MessageStatusTone.Running),
                footerStatus = null,
                showReasoningBeforeContent = true,
                showFooterMetadata = false,
                showCopyAction = false,
                timeLabel = null,
            ),
            buildGraphChatMessageFrameState(
                author = MessageAuthor.Assistant,
                status = ThreadStatus.Running,
                timeLabel = " ",
                copyText = " ",
            ),
        )
    }

    @Test
    fun buildsUserMessageFrameFooterMetadataOnlyWhenNeeded() {
        assertEquals(
            GraphChatMessageFrameState(
                isUser = true,
                senderLabel = null,
                headerStatus = null,
                footerStatus = MessageStatusModel("Failed", MessageStatusTone.Danger),
                showReasoningBeforeContent = false,
                showFooterMetadata = true,
                showCopyAction = false,
                timeLabel = null,
            ),
            buildGraphChatMessageFrameState(
                author = MessageAuthor.User,
                status = ThreadStatus.Failed,
                timeLabel = "",
                copyText = "Retry this",
            ),
        )

        assertEquals(
            GraphChatMessageFrameState(
                isUser = true,
                senderLabel = null,
                headerStatus = null,
                footerStatus = null,
                showReasoningBeforeContent = false,
                showFooterMetadata = false,
                showCopyAction = false,
                timeLabel = null,
            ),
            buildGraphChatMessageFrameState(
                author = MessageAuthor.User,
                status = null,
                timeLabel = " ",
                copyText = "No metadata",
            ),
        )
    }

    @Test
    fun exposesMessageStatusAccessibilityLabel() {
        assertEquals(
            "Status: Steering update",
            graphChatMessageStatusModel("Steering update")?.accessibilityLabel,
        )
    }

    @Test
    fun classifiesQueuedLikeUserMessageStatuses() {
        assertEquals(true, isGraphChatQueuedLikeUserStatus("Steering"))
        assertEquals(true, isGraphChatQueuedLikeUserStatus("Accepted"))
        assertEquals(true, isGraphChatQueuedLikeUserStatus("Awaiting response"))
        assertEquals(false, isGraphChatQueuedLikeUserStatus("Queued"))
        assertEquals(false, isGraphChatQueuedLikeUserStatus(" accepted "))
        assertEquals(false, isGraphChatQueuedLikeUserStatus(null))
    }

    @Test
    fun buildsRunningGraphChatReasoningState() {
        assertEquals(
            GraphChatReasoningState(
                visible = true,
                title = "Thinking...",
                subtitle = "2 reasoning items",
                text = "Inspecting model state\n\nWaiting for tests",
                running = true,
                copyLabel = "Copy thoughts",
                copyAccessibilityLabel = "Copy reasoning text",
            ),
            buildGraphChatReasoningState(
                listOf(
                    ReasoningPreview(" Inspecting model state ", ToolStatus.Completed),
                    ReasoningPreview("Waiting for tests", ToolStatus.Running),
                ),
            ),
        )
    }

    @Test
    fun hidesBlankGraphChatReasoningState() {
        assertEquals(
            GraphChatReasoningState(
                visible = false,
                title = "Thought Process",
                subtitle = "1 reasoning item",
                text = "",
                running = false,
                copyLabel = "Copy thoughts",
                copyAccessibilityLabel = "Copy reasoning text",
            ),
            buildGraphChatReasoningState(
                listOf(ReasoningPreview("  ", ToolStatus.Completed)),
            ),
        )
    }

    @Test
    fun attachesPendingReasoningToNextAgentMessage() {
        val projection = projectGraphChatMessagesWithReasoning(
            listOf(
                GraphChatReasoningProjectionInput.Reasoning(
                    key = "reasoning:1",
                    reasoning = ReasoningPreview("Plan first", ToolStatus.Completed),
                ),
                GraphChatReasoningProjectionInput.Message(
                    key = "agent:1",
                    message = message(MessageAuthor.Assistant, "Agent reply"),
                ),
            ),
        )

        assertEquals(emptyList<ReasoningPreview>(), projection.unattachedReasoningItems)
        assertEquals(1, projection.messages.size)
        assertEquals(
            listOf(ReasoningPreview("Plan first", ToolStatus.Completed)),
            projection.messages.single().reasoningItems,
        )
    }

    @Test
    fun attachesFollowingReasoningToPreviousAdjacentAgentMessage() {
        val projection = projectGraphChatMessagesWithReasoning(
            listOf(
                GraphChatReasoningProjectionInput.Message(
                    key = "agent:1",
                    message = message(
                        author = MessageAuthor.Assistant,
                        text = "Agent reply",
                        reasoningItems = listOf(ReasoningPreview("Existing", ToolStatus.Completed)),
                    ),
                ),
                GraphChatReasoningProjectionInput.Reasoning(
                    key = "reasoning:1",
                    reasoning = ReasoningPreview("Follow up", ToolStatus.Running),
                ),
            ),
        )

        assertEquals(emptyList<ReasoningPreview>(), projection.unattachedReasoningItems)
        assertEquals(
            listOf(
                ReasoningPreview("Existing", ToolStatus.Completed),
                ReasoningPreview("Follow up", ToolStatus.Running),
            ),
            projection.messages.single().reasoningItems,
        )
    }

    @Test
    fun keepsReasoningUnattachedWhenUserMessageBreaksAdjacency() {
        val projection = projectGraphChatMessagesWithReasoning(
            listOf(
                GraphChatReasoningProjectionInput.Message(
                    key = "agent:1",
                    message = message(MessageAuthor.Assistant, "Agent reply"),
                ),
                GraphChatReasoningProjectionInput.Message(
                    key = "user:1",
                    message = message(MessageAuthor.User, "Steer"),
                ),
                GraphChatReasoningProjectionInput.Reasoning(
                    key = "reasoning:1",
                    reasoning = ReasoningPreview("Detached", ToolStatus.Completed),
                ),
            ),
        )

        assertEquals(2, projection.messages.size)
        assertEquals(emptyList<ReasoningPreview>(), projection.messages.first().reasoningItems)
        assertEquals(
            listOf(ReasoningPreview("Detached", ToolStatus.Completed)),
            projection.unattachedReasoningItems,
        )
    }

    @Test
    fun mapsPlanStepStatusAccessibilityLabels() {
        assertEquals("Plan step status: Completed", planStepStatusAccessibilityLabel(PlanStepStatus.Completed))
        assertEquals("Plan step status: In progress", planStepStatusAccessibilityLabel(PlanStepStatus.Running))
        assertEquals("Plan step status: Failed", planStepStatusAccessibilityLabel(PlanStepStatus.Failed))
        assertEquals("Plan step status: Pending", planStepStatusAccessibilityLabel(PlanStepStatus.Pending))
        assertEquals("Plan step status: Unknown", planStepStatusAccessibilityLabel(PlanStepStatus.Unknown))
    }

    @Test
    fun buildsPlanStepStatusPresentationState() {
        assertEquals(
            PlanStepStatusPresentationState(
                label = "Done",
                accessibilityLabel = "Plan step status: Completed",
                tone = PlanStepStatusTone.Success,
                running = false,
            ),
            buildPlanStepStatusPresentationState(PlanStepStatus.Completed),
        )
        assertEquals(
            PlanStepStatusPresentationState(
                label = "Running",
                accessibilityLabel = "Plan step status: In progress",
                tone = PlanStepStatusTone.Running,
                running = true,
            ),
            buildPlanStepStatusPresentationState(PlanStepStatus.Running),
        )
        assertEquals(
            PlanStepStatusPresentationState(
                label = "Pending",
                accessibilityLabel = "Plan step status: Pending",
                tone = PlanStepStatusTone.Pending,
                running = false,
            ),
            buildPlanStepStatusPresentationState(PlanStepStatus.Pending),
        )
    }

    @Test
    fun buildsGraphChatLivePlanCardStateWithWebLabels() {
        assertEquals(
            GraphChatLivePlanCardState(
                title = "Plan update",
                badgeLabel = "Live",
                explanation = "Port the card labels.",
                steps = listOf(
                    LivePlanStepState(1, "Read web turn body", PlanStepStatus.Completed),
                    LivePlanStepState(2, "Update Android", PlanStepStatus.Running),
                ),
            ),
            buildGraphChatLivePlanCardState(
                LivePlanPreview(
                    title = "Backend supplied title",
                    explanation = " Port the card labels. ",
                    steps = listOf(
                        LivePlanStepPreview("Read web turn body", PlanStepStatus.Completed),
                        LivePlanStepPreview("Update Android", PlanStepStatus.Running),
                    ),
                ),
            ),
        )
    }

    @Test
    fun buildsGraphChatLivePlanCardStateWithoutBlankExplanation() {
        assertEquals(
            null,
            buildGraphChatLivePlanCardState(
                LivePlanPreview(
                    title = "Plan",
                    explanation = " ",
                    steps = emptyList(),
                ),
            ).explanation,
        )
    }

    @Test
    fun buildsGraphChatTurnFrameStateForOptimisticTurn() {
        assertEquals(
            GraphChatTurnFrameState(
                indexLabel = "SENDING",
                indexTone = ComposerStatusTone.Warning,
                timeLabel = "12:04",
                statusLabel = "running",
                status = ThreadStatus.Running,
                tokenSummary = null,
                collapseAccessibilityLabel = "Collapse turn 9",
                collapseTitle = "Collapse turn",
                collapsedSummary = "Turn collapsed · 0 messages",
            ),
            buildGraphChatTurnFrameState(
                turn = TurnPreview(
                    index = 9,
                    timeLabel = " 12:04 ",
                    statusLabel = " running ",
                    tokenSummary = " ",
                    messages = emptyList(),
                    optimistic = true,
                ),
                collapsed = false,
            ),
        )
    }

    @Test
    fun buildsGraphChatTurnFrameStateForCollapsedTurnWithLivePlan() {
        assertEquals(
            GraphChatTurnFrameState(
                indexLabel = "TURN 3",
                indexTone = ComposerStatusTone.Neutral,
                timeLabel = "09:15",
                statusLabel = "complete",
                status = ThreadStatus.Complete,
                tokenSummary = "4.2k tokens",
                collapseAccessibilityLabel = "Expand turn 3",
                collapseTitle = "Expand turn",
                collapsedSummary = "Turn collapsed · 1 message · live plan",
            ),
            buildGraphChatTurnFrameState(
                turn = TurnPreview(
                    index = 3,
                    timeLabel = "09:15",
                    statusLabel = " ",
                    tokenSummary = " 4.2k tokens ",
                    messages = listOf(
                        MessagePreview(
                            author = MessageAuthor.Assistant,
                            status = ThreadStatus.Complete,
                            timeLabel = "09:15",
                            text = "Done",
                        ),
                    ),
                    livePlan = LivePlanPreview(
                        title = "Plan update",
                        explanation = null,
                        steps = listOf(LivePlanStepPreview("Ship", PlanStepStatus.Completed)),
                    ),
                ),
                collapsed = true,
            ),
        )
    }

    @Test
    fun buildsComposerStatusStripForRunningChat() {
        assertEquals(
            listOf(
                ComposerStatusChipModel("Running", ComposerStatusTone.Running),
                ComposerStatusChipModel("Following", ComposerStatusTone.Success),
                ComposerStatusChipModel("Chat", ComposerStatusTone.Neutral),
                ComposerStatusChipModel("workspace write", ComposerStatusTone.Neutral),
            ),
            buildComposerStatusStrip(
                threadConnected = true,
                busy = true,
                followTail = true,
                activeView = ComposerActiveView.Chat,
                workspaceModeLabel = "workspace write",
            ),
        )
    }

    @Test
    fun buildsComposerStatusStripForDisconnectedShell() {
        assertEquals(
            listOf(
                ComposerStatusChipModel("Offline", ComposerStatusTone.Danger),
                ComposerStatusChipModel("Paused", ComposerStatusTone.Neutral),
                ComposerStatusChipModel("Shell", ComposerStatusTone.Neutral),
            ),
            buildComposerStatusStrip(
                threadConnected = false,
                busy = false,
                followTail = false,
                activeView = ComposerActiveView.Shell,
                workspaceModeLabel = " ",
            ),
        )
    }

    @Test
    fun buildsComposerActionStateForInterruptibleChat() {
        assertEquals(
            ComposerActionState(
                primaryLabel = "Stop Current Turn",
                primaryKind = ComposerPrimaryActionKind.Stop,
                interruptLabel = "Stop Current Turn",
                showInterrupt = false,
                sendEnabled = true,
            ),
            buildComposerActionState(
                threadConnected = true,
                busy = true,
                activeView = ComposerActiveView.Chat,
                canInterrupt = true,
            ),
        )
    }

    @Test
    fun buildsComposerActionStateForConnectingChat() {
        assertEquals(
            ComposerActionState(
                primaryLabel = "Connecting...",
                primaryKind = ComposerPrimaryActionKind.Connecting,
                interruptLabel = "Stop Current Turn",
                showInterrupt = false,
                sendEnabled = true,
            ),
            buildComposerActionState(
                threadConnected = false,
                busy = true,
                activeView = ComposerActiveView.Chat,
                canInterrupt = false,
            ),
        )
    }

    @Test
    fun buildsComposerActionStateForShellInterruptControl() {
        assertEquals(
            ComposerActionState(
                primaryLabel = "Send",
                primaryKind = ComposerPrimaryActionKind.Send,
                interruptLabel = "Send Ctrl-C",
                showInterrupt = true,
                sendEnabled = false,
            ),
            buildComposerActionState(
                threadConnected = true,
                busy = true,
                activeView = ComposerActiveView.Shell,
                canInterrupt = true,
            ),
        )
    }

    @Test
    fun buildsComposerJumpLatestStateForChat() {
        assertEquals(
            ComposerJumpLatestState(
                visible = true,
                active = false,
                accessibilityLabel = "Jump to latest",
                title = "Jump to the latest messages",
            ),
            buildComposerJumpLatestState(
                activeView = ComposerActiveView.Chat,
                followTail = false,
            ),
        )
        assertEquals(
            ComposerJumpLatestState(
                visible = true,
                active = true,
                accessibilityLabel = "Jump to latest",
                title = "Latest turn is in view",
            ),
            buildComposerJumpLatestState(
                activeView = ComposerActiveView.Chat,
                followTail = true,
            ),
        )
    }

    @Test
    fun hidesComposerJumpLatestStateForShell() {
        assertEquals(
            ComposerJumpLatestState(
                visible = false,
                active = false,
                accessibilityLabel = "Jump to latest",
                title = "Jump to the latest messages",
            ),
            buildComposerJumpLatestState(
                activeView = ComposerActiveView.Shell,
                followTail = false,
            ),
        )
    }

    @Test
    fun buildsChatComposerFrameStateWithPromptGoalAndJumpLatest() {
        assertEquals(
            ComposerFrameState(
                activeView = ComposerActiveView.Chat,
                formTestTag = "chat-composer",
                jumpLatest = ComposerJumpLatestState(
                    visible = true,
                    active = false,
                    accessibilityLabel = "Jump to latest",
                    title = "Jump to the latest messages",
                ),
                showPromptSlot = true,
                showGoalSlot = true,
                showShellPromptSlot = false,
                errorMessage = null,
            ),
            buildComposerFrameState(
                activeView = ComposerActiveView.Chat,
                followTail = false,
                goalComposeMode = true,
                error = " ",
            ),
        )
    }

    @Test
    fun buildsShellComposerFrameStateWithShellPromptAndTrimmedError() {
        assertEquals(
            ComposerFrameState(
                activeView = ComposerActiveView.Shell,
                formTestTag = null,
                jumpLatest = ComposerJumpLatestState(
                    visible = false,
                    active = false,
                    accessibilityLabel = "Jump to latest",
                    title = "Latest turn is in view",
                ),
                showPromptSlot = false,
                showGoalSlot = false,
                showShellPromptSlot = true,
                errorMessage = "failed to submit",
            ),
            buildComposerFrameState(
                activeView = ComposerActiveView.Shell,
                followTail = true,
                goalComposeMode = true,
                error = " failed to submit ",
            ),
        )
    }

    @Test
    fun buildsAvailableComposerContextUsageState() {
        assertEquals(
            ComposerContextUsageState(
                modelLabel = "gpt-test",
                usageLabel = "12.5k / 100k",
                remainingLabel = "87.5k left · 87% context left",
                progressFraction = 0.87f,
                available = true,
            ),
            buildComposerContextUsageState(
                ComposerContextPreview(
                    model = "gpt-test",
                    tokensInContextWindow = 12_500,
                    modelContextWindow = 100_000,
                    remainingPercent = 87,
                ),
            ),
        )
    }

    @Test
    fun buildsUnavailableComposerContextUsageState() {
        assertEquals(
            ComposerContextUsageState(
                modelLabel = "Select model",
                usageLabel = "Context unavailable",
                remainingLabel = "Context usage unavailable",
                progressFraction = 0f,
                available = false,
            ),
            buildComposerContextUsageState(
                ComposerContextPreview(
                    model = "",
                    tokensInContextWindow = 0,
                    modelContextWindow = 0,
                    remainingPercent = 120,
                    availability = ComposerContextAvailability.Unavailable,
                ),
            ),
        )
    }

    @Test
    fun formatsComposerContextTokenKilocounts() {
        assertEquals("999", formatContextTokenKilocount(999))
        assertEquals("1k", formatContextTokenKilocount(1_000))
        assertEquals("42.8k", formatContextTokenKilocount(42_850))
        assertEquals("0", formatContextTokenKilocount(-3))
    }

    @Test
    fun buildsPendingRequestCardState() {
        assertEquals(
            PendingRequestCardState(
                title = "Answer Required",
                description = "Run the build from the Android workspace.",
                riskLabel = "Permission required",
                commandLabel = "Requested action",
                command = "./gradlew :app:assembleDebug",
                denyLabel = "Deny",
                approveLabel = "Approve",
                approveAccessibilityLabel = "Approve Answer Required",
                denyAccessibilityLabel = "Deny Answer Required",
            ),
            buildPendingRequestCardState(
                PendingRequestPreview(
                    title = " ",
                    description = " Run the build from the Android workspace. ",
                    command = " ./gradlew :app:assembleDebug ",
                    riskLabel = " ",
                ),
            ),
        )
    }

    @Test
    fun buildsEnabledComposerSettingsState() {
        assertEquals(
            ComposerSettingsState(
                modelLabel = "gpt-test",
                modelEnabled = true,
                effortLabel = "Medium",
                effortEnabled = true,
                effortTitle = "Select reasoning effort",
                planVisible = true,
                planSelected = true,
                updateActions = ComposerSettingsActionState(
                    displayedCollaborationMode = "plan",
                    closeMenuOnSuccess = true,
                    resetOptimisticModeOnHostChange = true,
                ),
            ),
            buildComposerSettingsState(
                context = ComposerContextPreview(model = "gpt-test"),
                reasoningEffort = "medium",
                supportedReasoningEffortCount = 3,
                settingsBusy = false,
                fastMode = false,
                planModeAvailable = true,
                planModeActive = true,
            ),
        )
    }

    @Test
    fun buildsFastModeComposerSettingsState() {
        assertEquals(
            ComposerSettingsState(
                modelLabel = "gpt-test",
                modelEnabled = true,
                effortLabel = "High",
                effortEnabled = true,
                effortTitle = "Fast mode is on. Turn it off from the slash toolbox to edit reasoning.",
                planVisible = false,
                planSelected = false,
                updateActions = ComposerSettingsActionState(
                    displayedCollaborationMode = "plan",
                    closeMenuOnSuccess = true,
                    resetOptimisticModeOnHostChange = true,
                ),
            ),
            buildComposerSettingsState(
                context = ComposerContextPreview(model = "gpt-test"),
                reasoningEffort = "high",
                supportedReasoningEffortCount = 3,
                settingsBusy = false,
                fastMode = true,
                planModeAvailable = false,
                planModeActive = true,
            ),
        )
    }

    @Test
    fun disablesComposerSettingsWhenNoEffortsOrBusy() {
        assertEquals(
            ComposerSettingsState(
                modelLabel = "Select model",
                modelEnabled = false,
                effortLabel = "Auto",
                effortEnabled = false,
                effortTitle = "The selected model does not expose adjustable reasoning effort.",
                settingsBusy = true,
                planVisible = true,
                planSelected = false,
            ),
            buildComposerSettingsState(
                context = ComposerContextPreview(model = ""),
                reasoningEffort = null,
                supportedReasoningEffortCount = 0,
                settingsBusy = true,
                fastMode = false,
                planModeAvailable = true,
                planModeActive = false,
            ),
        )
    }

    @Test
    fun disablesComposerModelSettingsWhenNoModelOptions() {
        assertEquals(
            ComposerSettingsState(
                modelLabel = "gpt-test",
                modelEnabled = false,
                effortLabel = "Medium",
                effortEnabled = false,
                effortTitle = "Select reasoning effort",
                planVisible = true,
                planSelected = false,
            ),
            buildComposerSettingsState(
                context = ComposerContextPreview(model = "gpt-test"),
                reasoningEffort = "medium",
                supportedReasoningEffortCount = 3,
                modelOptionCount = 0,
                settingsBusy = false,
                fastMode = false,
                planModeAvailable = true,
                planModeActive = false,
            ),
        )
    }

    @Test
    fun buildsChatComposerSettingsToolbarState() {
        assertEquals(
            ComposerSettingsToolbarState(
                modelButton = ComposerToolbarButtonState(
                    visible = true,
                    selected = true,
                    enabled = true,
                    label = "gpt-test",
                ),
                modelTitle = "gpt-test",
                modelMenuExpanded = true,
                effortButton = ComposerToolbarButtonState(
                    visible = true,
                    selected = false,
                    enabled = true,
                    label = "Medium",
                ),
                effortTitle = "Select reasoning effort",
                effortMenuExpanded = false,
                planButton = ComposerToolbarButtonState(
                    visible = true,
                    selected = true,
                    enabled = true,
                    label = "Plan",
                ),
                planPressed = true,
                sendButton = ComposerSendButtonState(
                    label = "Send",
                    accessibilityLabel = "Send Prompt",
                    title = "Send",
                    enabled = true,
                    primaryKind = ComposerPrimaryActionKind.Send,
                ),
                updateActions = ComposerSettingsActionState(
                    displayedCollaborationMode = "default",
                    closeMenuOnSuccess = true,
                    resetOptimisticModeOnHostChange = true,
                ),
            ),
            buildComposerSettingsToolbarState(
                settingsState = ComposerSettingsState(
                    modelLabel = "gpt-test",
                    modelEnabled = true,
                    effortLabel = "Medium",
                    effortEnabled = true,
                    effortTitle = "Select reasoning effort",
                    planVisible = true,
                    planSelected = true,
                ),
                openMenu = ComposerToolbarMenuState.Model,
                actionState = ComposerActionState(
                    primaryLabel = "Send",
                    primaryKind = ComposerPrimaryActionKind.Send,
                    interruptLabel = "Stop Current Turn",
                    showInterrupt = false,
                    sendEnabled = true,
                ),
                activeView = ComposerActiveView.Chat,
                promptDisabled = false,
                goalComposeMode = false,
                goalBusy = false,
            ),
        )
    }

    @Test
    fun disablesComposerSettingsToolbarSendButtonFromPromptAndActionState() {
        val settings = ComposerSettingsState(
            modelLabel = "gpt-test",
            modelEnabled = true,
            effortLabel = "Medium",
            effortEnabled = true,
            effortTitle = "Select reasoning effort",
            planVisible = false,
            planSelected = false,
        )
        val action = ComposerActionState(
            primaryLabel = "Send",
            primaryKind = ComposerPrimaryActionKind.Send,
            interruptLabel = "Send Ctrl-C",
            showInterrupt = true,
            sendEnabled = false,
        )

        assertEquals(
            false,
            buildComposerSettingsToolbarState(
                settingsState = settings,
                openMenu = null,
                actionState = action,
                activeView = ComposerActiveView.Chat,
                promptDisabled = true,
                goalComposeMode = false,
                goalBusy = false,
            ).sendButton.enabled,
        )
        assertEquals(
            false,
            buildComposerSettingsToolbarState(
                settingsState = settings,
                openMenu = null,
                actionState = action,
                activeView = ComposerActiveView.Shell,
                promptDisabled = true,
                goalComposeMode = false,
                goalBusy = false,
            ).sendButton.enabled,
        )
    }

    @Test
    fun disablesSettingsToolbarSendButtonWhileGoalBusyAndLabelsGoalSubmit() {
        val state = buildComposerSettingsToolbarState(
            settingsState = ComposerSettingsState(
                modelLabel = "gpt-test",
                modelEnabled = true,
                effortLabel = "Medium",
                effortEnabled = true,
                effortTitle = "Select reasoning effort",
                planVisible = true,
                planSelected = false,
            ),
            openMenu = null,
            actionState = ComposerActionState(
                primaryLabel = "Set goal",
                primaryKind = ComposerPrimaryActionKind.Send,
                interruptLabel = "Stop Current Turn",
                showInterrupt = false,
                sendEnabled = true,
            ),
            activeView = ComposerActiveView.Chat,
            promptDisabled = false,
            goalComposeMode = true,
            goalBusy = true,
        )

        assertEquals(
            ComposerSendButtonState(
                label = "Set goal",
                accessibilityLabel = "Set goal",
                title = "Set goal",
                enabled = false,
                primaryKind = ComposerPrimaryActionKind.Send,
            ),
            state.sendButton,
        )
        assertEquals(true, state.planButton.enabled)
    }

    @Test
    fun disablesSettingsToolbarPlanButtonWhileSettingsBusy() {
        val state = buildComposerSettingsToolbarState(
            settingsState = ComposerSettingsState(
                modelLabel = "gpt-test",
                modelEnabled = false,
                effortLabel = "Medium",
                effortEnabled = false,
                effortTitle = "Select reasoning effort",
                settingsBusy = true,
                planVisible = true,
                planSelected = false,
            ),
            openMenu = null,
            actionState = ComposerActionState(
                primaryLabel = "Send",
                primaryKind = ComposerPrimaryActionKind.Send,
                interruptLabel = "Stop Current Turn",
                showInterrupt = false,
                sendEnabled = true,
            ),
            activeView = ComposerActiveView.Chat,
            promptDisabled = false,
            goalComposeMode = false,
            goalBusy = false,
        )

        assertEquals(false, state.planButton.enabled)
    }

    @Test
    fun buildsComposerSettingsActionStateWithOptimisticMode() {
        assertEquals(
            ComposerSettingsActionState(
                displayedCollaborationMode = "plan",
                closeMenuOnSuccess = true,
                resetOptimisticModeOnHostChange = true,
            ),
            buildComposerSettingsState(
                context = ComposerContextPreview(model = "gpt-test"),
                reasoningEffort = "medium",
                supportedReasoningEffortCount = 3,
                settingsBusy = false,
                fastMode = false,
                planModeAvailable = true,
                planModeActive = false,
                collaborationMode = "default",
                optimisticCollaborationMode = "plan",
            ).updateActions,
        )
    }

    @Test
    fun derivesComposerSettingsUpdateDecision() {
        assertEquals(
            ComposerSettingsUpdateDecisionState(
                optimisticMode = "plan",
                rollbackMode = "default",
                shouldRollbackMode = true,
                closeMenuOnSuccess = true,
            ),
            deriveComposerSettingsUpdateDecision(
                nextCollaborationMode = "plan",
                previousOptimisticMode = "default",
            ),
        )
        assertEquals(
            ComposerSettingsUpdateDecisionState(
                optimisticMode = null,
                rollbackMode = null,
                shouldRollbackMode = false,
                closeMenuOnSuccess = true,
            ),
            deriveComposerSettingsUpdateDecision(
                nextCollaborationMode = null,
                previousOptimisticMode = "plan",
            ),
        )
        assertEquals(
            ComposerSettingsUpdateDecisionState(
                optimisticMode = "default",
                rollbackMode = null,
                shouldRollbackMode = true,
                closeMenuOnSuccess = true,
            ),
            deriveComposerSettingsUpdateDecision(
                nextCollaborationMode = "default",
                previousOptimisticMode = null,
            ),
        )
    }

    @Test
    fun buildsComposerModelOptions() {
        assertEquals(
            listOf(
                ComposerSelectionOptionState(
                    label = "gpt-test",
                    detail = "current",
                    selected = true,
                ),
                ComposerSelectionOptionState(
                    label = "gpt-next",
                    detail = "default High",
                    selected = false,
                ),
                ComposerSelectionOptionState(
                    label = "local",
                    detail = "available",
                    selected = false,
                ),
            ),
            buildComposerModelOptions(
                currentModel = "gpt-test",
                options = listOf(
                    ComposerModelOptionPreview(model = "gpt-test", defaultReasoningEffort = "medium"),
                    ComposerModelOptionPreview(model = "gpt-next", defaultReasoningEffort = "high"),
                    ComposerModelOptionPreview(model = "local", defaultReasoningEffort = null),
                ),
            ),
        )
    }

    @Test
    fun buildsComposerReasoningEffortOptions() {
        assertEquals(
            listOf(
                ComposerSelectionOptionState(
                    label = "Low",
                    detail = "available",
                    selected = false,
                ),
                ComposerSelectionOptionState(
                    label = "Medium",
                    detail = "current",
                    selected = true,
                ),
            ),
            buildComposerReasoningEffortOptions(
                currentEffort = "medium",
                options = listOf(
                    ComposerReasoningEffortOptionPreview(reasoningEffort = "low"),
                    ComposerReasoningEffortOptionPreview(reasoningEffort = "medium"),
                ),
            ),
        )
    }

    @Test
    fun buildsComposerAttachmentActions() {
        assertEquals(
            listOf(
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
            ),
            buildComposerAttachmentActions(),
        )
    }

    @Test
    fun buildsOpenComposerAttachmentPanelState() {
        assertEquals(
            ComposerAttachmentPanelState(
                open = true,
                triggerLabel = "Add attachment",
                triggerAccessibilityLabel = "Add attachment",
                menuVisible = true,
                actions = listOf(
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
                ),
                actionCountLabel = "2 actions",
                queuedAttachments = listOf(
                    ComposerPromptAttachmentState(
                        label = "capture.png",
                        kind = ComposerAttachmentActionKind.Photo,
                    ),
                    ComposerPromptAttachmentState(
                        label = "notes.md",
                        kind = ComposerAttachmentActionKind.File,
                    ),
                ),
                queuedCountLabel = "2 queued attachments",
                emptyMessage = null,
                previewLifecycle = ComposerAttachmentPreviewLifecycleState(
                    previewablePhotoClientIds = listOf("photo"),
                    clearsPreviewsInShellView = false,
                    reusesCachedPreviewUrls = true,
                    revokesRemovedPreviewUrls = true,
                    revokesPreviewUrlsOnDispose = true,
                    stateDescription = "1 photo preview",
                ),
            ),
            buildComposerAttachmentPanelState(
                open = true,
                prompt = ComposerPromptPreview(
                    attachments = listOf(
                        ComposerPromptAttachmentPreview(
                            clientId = "photo",
                            kind = ComposerAttachmentKindPreview.Photo,
                            name = "/tmp/capture.png",
                            placeholder = "[PHOTO capture.png]",
                        ),
                        ComposerPromptAttachmentPreview(
                            clientId = "file",
                            kind = ComposerAttachmentKindPreview.File,
                            name = "notes.md",
                            placeholder = "[FILE notes.md]",
                        ),
                    ),
                ),
            ),
        )
    }

    @Test
    fun buildsClosedEmptyComposerAttachmentPanelState() {
        assertEquals(
            ComposerAttachmentPanelState(
                open = false,
                triggerLabel = "Add attachment",
                triggerAccessibilityLabel = "Add attachment",
                menuVisible = false,
                actions = listOf(
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
                ),
                actionCountLabel = "2 actions",
                queuedAttachments = emptyList(),
                queuedCountLabel = "No queued attachments",
                emptyMessage = "No queued attachments.",
                previewLifecycle = ComposerAttachmentPreviewLifecycleState(
                    previewablePhotoClientIds = emptyList(),
                    clearsPreviewsInShellView = false,
                    reusesCachedPreviewUrls = true,
                    revokesRemovedPreviewUrls = true,
                    revokesPreviewUrlsOnDispose = true,
                    stateDescription = "No photo previews",
                ),
            ),
            buildComposerAttachmentPanelState(
                open = false,
                prompt = ComposerPromptPreview(attachments = emptyList()),
            ),
        )
    }

    @Test
    fun buildsClosedComposerAttachmentMenuSemantics() {
        val state = buildComposerAttachmentPanelState(
            open = false,
            prompt = ComposerPromptPreview(
                attachments = listOf(
                    ComposerPromptAttachmentPreview(
                        clientId = "queued",
                        kind = ComposerAttachmentKindPreview.File,
                        name = "notes.md",
                        placeholder = "[FILE notes.md]",
                    ),
                ),
            ),
        )

        assertEquals("Add attachment", state.triggerAccessibilityLabel)
        assertEquals(false, state.menuVisible)
        assertEquals(listOf("Photo", "File"), state.actions.map { it.label })
        assertEquals("1 queued attachment", state.queuedCountLabel)
        assertEquals(null, state.emptyMessage)
    }

    @Test
    fun buildsAttachmentPreviewLifecycleForPhotosAndShellView() {
        val attachments = listOf(
            ComposerPromptAttachmentPreview(
                clientId = "photo-a",
                kind = ComposerAttachmentKindPreview.Photo,
                name = "a.png",
                placeholder = "[PHOTO a.png]",
            ),
            ComposerPromptAttachmentPreview(
                clientId = "file-a",
                kind = ComposerAttachmentKindPreview.File,
                name = "a.txt",
                placeholder = "[FILE a.txt]",
            ),
            ComposerPromptAttachmentPreview(
                clientId = "photo-b",
                kind = ComposerAttachmentKindPreview.Photo,
                name = "b.png",
                placeholder = "[PHOTO b.png]",
            ),
        )

        assertEquals(
            ComposerAttachmentPreviewLifecycleState(
                previewablePhotoClientIds = listOf("photo-a", "photo-b"),
                clearsPreviewsInShellView = false,
                reusesCachedPreviewUrls = true,
                revokesRemovedPreviewUrls = true,
                revokesPreviewUrlsOnDispose = true,
                stateDescription = "2 photo previews",
            ),
            buildComposerAttachmentPreviewLifecycleState(
                attachments = attachments,
                isShellView = false,
            ),
        )
        assertEquals(
            ComposerAttachmentPreviewLifecycleState(
                previewablePhotoClientIds = emptyList(),
                clearsPreviewsInShellView = true,
                reusesCachedPreviewUrls = true,
                revokesRemovedPreviewUrls = true,
                revokesPreviewUrlsOnDispose = true,
                stateDescription = "Attachment previews cleared in shell view",
            ),
            buildComposerAttachmentPreviewLifecycleState(
                attachments = attachments,
                isShellView = true,
            ),
        )
    }

    @Test
    fun buildsComposerDraftControlStateForHostAndLocalDrafts() {
        assertEquals(
            ComposerDraftControlState(
                controlled = true,
                promptAvailable = true,
                attachmentsAvailable = true,
                hostChangeAvailable = true,
                shellViewForcesUncontrolled = false,
                localDraftSourceLabel = "Host draft",
                stateDescription = "Composer draft controlled by host",
            ),
            buildComposerDraftControlState(
                isShellView = false,
                draftPromptAvailable = true,
                draftAttachmentsAvailable = true,
                hostDraftChangeAvailable = true,
            ),
        )

        assertEquals(
            ComposerDraftControlState(
                controlled = false,
                promptAvailable = true,
                attachmentsAvailable = true,
                hostChangeAvailable = true,
                shellViewForcesUncontrolled = true,
                localDraftSourceLabel = "Local draft",
                stateDescription = "Shell draft is local",
            ),
            buildComposerDraftControlState(
                isShellView = true,
                draftPromptAvailable = true,
                draftAttachmentsAvailable = true,
                hostDraftChangeAvailable = true,
            ),
        )

        assertEquals(
            ComposerDraftControlState(
                controlled = false,
                promptAvailable = true,
                attachmentsAvailable = false,
                hostChangeAvailable = false,
                shellViewForcesUncontrolled = false,
                localDraftSourceLabel = "Local draft",
                stateDescription = "Composer draft is local: missing attachments, host callback",
            ),
            buildComposerDraftControlState(
                isShellView = false,
                draftPromptAvailable = true,
                draftAttachmentsAvailable = false,
                hostDraftChangeAvailable = false,
            ),
        )
    }

    @Test
    fun buildsComposerDraftStateAndSignature() {
        val draft = buildComposerDraftState(
            prompt = "inspect",
            attachments = listOf(
                ComposerPromptAttachmentPreview(
                    clientId = "photo-a",
                    kind = ComposerAttachmentKindPreview.Photo,
                    name = "capture.png",
                    placeholder = "[PHOTO capture.png]",
                ),
                ComposerPromptAttachmentPreview(
                    clientId = "file-a",
                    kind = ComposerAttachmentKindPreview.File,
                    name = "notes.md",
                    placeholder = "[FILE notes.md]",
                ),
            ),
        )

        assertEquals("inspect", draft.prompt)
        assertEquals(
            "inspect\u001fphoto-a\u001ephoto\u001e[PHOTO capture.png]\u001ecapture.png" +
                "\u001dfile-a\u001efile\u001e[FILE notes.md]\u001enotes.md",
            composerDraftSignature(draft),
        )
        assertEquals(
            ComposerDraftState(prompt = "", attachments = emptyList()),
            buildComposerDraftState(prompt = null, attachments = null),
        )
    }

    @Test
    fun derivesImmediateControlledComposerDraftSyncDecision() {
        val control = buildComposerDraftControlState(
            isShellView = false,
            draftPromptAvailable = true,
            draftAttachmentsAvailable = true,
            hostDraftChangeAvailable = true,
        )
        val previous = ComposerDraftState(prompt = "host")
        val next = ComposerDraftState(prompt = "next")

        assertEquals(
            ComposerDraftSyncDecisionState(
                controlled = true,
                event = ComposerDraftSyncEventState.Update,
                shouldSendToHost = true,
                shouldScheduleDeferredSync = false,
                shouldClearPendingTimer = false,
                shouldUpdateLastSentSignature = true,
                delayMillis = null,
                nextSignature = composerDraftSignature(next),
                stateDescription = "Controlled draft syncs now",
            ),
            deriveComposerDraftSyncDecision(
                controlState = control,
                event = ComposerDraftSyncEventState.Update,
                nextDraft = next,
                lastSentSignature = composerDraftSignature(previous),
                hasPendingTimer = false,
                syncMode = ComposerDraftSyncModeState.Immediate,
            ),
        )
    }

    @Test
    fun derivesDeferredControlledComposerDraftSyncDecision() {
        val control = buildComposerDraftControlState(
            isShellView = false,
            draftPromptAvailable = true,
            draftAttachmentsAvailable = true,
            hostDraftChangeAvailable = true,
        )
        val next = ComposerDraftState(prompt = "pending")

        assertEquals(
            ComposerDraftSyncDecisionState(
                controlled = true,
                event = ComposerDraftSyncEventState.Update,
                shouldSendToHost = false,
                shouldScheduleDeferredSync = true,
                shouldClearPendingTimer = true,
                shouldUpdateLastSentSignature = false,
                delayMillis = COMPOSER_DRAFT_SYNC_DELAY_MS,
                nextSignature = composerDraftSignature(next),
                stateDescription = "Controlled draft sync deferred",
            ),
            deriveComposerDraftSyncDecision(
                controlState = control,
                event = ComposerDraftSyncEventState.Update,
                nextDraft = next,
                lastSentSignature = composerDraftSignature(ComposerDraftState(prompt = "host")),
                hasPendingTimer = true,
                syncMode = ComposerDraftSyncModeState.Deferred,
            ),
        )
    }

    @Test
    fun derivesFlushAndDuplicateComposerDraftSyncDecisions() {
        val control = buildComposerDraftControlState(
            isShellView = false,
            draftPromptAvailable = true,
            draftAttachmentsAvailable = true,
            hostDraftChangeAvailable = true,
        )
        val next = ComposerDraftState(prompt = "pending")

        assertEquals(
            ComposerDraftSyncDecisionState(
                controlled = true,
                event = ComposerDraftSyncEventState.Flush,
                shouldSendToHost = true,
                shouldScheduleDeferredSync = false,
                shouldClearPendingTimer = true,
                shouldUpdateLastSentSignature = true,
                delayMillis = null,
                nextSignature = composerDraftSignature(next),
                stateDescription = "Controlled draft syncs now",
            ),
            deriveComposerDraftSyncDecision(
                controlState = control,
                event = ComposerDraftSyncEventState.Flush,
                nextDraft = next,
                lastSentSignature = composerDraftSignature(ComposerDraftState(prompt = "host")),
                hasPendingTimer = true,
                syncMode = ComposerDraftSyncModeState.Deferred,
            ),
        )

        assertEquals(
            ComposerDraftSyncDecisionState(
                controlled = true,
                event = ComposerDraftSyncEventState.Flush,
                shouldSendToHost = false,
                shouldScheduleDeferredSync = false,
                shouldClearPendingTimer = false,
                shouldUpdateLastSentSignature = false,
                delayMillis = null,
                nextSignature = composerDraftSignature(next),
                stateDescription = "Controlled draft already synced",
            ),
            deriveComposerDraftSyncDecision(
                controlState = control,
                event = ComposerDraftSyncEventState.Flush,
                nextDraft = next,
                lastSentSignature = composerDraftSignature(next),
                hasPendingTimer = false,
                syncMode = ComposerDraftSyncModeState.Immediate,
            ),
        )
    }

    @Test
    fun derivesHostRefreshDisposeAndUncontrolledComposerDraftSyncDecisions() {
        val control = buildComposerDraftControlState(
            isShellView = false,
            draftPromptAvailable = true,
            draftAttachmentsAvailable = true,
            hostDraftChangeAvailable = true,
        )
        val shellControl = buildComposerDraftControlState(
            isShellView = true,
            draftPromptAvailable = true,
            draftAttachmentsAvailable = true,
            hostDraftChangeAvailable = true,
        )
        val next = ComposerDraftState(prompt = "host refresh")

        assertEquals(
            ComposerDraftSyncDecisionState(
                controlled = true,
                event = ComposerDraftSyncEventState.HostRefresh,
                shouldSendToHost = false,
                shouldScheduleDeferredSync = false,
                shouldClearPendingTimer = true,
                shouldUpdateLastSentSignature = true,
                delayMillis = null,
                nextSignature = composerDraftSignature(next),
                stateDescription = "Host draft refresh accepted",
            ),
            deriveComposerDraftSyncDecision(
                controlState = control,
                event = ComposerDraftSyncEventState.HostRefresh,
                nextDraft = next,
                lastSentSignature = composerDraftSignature(ComposerDraftState(prompt = "host")),
                hasPendingTimer = true,
            ),
        )

        assertEquals(
            ComposerDraftSyncDecisionState(
                controlled = true,
                event = ComposerDraftSyncEventState.Dispose,
                shouldSendToHost = true,
                shouldScheduleDeferredSync = false,
                shouldClearPendingTimer = true,
                shouldUpdateLastSentSignature = true,
                delayMillis = null,
                nextSignature = composerDraftSignature(next),
                stateDescription = "Controlled draft syncs now",
            ),
            deriveComposerDraftSyncDecision(
                controlState = control,
                event = ComposerDraftSyncEventState.Dispose,
                nextDraft = next,
                lastSentSignature = composerDraftSignature(ComposerDraftState(prompt = "host")),
                hasPendingTimer = true,
                syncMode = ComposerDraftSyncModeState.Deferred,
            ),
        )

        assertEquals(
            ComposerDraftSyncDecisionState(
                controlled = false,
                event = ComposerDraftSyncEventState.Update,
                shouldSendToHost = false,
                shouldScheduleDeferredSync = false,
                shouldClearPendingTimer = false,
                shouldUpdateLastSentSignature = false,
                delayMillis = null,
                nextSignature = composerDraftSignature(next),
                stateDescription = "Local draft only",
            ),
            deriveComposerDraftSyncDecision(
                controlState = shellControl,
                event = ComposerDraftSyncEventState.Update,
                nextDraft = next,
                lastSentSignature = "",
                hasPendingTimer = true,
                syncMode = ComposerDraftSyncModeState.Immediate,
            ),
        )
    }

    @Test
    fun buildsChatComposerPromptSlotState() {
        assertEquals(
            ComposerPromptSlotState(
                chatVisible = true,
                shellVisible = false,
                text = "inspect [FILE active.txt]",
                placeholder = "Ask Codex",
                showPlaceholder = false,
                disabled = false,
                canInterrupt = false,
                interruptLabel = "Stop Current Turn",
                sendButtonLabel = "Send",
                sendDisabled = false,
                attachmentChips = listOf(
                    ComposerPromptAttachmentState(
                        label = "active.txt",
                        kind = ComposerAttachmentActionKind.File,
                    ),
                ),
                inputModeLabel = "Prompt",
                promptSegments = listOf(
                    ComposerPromptSegmentState.Text(
                        key = "text-0",
                        text = "inspect ",
                    ),
                    ComposerPromptSegmentState.Attachment(
                        key = "active-8",
                        attachment = ComposerPromptAttachmentState(
                            label = "active.txt",
                            kind = ComposerAttachmentActionKind.File,
                        ),
                        clientId = "active",
                        placeholder = "[FILE active.txt]",
                        tone = ComposerPromptAttachmentTokenTone.File,
                        stateDescription = "File attachment active.txt",
                    ),
                ),
            ),
            buildComposerPromptSlotState(
                prompt = ComposerPromptPreview(
                    text = "inspect [FILE active.txt]",
                    placeholder = "Ask Codex",
                    attachments = listOf(
                        ComposerPromptAttachmentPreview(
                            clientId = "active",
                            kind = ComposerAttachmentKindPreview.File,
                            name = "active.txt",
                            placeholder = "[FILE active.txt]",
                        ),
                        ComposerPromptAttachmentPreview(
                            clientId = "inactive",
                            kind = ComposerAttachmentKindPreview.Photo,
                            name = "inactive.png",
                            placeholder = "[PHOTO inactive.png]",
                        ),
                    ),
                ),
                activeView = ComposerActiveView.Chat,
                actionState = ComposerActionState(
                    primaryLabel = "Send",
                    primaryKind = ComposerPrimaryActionKind.Send,
                    interruptLabel = "Stop Current Turn",
                    showInterrupt = false,
                    sendEnabled = true,
                ),
                busy = false,
                goalBusy = false,
            ),
        )
    }

    @Test
    fun tokenizesComposerPromptAndPrefersLongerAttachmentPlaceholders() {
        val shortAttachment = ComposerPromptAttachmentPreview(
            clientId = "short",
            kind = ComposerAttachmentKindPreview.File,
            name = "a.txt",
            placeholder = "[FILE a]",
        )
        val longAttachment = ComposerPromptAttachmentPreview(
            clientId = "long",
            kind = ComposerAttachmentKindPreview.File,
            name = "a-long.txt",
            placeholder = "[FILE a long]",
        )

        assertEquals(
            listOf(
                ComposerPromptSegmentState.Text(
                    key = "text-0",
                    text = "see ",
                ),
                ComposerPromptSegmentState.Attachment(
                    key = "long-4",
                    attachment = ComposerPromptAttachmentState(
                        label = "a-long.txt",
                        kind = ComposerAttachmentActionKind.File,
                    ),
                    clientId = "long",
                    placeholder = "[FILE a long]",
                    tone = ComposerPromptAttachmentTokenTone.File,
                    stateDescription = "File attachment a-long.txt",
                ),
                ComposerPromptSegmentState.Text(
                    key = "text-1",
                    text = " then ",
                ),
                ComposerPromptSegmentState.Attachment(
                    key = "short-23",
                    attachment = ComposerPromptAttachmentState(
                        label = "a.txt",
                        kind = ComposerAttachmentActionKind.File,
                    ),
                    clientId = "short",
                    placeholder = "[FILE a]",
                    tone = ComposerPromptAttachmentTokenTone.File,
                    stateDescription = "File attachment a.txt",
                ),
            ),
            tokenizeComposerPrompt(
                promptText = "see [FILE a long] then [FILE a]",
                attachments = listOf(shortAttachment, longAttachment),
            ),
        )
    }

    @Test
    fun tokenizesComposerPromptWithInsertedAttachmentFocusMetadata() {
        val segments = tokenizeComposerPrompt(
            promptText = "[PHOTO image.png] [FILE notes.txt] ",
            attachments = listOf(
                ComposerPromptAttachmentPreview(
                    clientId = "drop-1",
                    kind = ComposerAttachmentKindPreview.Photo,
                    name = "image.png",
                    placeholder = "[PHOTO image.png]",
                ),
                ComposerPromptAttachmentPreview(
                    clientId = "drop-2",
                    kind = ComposerAttachmentKindPreview.File,
                    name = "notes.txt",
                    placeholder = "[FILE notes.txt]",
                ),
            ),
            pendingInsertedAttachmentClientIds = listOf("drop-1", "drop-2"),
        )

        assertEquals(
            listOf(
                ComposerPromptSegmentState.Attachment(
                    key = "drop-1-0",
                    attachment = ComposerPromptAttachmentState(
                        label = "image.png",
                        kind = ComposerAttachmentActionKind.Photo,
                    ),
                    clientId = "drop-1",
                    placeholder = "[PHOTO image.png]",
                    tone = ComposerPromptAttachmentTokenTone.Photo,
                    newlyInserted = true,
                    restoresCaretAfterInsert = false,
                    stateDescription = "Photo attachment image.png, newly inserted",
                ),
                ComposerPromptSegmentState.Text(
                    key = "text-0",
                    text = " ",
                ),
                ComposerPromptSegmentState.Attachment(
                    key = "drop-2-18",
                    attachment = ComposerPromptAttachmentState(
                        label = "notes.txt",
                        kind = ComposerAttachmentActionKind.File,
                    ),
                    clientId = "drop-2",
                    placeholder = "[FILE notes.txt]",
                    tone = ComposerPromptAttachmentTokenTone.File,
                    newlyInserted = true,
                    restoresCaretAfterInsert = true,
                    stateDescription = "File attachment notes.txt, newly inserted, caret resumes after this attachment",
                ),
                ComposerPromptSegmentState.Text(
                    key = "text-1",
                    text = " ",
                ),
            ),
            segments,
        )
    }

    @Test
    fun tokenizesComposerPromptAsTextWhenNoAttachmentPlaceholderMatches() {
        assertEquals(
            listOf(
                ComposerPromptSegmentState.Text(
                    key = "text-0",
                    text = "inspect [FILE missing.txt]",
                ),
            ),
            tokenizeComposerPrompt(
                promptText = "inspect [FILE missing.txt]",
                attachments = listOf(
                    ComposerPromptAttachmentPreview(
                        clientId = "other",
                        kind = ComposerAttachmentKindPreview.File,
                        name = "other.txt",
                        placeholder = "[FILE other.txt]",
                    ),
                ),
            ),
        )
        assertEquals(emptyList<ComposerPromptSegmentState>(), tokenizeComposerPrompt("", emptyList()))
    }

    @Test
    fun buildsEmptyChatComposerPromptSlotStateWithPlaceholderAndAllQueuedAttachments() {
        assertEquals(
            ComposerPromptSlotState(
                chatVisible = true,
                shellVisible = false,
                text = "",
                placeholder = "Ask Codex",
                showPlaceholder = true,
                disabled = true,
                canInterrupt = true,
                interruptLabel = "Stop Current Turn",
                sendButtonLabel = "Stop Current Turn",
                sendDisabled = true,
                attachmentChips = listOf(
                    ComposerPromptAttachmentState(
                        label = "capture.png",
                        kind = ComposerAttachmentActionKind.Photo,
                    ),
                    ComposerPromptAttachmentState(
                        label = "report.md",
                        kind = ComposerAttachmentActionKind.File,
                    ),
                ),
                inputModeLabel = "Prompt",
                promptSegments = emptyList(),
            ),
            buildComposerPromptSlotState(
                prompt = ComposerPromptPreview(
                    text = "",
                    placeholder = "Ask Codex",
                    disabled = true,
                    attachments = listOf(
                        ComposerPromptAttachmentPreview(
                            clientId = "photo",
                            kind = ComposerAttachmentKindPreview.Photo,
                            name = "/tmp/capture.png",
                            placeholder = "[PHOTO capture.png]",
                        ),
                        ComposerPromptAttachmentPreview(
                            clientId = "file",
                            kind = ComposerAttachmentKindPreview.File,
                            name = "",
                            placeholder = "[FILE report.md]",
                        ),
                    ),
                ),
                activeView = ComposerActiveView.Chat,
                actionState = ComposerActionState(
                    primaryLabel = "Stop Current Turn",
                    primaryKind = ComposerPrimaryActionKind.Stop,
                    interruptLabel = "Stop Current Turn",
                    showInterrupt = false,
                    sendEnabled = true,
                ),
                busy = false,
                goalBusy = false,
            ),
        )
    }

    @Test
    fun buildsShellComposerPromptSlotState() {
        assertEquals(
            ComposerPromptSlotState(
                chatVisible = false,
                shellVisible = true,
                text = "pnpm test",
                placeholder = "Shell command",
                showPlaceholder = false,
                disabled = false,
                canInterrupt = true,
                interruptLabel = "Send Ctrl-C",
                sendButtonLabel = "Send",
                sendDisabled = true,
                attachmentChips = emptyList(),
                inputModeLabel = "Shell input",
                promptSegments = emptyList(),
            ),
            buildComposerPromptSlotState(
                prompt = ComposerPromptPreview(
                    text = "pnpm test",
                    placeholder = "Shell command",
                    attachments = listOf(
                        ComposerPromptAttachmentPreview(
                            clientId = "ignored",
                            kind = ComposerAttachmentKindPreview.File,
                            name = "ignored.txt",
                            placeholder = "[FILE ignored.txt]",
                        ),
                    ),
                ),
                activeView = ComposerActiveView.Shell,
                actionState = ComposerActionState(
                    primaryLabel = "Send",
                    primaryKind = ComposerPrimaryActionKind.Send,
                    interruptLabel = "Send Ctrl-C",
                    showInterrupt = true,
                    sendEnabled = false,
                ),
                busy = false,
                goalBusy = true,
            ),
        )
    }

    @Test
    fun usesGoalPlaceholderOnlyForChatGoalComposerPromptSlot() {
        val actionState = ComposerActionState(
            primaryLabel = "Set goal",
            primaryKind = ComposerPrimaryActionKind.Send,
            interruptLabel = "Stop Current Turn",
            showInterrupt = false,
            sendEnabled = true,
        )

        assertEquals(
            "Describe the goal the backend should continue working toward...",
            buildComposerPromptSlotState(
                prompt = ComposerPromptPreview(
                    text = "",
                    placeholder = "Ask the backend to inspect code...",
                ),
                activeView = ComposerActiveView.Chat,
                actionState = actionState,
                busy = false,
                goalBusy = false,
                goalComposeMode = true,
            ).placeholder,
        )
        assertEquals(
            "Shell command",
            buildComposerPromptSlotState(
                prompt = ComposerPromptPreview(
                    text = "",
                    placeholder = "Shell command",
                ),
                activeView = ComposerActiveView.Shell,
                actionState = actionState.copy(interruptLabel = "Send Ctrl-C"),
                busy = false,
                goalBusy = false,
                goalComposeMode = true,
            ).placeholder,
        )
    }

    @Test
    fun disablesShellComposerPromptSlotFromActionState() {
        assertEquals(
            true,
            buildComposerPromptSlotState(
                prompt = ComposerPromptPreview(
                    text = "pnpm test",
                    placeholder = "Shell command",
                ),
                activeView = ComposerActiveView.Shell,
                actionState = ComposerActionState(
                    primaryLabel = "Send",
                    primaryKind = ComposerPrimaryActionKind.Send,
                    interruptLabel = "Send Ctrl-C",
                    showInterrupt = true,
                    sendEnabled = false,
                ),
                busy = false,
                goalBusy = false,
            ).sendDisabled,
        )
    }

    @Test
    fun keepsShellComposerSendEnabledWhenPromptDisabled() {
        assertEquals(
            false,
            buildComposerPromptSlotState(
                prompt = ComposerPromptPreview(
                    text = "ls",
                    placeholder = "Shell command",
                    disabled = true,
                ),
                activeView = ComposerActiveView.Shell,
                actionState = ComposerActionState(
                    primaryLabel = "Send",
                    primaryKind = ComposerPrimaryActionKind.Send,
                    interruptLabel = "Send Ctrl-C",
                    showInterrupt = false,
                    sendEnabled = true,
                ),
                busy = false,
                goalBusy = false,
            ).sendDisabled,
        )
    }

    @Test
    fun buildsShellComposerPromptInputState() {
        assertEquals(
            ComposerShellPromptInputState(
                text = "pnpm test",
                placeholder = "Shell command",
                showPlaceholder = false,
                interruptLabel = "Send Ctrl-C",
                interruptEnabled = true,
                sendLabel = "Send",
                sendEnabled = false,
                sendAccessibilityLabel = "Send Shell Input",
                minLines = 2,
            ),
            buildComposerShellPromptInputState(
                ComposerPromptSlotState(
                    chatVisible = false,
                    shellVisible = true,
                    text = "pnpm test",
                    placeholder = "Shell command",
                    showPlaceholder = false,
                    disabled = false,
                    canInterrupt = true,
                    interruptLabel = "Send Ctrl-C",
                    sendButtonLabel = "Send",
                    sendDisabled = true,
                    attachmentChips = emptyList(),
                    inputModeLabel = "Shell input",
                    promptSegments = emptyList(),
                ),
            ),
        )
    }

    @Test
    fun omitsShellComposerPromptInputStateForChatSlot() {
        assertNull(
            buildComposerShellPromptInputState(
                ComposerPromptSlotState(
                    chatVisible = true,
                    shellVisible = false,
                    text = "",
                    placeholder = "Ask Codex",
                    showPlaceholder = true,
                    disabled = false,
                    canInterrupt = false,
                    interruptLabel = "Stop Current Turn",
                    sendButtonLabel = "Send",
                    sendDisabled = false,
                    attachmentChips = emptyList(),
                    inputModeLabel = "Prompt",
                    promptSegments = emptyList(),
                ),
            ),
        )
    }

    @Test
    fun derivesAttachmentDisplayLabels() {
        assertEquals("image.png", attachmentDisplayLabel("/tmp/image.png", "[PHOTO image.png]"))
        assertEquals("report.md", attachmentDisplayLabel("", "[FILE report.md]"))
        assertEquals("attachment", attachmentDisplayLabel("", "[]"))
    }

    @Test
    fun normalizesPromptTextAndAttachmentLabels() {
        assertEquals("hello world", normalizePromptText("hello\u00a0world"))
        assertEquals("bad name", normalizeAttachmentLabel(" [bad]\nname "))
        assertEquals("attachment", normalizeAttachmentLabel(""))
    }

    @Test
    fun allocatesUniqueAttachmentPlaceholders() {
        assertEquals(
            "[FILE report.txt (2)]",
            buildAttachmentPlaceholder(
                kind = ComposerAttachmentActionKind.File,
                name = "report.txt",
                usedPlaceholders = setOf("[FILE report.txt]"),
            ),
        )
        assertEquals(
            "[PHOTO diagram.png]",
            buildAttachmentPlaceholder(
                kind = ComposerAttachmentActionKind.Photo,
                name = "diagram.png",
                usedPlaceholders = setOf("[FILE report.txt]"),
            ),
        )
    }

    @Test
    fun buildsAttachmentInsertionTextWithSurroundingSpacesOnlyWhenNeeded() {
        assertEquals(
            " [FILE a.txt] ",
            buildAttachmentInsertionText(
                basePrompt = "beforeafter",
                selection = ComposerPromptSelectionRange(6, 6),
                placeholders = listOf("[FILE a.txt]"),
            ),
        )
        assertEquals(
            "[FILE a.txt] ",
            buildAttachmentInsertionText(
                basePrompt = "before after",
                selection = ComposerPromptSelectionRange(7, 7),
                placeholders = listOf("[FILE a.txt]"),
            ),
        )
        assertEquals(
            "",
            buildAttachmentInsertionText(
                basePrompt = "before",
                selection = ComposerPromptSelectionRange(2, 2),
                placeholders = emptyList(),
            ),
        )
    }

    @Test
    fun buildsAttachmentInsertionStateAndCaretPosition() {
        assertEquals(
            ComposerAttachmentInsertionState(
                prompt = "see [FILE report.txt] ",
                selection = ComposerPromptSelectionRange(
                    start = "see [FILE report.txt]".length,
                    end = "see [FILE report.txt]".length,
                ),
                insertedPlaceholders = listOf("[FILE report.txt]"),
                insertedAttachments = listOf(
                    ComposerPromptAttachmentPreview(
                        clientId = "new-1",
                        kind = ComposerAttachmentKindPreview.File,
                        name = "report.txt",
                        placeholder = "[FILE report.txt]",
                    ),
                ),
                insertedAttachmentClientIds = listOf("new-1"),
            ),
            buildAttachmentInsertionState(
                prompt = "see this",
                existingAttachments = listOf(
                    ComposerPromptAttachmentPreview(
                        clientId = "existing",
                        kind = ComposerAttachmentKindPreview.File,
                        name = "old.txt",
                        placeholder = "[FILE old.txt]",
                    ),
                ),
                fileNames = listOf("report.txt"),
                kind = ComposerAttachmentActionKind.File,
                selection = ComposerPromptSelectionRange(4, 8),
                buildClientId = { index, _, _ -> "new-${index + 1}" },
            ),
        )
    }

    @Test
    fun buildsAttachmentInsertionStateWithDuplicateSuffixesAtEnd() {
        assertEquals(
            ComposerAttachmentInsertionState(
                prompt = "prompt [PHOTO image.png (2)] [PHOTO image.png (3)] ",
                selection = ComposerPromptSelectionRange(
                    start = "prompt [PHOTO image.png (2)] [PHOTO image.png (3)]".length,
                    end = "prompt [PHOTO image.png (2)] [PHOTO image.png (3)]".length,
                ),
                insertedPlaceholders = listOf("[PHOTO image.png (2)]", "[PHOTO image.png (3)]"),
                insertedAttachments = listOf(
                    ComposerPromptAttachmentPreview(
                        clientId = "photo-1",
                        kind = ComposerAttachmentKindPreview.Photo,
                        name = "image.png",
                        placeholder = "[PHOTO image.png (2)]",
                    ),
                    ComposerPromptAttachmentPreview(
                        clientId = "photo-2",
                        kind = ComposerAttachmentKindPreview.Photo,
                        name = "image.png",
                        placeholder = "[PHOTO image.png (3)]",
                    ),
                ),
                insertedAttachmentClientIds = listOf("photo-1", "photo-2"),
            ),
            buildAttachmentInsertionState(
                prompt = "prompt",
                existingAttachments = listOf(
                    ComposerPromptAttachmentPreview(
                        clientId = "existing",
                        kind = ComposerAttachmentKindPreview.Photo,
                        name = "image.png",
                        placeholder = "[PHOTO image.png]",
                    ),
                ),
                fileNames = listOf("image.png", "image.png"),
                kind = ComposerAttachmentActionKind.Photo,
                selection = null,
                buildClientId = { index, _, _ -> "photo-${index + 1}" },
            ),
        )
    }

    @Test
    fun buildsDroppedAttachmentInsertionStateWithPhotosBeforeFiles() {
        assertEquals(
            ComposerAttachmentInsertionState(
                prompt = "prompt [PHOTO image.png (2)] [FILE notes.txt] ",
                selection = ComposerPromptSelectionRange(
                    start = "prompt [PHOTO image.png (2)] [FILE notes.txt]".length,
                    end = "prompt [PHOTO image.png (2)] [FILE notes.txt]".length,
                ),
                insertedPlaceholders = listOf("[PHOTO image.png (2)]", "[FILE notes.txt]"),
                insertedAttachments = listOf(
                    ComposerPromptAttachmentPreview(
                        clientId = "drop-1",
                        kind = ComposerAttachmentKindPreview.Photo,
                        name = "image.png",
                        placeholder = "[PHOTO image.png (2)]",
                    ),
                    ComposerPromptAttachmentPreview(
                        clientId = "drop-2",
                        kind = ComposerAttachmentKindPreview.File,
                        name = "notes.txt",
                        placeholder = "[FILE notes.txt]",
                    ),
                ),
                insertedAttachmentClientIds = listOf("drop-1", "drop-2"),
            ),
            buildDroppedAttachmentInsertionState(
                prompt = "prompt",
                existingAttachments = listOf(
                    ComposerPromptAttachmentPreview(
                        clientId = "existing",
                        kind = ComposerAttachmentKindPreview.Photo,
                        name = "image.png",
                        placeholder = "[PHOTO image.png]",
                    ),
                ),
                droppedFiles = listOf(
                    "notes.txt" to ComposerAttachmentActionKind.File,
                    "image.png" to ComposerAttachmentActionKind.Photo,
                ),
                selection = null,
                buildClientId = { index, _, _ -> "drop-${index + 1}" },
            ),
        )
    }

    @Test
    fun derivesPromptPasteActionsForFilesTextHtmlAndEmptyInput() {
        assertEquals(
            ComposerPromptPasteActionState(
                kind = ComposerPromptPasteActionKind.AppendFiles,
                preventDefault = true,
                fileCount = 2,
            ),
            derivePromptPasteAction(
                fileCount = 2,
                plainText = "",
                htmlText = "",
                htmlToText = { "" },
            ),
        )
        assertEquals(
            ComposerPromptPasteActionState(
                kind = ComposerPromptPasteActionKind.InsertText,
                preventDefault = true,
                text = "plain",
            ),
            derivePromptPasteAction(
                fileCount = 0,
                plainText = "plain",
                htmlText = "<b>html</b>",
                htmlToText = { "html" },
            ),
        )
        assertEquals(
            ComposerPromptPasteActionState(
                kind = ComposerPromptPasteActionKind.InsertText,
                preventDefault = true,
                text = "html",
            ),
            derivePromptPasteAction(
                fileCount = 0,
                plainText = "",
                htmlText = "<b>html</b>",
                htmlToText = { "html" },
            ),
        )
        assertEquals(
            ComposerPromptPasteActionState(
                kind = ComposerPromptPasteActionKind.Ignore,
                preventDefault = false,
            ),
            derivePromptPasteAction(
                fileCount = 0,
                plainText = "",
                htmlText = "",
                htmlToText = { "" },
            ),
        )
    }

    @Test
    fun derivesPromptFileTransferAndKeyboardActions() {
        assertEquals(
            ComposerPromptFileTransferActionState(
                kind = ComposerPromptFileTransferActionKind.Ignore,
                preventDefault = false,
                activateDragTarget = false,
            ),
            derivePromptFileDragAction(false),
        )
        assertEquals(
            ComposerPromptFileTransferActionState(
                kind = ComposerPromptFileTransferActionKind.AcceptFiles,
                preventDefault = true,
                activateDragTarget = true,
            ),
            derivePromptFileDragAction(true),
        )
        assertEquals(
            ComposerPromptFileTransferActionState(
                kind = ComposerPromptFileTransferActionKind.AcceptFiles,
                preventDefault = true,
                activateDragTarget = true,
                fileCount = 3,
            ),
            derivePromptDropAction(3),
        )
        assertEquals(
            ComposerPromptKeyDownActionState(preventDefault = false, submit = false),
            derivePromptKeyDownAction(
                key = "Enter",
                metaKey = false,
                ctrlKey = false,
                busy = false,
                disabled = false,
            ),
        )
        assertEquals(
            ComposerPromptKeyDownActionState(preventDefault = true, submit = false),
            derivePromptKeyDownAction(
                key = "Enter",
                metaKey = true,
                ctrlKey = false,
                busy = true,
                disabled = false,
            ),
        )
        assertEquals(
            ComposerPromptKeyDownActionState(preventDefault = true, submit = true),
            derivePromptKeyDownAction(
                key = "Enter",
                metaKey = false,
                ctrlKey = true,
                busy = false,
                disabled = false,
            ),
        )
    }

    @Test
    fun buildsTrimmedChatComposerSubmitInputWithActiveAttachmentsOnly() {
        assertEquals(
            ComposerSubmitInputState(
                prompt = "inspect [FILE active.txt]",
                attachments = listOf(
                    ComposerSubmitAttachmentState(
                        clientId = "active",
                        kind = ComposerAttachmentActionKind.File,
                        name = "active.txt",
                        placeholder = "[FILE active.txt]",
                    ),
                ),
            ),
            buildComposerSubmitInputState(
                prompt = ComposerPromptPreview(
                    text = "  inspect [FILE active.txt]  ",
                    attachments = listOf(
                        ComposerPromptAttachmentPreview(
                            clientId = "active",
                            kind = ComposerAttachmentKindPreview.File,
                            name = "active.txt",
                            placeholder = "[FILE active.txt]",
                        ),
                        ComposerPromptAttachmentPreview(
                            clientId = "inactive",
                            kind = ComposerAttachmentKindPreview.Photo,
                            name = "inactive.png",
                            placeholder = "[PHOTO inactive.png]",
                        ),
                    ),
                ),
                activeView = ComposerActiveView.Chat,
            ),
        )
    }

    @Test
    fun omitsChatComposerSubmitAttachmentsWhenNoActiveAttachments() {
        assertEquals(
            ComposerSubmitInputState(prompt = "plain prompt"),
            buildComposerSubmitInputState(
                prompt = ComposerPromptPreview(
                    text = "  plain prompt  ",
                    attachments = listOf(
                        ComposerPromptAttachmentPreview(
                            clientId = "unused",
                            kind = ComposerAttachmentKindPreview.File,
                            name = "unused.txt",
                            placeholder = "[FILE unused.txt]",
                        ),
                    ),
                ),
                activeView = ComposerActiveView.Chat,
            ),
        )
    }

    @Test
    fun returnsNullForEmptyChatComposerSubmitInput() {
        assertNull(
            buildComposerSubmitInputState(
                prompt = ComposerPromptPreview(
                    text = "   ",
                    attachments = listOf(
                        ComposerPromptAttachmentPreview(
                            clientId = "unused",
                            kind = ComposerAttachmentKindPreview.File,
                            name = "unused.txt",
                            placeholder = "[FILE unused.txt]",
                        ),
                    ),
                ),
                activeView = ComposerActiveView.Chat,
            ),
        )
    }

    @Test
    fun preservesShellComposerSubmitInputAndIgnoresAttachments() {
        assertEquals(
            ComposerSubmitInputState(prompt = "  pnpm test  "),
            buildComposerSubmitInputState(
                prompt = ComposerPromptPreview(
                    text = "  pnpm test  ",
                    attachments = listOf(
                        ComposerPromptAttachmentPreview(
                            clientId = "unused",
                            kind = ComposerAttachmentKindPreview.File,
                            name = "unused.txt",
                            placeholder = "[FILE unused.txt]",
                        ),
                    ),
                ),
                activeView = ComposerActiveView.Shell,
            ),
        )
    }

    @Test
    fun buildsChatComposerToolbarState() {
        assertEquals(
            ComposerToolbarState(
                slashButton = ComposerToolbarButtonState(
                    visible = true,
                    selected = true,
                    enabled = true,
                    label = "Close slash toolbox",
                ),
                attachmentButton = ComposerToolbarButtonState(
                    visible = true,
                    selected = false,
                    enabled = true,
                    label = "Add attachment",
                ),
                shellToolsButton = ComposerToolbarButtonState(
                    visible = false,
                    selected = false,
                    enabled = false,
                    label = "Open shell tools",
                ),
                modelButton = ComposerToolbarButtonState(
                    visible = true,
                    selected = false,
                    enabled = true,
                    label = "gpt-test",
                ),
                effortButton = ComposerToolbarButtonState(
                    visible = true,
                    selected = false,
                    enabled = true,
                    label = "Medium",
                ),
                viewToggleButton = ComposerToolbarButtonState(
                    visible = true,
                    selected = false,
                    enabled = true,
                    label = "Switch to shell",
                ),
                shellPromptLabel = null,
            ),
            buildComposerToolbarState(
                activeView = ComposerActiveView.Chat,
                openMenu = ComposerToolbarMenuState.Slash,
                settingsState = ComposerSettingsState(
                    modelLabel = "gpt-test",
                    modelEnabled = true,
                    effortLabel = "Medium",
                    effortEnabled = true,
                    effortTitle = "Select reasoning effort",
                    planVisible = true,
                    planSelected = false,
                ),
                canToggleShellView = true,
                shellPromptLabel = "ignored shell prompt",
            ),
        )
    }

    @Test
    fun buildsShellComposerToolbarState() {
        assertEquals(
            ComposerToolbarState(
                slashButton = ComposerToolbarButtonState(
                    visible = false,
                    selected = false,
                    enabled = false,
                    label = "Open slash toolbox",
                ),
                attachmentButton = ComposerToolbarButtonState(
                    visible = false,
                    selected = false,
                    enabled = false,
                    label = "Add attachment",
                ),
                shellToolsButton = ComposerToolbarButtonState(
                    visible = true,
                    selected = true,
                    enabled = true,
                    label = "Close shell tools",
                ),
                modelButton = ComposerToolbarButtonState(
                    visible = false,
                    selected = false,
                    enabled = false,
                    label = "gpt-test",
                ),
                effortButton = ComposerToolbarButtonState(
                    visible = false,
                    selected = false,
                    enabled = false,
                    label = "Auto",
                ),
                viewToggleButton = ComposerToolbarButtonState(
                    visible = true,
                    selected = true,
                    enabled = true,
                    label = "Switch to chat",
                ),
                shellPromptLabel = "pnpm test",
            ),
            buildComposerToolbarState(
                activeView = ComposerActiveView.Shell,
                openMenu = ComposerToolbarMenuState.ShellTools,
                settingsState = ComposerSettingsState(
                    modelLabel = "gpt-test",
                    modelEnabled = false,
                    effortLabel = "Auto",
                    effortEnabled = false,
                    effortTitle = "The selected model does not expose adjustable reasoning effort.",
                    planVisible = false,
                    planSelected = false,
                ),
                canToggleShellView = true,
                shellPromptLabel = "pnpm test",
            ),
        )
    }

    @Test
    fun buildsEnabledComposerShellTools() {
        assertEquals(
            listOf(
                ComposerShellToolState("PASTE", ComposerShellToolKind.Paste, ComposerShellToolTone.Neutral, true),
                ComposerShellToolState("COPY", ComposerShellToolKind.Copy, ComposerShellToolTone.Neutral, true),
                ComposerShellToolState("CLEAR", ComposerShellToolKind.Clear, ComposerShellToolTone.Info, true),
                ComposerShellToolState("CTRL-C", ComposerShellToolKind.CtrlC, ComposerShellToolTone.Danger, true),
                ComposerShellToolState("CTRL-D", ComposerShellToolKind.CtrlD, ComposerShellToolTone.Neutral, true),
                ComposerShellToolState("ESC", ComposerShellToolKind.Esc, ComposerShellToolTone.Neutral, true),
                ComposerShellToolState("TAB", ComposerShellToolKind.Tab, ComposerShellToolTone.Neutral, true),
                ComposerShellToolState("UP", ComposerShellToolKind.Up, ComposerShellToolTone.Neutral, true),
                ComposerShellToolState("DOWN", ComposerShellToolKind.Down, ComposerShellToolTone.Neutral, true),
            ),
            buildComposerShellTools(
                busy = false,
                shellControl = ComposerShellControlPreview(shellInputEnabled = true, commandRunning = true),
            ),
        )
    }

    @Test
    fun disablesComposerShellToolsFromBusyAndShellInputState() {
        val tools = buildComposerShellTools(
            busy = true,
            shellControl = ComposerShellControlPreview(shellInputEnabled = false, commandRunning = true),
        ).associateBy { it.kind }

        assertEquals(true, tools.getValue(ComposerShellToolKind.Paste).enabled)
        assertEquals(true, tools.getValue(ComposerShellToolKind.Copy).enabled)
        assertEquals(false, tools.getValue(ComposerShellToolKind.Clear).enabled)
        assertEquals(false, tools.getValue(ComposerShellToolKind.CtrlC).enabled)
        assertEquals(false, tools.getValue(ComposerShellToolKind.CtrlD).enabled)
        assertEquals(false, tools.getValue(ComposerShellToolKind.Esc).enabled)
        assertEquals(false, tools.getValue(ComposerShellToolKind.Tab).enabled)
        assertEquals(false, tools.getValue(ComposerShellToolKind.Up).enabled)
        assertEquals(false, tools.getValue(ComposerShellToolKind.Down).enabled)
    }

    @Test
    fun disablesCtrlCWhenNoCommandIsRunning() {
        val tools = buildComposerShellTools(
            busy = false,
            shellControl = ComposerShellControlPreview(shellInputEnabled = true, commandRunning = false),
        ).associateBy { it.kind }

        assertEquals(false, tools.getValue(ComposerShellToolKind.CtrlC).enabled)
        assertEquals(true, tools.getValue(ComposerShellToolKind.CtrlD).enabled)
    }

    @Test
    fun buildsComposerShellToolsPanelStateGroups() {
        val tools = buildComposerShellTools(
            busy = false,
            shellControl = ComposerShellControlPreview(shellInputEnabled = true, commandRunning = true),
        )

        assertEquals(
            ComposerShellToolsPanelState(
                menuVisible = true,
                title = "Shell tools",
                subtitle = "2 clipboard · 7 controls",
                columnCount = 2,
                clipboardTools = tools.take(2),
                controlTools = tools.drop(2),
                tools = tools,
            ),
            buildComposerShellToolsPanelState(
                open = true,
                tools = tools,
            ),
        )
    }

    @Test
    fun buildsIdleComposerForkPanelState() {
        assertEquals(
            ComposerForkPanelState(
                actions = listOf(
                    ComposerForkActionState(
                        label = "Fork from latest",
                        status = "Run",
                        enabled = true,
                        kind = ComposerForkActionKind.Latest,
                        startsBusy = true,
                        closesMenuOnSuccess = true,
                        closesMenuOnFailure = false,
                    ),
                    ComposerForkActionState(
                        label = "Fork from selected turn",
                        status = "Pick",
                        enabled = true,
                        kind = ComposerForkActionKind.SelectedTurn,
                        startsBusy = true,
                        closesMenuOnSuccess = true,
                        closesMenuOnFailure = false,
                    ),
                ),
                showIdleOnlyNotice = false,
                notice = null,
                turnPicker = defaultComposerForkTurnPickerState(),
            ),
            buildComposerForkPanelState(
                busy = false,
                forkBusy = false,
            ),
        )
    }

    @Test
    fun disablesComposerForkPanelActionsWhileBusy() {
        assertEquals(
            ComposerForkPanelState(
                actions = listOf(
                    ComposerForkActionState(
                        label = "Fork from latest",
                        status = "Run",
                        enabled = false,
                        kind = ComposerForkActionKind.Latest,
                        startsBusy = false,
                        closesMenuOnSuccess = true,
                        closesMenuOnFailure = false,
                    ),
                    ComposerForkActionState(
                        label = "Fork from selected turn",
                        status = "Pick",
                        enabled = false,
                        kind = ComposerForkActionKind.SelectedTurn,
                        startsBusy = false,
                        closesMenuOnSuccess = true,
                        closesMenuOnFailure = false,
                    ),
                ),
                showIdleOnlyNotice = true,
                notice = "Fork is only available while the thread is idle.",
                turnPicker = defaultComposerForkTurnPickerState(),
            ),
            buildComposerForkPanelState(
                busy = true,
                forkBusy = false,
            ),
        )
    }

    @Test
    fun marksComposerForkLatestActionWhileForking() {
        assertEquals(
            listOf(
                ComposerForkActionState(
                    label = "Fork from latest",
                    status = "Forking",
                    enabled = false,
                    kind = ComposerForkActionKind.Latest,
                    startsBusy = false,
                    closesMenuOnSuccess = true,
                    closesMenuOnFailure = false,
                ),
                ComposerForkActionState(
                    label = "Fork from selected turn",
                    status = "Pick",
                    enabled = false,
                    kind = ComposerForkActionKind.SelectedTurn,
                    startsBusy = false,
                    closesMenuOnSuccess = true,
                    closesMenuOnFailure = false,
                ),
            ),
            buildComposerForkPanelState(
                busy = false,
                forkBusy = true,
            ).actions,
        )
    }

    @Test
    fun buildsComposerForkActionLifecycleRules() {
        val state = buildComposerForkPanelState(
            busy = false,
            forkBusy = false,
            slashPanelView = ComposerSlashPanelViewPreview.Fork,
        )

        assertEquals(
            ComposerForkActionState(
                label = "Fork from latest",
                status = "Run",
                enabled = true,
                kind = ComposerForkActionKind.Latest,
                startsBusy = true,
                closesMenuOnSuccess = true,
                closesMenuOnFailure = false,
            ),
            state.actions.first(),
        )
        assertEquals(
            ComposerForkLifecycleState(
                forkBusy = false,
                shouldClearBusyWhenLeavingForkTurns = false,
                busyWhileRunning = true,
                closeMenuOnSuccess = true,
                closeMenuOnFailure = false,
            ),
            state.lifecycle,
        )
    }

    @Test
    fun clearsComposerForkBusyWhenLeavingForkTurnsPanel() {
        assertEquals(
            ComposerForkLifecycleState(
                forkBusy = true,
                shouldClearBusyWhenLeavingForkTurns = true,
                busyWhileRunning = true,
                closeMenuOnSuccess = true,
                closeMenuOnFailure = false,
            ),
            buildComposerForkLifecycleState(
                forkBusy = true,
                slashPanelView = ComposerSlashPanelViewPreview.Root,
            ),
        )
        assertEquals(
            ComposerForkLifecycleState(
                forkBusy = true,
                shouldClearBusyWhenLeavingForkTurns = false,
                busyWhileRunning = true,
                closeMenuOnSuccess = true,
                closeMenuOnFailure = false,
            ),
            buildComposerForkLifecycleState(
                forkBusy = true,
                slashPanelView = ComposerSlashPanelViewPreview.ForkTurns,
            ),
        )
    }

    @Test
    fun buildsComposerForkTurnPickerRows() {
        assertEquals(
            ComposerForkTurnPickerState(
                loadingMessage = null,
                errorMessage = null,
                rows = listOf(
                    ComposerForkTurnPickerRowState(
                        turnId = "turn-7",
                        title = "Turn 7",
                        status = "completed",
                        enabled = true,
                    ),
                ),
                emptyMessage = null,
            ),
            buildComposerForkTurnPickerState(
                options = ComposerForkTurnOptionsPreview(
                    status = ComposerPanelLoadStatusPreview.Ready,
                    error = null,
                    turns = listOf(
                        ComposerForkTurnOptionPreview(
                            turnId = "turn-7",
                            turnIndex = 7,
                            status = "completed",
                        ),
                    ),
                ),
                forkBusy = false,
            ),
        )
    }

    @Test
    fun buildsComposerForkTurnPickerLoadingErrorEmptyAndBusyStates() {
        assertEquals(
            "Loading turns...",
            buildComposerForkTurnPickerState(
                options = ComposerForkTurnOptionsPreview(
                    status = ComposerPanelLoadStatusPreview.Loading,
                    turns = emptyList(),
                ),
                forkBusy = false,
            ).loadingMessage,
        )
        assertEquals(
            "Could not load turns",
            buildComposerForkTurnPickerState(
                options = ComposerForkTurnOptionsPreview(
                    status = ComposerPanelLoadStatusPreview.Failed,
                    error = "Could not load turns",
                    turns = emptyList(),
                ),
                forkBusy = false,
            ).errorMessage,
        )
        assertEquals(
            "No turns available to fork yet.",
            buildComposerForkTurnPickerState(
                options = ComposerForkTurnOptionsPreview(
                    status = ComposerPanelLoadStatusPreview.Ready,
                    error = null,
                    turns = emptyList(),
                ),
                forkBusy = false,
            ).emptyMessage,
        )
        assertEquals(
            ComposerForkTurnPickerRowState(
                turnId = "turn-8",
                title = "Turn 8",
                status = "Forking",
                enabled = false,
            ),
            buildComposerForkTurnPickerState(
                options = ComposerForkTurnOptionsPreview(
                    status = ComposerPanelLoadStatusPreview.Ready,
                    turns = listOf(
                        ComposerForkTurnOptionPreview(
                            turnId = "turn-8",
                            turnIndex = 8,
                            status = "completed",
                        ),
                    ),
                ),
                forkBusy = true,
            ).rows.single(),
        )
    }

    private fun defaultComposerForkTurnPickerState(): ComposerForkTurnPickerState {
        return ComposerForkTurnPickerState(
            loadingMessage = null,
            errorMessage = null,
            rows = listOf(
                ComposerForkTurnPickerRowState(
                    turnId = "turn-12",
                    title = "Turn 12",
                    status = "completed",
                    enabled = true,
                ),
                ComposerForkTurnPickerRowState(
                    turnId = "turn-11",
                    title = "Turn 11",
                    status = "interrupted",
                    enabled = true,
                ),
                ComposerForkTurnPickerRowState(
                    turnId = "turn-10",
                    title = "Turn 10",
                    status = "failed",
                    enabled = true,
                ),
            ),
            emptyMessage = null,
        )
    }

    @Test
    fun buildsComposerSkillsPanelRows() {
        assertEquals(
            ComposerSkillsPanelState(
                loadingMessage = null,
                errorMessage = null,
                skills = listOf(
                    ComposerSkillRowState(
                        displayName = "Code Reviewer",
                        scopeLabel = "Repo",
                        invokeName = "\$reviewer",
                        copyLabel = "Copied \$reviewer",
                        copyAccessibilityLabel = "Copy \$reviewer",
                        copyTitle = "Copy \$reviewer",
                        description = "Review changed code",
                        copied = true,
                        enabled = true,
                    ),
                    ComposerSkillRowState(
                        displayName = "docs",
                        scopeLabel = "User",
                        invokeName = "\$docs",
                        copyLabel = "\$docs",
                        copyAccessibilityLabel = "Copy \$docs",
                        copyTitle = "Copy \$docs",
                        description = "Read docs quickly",
                        copied = false,
                        enabled = false,
                    ),
                ),
                errors = emptyList(),
                emptyMessage = null,
                copyLifecycle = ComposerSkillsCopyLifecycleState(
                    copiedSkillName = "reviewer",
                    copiedInvokeName = "\$reviewer",
                    clipboardText = "\$reviewer",
                    shouldClearCopiedState = true,
                    clearDelayMillis = 1_400L,
                ),
            ),
            buildComposerSkillsPanelState(
                ComposerSkillsPanelPreview(
                    status = ComposerPanelLoadStatusPreview.Ready,
                    error = null,
                    skills = listOf(
                        ComposerSkillPreview(
                            name = "reviewer",
                            displayName = "Code Reviewer",
                            scope = ComposerSkillScopePreview.Repo,
                            description = "Review code",
                            shortDescription = "Review code succinctly",
                            interfaceShortDescription = "Review changed code",
                            path = "/skills/reviewer/SKILL.md",
                        ),
                        ComposerSkillPreview(
                            name = "docs",
                            displayName = "",
                            scope = ComposerSkillScopePreview.User,
                            description = "Read docs in detail",
                            shortDescription = "Read docs quickly",
                            interfaceShortDescription = "",
                            path = "/skills/docs/SKILL.md",
                            enabled = false,
                        ),
                    ),
                    errors = emptyList(),
                    copiedSkillName = "reviewer",
                ),
            ),
        )
    }

    @Test
    fun buildsComposerSkillsPanelLoadingEmptyAndErrorStates() {
        assertEquals(
            "Loading skills...",
            buildComposerSkillsPanelState(
                ComposerSkillsPanelPreview(
                    status = ComposerPanelLoadStatusPreview.Loading,
                    skills = emptyList(),
                    errors = emptyList(),
                    copiedSkillName = null,
                ),
            ).loadingMessage,
        )

        assertEquals(
            "No skills available right now.",
            buildComposerSkillsPanelState(
                ComposerSkillsPanelPreview(
                    status = ComposerPanelLoadStatusPreview.Ready,
                    skills = emptyList(),
                    errors = emptyList(),
                    copiedSkillName = null,
                ),
            ).emptyMessage,
        )

        assertEquals(
            ComposerSkillsPanelState(
                loadingMessage = null,
                errorMessage = "Unable to load skills",
                skills = emptyList(),
                errors = listOf(
                    ComposerSkillErrorState(
                        message = "Invalid front matter",
                        path = "/broken/SKILL.md",
                    ),
                ),
                emptyMessage = null,
                copyLifecycle = emptyComposerSkillsCopyLifecycleState(),
            ),
            buildComposerSkillsPanelState(
                ComposerSkillsPanelPreview(
                    status = ComposerPanelLoadStatusPreview.Failed,
                    error = "Unable to load skills",
                    skills = emptyList(),
                    errors = listOf(
                        ComposerSkillErrorPreview(
                            path = "/broken/SKILL.md",
                            message = "Invalid front matter",
                        ),
                    ),
                    copiedSkillName = null,
                ),
            ),
        )
    }

    @Test
    fun buildsComposerSkillsCopyLifecycleState() {
        assertEquals(
            ComposerSkillsCopyLifecycleState(
                copiedSkillName = "reviewer",
                copiedInvokeName = "\$reviewer",
                clipboardText = "\$reviewer",
                shouldClearCopiedState = true,
                clearDelayMillis = 1_400L,
            ),
            buildComposerSkillsCopyLifecycleState("reviewer"),
        )
        assertEquals(
            emptyComposerSkillsCopyLifecycleState(),
            buildComposerSkillsCopyLifecycleState(" "),
        )
    }

    private fun emptyComposerSkillsCopyLifecycleState(): ComposerSkillsCopyLifecycleState {
        return ComposerSkillsCopyLifecycleState(
            copiedSkillName = null,
            copiedInvokeName = null,
            clipboardText = null,
            shouldClearCopiedState = false,
            clearDelayMillis = 1_400L,
        )
    }

    @Test
    fun labelsComposerSkillScopes() {
        assertEquals("Repo", skillScopeLabel(ComposerSkillScopePreview.Repo))
        assertEquals("System", skillScopeLabel(ComposerSkillScopePreview.System))
        assertEquals("Admin", skillScopeLabel(ComposerSkillScopePreview.Admin))
        assertEquals("User", skillScopeLabel(ComposerSkillScopePreview.User))
    }

    @Test
    fun buildsComposerMcpListPanelState() {
        assertEquals(
            ComposerMcpPanelState(
                configSourceTitle = "MCP config source",
                configSourceLabel = "/repo/.codex/config.toml",
                showAddAction = true,
                mode = ComposerMcpPanelModePreview.List,
                statusMessages = emptyList(),
                addOptions = emptyList(),
                servers = listOf(
                    ComposerMcpServerRowState(
                        name = "docs",
                        countsLabel = "5 tools · 2 resources · 1 templates",
                        authLabel = "Public",
                        toolPreview = "Search Docs · Fetch Docs · openapi · endpoints",
                    ),
                ),
                form = null,
                emptyMessage = null,
                lifecycle = ComposerMcpPanelLifecycleState(
                    configEditingAvailable = true,
                    configBusy = false,
                    addTargetMode = ComposerMcpPanelModePreview.Add,
                    clearsConfigStatusOnAdd = true,
                    backTargetMode = null,
                    stateDescription = "MCP panel: list, editing available",
                ),
            ),
            buildComposerMcpPanelState(
                ComposerMcpPanelPreview(
                    mode = ComposerMcpPanelModePreview.List,
                    status = ComposerPanelLoadStatusPreview.Ready,
                    configPath = "/repo/.codex/config.toml",
                    configEditing = true,
                    servers = listOf(
                        ComposerMcpServerPreview(
                            name = "docs",
                            authStatus = ComposerMcpAuthStatusPreview.Unsupported,
                            tools = listOf(
                                ComposerMcpToolPreview(name = "search", title = "Search Docs"),
                                ComposerMcpToolPreview(name = "fetch", title = "Fetch Docs"),
                                ComposerMcpToolPreview(name = "openapi", title = null),
                                ComposerMcpToolPreview(name = "endpoints", title = ""),
                                ComposerMcpToolPreview(name = "extra", title = "Extra"),
                            ),
                            resourceCount = 2,
                            resourceTemplateCount = 1,
                        ),
                    ),
                ),
            ),
        )
    }

    @Test
    fun buildsComposerMcpAddChoices() {
        assertEquals(
            listOf(
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
            ),
            buildComposerMcpPanelState(
                ComposerMcpPanelPreview(
                    mode = ComposerMcpPanelModePreview.Add,
                    servers = emptyList(),
                ),
            ).addOptions,
        )
    }

    @Test
    fun buildsComposerMcpHttpAndStdioForms() {
        assertEquals(
            ComposerMcpFormState(
                title = "HTTP MCP",
                primaryLabel = "Write HTTP MCP",
                primaryEnabled = true,
                fields = listOf(
                    "MCP name" to "docs",
                    "URL" to "https://example.test/mcp",
                ),
                backTargetMode = ComposerMcpPanelModePreview.Add,
                configBusy = false,
            ),
            buildComposerMcpPanelState(
                ComposerMcpPanelPreview(
                    mode = ComposerMcpPanelModePreview.Http,
                    httpName = "docs",
                    httpUrl = "https://example.test/mcp",
                    configBusy = false,
                    servers = emptyList(),
                ),
            ).form,
        )

        assertEquals(
            ComposerMcpFormState(
                title = "MCP block for provider config",
                primaryLabel = "Saving...",
                primaryEnabled = false,
                fields = listOf(
                    "MCP block for provider config" to "[mcp_servers.docs]",
                ),
                backTargetMode = ComposerMcpPanelModePreview.Add,
                configBusy = true,
            ),
            buildComposerMcpPanelState(
                ComposerMcpPanelPreview(
                    mode = ComposerMcpPanelModePreview.Stdio,
                    rawBlock = "[mcp_servers.docs]",
                    configBusy = true,
                    servers = emptyList(),
                ),
            ).form,
        )
    }

    @Test
    fun buildsComposerMcpLifecycleForAddAndFormModes() {
        assertEquals(
            ComposerMcpPanelLifecycleState(
                configEditingAvailable = true,
                configBusy = false,
                addTargetMode = ComposerMcpPanelModePreview.Add,
                clearsConfigStatusOnAdd = true,
                backTargetMode = null,
                stateDescription = "MCP panel: list, editing available",
            ),
            buildComposerMcpPanelState(
                ComposerMcpPanelPreview(
                    mode = ComposerMcpPanelModePreview.List,
                    configEditing = true,
                    configBusy = false,
                ),
            ).lifecycle,
        )

        assertEquals(
            ComposerMcpPanelLifecycleState(
                configEditingAvailable = false,
                configBusy = false,
                addTargetMode = null,
                clearsConfigStatusOnAdd = false,
                backTargetMode = null,
                stateDescription = "MCP panel: list, editing unavailable",
            ),
            buildComposerMcpPanelState(
                ComposerMcpPanelPreview(
                    mode = ComposerMcpPanelModePreview.List,
                    configEditing = false,
                    configBusy = false,
                    servers = emptyList(),
                ),
            ).lifecycle,
        )

        assertEquals(
            ComposerMcpPanelLifecycleState(
                configEditingAvailable = true,
                configBusy = true,
                addTargetMode = null,
                clearsConfigStatusOnAdd = false,
                backTargetMode = ComposerMcpPanelModePreview.Add,
                stateDescription = "MCP panel: HTTP form, editing available, saving",
            ),
            buildComposerMcpPanelState(
                ComposerMcpPanelPreview(
                    mode = ComposerMcpPanelModePreview.Http,
                    configEditing = true,
                    configBusy = true,
                    servers = emptyList(),
                ),
            ).lifecycle,
        )

        assertEquals(
            ComposerMcpPanelLifecycleState(
                configEditingAvailable = true,
                configBusy = false,
                addTargetMode = null,
                clearsConfigStatusOnAdd = false,
                backTargetMode = ComposerMcpPanelModePreview.Add,
                stateDescription = "MCP panel: stdio form, editing available",
            ),
            buildComposerMcpPanelState(
                ComposerMcpPanelPreview(
                    mode = ComposerMcpPanelModePreview.Stdio,
                    configEditing = true,
                    configBusy = false,
                    servers = emptyList(),
                ),
            ).lifecycle,
        )
    }

    @Test
    fun buildsComposerMcpStatusMessagesAndEmptyState() {
        assertEquals(
            listOf(
                ComposerMcpStatusMessageState("Loading MCP servers...", ComposerMcpStatusTone.Neutral),
                ComposerMcpStatusMessageState("Unable to load MCP", ComposerMcpStatusTone.Error),
                ComposerMcpStatusMessageState("Invalid provider config", ComposerMcpStatusTone.Error),
                ComposerMcpStatusMessageState("MCP config updated", ComposerMcpStatusTone.Success),
            ),
            buildComposerMcpPanelState(
                ComposerMcpPanelPreview(
                    mode = ComposerMcpPanelModePreview.List,
                    status = ComposerPanelLoadStatusPreview.Loading,
                    error = "Unable to load MCP",
                    configError = "Invalid provider config",
                    configSuccess = "MCP config updated",
                    servers = emptyList(),
                ),
            ).statusMessages,
        )

        assertEquals(
            "No MCP servers available right now.",
            buildComposerMcpPanelState(
                ComposerMcpPanelPreview(
                    mode = ComposerMcpPanelModePreview.List,
                    status = ComposerPanelLoadStatusPreview.Ready,
                    error = null,
                    configPath = null,
                    configEditing = false,
                    servers = emptyList(),
                ),
            ).emptyMessage,
        )
    }

    @Test
    fun labelsComposerMcpAuthStatuses() {
        assertEquals("Public", authStatusLabel(ComposerMcpAuthStatusPreview.Unsupported))
        assertEquals("Login", authStatusLabel(ComposerMcpAuthStatusPreview.NotLoggedIn))
        assertEquals("Token", authStatusLabel(ComposerMcpAuthStatusPreview.BearerToken))
        assertEquals("OAuth", authStatusLabel(ComposerMcpAuthStatusPreview.OAuth))
    }

    @Test
    fun buildsComposerHooksListPanelState() {
        assertEquals(
            ComposerHooksPanelState(
                configSourceTitle = "Hook config sources",
                configSourceLabel = "/repo/.codex/hooks.json",
                showAddAction = true,
                mode = ComposerHooksPanelModePreview.List,
                statusMessages = listOf(
                    ComposerHookStatusMessageState("Project hook changed", ComposerMcpStatusTone.Neutral),
                ),
                form = null,
                hooks = listOf(
                    ComposerHookRowState(
                        title = "PreToolUse · Bash",
                        commandLabel = "scripts/check-command.sh",
                        statusMessage = "Checking shell command",
                        editAction = ComposerHookActionState(
                            label = "Edit",
                            enabled = true,
                            kind = ComposerHookActionKind.Edit,
                            clearsConfigStatus = true,
                        ),
                        trustAction = ComposerHookActionState(
                            label = "Trust",
                            enabled = true,
                            kind = ComposerHookActionKind.Trust,
                            clearsConfigStatus = true,
                        ),
                        trustLabel = "Modified",
                        sourceLabel = "Project",
                        enabledLabel = "Enabled",
                        timeoutLabel = "30s",
                    ),
                    ComposerHookRowState(
                        title = "UserPromptSubmit",
                        commandLabel = "scripts/log-prompt.sh",
                        statusMessage = null,
                        editAction = ComposerHookActionState(
                            label = "Edit",
                            enabled = true,
                            kind = ComposerHookActionKind.Edit,
                            clearsConfigStatus = true,
                        ),
                        trustAction = ComposerHookActionState(
                            label = "Untrust",
                            enabled = true,
                            kind = ComposerHookActionKind.Untrust,
                            clearsConfigStatus = true,
                        ),
                        trustLabel = "Trusted",
                        sourceLabel = "User",
                        enabledLabel = "Disabled",
                        timeoutLabel = "10s",
                    ),
                ),
                emptyMessage = null,
                lifecycle = ComposerHooksPanelLifecycleState(
                    hostConfigFilesAvailable = true,
                    hookTrustAvailable = true,
                    configBusy = false,
                    addTargetMode = ComposerHooksPanelModePreview.Add,
                    resetsFormOnAdd = true,
                    clearsConfigStatusOnAdd = true,
                    backTargetMode = null,
                    clearsEditingTargetOnBack = false,
                    stateDescription = "Hooks panel: list, editing available, trust available",
                ),
            ),
            buildComposerHooksPanelState(
                ComposerHooksPanelPreview(
                    mode = ComposerHooksPanelModePreview.List,
                    status = ComposerPanelLoadStatusPreview.Ready,
                    projectHooksPath = "/repo/.codex/hooks.json",
                    hostConfigFilesAvailable = true,
                    hookTrustAvailable = true,
                    configBusy = false,
                    warnings = listOf("Project hook changed"),
                    errors = emptyList(),
                    hooks = listOf(
                        ComposerHookPreview(
                            key = "one",
                            eventName = ComposerHookEventNamePreview.PreToolUse,
                            handlerType = ComposerHookHandlerTypePreview.Command,
                            matcher = "Bash",
                            command = "scripts/check-command.sh",
                            timeoutSec = 30,
                            statusMessage = "Checking shell command",
                            source = ComposerHookSourcePreview.Project,
                            enabled = true,
                            isManaged = false,
                            currentHash = "hash",
                            trustStatus = ComposerHookTrustStatusPreview.Modified,
                        ),
                        ComposerHookPreview(
                            key = "two",
                            eventName = ComposerHookEventNamePreview.UserPromptSubmit,
                            handlerType = ComposerHookHandlerTypePreview.Command,
                            matcher = null,
                            command = "scripts/log-prompt.sh",
                            timeoutSec = 10,
                            statusMessage = null,
                            source = ComposerHookSourcePreview.User,
                            enabled = false,
                            isManaged = false,
                            currentHash = "hash",
                            trustStatus = ComposerHookTrustStatusPreview.Trusted,
                        ),
                    ),
                ),
            ),
        )
    }

    @Test
    fun buildsComposerHooksAddAndEditForms() {
        assertEquals(
            ComposerHookFormState(
                editingLabel = null,
                primaryLabel = "Write Hook",
                primaryEnabled = true,
                fields = listOf(
                    "Scope" to "Project",
                    "Event" to "PreToolUse",
                    "Matcher" to "Bash",
                    "Command" to "scripts/check-command.sh",
                    "Timeout" to "30s",
                    "Status" to "Checking shell command",
                ),
                backTargetMode = ComposerHooksPanelModePreview.List,
                clearsEditingTargetOnBack = true,
                configBusy = false,
            ),
            buildComposerHooksPanelState(
                ComposerHooksPanelPreview(
                    mode = ComposerHooksPanelModePreview.Add,
                    configBusy = false,
                    hooks = emptyList(),
                    warnings = emptyList(),
                    errors = emptyList(),
                ),
            ).form,
        )

        assertEquals(
            ComposerHookFormState(
                editingLabel = "Editing PostToolUse in global hooks.json",
                primaryLabel = "Saving...",
                primaryEnabled = false,
                fields = listOf(
                    "Scope" to "Global",
                    "Event" to "PostToolUse",
                    "Matcher" to "Write",
                    "Command" to "scripts/post-write.sh",
                    "Timeout" to "12s",
                    "Status" to "Post write check",
                ),
                backTargetMode = ComposerHooksPanelModePreview.List,
                clearsEditingTargetOnBack = true,
                configBusy = true,
            ),
            buildComposerHooksPanelState(
                ComposerHooksPanelPreview(
                    mode = ComposerHooksPanelModePreview.Edit,
                    configBusy = true,
                    hooks = emptyList(),
                    warnings = emptyList(),
                    errors = emptyList(),
                    form = ComposerHookFormPreview(
                        scope = ComposerHookScopePreview.Global,
                        eventName = ComposerHookEventNamePreview.PostToolUse,
                        matcher = "Write",
                        command = "scripts/post-write.sh",
                        timeoutSec = "12",
                        statusMessage = "Post write check",
                        editingScope = ComposerHookScopePreview.Global,
                        editingEventName = ComposerHookEventNamePreview.PostToolUse,
                    ),
                ),
            ).form,
        )
    }

    @Test
    fun buildsComposerHooksLifecycleForListAndFormModes() {
        assertEquals(
            ComposerHooksPanelLifecycleState(
                hostConfigFilesAvailable = true,
                hookTrustAvailable = true,
                configBusy = false,
                addTargetMode = ComposerHooksPanelModePreview.Add,
                resetsFormOnAdd = true,
                clearsConfigStatusOnAdd = true,
                backTargetMode = null,
                clearsEditingTargetOnBack = false,
                stateDescription = "Hooks panel: list, editing available, trust available",
            ),
            buildComposerHooksPanelState(
                ComposerHooksPanelPreview(
                    mode = ComposerHooksPanelModePreview.List,
                    hostConfigFilesAvailable = true,
                    hookTrustAvailable = true,
                    configBusy = false,
                    hooks = emptyList(),
                    warnings = emptyList(),
                    errors = emptyList(),
                ),
            ).lifecycle,
        )

        assertEquals(
            ComposerHooksPanelLifecycleState(
                hostConfigFilesAvailable = false,
                hookTrustAvailable = false,
                configBusy = false,
                addTargetMode = null,
                resetsFormOnAdd = false,
                clearsConfigStatusOnAdd = false,
                backTargetMode = null,
                clearsEditingTargetOnBack = false,
                stateDescription = "Hooks panel: list, editing unavailable, trust unavailable",
            ),
            buildComposerHooksPanelState(
                ComposerHooksPanelPreview(
                    mode = ComposerHooksPanelModePreview.List,
                    hostConfigFilesAvailable = false,
                    hookTrustAvailable = false,
                    configBusy = false,
                    hooks = emptyList(),
                    warnings = emptyList(),
                    errors = emptyList(),
                ),
            ).lifecycle,
        )

        assertEquals(
            ComposerHooksPanelLifecycleState(
                hostConfigFilesAvailable = true,
                hookTrustAvailable = true,
                configBusy = true,
                addTargetMode = null,
                resetsFormOnAdd = false,
                clearsConfigStatusOnAdd = false,
                backTargetMode = ComposerHooksPanelModePreview.List,
                clearsEditingTargetOnBack = true,
                stateDescription = "Hooks panel: edit form, editing available, trust available, saving",
            ),
            buildComposerHooksPanelState(
                ComposerHooksPanelPreview(
                    mode = ComposerHooksPanelModePreview.Edit,
                    hostConfigFilesAvailable = true,
                    hookTrustAvailable = true,
                    configBusy = true,
                    hooks = emptyList(),
                    warnings = emptyList(),
                    errors = emptyList(),
                ),
            ).lifecycle,
        )
    }

    @Test
    fun buildsComposerHooksStatusMessagesAndEmptyState() {
        assertEquals(
            listOf(
                ComposerHookStatusMessageState("Loading hooks...", ComposerMcpStatusTone.Neutral),
                ComposerHookStatusMessageState("Unable to load hooks", ComposerMcpStatusTone.Error),
                ComposerHookStatusMessageState("Invalid hooks config", ComposerMcpStatusTone.Error),
                ComposerHookStatusMessageState("Hook saved", ComposerMcpStatusTone.Success),
                ComposerHookStatusMessageState("Project warning", ComposerMcpStatusTone.Neutral),
                ComposerHookStatusMessageState("Broken hook", ComposerMcpStatusTone.Error, path = "/bad/hooks.json"),
            ),
            buildComposerHooksPanelState(
                ComposerHooksPanelPreview(
                    mode = ComposerHooksPanelModePreview.List,
                    status = ComposerPanelLoadStatusPreview.Loading,
                    error = "Unable to load hooks",
                    configError = "Invalid hooks config",
                    configSuccess = "Hook saved",
                    warnings = listOf("Project warning"),
                    errors = listOf(
                        ComposerHookErrorPreview(path = "/bad/hooks.json", message = "Broken hook"),
                    ),
                    hooks = emptyList(),
                ),
            ).statusMessages,
        )

        assertEquals(
            "No hooks configured for this workspace.",
            buildComposerHooksPanelState(
                ComposerHooksPanelPreview(
                    mode = ComposerHooksPanelModePreview.List,
                    status = ComposerPanelLoadStatusPreview.Ready,
                    error = null,
                    projectHooksPath = null,
                    hostConfigFilesAvailable = false,
                    warnings = emptyList(),
                    errors = emptyList(),
                    hooks = emptyList(),
                ),
            ).emptyMessage,
        )
    }

    @Test
    fun labelsComposerHooksMetadata() {
        assertEquals("Cloud", hookSourceLabel(ComposerHookSourcePreview.CloudRequirements))
        assertEquals("Managed", hookSourceLabel(ComposerHookSourcePreview.LegacyManagedConfigFile))
        assertEquals("Session", hookSourceLabel(ComposerHookSourcePreview.SessionFlags))
        assertEquals("Project", hookSourceLabel(ComposerHookSourcePreview.Project))

        assertEquals("Managed", hookTrustLabel(ComposerHookTrustStatusPreview.Managed))
        assertEquals("Modified", hookTrustLabel(ComposerHookTrustStatusPreview.Modified))
        assertEquals("Trusted", hookTrustLabel(ComposerHookTrustStatusPreview.Trusted))
        assertEquals("Review", hookTrustLabel(ComposerHookTrustStatusPreview.Untrusted))

        assertEquals("PermissionRequest", hookEventJsonKey(ComposerHookEventNamePreview.PermissionRequest))
        assertEquals("Global", hookScopeLabel(ComposerHookScopePreview.Global))
    }

    @Test
    fun buildsComposerToolboxItemsFromBackendActions() {
        assertEquals(
            listOf(
                ComposerToolboxItemState(
                    command = "/fast",
                    label = "Fast",
                    status = "On",
                    description = "Toggle fast mode",
                    enabled = true,
                    tone = ComposerToolboxItemTone.Active,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.ToggleFast,
                        targetFastMode = false,
                    ),
                ),
                ComposerToolboxItemState(
                    command = "/compact",
                    label = "Compact",
                    status = "Busy",
                    description = "Compact thread",
                    enabled = false,
                    tone = ComposerToolboxItemTone.Disabled,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.RunCompact,
                        closeMenu = true,
                    ),
                ),
                ComposerToolboxItemState(
                    command = "/goal",
                    label = "Goal",
                    status = "Composing",
                    description = "Goal",
                    enabled = true,
                    tone = ComposerToolboxItemTone.Active,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.ExitGoalCompose,
                        closeMenu = true,
                    ),
                ),
                ComposerToolboxItemState(
                    command = "/fork",
                    label = "Fork",
                    status = "Idle only",
                    description = "Fork thread",
                    enabled = false,
                    tone = ComposerToolboxItemTone.Disabled,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.OpenPanel,
                        targetPanel = ComposerSlashPanelViewState.Fork,
                    ),
                ),
                ComposerToolboxItemState(
                    command = "/skills",
                    label = "Skills",
                    status = "View",
                    description = "Skills",
                    enabled = true,
                    tone = ComposerToolboxItemTone.Neutral,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.OpenPanel,
                        targetPanel = ComposerSlashPanelViewState.Skills,
                    ),
                ),
            ),
            buildComposerToolboxItems(
                items = listOf(
                    ComposerToolboxItemPreview(
                        action = ComposerToolboxActionPreview.Fast,
                        command = "/fast",
                        label = "Fast",
                        description = "Toggle fast mode",
                    ),
                    ComposerToolboxItemPreview(
                        action = ComposerToolboxActionPreview.Compact,
                        command = "/compact",
                        label = "Compact",
                        description = "Compact thread",
                    ),
                    ComposerToolboxItemPreview(
                        action = ComposerToolboxActionPreview.Goal,
                        command = "/goal",
                        label = "Goal",
                        description = null,
                    ),
                    ComposerToolboxItemPreview(
                        action = ComposerToolboxActionPreview.Fork,
                        command = "/fork",
                        label = "Fork",
                        description = "Fork thread",
                    ),
                    ComposerToolboxItemPreview(
                        action = ComposerToolboxActionPreview.Skills,
                        command = "/skills",
                        label = "Skills",
                        description = "",
                    ),
                ),
                fastMode = true,
                compactBusy = true,
                goalComposeMode = true,
                goalStatus = ThreadGoalStatusPreview.Active,
                busy = true,
                settingsBusy = false,
                forkBusy = false,
            ),
        )
    }

    @Test
    fun buildsIdleComposerToolboxItems() {
        assertEquals(
            listOf(
                ComposerToolboxItemState(
                    command = "/fast",
                    label = "Fast",
                    status = "Off",
                    description = "Fast",
                    enabled = false,
                    tone = ComposerToolboxItemTone.Disabled,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.ToggleFast,
                        targetFastMode = true,
                    ),
                ),
                ComposerToolboxItemState(
                    command = "/compact",
                    label = "Compact",
                    status = "Run",
                    description = "Compact",
                    enabled = true,
                    tone = ComposerToolboxItemTone.Neutral,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.RunCompact,
                        closeMenu = true,
                    ),
                ),
                ComposerToolboxItemState(
                    command = "/goal",
                    label = "Goal",
                    status = "Complete",
                    description = "Goal",
                    enabled = true,
                    tone = ComposerToolboxItemTone.Neutral,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.EnterGoalCompose,
                    ),
                ),
                ComposerToolboxItemState(
                    command = "/fork",
                    label = "Fork",
                    status = "Open",
                    description = "Fork",
                    enabled = false,
                    tone = ComposerToolboxItemTone.Disabled,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.OpenPanel,
                        targetPanel = ComposerSlashPanelViewState.Fork,
                    ),
                ),
                ComposerToolboxItemState(
                    command = "/mcp",
                    label = "MCP",
                    status = "View",
                    description = "MCP",
                    enabled = true,
                    tone = ComposerToolboxItemTone.Neutral,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.OpenPanel,
                        targetPanel = ComposerSlashPanelViewState.Mcp,
                    ),
                ),
                ComposerToolboxItemState(
                    command = "/hooks",
                    label = "Hooks",
                    status = "View",
                    description = "Hooks",
                    enabled = true,
                    tone = ComposerToolboxItemTone.Neutral,
                    actionDecision = ComposerToolboxActionDecisionState(
                        kind = ComposerToolboxActionDecisionKind.OpenPanel,
                        targetPanel = ComposerSlashPanelViewState.Hooks,
                    ),
                ),
            ),
            buildComposerToolboxItems(
                items = listOf(
                    ComposerToolboxItemPreview(ComposerToolboxActionPreview.Fast, "/fast", "Fast", null),
                    ComposerToolboxItemPreview(ComposerToolboxActionPreview.Compact, "/compact", "Compact", null),
                    ComposerToolboxItemPreview(ComposerToolboxActionPreview.Goal, "/goal", "Goal", null),
                    ComposerToolboxItemPreview(ComposerToolboxActionPreview.Fork, "/fork", "Fork", null),
                    ComposerToolboxItemPreview(ComposerToolboxActionPreview.Mcp, "/mcp", "MCP", null),
                    ComposerToolboxItemPreview(ComposerToolboxActionPreview.Hooks, "/hooks", "Hooks", null),
                ),
                fastMode = false,
                compactBusy = false,
                goalComposeMode = false,
                goalStatus = ThreadGoalStatusPreview.Complete,
                busy = false,
                settingsBusy = true,
                forkBusy = true,
            ),
        )
    }

    @Test
    fun buildsComposerToolboxActionDecisionsWithoutSideEffects() {
        assertEquals(
            ComposerToolboxActionDecisionState(
                kind = ComposerToolboxActionDecisionKind.ToggleFast,
                targetFastMode = false,
            ),
            buildComposerToolboxActionDecision(
                action = ComposerToolboxActionPreview.Fast,
                fastMode = true,
                goalComposeMode = false,
            ),
        )
        assertEquals(
            ComposerToolboxActionDecisionState(
                kind = ComposerToolboxActionDecisionKind.RunCompact,
                closeMenu = true,
            ),
            buildComposerToolboxActionDecision(
                action = ComposerToolboxActionPreview.Compact,
                fastMode = false,
                goalComposeMode = false,
            ),
        )
        assertEquals(
            ComposerToolboxActionDecisionState(
                kind = ComposerToolboxActionDecisionKind.EnterGoalCompose,
            ),
            buildComposerToolboxActionDecision(
                action = ComposerToolboxActionPreview.Goal,
                fastMode = false,
                goalComposeMode = false,
            ),
        )
        assertEquals(
            ComposerToolboxActionDecisionState(
                kind = ComposerToolboxActionDecisionKind.ExitGoalCompose,
                closeMenu = true,
            ),
            buildComposerToolboxActionDecision(
                action = ComposerToolboxActionPreview.Goal,
                fastMode = false,
                goalComposeMode = true,
            ),
        )
        assertEquals(
            ComposerToolboxActionDecisionState(
                kind = ComposerToolboxActionDecisionKind.OpenPanel,
                targetPanel = ComposerSlashPanelViewState.Skills,
            ),
            buildComposerToolboxActionDecision(
                action = ComposerToolboxActionPreview.Skills,
                fastMode = false,
                goalComposeMode = false,
            ),
        )
    }

    @Test
    fun buildsOpenComposerSlashToolboxPanelStateWithItems() {
        val item = ComposerToolboxItemState(
            command = "/fast",
            label = "Fast",
            status = "Off",
            description = "Toggle fast mode",
            enabled = true,
            tone = ComposerToolboxItemTone.Neutral,
        )

        assertEquals(
            ComposerSlashToolboxPanelState(
                menuVisible = true,
                triggerAccessibilityLabel = "Open slash toolbox",
                triggerTitle = "Open slash toolbox",
                surfaceVisible = true,
                title = "Slash toolbox",
                subtitle = "Thread actions",
                view = ComposerSlashPanelViewState.Root,
                showRootItems = true,
                items = listOf(item),
                emptyMessage = null,
            ),
            buildComposerSlashToolboxPanelState(
                open = true,
                view = ComposerSlashPanelViewPreview.Root,
                items = listOf(item),
            ),
        )
    }

    @Test
    fun buildsClosedEmptyComposerSlashToolboxPanelState() {
        assertEquals(
            ComposerSlashToolboxPanelState(
                menuVisible = false,
                triggerAccessibilityLabel = "Open slash toolbox",
                triggerTitle = "Open slash toolbox",
                surfaceVisible = false,
                title = "Slash toolbox",
                subtitle = "Thread actions",
                view = ComposerSlashPanelViewState.Root,
                showRootItems = true,
                items = emptyList(),
                emptyMessage = "No backend tools are available for this thread.",
            ),
            buildComposerSlashToolboxPanelState(
                open = false,
                view = ComposerSlashPanelViewPreview.Root,
                items = emptyList(),
            ),
        )
    }

    @Test
    fun buildsComposerSlashToolboxChildPanelState() {
        val item = ComposerToolboxItemState(
            command = "/skills",
            label = "Skills",
            status = "View",
            description = "Inspect skills",
            enabled = true,
            tone = ComposerToolboxItemTone.Neutral,
        )

        assertEquals(
            ComposerSlashToolboxPanelState(
                menuVisible = true,
                triggerAccessibilityLabel = "Open slash toolbox",
                triggerTitle = "Open slash toolbox",
                surfaceVisible = true,
                title = "Slash toolbox",
                subtitle = "Thread actions",
                view = ComposerSlashPanelViewState.Skills,
                showRootItems = false,
                items = listOf(item),
                emptyMessage = null,
            ),
            buildComposerSlashToolboxPanelState(
                open = true,
                view = ComposerSlashPanelViewPreview.Skills,
                items = listOf(item),
            ),
        )
    }

    @Test
    fun resetsComposerMenuLifecycleWhenSlashMenuCloses() {
        assertEquals(
            ComposerMenuLifecycleState(
                shouldResetSlashPanelView = true,
                shouldResetMcpPanelMode = true,
                shouldClearMcpConfigStatus = true,
                shouldClearHookConfigStatus = true,
                targetSlashPanelView = ComposerSlashPanelViewState.Root,
                targetMcpPanelMode = ComposerMcpPanelModePreview.List,
            ),
            buildComposerMenuLifecycleState(
                openMenu = null,
                slashPanelView = ComposerSlashPanelViewPreview.Mcp,
            ),
        )
    }

    @Test
    fun resetsOnlyMcpLifecycleWhenLeavingMcpSubpanel() {
        assertEquals(
            ComposerMenuLifecycleState(
                shouldResetSlashPanelView = false,
                shouldResetMcpPanelMode = true,
                shouldClearMcpConfigStatus = true,
                shouldClearHookConfigStatus = false,
                targetSlashPanelView = null,
                targetMcpPanelMode = ComposerMcpPanelModePreview.List,
            ),
            buildComposerMenuLifecycleState(
                openMenu = ComposerToolbarMenuState.Slash,
                slashPanelView = ComposerSlashPanelViewPreview.Skills,
            ),
        )
    }

    @Test
    fun retainsComposerMenuLifecycleWhileMcpSubpanelIsOpen() {
        assertEquals(
            ComposerMenuLifecycleState(
                shouldResetSlashPanelView = false,
                shouldResetMcpPanelMode = false,
                shouldClearMcpConfigStatus = false,
                shouldClearHookConfigStatus = false,
                targetSlashPanelView = null,
                targetMcpPanelMode = null,
            ),
            buildComposerMenuLifecycleState(
                openMenu = ComposerToolbarMenuState.Slash,
                slashPanelView = ComposerSlashPanelViewPreview.Mcp,
            ),
        )
    }

    @Test
    fun parsesAndFormatsGoalTokenBudgetsInThousands() {
        assertNull(parseGoalTokenBudgetThousands(""))
        assertEquals(12_500, parseGoalTokenBudgetThousands("12.5"))
        assertEquals(Int.MIN_VALUE, parseGoalTokenBudgetThousands("-1"))
        assertEquals(Int.MIN_VALUE, parseGoalTokenBudgetThousands("abc"))
        assertEquals("", formatGoalTokenBudgetThousands(null))
        assertEquals("12", formatGoalTokenBudgetThousands(12_000))
        assertEquals("12.5", formatGoalTokenBudgetThousands(12_500))
    }

    @Test
    fun mapsGoalStatusesToWebLabels() {
        assertEquals("Active", goalStatusLabel(ThreadGoalStatusPreview.Active))
        assertEquals("Paused", goalStatusLabel(ThreadGoalStatusPreview.Paused))
        assertEquals("Budget", goalStatusLabel(ThreadGoalStatusPreview.BudgetLimited))
        assertEquals("Complete", goalStatusLabel(ThreadGoalStatusPreview.Complete))
        assertEquals("Terminated", goalStatusLabel(ThreadGoalStatusPreview.Terminated))
    }

    @Test
    fun buildsVisibleGoalComposePanelState() {
        assertEquals(
            ComposerGoalPanelState(
                statusLabel = "Composing",
                description = "Create or update the active thread goal.",
                composeCard = ComposerGoalComposeCardState(
                    visible = true,
                    label = "Goal",
                    tokenBudgetInputLabel = "Max tokens (k)",
                    tokenBudgetLabel = "12.5",
                    tokenBudgetPlaceholder = "Optional",
                    errorMessage = "Token budget must be a positive number in thousands.",
                    primaryLabel = "Setting...",
                    primaryEnabled = false,
                    cancelLabel = "Cancel",
                    lifecycle = ComposerGoalComposeLifecycleState(
                        seedsTokenBudgetFromCurrentGoal = true,
                        clearsLocalErrorOnEnter = true,
                        clearsLocalErrorOnExit = true,
                        clearsDraftOnSuccess = true,
                        exitsComposeOnSuccess = true,
                        keepsComposeOpenOnFailure = true,
                        focusesPromptOnEnter = true,
                    ),
                ),
                currentGoal = ComposerCurrentGoalState(
                    title = "Current goal",
                    objective = "Ship Android composer parity.",
                    statusLabel = "Budget",
                    tokenBudgetLabel = "12.5k budget",
                    tokenUsageLabel = "4.2k / 12.5k used",
                ),
                notice = null,
                lifecycle = ComposerGoalPanelLifecycleState(
                    composeMode = true,
                    updateAvailable = true,
                    busy = true,
                    canSubmit = false,
                    canCancel = false,
                    closeMenuOnEnter = true,
                    resetSlashPanelOnEnter = true,
                    openGoalOnEnter = true,
                    stateDescription = "Goal panel: compose, available, setting",
                ),
            ),
            buildComposerGoalPanelState(
                ComposerGoalPanelPreview(
                    composeMode = true,
                    tokenBudget = 12_500,
                    busy = true,
                    localError = "Token budget must be a positive number in thousands.",
                    currentGoal = ThreadGoalPreview(
                        objective = "Ship Android composer parity.",
                        status = ThreadGoalStatusPreview.BudgetLimited,
                        tokenBudget = 12_500,
                        tokensUsed = 4_200,
                    ),
                ),
            ),
        )
    }

    @Test
    fun buildsHiddenGoalComposePanelStateWhenIdle() {
        assertEquals(
            ComposerGoalPanelState(
                statusLabel = "Open",
                description = "Create or update the active thread goal.",
                composeCard = ComposerGoalComposeCardState(
                    visible = false,
                    label = "Goal",
                    tokenBudgetInputLabel = "Max tokens (k)",
                    tokenBudgetLabel = "",
                    tokenBudgetPlaceholder = "Optional",
                    errorMessage = null,
                    primaryLabel = "Set goal",
                    primaryEnabled = true,
                    cancelLabel = "Cancel",
                    lifecycle = ComposerGoalComposeLifecycleState(
                        seedsTokenBudgetFromCurrentGoal = false,
                        clearsLocalErrorOnEnter = true,
                        clearsLocalErrorOnExit = true,
                        clearsDraftOnSuccess = true,
                        exitsComposeOnSuccess = true,
                        keepsComposeOpenOnFailure = true,
                        focusesPromptOnEnter = true,
                    ),
                ),
                currentGoal = null,
                notice = null,
                lifecycle = ComposerGoalPanelLifecycleState(
                    composeMode = false,
                    updateAvailable = true,
                    busy = false,
                    canSubmit = false,
                    canCancel = false,
                    closeMenuOnEnter = true,
                    resetSlashPanelOnEnter = true,
                    openGoalOnEnter = true,
                    stateDescription = "Goal panel: summary, available",
                ),
            ),
            buildComposerGoalPanelState(
                ComposerGoalPanelPreview(
                    composeMode = false,
                    tokenBudget = null,
                    currentGoal = null,
                ),
            ),
        )
    }

    @Test
    fun buildsUnavailableGoalPanelNotice() {
        assertEquals(
            ComposerGoalPanelState(
                statusLabel = "Unavailable",
                description = "Create or update the active thread goal.",
                composeCard = ComposerGoalComposeCardState(
                    visible = false,
                    label = "Goal",
                    tokenBudgetInputLabel = "Max tokens (k)",
                    tokenBudgetLabel = "12",
                    tokenBudgetPlaceholder = "Optional",
                    errorMessage = null,
                    primaryLabel = "Set goal",
                    primaryEnabled = false,
                    cancelLabel = "Cancel",
                    lifecycle = ComposerGoalComposeLifecycleState(
                        seedsTokenBudgetFromCurrentGoal = false,
                        clearsLocalErrorOnEnter = true,
                        clearsLocalErrorOnExit = true,
                        clearsDraftOnSuccess = true,
                        exitsComposeOnSuccess = true,
                        keepsComposeOpenOnFailure = true,
                        focusesPromptOnEnter = true,
                    ),
                ),
                currentGoal = null,
                notice = ComposerHookStatusMessageState(
                    message = "/goal is unavailable in this view.",
                    tone = ComposerMcpStatusTone.Error,
                ),
                lifecycle = ComposerGoalPanelLifecycleState(
                    composeMode = false,
                    updateAvailable = false,
                    busy = false,
                    canSubmit = false,
                    canCancel = false,
                    closeMenuOnEnter = true,
                    resetSlashPanelOnEnter = true,
                    openGoalOnEnter = true,
                    stateDescription = "Goal panel: summary, unavailable",
                ),
            ),
            buildComposerGoalPanelState(
                ComposerGoalPanelPreview(
                    composeMode = false,
                    tokenBudget = 12_000,
                    updateAvailable = false,
                    currentGoal = null,
                ),
            ),
        )
    }

    @Test
    fun buildsGoalComposeLifecycleState() {
        assertEquals(
            ComposerGoalPanelLifecycleState(
                composeMode = true,
                updateAvailable = true,
                busy = false,
                canSubmit = true,
                canCancel = true,
                closeMenuOnEnter = true,
                resetSlashPanelOnEnter = true,
                openGoalOnEnter = true,
                stateDescription = "Goal panel: compose, available",
            ),
            buildComposerGoalPanelState(
                ComposerGoalPanelPreview(
                    composeMode = true,
                    busy = false,
                    updateAvailable = true,
                ),
            ).lifecycle,
        )

        assertEquals(
            ComposerGoalComposeLifecycleState(
                seedsTokenBudgetFromCurrentGoal = true,
                clearsLocalErrorOnEnter = true,
                clearsLocalErrorOnExit = true,
                clearsDraftOnSuccess = true,
                exitsComposeOnSuccess = true,
                keepsComposeOpenOnFailure = true,
                focusesPromptOnEnter = true,
            ),
            buildComposerGoalPanelState(
                ComposerGoalPanelPreview(
                    currentGoal = ThreadGoalPreview(
                        objective = "Ship Android composer parity.",
                        status = ThreadGoalStatusPreview.Active,
                        tokenBudget = 42_000,
                    ),
                ),
            ).composeCard.lifecycle,
        )
    }

    @Test
    fun buildsStructuredFileChangeSummarySegments() {
        assertEquals(
            listOf(
                FileChangeSummarySegment("2 files", FileChangeSummaryTone.Files),
                FileChangeSummarySegment("+31", FileChangeSummaryTone.Added),
                FileChangeSummarySegment("-4", FileChangeSummaryTone.Removed),
            ),
            fileChangeSummarySegments(
                changedFiles = 2,
                addedLines = 31,
                removedLines = 4,
                previewText = "ignored fallback",
            ),
        )
    }

    @Test
    fun buildsSingularFileChangeSummarySegment() {
        assertEquals(
            listOf(FileChangeSummarySegment("1 file", FileChangeSummaryTone.Files)),
            fileChangeSummarySegments(
                changedFiles = 1,
                addedLines = null,
                removedLines = null,
                previewText = null,
            ),
        )
    }

    @Test
    fun fallsBackToNormalizedFileChangePreviewText() {
        assertEquals(
            listOf(
                FileChangeSummarySegment("2 files", FileChangeSummaryTone.Neutral),
                FileChangeSummarySegment("+31", FileChangeSummaryTone.Neutral),
                FileChangeSummarySegment("-4", FileChangeSummaryTone.Neutral),
            ),
            fileChangeSummarySegments(
                changedFiles = null,
                addedLines = null,
                removedLines = null,
                previewText = "2 files changed · +31 · -4",
            ),
        )
    }

    @Test
    fun formatsProjectRelativePathLabels() {
        assertEquals(
            "apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTimelineComponents.kt",
            projectRelativePathLabel("/home/u/dev/remoteCodex-main/apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTimelineComponents.kt"),
        )
        assertEquals(
            "packages/thread-ui/src/components/ThreadComposer.tsx, +2 more",
            projectRelativePathLabel("./packages\\thread-ui\\src\\components\\ThreadComposer.tsx, +2 more"),
        )
    }

    @Test
    fun keepsTrailingPathSegmentsWithinCompactLabels() {
        assertEquals(
            ".../ui/components/ThreadTimelineComponents.kt",
            formatTrailingPathLabel(
                "/home/u/dev/remoteCodex-main/apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTimelineComponents.kt",
                maxLength = 48,
            ),
        )
        assertEquals(
            ".../ThreadTimelineComponents.kt",
            formatTrailingPathLabel(
                "apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTimelineComponents.kt",
                maxLength = 34,
            ),
        )
    }

    @Test
    fun keepsPathSuffixWhenCompactingLabels() {
        assertEquals(
            ".../ThreadComposer.tsx, +2 more",
            formatTrailingPathLabel(
                "packages/thread-ui/src/components/ThreadComposer.tsx, +2 more",
                maxLength = 34,
            ),
        )
    }

    @Test
    fun summarizesSingleLineInlinePreviewText() {
        assertEquals(
            InlinePreviewSummary(
                firstLine = "./gradlew :app:assembleDebug",
                showGap = false,
                isTruncated = false,
            ),
            summarizeInlinePreviewText("./gradlew :app:assembleDebug"),
        )
    }

    @Test
    fun summarizesMultilineInlinePreviewTextWithGap() {
        assertEquals(
            InlinePreviewSummary(
                firstLine = "BUILD SUCCESSFUL in 17s",
                showGap = true,
                isTruncated = true,
            ),
            summarizeInlinePreviewText("BUILD SUCCESSFUL in 17s\n35 actionable tasks: 35 executed\n"),
        )
    }

    @Test
    fun preservesCarriageReturnInlinePreviewText() {
        assertEquals(
            InlinePreviewSummary(
                firstLine = "first",
                showGap = true,
                isTruncated = true,
            ),
            summarizeInlinePreviewText("first\r\nsecond"),
        )
    }

    @Test
    fun labelsGroupedHistoryRowsByKind() {
        assertEquals("Step 1", historyGroupRowOrdinalLabel(HistoryItemKind.Command, 0))
        assertEquals("Search 2", historyGroupRowOrdinalLabel(HistoryItemKind.WebSearch, 1))
        assertEquals("Read 3", historyGroupRowOrdinalLabel(HistoryItemKind.FileRead, 2))
        assertNull(historyGroupRowOrdinalLabel(HistoryItemKind.FileChange, 0))
        assertEquals("Item 4", historyGroupRowOrdinalLabel(HistoryItemKind.Artifact, 3))
    }

    @Test
    fun buildsWebAlignedGroupedHistoryDetailTitles() {
        assertEquals(
            "Command Output 1",
            graphChatHistoryGroupRowDetailTitle(
                kind = HistoryItemKind.Command,
                index = 0,
                meta = null,
                actionLabel = "Open",
                title = "command",
            ),
        )
        assertEquals(
            "Web Search 2",
            graphChatHistoryGroupRowDetailTitle(
                kind = HistoryItemKind.WebSearch,
                index = 1,
                meta = null,
                actionLabel = "Web Search Details",
                title = "web_search",
            ),
        )
        assertEquals(
            "File Read 3",
            graphChatHistoryGroupRowDetailTitle(
                kind = HistoryItemKind.FileRead,
                index = 2,
                meta = "workspace",
                actionLabel = "File Read Details",
                title = "file_read",
            ),
        )
        assertEquals(
            "File Change 4",
            graphChatHistoryGroupRowDetailTitle(
                kind = HistoryItemKind.FileChange,
                index = 3,
                meta = "workspace",
                actionLabel = "File Change Details",
                title = "file_change",
            ),
        )
        assertEquals(
            "Artifact Inspector 5",
            graphChatHistoryGroupRowDetailTitle(
                kind = HistoryItemKind.Artifact,
                index = 4,
                meta = "Artifact Inspector",
                actionLabel = "Open",
                title = "Artifact",
            ),
        )
    }

    @Test
    fun hidesNoisyTitlesForTypedHistoryGroupRows() {
        assertEquals(false, shouldShowHistoryGroupRowTitle(HistoryItemKind.Command))
        assertEquals(false, shouldShowHistoryGroupRowTitle(HistoryItemKind.WebSearch))
        assertEquals(false, shouldShowHistoryGroupRowTitle(HistoryItemKind.FileRead))
        assertEquals(false, shouldShowHistoryGroupRowTitle(HistoryItemKind.FileChange))
        assertEquals(true, shouldShowHistoryGroupRowTitle(HistoryItemKind.Artifact))
        assertEquals(true, shouldShowHistoryGroupRowTitle(HistoryItemKind.Generic))
    }

    @Test
    fun buildsRunningCommandHistoryGroupFrameState() {
        assertEquals(
            GraphChatHistoryGroupFrameState(
                title = "Batch",
                subtitle = "3 commands · running",
                countBadgeLabel = "3",
                running = true,
                fileChangeSummarySegments = emptyList(),
                toggleAccessibilityLabel = "Expand 3 commands",
                toggleTargetLabel = "3 commands",
            ),
            buildGraphChatHistoryGroupFrameState(
                kind = HistoryItemKind.Command,
                countLabel = "3 commands",
                statusLabel = " running ",
                itemCount = 3,
                expanded = false,
            ),
        )
    }

    @Test
    fun buildsFileChangeHistoryGroupFrameStateWithDeltaSummary() {
        assertEquals(
            GraphChatHistoryGroupFrameState(
                title = "Batch",
                subtitle = "2 file changes",
                countBadgeLabel = "2",
                running = false,
                fileChangeSummarySegments = listOf(
                    FileChangeSummarySegment("4 files", FileChangeSummaryTone.Files),
                    FileChangeSummarySegment("+12", FileChangeSummaryTone.Added),
                    FileChangeSummarySegment("-3", FileChangeSummaryTone.Removed),
                ),
                toggleAccessibilityLabel = "Collapse 2 file changes",
                toggleTargetLabel = "2 file changes",
            ),
            buildGraphChatHistoryGroupFrameState(
                kind = HistoryItemKind.FileChange,
                countLabel = "2 file changes",
                statusLabel = null,
                itemCount = 2,
                expanded = true,
                changedFiles = 4,
                addedLines = 12,
                removedLines = 3,
            ),
        )
    }

    @Test
    fun buildsHistoryGroupFrameFallbackForMissingCountLabel() {
        assertEquals(
            GraphChatHistoryGroupFrameState(
                title = "Batch",
                subtitle = "1 entry",
                countBadgeLabel = "1",
                running = false,
                fileChangeSummarySegments = emptyList(),
                toggleAccessibilityLabel = "Expand 1 web search entry",
                toggleTargetLabel = "1 web search entry",
            ),
            buildGraphChatHistoryGroupFrameState(
                kind = HistoryItemKind.WebSearch,
                countLabel = " ",
                statusLabel = " ",
                itemCount = 1,
                expanded = false,
            ),
        )
    }

    @Test
    fun recognizesWebAlignedRunningHistoryStatuses() {
        listOf("running", "in_progress", "in progress", "pending").forEach { status ->
            assertEquals(true, isRunningHistoryStatusLabel(status))
        }
        assertEquals(false, isRunningHistoryStatusLabel("still running"))
        assertEquals(false, isRunningHistoryStatusLabel("not running"))
        assertEquals(false, isRunningHistoryStatusLabel("completed"))
        assertEquals(false, isRunningHistoryStatusLabel(null))
    }

    @Test
    fun classifiesGraphChatHistoryStatusLabels() {
        assertEquals(
            GraphChatHistoryStatusState("Completed", GraphChatHistoryStatusTone.Success),
            graphChatHistoryStatusState("succeeded"),
        )
        assertEquals(
            GraphChatHistoryStatusState("Failed", GraphChatHistoryStatusTone.Danger),
            graphChatHistoryStatusState("errored"),
        )
        assertEquals(
            GraphChatHistoryStatusState("pending", GraphChatHistoryStatusTone.Running),
            graphChatHistoryStatusState(" pending "),
        )
        assertEquals(
            GraphChatHistoryStatusState("queued", GraphChatHistoryStatusTone.Neutral),
            graphChatHistoryStatusState("queued"),
        )
        assertNull(graphChatHistoryStatusState(""))
    }

    @Test
    fun buildsCommandHistoryItemFrameState() {
        assertEquals(
            GraphChatHistoryItemFrameState(
                title = "command",
                status = GraphChatHistoryStatusState("Running", GraphChatHistoryStatusTone.Running),
                summary = "./gradlew :app:test",
                running = true,
                runningLabel = "Running from thread events",
                showDetail = true,
                showFileChangeDelta = false,
                fileChangeSummarySegments = emptyList(),
                fileChangeCanOpen = false,
                fileChangeOpenAccessibilityLabel = null,
                showImagePreview = false,
                showAction = true,
                actionLabel = "Command Output",
                actionAccessibilityLabel = "Open full command",
                detailTitle = "Command Output",
                showCopy = true,
                copyText = "command\nRunning\n./gradlew :app:test\n\nBUILD SUCCESSFUL",
            ),
            buildGraphChatHistoryItemFrameState(
                kind = HistoryItemKind.Command,
                title = "command",
                status = ToolStatus.Running,
                meta = null,
                summary = "./gradlew :app:test",
                detail = "BUILD SUCCESSFUL",
                actionLabel = "Command Output",
            ),
        )
    }

    @Test
    fun derivesWebAlignedToolHistoryFrameActions() {
        val fileRead = buildGraphChatHistoryItemFrameState(
            kind = HistoryItemKind.FileRead,
            title = "File Read",
            status = ToolStatus.Completed,
            meta = null,
            summary = "ThreadPresentation.kt",
            detail = "source excerpt",
            actionLabel = "Open",
        )
        val webSearch = buildGraphChatHistoryItemFrameState(
            kind = HistoryItemKind.WebSearch,
            title = "Search",
            status = ToolStatus.Completed,
            meta = null,
            summary = "Compose accessibility guidance",
            detail = "search result detail",
            actionLabel = null,
        )
        val toolCall = buildGraphChatHistoryItemFrameState(
            kind = HistoryItemKind.ToolCall,
            title = "Tool",
            status = null,
            meta = null,
            summary = "read_file",
            detail = "tool payload",
            actionLabel = null,
        )

        assertEquals("file_read", fileRead.title)
        assertEquals("File Read Details", fileRead.actionLabel)
        assertEquals("Open full file read", fileRead.actionAccessibilityLabel)
        assertEquals("File Read Details", fileRead.detailTitle)
        assertEquals("web_search", webSearch.title)
        assertEquals("Web Search Details", webSearch.actionLabel)
        assertEquals("Open full web search", webSearch.actionAccessibilityLabel)
        assertEquals("Tool Call Details", toolCall.actionLabel)
        assertEquals("Open full tool call", toolCall.actionAccessibilityLabel)
        assertEquals("tool_call", toolCall.title)
    }

    @Test
    fun buildsFileChangeHistoryItemFrameStateWithTrailingPathSummary() {
        val state = buildGraphChatHistoryItemFrameState(
            kind = HistoryItemKind.FileChange,
            title = "File Change",
            status = ToolStatus.Completed,
            meta = "workspace",
            summary = "/home/u/dev/remoteCodex-main/apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTimelineComponents.kt",
            detail = "diff --git",
            actionLabel = "Diff",
            changedFiles = 2,
            addedLines = 12,
            removedLines = 3,
        )

        assertEquals(GraphChatHistoryStatusState("Completed", GraphChatHistoryStatusTone.Success), state.status)
        assertEquals(true, state.summary.endsWith("ThreadTimelineComponents.kt"))
        assertEquals(true, state.summary.startsWith(".../"))
        assertEquals(false, state.running)
        assertEquals(false, state.showDetail)
        assertEquals(true, state.showFileChangeDelta)
        assertEquals(
            listOf(
                FileChangeSummarySegment("2 files", FileChangeSummaryTone.Files),
                FileChangeSummarySegment("+12", FileChangeSummaryTone.Added),
                FileChangeSummarySegment("-3", FileChangeSummaryTone.Removed),
            ),
            state.fileChangeSummarySegments,
        )
        assertEquals(true, state.fileChangeCanOpen)
        assertEquals("Open file change details", state.fileChangeOpenAccessibilityLabel)
        assertEquals(false, state.showImagePreview)
        assertEquals(false, state.showAction)
        assertEquals(null, state.actionLabel)
        assertEquals(null, state.actionAccessibilityLabel)
        assertEquals("Diff", state.detailTitle)
        assertEquals(true, state.showCopy)
        assertEquals(
            "File Change\nworkspace\nDone\n/home/u/dev/remoteCodex-main/apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTimelineComponents.kt\n\ndiff --git",
            state.copyText,
        )
    }

    @Test
    fun opensFileChangeHistoryItemWhenDetailIsDeferred() {
        val state = buildGraphChatHistoryItemFrameState(
            kind = HistoryItemKind.FileChange,
            title = "File Change",
            status = ToolStatus.Completed,
            meta = null,
            summary = "apps/android/app/src/main/java/com/remotecodex/android/ui/model/ThreadPreviewModels.kt",
            detail = null,
            actionLabel = null,
            hasDeferredDetail = true,
            changedFiles = 1,
            addedLines = 8,
            removedLines = 0,
        )

        assertEquals(true, state.fileChangeCanOpen)
        assertEquals("Open file change details", state.fileChangeOpenAccessibilityLabel)
        assertEquals("File Change", state.detailTitle)
    }

    @Test
    fun doesNotOpenFileChangeHistoryItemForActionLabelOnly() {
        val state = buildGraphChatHistoryItemFrameState(
            kind = HistoryItemKind.FileChange,
            title = "File Change",
            status = ToolStatus.Completed,
            meta = null,
            summary = "apps/android/app/src/main/java/com/remotecodex/android/ui/model/ThreadPreviewModels.kt",
            detail = null,
            actionLabel = "File Change Details",
            hasDeferredDetail = false,
            changedFiles = 1,
            addedLines = 8,
            removedLines = 0,
        )

        assertEquals(false, state.fileChangeCanOpen)
        assertEquals(null, state.fileChangeOpenAccessibilityLabel)
        assertEquals("File Change Details", state.detailTitle)
    }

    @Test
    fun usesOriginalFileChangeTextForDeferredDetailFallback() {
        assertEquals(
            "/home/u/dev/remoteCodex-main/apps/android/app/src/main/java/com/remotecodex/android/ui/model/ThreadPreviewModels.kt",
            graphChatHistoryDetailText(
                kind = HistoryItemKind.FileChange,
                title = "/home/u/dev/remoteCodex-main/apps/android/app/src/main/java/com/remotecodex/android/ui/model/ThreadPreviewModels.kt",
                summary = "ThreadPreviewModels.kt",
                detail = null,
                hasDeferredDetail = true,
            ),
        )
    }

    @Test
    fun usesSummaryForNonDeferredHistoryDetailFallback() {
        assertEquals(
            "ThreadPreviewModels.kt",
            graphChatHistoryDetailText(
                kind = HistoryItemKind.FileChange,
                title = "/home/u/dev/remoteCodex-main/apps/android/app/src/main/java/com/remotecodex/android/ui/model/ThreadPreviewModels.kt",
                summary = "ThreadPreviewModels.kt",
                detail = null,
                hasDeferredDetail = false,
            ),
        )
        assertEquals(
            "source excerpt",
            graphChatHistoryDetailText(
                kind = HistoryItemKind.FileRead,
                title = "file_read",
                summary = "source excerpt",
                detail = null,
            ),
        )
    }

    @Test
    fun usesExplicitHistoryDetailBeforeFallbacks() {
        assertEquals(
            "diff --git",
            graphChatHistoryDetailText(
                kind = HistoryItemKind.FileChange,
                title = "/home/u/dev/remoteCodex-main/apps/android/app/src/main/java/com/remotecodex/android/ui/model/ThreadPreviewModels.kt",
                summary = "ThreadPreviewModels.kt",
                detail = " diff --git ",
                hasDeferredDetail = true,
            ),
        )
    }

    @Test
    fun buildsArtifactHistoryItemFrameStateWithoutGenericActionOrDetail() {
        assertEquals(
            GraphChatHistoryItemFrameState(
                title = "Artifact",
                status = null,
                summary = "chart rendered",
                running = false,
                runningLabel = "Running from thread events",
                showDetail = false,
                showFileChangeDelta = false,
                fileChangeSummarySegments = emptyList(),
                fileChangeCanOpen = false,
                fileChangeOpenAccessibilityLabel = null,
                showImagePreview = false,
                showAction = false,
                actionLabel = null,
                actionAccessibilityLabel = null,
                detailTitle = "Artifact Inspector",
                showCopy = true,
                copyText = "Artifact\nchart rendered\n\nartifact detail",
            ),
            buildGraphChatHistoryItemFrameState(
                kind = HistoryItemKind.Artifact,
                title = "Artifact",
                status = null,
                meta = null,
                summary = "chart rendered",
                detail = "artifact detail",
                actionLabel = "Artifact Inspector",
            ),
        )
    }

    @Test
    fun buildsImageHistoryStateWithAssetPath() {
        assertEquals(
            GraphChatImageHistoryState(
                previewLabel = "Shell preview",
                assetPath = "apps/android/output/shell-preview.png",
                fallbackSummary = "Generated screenshot",
                openTitle = "Image Path",
                openText = "apps/android/output/shell-preview.png",
                pathAccessibilityLabel = "Open image path",
                copyAccessibilityLabel = "Copy image path",
            ),
            buildGraphChatImageHistoryState(
                text = "Generated screenshot",
                detail = "detail/path.png",
                assetPath = "apps/android/output/shell-preview.png",
                imageLabel = "Shell preview",
            ),
        )
    }

    @Test
    fun buildsImageHistoryStateWithDetailFallbackPath() {
        assertEquals(
            GraphChatImageHistoryState(
                previewLabel = "Image preview",
                assetPath = "detail/path.png",
                fallbackSummary = "Image preview",
                openTitle = "Image Path",
                openText = "detail/path.png",
                pathAccessibilityLabel = "Open image path",
                copyAccessibilityLabel = "Copy image path",
            ),
            buildGraphChatImageHistoryState(
                text = " ",
                detail = " detail/path.png ",
                assetPath = null,
                imageLabel = null,
            ),
        )
    }

    @Test
    fun buildsImageHistoryStateWithoutPath() {
        assertEquals(
            GraphChatImageHistoryState(
                previewLabel = "Inline plot",
                assetPath = null,
                fallbackSummary = "Inline plot",
                openTitle = "Image Path",
                openText = "Inline plot",
                pathAccessibilityLabel = null,
                copyAccessibilityLabel = null,
            ),
            buildGraphChatImageHistoryState(
                text = "Inline plot",
                detail = null,
                assetPath = " ",
                imageLabel = null,
            ),
        )
    }

    @Test
    fun buildsRunningContextCompactionHistoryStateFromStatus() {
        assertEquals(
            ContextCompactionHistoryState(
                primaryText = "Compacting context",
                secondaryText = "Pruning old turns",
                running = true,
            ),
            buildContextCompactionHistoryState(
                text = "Context compacted",
                status = ToolStatus.Running,
                detailText = "Pruning old turns",
            ),
        )
    }

    @Test
    fun buildsRunningContextCompactionHistoryStateFromText() {
        assertEquals(
            ContextCompactionHistoryState(
                primaryText = "Compacting context",
                secondaryText = null,
                running = true,
            ),
            buildContextCompactionHistoryState(
                text = "Compacting context",
                status = null,
                detailText = "Compacting context",
            ),
        )
    }

    @Test
    fun buildsCompletedContextCompactionHistoryStateWithoutDuplicateSecondaryText() {
        assertEquals(
            ContextCompactionHistoryState(
                primaryText = "Context compacted",
                secondaryText = null,
                running = false,
            ),
            buildContextCompactionHistoryState(
                text = "Context compacted",
                status = ToolStatus.Completed,
                detailText = "Context compacted",
            ),
        )
    }

    @Test
    fun summarizesHookOutputWithHookLabelAndGap() {
        assertEquals(
            HookHistorySummary(
                eventTitle = "PreToolUse_hook",
                hookLabel = "PreToolUse hook",
                hookMetaLabel = "PRETOOLUSE HOOK",
                displayText = "lint-command",
                firstLine = "lint-command",
                showGap = true,
                showMetaLabel = true,
                outputBacked = true,
            ),
            hookHistorySummary(
                text = "PreToolUse",
                hookEventLabel = "PreToolUse",
                hookStatusMessage = "Allowed",
                previewText = "Allowed",
                hookOutput = "lint-command\npolicy: allow",
            ),
        )
    }

    @Test
    fun summarizesHookStatusWithoutDuplicateLabel() {
        assertEquals(
            HookHistorySummary(
                eventTitle = "PostToolUse_hook",
                hookLabel = "PostToolUse hook",
                hookMetaLabel = "POSTTOOLUSE HOOK",
                displayText = "PostToolUse hook · Completed with warnings",
                firstLine = "PostToolUse hook · Completed with warnings",
                showGap = false,
                showMetaLabel = false,
                outputBacked = false,
            ),
            hookHistorySummary(
                text = "fallback hook",
                hookEventLabel = "PostToolUse",
                hookStatusMessage = "Completed with warnings",
                previewText = "Completed with warnings",
                hookOutput = null,
            ),
        )
    }

    @Test
    fun summarizesHookWithoutEventLabel() {
        assertEquals(
            HookHistorySummary(
                eventTitle = "hook",
                hookLabel = "fallback hook",
                hookMetaLabel = "FALLBACK HOOK",
                displayText = "fallback hook",
                firstLine = "fallback hook",
                showGap = false,
                showMetaLabel = false,
                outputBacked = false,
            ),
            hookHistorySummary(
                text = "fallback hook",
                hookEventLabel = null,
                hookStatusMessage = null,
                previewText = null,
                hookOutput = null,
            ),
        )
    }

    @Test
    fun summarizesArtifactHistoryWithRenderer() {
        assertEquals(
            ArtifactHistorySummary(
                title = "Ethanol molecule",
                summary = "XYZ, 9 atoms, 1 frame",
                detailText = "preview fallback",
                typeLabel = "chemistry.molecule3d",
                rendererLabel = null,
                inspectLabel = "Inspect",
                inspectAccessibilityLabel = "Open artifact inspector for Ethanol molecule",
                collapsedToggleLabel = "Open",
                expandedToggleLabel = "Hide",
            ),
            artifactHistorySummary(
                text = "artifact fallback",
                previewText = "preview fallback",
                artifactType = "chemistry.molecule3d",
                artifactTitle = "Ethanol molecule",
                artifactSummary = "XYZ, 9 atoms, 1 frame",
                hasRenderer = true,
                actionLabel = "Inspect",
            ),
        )
    }

    @Test
    fun summarizesArtifactHistoryWithoutRenderer() {
        assertEquals(
            ArtifactHistorySummary(
                title = "artifact fallback",
                summary = "preview fallback",
                detailText = "preview fallback",
                typeLabel = "artifact",
                rendererLabel = "No renderer",
                inspectLabel = null,
                inspectAccessibilityLabel = null,
                collapsedToggleLabel = "Open",
                expandedToggleLabel = "Hide",
            ),
            artifactHistorySummary(
                text = "artifact fallback",
                previewText = "preview fallback",
                artifactType = null,
                artifactTitle = null,
                artifactSummary = null,
                hasRenderer = false,
            ),
        )
    }

    @Test
    fun buildsGraphChatThreadUsageFooterState() {
        assertEquals(
            GraphChatThreadUsageFooterState(
                transcriptLabel = "2 turns | 27 transcript items",
                usageLabel = "Usage in 42.8k / out 9.4k / cache 18.1k",
                accessibilityLabel = "2 turns | 27 transcript items. Usage in 42.8k / out 9.4k / cache 18.1k",
            ),
            buildGraphChatThreadUsageFooterState(
                turnCount = 2,
                itemLabel = "27 transcript items",
                usageLabel = "in 42.8k / out 9.4k / cache 18.1k",
            ),
        )
    }

    @Test
    fun buildsGraphChatThreadUsageFooterFallbacks() {
        assertEquals(
            GraphChatThreadUsageFooterState(
                transcriptLabel = "1 turn | 0 items",
                usageLabel = "Usage waiting for agent usage",
                accessibilityLabel = "1 turn | 0 items. Usage waiting for agent usage",
            ),
            buildGraphChatThreadUsageFooterState(
                turnCount = 1,
                itemLabel = " ",
                usageLabel = "",
            ),
        )
    }

    private fun message(
        author: MessageAuthor,
        text: String,
        reasoningItems: List<ReasoningPreview> = emptyList(),
    ): MessagePreview {
        return MessagePreview(
            author = author,
            status = if (author == MessageAuthor.Assistant) ThreadStatus.Complete else null,
            timeLabel = "10:24",
            text = text,
            reasoningItems = reasoningItems,
        )
    }
}
