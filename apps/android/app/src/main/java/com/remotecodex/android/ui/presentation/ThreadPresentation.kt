package com.remotecodex.android.ui.presentation

import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.PlanStepStatus
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.model.ToolStatus

enum class MessageStatusTone {
    Neutral,
    Running,
    Success,
    Danger,
}

data class MessageStatusModel(
    val label: String,
    val tone: MessageStatusTone,
)

enum class FileChangeSummaryTone {
    Files,
    Added,
    Removed,
    Neutral,
}

data class FileChangeSummarySegment(
    val label: String,
    val tone: FileChangeSummaryTone,
)

fun threadStatusLabel(status: ThreadStatus): String {
    return when (status) {
        ThreadStatus.Running -> "Running"
        ThreadStatus.Complete -> "Complete"
        ThreadStatus.Failed -> "Failed"
        ThreadStatus.Waiting -> "Waiting"
    }
}

fun graphChatMessageStatusModel(status: String?): MessageStatusModel? {
    val label = status?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val normalized = label.lowercase()
    val tone = when {
        normalized.contains("running") ||
            normalized.contains("generating") ||
            normalized.contains("steering") -> MessageStatusTone.Running
        normalized.contains("failed") ||
            normalized.contains("error") -> MessageStatusTone.Danger
        normalized.contains("accepted") ||
            normalized.contains("complete") -> MessageStatusTone.Success
        else -> MessageStatusTone.Neutral
    }
    return MessageStatusModel(label = label, tone = tone)
}

fun graphChatMessageStatusModel(status: ThreadStatus?): MessageStatusModel? {
    return status?.let { graphChatMessageStatusModel(threadStatusLabel(it)) }
}

fun exportStatusLabel(status: ThreadStatus): String {
    return when (status) {
        ThreadStatus.Running -> "running"
        ThreadStatus.Complete -> "completed"
        ThreadStatus.Failed -> "failed"
        ThreadStatus.Waiting -> "waiting"
    }
}

fun toolStatusLabel(status: ToolStatus): String {
    return when (status) {
        ToolStatus.Running -> "Running"
        ToolStatus.Completed -> "Done"
        ToolStatus.Failed -> "Failed"
    }
}

fun toolResultStatusLabel(status: ToolStatus): String {
    return when (status) {
        ToolStatus.Running -> "Running"
        ToolStatus.Completed -> "Completed"
        ToolStatus.Failed -> "Failed"
    }
}

fun planStepStatusLabel(status: PlanStepStatus): String {
    return when (status) {
        PlanStepStatus.Completed -> "Done"
        PlanStepStatus.Running -> "Running"
        PlanStepStatus.Failed -> "Failed"
        PlanStepStatus.Pending -> "Pending"
        PlanStepStatus.Unknown -> "Unknown"
    }
}

fun historyItemLabel(kind: HistoryItemKind): String {
    return when (kind) {
        HistoryItemKind.Plan -> "Plan"
        HistoryItemKind.Context -> "Context"
        HistoryItemKind.Command -> "Command"
        HistoryItemKind.ToolCall -> "Tool"
        HistoryItemKind.AgentTool -> "Agent"
        HistoryItemKind.SkillTool -> "Skill"
        HistoryItemKind.WebSearch -> "Web Search"
        HistoryItemKind.FileRead -> "File Read"
        HistoryItemKind.FileChange -> "File Change"
        HistoryItemKind.Image -> "Image"
        HistoryItemKind.Artifact -> "Artifact"
        HistoryItemKind.Hook -> "Hook"
        HistoryItemKind.Generic -> "Other"
    }
}

fun historyItemShortLabel(kind: HistoryItemKind): String {
    return when (kind) {
        HistoryItemKind.Plan -> "PLAN"
        HistoryItemKind.Context -> "CTX"
        HistoryItemKind.Command -> "CMD"
        HistoryItemKind.ToolCall -> "TOOL"
        HistoryItemKind.AgentTool -> "AGT"
        HistoryItemKind.SkillTool -> "SKL"
        HistoryItemKind.WebSearch -> "WEB"
        HistoryItemKind.FileRead -> "READ"
        HistoryItemKind.FileChange -> "DIFF"
        HistoryItemKind.Image -> "IMG"
        HistoryItemKind.Artifact -> "ART"
        HistoryItemKind.Hook -> "HOOK"
        HistoryItemKind.Generic -> "INFO"
    }
}

fun isScrollableHistoryItem(kind: HistoryItemKind): Boolean {
    return kind == HistoryItemKind.Command || kind == HistoryItemKind.Context
}

fun fileChangeSummarySegments(
    changedFiles: Int?,
    addedLines: Int?,
    removedLines: Int?,
    previewText: String?,
): List<FileChangeSummarySegment> {
    val structured = buildList {
        changedFiles?.takeIf { it > 0 }?.let { files ->
            add(FileChangeSummarySegment("${files} ${if (files == 1) "file" else "files"}", FileChangeSummaryTone.Files))
        }
        addedLines?.takeIf { it > 0 }?.let { lines ->
            add(FileChangeSummarySegment("+$lines", FileChangeSummaryTone.Added))
        }
        removedLines?.takeIf { it > 0 }?.let { lines ->
            add(FileChangeSummarySegment("-$lines", FileChangeSummaryTone.Removed))
        }
    }

    if (structured.isNotEmpty()) {
        return structured
    }

    val fallback = previewText?.trim()?.takeIf { it.isNotEmpty() } ?: return emptyList()
    return fallback
        .replace(Regex("\\bfiles changed\\b", RegexOption.IGNORE_CASE), "files")
        .replace(Regex("\\bfile changed\\b", RegexOption.IGNORE_CASE), "file")
        .split('·')
        .mapNotNull { segment ->
            val label = segment.trim()
            if (label.isEmpty()) {
                null
            } else {
                FileChangeSummarySegment(label, FileChangeSummaryTone.Neutral)
            }
        }
}
