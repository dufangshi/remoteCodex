import Foundation

enum ThreadStatusPresentation: Equatable {
    case running
    case complete
    case failed
    case waiting
}

enum TimelineAuthorPresentation: Equatable {
    case user
    case assistant
}

enum TimelineToolStatusPresentation: Equatable {
    case running
    case completed
    case failed
}

enum PlanStepStatusPresentation: Equatable {
    case pending
    case running
    case completed
    case failed
    case unknown
}

enum PlanStepStatusTonePresentation: Equatable {
    case success
    case running
    case danger
    case pending
    case unknown
}

enum TimelineNoteKindPresentation: Equatable {
    case activity
    case answered
}

enum HistoryItemKindPresentation: Equatable {
    case plan
    case context
    case command
    case toolCall
    case agentTool
    case skillTool
    case webSearch
    case fileRead
    case fileChange
    case image
    case artifact
    case hook
    case generic
}

struct PlanStepStatusPresentationState: Equatable {
    var label: String
    var accessibilityLabel: String
    var tone: PlanStepStatusTonePresentation
    var running: Bool
}

struct ThreadDetailPresentation: Equatable {
    var title: String
    var workspace: String
    var branch: String
    var runtime: String
    var usage: String
    var itemSummary: String
    var status: ThreadStatusPresentation
    var rooms: [ThreadRoomPresentation]
    var turns: [TurnPresentation]
    var timelineNotes: [TimelineNotePresentation]
    var pendingRequestCount: Int
    var canLoadEarlier: Bool
    var goal: ThreadGoalPresentation?
    var context: ThreadContextPresentation
    var workspaceContext: ThreadWorkspaceContextPresentation
    var exportTurns: [ThreadExportTurnPresentation]
    var forkTurns: [ThreadForkTurnPresentation]
    var extensionSummary: ThreadExtensionSummaryPresentation
    var modelOptions: [ThreadModelOptionPresentation]
}

struct ThreadGoalPresentation: Equatable {
    var objective: String
    var statusLabel: String
}

struct ThreadRoomPresentation: Equatable, Identifiable {
    var id: String
    var title: String
    var workspaceLabel: String
    var status: ThreadStatusPresentation
    var updatedLabel: String
    var active: Bool
}

struct TimelineNotePresentation: Equatable, Identifiable {
    var id: String
    var kind: TimelineNoteKindPresentation
    var title: String
    var summaryLines: [String]
    var statusLabel: String?
    var timeLabel: String?
}

struct ThreadContextPresentation: Equatable {
    var label: String
    var percent: Double?
    var availability: String?
    var tokensLabel: String?
}

struct TurnPresentation: Equatable, Identifiable {
    var id: String
    var index: Int
    var timeLabel: String
    var statusLabel: String
    var status: ThreadStatusPresentation
    var tokenSummary: String?
    var usage: TurnUsagePresentation?
    var livePlan: LivePlanPresentation?
    var messages: [TimelineMessagePresentation]
    var reasoningItems: [ReasoningPresentation]
    var historyItems: [HistoryItemPresentation]
}

struct TurnUsagePresentation: Equatable {
    var tokenSummary: String?
    var tokenDetails: String?
    var contextSummary: String?
    var contextDetails: String?

    var isEmpty: Bool {
        tokenSummary == nil && tokenDetails == nil && contextSummary == nil && contextDetails == nil
    }
}

struct LivePlanPresentation: Equatable, Identifiable {
    var id: String
    var title: String
    var badgeLabel: String
    var explanation: String?
    var steps: [LivePlanStepPresentation]
}

struct LivePlanStepPresentation: Equatable, Identifiable {
    var id: String
    var number: Int
    var text: String
    var status: PlanStepStatusPresentation
    var statusState: PlanStepStatusPresentationState
}

struct TimelineMessagePresentation: Equatable, Identifiable {
    var id: String
    var author: TimelineAuthorPresentation
    var status: ThreadStatusPresentation?
    var timeLabel: String
    var text: String
}

struct HistoryItemPresentation: Equatable, Identifiable {
    var id: String
    var kind: HistoryItemKindPresentation
    var title: String
    var status: TimelineToolStatusPresentation?
    var summary: String
    var meta: String?
    var actionLabel: String?
    var copyText: String
    var callId: String?
    var toolName: String?
}

struct ReasoningPresentation: Equatable, Identifiable {
    var id: String
    var text: String
    var status: TimelineToolStatusPresentation?
}

struct ThreadWorkspaceContextPresentation: Equatable {
    var rootName: String?
    var firstFilePath: String?
    var previewPath: String?
    var previewText: String?
    var previewLanguage: String?
    var previewTruncated: Bool
}

struct ThreadExportTurnPresentation: Equatable, Identifiable {
    var id: String
    var number: Int
    var timeLabel: String
    var status: ThreadStatusPresentation
    var promptPreview: String
}

struct ThreadForkTurnPresentation: Equatable, Identifiable {
    var id: String
    var number: Int
    var timeLabel: String
    var statusLabel: String
}

struct ThreadExtensionSummaryPresentation: Equatable {
    var skillCount: Int
    var skillErrorCount: Int
    var skillPreviews: [ThreadNamedPreview]
    var mcpServerCount: Int
    var mcpToolCount: Int
    var mcpPreviews: [ThreadNamedPreview]
    var hookCount: Int
    var hookWarningCount: Int
    var hookErrorCount: Int
    var hookPreviews: [ThreadNamedPreview]
}

struct ThreadNamedPreview: Equatable, Identifiable {
    var id: String
    var title: String
    var subtitle: String?
    var statusLabel: String?
}

struct ThreadModelOptionPresentation: Equatable, Identifiable {
    var id: String
    var model: String
    var displayName: String
    var selected: Bool
    var defaultReasoningEffort: String?
    var supportedReasoningEfforts: [String]
}

func buildThreadDetailPresentation(
    _ detail: SupervisorThreadDetail,
    workspaceTree: SupervisorWorkspaceTreeNode? = nil,
    workspacePreview: SupervisorWorkspaceFilePreview? = nil,
    exportTurns: SupervisorThreadExportTurns? = nil,
    forkTurns: [SupervisorThreadForkTurnOption] = [],
    skills: SupervisorThreadSkills? = nil,
    mcpServers: SupervisorThreadMcpServers? = nil,
    hooks: SupervisorThreadHooks? = nil,
    modelOptions: [SupervisorModelOption] = []
) -> ThreadDetailPresentation {
    let workspaceLabel = detail.workspace.label.trimmedNonEmpty ?? basenameForPresentation(detail.workspace.absPath)
    let liveItemCount = detail.liveItemCount ?? 0
    let turns = detail.turns.enumerated().map { index, turn in
        buildTurnPresentation(
            turn: turn,
            index: index + 1,
            livePlan: detail.livePlan,
            contextUsage: index == detail.turns.indices.last ? detail.contextUsage : nil
        )
    }
    return ThreadDetailPresentation(
        title: detail.thread.title.trimmedNonEmpty ?? "Untitled thread",
        workspace: workspaceLabel,
        branch: basenameForPresentation(detail.workspace.absPath),
        runtime: ["codex", detail.thread.model?.trimmedNonEmpty].compactMap(\.self).joined(separator: " / "),
        usage: summarizeThreadUsage(detail),
        itemSummary: "\(detail.turns.reduce(0) { $0 + $1.items.count } + liveItemCount) transcript items",
        status: threadStatusPresentation(detail.thread.status),
        rooms: [
            ThreadRoomPresentation(
                id: detail.thread.id,
                title: detail.thread.title.trimmedNonEmpty ?? "Untitled thread",
                workspaceLabel: workspaceLabel,
                status: threadStatusPresentation(detail.thread.status),
                updatedLabel: detail.thread.updatedAt,
                active: true
            )
        ],
        turns: turns,
        timelineNotes: buildTimelineNotes(detail),
        pendingRequestCount: detail.pendingRequests?.count ?? 0,
        canLoadEarlier: (detail.totalTurnCount ?? detail.turns.count) > detail.turns.count,
        goal: detail.goalObjective?.trimmedNonEmpty.map {
            ThreadGoalPresentation(objective: $0, statusLabel: detail.goalStatus?.trimmedNonEmpty ?? "active")
        },
        context: buildThreadContextPresentation(detail.contextUsage),
        workspaceContext: buildThreadWorkspaceContextPresentation(tree: workspaceTree, preview: workspacePreview),
        exportTurns: buildThreadExportTurnPresentations(exportTurns: exportTurns, fallbackTurns: detail.turns),
        forkTurns: forkTurns.map(buildThreadForkTurnPresentation),
        extensionSummary: buildThreadExtensionSummary(skills: skills, mcpServers: mcpServers, hooks: hooks),
        modelOptions: buildThreadModelOptionPresentations(modelOptions, currentModel: detail.thread.model)
    )
}

func buildTurnPresentation(
    turn: SupervisorThreadTurn,
    index: Int,
    livePlan: SupervisorThreadLivePlan? = nil,
    contextUsage: SupervisorThreadContextUsage? = nil
) -> TurnPresentation {
    var messages: [TimelineMessagePresentation] = []
    var historyItems: [HistoryItemPresentation] = []
    var reasoningItems: [ReasoningPresentation] = []
    for item in turn.items {
        if let message = buildTimelineMessagePresentation(item: item, turnStartedAt: turn.startedAt) {
            messages.append(message)
        } else if let reasoning = buildReasoningPresentation(item) {
            reasoningItems.append(reasoning)
        } else if let history = buildHistoryItemPresentation(item) {
            historyItems.append(history)
        }
    }
    return TurnPresentation(
        id: turn.id,
        index: index,
        timeLabel: turn.startedAt.map(shortThreadTimeLabel) ?? "queued",
        statusLabel: turnStatusLabel(status: turn.status, error: turn.error),
        status: threadStatusPresentation(turn.status),
        tokenSummary: turn.tokenUsage.map(tokenSummary)?.trimmedNonEmpty,
        usage: buildTurnUsagePresentation(tokenUsage: turn.tokenUsage, contextUsage: contextUsage),
        livePlan: buildLivePlanPresentation(livePlan, turnId: turn.id),
        messages: messages,
        reasoningItems: reasoningItems,
        historyItems: historyItems
    )
}

func buildTurnUsagePresentation(
    tokenUsage: SupervisorThreadTurnTokenUsage?,
    contextUsage: SupervisorThreadContextUsage?
) -> TurnUsagePresentation? {
    let usage = TurnUsagePresentation(
        tokenSummary: tokenUsage.map(tokenSummary)?.trimmedNonEmpty,
        tokenDetails: tokenUsage.flatMap(tokenDetails),
        contextSummary: contextUsage.map(buildThreadContextPresentation)?.label.trimmedNonEmpty,
        contextDetails: contextDetails(contextUsage)
    )
    return usage.isEmpty ? nil : usage
}

func buildLivePlanPresentation(
    _ livePlan: SupervisorThreadLivePlan?,
    turnId: String
) -> LivePlanPresentation? {
    guard let livePlan, livePlan.turnId == turnId else { return nil }
    let steps = livePlan.plan.enumerated().compactMap { index, step -> LivePlanStepPresentation? in
        guard let text = step.step.trimmedNonEmpty else { return nil }
        let status = planStepStatusPresentation(step.status)
        return LivePlanStepPresentation(
            id: "\(livePlan.turnId)-plan-\(index)",
            number: index + 1,
            text: text,
            status: status,
            statusState: buildPlanStepStatusPresentationState(status)
        )
    }
    guard !steps.isEmpty else { return nil }
    return LivePlanPresentation(
        id: "\(livePlan.turnId)-live-plan",
        title: "Plan update",
        badgeLabel: "Live",
        explanation: livePlan.explanation?.trimmedNonEmpty,
        steps: steps
    )
}

func buildTimelineMessagePresentation(
    item: SupervisorThreadTurnItem,
    turnStartedAt: String?
) -> TimelineMessagePresentation? {
    let author: TimelineAuthorPresentation
    switch item.kind {
    case "user", "userMessage":
        author = .user
    case "assistant", "agentMessage":
        author = .assistant
    default:
        return nil
    }
    return TimelineMessagePresentation(
        id: item.id,
        author: author,
        status: author == .assistant && isRunningStatus(item.status) ? .running : nil,
        timeLabel: turnStartedAt.map(shortThreadTimeLabel) ?? "",
        text: item.text ?? ""
    )
}

func buildHistoryItemPresentation(_ item: SupervisorThreadTurnItem) -> HistoryItemPresentation? {
    guard let kind = historyItemKindPresentation(item.kind) else { return nil }
    let summary = item.text?.trimmedNonEmpty
        ?? item.payload?.string("previewText")?.trimmedNonEmpty
        ?? defaultHistorySummary(kind)
    return HistoryItemPresentation(
        id: item.id,
        kind: kind,
        title: historyItemTitle(kind: kind, item: item),
        status: toolStatusPresentation(item.status),
        summary: summary,
        meta: historyItemMeta(kind: kind, item: item),
        actionLabel: defaultHistoryActionLabel(kind),
        copyText: historyItemCopyText(
            title: historyItemTitle(kind: kind, item: item),
            summary: summary,
            meta: historyItemMeta(kind: kind, item: item),
            callId: item.callId,
            toolName: item.toolName
        ),
        callId: item.callId,
        toolName: item.toolName
    )
}

func buildReasoningPresentation(_ item: SupervisorThreadTurnItem) -> ReasoningPresentation? {
    guard item.kind == "reasoning", let text = item.text?.trimmedNonEmpty else { return nil }
    return ReasoningPresentation(
        id: item.id,
        text: text,
        status: toolStatusPresentation(item.status)
    )
}

func buildTimelineNotes(_ detail: SupervisorThreadDetail) -> [TimelineNotePresentation] {
    var notes: [TimelineNotePresentation] = []
    if let objective = detail.goalObjective?.trimmedNonEmpty {
        notes.append(TimelineNotePresentation(
            id: "goal",
            kind: .activity,
            title: "Goal",
            summaryLines: [objective],
            statusLabel: detail.goalStatus?.trimmedNonEmpty,
            timeLabel: nil
        ))
    }
    notes.append(contentsOf: (detail.activityNotes ?? []).map { note in
        TimelineNotePresentation(
            id: note.id,
            kind: .activity,
            title: activityNoteTitle(note),
            summaryLines: activityNoteSummaryLines(note),
            statusLabel: activityNoteStatusLabel(note),
            timeLabel: shortThreadTimeLabel(note.createdAt)
        )
    })
    notes.append(contentsOf: (detail.answeredRequestNotes ?? []).map { note in
        TimelineNotePresentation(
            id: note.id,
            kind: .answered,
            title: note.title?.trimmedNonEmpty ?? "Answered request",
            summaryLines: note.summaryLines?.filter { $0.trimmedNonEmpty != nil } ?? note.summary.map { [$0] } ?? ["Resolved"],
            statusLabel: nil,
            timeLabel: note.createdAt.map(shortThreadTimeLabel)
        )
    })
    return notes
}

func buildThreadContextPresentation(_ context: SupervisorThreadContextUsage?) -> ThreadContextPresentation {
    guard let context else {
        return ThreadContextPresentation(label: "Context unavailable", percent: nil, availability: nil, tokensLabel: nil)
    }
    let percent = context.remainingPercent.map(Double.init) ?? context.percent
    let label = if let remaining = context.remainingPercent {
        "\(remaining)% remaining"
    } else if let percent = context.percent {
        "\(Int(percent.rounded()))% used"
    } else {
        "Context available"
    }
    let tokensLabel: String? = if let used = context.usedTokens, let maxTokens = context.maxTokens {
        "\(compactNumber(used)) / \(compactNumber(maxTokens)) tokens"
    } else if let tokens = context.tokensInContextWindow {
        "\(compactNumber(tokens)) tokens in window"
    } else {
        nil
    }
    return ThreadContextPresentation(
        label: label,
        percent: percent,
        availability: context.availability,
        tokensLabel: tokensLabel
    )
}

func buildThreadWorkspaceContextPresentation(
    tree: SupervisorWorkspaceTreeNode?,
    preview: SupervisorWorkspaceFilePreview?
) -> ThreadWorkspaceContextPresentation {
    ThreadWorkspaceContextPresentation(
        rootName: tree?.name.trimmedNonEmpty,
        firstFilePath: tree?.firstFilePath,
        previewPath: preview?.path,
        previewText: preview?.content,
        previewLanguage: preview?.language.trimmedNonEmpty,
        previewTruncated: preview?.truncated ?? false
    )
}

func buildThreadExportTurnPresentations(
    exportTurns: SupervisorThreadExportTurns?,
    fallbackTurns: [SupervisorThreadTurn]
) -> [ThreadExportTurnPresentation] {
    if let exportTurns {
        return exportTurns.turns.enumerated().map { index, turn in
            ThreadExportTurnPresentation(
                id: turn.turnId,
                number: turn.turnIndex ?? turn.turnNumber ?? index + 1,
                timeLabel: turn.startedAt.map(shortThreadTimeLabel) ?? "Queued",
                status: threadStatusPresentation(turn.status),
                promptPreview: turn.userPromptPreview.trimmedNonEmpty ?? "Turn \(index + 1)"
            )
        }
    }
    return fallbackTurns.enumerated().map { index, turn in
        ThreadExportTurnPresentation(
            id: turn.id,
            number: index + 1,
            timeLabel: turn.startedAt.map(shortThreadTimeLabel) ?? "Queued",
            status: threadStatusPresentation(turn.status),
            promptPreview: turn.items.first { $0.kind == "userMessage" || $0.kind == "user" }?.text?.trimmedNonEmpty ?? "Turn \(index + 1)"
        )
    }
}

func buildThreadForkTurnPresentation(_ turn: SupervisorThreadForkTurnOption) -> ThreadForkTurnPresentation {
    ThreadForkTurnPresentation(
        id: turn.turnId,
        number: turn.turnIndex,
        timeLabel: turn.startedAt.map(shortThreadTimeLabel) ?? "Queued",
        statusLabel: turnStatusLabel(status: turn.status, error: nil)
    )
}

func buildThreadExtensionSummary(
    skills: SupervisorThreadSkills?,
    mcpServers: SupervisorThreadMcpServers?,
    hooks: SupervisorThreadHooks?
) -> ThreadExtensionSummaryPresentation {
    ThreadExtensionSummaryPresentation(
        skillCount: skills?.skills.count ?? 0,
        skillErrorCount: skills?.errors.count ?? 0,
        skillPreviews: skills?.skills.prefix(3).map { skill in
            ThreadNamedPreview(
                id: skill.id,
                title: skill.name,
                subtitle: skill.interfaceShortDescription ?? skill.shortDescription ?? skill.description,
                statusLabel: skill.enabled ? skill.scope : "disabled"
            )
        } ?? [],
        mcpServerCount: mcpServers?.servers.count ?? 0,
        mcpToolCount: mcpServers?.servers.reduce(0) { $0 + $1.tools.count } ?? 0,
        mcpPreviews: mcpServers?.servers.prefix(3).map { server in
            ThreadNamedPreview(
                id: server.id,
                title: server.name,
                subtitle: "\(server.tools.count) tools",
                statusLabel: server.authStatus
            )
        } ?? [],
        hookCount: hooks?.hooks.count ?? 0,
        hookWarningCount: hooks?.warnings.count ?? 0,
        hookErrorCount: hooks?.errors.count ?? 0,
        hookPreviews: hooks?.hooks.prefix(3).map { hook in
            ThreadNamedPreview(
                id: hook.id,
                title: hook.eventName,
                subtitle: hook.statusMessage ?? hook.command ?? hook.handlerType,
                statusLabel: hook.trustStatus
            )
        } ?? []
    )
}

func buildThreadModelOptionPresentations(
    _ options: [SupervisorModelOption],
    currentModel: String?
) -> [ThreadModelOptionPresentation] {
    let visible = options.filter { !$0.hidden }
    let mapped = visible.map { option in
        ThreadModelOptionPresentation(
            id: option.id,
            model: option.model,
            displayName: option.displayName,
            selected: option.model == currentModel,
            defaultReasoningEffort: option.defaultReasoningEffort,
            supportedReasoningEfforts: option.supportedReasoningEfforts.map(\.reasoningEffort)
        )
    }
    guard let currentModel = currentModel?.trimmedNonEmpty, !mapped.contains(where: { $0.model == currentModel }) else {
        return mapped
    }
    return [
        ThreadModelOptionPresentation(
            id: currentModel,
            model: currentModel,
            displayName: currentModel,
            selected: true,
            defaultReasoningEffort: nil,
            supportedReasoningEfforts: []
        )
    ] + mapped
}

func threadStatusPresentation(_ status: String?) -> ThreadStatusPresentation {
    switch status?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "running", "started", "in_progress":
        .running
    case "failed", "error", "errored":
        .failed
    case "waiting", "queued", "pending", "idle":
        .waiting
    default:
        .complete
    }
}

func turnStatusLabel(status: String?, error: String?) -> String {
    if let error = error?.trimmedNonEmpty {
        return "Failed: \(error)"
    }
    switch threadStatusPresentation(status) {
    case .running:
        return "Running"
    case .failed:
        return "Failed"
    case .waiting:
        return "Waiting"
    case .complete:
        return "Complete"
    }
}

func toolStatusPresentation(_ status: String?) -> TimelineToolStatusPresentation? {
    switch status?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "running", "started", "in_progress":
        .running
    case "completed", "complete", "done", "success", "succeeded":
        .completed
    case "failed", "error", "errored":
        .failed
    default:
        nil
    }
}

func toolStatusLabel(_ status: TimelineToolStatusPresentation) -> String {
    switch status {
    case .running:
        "Running"
    case .completed:
        "Done"
    case .failed:
        "Failed"
    }
}

func toolResultStatusLabel(_ status: TimelineToolStatusPresentation) -> String {
    switch status {
    case .running:
        "Running"
    case .completed:
        "Completed"
    case .failed:
        "Failed"
    }
}

func planStepStatusLabel(_ status: PlanStepStatusPresentation) -> String {
    switch status {
    case .completed:
        "Done"
    case .running:
        "Running"
    case .failed:
        "Failed"
    case .pending:
        "Pending"
    case .unknown:
        "Unknown"
    }
}

func planStepStatusAccessibilityLabel(_ status: PlanStepStatusPresentation) -> String {
    let label = switch status {
    case .completed:
        "Completed"
    case .running:
        "In progress"
    case .failed:
        "Failed"
    case .pending:
        "Pending"
    case .unknown:
        "Unknown"
    }
    return "Plan step status: \(label)"
}

func buildPlanStepStatusPresentationState(_ status: PlanStepStatusPresentation) -> PlanStepStatusPresentationState {
    PlanStepStatusPresentationState(
        label: planStepStatusLabel(status),
        accessibilityLabel: planStepStatusAccessibilityLabel(status),
        tone: planStepStatusTone(status),
        running: status == .running
    )
}

func planStepStatusTone(_ status: PlanStepStatusPresentation) -> PlanStepStatusTonePresentation {
    switch status {
    case .completed:
        .success
    case .running:
        .running
    case .failed:
        .danger
    case .pending:
        .pending
    case .unknown:
        .unknown
    }
}

func planStepStatusPresentation(_ status: String?) -> PlanStepStatusPresentation {
    switch status?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "completed", "complete", "done", "success", "succeeded":
        .completed
    case "running", "started", "in_progress", "inprogress":
        .running
    case "failed", "error", "errored":
        .failed
    case "pending", "queued", "todo":
        .pending
    default:
        .unknown
    }
}

// swiftlint:disable:next cyclomatic_complexity
func historyItemKindPresentation(_ kind: String) -> HistoryItemKindPresentation? {
    switch kind {
    case "artifact":
        .artifact
    case "image":
        .image
    case "plan":
        .plan
    case "contextCompaction":
        .context
    case "commandExecution":
        .command
    case "webSearch":
        .webSearch
    case "fileRead":
        .fileRead
    case "fileChange":
        .fileChange
    case "hook":
        .hook
    case "agentToolCall":
        .agentTool
    case "skillToolCall":
        .skillTool
    case "toolCall":
        .toolCall
    case "reasoning", "other":
        .generic
    default:
        nil
    }
}

// swiftlint:disable:next cyclomatic_complexity
func historyItemLabel(_ kind: HistoryItemKindPresentation) -> String {
    switch kind {
    case .plan:
        "Plan"
    case .context:
        "Context"
    case .command:
        "Command"
    case .toolCall:
        "Tool"
    case .agentTool:
        "Agent"
    case .skillTool:
        "Skill"
    case .webSearch:
        "Web Search"
    case .fileRead:
        "File Read"
    case .fileChange:
        "File Change"
    case .image:
        "Image"
    case .artifact:
        "Artifact"
    case .hook:
        "Hook"
    case .generic:
        "Other"
    }
}

// swiftlint:disable:next cyclomatic_complexity
func historyItemShortLabel(_ kind: HistoryItemKindPresentation) -> String {
    switch kind {
    case .plan:
        "PLAN"
    case .context:
        "CTX"
    case .command:
        "CMD"
    case .toolCall:
        "TOOL"
    case .agentTool:
        "AGT"
    case .skillTool:
        "SKL"
    case .webSearch:
        "WEB"
    case .fileRead:
        "READ"
    case .fileChange:
        "DIFF"
    case .image:
        "IMG"
    case .artifact:
        "ART"
    case .hook:
        "HOOK"
    case .generic:
        "INFO"
    }
}

func tokenSummary(_ usage: SupervisorThreadTurnTokenUsage) -> String {
    let total = usage.totalTokens ?? [usage.inputTokens, usage.outputTokens].compactMap(\.self).reduce(0, +)
    guard total > 0 else { return "" }
    return "\(compactNumber(total)) tokens"
}

func tokenDetails(_ usage: SupervisorThreadTurnTokenUsage) -> String? {
    let parts = [
        usage.inputTokens.map { "\(compactNumber($0)) in" },
        usage.outputTokens.map { "\(compactNumber($0)) out" },
        usage.totalTokens.map { "\(compactNumber($0)) total" }
    ].compactMap(\.self)
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

func contextDetails(_ context: SupervisorThreadContextUsage?) -> String? {
    guard let context else { return nil }
    let parts = [
        context.tokensInContextWindow.map { "\(compactNumber($0)) in window" },
        context.modelContextWindow.map { "\(compactNumber($0)) window" },
        context.usedTokens.map { "\(compactNumber($0)) used" },
        context.maxTokens.map { "\(compactNumber($0)) max" },
        context.availability?.trimmedNonEmpty.map { "availability \($0)" }
    ].compactMap(\.self)
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
}

func summarizeThreadUsage(_ detail: SupervisorThreadDetail) -> String {
    if let context = detail.contextUsage {
        if let remaining = context.remainingPercent {
            return "\(remaining)% context remaining"
        }
        if let percent = context.percent {
            return "\(Int(percent.rounded()))% context used"
        }
        if let used = context.usedTokens, let maxTokens = context.maxTokens, maxTokens > 0 {
            return "\(compactNumber(used)) / \(compactNumber(maxTokens)) context tokens"
        }
    }
    return "waiting for agent usage"
}

func shortThreadTimeLabel(_ isoString: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = formatter.date(from: isoString) ?? ISO8601DateFormatter().date(from: isoString)
    guard let date else { return isoString }
    let output = DateFormatter()
    output.locale = Locale(identifier: "en_US_POSIX")
    output.dateFormat = "HH:mm"
    return output.string(from: date)
}

private func historyItemTitle(kind: HistoryItemKindPresentation, item: SupervisorThreadTurnItem) -> String {
    switch kind {
    case .image:
        item.payload?.string("assetPath").map(basenameForPresentation) ?? "Image"
    case .artifact:
        item.payload?.string("artifactTitle")?.trimmedNonEmpty ?? "Artifact"
    case .hook:
        item.payload?.string("hookEventLabel")?.trimmedNonEmpty ?? "Hook"
    case .fileRead, .fileChange:
        item.payload?.string("previewText")?.trimmedNonEmpty ?? item.text?.trimmedNonEmpty ?? defaultHistorySummary(kind)
    default:
        item.text?.split(separator: "\n").first.map(String.init)?.trimmedNonEmpty
            ?? item.payload?.string("previewText")?.trimmedNonEmpty
            ?? defaultHistorySummary(kind)
    }
}

private func historyItemMeta(kind: HistoryItemKindPresentation, item: SupervisorThreadTurnItem) -> String? {
    let value = switch kind {
    case .image:
        item.payload?.string("assetPath")
    case .artifact:
        item.payload?.string("artifactType")
    case .hook:
        item.payload?.string("hookStatusMessage")
    default:
        item.status
    }
    return value?.trimmedNonEmpty
}

private func defaultHistorySummary(_ kind: HistoryItemKindPresentation) -> String {
    switch kind {
    case .image:
        "Image generated"
    case .fileChange:
        "File changes"
    case .fileRead:
        "File read"
    case .command:
        "Command execution"
    case .webSearch:
        "Web search"
    case .artifact:
        "Artifact"
    case .hook:
        "Hook"
    default:
        "Thread event"
    }
}

private func defaultHistoryActionLabel(_ kind: HistoryItemKindPresentation) -> String? {
    switch kind {
    case .command:
        "Command Output"
    case .webSearch:
        "Web Search Details"
    case .fileRead:
        "File Read Details"
    case .fileChange:
        "File Change Details"
    case .toolCall:
        "Tool Call Details"
    case .agentTool:
        "Agent Details"
    case .skillTool:
        "Skill Details"
    default:
        nil
    }
}

private func historyItemCopyText(
    title: String,
    summary: String,
    meta: String?,
    callId: String?,
    toolName: String?
) -> String {
    let lines = [
        title.trimmedNonEmpty,
        summary.trimmedNonEmpty,
        meta?.trimmedNonEmpty.map { "Status: \($0)" },
        toolName?.trimmedNonEmpty.map { "Tool: \($0)" },
        callId?.trimmedNonEmpty.map { "Call ID: \($0)" }
    ]
    .compactMap(\.self)
    return lines.reduce(into: [String]()) { result, line in
        if result.last != line {
            result.append(line)
        }
    }
    .joined(separator: "\n")
}

private func activityNoteTitle(_ note: SupervisorThreadActivityNote) -> String {
    switch note.kind {
    case "fastMode":
        "Fast mode"
    case "forkCreated":
        "Fork created"
    case "forkSource":
        "Fork source"
    default:
        "Activity"
    }
}

private func activityNoteSummaryLines(_ note: SupervisorThreadActivityNote) -> [String] {
    if let text = note.text?.trimmedNonEmpty {
        return [text]
    }
    switch note.kind {
    case "forkCreated":
        return [note.linkedThreadTitle?.trimmedNonEmpty.map { "Created \($0)" } ?? "Fork created"]
    case "forkSource":
        return [note.linkedThreadTitle?.trimmedNonEmpty.map { "Forked from \($0)" } ?? "Fork source"]
    case "fastMode":
        return ["Runtime mode changed"]
    default:
        return ["Thread activity"]
    }
}

private func activityNoteStatusLabel(_ note: SupervisorThreadActivityNote) -> String? {
    if let turnIndex = note.turnIndex {
        return "Turn \(turnIndex)"
    }
    return note.linkedThreadTitle?.trimmedNonEmpty
}

private func isRunningStatus(_ status: String?) -> Bool {
    switch status?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "running", "started", "in_progress":
        true
    default:
        false
    }
}

private func compactNumber(_ value: Int) -> String {
    if value >= 1000 {
        let formatted = Double(value) / 1000
        return formatted.truncatingRemainder(dividingBy: 1) == 0
            ? "\(Int(formatted))k"
            : String(format: "%.1fk", formatted)
    }
    return "\(value)"
}

private func basenameForPresentation(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.split(separator: "/").last.map(String.init) ?? trimmed
}

private extension SupervisorWorkspaceTreeNode {
    var firstFilePath: String? {
        if kind == "file" {
            return path
        }
        return children?.lazy.compactMap(\.firstFilePath).first
    }
}
