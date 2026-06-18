import Foundation

struct ThreadProjectionState: Equatable {
    var detail: SupervisorThreadDetail
    var seenOutputDeltaKeys: [String] = []
    var provisionalAnsweredRequestNotes: [String: SupervisorThreadAnsweredRequestNote] = [:]
    var seenEventKeys: [String] = []
    var lastEventCursor: String?
}

struct ThreadEventReduceResult: Equatable {
    var state: ThreadProjectionState
    var needsRefresh = false

    var detail: SupervisorThreadDetail {
        state.detail
    }
}

func reduceThreadEvent(detail: SupervisorThreadDetail, event: SupervisorThreadEvent) -> ThreadEventReduceResult {
    reduceThreadEvent(state: ThreadProjectionState(detail: detail), event: event)
}

// swiftlint:disable:next cyclomatic_complexity
func reduceThreadEvent(state: ThreadProjectionState, event: SupervisorThreadEvent) -> ThreadEventReduceResult {
    let detail = state.detail
    guard event.threadId == detail.thread.id else {
        return ThreadEventReduceResult(state: state)
    }
    let eventKey = event.stableEventKey
    guard !state.seenEventKeys.contains(eventKey) else {
        return ThreadEventReduceResult(state: state)
    }
    let nextBaseState = state
        .addingSeenEventKey(eventKey)
        .withLastCursor(event.cursor ?? event.eventId ?? event.sequence.map(String.init) ?? state.lastEventCursor)

    switch event.type {
    case "thread.updated":
        return reduceThreadUpdated(nextBaseState, event: event)
    case "thread.goal.updated":
        return reduceGoalUpdated(nextBaseState, payload: event.payload)
    case "thread.goal.cleared":
        var next = detail
        next.goalStatus = nil
        next.goalObjective = nil
        return ThreadEventReduceResult(state: nextBaseState.withDetail(next))
    case "thread.turn.started":
        return reduceTurnStarted(nextBaseState, event: event)
    case "thread.turn.completed", "thread.turn.failed":
        return reduceTurnFinished(nextBaseState, event: event)
    case "thread.turn.token.updated":
        return reduceTurnTokenUpdated(nextBaseState, payload: event.payload)
    case "thread.item.started", "thread.item.completed":
        return reduceThreadItem(nextBaseState, payload: event.payload)
    case "thread.request.created":
        return reduceRequestCreated(nextBaseState, payload: event.payload)
    case "thread.request.resolved":
        return reduceRequestResolved(nextBaseState, event: event)
    case "thread.output.delta":
        return reduceOutputDelta(nextBaseState, payload: event.payload)
    case "thread.context.updated":
        return reduceContextUpdated(nextBaseState, payload: event.payload)
    case "thread.plan.updated":
        return reducePlanUpdated(nextBaseState, event: event)
    default:
        return ThreadEventReduceResult(state: nextBaseState, needsRefresh: true)
    }
}

extension ThreadProjectionState {
    func reconcile(with detail: SupervisorThreadDetail) -> ThreadProjectionState {
        withDetail(mergeDetailWithLocalProjection(serverDetail: detail), provisionalAnsweredRequestNotes: provisionalAnsweredRequestNotes)
    }

    func prependingOlderHistory(_ olderDetail: SupervisorThreadDetail) -> ThreadProjectionState {
        let currentIds = Set(detail.turns.map(\.id))
        let olderOnly = olderDetail.turns.filter { !currentIds.contains($0.id) }
        guard !olderOnly.isEmpty else { return self }
        var nextDetail = detail
        nextDetail.turns = olderOnly + detail.turns
        nextDetail.turnCount = max(detail.turnCount ?? 0, nextDetail.turns.count)
        nextDetail.totalTurnCount = max(detail.totalTurnCount ?? 0, olderDetail.totalTurnCount ?? 0, nextDetail.turns.count)
        return withDetail(nextDetail)
    }

    fileprivate func withDetail(
        _ detail: SupervisorThreadDetail,
        provisionalAnsweredRequestNotes: [String: SupervisorThreadAnsweredRequestNote]? = nil
    ) -> ThreadProjectionState {
        let provisionalNotes = provisionalAnsweredRequestNotes ?? self.provisionalAnsweredRequestNotes
        let serverAnsweredIds = Set((detail.answeredRequestNotes ?? []).map(\.id))
        let retainedProvisionalNotes = provisionalNotes.filter { requestId, _ in
            !serverAnsweredIds.contains(requestId)
        }
        var reconciledDetail = detail
        if !retainedProvisionalNotes.isEmpty {
            reconciledDetail.answeredRequestNotes = (detail.answeredRequestNotes ?? []) + retainedProvisionalNotes.values
        }
        let livePrefixes = reconciledDetail.turns.flatMap { turn in
            turn.items.map { item in "\(turn.id):\(item.id):" }
        }
        let retainedDeltaKeys = seenOutputDeltaKeys.filter { key in
            livePrefixes.contains { prefix in key.hasPrefix(prefix) }
        }
        var next = self
        next.detail = reconciledDetail
        next.seenOutputDeltaKeys = retainedDeltaKeys
        next.provisionalAnsweredRequestNotes = retainedProvisionalNotes
        return next
    }
}

private func reduceThreadUpdated(_ state: ThreadProjectionState, event: SupervisorThreadEvent) -> ThreadEventReduceResult {
    var detail = state.detail
    var thread = detail.thread
    thread.title = event.payload.string("title") ?? thread.title
    thread.status = event.payload.string("status") ?? thread.status
    if event.payload.keys.contains("model") {
        thread.model = event.payload.string("model")
    }
    if event.payload.keys.contains("reasoningEffort") {
        thread.reasoningEffort = event.payload.string("reasoningEffort")
    }
    if let fastMode = event.payload.bool("fastMode") {
        thread.fastMode = fastMode
    }
    thread.collaborationMode = event.payload.string("collaborationMode") ?? thread.collaborationMode
    if event.payload.keys.contains("sandboxMode") {
        thread.sandboxMode = event.payload.string("sandboxMode")
    }
    thread.updatedAt = event.timestamp ?? thread.updatedAt
    detail.thread = thread
    return ThreadEventReduceResult(state: state.withDetail(detail))
}

private func reduceGoalUpdated(_ state: ThreadProjectionState, payload: [String: JSONValue]) -> ThreadEventReduceResult {
    var detail = state.detail
    let goal = payload.object("goal")
    detail.goalStatus = goal?.string("status")
    detail.goalObjective = goal?.string("objective")
    return ThreadEventReduceResult(state: state.withDetail(detail))
}

private func reduceTurnStarted(_ state: ThreadProjectionState, event: SupervisorThreadEvent) -> ThreadEventReduceResult {
    var detail = state.detail
    guard let turnId = event.payload.string("turnId") else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    guard !detail.turns.contains(where: { $0.id == turnId }) else {
        return ThreadEventReduceResult(state: state)
    }
    let turn = SupervisorThreadTurn(
        id: turnId,
        startedAt: event.timestamp,
        status: "running",
        error: nil,
        model: detail.thread.model,
        tokenUsage: nil,
        items: []
    )
    detail.turns.append(turn)
    detail.turnCount = max(detail.turnCount ?? 0, detail.turns.count)
    detail.totalTurnCount = max(detail.totalTurnCount ?? 0, detail.turns.count)
    detail.thread.status = "running"
    detail.thread.updatedAt = event.timestamp ?? detail.thread.updatedAt
    return ThreadEventReduceResult(state: state.withDetail(detail))
}

private func reduceTurnFinished(_ state: ThreadProjectionState, event: SupervisorThreadEvent) -> ThreadEventReduceResult {
    var detail = state.detail
    guard let turnId = event.payload.string("turnId") else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    let status = event.payload.string("status") ?? (event.type == "thread.turn.failed" ? "failed" : nil)
    let error = event.payload.string("error")
    guard let index = detail.turns.firstIndex(where: { $0.id == turnId }) else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    detail.turns[index].status = status ?? detail.turns[index].status
    detail.turns[index].error = error
    detail.thread.status = status ?? detail.thread.status
    detail.thread.updatedAt = event.timestamp ?? detail.thread.updatedAt
    return ThreadEventReduceResult(state: state.withDetail(detail), needsRefresh: true)
}

private func reduceTurnTokenUpdated(_ state: ThreadProjectionState, payload: [String: JSONValue]) -> ThreadEventReduceResult {
    var detail = state.detail
    guard let turnId = payload.string("turnId"),
          let tokenUsage = payload.object("tokenUsage")?.decode(SupervisorThreadTurnTokenUsage.self)
    else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    guard let index = detail.turns.firstIndex(where: { $0.id == turnId }) else {
        return ThreadEventReduceResult(state: state.withDetail(detail), needsRefresh: true)
    }
    detail.turns[index].tokenUsage = tokenUsage
    return ThreadEventReduceResult(state: state.withDetail(detail))
}

private func reduceContextUpdated(_ state: ThreadProjectionState, payload: [String: JSONValue]) -> ThreadEventReduceResult {
    guard let usage = payload.object("contextUsage")?.decode(SupervisorThreadContextUsage.self) else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    var detail = state.detail
    detail.contextUsage = usage
    return ThreadEventReduceResult(state: state.withDetail(detail))
}

private func reducePlanUpdated(_ state: ThreadProjectionState, event: SupervisorThreadEvent) -> ThreadEventReduceResult {
    guard let turnId = event.payload.string("turnId"),
          let steps = event.payload.array("plan")?.compactMap(livePlanStep),
          !steps.isEmpty
    else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    var detail = state.detail
    detail.livePlan = SupervisorThreadLivePlan(
        turnId: turnId,
        explanation: event.payload.string("explanation"),
        plan: steps,
        updatedAt: event.timestamp
    )
    if !detail.turns.contains(where: { $0.id == turnId }) {
        detail.turns.append(
            SupervisorThreadTurn(
                id: turnId,
                startedAt: event.timestamp,
                status: "running",
                error: nil,
                model: detail.thread.model,
                tokenUsage: nil,
                items: []
            )
        )
        detail.turnCount = max(detail.turnCount ?? 0, detail.turns.count)
        detail.totalTurnCount = max(detail.totalTurnCount ?? 0, detail.turns.count)
    }
    detail.thread.status = "running"
    detail.thread.updatedAt = event.timestamp ?? detail.thread.updatedAt
    return ThreadEventReduceResult(state: state.withDetail(detail))
}

private func livePlanStep(_ value: JSONValue) -> SupervisorThreadLivePlanStep? {
    guard case let .object(object) = value,
          let step = object.string("step")?.trimmedNonEmpty
    else { return nil }
    return SupervisorThreadLivePlanStep(
        step: step,
        status: object.string("status") ?? "unknown"
    )
}

private func reduceThreadItem(_ state: ThreadProjectionState, payload: [String: JSONValue]) -> ThreadEventReduceResult {
    var detail = state.detail
    guard let turnId = payload.string("turnId"),
          let item = payload.object("item")?.decode(SupervisorThreadTurnItem.self)
    else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    guard let index = detail.turns.firstIndex(where: { $0.id == turnId }) else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    let protectedIds = Set(state.seenOutputDeltaKeys.deltaItemIds)
    detail.turns[index].items = upsertItem(
        items: detail.turns[index].items,
        item: item,
        protectedItemIds: protectedIds
    )
    return ThreadEventReduceResult(state: state.withDetail(detail))
}

private func reduceRequestCreated(_ state: ThreadProjectionState, payload: [String: JSONValue]) -> ThreadEventReduceResult {
    guard let request = payload.object("request")?.decode(SupervisorThreadActionRequest.self) else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    var detail = state.detail
    detail.pendingRequests = upsertRequest(detail.pendingRequests ?? [], request: request)
    return ThreadEventReduceResult(state: state.withDetail(detail))
}

private func reduceRequestResolved(_ state: ThreadProjectionState, event: SupervisorThreadEvent) -> ThreadEventReduceResult {
    var detail = state.detail
    guard let requestId = event.payload.string("requestId") else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    let request = (detail.pendingRequests ?? []).first { $0.id == requestId }
    let summaryLines = event.payload.array("summaryLines")?.compactMap(\.stringValue)
    let answeredNote = request?.resolvedAnsweredNote(
        requestId: requestId,
        timestamp: event.payload.string("createdAt") ?? event.payload.string("resolvedAt") ?? event.timestamp,
        summaryLines: summaryLines
    )
    detail.pendingRequests = (detail.pendingRequests ?? []).filter { $0.id != requestId }
    var provisional = state.provisionalAnsweredRequestNotes
    if let answeredNote {
        detail.answeredRequestNotes = upsertAnsweredRequestNote(detail.answeredRequestNotes ?? [], note: answeredNote)
        provisional[requestId] = answeredNote
    }
    return ThreadEventReduceResult(
        state: state.withDetail(detail, provisionalAnsweredRequestNotes: provisional),
        needsRefresh: true
    )
}

private func reduceOutputDelta(_ state: ThreadProjectionState, payload: [String: JSONValue]) -> ThreadEventReduceResult {
    var detail = state.detail
    guard let turnId = payload.string("turnId"),
          let itemId = payload.string("itemId"),
          let sequence = payload.int("sequence")
    else {
        return ThreadEventReduceResult(state: state, needsRefresh: true)
    }
    let delta = payload.string("delta") ?? ""
    let key = "\(turnId):\(itemId):\(sequence)"
    guard !state.seenOutputDeltaKeys.contains(key) else {
        return ThreadEventReduceResult(state: state)
    }
    var needsRefresh = false
    if let index = detail.turns.firstIndex(where: { $0.id == turnId }) {
        detail.turns[index].items = appendOutputDelta(
            items: detail.turns[index].items,
            itemId: itemId,
            sequence: sequence,
            delta: delta
        )
    } else {
        let turn = SupervisorThreadTurn(
            id: turnId,
            startedAt: nil,
            status: "running",
            error: nil,
            model: detail.thread.model,
            tokenUsage: nil,
            items: appendOutputDelta(items: [], itemId: itemId, sequence: sequence, delta: delta)
        )
        detail.turns.append(turn)
        detail.turnCount = max(detail.turnCount ?? 0, detail.turns.count)
        detail.totalTurnCount = max(detail.totalTurnCount ?? 0, detail.turns.count)
        needsRefresh = true
    }
    detail.liveItemCount = max(detail.liveItemCount ?? 0, 1)
    detail.thread.status = "running"
    var nextState = state.withDetail(detail)
    nextState.seenOutputDeltaKeys = (nextState.seenOutputDeltaKeys + [key]).suffixArray(512)
    return ThreadEventReduceResult(state: nextState, needsRefresh: needsRefresh)
}

private func appendOutputDelta(
    items: [SupervisorThreadTurnItem],
    itemId: String,
    sequence: Int,
    delta: String
) -> [SupervisorThreadTurnItem] {
    var next = items
    if let index = next.firstIndex(where: { $0.id == itemId }) {
        next[index].text = (next[index].text ?? "") + delta
        next[index].status = next[index].status ?? "running"
        return next
    }
    next.append(
        SupervisorThreadTurnItem(
            id: itemId,
            kind: "agentMessage",
            text: delta,
            status: "running",
            sequence: sequence,
            callId: nil,
            toolName: nil,
            payload: nil
        )
    )
    return next.sortedBySequence()
}

private func upsertItem(
    items: [SupervisorThreadTurnItem],
    item: SupervisorThreadTurnItem,
    protectedItemIds: Set<String>
) -> [SupervisorThreadTurnItem] {
    var next = items
    if let index = next.firstIndex(where: { $0.id == item.id }) {
        next[index] = mergeTurnItem(
            serverItem: item,
            localItem: next[index],
            protectLocalText: protectedItemIds.contains(next[index].id)
        )
    } else {
        next.append(item)
    }
    return next.sortedBySequence()
}

private func mergeTurnItem(
    serverItem: SupervisorThreadTurnItem,
    localItem: SupervisorThreadTurnItem,
    protectLocalText: Bool
) -> SupervisorThreadTurnItem {
    guard protectLocalText, localItem.shouldRetainAcrossRefresh(protectCompleted: true) else {
        return serverItem
    }
    if (serverItem.text ?? "").count >= (localItem.text ?? "").count {
        return serverItem
    }
    var next = serverItem
    next.text = localItem.text
    next.status = serverItem.status ?? localItem.status
    return next
}

private func upsertRequest(
    _ requests: [SupervisorThreadActionRequest],
    request: SupervisorThreadActionRequest
) -> [SupervisorThreadActionRequest] {
    var next = requests
    if let index = next.firstIndex(where: { $0.id == request.id }) {
        next[index] = request
    } else {
        next.append(request)
    }
    return next
}

private func upsertAnsweredRequestNote(
    _ notes: [SupervisorThreadAnsweredRequestNote],
    note: SupervisorThreadAnsweredRequestNote
) -> [SupervisorThreadAnsweredRequestNote] {
    var next = notes
    if let index = next.firstIndex(where: { $0.id == note.id }) {
        next[index] = note
    } else {
        next.append(note)
    }
    return next
}

private extension ThreadProjectionState {
    func addingSeenEventKey(_ key: String) -> ThreadProjectionState {
        var next = self
        next.seenEventKeys = (seenEventKeys + [key]).suffixArray(512)
        return next
    }

    func withLastCursor(_ cursor: String?) -> ThreadProjectionState {
        var next = self
        next.lastEventCursor = cursor
        return next
    }

    func mergeDetailWithLocalProjection(serverDetail: SupervisorThreadDetail) -> SupervisorThreadDetail {
        let localTurnsById = Dictionary(uniqueKeysWithValues: detail.turns.map { ($0.id, $0) })
        let serverTurnIds = Set(serverDetail.turns.map(\.id))
        let protectedItemIds = Set(seenOutputDeltaKeys.deltaItemIds)
        let mergedServerTurns = serverDetail.turns.map { serverTurn in
            guard let localTurn = localTurnsById[serverTurn.id] else { return serverTurn }
            var next = serverTurn
            next.items = mergeTurnItems(
                serverItems: serverTurn.items,
                localItems: localTurn.items,
                protectedItemIds: protectedItemIds,
                serverTurnCompleted: serverTurn.status == "completed" || serverTurn.status == "failed"
            )
            return next
        }
        let localOnlyTurns = detail.turns.filter { turn in
            !serverTurnIds.contains(turn.id) && turn.shouldRetainAcrossRefresh(protectedItemIds: protectedItemIds)
        }
        let mergedTurns = (mergedServerTurns + localOnlyTurns).sortedByExistingOrder(
            localTurns: detail.turns,
            serverTurns: serverDetail.turns
        )
        var next = serverDetail
        next.turns = mergedTurns
        next.turnCount = max(serverDetail.turnCount ?? 0, mergedTurns.count)
        next.totalTurnCount = max(serverDetail.totalTurnCount ?? 0, detail.totalTurnCount ?? 0, mergedTurns.count)
        next.liveItemCount = max(serverDetail.liveItemCount ?? 0, detail.liveItemCount ?? 0)
        return next
    }
}

private func mergeTurnItems(
    serverItems: [SupervisorThreadTurnItem],
    localItems: [SupervisorThreadTurnItem],
    protectedItemIds: Set<String>,
    serverTurnCompleted: Bool
) -> [SupervisorThreadTurnItem] {
    guard !localItems.isEmpty else { return serverItems }
    let localItemsById = Dictionary(uniqueKeysWithValues: localItems.map { ($0.id, $0) })
    let serverItemIds = Set(serverItems.map(\.id))
    let mergedServerItems = serverItems.map { serverItem in
        guard let localItem = localItemsById[serverItem.id] else { return serverItem }
        return mergeTurnItem(
            serverItem: serverItem,
            localItem: localItem,
            protectLocalText: protectedItemIds.contains(localItem.id)
        )
    }
    let localOnlyItems = localItems.filter { localItem in
        !serverItemIds.contains(localItem.id) &&
            localItem.shouldRetainAcrossRefresh(protectCompleted: protectedItemIds.contains(localItem.id)) &&
            !localItem.isSupersededByMaterializedServerItem(serverItems: serverItems, serverTurnCompleted: serverTurnCompleted)
    }
    return (mergedServerItems + localOnlyItems).sortedBySequence()
}

private extension SupervisorThreadTurnItem {
    func isSupersededByMaterializedServerItem(
        serverItems: [SupervisorThreadTurnItem],
        serverTurnCompleted: Bool
    ) -> Bool {
        guard kind == "agentMessage" else { return false }
        return serverItems.contains { serverItem in
            serverItem.kind == "agentMessage" &&
                serverItem.text?.trimmedNonEmpty != nil &&
                (sequence == nil || serverItem.sequence == sequence || (serverItem.sequence ?? 0) >= (sequence ?? 0) || serverTurnCompleted)
        }
    }

    func shouldRetainAcrossRefresh(protectCompleted: Bool = false) -> Bool {
        kind == "agentMessage" && text?.trimmedNonEmpty != nil && (protectCompleted || status != "completed")
    }
}

private extension SupervisorThreadTurn {
    func shouldRetainAcrossRefresh(protectedItemIds: Set<String> = []) -> Bool {
        status == "running" || items.contains { item in
            item.shouldRetainAcrossRefresh(protectCompleted: protectedItemIds.contains(item.id))
        }
    }
}

private extension SupervisorThreadActionRequest {
    func resolvedAnsweredNote(
        requestId: String,
        timestamp: String?,
        summaryLines: [String]?
    ) -> SupervisorThreadAnsweredRequestNote {
        SupervisorThreadAnsweredRequestNote(
            id: requestId,
            requestId: requestId,
            title: title?.trimmedNonEmpty ?? "Request resolved",
            summaryLines: summaryLines?.compactMap(\.trimmedNonEmpty).nilIfEmpty ?? ["Resolved"],
            turnId: turnId,
            itemId: itemId,
            createdAt: timestamp ?? createdAt,
            summary: nil
        )
    }
}

private extension [SupervisorThreadTurnItem] {
    func sortedBySequence() -> [SupervisorThreadTurnItem] {
        enumerated()
            .sorted { lhs, rhs in
                let left = lhs.element.sequence ?? (lhs.element.kind == "userMessage" ? Int.min : Int.max)
                let right = rhs.element.sequence ?? (rhs.element.kind == "userMessage" ? Int.min : Int.max)
                if left == right {
                    return lhs.offset < rhs.offset
                }
                return left < right
            }
            .map(\.element)
    }
}

private extension [SupervisorThreadTurn] {
    func sortedByExistingOrder(
        localTurns: [SupervisorThreadTurn],
        serverTurns: [SupervisorThreadTurn]
    ) -> [SupervisorThreadTurn] {
        var order: [String: Int] = [:]
        for (index, turn) in serverTurns.enumerated() {
            order[turn.id] = index
        }
        for (index, turn) in localTurns.enumerated() where order[turn.id] == nil {
            order[turn.id] = serverTurns.count + index
        }
        return sorted { (order[$0.id] ?? Int.max) < (order[$1.id] ?? Int.max) }
    }
}

private extension SupervisorThreadEvent {
    var stableEventKey: String {
        if let eventId = eventId?.trimmedNonEmpty {
            return "event-id:\(eventId)"
        }
        if let cursor = cursor?.trimmedNonEmpty {
            return "cursor:\(cursor)"
        }
        if let sequence {
            return "sequence:\(threadId):\(sequence)"
        }
        switch type {
        case "thread.output.delta":
            let turnId = payload.string("turnId") ?? ""
            let itemId = payload.string("itemId") ?? ""
            let sequence = payload.int("sequence")?.description ?? ""
            let deltaHash = (payload.string("delta") ?? "").hashValue
            return "\(type):\(threadId):\(turnId):\(itemId):\(sequence):\(deltaHash)"
        case "thread.item.started", "thread.item.completed":
            return "\(type):\(threadId):\(payload.string("turnId") ?? ""):\(payload.object("item")?.string("id") ?? ""):\(timestamp ?? "")"
        case "thread.request.created":
            return "\(type):\(threadId):\(payload.object("request")?.string("id") ?? ""):\(timestamp ?? "")"
        case "thread.request.resolved":
            return "\(type):\(threadId):\(payload.string("requestId") ?? ""):\(timestamp ?? "")"
        default:
            return "\(type):\(threadId):\(timestamp ?? ""):\(payload.description)"
        }
    }
}

private extension Array {
    func suffixArray(_ maxLength: Int) -> [Element] {
        count > maxLength ? Array(suffix(maxLength)) : self
    }
}

private extension [String] {
    var nilIfEmpty: [String]? {
        isEmpty ? nil : self
    }
}

private extension [JSONValue] {
    var stringValues: [String] {
        compactMap(\.stringValue)
    }
}

private extension [String] {
    var deltaItemIds: [String] {
        compactMap { key in
            let parts = key.split(separator: ":").map(String.init)
            return parts.count > 1 ? parts[1] : nil
        }
    }
}

extension [String: JSONValue] {
    func string(_ key: String) -> String? {
        self[key]?.stringValue
    }

    func bool(_ key: String) -> Bool? {
        guard case let .bool(value) = self[key] else { return nil }
        return value
    }

    func int(_ key: String) -> Int? {
        guard case let .number(value) = self[key] else { return nil }
        return Int(value)
    }

    func object(_ key: String) -> [String: JSONValue]? {
        guard case let .object(value) = self[key] else { return nil }
        return value
    }

    func array(_ key: String) -> [JSONValue]? {
        guard case let .array(value) = self[key] else { return nil }
        return value
    }

    func decode<T: Decodable>(_: T.Type) -> T? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

extension JSONValue {
    var stringValue: String? {
        guard case let .string(value) = self else { return nil }
        return value
    }
}
