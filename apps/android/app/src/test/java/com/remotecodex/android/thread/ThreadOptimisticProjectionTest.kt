package com.remotecodex.android.thread

import com.remotecodex.android.api.SupervisorThreadDetail
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorThreadTurn
import com.remotecodex.android.api.SupervisorThreadTurnItem
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreadOptimisticProjectionTest {
    @Test
    fun optimisticPromptAppearsImmediatelyWithAssistantPlaceholder() {
        val projected = applyOptimisticPromptProjection(
            detail = baseDetail(turns = emptyList()),
            optimistic = optimisticPrompt(),
        )

        val turn = projected.turns.single()
        assertEquals("running", turn.status)
        assertEquals(listOf("userMessage", "agentMessage"), turn.items.map { it.kind })
        assertEquals("Run tests", turn.items[0].text)
        assertEquals("", turn.items[1].text)
        assertEquals("running", turn.items[1].status)
    }

    @Test
    fun optimisticPromptIsInjectedBeforeAgentOnlyServerTurn() {
        val projected = applyOptimisticPromptProjection(
            detail = baseDetail(
                turns = listOf(
                    SupervisorThreadTurn(
                        id = "turn-server",
                        startedAt = "2026-06-11T12:00:01.000Z",
                        status = "running",
                        error = null,
                        model = "gpt-5",
                        tokenUsage = null,
                        items = listOf(
                            SupervisorThreadTurnItem(
                                id = "agent-1",
                                kind = "agentMessage",
                                text = "Working",
                                status = "running",
                                sequence = 1,
                            ),
                        ),
                    ),
                ),
            ),
            optimistic = optimisticPrompt(serverTurnId = "turn-server"),
        )

        val turn = projected.turns.single()
        assertEquals(listOf("userMessage", "agentMessage"), turn.items.map { it.kind })
        assertEquals("Run tests", turn.items[0].text)
        assertEquals("Working", turn.items[1].text)
    }

    @Test
    fun materializedMatchingUserMessageClearsOptimisticPrompt() {
        val detail = baseDetail(
            turns = listOf(
                SupervisorThreadTurn(
                    id = "turn-server",
                    startedAt = "2026-06-11T12:00:01.000Z",
                    status = "running",
                    error = null,
                    model = "gpt-5",
                    tokenUsage = null,
                    items = listOf(
                        SupervisorThreadTurnItem(
                            id = "user-1",
                            kind = "userMessage",
                            text = "Run   tests",
                        ),
                        SupervisorThreadTurnItem(
                            id = "agent-1",
                            kind = "agentMessage",
                            text = "Working",
                            status = "running",
                            sequence = 1,
                        ),
                    ),
                ),
            ),
        )

        assertTrue(shouldClearOptimisticPrompt(detail, optimisticPrompt(serverTurnId = "turn-server")))
        val projected = applyOptimisticPromptProjection(detail, null)
        assertEquals(2, projected.turns.single().items.size)
    }

    @Test
    fun failedOptimisticPromptIsNotClearedByMissingServerUserMessage() {
        val failed = optimisticPrompt().withFailure("Network failed")

        assertFalse(shouldClearOptimisticPrompt(baseDetail(turns = emptyList()), failed))
        val projected = applyOptimisticPromptProjection(baseDetail(turns = emptyList()), failed)

        assertEquals("failed", projected.turns.single().status)
        assertEquals("Network failed", projected.turns.single().error)
        assertEquals(listOf("userMessage", "agentMessage"), projected.turns.single().items.map { it.kind })
    }

    private fun optimisticPrompt(serverTurnId: String? = null): OptimisticPromptTurn {
        return OptimisticPromptTurn(
            id = "optimistic-1",
            serverTurnId = serverTurnId,
            prompt = "Run tests",
            startedAt = "2026-06-11T12:00:00.000Z",
            model = "gpt-5",
        )
    }

    private fun baseDetail(turns: List<SupervisorThreadTurn>): SupervisorThreadDetail {
        return SupervisorThreadDetail(
            thread = SupervisorThreadSummary(
                id = "thread-1",
                workspaceId = "workspace-1",
                title = "Thread",
                status = "idle",
                model = "gpt-5",
                reasoningEffort = "medium",
                fastMode = false,
                collaborationMode = "default",
                sandboxMode = "workspace-write",
                updatedAt = "2026-06-11T12:00:00.000Z",
                summaryText = null,
            ),
            workspace = SupervisorWorkspaceSummary(
                id = "workspace-1",
                label = "repo",
                absPath = "/repo",
                isFavorite = false,
                lastOpenedAt = null,
            ),
            turns = turns,
            turnCount = turns.size,
            totalTurnCount = turns.size,
            pendingRequests = emptyList(),
            answeredRequestNotes = emptyList(),
            liveItemCount = 0,
            goalStatus = null,
            goalObjective = null,
        )
    }
}
