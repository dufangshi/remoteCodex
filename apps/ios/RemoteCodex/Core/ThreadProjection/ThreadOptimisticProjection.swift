import Foundation

struct OptimisticPromptTurn: Equatable {
    var id: String
    var serverTurnId: String?
    var prompt: String
    var startedAt: String
    var model: String?
    var status: OptimisticPromptStatus = .sending
    var error: String?

    func withAcceptedThread(_ thread: SupervisorThreadSummary) -> OptimisticPromptTurn {
        var next = self
        next.model = thread.model ?? model
        next.status = .inProgress
        next.error = nil
        return next
    }

    func withStartedTurn(_ turnId: String) -> OptimisticPromptTurn {
        guard serverTurnId == nil else { return self }
        var next = self
        next.serverTurnId = turnId
        next.status = .inProgress
        return next
    }

    func withFailure(_ message: String) -> OptimisticPromptTurn {
        var next = self
        next.status = .failed
        next.error = message
        return next
    }
}

enum OptimisticPromptStatus: Equatable {
    case sending
    case inProgress
    case failed
}

func shouldClearOptimisticPrompt(detail: SupervisorThreadDetail, optimistic: OptimisticPromptTurn?) -> Bool {
    guard let optimistic, optimistic.status != .failed else { return false }
    return detail.turns.contains { turn in
        turn.matches(optimistic: optimistic) && turn.hasMatchingUserMessage(optimistic.prompt)
    }
}

func applyOptimisticPromptProjection(
    detail: SupervisorThreadDetail,
    optimistic: OptimisticPromptTurn?
) -> SupervisorThreadDetail {
    guard let optimistic else { return detail }

    let matchingIndex = detail.turns.firstIndex { $0.matches(optimistic: optimistic) }
    let optimisticTurn = optimistic.toSupervisorTurn(indexFallback: detail.turns.count)
    let projectedTurns: [SupervisorThreadTurn] = if let matchingIndex {
        detail.turns.enumerated().map { index, turn in
            index == matchingIndex ? turn.withOptimisticPromptItems(optimistic) : turn
        }
    } else {
        detail.turns + [optimisticTurn]
    }

    let running = optimistic.status != .failed
    var next = detail
    next.turns = projectedTurns
    next.turnCount = max(detail.turnCount ?? 0, projectedTurns.count)
    next.totalTurnCount = max(detail.totalTurnCount ?? 0, projectedTurns.count)
    if running {
        next.liveItemCount = max(detail.liveItemCount ?? 0, 1)
        next.thread.status = "running"
        next.thread.updatedAt = optimistic.startedAt
    }
    return next
}

private extension SupervisorThreadTurn {
    func matches(optimistic: OptimisticPromptTurn) -> Bool {
        id == optimistic.serverTurnId ||
            id == optimistic.id ||
            hasMatchingUserMessage(optimistic.prompt) ||
            hasPhotoPromptMatch(optimistic.prompt)
    }

    func hasMatchingUserMessage(_ prompt: String) -> Bool {
        let normalizedPrompt = prompt.normalizedPromptTextForProjection
        return items.contains { item in
            item.kind == "userMessage" &&
                item.text?.normalizedPromptTextForProjection == normalizedPrompt
        }
    }

    func hasPhotoPromptMatch(_ prompt: String) -> Bool {
        guard prompt.contains("[PHOTO ") else { return false }
        return items.contains { item in
            item.kind == "userMessage" &&
                (item.text?.contains("[PHOTO ") == true || item.text?.localizedCaseInsensitiveContains("![") == true)
        }
    }

    func withOptimisticPromptItems(_ optimistic: OptimisticPromptTurn) -> SupervisorThreadTurn {
        let userMessage = SupervisorThreadTurnItem(
            id: "\(optimistic.id)-user-message",
            kind: "userMessage",
            text: optimistic.prompt,
            status: nil,
            sequence: nil,
            callId: nil,
            toolName: nil,
            payload: nil
        )
        let orderedItems = hasMatchingUserMessage(optimistic.prompt) || hasPhotoPromptMatch(optimistic.prompt)
            ? items
            : [userMessage] + items
        let withPlaceholder = optimistic.status != .failed &&
            !orderedItems.contains { $0.kind == "agentMessage" }
            ? orderedItems + [optimistic.assistantPlaceholder(indexFallback: orderedItems.count + 1)]
            : orderedItems
        var next = self
        next.status = switch optimistic.status {
        case .failed:
            "failed"
        case .sending, .inProgress:
            status == "completed" || status == "failed" ? status : "running"
        }
        next.error = optimistic.error ?? error
        next.items = withPlaceholder.sortedOptimisticItems()
        return next
    }
}

private extension OptimisticPromptTurn {
    func toSupervisorTurn(indexFallback: Int) -> SupervisorThreadTurn {
        SupervisorThreadTurn(
            id: serverTurnId ?? id,
            startedAt: startedAt,
            status: status == .failed ? "failed" : "running",
            error: error,
            model: model,
            tokenUsage: nil,
            items: [
                SupervisorThreadTurnItem(
                    id: "\(id)-user-message",
                    kind: "userMessage",
                    text: prompt,
                    status: nil,
                    sequence: nil,
                    callId: nil,
                    toolName: nil,
                    payload: nil
                ),
                assistantPlaceholder(indexFallback: indexFallback + 1)
            ]
        )
    }

    func assistantPlaceholder(indexFallback: Int) -> SupervisorThreadTurnItem {
        SupervisorThreadTurnItem(
            id: "\(id)-assistant-placeholder",
            kind: "agentMessage",
            text: "",
            status: status == .failed ? nil : "running",
            sequence: indexFallback,
            callId: nil,
            toolName: nil,
            payload: nil
        )
    }
}

private extension [SupervisorThreadTurnItem] {
    func sortedOptimisticItems() -> [SupervisorThreadTurnItem] {
        enumerated()
            .sorted { lhs, rhs in
                let leftGroup = lhs.element.kind == "userMessage" ? 0 : 1
                let rightGroup = rhs.element.kind == "userMessage" ? 0 : 1
                if leftGroup != rightGroup {
                    return leftGroup < rightGroup
                }
                let leftSequence = lhs.element.sequence ?? Int.max
                let rightSequence = rhs.element.sequence ?? Int.max
                if leftSequence != rightSequence {
                    return leftSequence < rightSequence
                }
                return lhs.offset < rhs.offset
            }
            .map(\.element)
    }
}

private extension String {
    var normalizedPromptTextForProjection: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }
}
