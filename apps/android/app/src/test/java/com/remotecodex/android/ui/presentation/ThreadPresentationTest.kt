package com.remotecodex.android.ui.presentation

import com.remotecodex.android.ui.model.HistoryItemKind
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
    fun summarizesHookOutputWithHookLabelAndGap() {
        assertEquals(
            HookHistorySummary(
                hookLabel = "PreToolUse hook",
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
