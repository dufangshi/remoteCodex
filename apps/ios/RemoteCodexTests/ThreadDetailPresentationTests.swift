@testable import RemoteCodex
import XCTest

final class ThreadDetailPresentationTests: XCTestCase {
    func testBuildsThreadDetailPresentationFromSupervisorDetail() {
        let detail = baseDetail(
            turns: [
                turn(
                    status: "running",
                    tokenUsage: SupervisorThreadTurnTokenUsage(inputTokens: 1200, outputTokens: 345, totalTokens: 1545),
                    items: [
                        item(id: "user-1", kind: "userMessage", text: "Inspect the app"),
                        item(id: "assistant-1", kind: "agentMessage", text: "Working", status: "running"),
                        item(id: "reason-1", kind: "reasoning", text: "Need to inspect the iOS screen", status: "completed"),
                        item(id: "tool-1", kind: "toolCall", text: "Read file", status: "completed", toolName: "read_file")
                    ]
                )
            ],
            totalTurnCount: 3,
            liveItemCount: 2,
            contextUsage: SupervisorThreadContextUsage(
                availability: "high",
                remainingPercent: 74,
                tokensInContextWindow: nil,
                modelContextWindow: nil,
                updatedAt: nil,
                usedTokens: 2600,
                maxTokens: 10000,
                percent: nil
            ),
            answeredRequestNotes: [
                SupervisorThreadAnsweredRequestNote(
                    id: "answered-1",
                    requestId: "request-1",
                    title: "Approval answered",
                    summaryLines: ["Approved"],
                    turnId: "turn-1",
                    itemId: nil,
                    createdAt: "2026-06-11T12:35:00.000Z",
                    summary: nil
                )
            ],
            goalObjective: "Finish native parity",
            goalStatus: "active"
        )

        let presentation = buildThreadDetailPresentation(detail)

        XCTAssertEqual(presentation.title, "Thread")
        XCTAssertEqual(presentation.workspace, "repo")
        XCTAssertEqual(presentation.branch, "repo")
        XCTAssertEqual(presentation.runtime, "codex / gpt-5")
        XCTAssertEqual(presentation.status, .running)
        XCTAssertEqual(presentation.itemSummary, "6 transcript items")
        XCTAssertEqual(presentation.rooms.single?.title, "Thread")
        XCTAssertEqual(presentation.rooms.single?.status, .running)
        XCTAssertEqual(presentation.context.label, "74% remaining")
        XCTAssertEqual(presentation.context.tokensLabel, "2.6k / 10k tokens")
        XCTAssertEqual(presentation.pendingRequestCount, 0)
        XCTAssertTrue(presentation.canLoadEarlier)
        XCTAssertEqual(presentation.goal, ThreadGoalPresentation(objective: "Finish native parity", statusLabel: "active"))
        XCTAssertEqual(presentation.timelineNotes.map(\.title), ["Goal", "Approval answered"])
        XCTAssertEqual(presentation.timelineNotes.map(\.kind), [.activity, .answered])
        XCTAssertEqual(presentation.timelineNotes.last?.summaryLines, ["Approved"])
        XCTAssertEqual(presentation.turns.single?.statusLabel, "Running")
        XCTAssertEqual(presentation.turns.single?.tokenSummary, "1.5k tokens")
        XCTAssertEqual(presentation.turns.single?.usage?.tokenDetails, "1.2k in · 345 out · 1.5k total")
        XCTAssertEqual(presentation.turns.single?.usage?.contextSummary, "74% remaining")
        XCTAssertEqual(presentation.turns.single?.usage?.contextDetails, "2.6k used · 10k max · availability high")
        XCTAssertEqual(presentation.turns.single?.messages.map(\.author), [.user, .assistant])
        XCTAssertEqual(presentation.turns.single?.messages.last?.status, .running)
        XCTAssertEqual(presentation.turns.single?.reasoningItems.single?.text, "Need to inspect the iOS screen")
        XCTAssertEqual(presentation.turns.single?.historyItems.single?.kind, .toolCall)
        XCTAssertEqual(presentation.turns.single?.historyItems.single?.status, .completed)
    }

    func testHistoryActionLabelsAndCopyTextMatchAndroidContract() {
        let detail = baseDetail(turns: [
            turn(items: [
                item(
                    id: "tool-1",
                    kind: "toolCall",
                    text: "Read file",
                    status: "completed",
                    callId: "call-1",
                    toolName: "read_file"
                )
            ])
        ])

        let item = buildThreadDetailPresentation(detail).turns.single?.historyItems.single

        XCTAssertEqual(item?.actionLabel, "Tool Call Details")
        XCTAssertEqual(
            item?.copyText,
            """
            Read file
            Status: completed
            Tool: read_file
            Call ID: call-1
            """
        )
    }

    func testStatusLabelsMatchAndroidPresentationContract() {
        XCTAssertEqual(threadStatusPresentation("running"), .running)
        XCTAssertEqual(threadStatusPresentation("failed"), .failed)
        XCTAssertEqual(threadStatusPresentation("idle"), .waiting)
        XCTAssertEqual(threadStatusPresentation("completed"), .complete)

        XCTAssertEqual(turnStatusLabel(status: "completed", error: nil), "Complete")
        XCTAssertEqual(turnStatusLabel(status: "running", error: nil), "Running")
        XCTAssertEqual(turnStatusLabel(status: "failed", error: "boom"), "Failed: boom")

        XCTAssertEqual(toolStatusPresentation("succeeded"), .completed)
        XCTAssertEqual(toolStatusLabel(.completed), "Done")
        XCTAssertEqual(toolResultStatusLabel(.completed), "Completed")
    }

    func testPlanAndHistoryLabelsMatchAndroidPresentationContract() {
        XCTAssertEqual(planStepStatusPresentation("in_progress"), .running)
        XCTAssertEqual(planStepStatusPresentation("todo"), .pending)
        XCTAssertEqual(planStepStatusLabel(.completed), "Done")
        XCTAssertEqual(planStepStatusLabel(.running), "Running")
        XCTAssertEqual(planStepStatusAccessibilityLabel(.running), "Plan step status: In progress")
        XCTAssertEqual(
            buildPlanStepStatusPresentationState(.failed),
            PlanStepStatusPresentationState(
                label: "Failed",
                accessibilityLabel: "Plan step status: Failed",
                tone: .danger,
                running: false
            )
        )

        XCTAssertEqual(historyItemKindPresentation("contextCompaction"), .context)
        XCTAssertEqual(historyItemKindPresentation("agentToolCall"), .agentTool)
        XCTAssertEqual(historyItemLabel(.webSearch), "Web Search")
        XCTAssertEqual(historyItemShortLabel(.fileChange), "DIFF")
        XCTAssertNil(historyItemKindPresentation("userMessage"))
    }

    func testTokenAndUsageSummaries() {
        XCTAssertEqual(
            tokenSummary(SupervisorThreadTurnTokenUsage(inputTokens: 2000, outputTokens: 1500, totalTokens: nil)),
            "3.5k tokens"
        )
        XCTAssertEqual(
            summarizeThreadUsage(
                baseDetail(contextUsage: SupervisorThreadContextUsage(
                    availability: "high",
                    remainingPercent: 74,
                    tokensInContextWindow: nil,
                    modelContextWindow: nil,
                    updatedAt: nil,
                    usedTokens: nil,
                    maxTokens: nil,
                    percent: nil
                ))
            ),
            "74% context remaining"
        )
    }

    func testActivityNotesMapIntoTimelineNotes() {
        let detail = baseDetail(
            activityNotes: [
                SupervisorThreadActivityNote(
                    id: "activity-1",
                    kind: "forkCreated",
                    createdAt: "2026-06-11T12:36:00.000Z",
                    text: nil,
                    anchorTurnId: "turn-1",
                    linkedThreadId: "thread-2",
                    linkedThreadTitle: "Forked thread",
                    turnIndex: 1
                )
            ]
        )

        let presentation = buildThreadDetailPresentation(detail)

        XCTAssertEqual(presentation.timelineNotes.single?.kind, .activity)
        XCTAssertEqual(presentation.timelineNotes.single?.title, "Fork created")
        XCTAssertEqual(presentation.timelineNotes.single?.summaryLines, ["Created Forked thread"])
        XCTAssertEqual(presentation.timelineNotes.single?.statusLabel, "Turn 1")
        XCTAssertEqual(presentation.timelineNotes.single?.timeLabel, "08:36")
    }

    func testLivePlanPresentationMapsBundlePlanToMatchingTurn() {
        let detail = baseDetail(
            turns: [
                turn(id: "turn-1"),
                turn(id: "turn-2", status: "running")
            ],
            livePlan: SupervisorThreadLivePlan(
                turnId: "turn-2",
                explanation: "Ship the fix in three steps.",
                plan: [
                    SupervisorThreadLivePlanStep(step: "Inspect current state", status: "in_progress"),
                    SupervisorThreadLivePlanStep(step: "Patch the UI", status: "pending"),
                    SupervisorThreadLivePlanStep(step: "Verify the result", status: "completed")
                ],
                updatedAt: "2026-06-11T12:35:00.000Z"
            )
        )

        let presentation = buildThreadDetailPresentation(detail)

        XCTAssertNil(presentation.turns.first?.livePlan)
        let livePlan = presentation.turns.last?.livePlan
        XCTAssertEqual(livePlan?.title, "Plan update")
        XCTAssertEqual(livePlan?.badgeLabel, "Live")
        XCTAssertEqual(livePlan?.explanation, "Ship the fix in three steps.")
        XCTAssertEqual(livePlan?.steps.map(\.number), [1, 2, 3])
        XCTAssertEqual(livePlan?.steps.map(\.text), ["Inspect current state", "Patch the UI", "Verify the result"])
        XCTAssertEqual(livePlan?.steps.map(\.status), [.running, .pending, .completed])
        XCTAssertEqual(livePlan?.steps.first?.statusState.running, true)
    }

    func testMapsBundleResourcesIntoThreadDetailPresentation() {
        let detail = baseDetail()
        let presentation = buildThreadDetailPresentation(
            detail,
            workspaceTree: workspaceTreeFixture(),
            workspacePreview: workspacePreviewFixture(),
            exportTurns: exportTurnsFixture(),
            forkTurns: [forkTurnFixture()],
            skills: skillsFixture(),
            mcpServers: mcpServersFixture(),
            hooks: hooksFixture(),
            modelOptions: [modelOptionFixture()]
        )

        XCTAssertEqual(presentation.workspaceContext.rootName, "repo")
        XCTAssertEqual(presentation.workspaceContext.firstFilePath, "README.md")
        XCTAssertEqual(presentation.workspaceContext.previewPath, "README.md")
        XCTAssertTrue(presentation.workspaceContext.previewTruncated)
        XCTAssertEqual(presentation.exportTurns.single?.promptPreview, "Export me")
        XCTAssertEqual(presentation.forkTurns.single?.statusLabel, "Failed")
        XCTAssertEqual(presentation.extensionSummary.skillCount, 1)
        XCTAssertEqual(presentation.extensionSummary.skillPreviews.single?.title, "ios")
        XCTAssertEqual(presentation.extensionSummary.mcpToolCount, 2)
        XCTAssertEqual(presentation.extensionSummary.hookWarningCount, 1)
        XCTAssertEqual(presentation.extensionSummary.hookPreviews.single?.statusLabel, "trusted")
        XCTAssertEqual(presentation.modelOptions.single?.displayName, "GPT-5")
        XCTAssertEqual(presentation.modelOptions.single?.supportedReasoningEfforts, ["medium"])
    }
}

private extension ThreadDetailPresentationTests {
    func baseDetail(
        turns: [SupervisorThreadTurn]? = nil,
        totalTurnCount: Int? = nil,
        liveItemCount: Int = 0,
        contextUsage: SupervisorThreadContextUsage? = nil,
        answeredRequestNotes: [SupervisorThreadAnsweredRequestNote] = [],
        activityNotes: [SupervisorThreadActivityNote] = [],
        goalObjective: String? = nil,
        goalStatus: String? = nil,
        livePlan: SupervisorThreadLivePlan? = nil
    ) -> SupervisorThreadDetail {
        let resolvedTurns = turns ?? [turn()]
        return SupervisorThreadDetail(
            thread: SupervisorThreadSummary(
                id: "thread-1",
                workspaceId: "workspace-1",
                provider: "codex",
                title: "Thread",
                status: resolvedTurns.last?.status ?? "completed",
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
                absPath: "/Users/mac/dev/repo",
                isFavorite: false,
                lastOpenedAt: nil
            ),
            turns: resolvedTurns,
            pendingRequests: [],
            answeredRequestNotes: answeredRequestNotes,
            activityNotes: activityNotes,
            turnCount: resolvedTurns.count,
            totalTurnCount: totalTurnCount ?? resolvedTurns.count,
            liveItemCount: liveItemCount,
            contextUsage: contextUsage,
            goalStatus: goalStatus,
            goalObjective: goalObjective,
            livePlan: livePlan
        )
    }

    func turn(
        id: String = "turn-1",
        status: String = "completed",
        tokenUsage: SupervisorThreadTurnTokenUsage? = nil,
        items: [SupervisorThreadTurnItem]? = nil
    ) -> SupervisorThreadTurn {
        SupervisorThreadTurn(
            id: id,
            startedAt: "2026-06-11T12:34:00.000Z",
            status: status,
            error: nil,
            model: "gpt-5",
            tokenUsage: tokenUsage,
            items: items ?? [item(id: "user-1", kind: "userMessage", text: "Start")]
        )
    }

    func item(
        id: String,
        kind: String,
        text: String,
        status: String? = nil,
        callId: String? = nil,
        toolName: String? = nil
    ) -> SupervisorThreadTurnItem {
        SupervisorThreadTurnItem(
            id: id,
            kind: kind,
            text: text,
            status: status,
            sequence: nil,
            callId: callId,
            toolName: toolName,
            payload: nil
        )
    }

    func workspaceTreeFixture() -> SupervisorWorkspaceTreeNode {
        SupervisorWorkspaceTreeNode(
            name: "repo",
            path: "",
            kind: "directory",
            size: nil,
            children: [
                SupervisorWorkspaceTreeNode(name: "README.md", path: "README.md", kind: "file", size: 12, children: nil)
            ]
        )
    }

    func workspacePreviewFixture() -> SupervisorWorkspaceFilePreview {
        SupervisorWorkspaceFilePreview(
            path: "README.md",
            name: "README.md",
            content: "# Repo",
            language: "markdown",
            size: 6,
            truncated: true,
            nextOffset: 6
        )
    }

    func exportTurnsFixture() -> SupervisorThreadExportTurns {
        SupervisorThreadExportTurns(
            turns: [
                SupervisorThreadExportTurnOption(
                    turnId: "turn-export",
                    turnIndex: 4,
                    turnNumber: nil,
                    startedAt: "2026-06-11T12:34:00.000Z",
                    status: "completed",
                    userPromptPreview: "Export me"
                )
            ],
            totalTurnCount: 8
        )
    }

    func forkTurnFixture() -> SupervisorThreadForkTurnOption {
        SupervisorThreadForkTurnOption(
            turnId: "turn-fork",
            turnIndex: 2,
            startedAt: "2026-06-11T12:34:00.000Z",
            status: "failed"
        )
    }

    func skillsFixture() -> SupervisorThreadSkills {
        SupervisorThreadSkills(
            cwd: "/repo",
            skills: [
                SupervisorAgentSkill(
                    name: "ios",
                    description: "Long iOS skill",
                    shortDescription: "iOS skill",
                    interfaceShortDescription: nil,
                    path: ".agents/skills/ios",
                    scope: "project",
                    enabled: true
                )
            ],
            errors: []
        )
    }

    func mcpServersFixture() -> SupervisorThreadMcpServers {
        SupervisorThreadMcpServers(
            servers: [
                SupervisorAgentMcpServer(
                    name: "filesystem",
                    authStatus: "trusted",
                    tools: [
                        SupervisorAgentMcpTool(name: "read", title: nil, description: nil),
                        SupervisorAgentMcpTool(name: "write", title: nil, description: nil)
                    ],
                    resourceCount: 0,
                    resourceTemplateCount: 0
                )
            ]
        )
    }

    func hooksFixture() -> SupervisorThreadHooks {
        SupervisorThreadHooks(
            cwd: "/repo",
            hooks: [
                SupervisorAgentHook(
                    key: "hook-1",
                    eventName: "Stop",
                    handlerType: "command",
                    matcher: nil,
                    command: "swift test",
                    timeoutSec: 30,
                    statusMessage: "trusted",
                    sourcePath: ".codex/hooks.json",
                    source: "project",
                    pluginId: nil,
                    displayOrder: 0,
                    enabled: true,
                    isManaged: false,
                    currentHash: "abc",
                    trustStatus: "trusted"
                )
            ],
            warnings: ["one warning"],
            errors: [],
            globalHooksPath: "~/.codex/hooks.json",
            projectHooksPath: ".codex/hooks.json"
        )
    }

    func modelOptionFixture() -> SupervisorModelOption {
        SupervisorModelOption(
            id: "gpt-5",
            model: "gpt-5",
            displayName: "GPT-5",
            description: "Default",
            isDefault: true,
            hidden: false,
            supportedReasoningEfforts: [
                SupervisorReasoningEffortOption(reasoningEffort: "medium", description: nil)
            ],
            defaultReasoningEffort: "medium"
        )
    }
}

private extension Array {
    var single: Element? {
        count == 1 ? first : nil
    }
}
