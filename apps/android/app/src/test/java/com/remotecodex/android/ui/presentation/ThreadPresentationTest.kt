package com.remotecodex.android.ui.presentation

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
}
