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

data class InlinePreviewSummary(
    val firstLine: String,
    val showGap: Boolean,
    val isTruncated: Boolean,
)

data class HookHistorySummary(
    val hookLabel: String,
    val firstLine: String,
    val showGap: Boolean,
    val outputBacked: Boolean,
)

data class ArtifactHistorySummary(
    val title: String,
    val summary: String,
    val detailText: String,
    val typeLabel: String,
    val rendererLabel: String?,
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

fun historyGroupRowOrdinalLabel(kind: HistoryItemKind, index: Int): String? {
    val number = index + 1
    return when (kind) {
        HistoryItemKind.Command -> "Step $number"
        HistoryItemKind.WebSearch -> "Search $number"
        HistoryItemKind.FileRead -> "Read $number"
        HistoryItemKind.FileChange -> null
        else -> "Item $number"
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

fun projectRelativePathLabel(label: String): String {
    val normalized = label.trim()
    if (normalized.isEmpty()) {
        return ""
    }

    val suffixMatch = Regex("(, \\+\\d+ more.*)$").find(normalized)
    val suffix = suffixMatch?.value.orEmpty()
    val base = if (suffix.isNotEmpty()) normalized.dropLast(suffix.length) else normalized
    val slashNormalized = base.replace('\\', '/')
    if (!slashNormalized.startsWith('/')) {
        return slashNormalized.removePrefix("./") + suffix
    }

    val markers = listOf(
        "/apps/",
        "/packages/",
        "/src/",
        "/test/",
        "/tests/",
        "/docs/",
        "/config/",
        "/scripts/",
        "/e2e/",
        "/.agents/",
        "/.codex/",
    )
    markers.forEach { marker ->
        val index = slashNormalized.indexOf(marker)
        if (index >= 0) {
            return slashNormalized.substring(index + 1) + suffix
        }
    }

    return normalized
}

fun formatTrailingPathLabel(label: String, maxLength: Int = 42): String {
    val normalized = projectRelativePathLabel(label)
    if (normalized.isEmpty()) {
        return ""
    }

    val safeMaxLength = maxLength.coerceAtLeast(8)
    val suffixMatch = Regex("(, \\+\\d+ more.*)$").find(normalized)
    val suffix = suffixMatch?.value.orEmpty()
    val base = if (suffix.isNotEmpty()) normalized.dropLast(suffix.length) else normalized
    if (base.length <= safeMaxLength) {
        return base + suffix
    }

    val segments = base.replace('\\', '/').split('/').filter { it.isNotBlank() }
    if (segments.size > 1) {
        val keptSegments = ArrayDeque<String>()
        var currentLength = suffix.length + 4
        for (index in segments.indices.reversed()) {
            val candidate = segments[index]
            val nextLength = currentLength + candidate.length + if (keptSegments.isNotEmpty()) 1 else 0
            if (keptSegments.isNotEmpty() && nextLength > safeMaxLength) {
                break
            }
            keptSegments.addFirst(candidate)
            currentLength = nextLength
        }

        if (keptSegments.isNotEmpty()) {
            return ".../${keptSegments.joinToString("/")}$suffix"
        }
    }

    val tailLength = (safeMaxLength - suffix.length - 3).coerceAtLeast(1)
    return "..." + base.takeLast(tailLength) + suffix
}

fun summarizeInlinePreviewText(text: String): InlinePreviewSummary {
    val lines = text.replace("\r\n", "\n").split('\n').toMutableList()
    while (lines.size > 1 && lines.last().trim().isEmpty()) {
        lines.removeAt(lines.lastIndex)
    }

    val firstLine = lines.firstOrNull().orEmpty()
    val truncated = lines.size > 1
    return InlinePreviewSummary(
        firstLine = firstLine,
        showGap = truncated,
        isTruncated = truncated,
    )
}

fun hookHistorySummary(
    text: String,
    hookEventLabel: String?,
    hookStatusMessage: String?,
    previewText: String?,
    hookOutput: String?,
): HookHistorySummary {
    val outputText = hookOutput
        ?.lines()
        ?.map { it.trim() }
        ?.filter { it.isNotEmpty() }
        ?.joinToString("\n")
        ?.trim()
        .orEmpty()
    val baseText = text.trim()
    val hookLabel = hookEventLabel
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.let { "$it hook" }
        ?: baseText
    val status = hookStatusMessage?.trim().orEmpty()
    val preview = previewText?.trim().orEmpty()
    val fallbackText = status
        .ifEmpty { preview.takeIf { it.isNotEmpty() && it != status }.orEmpty() }
        .ifEmpty { baseText }
    val summaryText = outputText.ifEmpty {
        fallbackText.takeIf { it.isNotEmpty() && it != hookLabel } ?: hookLabel
    }
    val summary = summarizeInlinePreviewText(summaryText)
    val firstLine = if (outputText.isNotEmpty()) {
        summary.firstLine
    } else if (summary.firstLine.isNotEmpty() && summary.firstLine != hookLabel) {
        "$hookLabel · ${summary.firstLine}"
    } else {
        hookLabel
    }

    return HookHistorySummary(
        hookLabel = hookLabel,
        firstLine = firstLine,
        showGap = outputText.isNotEmpty() && summary.showGap,
        outputBacked = outputText.isNotEmpty(),
    )
}

fun artifactHistorySummary(
    text: String,
    previewText: String?,
    artifactType: String?,
    artifactTitle: String?,
    artifactSummary: String?,
    hasRenderer: Boolean,
): ArtifactHistorySummary {
    val title = artifactTitle?.trim()?.takeIf { it.isNotEmpty() } ?: text.trim()
    val summary = artifactSummary?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?: previewText?.trim()?.takeIf { it.isNotEmpty() }
        ?: text.trim()
    val detailText = previewText?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?: artifactSummary?.trim()?.takeIf { it.isNotEmpty() }
        ?: text.trim()
    val typeLabel = artifactType?.trim()?.takeIf { it.isNotEmpty() } ?: "artifact"
    return ArtifactHistorySummary(
        title = title,
        summary = summary,
        detailText = detailText,
        typeLabel = typeLabel,
        rendererLabel = if (hasRenderer) null else "No renderer",
    )
}
