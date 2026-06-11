package com.remotecodex.android.ui.presentation

import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.PlanStepStatus
import com.remotecodex.android.ui.model.ComposerActiveView
import com.remotecodex.android.ui.model.ComposerContextAvailability
import com.remotecodex.android.ui.model.ComposerContextPreview
import com.remotecodex.android.ui.model.ThreadStatus
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
    fun mapsPlanStepStatusAccessibilityLabels() {
        assertEquals("Plan step status: Completed", planStepStatusAccessibilityLabel(PlanStepStatus.Completed))
        assertEquals("Plan step status: In progress", planStepStatusAccessibilityLabel(PlanStepStatus.Running))
        assertEquals("Plan step status: Failed", planStepStatusAccessibilityLabel(PlanStepStatus.Failed))
        assertEquals("Plan step status: Pending", planStepStatusAccessibilityLabel(PlanStepStatus.Pending))
        assertEquals("Plan step status: Unknown", planStepStatusAccessibilityLabel(PlanStepStatus.Unknown))
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
                title = "Jump to latest",
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
                title = "Jump to latest",
            ),
            buildComposerJumpLatestState(
                activeView = ComposerActiveView.Shell,
                followTail = false,
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
    fun hidesNoisyTitlesForTypedHistoryGroupRows() {
        assertEquals(false, shouldShowHistoryGroupRowTitle(HistoryItemKind.Command))
        assertEquals(false, shouldShowHistoryGroupRowTitle(HistoryItemKind.WebSearch))
        assertEquals(false, shouldShowHistoryGroupRowTitle(HistoryItemKind.FileRead))
        assertEquals(false, shouldShowHistoryGroupRowTitle(HistoryItemKind.FileChange))
        assertEquals(true, shouldShowHistoryGroupRowTitle(HistoryItemKind.Artifact))
        assertEquals(true, shouldShowHistoryGroupRowTitle(HistoryItemKind.Generic))
    }

    @Test
    fun summarizesHookOutputWithHookLabelAndGap() {
        assertEquals(
            HookHistorySummary(
                hookLabel = "PreToolUse hook",
                hookMetaLabel = "PRETOOLUSE HOOK",
                firstLine = "lint-command",
                showGap = true,
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
                hookLabel = "PostToolUse hook",
                hookMetaLabel = "POSTTOOLUSE HOOK",
                firstLine = "PostToolUse hook · Completed with warnings",
                showGap = false,
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
    fun summarizesArtifactHistoryWithRenderer() {
        assertEquals(
            ArtifactHistorySummary(
                title = "Ethanol molecule",
                summary = "XYZ, 9 atoms, 1 frame",
                detailText = "preview fallback",
                typeLabel = "chemistry.molecule3d",
                rendererLabel = null,
            ),
            artifactHistorySummary(
                text = "artifact fallback",
                previewText = "preview fallback",
                artifactType = "chemistry.molecule3d",
                artifactTitle = "Ethanol molecule",
                artifactSummary = "XYZ, 9 atoms, 1 frame",
                hasRenderer = true,
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
}
