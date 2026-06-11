package com.remotecodex.android.thread

import com.remotecodex.android.api.SupervisorThreadActionRequest
import com.remotecodex.android.api.SupervisorThreadDetail
import com.remotecodex.android.api.SupervisorThreadEvent
import com.remotecodex.android.api.SupervisorThreadTurn
import com.remotecodex.android.api.SupervisorThreadTurnItem
import com.remotecodex.android.api.toThreadActionRequest
import com.remotecodex.android.api.toThreadTurnItem
import com.remotecodex.android.api.toThreadTurnTokenUsage
import org.json.JSONObject

data class ThreadEventReduceResult(
    val detail: SupervisorThreadDetail,
    val needsRefresh: Boolean = false,
)

fun reduceThreadEvent(
    detail: SupervisorThreadDetail,
    event: SupervisorThreadEvent,
): ThreadEventReduceResult {
    if (event.threadId != detail.thread.id) {
        return ThreadEventReduceResult(detail = detail)
    }
    return when (event.type) {
        "thread.updated" -> reduceThreadUpdated(detail, event)
        "thread.goal.updated" -> reduceGoalUpdated(detail, event.payload)
        "thread.goal.cleared" -> ThreadEventReduceResult(
            detail = detail.copy(goalStatus = null, goalObjective = null),
        )
        "thread.turn.started" -> reduceTurnStarted(detail, event)
        "thread.turn.completed",
        "thread.turn.failed",
        -> reduceTurnFinished(detail, event)
        "thread.turn.token.updated" -> reduceTurnTokenUpdated(detail, event.payload)
        "thread.item.started",
        "thread.item.completed",
        -> reduceThreadItem(detail, event.payload)
        "thread.request.created" -> reduceRequestCreated(detail, event.payload)
        "thread.request.resolved" -> reduceRequestResolved(detail, event.payload)
        "thread.output.delta",
        "thread.context.updated",
        "thread.plan.updated",
        -> ThreadEventReduceResult(detail = detail, needsRefresh = true)
        else -> ThreadEventReduceResult(detail = detail, needsRefresh = true)
    }
}

private fun reduceThreadUpdated(
    detail: SupervisorThreadDetail,
    event: SupervisorThreadEvent,
): ThreadEventReduceResult {
    val payload = event.payload
    val nextThread = detail.thread.copy(
        title = payload.optNullableString("title") ?: detail.thread.title,
        status = payload.optNullableString("status") ?: detail.thread.status,
        model = if (payload.has("model")) payload.optNullableString("model") else detail.thread.model,
        reasoningEffort = if (payload.has("reasoningEffort")) {
            payload.optNullableString("reasoningEffort")
        } else {
            detail.thread.reasoningEffort
        },
        fastMode = if (payload.has("fastMode") && !payload.isNull("fastMode")) {
            payload.optBoolean("fastMode")
        } else {
            detail.thread.fastMode
        },
        collaborationMode = payload.optNullableString("collaborationMode") ?: detail.thread.collaborationMode,
        sandboxMode = if (payload.has("sandboxMode")) payload.optNullableString("sandboxMode") else detail.thread.sandboxMode,
        updatedAt = event.timestamp ?: detail.thread.updatedAt,
    )
    return ThreadEventReduceResult(detail = detail.copy(thread = nextThread))
}

private fun reduceGoalUpdated(
    detail: SupervisorThreadDetail,
    payload: JSONObject,
): ThreadEventReduceResult {
    val goal = payload.optJSONObject("goal")
    return ThreadEventReduceResult(
        detail = detail.copy(
            goalStatus = goal?.optNullableString("status"),
            goalObjective = goal?.optNullableString("objective"),
        ),
    )
}

private fun reduceTurnStarted(
    detail: SupervisorThreadDetail,
    event: SupervisorThreadEvent,
): ThreadEventReduceResult {
    val turnId = event.payload.optString("turnId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(detail = detail, needsRefresh = true)
    if (detail.turns.any { it.id == turnId }) {
        return ThreadEventReduceResult(detail = detail)
    }
    val turn = SupervisorThreadTurn(
        id = turnId,
        startedAt = event.timestamp,
        status = "running",
        error = null,
        model = detail.thread.model,
        tokenUsage = null,
        items = emptyList(),
    )
    return ThreadEventReduceResult(
        detail = detail.copy(
            turns = detail.turns + turn,
            turnCount = maxOf(detail.turnCount, detail.turns.size + 1),
            thread = detail.thread.copy(status = "running", updatedAt = event.timestamp ?: detail.thread.updatedAt),
        ),
    )
}

private fun reduceTurnFinished(
    detail: SupervisorThreadDetail,
    event: SupervisorThreadEvent,
): ThreadEventReduceResult {
    val turnId = event.payload.optString("turnId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(detail = detail, needsRefresh = true)
    val status = event.payload.optNullableString("status")
        ?: if (event.type == "thread.turn.failed") "failed" else null
    val error = event.payload.optNullableString("error")
    var changed = false
    val turns = detail.turns.map { turn ->
        if (turn.id == turnId) {
            changed = true
            turn.copy(
                status = status ?: turn.status,
                error = error,
            )
        } else {
            turn
        }
    }
    if (!changed) {
        return ThreadEventReduceResult(detail = detail, needsRefresh = true)
    }
    return ThreadEventReduceResult(
        detail = detail.copy(
            turns = turns,
            thread = detail.thread.copy(
                status = status ?: detail.thread.status,
                updatedAt = event.timestamp ?: detail.thread.updatedAt,
            ),
        ),
    )
}

private fun reduceTurnTokenUpdated(
    detail: SupervisorThreadDetail,
    payload: JSONObject,
): ThreadEventReduceResult {
    val turnId = payload.optString("turnId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(detail = detail, needsRefresh = true)
    val tokenUsage = payload.optJSONObject("tokenUsage")?.toThreadTurnTokenUsage()
        ?: return ThreadEventReduceResult(detail = detail, needsRefresh = true)
    var changed = false
    val turns = detail.turns.map { turn ->
        if (turn.id == turnId) {
            changed = true
            turn.copy(tokenUsage = tokenUsage)
        } else {
            turn
        }
    }
    return ThreadEventReduceResult(
        detail = detail.copy(turns = turns),
        needsRefresh = !changed,
    )
}

private fun reduceThreadItem(
    detail: SupervisorThreadDetail,
    payload: JSONObject,
): ThreadEventReduceResult {
    val turnId = payload.optString("turnId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(detail = detail, needsRefresh = true)
    val item = payload.optJSONObject("item")?.toThreadTurnItem()
        ?: return ThreadEventReduceResult(detail = detail, needsRefresh = true)
    var changed = false
    val turns = detail.turns.map { turn ->
        if (turn.id == turnId) {
            changed = true
            turn.copy(items = upsertItem(turn.items, item))
        } else {
            turn
        }
    }
    return ThreadEventReduceResult(
        detail = detail.copy(turns = turns),
        needsRefresh = !changed,
    )
}

private fun reduceRequestCreated(
    detail: SupervisorThreadDetail,
    payload: JSONObject,
): ThreadEventReduceResult {
    val request = payload.optJSONObject("request")?.toThreadActionRequest()
        ?: return ThreadEventReduceResult(detail = detail, needsRefresh = true)
    return ThreadEventReduceResult(
        detail = detail.copy(
            pendingRequests = upsertRequest(detail.pendingRequests, request),
        ),
    )
}

private fun reduceRequestResolved(
    detail: SupervisorThreadDetail,
    payload: JSONObject,
): ThreadEventReduceResult {
    val requestId = payload.optString("requestId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(detail = detail, needsRefresh = true)
    return ThreadEventReduceResult(
        detail = detail.copy(
            pendingRequests = detail.pendingRequests.filterNot { it.id == requestId },
        ),
        needsRefresh = true,
    )
}

private fun upsertItem(
    items: List<SupervisorThreadTurnItem>,
    item: SupervisorThreadTurnItem,
): List<SupervisorThreadTurnItem> {
    var replaced = false
    val next = items.map { existing ->
        if (existing.id == item.id) {
            replaced = true
            item
        } else {
            existing
        }
    }
    return if (replaced) next else next + item
}

private fun upsertRequest(
    requests: List<SupervisorThreadActionRequest>,
    request: SupervisorThreadActionRequest,
): List<SupervisorThreadActionRequest> {
    var replaced = false
    val next = requests.map { existing ->
        if (existing.id == request.id) {
            replaced = true
            request
        } else {
            existing
        }
    }
    return if (replaced) next else next + request
}

private fun JSONObject.optNullableString(name: String): String? {
    return if (has(name) && !isNull(name)) optString(name) else null
}
