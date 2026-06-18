@testable import RemoteCodex
import XCTest

final class ThreadProjectionTests: XCTestCase {
    func testThreadUpdatedAppliesStatusTitleAndSettingsLocally() throws {
        let result = try reduceThreadEvent(
            detail: baseDetail(),
            event: event(
                type: "thread.updated",
                payload: """
                {
                  "status": "running",
                  "title": "Renamed",
                  "model": "gpt-5.1",
                  "reasoningEffort": "high",
                  "fastMode": true,
                  "collaborationMode": "plan",
                  "sandboxMode": "read-only"
                }
                """
            )
        )

        XCTAssertFalse(result.needsRefresh)
        XCTAssertEqual(result.detail.thread.status, "running")
        XCTAssertEqual(result.detail.thread.title, "Renamed")
        XCTAssertEqual(result.detail.thread.model, "gpt-5.1")
        XCTAssertEqual(result.detail.thread.reasoningEffort, "high")
        XCTAssertEqual(result.detail.thread.fastMode, true)
        XCTAssertEqual(result.detail.thread.collaborationMode, "plan")
        XCTAssertEqual(result.detail.thread.sandboxMode, "read-only")
        XCTAssertEqual(result.detail.thread.updatedAt, "2026-06-11T12:00:10.000Z")
    }

    func testRequestCreatedUpsertsAndResolvedAddsProvisionalAnsweredNote() throws {
        let created = try reduceThreadEvent(
            detail: baseDetail(),
            event: event(
                type: "thread.request.created",
                payload: """
                {
                  "request": {
                    "id": "request-1",
                    "kind": "requestUserInput",
                    "title": "Choose",
                    "description": "Pick one",
                    "turnId": "turn-1",
                    "itemId": "item-0",
                    "createdAt": "2026-06-11T12:00:11.000Z",
                    "questions": [
                      {
                        "id": "question-1",
                        "header": "Mode",
                        "question": "Which mode?",
                        "multiSelect": false,
                        "isOther": true,
                        "options": [
                          {"label": "Continue", "description": "Proceed"}
                        ]
                      }
                    ]
                  }
                }
                """
            )
        )

        XCTAssertFalse(created.needsRefresh)
        XCTAssertEqual(created.detail.pendingRequests?.single?.id, "request-1")
        XCTAssertEqual(created.detail.pendingRequests?.single?.questions?.single?.question, "Which mode?")

        let resolved = try reduceThreadEvent(
            state: created.state,
            event: event(type: "thread.request.resolved", payload: #"{"requestId":"request-1"}"#)
        )

        XCTAssertTrue(resolved.needsRefresh)
        XCTAssertEqual(resolved.detail.pendingRequests?.count, 0)
        XCTAssertEqual(resolved.detail.answeredRequestNotes?.single?.id, "request-1")
        XCTAssertEqual(resolved.detail.answeredRequestNotes?.single?.summaryLines, ["Resolved"])
    }

    func testTurnItemAndCompletionEventsBuildLocalTimeline() throws {
        let started = try reduceThreadEvent(
            detail: baseDetail(turns: []),
            event: event(type: "thread.turn.started", payload: #"{"turnId":"turn-2"}"#)
        )
        XCTAssertEqual(started.detail.turns.single?.id, "turn-2")
        XCTAssertEqual(started.detail.turns.single?.status, "running")

        let itemStarted = try reduceThreadEvent(
            state: started.state,
            event: event(
                type: "thread.item.started",
                payload: """
                {
                  "turnId": "turn-2",
                  "item": {
                    "id": "item-1",
                    "kind": "agentMessage",
                    "text": "Working",
                    "status": "running"
                  }
                }
                """
            )
        )
        XCTAssertEqual(itemStarted.detail.turns.single?.items.single?.text, "Working")

        let completed = try reduceThreadEvent(
            state: itemStarted.state,
            event: event(type: "thread.turn.completed", payload: #"{"turnId":"turn-2","status":"completed"}"#)
        )
        XCTAssertEqual(completed.detail.turns.single?.status, "completed")
        XCTAssertEqual(completed.detail.thread.status, "completed")
        XCTAssertTrue(completed.needsRefresh)
    }

    func testStreamingOutputDeltaAppendsAndDeduplicatesBySequence() throws {
        let first = try reduceThreadEvent(
            detail: baseDetail(),
            event: event(
                type: "thread.output.delta",
                payload: #"{"turnId":"turn-1","itemId":"item-1","sequence":1,"delta":"hello"}"#
            )
        )

        XCTAssertFalse(first.needsRefresh)
        XCTAssertEqual(first.detail.turns.single?.items.first { $0.id == "item-1" }?.text, "hello")

        let duplicate = try reduceThreadEvent(
            state: first.state,
            event: event(
                type: "thread.output.delta",
                payload: #"{"turnId":"turn-1","itemId":"item-1","sequence":1,"delta":"hello"}"#
            )
        )
        XCTAssertEqual(duplicate.detail.turns.single?.items.first { $0.id == "item-1" }?.text, "hello")

        let second = try reduceThreadEvent(
            state: duplicate.state,
            event: event(
                type: "thread.output.delta",
                payload: #"{"turnId":"turn-1","itemId":"item-1","sequence":2,"delta":" world"}"#
            )
        )
        XCTAssertEqual(second.detail.turns.single?.items.first { $0.id == "item-1" }?.text, "hello world")
    }

    func testReconcileKeepsLongerStreamingTextUntilServerCatchesUp() throws {
        let streaming = try reduceThreadEvent(
            detail: baseDetail(),
            event: event(
                type: "thread.output.delta",
                payload: #"{"turnId":"turn-1","itemId":"item-1","sequence":1,"delta":"partial reply with more text"}"#
            )
        )
        let shortRefresh = streaming.state.reconcile(
            with: baseDetail(
                turns: [
                    turn(
                        id: "turn-1",
                        status: "running",
                        items: [
                            item(id: "item-0", kind: "userMessage", text: "Start"),
                            item(id: "item-1", kind: "agentMessage", text: "partial", status: "running")
                        ]
                    )
                ]
            )
        )

        XCTAssertEqual(
            shortRefresh.detail.turns.single?.items.first { $0.id == "item-1" }?.text,
            "partial reply with more text"
        )
    }

    func testDuplicateEventEnvelopeIsIgnoredAndLastCursorTracked() throws {
        let socketEvent = try event(
            type: "thread.turn.started",
            payload: #"{"turnId":"turn-2"}"#,
            eventId: "event-1",
            cursor: "cursor-1",
            sequence: 7
        )
        let first = reduceThreadEvent(detail: baseDetail(turns: []), event: socketEvent)
        let duplicate = reduceThreadEvent(state: first.state, event: socketEvent)

        XCTAssertEqual(first.detail.turns.count, 1)
        XCTAssertEqual(duplicate.detail.turns.count, 1)
        XCTAssertEqual(duplicate.state.lastEventCursor, "cursor-1")
    }

    func testPrependingOlderHistoryKeepsCurrentLiveState() throws {
        let streaming = try reduceThreadEvent(
            detail: baseDetail(
                turns: [
                    turn(id: "turn-2", items: [item(id: "item-2", kind: "userMessage", text: "Current")])
                ]
            ),
            event: event(
                type: "thread.output.delta",
                payload: #"{"turnId":"turn-2","itemId":"stream-1","sequence":1,"delta":"live"}"#
            )
        )
        let older = baseDetail(
            turns: [
                turn(id: "turn-1", status: "completed", items: [item(id: "item-1", kind: "userMessage", text: "Older")])
            ]
        )

        let merged = streaming.state.prependingOlderHistory(older)

        XCTAssertEqual(merged.detail.turns.map(\.id), ["turn-1", "turn-2"])
        XCTAssertEqual(merged.detail.turns.last?.items.first { $0.id == "stream-1" }?.text, "live")
    }

    func testPlanUpdatedProjectsLivePlanAndCreatesMissingTurn() throws {
        let result = try reduceThreadEvent(
            detail: baseDetail(turns: []),
            event: event(
                type: "thread.plan.updated",
                payload: """
                {
                  "turnId": "turn-plan",
                  "explanation": "Ship the fix in three steps.",
                  "plan": [
                    {"step": "Inspect current state", "status": "in_progress"},
                    {"step": "Patch the UI", "status": "pending"},
                    {"step": "Verify the result", "status": "completed"}
                  ]
                }
                """
            )
        )

        XCTAssertFalse(result.needsRefresh)
        XCTAssertEqual(result.detail.livePlan?.turnId, "turn-plan")
        XCTAssertEqual(result.detail.livePlan?.explanation, "Ship the fix in three steps.")
        XCTAssertEqual(result.detail.livePlan?.plan.map(\.step), ["Inspect current state", "Patch the UI", "Verify the result"])
        XCTAssertEqual(result.detail.livePlan?.updatedAt, "2026-06-11T12:00:10.000Z")
        XCTAssertEqual(result.detail.turns.single?.id, "turn-plan")
        XCTAssertEqual(result.detail.turns.single?.status, "running")
        XCTAssertEqual(result.detail.thread.status, "running")
    }
}

private extension ThreadProjectionTests {
    func event(
        type: String,
        payload: String,
        eventId: String? = nil,
        cursor: String? = nil,
        sequence: Int64? = nil
    ) throws -> SupervisorThreadEvent {
        let envelope = """
        {
          "type": "\(type)",
          "threadId": "thread-1",
          "timestamp": "2026-06-11T12:00:10.000Z",
          \(eventId.map { #""eventId": "\#($0)","# } ?? "")
          \(cursor.map { #""cursor": "\#($0)","# } ?? "")
          \(sequence.map { #""sequence": \#($0),"# } ?? "")
          "payload": \(payload)
        }
        """
        return try XCTUnwrap(parseSupervisorThreadEvent(envelope))
    }

    func baseDetail(
        turns: [SupervisorThreadTurn]? = nil,
        pendingRequests: [SupervisorThreadActionRequest] = [],
        answeredRequestNotes: [SupervisorThreadAnsweredRequestNote] = []
    ) -> SupervisorThreadDetail {
        let resolvedTurns = turns ?? [turn()]
        return SupervisorThreadDetail(
            thread: SupervisorThreadSummary(
                id: "thread-1",
                workspaceId: "workspace-1",
                provider: "codex",
                title: "Thread",
                status: "idle",
                model: "gpt-5",
                reasoningEffort: "medium",
                fastMode: false,
                collaborationMode: "default",
                sandboxMode: "workspace-write",
                updatedAt: "2026-06-11T12:00:00.000Z",
                summaryText: nil,
                isLoaded: true
            ),
            workspace: SupervisorWorkspaceSummary(
                id: "workspace-1",
                label: "repo",
                absPath: "/repo",
                isFavorite: false,
                lastOpenedAt: nil
            ),
            turns: resolvedTurns,
            pendingRequests: pendingRequests,
            answeredRequestNotes: answeredRequestNotes,
            turnCount: resolvedTurns.count,
            totalTurnCount: resolvedTurns.count,
            liveItemCount: 0,
            contextUsage: nil,
            goalStatus: nil,
            goalObjective: nil
        )
    }

    func turn(
        id: String = "turn-1",
        status: String = "running",
        items: [SupervisorThreadTurnItem]? = nil
    ) -> SupervisorThreadTurn {
        SupervisorThreadTurn(
            id: id,
            startedAt: "2026-06-11T12:00:00.000Z",
            status: status,
            error: nil,
            model: "gpt-5",
            tokenUsage: nil,
            items: items ?? [item(id: "item-0", kind: "userMessage", text: "Start")]
        )
    }

    func item(
        id: String,
        kind: String,
        text: String,
        status: String? = nil,
        sequence: Int? = nil
    ) -> SupervisorThreadTurnItem {
        SupervisorThreadTurnItem(
            id: id,
            kind: kind,
            text: text,
            status: status,
            sequence: sequence,
            callId: nil,
            toolName: nil,
            payload: nil
        )
    }
}

private extension Array {
    var single: Element? {
        count == 1 ? first : nil
    }
}
