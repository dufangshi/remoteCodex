package com.remotecodex.android.ui.presentation

import com.remotecodex.android.api.SupervisorThreadDetail
import com.remotecodex.android.api.SupervisorThreadActionQuestion
import com.remotecodex.android.api.SupervisorThreadActionRequest
import com.remotecodex.android.api.SupervisorThreadContextUsage
import com.remotecodex.android.api.SupervisorThreadExportTurns
import com.remotecodex.android.api.SupervisorThreadHooks
import com.remotecodex.android.api.SupervisorThreadForkTurnOption
import com.remotecodex.android.api.SupervisorThreadMcpServers
import com.remotecodex.android.api.SupervisorThreadShellState
import com.remotecodex.android.api.SupervisorThreadSkills
import com.remotecodex.android.api.SupervisorThreadTurn
import com.remotecodex.android.api.SupervisorThreadTurnItem
import com.remotecodex.android.api.SupervisorThreadTurnTokenUsage
import com.remotecodex.android.api.SupervisorWorkspaceFilePreview
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.api.SupervisorWorkspaceTreeNode
import com.remotecodex.android.ui.model.ArtifactPreview
import com.remotecodex.android.ui.model.ComposerContextAvailability
import com.remotecodex.android.ui.model.ComposerContextPreview
import com.remotecodex.android.ui.model.ComposerForkTurnOptionPreview
import com.remotecodex.android.ui.model.ComposerForkTurnOptionsPreview
import com.remotecodex.android.ui.model.ComposerHookErrorPreview
import com.remotecodex.android.ui.model.ComposerHookEventNamePreview
import com.remotecodex.android.ui.model.ComposerHookHandlerTypePreview
import com.remotecodex.android.ui.model.ComposerHookPreview
import com.remotecodex.android.ui.model.ComposerHookSourcePreview
import com.remotecodex.android.ui.model.ComposerHookTrustStatusPreview
import com.remotecodex.android.ui.model.ComposerHooksPanelPreview
import com.remotecodex.android.ui.model.ComposerMcpAuthStatusPreview
import com.remotecodex.android.ui.model.ComposerMcpPanelPreview
import com.remotecodex.android.ui.model.ComposerMcpServerPreview
import com.remotecodex.android.ui.model.ComposerMcpToolPreview
import com.remotecodex.android.ui.model.ComposerPanelLoadStatusPreview
import com.remotecodex.android.ui.model.ComposerPreview
import com.remotecodex.android.ui.model.ComposerPromptPreview
import com.remotecodex.android.ui.model.ComposerSkillErrorPreview
import com.remotecodex.android.ui.model.ComposerSkillPreview
import com.remotecodex.android.ui.model.ComposerSkillScopePreview
import com.remotecodex.android.ui.model.ComposerSkillsPanelPreview
import com.remotecodex.android.ui.model.ExportTurnPreview
import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.HistoryItemPreview
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
import com.remotecodex.android.ui.model.ToolStatus
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
    workspaceTree: SupervisorWorkspaceTreeNode? = null,
    workspaceFilePreview: SupervisorWorkspaceFilePreview? = null,
    shellState: SupervisorThreadShellState? = null,
    exportTurns: SupervisorThreadExportTurns? = null,
    forkTurns: List<SupervisorThreadForkTurnOption>? = null,
    forkTurnsError: String? = null,
    skills: SupervisorThreadSkills? = null,
    skillsError: String? = null,
    mcpServers: SupervisorThreadMcpServers? = null,
    mcpServersError: String? = null,
    hooks: SupervisorThreadHooks? = null,
    hooksError: String? = null,
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
            canLoadEarlier = detail.totalTurnCount > detail.turns.size,
            activityNotes = listOfNotNull(goalNote),
            answeredRequestNotes = detail.answeredRequestNotes.map { note ->
                TimelineNotePreview(
                    title = note.title,
                    summaryLines = note.summaryLines,
                    timeLabel = shortTimeLabel(note.createdAt),
                    sortKey = note.createdAt,
                    turnId = note.turnId,
                    itemId = note.itemId,
                    sourceRequestId = note.id,
                )
            },
        ),
        pendingRequests = detail.pendingRequests.map { request -> request.toPendingRequestPreview() },
        exportTurns = exportTurns?.turns?.map { turn ->
            ExportTurnPreview(
                id = turn.turnId,
                number = turn.turnIndex,
                timeLabel = turn.startedAt?.let(::shortTimeLabel) ?: "Queued",
                status = turn.status.toThreadStatus(),
                promptPreview = turn.userPromptPreview,
            )
        } ?: detail.turns.mapIndexed { index, turn ->
            ExportTurnPreview(
                id = turn.id,
                number = index + 1,
                timeLabel = turn.startedAt?.let(::shortTimeLabel) ?: "Queued",
                status = turn.status.toThreadStatus(),
                promptPreview = turn.items.firstOrNull { item -> item.kind == "userMessage" }?.text
                    ?: "Turn ${index + 1}",
            )
        },
        workspacePreview = detail.workspace.toWorkspacePreview(
            tree = workspaceTree,
            filePreview = workspaceFilePreview,
        ),
        shellPreview = shellState?.toShellPreview(detail.workspace) ?: buildShellPlaceholder(detail.workspace),
        composer = ComposerPreview(
            busy = status == ThreadStatus.Running,
            threadConnected = true,
            followTail = true,
            canInterrupt = status == ThreadStatus.Running,
            prompt = ComposerPromptPreview(
                text = "",
                placeholder = "Message ${detail.thread.title.ifBlank { "this thread" }}...",
                attachments = emptyList(),
            ),
            context = ComposerContextPreview(
                model = detail.thread.model ?: "codex",
                tokensInContextWindow = detail.contextUsage?.tokensInContextWindow ?: 0,
                modelContextWindow = detail.contextUsage?.modelContextWindow ?: 0,
                remainingPercent = detail.contextUsage?.remainingPercent ?: 0,
                availability = detail.contextUsage.toComposerContextAvailability(),
            ),
            reasoningEffort = detail.thread.reasoningEffort ?: "medium",
            fastMode = detail.thread.fastMode,
            planModeActive = detail.thread.collaborationMode == "plan",
            workspaceModeLabel = detail.thread.sandboxMode ?: "workspace write",
            forkTurnOptions = buildForkTurnOptionsPreview(forkTurns, forkTurnsError),
            skillsPanel = buildSkillsPanelPreview(skills, skillsError),
            mcpPanel = buildMcpPanelPreview(mcpServers, mcpServersError),
            hooksPanel = buildHooksPanelPreview(hooks, hooksError),
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

private fun buildSkillsPanelPreview(
    skills: SupervisorThreadSkills?,
    error: String?,
): ComposerSkillsPanelPreview {
    return ComposerSkillsPanelPreview(
        status = panelStatus(skills != null, error),
        error = error,
        skills = skills?.skills?.map { skill ->
            ComposerSkillPreview(
                name = skill.name,
                displayName = null,
                scope = skill.scope.toSkillScopePreview(),
                description = skill.description,
                shortDescription = skill.shortDescription,
                interfaceShortDescription = skill.interfaceShortDescription,
                path = skill.path,
                enabled = skill.enabled,
            )
        } ?: emptyList(),
        errors = skills?.errors?.map { skillError ->
            ComposerSkillErrorPreview(path = skillError.path, message = skillError.message)
        } ?: emptyList(),
        copiedSkillName = null,
    )
}

private fun buildMcpPanelPreview(
    mcpServers: SupervisorThreadMcpServers?,
    error: String?,
): ComposerMcpPanelPreview {
    return ComposerMcpPanelPreview(
        status = panelStatus(mcpServers != null, error),
        error = error,
        configPath = null,
        configEditing = false,
        servers = mcpServers?.servers?.map { server ->
            ComposerMcpServerPreview(
                name = server.name,
                authStatus = server.authStatus.toMcpAuthStatusPreview(),
                tools = server.tools.map { tool ->
                    ComposerMcpToolPreview(name = tool.name, title = tool.title)
                },
                resourceCount = server.resourceCount,
                resourceTemplateCount = server.resourceTemplateCount,
            )
        } ?: emptyList(),
    )
}

private fun buildHooksPanelPreview(
    hooks: SupervisorThreadHooks?,
    error: String?,
): ComposerHooksPanelPreview {
    return ComposerHooksPanelPreview(
        status = panelStatus(hooks != null, error),
        error = error,
        hostConfigFilesAvailable = false,
        hookTrustAvailable = true,
        projectHooksPath = hooks?.projectHooksPath?.takeIf { it.isNotBlank() },
        warnings = hooks?.warnings ?: emptyList(),
        errors = hooks?.errors?.map { hookError ->
            ComposerHookErrorPreview(path = hookError.path, message = hookError.message)
        } ?: emptyList(),
        hooks = hooks?.hooks?.map { hook ->
            ComposerHookPreview(
                key = hook.key,
                eventName = hook.eventName.toHookEventNamePreview(),
                handlerType = hook.handlerType.toHookHandlerTypePreview(),
                matcher = hook.matcher,
                command = hook.command,
                timeoutSec = hook.timeoutSec,
                statusMessage = hook.statusMessage,
                source = hook.source.toHookSourcePreview(),
                enabled = hook.enabled,
                isManaged = hook.isManaged,
                currentHash = hook.currentHash,
                trustStatus = hook.trustStatus.toHookTrustStatusPreview(),
            )
        } ?: emptyList(),
    )
}

private fun panelStatus(hasData: Boolean, error: String?): ComposerPanelLoadStatusPreview {
    return when {
        error != null -> ComposerPanelLoadStatusPreview.Failed
        hasData -> ComposerPanelLoadStatusPreview.Ready
        else -> ComposerPanelLoadStatusPreview.Loading
    }
}

private fun buildForkTurnOptionsPreview(
    forkTurns: List<SupervisorThreadForkTurnOption>?,
    error: String?,
): ComposerForkTurnOptionsPreview {
    return ComposerForkTurnOptionsPreview(
        status = when {
            error != null -> ComposerPanelLoadStatusPreview.Failed
            forkTurns == null -> ComposerPanelLoadStatusPreview.Loading
            else -> ComposerPanelLoadStatusPreview.Ready
        },
        error = error,
        turns = forkTurns?.map { turn ->
            ComposerForkTurnOptionPreview(
                turnId = turn.turnId,
                turnIndex = turn.turnIndex,
                status = turn.status,
            )
        } ?: emptyList(),
    )
}

private fun String.toSkillScopePreview(): ComposerSkillScopePreview {
    return when (this) {
        "system" -> ComposerSkillScopePreview.System
        "admin" -> ComposerSkillScopePreview.Admin
        "user" -> ComposerSkillScopePreview.User
        else -> ComposerSkillScopePreview.Repo
    }
}

private fun String.toMcpAuthStatusPreview(): ComposerMcpAuthStatusPreview {
    return when (this) {
        "notLoggedIn" -> ComposerMcpAuthStatusPreview.NotLoggedIn
        "bearerToken" -> ComposerMcpAuthStatusPreview.BearerToken
        "oAuth" -> ComposerMcpAuthStatusPreview.OAuth
        else -> ComposerMcpAuthStatusPreview.Unsupported
    }
}

private fun String.toHookEventNamePreview(): ComposerHookEventNamePreview {
    return when (this) {
        "permissionRequest" -> ComposerHookEventNamePreview.PermissionRequest
        "postToolUse" -> ComposerHookEventNamePreview.PostToolUse
        "preCompact" -> ComposerHookEventNamePreview.PreCompact
        "postCompact" -> ComposerHookEventNamePreview.PostCompact
        "sessionStart" -> ComposerHookEventNamePreview.SessionStart
        "userPromptSubmit" -> ComposerHookEventNamePreview.UserPromptSubmit
        "stop" -> ComposerHookEventNamePreview.Stop
        else -> ComposerHookEventNamePreview.PreToolUse
    }
}

private fun String.toHookHandlerTypePreview(): ComposerHookHandlerTypePreview {
    return when (this) {
        "prompt" -> ComposerHookHandlerTypePreview.Prompt
        "agent" -> ComposerHookHandlerTypePreview.Agent
        else -> ComposerHookHandlerTypePreview.Command
    }
}

private fun String.toHookSourcePreview(): ComposerHookSourcePreview {
    return when (this) {
        "system" -> ComposerHookSourcePreview.System
        "user" -> ComposerHookSourcePreview.User
        "project" -> ComposerHookSourcePreview.Project
        "mdm" -> ComposerHookSourcePreview.Mdm
        "sessionFlags" -> ComposerHookSourcePreview.SessionFlags
        "plugin" -> ComposerHookSourcePreview.Plugin
        "cloudRequirements" -> ComposerHookSourcePreview.CloudRequirements
        "legacyManagedConfigFile" -> ComposerHookSourcePreview.LegacyManagedConfigFile
        "legacyManagedConfigMdm" -> ComposerHookSourcePreview.LegacyManagedConfigMdm
        else -> ComposerHookSourcePreview.Unknown
    }
}

private fun String.toHookTrustStatusPreview(): ComposerHookTrustStatusPreview {
    return when (this) {
        "managed" -> ComposerHookTrustStatusPreview.Managed
        "trusted" -> ComposerHookTrustStatusPreview.Trusted
        "modified" -> ComposerHookTrustStatusPreview.Modified
        else -> ComposerHookTrustStatusPreview.Untrusted
    }
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
        turnId = turnId,
        itemId = itemId,
        questions = questions.map { question -> question.toPendingRequestQuestionPreview() },
    )
}

private fun SupervisorThreadContextUsage?.toComposerContextAvailability(): ComposerContextAvailability {
    return if (
        this?.availability == "available" &&
        modelContextWindow != null &&
        tokensInContextWindow != null
    ) {
        ComposerContextAvailability.Available
    } else {
        ComposerContextAvailability.Unavailable
    }
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
        messages = items.toMessagePreviews(startedAt),
    )
}

private fun List<SupervisorThreadTurnItem>.toMessagePreviews(startedAt: String?): List<MessagePreview> {
    val messages = mutableListOf<MessagePreview>()
    val pendingHistory = mutableListOf<HistoryItemPreview>()
    forEach { item ->
        val message = item.toMessagePreview(startedAt)
        if (message != null) {
            val messageWithPendingHistory = if (pendingHistory.isNotEmpty()) {
                message.copy(historyItems = pendingHistory.toList() + message.historyItems).also {
                    pendingHistory.clear()
                }
            } else {
                message
            }
            messages += messageWithPendingHistory
        } else {
            item.toHistoryItemPreview()?.let { historyItem ->
                if (messages.lastOrNull()?.author == MessageAuthor.Assistant) {
                    val last = messages.last()
                    messages[messages.lastIndex] = last.copy(
                        historyItems = last.historyItems + historyItem,
                    )
                } else {
                    pendingHistory += historyItem
                }
            }
        }
    }
    if (pendingHistory.isNotEmpty()) {
        val lastAssistantIndex = messages.indexOfLast { it.author == MessageAuthor.Assistant }
        if (lastAssistantIndex >= 0) {
            val lastAssistant = messages[lastAssistantIndex]
            messages[lastAssistantIndex] = lastAssistant.copy(
                historyItems = lastAssistant.historyItems + pendingHistory,
            )
        } else {
            messages += MessagePreview(
                author = MessageAuthor.Assistant,
                status = null,
                timeLabel = startedAt?.let(::shortTimeLabel).orEmpty(),
                text = "",
                richText = "",
                historyItems = pendingHistory.toList(),
            )
        }
    }
    return messages
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

private fun SupervisorThreadTurnItem.toHistoryItemPreview(): HistoryItemPreview? {
    val itemKind = kind.toHistoryItemKind() ?: return null
    val summaryText = previewText?.takeIf { it.isNotBlank() }
        ?: text.takeIf { it.isNotBlank() }
        ?: detailText?.lineSequence()?.firstOrNull { it.isNotBlank() }
        ?: itemKind.defaultHistorySummary()
    return HistoryItemPreview(
        id = id.takeIf { it.isNotBlank() },
        kind = itemKind,
        title = historyItemTitle(itemKind, this),
        status = status.toToolStatus(),
        summary = summaryText,
        detail = detailText,
        actionLabel = itemKind.defaultHistoryActionLabel(),
        meta = historyItemMeta(itemKind, this),
        changedFiles = changedFiles,
        addedLines = addedLines,
        removedLines = removedLines,
        assetPath = assetPath,
        imageLabel = previewText?.takeIf { it.isNotBlank() },
        hookEventLabel = hookEventLabel,
        hookStatusMessage = hookStatusMessage,
        hookOutput = hookOutput,
        artifactType = artifactType,
        artifactTitle = artifactTitle,
        artifactSummary = artifactSummary,
        artifactHasRenderer = artifactHasRenderer,
        hasDeferredDetail = hasDeferredDetail,
    )
}

private fun String.toHistoryItemKind(): HistoryItemKind? {
    return when (this) {
        "artifact" -> HistoryItemKind.Artifact
        "image" -> HistoryItemKind.Image
        "plan" -> HistoryItemKind.Plan
        "contextCompaction" -> HistoryItemKind.Context
        "commandExecution" -> HistoryItemKind.Command
        "webSearch" -> HistoryItemKind.WebSearch
        "fileRead" -> HistoryItemKind.FileRead
        "fileChange" -> HistoryItemKind.FileChange
        "hook" -> HistoryItemKind.Hook
        "agentToolCall" -> HistoryItemKind.AgentTool
        "skillToolCall" -> HistoryItemKind.SkillTool
        "toolCall" -> HistoryItemKind.ToolCall
        "reasoning",
        "other",
        -> HistoryItemKind.Generic
        else -> null
    }
}

private fun String?.toToolStatus(): ToolStatus? {
    return when (this?.lowercase(Locale.US)) {
        "running", "started", "in_progress" -> ToolStatus.Running
        "completed", "complete", "done", "success", "succeeded" -> ToolStatus.Completed
        "failed", "error", "errored" -> ToolStatus.Failed
        else -> null
    }
}

private fun HistoryItemKind.defaultHistorySummary(): String {
    return when (this) {
        HistoryItemKind.Image -> "Image generated"
        HistoryItemKind.FileChange -> "File changes"
        HistoryItemKind.FileRead -> "File read"
        HistoryItemKind.Command -> "Command execution"
        HistoryItemKind.WebSearch -> "Web search"
        HistoryItemKind.Artifact -> "Artifact"
        HistoryItemKind.Hook -> "Hook"
        else -> "Thread event"
    }
}

private fun HistoryItemKind.defaultHistoryActionLabel(): String? {
    return when (this) {
        HistoryItemKind.Command -> "Command Output"
        HistoryItemKind.WebSearch -> "Web Search Details"
        HistoryItemKind.FileRead -> "File Read Details"
        HistoryItemKind.FileChange -> "File Change Details"
        HistoryItemKind.ToolCall -> "Tool Call Details"
        HistoryItemKind.AgentTool -> "Agent Details"
        HistoryItemKind.SkillTool -> "Skill Details"
        else -> null
    }
}

private fun historyItemTitle(kind: HistoryItemKind, item: SupervisorThreadTurnItem): String {
    return when (kind) {
        HistoryItemKind.Image -> item.assetPath?.substringAfterLast('/')?.takeIf { it.isNotBlank() } ?: "Image"
        HistoryItemKind.Artifact -> item.artifactTitle?.takeIf { it.isNotBlank() } ?: "Artifact"
        HistoryItemKind.Hook -> item.hookEventLabel?.takeIf { it.isNotBlank() } ?: "Hook"
        HistoryItemKind.FileChange,
        HistoryItemKind.FileRead,
        -> item.previewText?.takeIf { it.isNotBlank() } ?: item.text.takeIf { it.isNotBlank() } ?: kind.defaultHistorySummary()
        else -> item.text.lineSequence().firstOrNull { it.isNotBlank() }
            ?: item.previewText?.takeIf { it.isNotBlank() }
            ?: kind.defaultHistorySummary()
    }
}

private fun historyItemMeta(kind: HistoryItemKind, item: SupervisorThreadTurnItem): String? {
    return when (kind) {
        HistoryItemKind.Image -> item.assetPath
        HistoryItemKind.Artifact -> item.artifactType
        HistoryItemKind.Hook -> item.hookStatusMessage
        else -> item.status
    }?.takeIf { it.isNotBlank() }
}

private fun SupervisorThreadTurnTokenUsage.toTokenSummary(): String {
    val input = total.inputTokens + total.cachedInputTokens
    val output = total.outputTokens + total.reasoningOutputTokens
    return "in ${input.compactNumber()} / out ${output.compactNumber()}"
}

private fun SupervisorWorkspaceSummary.toWorkspacePreview(
    tree: SupervisorWorkspaceTreeNode? = null,
    filePreview: SupervisorWorkspaceFilePreview? = null,
): WorkspacePreview {
    val rootName = label.ifBlank { basename(absPath) }
    val nodes = tree?.flattenWorkspaceTree(selectedPath = filePreview?.path)
        ?: listOf(
            WorkspaceNodePreview(
                name = rootName,
                path = absPath,
                kind = WorkspaceNodeKind.Directory,
                depth = 0,
                selected = true,
                expanded = true,
            ),
        )
    val selectedFile = filePreview?.toWorkspaceFilePreview()
        ?: WorkspaceFilePreview(
            title = rootName,
            language = "text",
            sizeLabel = "remote workspace",
            truncatedLabel = null,
            content = absPath,
            path = "",
        )
    return WorkspacePreview(
        title = "Workspace",
        rootLabel = rootName,
        nodes = nodes,
        selectedFile = selectedFile,
        toolEvents = emptyList(),
        artifact = ArtifactPreview(
            id = "workspace-placeholder",
            title = "No artifact selected",
            type = "workspace",
            summary = if (filePreview == null) {
                "Open file preview and artifact APIs are not loaded for this thread yet."
            } else {
                "Showing ${filePreview.path.ifBlank { filePreview.name }} from the supervisor workspace preview API."
            },
            format = "text",
            sourcePreview = filePreview?.content?.take(1200) ?: absPath,
            atomCount = null,
            frameCount = null,
        ),
    )
}

private fun SupervisorWorkspaceTreeNode.flattenWorkspaceTree(
    selectedPath: String?,
    depth: Int = 0,
): List<WorkspaceNodePreview> {
    val node = WorkspaceNodePreview(
        name = name.ifBlank { path.ifBlank { "Workspace" } },
        path = path,
        kind = if (kind == "directory") WorkspaceNodeKind.Directory else WorkspaceNodeKind.File,
        depth = depth,
        selected = selectedPath != null && path == selectedPath,
        expanded = kind == "directory" && children.isNotEmpty(),
    )
    return listOf(node) + children.flatMap { child ->
        child.flattenWorkspaceTree(selectedPath = selectedPath, depth = depth + 1)
    }
}

private fun SupervisorWorkspaceFilePreview.toWorkspaceFilePreview(): WorkspaceFilePreview {
    return WorkspaceFilePreview(
        title = path.ifBlank { name },
        language = language.ifBlank { "text" },
        sizeLabel = size.formatBytes(),
        truncatedLabel = if (truncated) "truncated at ${nextOffset.formatBytes()}" else null,
        content = content,
        path = path,
        sizeBytes = size,
        nextOffset = nextOffset,
        truncated = truncated,
    )
}

private fun buildShellPlaceholder(workspace: SupervisorWorkspaceSummary): ShellPreview {
    val rootName = workspace.label.ifBlank { basename(workspace.absPath) }
    return ShellPreview(
        title = "Thread shell",
        status = "Not attached",
        prompt = "$rootName %",
        lines = listOf("Shell actions are not attached in this Android build yet."),
        controls = shellControlLabels,
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

private fun SupervisorThreadShellState.toShellPreview(workspace: SupervisorWorkspaceSummary): ShellPreview {
    val rootName = workspace.label.ifBlank { basename(workspace.absPath) }
    val activeId = activeShellId ?: shell?.id ?: shells.firstOrNull()?.id ?: "workspace-shell"
    val processRows = if (shells.isEmpty()) {
        listOf(
            ShellProcessPreview(
                id = "workspace-shell",
                label = "No shell",
                cwd = workspace.absPath,
                status = state,
                runningCommand = null,
                active = true,
            ),
        )
    } else {
        shells.map { session ->
            ShellProcessPreview(
                id = session.id,
                label = session.label ?: session.tmuxSessionName.ifBlank { "Shell" },
                cwd = session.cwd,
                status = session.status,
                runningCommand = null,
                active = session.id == activeId,
            )
        }
    }
    val active = processRows.firstOrNull { it.active } ?: processRows.first()
    val inputEnabled = state == "running" || state == "attached"
    return ShellPreview(
        title = "Thread shell",
        status = state.replaceFirstChar { it.uppercase() },
        prompt = "${basename(active.cwd).ifBlank { rootName }} %",
        lines = listOf(
            "Shell state: $state",
            "Workspace: ${workspacePathStatus}",
            "Active shell: ${shell?.label ?: shell?.tmuxSessionName ?: "none"}",
            "PTY input/output streaming is pending Android websocket wiring.",
        ),
        controls = shellControlLabels,
        processes = processRows,
        activeProcessId = activeId,
        connectionLabel = if (inputEnabled) "REST running" else "REST ${state}",
        inputEnabled = inputEnabled,
        commandRunning = false,
    )
}

private val shellControlLabels = listOf(
    "Paste",
    "Copy",
    "Clear",
    "Ctrl-C",
    "Ctrl-D",
    "Esc",
    "Tab",
    "Up",
    "Down",
)

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

private fun Long.formatBytes(): String {
    return when {
        this >= 1024L * 1024L -> "${this / (1024L * 1024L)} MB"
        this >= 1024L -> "${this / 1024L} KB"
        else -> "$this B"
    }
}
