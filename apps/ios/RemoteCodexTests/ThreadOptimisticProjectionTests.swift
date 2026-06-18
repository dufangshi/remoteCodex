@testable import RemoteCodex
import XCTest

final class ThreadOptimisticProjectionTests: XCTestCase {
    func testOptimisticPromptAppearsImmediatelyWithAssistantPlaceholder() {
        let projected = applyOptimisticPromptProjection(
            detail: baseDetail(turns: []),
            optimistic: optimisticPrompt()
        )

        let turn = projected.turns.single
        XCTAssertEqual(turn?.status, "running")
        XCTAssertEqual(turn?.items.map(\.kind), ["userMessage", "agentMessage"])
        XCTAssertEqual(turn?.items.first?.text, "Run tests")
        XCTAssertEqual(turn?.items.last?.text, "")
        XCTAssertEqual(turn?.items.last?.status, "running")
    }

    func testOptimisticPromptIsInjectedBeforeAgentOnlyServerTurn() {
        let projected = applyOptimisticPromptProjection(
            detail: baseDetail(
                turns: [
                    turn(
                        id: "turn-server",
                        items: [
                            item(id: "agent-1", kind: "agentMessage", text: "Working", status: "running", sequence: 1)
                        ]
                    )
                ]
            ),
            optimistic: optimisticPrompt(serverTurnId: "turn-server")
        )

        let turn = projected.turns.single
        XCTAssertEqual(turn?.items.map(\.kind), ["userMessage", "agentMessage"])
        XCTAssertEqual(turn?.items.first?.text, "Run tests")
        XCTAssertEqual(turn?.items.last?.text, "Working")
    }

    func testMaterializedMatchingUserMessageClearsOptimisticPrompt() {
        let detail = baseDetail(
            turns: [
                turn(
                    id: "turn-server",
                    items: [
                        item(id: "user-1", kind: "userMessage", text: "Run   tests"),
                        item(id: "agent-1", kind: "agentMessage", text: "Working", status: "running", sequence: 1)
                    ]
                )
            ]
        )

        XCTAssertTrue(shouldClearOptimisticPrompt(detail: detail, optimistic: optimisticPrompt(serverTurnId: "turn-server")))
        XCTAssertEqual(applyOptimisticPromptProjection(detail: detail, optimistic: nil).turns.single?.items.count, 2)
    }

    func testFailedOptimisticPromptIsNotClearedByMissingServerUserMessage() {
        let failed = optimisticPrompt().withFailure("Network failed")

        XCTAssertFalse(shouldClearOptimisticPrompt(detail: baseDetail(turns: []), optimistic: failed))
        let projected = applyOptimisticPromptProjection(detail: baseDetail(turns: []), optimistic: failed)

        XCTAssertEqual(projected.turns.single?.status, "failed")
        XCTAssertEqual(projected.turns.single?.error, "Network failed")
        XCTAssertEqual(projected.turns.single?.items.map(\.kind), ["userMessage", "agentMessage"])
    }
}

private extension ThreadOptimisticProjectionTests {
    func optimisticPrompt(serverTurnId: String? = nil) -> OptimisticPromptTurn {
        OptimisticPromptTurn(
            id: "optimistic-1",
            serverTurnId: serverTurnId,
            prompt: "Run tests",
            startedAt: "2026-06-11T12:00:00.000Z",
            model: "gpt-5"
        )
    }

    func baseDetail(turns: [SupervisorThreadTurn]) -> SupervisorThreadDetail {
        SupervisorThreadDetail(
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
            turns: turns,
            pendingRequests: [],
            answeredRequestNotes: [],
            turnCount: turns.count,
            totalTurnCount: turns.count,
            liveItemCount: 0,
            contextUsage: nil,
            goalStatus: nil,
            goalObjective: nil
        )
    }

    func turn(
        id: String = "turn-1",
        items: [SupervisorThreadTurnItem]
    ) -> SupervisorThreadTurn {
        SupervisorThreadTurn(
            id: id,
            startedAt: "2026-06-11T12:00:00.000Z",
            status: "running",
            error: nil,
            model: "gpt-5",
            tokenUsage: nil,
            items: items
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
