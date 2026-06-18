package com.remotecodex.android.thread

import com.remotecodex.android.api.SupervisorThreadDetail
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorThreadTurn
import com.remotecodex.android.api.SupervisorThreadTurnItem

data class OptimisticPromptTurn(
    val id: String,
    val serverTurnId: String? = null,
    val prompt: String,
    val startedAt: String,
    val model: String?,
    val status: OptimisticPromptStatus = OptimisticPromptStatus.Sending,
    val error: String? = null,
)

enum class OptimisticPromptStatus {
    Sending,
    InProgress,
    Failed,
}

fun OptimisticPromptTurn.withAcceptedThread(thread: SupervisorThreadSummary): OptimisticPromptTurn {
    return copy(
        model = thread.model ?: model,
        status = OptimisticPromptStatus.InProgress,
        error = null,
    )
}

fun OptimisticPromptTurn.withStartedTurn(turnId: String): OptimisticPromptTurn {
    return if (serverTurnId == null) {
        copy(serverTurnId = turnId, status = OptimisticPromptStatus.InProgress)
    } else {
        this
    }
}

fun OptimisticPromptTurn.withFailure(message: String): OptimisticPromptTurn {
    return copy(status = OptimisticPromptStatus.Failed, error = message)
}

fun shouldClearOptimisticPrompt(
    detail: SupervisorThreadDetail,
    optimistic: OptimisticPromptTurn?,
): Boolean {
    if (optimistic == null || optimistic.status == OptimisticPromptStatus.Failed) {
        return false
    }
    return detail.turns.any { turn -> turn.matchesOptimisticPrompt(optimistic) && turn.hasMatchingUserMessage(optimistic.prompt) }
}

fun applyOptimisticPromptProjection(
    detail: SupervisorThreadDetail,
    optimistic: OptimisticPromptTurn?,
): SupervisorThreadDetail {
    if (optimistic == null) {
        return detail
    }

    val matchingIndex = detail.turns.indexOfFirst { turn -> turn.matchesOptimisticPrompt(optimistic) }
    val optimisticTurn = optimistic.toSupervisorTurn(indexFallback = detail.turns.size)
    val projectedTurns = if (matchingIndex >= 0) {
        detail.turns.mapIndexed { index, turn ->
            if (index == matchingIndex) {
                turn.withOptimisticPromptItems(optimistic)
            } else {
                turn
            }
        }
    } else {
        detail.turns + optimisticTurn
    }

    val running = optimistic.status != OptimisticPromptStatus.Failed
    return detail.copy(
        turns = projectedTurns,
        turnCount = maxOf(detail.turnCount, projectedTurns.size),
        totalTurnCount = maxOf(detail.totalTurnCount, projectedTurns.size),
        liveItemCount = if (running) maxOf(detail.liveItemCount, 1) else detail.liveItemCount,
        thread = if (running) {
            detail.thread.copy(status = "running", updatedAt = optimistic.startedAt)
        } else {
            detail.thread
        },
    )
}

private fun SupervisorThreadTurn.matchesOptimisticPrompt(optimistic: OptimisticPromptTurn): Boolean {
    return id == optimistic.serverTurnId ||
        id == optimistic.id ||
        hasMatchingUserMessage(optimistic.prompt) ||
        hasPhotoPromptMatch(optimistic.prompt)
}

private fun SupervisorThreadTurn.hasMatchingUserMessage(prompt: String): Boolean {
    val normalizedPrompt = prompt.normalizedPromptText()
    return items.any { item ->
        item.kind == "userMessage" &&
            item.text.normalizedPromptText() == normalizedPrompt
    }
}

private fun SupervisorThreadTurn.hasPhotoPromptMatch(prompt: String): Boolean {
    if (!prompt.contains("[PHOTO ")) {
        return false
    }
    return items.any { item ->
        item.kind == "userMessage" &&
            (item.text.contains("[PHOTO ") || item.text.contains("![", ignoreCase = true))
    }
}

private fun SupervisorThreadTurn.withOptimisticPromptItems(
    optimistic: OptimisticPromptTurn,
): SupervisorThreadTurn {
    val userMessage = SupervisorThreadTurnItem(
        id = "${optimistic.id}-user-message",
        kind = "userMessage",
        text = optimistic.prompt,
    )
    val hasUser = hasMatchingUserMessage(optimistic.prompt) || hasPhotoPromptMatch(optimistic.prompt)
    val orderedItems = if (hasUser) {
        items
    } else {
        listOf(userMessage) + items
    }
    val withPlaceholder = if (
        optimistic.status != OptimisticPromptStatus.Failed &&
        orderedItems.none { item -> item.kind == "agentMessage" }
    ) {
        orderedItems + SupervisorThreadTurnItem(
            id = "${optimistic.id}-assistant-placeholder",
            kind = "agentMessage",
            text = "",
            status = "running",
            sequence = Int.MAX_VALUE,
        )
    } else {
        orderedItems
    }
    return copy(
        status = when (optimistic.status) {
            OptimisticPromptStatus.Failed -> "failed"
            OptimisticPromptStatus.Sending,
            OptimisticPromptStatus.InProgress,
            -> if (status == "completed" || status == "failed") status else "running"
        },
        error = optimistic.error ?: error,
        items = withPlaceholder.sortOptimisticItems(),
    )
}

private fun OptimisticPromptTurn.toSupervisorTurn(indexFallback: Int): SupervisorThreadTurn {
    val turnId = serverTurnId ?: id
    val statusText = when (status) {
        OptimisticPromptStatus.Failed -> "failed"
        OptimisticPromptStatus.Sending,
        OptimisticPromptStatus.InProgress,
        -> "running"
    }
    return SupervisorThreadTurn(
        id = turnId,
        startedAt = startedAt,
        status = statusText,
        error = error,
        model = model,
        tokenUsage = null,
        items = listOf(
            SupervisorThreadTurnItem(
                id = "$id-user-message",
                kind = "userMessage",
                text = prompt,
            ),
            SupervisorThreadTurnItem(
                id = "$id-assistant-placeholder",
                kind = "agentMessage",
                text = "",
                status = if (status == OptimisticPromptStatus.Failed) null else "running",
                sequence = indexFallback + 1,
            ),
        ),
    )
}

private fun List<SupervisorThreadTurnItem>.sortOptimisticItems(): List<SupervisorThreadTurnItem> {
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

private fun String.normalizedPromptText(): String {
    return trim().replace(Regex("\\s+"), " ")
}
