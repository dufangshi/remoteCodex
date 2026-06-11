package com.remotecodex.android.thread

import com.remotecodex.android.api.SupervisorThreadActionRequest
import com.remotecodex.android.api.SupervisorThreadDetail
import com.remotecodex.android.api.SupervisorThreadEvent
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorThreadTurn
import com.remotecodex.android.api.SupervisorThreadTurnItem
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreadEventReducerTest {
    @Test
    fun threadUpdatedAppliesStatusTitleAndSettingsLocally() {
        val result = reduceThreadEvent(
            detail = baseDetail(),
            event = event(
                type = "thread.updated",
                payload = """
                    {
                      "status": "running",
                      "title": "Renamed",
                      "model": "gpt-5.1",
                      "reasoningEffort": "high",
                      "fastMode": true,
                      "collaborationMode": "plan",
                      "sandboxMode": "read-only"
                    }
                """.trimIndent(),
            ),
        )

        assertFalse(result.needsRefresh)
        assertEquals("running", result.detail.thread.status)
        assertEquals("Renamed", result.detail.thread.title)
        assertEquals("gpt-5.1", result.detail.thread.model)
        assertEquals("high", result.detail.thread.reasoningEffort)
        assertEquals(true, result.detail.thread.fastMode)
        assertEquals("plan", result.detail.thread.collaborationMode)
        assertEquals("read-only", result.detail.thread.sandboxMode)
        assertEquals("2026-06-11T12:00:10.000Z", result.detail.thread.updatedAt)
    }

    @Test
    fun requestCreatedUpsertsAndRequestResolvedRemovesWithRefreshHint() {
        val created = reduceThreadEvent(
            detail = baseDetail(),
            event = event(
                type = "thread.request.created",
                payload = """
                    {
                      "request": {
                        "id": "request-1",
                        "kind": "requestUserInput",
                        "title": "Choose",
                        "description": "Pick one",
                        "createdAt": "2026-06-11T12:00:11.000Z",
                        "questions": [
                          {
                            "id": "question-1",
                            "header": "Mode",
                            "question": "Which mode?",
                            "multiSelect": false,
                            "isOther": true,
                            "options": [
                              {"label": "Continue", "description": "Proceed"}
                            ]
                          }
                        ]
                      }
                    }
                """.trimIndent(),
            ),
        )

        assertFalse(created.needsRefresh)
        assertEquals(1, created.detail.pendingRequests.size)
        assertEquals("request-1", created.detail.pendingRequests.single().id)
        assertEquals("Which mode?", created.detail.pendingRequests.single().questions.single().question)

        val resolved = reduceThreadEvent(
            detail = created.detail,
            event = event(
                type = "thread.request.resolved",
                payload = """{"requestId":"request-1"}""",
            ),
        )

        assertTrue(resolved.needsRefresh)
        assertEquals(0, resolved.detail.pendingRequests.size)
    }

    @Test
    fun turnAndItemEventsBuildLocalTimelineWithoutFullRefresh() {
        val started = reduceThreadEvent(
            detail = baseDetail(turns = emptyList()),
            event = event(
                type = "thread.turn.started",
                payload = """{"turnId":"turn-2"}""",
            ),
        )
        assertFalse(started.needsRefresh)
        assertEquals("turn-2", started.detail.turns.single().id)
        assertEquals("running", started.detail.turns.single().status)

        val itemStarted = reduceThreadEvent(
            detail = started.detail,
            event = event(
                type = "thread.item.started",
                payload = """
                    {
                      "turnId": "turn-2",
                      "item": {
                        "id": "item-1",
                        "kind": "agentMessage",
                        "text": "Working",
                        "status": "running"
                      }
                    }
                """.trimIndent(),
            ),
        )
        assertFalse(itemStarted.needsRefresh)
        assertEquals("Working", itemStarted.detail.turns.single().items.single().text)

        val itemCompleted = reduceThreadEvent(
            detail = itemStarted.detail,
            event = event(
                type = "thread.item.completed",
                payload = """
                    {
                      "turnId": "turn-2",
                      "item": {
                        "id": "item-1",
                        "kind": "agentMessage",
                        "text": "Done",
                        "status": "completed"
                      }
                    }
                """.trimIndent(),
            ),
        )
        assertFalse(itemCompleted.needsRefresh)
        assertEquals(1, itemCompleted.detail.turns.single().items.size)
        assertEquals("Done", itemCompleted.detail.turns.single().items.single().text)
        assertEquals("completed", itemCompleted.detail.turns.single().items.single().status)
    }

    @Test
    fun goalAndTurnCompletionApplyLocally() {
        val goal = reduceThreadEvent(
            detail = baseDetail(),
            event = event(
                type = "thread.goal.updated",
                payload = """{"goal":{"status":"active","objective":"Ship Android"}}""",
            ),
        )
        assertEquals("active", goal.detail.goalStatus)
        assertEquals("Ship Android", goal.detail.goalObjective)

        val completed = reduceThreadEvent(
            detail = goal.detail,
            event = event(
                type = "thread.turn.completed",
                payload = """{"turnId":"turn-1","status":"completed","error":null}""",
            ),
        )
        assertFalse(completed.needsRefresh)
        assertEquals("completed", completed.detail.turns.single().status)
        assertNull(completed.detail.turns.single().error)
        assertEquals("completed", completed.detail.thread.status)
    }

    @Test
    fun streamingOutputDeltaAppendsAndDeduplicatesBySequence() {
        val first = reduceThreadEvent(
            detail = baseDetail(),
            event = event(
                type = "thread.output.delta",
                payload = """{"turnId":"turn-1","itemId":"item-1","sequence":1,"delta":"hello"}""",
            ),
        )

        assertFalse(first.needsRefresh)
        assertEquals(2, first.detail.turns.single().items.size)
        assertEquals("hello", first.detail.turns.single().items.last().text)
        assertEquals("running", first.detail.turns.single().items.last().status)

        val duplicate = reduceThreadEvent(
            state = first.state,
            event = event(
                type = "thread.output.delta",
                payload = """{"turnId":"turn-1","itemId":"item-1","sequence":1,"delta":"hello"}""",
            ),
        )
        assertFalse(duplicate.needsRefresh)
        assertEquals("hello", duplicate.detail.turns.single().items.last().text)

        val second = reduceThreadEvent(
            state = duplicate.state,
            event = event(
                type = "thread.output.delta",
                payload = """{"turnId":"turn-1","itemId":"item-1","sequence":2,"delta":" world"}""",
            ),
        )
        assertFalse(second.needsRefresh)
        assertEquals("hello world", second.detail.turns.single().items.last().text)
    }

    @Test
    fun materializedItemReplacesStreamingItemWithoutDuplication() {
        val streaming = reduceThreadEvent(
            detail = baseDetail(),
            event = event(
                type = "thread.output.delta",
                payload = """{"turnId":"turn-1","itemId":"item-1","sequence":1,"delta":"partial"}""",
            ),
        )

        val completed = reduceThreadEvent(
            state = streaming.state,
            event = event(
                type = "thread.item.completed",
                payload = """
                    {
                      "turnId": "turn-1",
                      "item": {
                        "id": "item-1",
                        "kind": "agentMessage",
                        "text": "complete",
                        "status": "completed"
                      }
                    }
                """.trimIndent(),
            ),
        )

        assertFalse(completed.needsRefresh)
        assertEquals(2, completed.detail.turns.single().items.size)
        assertEquals("complete", completed.detail.turns.single().items.last().text)
        assertEquals("completed", completed.detail.turns.single().items.last().status)
    }

    @Test
    fun outputDeltaForMissingTurnFallsBackToRefresh() {
        val result = reduceThreadEvent(
            detail = baseDetail(),
            event = event(
                type = "thread.output.delta",
                payload = """{"turnId":"missing","itemId":"item-1","sequence":1,"delta":"hello"}""",
            ),
        )

        assertTrue(result.needsRefresh)
        assertEquals(baseDetail().turns, result.detail.turns)
    }

    @Test
    fun contextAndPlanEventsStillUseAggregateRefreshFallback() {
        val result = reduceThreadEvent(
            detail = baseDetail(),
            event = event(
                type = "thread.plan.updated",
                payload = """{"turnId":"turn-1","explanation":"Plan","plan":[]}""",
            ),
        )

        assertTrue(result.needsRefresh)
    }

    private fun event(type: String, payload: String): SupervisorThreadEvent {
        return SupervisorThreadEvent(
            type = type,
            threadId = "thread-1",
            timestamp = "2026-06-11T12:00:10.000Z",
            payload = JSONObject(payload),
        )
    }

    private fun baseDetail(
        turns: List<SupervisorThreadTurn> = listOf(
            SupervisorThreadTurn(
                id = "turn-1",
                startedAt = "2026-06-11T12:00:00.000Z",
                status = "running",
                error = "old",
                model = "gpt-5",
                tokenUsage = null,
                items = listOf(
                    SupervisorThreadTurnItem(
                        id = "item-0",
                        kind = "userMessage",
                        text = "Start",
                    ),
                ),
            ),
        ),
        pendingRequests: List<SupervisorThreadActionRequest> = emptyList(),
    ): SupervisorThreadDetail {
        return SupervisorThreadDetail(
            thread = SupervisorThreadSummary(
                id = "thread-1",
                workspaceId = "workspace-1",
                title = "Original",
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
            pendingRequests = pendingRequests,
            answeredRequestNotes = emptyList(),
            liveItemCount = 0,
            goalStatus = null,
            goalObjective = null,
        )
    }
}
