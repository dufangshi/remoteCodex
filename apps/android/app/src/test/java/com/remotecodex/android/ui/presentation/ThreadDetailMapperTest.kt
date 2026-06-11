package com.remotecodex.android.ui.presentation

import com.remotecodex.android.api.SupervisorThreadDetail
import com.remotecodex.android.api.SupervisorThreadActionQuestion
import com.remotecodex.android.api.SupervisorThreadActionQuestionOption
import com.remotecodex.android.api.SupervisorThreadActionRequest
import com.remotecodex.android.api.SupervisorThreadAnsweredRequestNote
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorThreadTurn
import com.remotecodex.android.api.SupervisorThreadTurnItem
import com.remotecodex.android.api.SupervisorThreadTurnTokenUsage
import com.remotecodex.android.api.SupervisorTokenBreakdown
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.ui.model.MessageAuthor
import com.remotecodex.android.ui.model.ThreadStatus
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreadDetailMapperTest {
    @Test
    fun mapsSupervisorDetailIntoNativeThreadPreview() {
        val preview = buildThreadDetailPreviewFromSupervisor(
            detail = SupervisorThreadDetail(
                thread = SupervisorThreadSummary(
                    id = "thread-1",
                    workspaceId = "workspace-1",
                    title = "Android API",
                    status = "running",
                    model = "gpt-5",
                    reasoningEffort = "high",
                    fastMode = true,
                    collaborationMode = "plan",
                    sandboxMode = "danger-full-access",
                    updatedAt = "2026-06-11T18:59:00Z",
                    summaryText = "Wire real detail",
                ),
                workspace = SupervisorWorkspaceSummary(
                    id = "workspace-1",
                    label = "remoteCodex-main",
                    absPath = "/home/u/dev/remoteCodex-main",
                    isFavorite = true,
                    lastOpenedAt = null,
                ),
                turns = listOf(
                    SupervisorThreadTurn(
                        id = "turn-1",
                        startedAt = "2026-06-11T18:58:00Z",
                        status = "completed",
                        error = null,
                        model = "gpt-5",
                        tokenUsage = SupervisorThreadTurnTokenUsage(
                            total = SupervisorTokenBreakdown(
                                inputTokens = 1_200,
                                cachedInputTokens = 300,
                                outputTokens = 456,
                                reasoningOutputTokens = 44,
                            ),
                            last = SupervisorTokenBreakdown(
                                inputTokens = 1_200,
                                cachedInputTokens = 300,
                                outputTokens = 456,
                                reasoningOutputTokens = 44,
                            ),
                            modelContextWindow = 128_000,
                        ),
                        items = listOf(
                            SupervisorThreadTurnItem("item-1", "userMessage", "Continue"),
                            SupervisorThreadTurnItem("item-2", "agentMessage", "Done"),
                            SupervisorThreadTurnItem("item-3", "command", "ignored"),
                        ),
                    ),
                ),
                turnCount = 1,
                pendingRequests = listOf(
                    SupervisorThreadActionRequest(
                        id = "request-1",
                        kind = "requestUserInput",
                        title = "Pick a branch",
                        description = "Choose where to continue.",
                        createdAt = "2026-06-11T18:59:30Z",
                        questions = listOf(
                            SupervisorThreadActionQuestion(
                                id = "question-1",
                                header = "Branch",
                                question = "Which branch?",
                                multiSelect = false,
                                isOther = true,
                                options = listOf(
                                    SupervisorThreadActionQuestionOption(
                                        label = "main",
                                        description = "Use main branch",
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
                answeredRequestNotes = listOf(
                    SupervisorThreadAnsweredRequestNote(
                        id = "answered-1",
                        title = "Branch selected",
                        summaryLines = listOf("main"),
                        createdAt = "2026-06-11T18:59:40Z",
                    ),
                ),
                liveItemCount = 2,
                goalStatus = "active",
                goalObjective = "Ship Android client",
            ),
            now = Instant.parse("2026-06-11T19:00:00Z"),
        )

        assertEquals("Android API", preview.title)
        assertEquals("remoteCodex-main", preview.workspace)
        assertEquals("codex / gpt-5", preview.runtime)
        assertEquals("in 1.5k / out 500", preview.usage)
        assertEquals("5 transcript items", preview.items)
        assertEquals(ThreadStatus.Running, preview.rooms.single().status)
        assertEquals("1m", preview.rooms.single().updatedLabel)
        assertEquals("Goal", preview.timelineAuxiliary.activityNotes.single().title)
        assertEquals("Pick a branch", preview.pendingRequests.single().title)
        assertEquals("question-1", preview.pendingRequests.single().questions.single().id)
        assertEquals("main", preview.pendingRequests.single().questions.single().options.single().label)
        assertEquals("Branch selected", preview.timelineAuxiliary.answeredRequestNotes.single().title)
        assertEquals("Ship Android client", preview.composer.goalPanel.currentGoal?.objective)
        assertEquals("Message Android API...", preview.composer.prompt.placeholder)
        assertEquals("high", preview.composer.reasoningEffort)
        assertTrue(preview.composer.fastMode)
        assertTrue(preview.composer.planModeActive)
        assertEquals("danger-full-access", preview.composer.workspaceModeLabel)

        val turn = preview.turns.single()
        assertEquals("complete", turn.statusLabel)
        assertEquals("in 1.5k / out 500", turn.tokenSummary)
        assertEquals(2, turn.messages.size)
        assertEquals(MessageAuthor.User, turn.messages[0].author)
        assertEquals("Continue", turn.messages[0].text)
        assertEquals(MessageAuthor.Assistant, turn.messages[1].author)
        assertEquals("Done", turn.messages[1].richText)
        assertTrue(preview.workspacePreview.nodes.single().selected)
    }
}
