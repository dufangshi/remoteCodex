package com.remotecodex.android.ui.presentation

import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.PlanStepStatus
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.model.ToolStatus

fun threadStatusLabel(status: ThreadStatus): String {
    return when (status) {
        ThreadStatus.Running -> "Running"
        ThreadStatus.Complete -> "Complete"
        ThreadStatus.Failed -> "Failed"
        ThreadStatus.Waiting -> "Waiting"
    }
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
