package com.remotecodex.android.ui.presentation

import com.remotecodex.android.api.SupervisorThreadDetail
import com.remotecodex.android.api.SupervisorThreadActionQuestion
import com.remotecodex.android.api.SupervisorThreadActionRequest
import com.remotecodex.android.api.SupervisorThreadTurn
import com.remotecodex.android.api.SupervisorThreadTurnItem
import com.remotecodex.android.api.SupervisorThreadTurnTokenUsage
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.ui.model.ArtifactPreview
import com.remotecodex.android.ui.model.ComposerContextAvailability
import com.remotecodex.android.ui.model.ComposerContextPreview
import com.remotecodex.android.ui.model.ComposerPreview
import com.remotecodex.android.ui.model.ComposerPromptPreview
import com.remotecodex.android.ui.model.MessageAuthor
import com.remotecodex.android.ui.model.MessagePreview
import com.remotecodex.android.ui.model.PendingRequestKindPreview
import com.remotecodex.android.ui.model.PendingRequestOptionPreview
import com.remotecodex.android.ui.model.PendingRequestPreview
import com.remotecodex.android.ui.model.PendingRequestQuestionPreview
import com.remotecodex.android.ui.model.ShellPreview
import com.remotecodex.android.ui.model.ShellProcessPreview
import com.remotecodex.android.ui.model.ThreadDetailPreview
import com.remotecodex.android.ui.model.ThreadGoalPreview
import com.remotecodex.android.ui.model.ThreadGoalStatusPreview
import com.remotecodex.android.ui.model.ThreadRoomPreview
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.model.TimelineAuxiliaryPreview
import com.remotecodex.android.ui.model.TimelineNotePreview
import com.remotecodex.android.ui.model.TurnPreview
import com.remotecodex.android.ui.model.WorkspaceFilePreview
import com.remotecodex.android.ui.model.WorkspaceNodeKind
import com.remotecodex.android.ui.model.WorkspaceNodePreview
import com.remotecodex.android.ui.model.WorkspacePreview
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

fun buildThreadDetailPreviewFromSupervisor(
    detail: SupervisorThreadDetail,
    now: Instant = Instant.now(),
): ThreadDetailPreview {
    val workspaceLabel = detail.workspace.label.ifBlank { basename(detail.workspace.absPath) }
    val turns = detail.turns.mapIndexed { index, turn ->
        turn.toTurnPreview(index = index + 1)
    }
    val status = detail.thread.status.toThreadStatus()
    val runtime = listOfNotNull("codex", detail.thread.model?.takeIf { it.isNotBlank() })
        .joinToString(" / ")
        .ifBlank { "codex" }
    val goalNote = detail.goalObjective?.takeIf { it.isNotBlank() }?.let { objective ->
        TimelineNotePreview(
            title = "Goal",
            summaryLines = listOf(objective),
            actionLabel = detail.goalStatus?.takeIf { it.isNotBlank() },
            sortKey = "goal",
        )
    }
    return ThreadDetailPreview(
        title = detail.thread.title.ifBlank { "Untitled thread" },
        workspace = workspaceLabel,
        branch = basename(detail.workspace.absPath),
        runtime = runtime,
        usage = summarizeThreadUsage(detail),
        items = "${detail.turns.sumOf { it.items.size } + detail.liveItemCount} transcript items",
        rooms = listOf(
            ThreadRoomPreview(
                id = detail.thread.id,
                title = detail.thread.title.ifBlank { "Untitled thread" },
                workspaceLabel = workspaceLabel,
                status = status,
                updatedLabel = relativeTimeLabel(detail.thread.updatedAt, now),
                sessionId = detail.thread.id,
                active = true,
            ),
        ),
        turns = turns,
        timelineAuxiliary = TimelineAuxiliaryPreview(
            activityNotes = listOfNotNull(goalNote),
            answeredRequestNotes = detail.answeredRequestNotes.map { note ->
                TimelineNotePreview(
                    title = note.title,
                    summaryLines = note.summaryLines,
                    timeLabel = shortTimeLabel(note.createdAt),
                    sortKey = note.createdAt,
                )
            },
        ),
        pendingRequests = detail.pendingRequests.map { request -> request.toPendingRequestPreview() },
        workspacePreview = detail.workspace.toWorkspacePreview(),
        shellPreview = buildShellPlaceholder(detail.workspace),
        composer = ComposerPreview(
            busy = status == ThreadStatus.Running,
            threadConnected = true,
            followTail = true,
            canInterrupt = status == ThreadStatus.Running,
            workspaceModeLabel = "workspace write",
            prompt = ComposerPromptPreview(
                text = "",
                placeholder = "Message ${detail.thread.title.ifBlank { "this thread" }}...",
                attachments = emptyList(),
            ),
            context = ComposerContextPreview(
                model = detail.thread.model ?: "codex",
                availability = ComposerContextAvailability.Available,
            ),
            goalPanel = com.remotecodex.android.ui.model.ComposerGoalPanelPreview(
                currentGoal = detail.goalObjective?.takeIf { it.isNotBlank() }?.let { objective ->
                    ThreadGoalPreview(
                        objective = objective,
                        status = detail.goalStatus.toGoalStatusPreview(),
                    )
                },
            ),
        ),
    )
}

private fun SupervisorThreadActionRequest.toPendingRequestPreview(): PendingRequestPreview {
    return PendingRequestPreview(
        id = id,
        title = title,
        description = description.orEmpty(),
        command = "",
        riskLabel = if (kind == "planDecision") "Decision required" else "Input required",
        kind = when (kind) {
            "planDecision" -> PendingRequestKindPreview.PlanDecision
            "requestUserInput" -> PendingRequestKindPreview.RequestUserInput
            else -> PendingRequestKindPreview.Approval
        },
        sortKey = createdAt,
        questions = questions.map { question -> question.toPendingRequestQuestionPreview() },
    )
}

private fun SupervisorThreadActionQuestion.toPendingRequestQuestionPreview(): PendingRequestQuestionPreview {
    return PendingRequestQuestionPreview(
        id = id,
        header = header,
        question = question,
        options = options.map { option ->
            PendingRequestOptionPreview(
                label = option.label,
                description = option.description,
            )
        },
        multiSelect = multiSelect,
        allowOther = isOther,
    )
}

private fun SupervisorThreadTurn.toTurnPreview(index: Int): TurnPreview {
    return TurnPreview(
        index = index,
        timeLabel = startedAt?.let(::shortTimeLabel) ?: "queued",
        statusLabel = status.toTurnStatusLabel(error),
        tokenSummary = tokenUsage?.toTokenSummary().orEmpty(),
        messages = items.mapNotNull { item -> item.toMessagePreview(startedAt) },
    )
}

private fun SupervisorThreadTurnItem.toMessagePreview(startedAt: String?): MessagePreview? {
    val author = when (kind) {
        "userMessage" -> MessageAuthor.User
        "agentMessage" -> MessageAuthor.Assistant
        else -> return null
    }
    return MessagePreview(
        author = author,
        status = null,
        timeLabel = startedAt?.let(::shortTimeLabel).orEmpty(),
        text = text,
        richText = text,
    )
}

private fun SupervisorThreadTurnTokenUsage.toTokenSummary(): String {
    val input = total.inputTokens + total.cachedInputTokens
    val output = total.outputTokens + total.reasoningOutputTokens
    return "in ${input.compactNumber()} / out ${output.compactNumber()}"
}

private fun SupervisorWorkspaceSummary.toWorkspacePreview(): WorkspacePreview {
    val rootName = label.ifBlank { basename(absPath) }
    return WorkspacePreview(
        title = "Workspace",
        rootLabel = rootName,
        nodes = listOf(
            WorkspaceNodePreview(
                name = rootName,
                path = absPath,
                kind = WorkspaceNodeKind.Directory,
                depth = 0,
                selected = true,
                expanded = true,
            ),
        ),
        selectedFile = WorkspaceFilePreview(
            title = rootName,
            language = "text",
            sizeLabel = "remote workspace",
            truncatedLabel = null,
            content = absPath,
        ),
        toolEvents = emptyList(),
        artifact = ArtifactPreview(
            id = "workspace-placeholder",
            title = "No artifact selected",
            type = "workspace",
            summary = "Open file preview and artifact APIs are not loaded for this thread yet.",
            format = "text",
            sourcePreview = absPath,
            atomCount = null,
            frameCount = null,
        ),
    )
}

private fun buildShellPlaceholder(workspace: SupervisorWorkspaceSummary): ShellPreview {
    val rootName = workspace.label.ifBlank { basename(workspace.absPath) }
    return ShellPreview(
        title = "Thread shell",
        status = "Not attached",
        prompt = "$rootName %",
        lines = listOf("Shell actions are not attached in this Android build yet."),
        controls = listOf("Paste", "Copy", "Clear", "Ctrl-C"),
        processes = listOf(
            ShellProcessPreview(
                id = "workspace-shell",
                label = "Workspace shell",
                cwd = workspace.absPath,
                status = "available",
                runningCommand = null,
                active = true,
            ),
        ),
        activeProcessId = "workspace-shell",
        connectionLabel = "REST connected",
        inputEnabled = false,
        commandRunning = false,
    )
}

private fun summarizeThreadUsage(detail: SupervisorThreadDetail): String {
    val totals = detail.turns.mapNotNull { it.tokenUsage?.total }
    if (totals.isEmpty()) {
        return "usage pending"
    }
    val input = totals.sumOf { it.inputTokens + it.cachedInputTokens }
    val output = totals.sumOf { it.outputTokens + it.reasoningOutputTokens }
    return "in ${input.compactNumber()} / out ${output.compactNumber()}"
}

private fun String.toTurnStatusLabel(error: String?): String {
    return when {
        error != null -> "failed"
        equals("inProgress", ignoreCase = true) -> "running"
        equals("completed", ignoreCase = true) -> "complete"
        equals("interrupted", ignoreCase = true) -> "interrupted"
        else -> ifBlank { "complete" }
    }
}

private fun String.toThreadStatus(): ThreadStatus {
    return when {
        equals("running", ignoreCase = true) -> ThreadStatus.Running
        equals("failed", ignoreCase = true) -> ThreadStatus.Failed
        equals("waiting", ignoreCase = true) -> ThreadStatus.Waiting
        else -> ThreadStatus.Complete
    }
}

private fun String?.toGoalStatusPreview(): ThreadGoalStatusPreview {
    return when (this?.lowercase(Locale.US)) {
        "complete", "completed" -> ThreadGoalStatusPreview.Complete
        "paused" -> ThreadGoalStatusPreview.Paused
        "budgetlimited", "budget_limited" -> ThreadGoalStatusPreview.BudgetLimited
        "terminated" -> ThreadGoalStatusPreview.Terminated
        else -> ThreadGoalStatusPreview.Active
    }
}

private fun basename(path: String): String {
    return path.trimEnd('/').substringAfterLast('/').ifBlank { path }
}

private fun shortTimeLabel(value: String): String {
    return runCatching {
        DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT)
            .withLocale(Locale.getDefault())
            .withZone(ZoneId.systemDefault())
            .format(Instant.parse(value))
    }.getOrDefault(value.take(16))
}

private fun relativeTimeLabel(value: String, now: Instant): String {
    val updated = runCatching { Instant.parse(value) }.getOrNull() ?: return value.take(10)
    val seconds = (now.epochSecond - updated.epochSecond).coerceAtLeast(0)
    return when {
        seconds < 60 -> "now"
        seconds < 3600 -> "${seconds / 60}m"
        seconds < 86_400 -> "${seconds / 3600}h"
        else -> "${seconds / 86_400}d"
    }
}

private fun Int.compactNumber(): String {
    return when {
        this >= 1_000_000 -> "${this / 1_000_000}.${(this % 1_000_000) / 100_000}m"
        this >= 1_000 -> "${this / 1_000}.${(this % 1_000) / 100}k"
        else -> toString()
    }
}
