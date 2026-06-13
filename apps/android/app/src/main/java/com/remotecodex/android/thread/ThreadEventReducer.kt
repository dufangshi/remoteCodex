package com.remotecodex.android.thread

import com.remotecodex.android.api.SupervisorThreadActionRequest
import com.remotecodex.android.api.SupervisorThreadAnsweredRequestNote
import com.remotecodex.android.api.SupervisorThreadDetail
import com.remotecodex.android.api.SupervisorThreadEvent
import com.remotecodex.android.api.SupervisorThreadTurn
import com.remotecodex.android.api.SupervisorThreadTurnItem
import com.remotecodex.android.api.toThreadContextUsage
import com.remotecodex.android.api.toThreadActionRequest
import com.remotecodex.android.api.toThreadTurnItem
import com.remotecodex.android.api.toThreadTurnTokenUsage
import org.json.JSONObject

data class ThreadProjectionState(
    val detail: SupervisorThreadDetail,
    val seenOutputDeltaKeys: Set<String> = emptySet(),
    val provisionalAnsweredRequestNotes: Map<String, SupervisorThreadAnsweredRequestNote> = emptyMap(),
    val seenEventKeys: Set<String> = emptySet(),
    val lastEventCursor: String? = null,
)

data class ThreadEventReduceResult(
    val state: ThreadProjectionState,
    val needsRefresh: Boolean = false,
) {
    val detail: SupervisorThreadDetail
        get() = state.detail
}

fun reduceThreadEvent(
    detail: SupervisorThreadDetail,
    event: SupervisorThreadEvent,
): ThreadEventReduceResult {
    return reduceThreadEvent(
        state = ThreadProjectionState(detail = detail),
        event = event,
    )
}

fun reduceThreadEvent(
    state: ThreadProjectionState,
    event: SupervisorThreadEvent,
): ThreadEventReduceResult {
    val detail = state.detail
    if (event.threadId != detail.thread.id) {
        return ThreadEventReduceResult(state = state)
    }
    val eventKey = event.stableEventKey()
    if (eventKey in state.seenEventKeys) {
        return ThreadEventReduceResult(state = state)
    }
    val nextBaseState = state.copy(
        seenEventKeys = (state.seenEventKeys + eventKey).takeLastEventKeys(),
        lastEventCursor = event.cursor ?: event.eventId ?: event.sequence?.toString() ?: state.lastEventCursor,
    )
    return when (event.type) {
        "thread.updated" -> reduceThreadUpdated(nextBaseState, event)
        "thread.goal.updated" -> reduceGoalUpdated(nextBaseState, event.payload)
        "thread.goal.cleared" -> ThreadEventReduceResult(
            state = nextBaseState.withDetail(detail.copy(goalStatus = null, goalObjective = null)),
        )
        "thread.turn.started" -> reduceTurnStarted(nextBaseState, event)
        "thread.turn.completed",
        "thread.turn.failed",
        -> reduceTurnFinished(nextBaseState, event)
        "thread.turn.token.updated" -> reduceTurnTokenUpdated(nextBaseState, event.payload)
        "thread.item.started",
        "thread.item.completed",
        -> reduceThreadItem(nextBaseState, event.payload)
        "thread.request.created" -> reduceRequestCreated(nextBaseState, event.payload)
        "thread.request.resolved" -> reduceRequestResolved(nextBaseState, event)
        "thread.output.delta" -> reduceOutputDelta(nextBaseState, event.payload)
        "thread.context.updated" -> reduceContextUpdated(nextBaseState, event.payload)
        "thread.plan.updated" -> ThreadEventReduceResult(state = nextBaseState, needsRefresh = true)
        else -> ThreadEventReduceResult(state = nextBaseState, needsRefresh = true)
    }
}

private fun reduceThreadUpdated(
    state: ThreadProjectionState,
    event: SupervisorThreadEvent,
): ThreadEventReduceResult {
    val detail = state.detail
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
    return ThreadEventReduceResult(state = state.withDetail(detail.copy(thread = nextThread)))
}

private fun reduceGoalUpdated(
    state: ThreadProjectionState,
    payload: JSONObject,
): ThreadEventReduceResult {
    val goal = payload.optJSONObject("goal")
    return ThreadEventReduceResult(
        state = state.withDetail(state.detail.copy(
            goalStatus = goal?.optNullableString("status"),
            goalObjective = goal?.optNullableString("objective"),
        )),
    )
}

private fun reduceTurnStarted(
    state: ThreadProjectionState,
    event: SupervisorThreadEvent,
): ThreadEventReduceResult {
    val detail = state.detail
    val turnId = event.payload.optString("turnId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
    if (detail.turns.any { it.id == turnId }) {
        return ThreadEventReduceResult(state = state)
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
        state = state.withDetail(detail.copy(
            turns = detail.turns + turn,
            turnCount = maxOf(detail.turnCount, detail.turns.size + 1),
            totalTurnCount = maxOf(detail.totalTurnCount, detail.turns.size + 1),
            thread = detail.thread.copy(status = "running", updatedAt = event.timestamp ?: detail.thread.updatedAt),
        )),
    )
}

private fun reduceTurnFinished(
    state: ThreadProjectionState,
    event: SupervisorThreadEvent,
): ThreadEventReduceResult {
    val detail = state.detail
    val turnId = event.payload.optString("turnId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
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
        return ThreadEventReduceResult(state = state, needsRefresh = true)
    }
    return ThreadEventReduceResult(
        state = state.withDetail(detail.copy(
            turns = turns,
            thread = detail.thread.copy(
                status = status ?: detail.thread.status,
                updatedAt = event.timestamp ?: detail.thread.updatedAt,
            ),
        )),
    )
}

private fun reduceTurnTokenUpdated(
    state: ThreadProjectionState,
    payload: JSONObject,
): ThreadEventReduceResult {
    val detail = state.detail
    val turnId = payload.optString("turnId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
    val tokenUsage = payload.optJSONObject("tokenUsage")?.toThreadTurnTokenUsage()
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
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
        state = state.withDetail(detail.copy(turns = turns)),
        needsRefresh = !changed,
    )
}

private fun reduceContextUpdated(
    state: ThreadProjectionState,
    payload: JSONObject,
): ThreadEventReduceResult {
    val usage = payload.optJSONObject("contextUsage")?.toThreadContextUsage()
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
    return ThreadEventReduceResult(
        state = state.withDetail(state.detail.copy(contextUsage = usage)),
    )
}

private fun reduceThreadItem(
    state: ThreadProjectionState,
    payload: JSONObject,
): ThreadEventReduceResult {
    val detail = state.detail
    val turnId = payload.optString("turnId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
    val item = payload.optJSONObject("item")?.toThreadTurnItem()
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
    var changed = false
    val turns = detail.turns.map { turn ->
        if (turn.id == turnId) {
            changed = true
            turn.copy(items = upsertItem(
                items = turn.items,
                item = item,
                protectedItemIds = state.seenOutputDeltaKeys.deltaItemIds(),
            ))
        } else {
            turn
        }
    }
    return ThreadEventReduceResult(
        state = state.withDetail(detail.copy(turns = turns)),
        needsRefresh = !changed,
    )
}

private fun reduceRequestCreated(
    state: ThreadProjectionState,
    payload: JSONObject,
): ThreadEventReduceResult {
    val detail = state.detail
    val request = payload.optJSONObject("request")?.toThreadActionRequest()
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
    return ThreadEventReduceResult(
        state = state.withDetail(detail.copy(
            pendingRequests = upsertRequest(detail.pendingRequests, request),
        )),
    )
}

private fun reduceRequestResolved(
    state: ThreadProjectionState,
    event: SupervisorThreadEvent,
): ThreadEventReduceResult {
    val detail = state.detail
    val payload = event.payload
    val requestId = payload.optString("requestId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
    val request = detail.pendingRequests.firstOrNull { it.id == requestId }
    val answeredNote = request?.toResolvedAnsweredNote(
        requestId = requestId,
        timestamp = payload.optNullableString("createdAt")
            ?: payload.optNullableString("resolvedAt")
            ?: event.timestamp,
        summaryLines = payload.optJSONArray("summaryLines")?.toStringList(),
    )
    val nextDetail = detail.copy(
        pendingRequests = detail.pendingRequests.filterNot { it.id == requestId },
        answeredRequestNotes = if (answeredNote == null) {
            detail.answeredRequestNotes
        } else {
            upsertAnsweredRequestNote(detail.answeredRequestNotes, answeredNote)
        },
    )
    return ThreadEventReduceResult(
        state = state.copy(
            detail = nextDetail,
            provisionalAnsweredRequestNotes = if (answeredNote == null) {
                state.provisionalAnsweredRequestNotes
            } else {
                state.provisionalAnsweredRequestNotes + (requestId to answeredNote)
            },
        ),
        needsRefresh = true,
    )
}

private fun reduceOutputDelta(
    state: ThreadProjectionState,
    payload: JSONObject,
): ThreadEventReduceResult {
    val detail = state.detail
    val turnId = payload.optString("turnId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
    val itemId = payload.optString("itemId").takeIf { it.isNotBlank() }
        ?: return ThreadEventReduceResult(state = state, needsRefresh = true)
    val sequence = if (payload.has("sequence") && !payload.isNull("sequence")) {
        payload.optInt("sequence")
    } else {
        return ThreadEventReduceResult(state = state, needsRefresh = true)
    }
    val delta = payload.optString("delta")
    val key = "$turnId:$itemId:$sequence"
    if (key in state.seenOutputDeltaKeys) {
        return ThreadEventReduceResult(state = state)
    }

    var changed = false
    val turns = detail.turns.map { turn ->
        if (turn.id == turnId) {
            changed = true
            turn.copy(items = appendOutputDelta(turn.items, itemId, sequence, delta))
        } else {
            turn
        }
    }
    if (!changed) {
        val turn = SupervisorThreadTurn(
            id = turnId,
            startedAt = null,
            status = "running",
            error = null,
            model = detail.thread.model,
            tokenUsage = null,
            items = appendOutputDelta(emptyList(), itemId, sequence, delta),
        )
        return ThreadEventReduceResult(
            state = state.copy(
                detail = detail.copy(
                    turns = detail.turns + turn,
                    turnCount = maxOf(detail.turnCount, detail.turns.size + 1),
                    totalTurnCount = maxOf(detail.totalTurnCount, detail.turns.size + 1),
                    liveItemCount = maxOf(detail.liveItemCount, 1),
                    thread = detail.thread.copy(status = "running"),
                ),
                seenOutputDeltaKeys = state.seenOutputDeltaKeys + key,
            ),
            needsRefresh = true,
        )
    }
    return ThreadEventReduceResult(
        state = state.copy(
            detail = detail.copy(
                turns = turns,
                liveItemCount = maxOf(detail.liveItemCount, 1),
                thread = detail.thread.copy(status = "running"),
            ),
            seenOutputDeltaKeys = state.seenOutputDeltaKeys + key,
        ),
    )
}

private fun appendOutputDelta(
    items: List<SupervisorThreadTurnItem>,
    itemId: String,
    sequence: Int,
    delta: String,
): List<SupervisorThreadTurnItem> {
    var changed = false
    val next = items.map { item ->
        if (item.id == itemId) {
            changed = true
            item.copy(
                text = item.text + delta,
                status = item.status ?: "running",
            )
        } else {
            item
        }
    }
    if (changed) {
        return next
    }
    return (next + SupervisorThreadTurnItem(
        id = itemId,
        kind = "agentMessage",
        text = delta,
        status = "running",
        sequence = sequence,
    )).sortBySequence()
}

private fun upsertItem(
    items: List<SupervisorThreadTurnItem>,
    item: SupervisorThreadTurnItem,
    protectedItemIds: Set<String>,
): List<SupervisorThreadTurnItem> {
    var replaced = false
    val next = items.map { existing ->
        if (existing.id == item.id) {
            replaced = true
            mergeTurnItem(
                serverItem = item,
                localItem = existing,
                protectLocalText = existing.id in protectedItemIds,
            )
        } else {
            existing
        }
    }
    return (if (replaced) next else next + item).sortBySequence()
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

private fun upsertAnsweredRequestNote(
    notes: List<SupervisorThreadAnsweredRequestNote>,
    note: SupervisorThreadAnsweredRequestNote,
): List<SupervisorThreadAnsweredRequestNote> {
    var replaced = false
    val next = notes.map { existing ->
        if (existing.id == note.id) {
            replaced = true
            note
        } else {
            existing
        }
    }
    return if (replaced) next else next + note
}

private fun SupervisorThreadActionRequest.toResolvedAnsweredNote(
    requestId: String,
    timestamp: String?,
    summaryLines: List<String>?,
): SupervisorThreadAnsweredRequestNote {
    return SupervisorThreadAnsweredRequestNote(
        id = requestId,
        title = title.ifBlank { "Request resolved" },
        summaryLines = summaryLines
            ?.map { line -> line.trim() }
            ?.filter { line -> line.isNotEmpty() }
            ?.takeIf { it.isNotEmpty() }
            ?: listOf("Resolved"),
        createdAt = timestamp ?: createdAt,
        turnId = turnId,
        itemId = itemId,
    )
}

private fun org.json.JSONArray.toStringList(): List<String> {
    return List(length()) { index -> optString(index) }
}

fun ThreadProjectionState.reconcileWithDetail(detail: SupervisorThreadDetail): ThreadProjectionState {
    return withDetail(mergeDetailWithLocalProjection(detail), provisionalAnsweredRequestNotes = provisionalAnsweredRequestNotes)
}

private fun ThreadProjectionState.mergeDetailWithLocalProjection(
    serverDetail: SupervisorThreadDetail,
): SupervisorThreadDetail {
    val localTurnsById = detail.turns.associateBy { turn -> turn.id }
    val serverTurnIds = serverDetail.turns.map { turn -> turn.id }.toSet()
    val protectedItemIds = seenOutputDeltaKeys.deltaItemIds()
    val mergedServerTurns = serverDetail.turns.map { serverTurn ->
        val localTurn = localTurnsById[serverTurn.id] ?: return@map serverTurn
        serverTurn.copy(items = mergeTurnItems(
            serverItems = serverTurn.items,
            localItems = localTurn.items,
            protectedItemIds = protectedItemIds,
            serverTurnCompleted = serverTurn.status == "completed" || serverTurn.status == "failed",
        ))
    }
    val localOnlyTurns = detail.turns.filter { localTurn ->
        localTurn.id !in serverTurnIds && localTurn.shouldRetainAcrossRefresh(protectedItemIds)
    }
    val mergedTurns = (mergedServerTurns + localOnlyTurns).sortTurnsByExistingOrder(
        localTurns = detail.turns,
        serverTurns = serverDetail.turns,
    )
    return serverDetail.copy(
        turns = mergedTurns,
        turnCount = maxOf(serverDetail.turnCount, mergedTurns.size),
        totalTurnCount = maxOf(serverDetail.totalTurnCount, detail.totalTurnCount, mergedTurns.size),
        liveItemCount = maxOf(serverDetail.liveItemCount, detail.liveItemCount),
    )
}

private fun mergeTurnItems(
    serverItems: List<SupervisorThreadTurnItem>,
    localItems: List<SupervisorThreadTurnItem>,
    protectedItemIds: Set<String>,
    serverTurnCompleted: Boolean,
): List<SupervisorThreadTurnItem> {
    if (localItems.isEmpty()) {
        return serverItems
    }
    val localItemsById = localItems.associateBy { item -> item.id }
    val serverItemIds = serverItems.map { item -> item.id }.toSet()
    val mergedServerItems = serverItems.map { serverItem ->
        val localItem = localItemsById[serverItem.id] ?: return@map serverItem
        mergeTurnItem(
            serverItem = serverItem,
            localItem = localItem,
            protectLocalText = localItem.id in protectedItemIds,
        )
    }
    val localOnlyItems = localItems.filter { localItem ->
        if (localItem.id in serverItemIds) {
            return@filter false
        }
        val protectCompleted = localItem.id in protectedItemIds
        localItem.shouldRetainAcrossRefresh(protectCompleted = protectCompleted) &&
            !localItem.isSupersededByCompletedServerTurn(serverItems, serverTurnCompleted)
    }
    return (mergedServerItems + localOnlyItems).sortBySequence()
}

private fun SupervisorThreadTurnItem.isSupersededByCompletedServerTurn(
    serverItems: List<SupervisorThreadTurnItem>,
    serverTurnCompleted: Boolean,
): Boolean {
    if (!serverTurnCompleted || kind != "agentMessage") {
        return false
    }
    val localSequence = sequence
    return serverItems.any { serverItem ->
        serverItem.kind == "agentMessage" &&
            serverItem.text.isNotBlank() &&
            (
                localSequence == null ||
                    serverItem.sequence == localSequence ||
                    (serverItem.sequence != null && serverItem.sequence >= localSequence)
            )
    }
}

private fun mergeTurnItem(
    serverItem: SupervisorThreadTurnItem,
    localItem: SupervisorThreadTurnItem,
    protectLocalText: Boolean,
): SupervisorThreadTurnItem {
    if (!protectLocalText || !localItem.shouldRetainAcrossRefresh(protectCompleted = true)) {
        return serverItem
    }
    if (serverItem.text.length >= localItem.text.length) {
        return serverItem
    }
    return serverItem.copy(
        text = localItem.text,
        previewText = localItem.previewText ?: serverItem.previewText,
        detailText = localItem.detailText ?: serverItem.detailText,
        status = serverItem.status ?: localItem.status,
    )
}

private fun SupervisorThreadTurn.shouldRetainAcrossRefresh(protectedItemIds: Set<String> = emptySet()): Boolean {
    return status == "running" || items.any { item ->
        item.shouldRetainAcrossRefresh(protectCompleted = item.id in protectedItemIds)
    }
}

private fun SupervisorThreadTurnItem.shouldRetainAcrossRefresh(protectCompleted: Boolean = false): Boolean {
    return kind == "agentMessage" && text.isNotBlank() && (protectCompleted || status != "completed")
}

private fun Set<String>.deltaItemIds(): Set<String> {
    return mapNotNull { key ->
        val parts = key.split(':')
        parts.getOrNull(1)
    }.toSet()
}

private fun List<SupervisorThreadTurn>.sortTurnsByExistingOrder(
    localTurns: List<SupervisorThreadTurn>,
    serverTurns: List<SupervisorThreadTurn>,
): List<SupervisorThreadTurn> {
    val order = buildMap {
        serverTurns.forEachIndexed { index, turn -> put(turn.id, index) }
        localTurns.forEachIndexed { index, turn -> putIfAbsent(turn.id, serverTurns.size + index) }
    }
    return sortedBy { turn -> order[turn.id] ?: Int.MAX_VALUE }
}

private fun ThreadProjectionState.withDetail(
    detail: SupervisorThreadDetail,
    provisionalAnsweredRequestNotes: Map<String, SupervisorThreadAnsweredRequestNote> = this.provisionalAnsweredRequestNotes,
): ThreadProjectionState {
    val serverAnsweredIds = detail.answeredRequestNotes.map { note -> note.id }.toSet()
    val retainedProvisionalNotes = provisionalAnsweredRequestNotes.filterKeys { requestId ->
        requestId !in serverAnsweredIds
    }
    val reconciledDetail = if (retainedProvisionalNotes.isEmpty()) {
        detail
    } else {
        detail.copy(
            answeredRequestNotes = detail.answeredRequestNotes + retainedProvisionalNotes.values,
        )
    }
    val liveIds = detail.turns
        .asSequence()
        .flatMap { turn -> turn.items.asSequence().map { item -> "${turn.id}:${item.id}:" } }
        .toList()
    val retainedDeltaKeys = seenOutputDeltaKeys.filter { key ->
        liveIds.any { prefix -> key.startsWith(prefix) }
    }.toSet()
    return copy(
        detail = reconciledDetail,
        seenOutputDeltaKeys = retainedDeltaKeys,
        provisionalAnsweredRequestNotes = retainedProvisionalNotes,
    )
}

private fun List<SupervisorThreadTurnItem>.sortBySequence(): List<SupervisorThreadTurnItem> {
    return mapIndexed { index, item -> index to item }
        .sortedWith(
            compareBy<Pair<Int, SupervisorThreadTurnItem>>(
                { (_, item) -> if (item.kind == "userMessage") 0 else 1 },
                { (_, item) -> item.sequence ?: Int.MAX_VALUE },
                { (index, _) -> index },
            ),
        )
        .map { (_, item) -> item }
}

private fun SupervisorThreadEvent.stableEventKey(): String {
    eventId?.takeIf { it.isNotBlank() }?.let { return "event-id:$it" }
    cursor?.takeIf { it.isNotBlank() }?.let { return "cursor:$it" }
    sequence?.let { return "sequence:$threadId:$it" }
    return when (type) {
        "thread.output.delta" -> {
            val turnId = payload.optString("turnId")
            val itemId = payload.optString("itemId")
            val itemSequence = payload.optNullableInt("sequence")
            val deltaHash = payload.optString("delta").hashCode()
            "$type:$threadId:$turnId:$itemId:$itemSequence:$deltaHash"
        }
        "thread.item.started",
        "thread.item.completed",
        -> {
            val turnId = payload.optString("turnId")
            val itemId = payload.optJSONObject("item")?.optString("id").orEmpty()
            "$type:$threadId:$turnId:$itemId:${timestamp.orEmpty()}"
        }
        "thread.request.created" -> {
            val requestId = payload.optJSONObject("request")?.optString("id").orEmpty()
            "$type:$threadId:$requestId:${timestamp.orEmpty()}"
        }
        "thread.request.resolved" -> {
            "$type:$threadId:${payload.optString("requestId")}:${timestamp.orEmpty()}"
        }
        else -> "$type:$threadId:${timestamp.orEmpty()}:${payload.toString().hashCode()}"
    }
}

private fun Set<String>.takeLastEventKeys(limit: Int = 512): Set<String> {
    if (size <= limit) {
        return this
    }
    return toList().takeLast(limit).toSet()
}

private fun JSONObject.optNullableString(name: String): String? {
    return if (has(name) && !isNull(name)) optString(name) else null
}

private fun JSONObject.optNullableInt(name: String): Int? {
    return if (has(name) && !isNull(name)) optInt(name) else null
}
