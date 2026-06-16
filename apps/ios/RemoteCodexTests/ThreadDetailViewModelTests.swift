import Foundation
@testable import RemoteCodex
import XCTest

@MainActor
final class ThreadDetailViewModelTests: XCTestCase {
    func testRefreshSendRenameGoalAndDelete() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = Self.threadDetailResponse(for:)
        let environment = try AppEnvironment(
            settingsStore: AppSettingsStore(
                defaults: XCTUnwrap(UserDefaults(suiteName: "ThreadDetailViewModelTests-\(UUID().uuidString)")),
                tokenStore: MemoryTokenStore()
            )
        ) { config in
            SupervisorAPIClient(config: config, transport: transport)
        }
        let model = ThreadDetailViewModel(
            environment: environment,
            connection: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            threadId: "t1"
        )

        await model.refresh()
        let attachmentURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("thread-attachment-\(UUID().uuidString).txt")
        try Data("attachment".utf8).write(to: attachmentURL)
        await model.addPromptAttachment(from: attachmentURL)
        model.promptDraft = "continue"
        await model.sendPrompt()
        if let request = model.pendingRequests.first, let question = request.questions?.first, let option = question.options.first {
            await model.respondToRequest(request, answers: [question.id: [option.label]])
        }
        let newThreadId = await model.startNewChatFromCurrentThread()
        let forkedThreadId = await model.forkLatestThread()
        await model.exportTranscript()
        model.renameDraft = "Renamed"
        await model.renameThread()
        model.goalDraft = "Ship iOS"
        await model.updateGoal()
        let deleted = await model.deleteThread()

        XCTAssertEqual(model.thread?.title, "Renamed")
        XCTAssertEqual(model.turns.first?.items.first?.text, "Working")
        XCTAssertEqual(model.detail?.goalObjective, "Ship iOS")
        XCTAssertEqual(model.pendingRequests.first?.title, "Approve command")
        XCTAssertEqual(newThreadId, "t3")
        XCTAssertEqual(forkedThreadId, "t2")
        XCTAssertEqual(model.exportedFile?.filename, "thread.pdf")
        XCTAssertEqual(model.modelOptions.first?.model, "gpt-5.4")
        XCTAssertEqual(model.availableWorkspaces.map(\.id), ["w1", "w2"])
        XCTAssertEqual(model.workspacePreview?.path, "Sources/App.swift")
        XCTAssertEqual(model.skills?.skills.first?.name, "ios-client")
        XCTAssertEqual(model.mcpServers?.servers.first?.name, "docs")
        XCTAssertEqual(model.hooks?.hooks.first?.key, "hook-1")
        XCTAssertTrue(model.bundleWarnings.isEmpty)
        XCTAssertTrue(deleted)
    }

    func testRealtimeReconnectRefreshesDetailAndPreservesCursor() async throws {
        let transport = MockSupervisorTransport()
        var detailCallCount = 0
        transport.handler = { request in
            if let response = Self.bundleResponse(for: request) {
                return response
            }
            switch (request.method, request.url.path) {
            case ("GET", "/api/threads/t1"):
                detailCallCount += 1
                let body = detailCallCount >= 2
                    ? Self.threadDetailJSON.replacingOccurrences(
                        of: #""text": "Working""#,
                        with: #""text": "Recovered after reconnect.""#
                    )
                    : Self.threadDetailJSON
                return SupervisorHTTPResponse(statusCode: 200, body: Data(body.utf8), headers: [:])
            default:
                XCTFail("Unexpected request \(request.method) \(request.url)")
                return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
            }
        }
        let streamFactory = MockThreadEventStreamFactory()
        let environment = try AppEnvironment(
            settingsStore: AppSettingsStore(
                defaults: XCTUnwrap(UserDefaults(suiteName: "ThreadDetailViewModelTests-\(UUID().uuidString)")),
                tokenStore: MemoryTokenStore()
            ),
            apiClientFactory: { config in
                SupervisorAPIClient(config: config, transport: transport)
            },
            eventStreamFactory: streamFactory.makeClient(config:)
        )
        let model = ThreadDetailViewModel(
            environment: environment,
            connection: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            threadId: "t1",
            eventReconnectDelayNanoseconds: { _ in 0 }
        )

        await model.refresh()
        XCTAssertEqual(model.turns.first?.items.first?.text, "Working")
        model.startEventStream()

        let firstStream = try XCTUnwrap(streamFactory.clients.first)
        let firstStreamStarted = await Self.waitUntil { firstStream.isStarted }
        XCTAssertTrue(firstStreamStarted)
        firstStream.emit(state: .open)
        firstStream.emit(event: Self.threadUpdatedEvent(cursor: "cursor-1"))
        let receivedCursor = await Self.waitUntil { model.eventCursor == "cursor-1" }
        XCTAssertTrue(receivedCursor)

        firstStream.emit(state: .failed("socket dropped"))
        firstStream.finish()
        let reconnected = await Self.waitUntil { streamFactory.clients.count == 2 }
        XCTAssertTrue(reconnected)

        let secondStream = try XCTUnwrap(streamFactory.clients.last)
        let secondStreamStarted = await Self.waitUntil { secondStream.isStarted }
        XCTAssertTrue(secondStreamStarted)
        secondStream.emit(state: .open)
        let refreshedAfterReconnect = await Self.waitUntil {
            model.turns.first?.items.first?.text == "Recovered after reconnect."
        }
        XCTAssertTrue(refreshedAfterReconnect)
        XCTAssertEqual(model.eventCursor, "cursor-1")
        XCTAssertGreaterThanOrEqual(detailCallCount, 2)

        model.stopEventStream()
    }

    func testRealtimeBackgroundSuspensionDoesNotReconnectUntilForeground() async throws {
        let transport = MockSupervisorTransport()
        var detailCallCount = 0
        transport.handler = { request in
            if let response = Self.bundleResponse(for: request) {
                return response
            }
            switch (request.method, request.url.path) {
            case ("GET", "/api/threads/t1"):
                detailCallCount += 1
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.threadDetailJSON.utf8), headers: [:])
            default:
                XCTFail("Unexpected request \(request.method) \(request.url)")
                return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
            }
        }
        let streamFactory = MockThreadEventStreamFactory()
        let environment = try AppEnvironment(
            settingsStore: AppSettingsStore(
                defaults: XCTUnwrap(UserDefaults(suiteName: "ThreadDetailViewModelTests-\(UUID().uuidString)")),
                tokenStore: MemoryTokenStore()
            ),
            apiClientFactory: { config in
                SupervisorAPIClient(config: config, transport: transport)
            },
            eventStreamFactory: streamFactory.makeClient(config:)
        )
        let model = ThreadDetailViewModel(
            environment: environment,
            connection: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            threadId: "t1",
            eventReconnectDelayNanoseconds: { _ in 0 }
        )

        await model.refresh()
        model.startEventStream()
        let connected = await Self.waitUntil { streamFactory.clients.count == 1 }
        XCTAssertTrue(connected)
        let streamStarted = await Self.waitUntil { streamFactory.clients.first?.isStarted == true }
        XCTAssertTrue(streamStarted)

        model.suspendRealtimeForBackground()
        let suspended = await Self.waitUntil { streamFactory.clients.first?.closeCount == 1 }
        XCTAssertTrue(suspended)
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(streamFactory.clients.count, 1)
        XCTAssertEqual(model.socketState, .closed)

        model.resumeRealtimeAfterForeground()
        let reopened = await Self.waitUntil { streamFactory.clients.count == 2 }
        XCTAssertTrue(reopened)
        let refreshedAfterForeground = await Self.waitUntil { detailCallCount >= 2 }
        XCTAssertTrue(refreshedAfterForeground)

        model.stopEventStream()
    }

    func testExportTurnSelectionStateUsesLoadedTurns() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            if let response = Self.bundleResponse(for: request) {
                return response
            }
            if (request.method, request.url.path) == ("GET", "/api/threads/t1") {
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.threadDetailJSON.utf8), headers: [:])
            }
            XCTFail("Unexpected request \(request.method) \(request.url)")
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
        let environment = try AppEnvironment(
            settingsStore: AppSettingsStore(
                defaults: XCTUnwrap(UserDefaults(suiteName: "ThreadDetailViewModelTests-\(UUID().uuidString)")),
                tokenStore: MemoryTokenStore()
            )
        ) { config in
            SupervisorAPIClient(config: config, transport: transport)
        }
        let model = ThreadDetailViewModel(
            environment: environment,
            connection: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            threadId: "t1"
        )

        await model.refresh()
        XCTAssertEqual(model.exportTurnIds, ["turn-1"])
        XCTAssertEqual(model.selectedExportTurnCount, 1)
        XCTAssertEqual(model.selectedExportTurnIdsInOrder, ["turn-1"])

        model.selectedExportTurnIds = ["missing"]
        XCTAssertEqual(model.selectedExportTurnCount, 0)
        XCTAssertEqual(model.selectedExportTurnIdsInOrder, [])

        model.selectAllExportTurns()
        XCTAssertEqual(model.selectedExportTurnIdsInOrder, ["turn-1"])
        model.clearSelectedExportTurns()
        XCTAssertEqual(model.selectedExportTurnCount, 0)
    }
}

private extension ThreadDetailViewModelTests {
    static func waitUntil(
        timeoutNanoseconds: UInt64 = 1_000_000_000,
        condition: @escaping () -> Bool
    ) async -> Bool {
        let start = ContinuousClock.now
        let timeout = Duration.nanoseconds(Int64(timeoutNanoseconds))
        while start.duration(to: .now) < timeout {
            if condition() {
                return true
            }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return condition()
    }

    static func threadUpdatedEvent(cursor: String) -> SupervisorThreadEvent {
        SupervisorThreadEvent(
            type: "thread.updated",
            threadId: "t1",
            timestamp: "now",
            payload: [
                "title": .string("Thread"),
                "status": .string("running")
            ],
            eventId: "event-\(cursor)",
            cursor: cursor,
            sequence: nil
        )
    }

    static func threadDetailResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        if let response = bundleResponse(for: request) {
            return response
        }
        switch (request.method, request.url.path) {
        case ("GET", "/api/threads/t1"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadDetailJSON.utf8), headers: [:])
        case ("POST", "/api/threads/t1/prompt"):
            XCTAssertTrue(request.contentType?.hasPrefix("multipart/form-data; boundary=remoteCodexIOS") == true)
            let body = String(data: request.body ?? Data(), encoding: .utf8) ?? ""
            XCTAssertTrue(body.contains("continue"))
            XCTAssertTrue(body.contains("attachmentManifest"))
            XCTAssertTrue(body.contains("attachment"))
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadSummaryJSON.utf8), headers: [:])
        case ("POST", "/api/threads/t1/requests/req-1/respond"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadDetailJSON.utf8), headers: [:])
        case ("POST", "/api/threads/t1/fork"):
            XCTAssertEqual(request.jsonBodyString("mode"), "latest")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(forkResultJSON.utf8), headers: [:])
        case ("GET", "/api/threads/t1/exports/pdf"):
            XCTAssertTrue(request.url.absoluteString.contains("format=pdf"))
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data("%PDF".utf8),
                headers: ["content-disposition": #"attachment; filename="thread.pdf""#]
            )
        case ("PATCH", "/api/threads/t1"):
            XCTAssertEqual(request.jsonBodyString("title"), "Renamed")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(renamedThreadSummaryJSON.utf8), headers: [:])
        case ("PATCH", "/api/threads/t1/goal"):
            XCTAssertEqual(request.jsonBodyString("objective"), "Ship iOS")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(goalResponseJSON.utf8), headers: [:])
        case ("DELETE", "/api/threads/t1"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(renamedThreadSummaryJSON.utf8), headers: [:])
        default:
            XCTFail("Unexpected request \(request.method) \(request.url)")
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
    }

    static func bundleResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse? {
        if request.method == "GET", let body = bundleJSONByPath[request.url.path] {
            return SupervisorHTTPResponse(statusCode: 200, body: Data(body.utf8), headers: [:])
        }
        if (request.method, request.url.path) == ("POST", "/api/threads/start") {
            XCTAssertEqual(request.jsonBodyString("workspaceId"), "w1")
            XCTAssertEqual(request.jsonBodyString("provider"), "codex")
            XCTAssertEqual(request.jsonBodyString("model"), "gpt-5.4")
            XCTAssertEqual(request.jsonBodyString("approvalMode"), "yolo")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(newChatThreadSummaryJSON.utf8), headers: [:])
        }
        return nil
    }

    static var bundleJSONByPath: [String: String] {
        [
            "/api/workspaces": workspacesJSON,
            "/api/agent-runtimes/codex/models": modelsJSON,
            "/api/workspaces/w1/files/tree": workspaceTreeJSON,
            "/api/workspaces/w1/files/preview": workspacePreviewJSON,
            "/api/threads/t1/fork-turns": forkTurnsJSON,
            "/api/threads/t1/export-turns": exportTurnsJSON,
            "/api/threads/t1/skills": skillsJSON,
            "/api/threads/t1/mcp-servers": mcpServersJSON,
            "/api/threads/t1/hooks": hooksJSON
        ]
    }

    static let threadSummaryJSON = """
    {
      "id": "t1",
      "workspaceId": "w1",
      "provider": "codex",
      "title": "Thread",
      "status": "running",
      "model": "gpt-5.4",
      "reasoningEffort": null,
      "fastMode": false,
      "collaborationMode": "default",
      "sandboxMode": null,
      "updatedAt": "now",
      "summaryText": null,
      "isLoaded": true
    }
    """

    static let workspacesJSON = """
    [
      {
        "id": "w1",
        "label": "Repo",
        "absPath": "/repo",
        "isFavorite": false,
        "lastOpenedAt": null
      },
      {
        "id": "w2",
        "label": "Tools",
        "absPath": "/tools",
        "isFavorite": true,
        "lastOpenedAt": "now"
      }
    ]
    """

    static let renamedThreadSummaryJSON = """
    {
      "id": "t1",
      "workspaceId": "w1",
      "provider": "codex",
      "title": "Renamed",
      "status": "running",
      "model": "gpt-5.4",
      "reasoningEffort": null,
      "fastMode": false,
      "collaborationMode": "default",
      "sandboxMode": null,
      "updatedAt": "now",
      "summaryText": null,
      "isLoaded": true
    }
    """

    static let newChatThreadSummaryJSON = """
    {
      "id": "t3",
      "workspaceId": "w1",
      "provider": "codex",
      "title": "New Chat",
      "status": "running",
      "model": "gpt-5.4",
      "reasoningEffort": null,
      "fastMode": false,
      "collaborationMode": "default",
      "sandboxMode": null,
      "updatedAt": "now",
      "summaryText": null,
      "isLoaded": true
    }
    """

    static let threadDetailJSON = """
    {
      "thread": {
        "id": "t1",
        "workspaceId": "w1",
        "provider": "codex",
        "title": "Thread",
        "status": "running",
        "model": "gpt-5.4",
        "reasoningEffort": null,
        "fastMode": false,
        "collaborationMode": "default",
        "sandboxMode": null,
        "updatedAt": "now",
        "summaryText": null,
        "isLoaded": true
      },
      "workspace": {
        "id": "w1",
        "label": "Repo",
        "absPath": "/repo",
        "isFavorite": false,
        "lastOpenedAt": null
      },
      "turns": [
        {
          "id": "turn-1",
          "startedAt": "now",
          "status": "completed",
          "error": null,
          "model": "gpt-5.4",
          "tokenUsage": null,
          "items": [
            {
              "id": "item-1",
              "kind": "assistant",
              "text": "Working",
              "status": "completed",
              "sequence": 1,
              "callId": null,
              "toolName": null,
              "payload": null
            }
          ]
        }
      ],
      "pendingRequests": [
        {
          "id": "req-1",
          "kind": "approval",
          "status": "pending",
          "title": "Approve command",
          "description": "Run tests?",
          "createdAt": "now",
          "questions": [
            {
              "id": "q1",
              "header": "Approval",
              "question": "Allow command?",
              "multiSelect": false,
              "isOther": false,
              "options": [
                {"label":"Approve","description":"Run it"},
                {"label":"Deny","description":"Do not run"}
              ]
            }
          ],
          "turnId": "turn-1",
          "itemId": "item-1",
          "payload": null
        }
      ],
      "answeredRequestNotes": [],
      "turnCount": 1,
      "totalTurnCount": 1,
      "liveItemCount": 1,
      "contextUsage": null,
      "goalStatus": null,
      "goalObjective": null
    }
    """

    static var forkResultJSON: String {
        """
        {"thread":\(forkedThreadDetailJSON),"sourceThreadId":"t1","sourceTurnId":null,"sourceTurnIndex":null}
        """
    }

    static let forkedThreadDetailJSON = """
    {
      "thread": {
        "id": "t2",
        "workspaceId": "w1",
        "provider": "codex",
        "title": "Fork",
        "status": "running",
        "model": "gpt-5.4",
        "reasoningEffort": null,
        "fastMode": false,
        "collaborationMode": "default",
        "sandboxMode": null,
        "updatedAt": "now",
        "summaryText": null,
        "isLoaded": true
      },
      "workspace": {
        "id": "w1",
        "label": "Repo",
        "absPath": "/repo",
        "isFavorite": false,
        "lastOpenedAt": null
      },
      "turns": [],
      "pendingRequests": [],
      "answeredRequestNotes": [],
      "turnCount": 0,
      "totalTurnCount": 0,
      "liveItemCount": 0,
      "contextUsage": null,
      "goalStatus": null,
      "goalObjective": null
    }
    """

    static let goalResponseJSON = """
    {
      "goal": {
        "threadId": "t1",
        "localGoalId": "goal-1",
        "objective": "Ship iOS",
        "status": "active",
        "tokenBudget": null,
        "tokensUsed": 0,
        "timeUsedSeconds": 0,
        "createdAt": "now",
        "updatedAt": "now",
        "completedAt": null
      }
    }
    """

    static let modelsJSON = """
    [{
      "id": "gpt-5.4",
      "model": "gpt-5.4",
      "displayName": "GPT-5.4",
      "description": "Flagship",
      "isDefault": true,
      "hidden": false,
      "supportedReasoningEfforts": [{"reasoningEffort":"medium","description":"Balanced"}],
      "defaultReasoningEffort": "medium"
    }]
    """

    static let workspaceTreeJSON = """
    {
      "name": "repo",
      "path": "",
      "kind": "directory",
      "size": null,
      "children": [
        {"name":"App.swift","path":"Sources/App.swift","kind":"file","size":15,"children":[]}
      ]
    }
    """

    static let workspacePreviewJSON = """
    {
      "path": "Sources/App.swift",
      "name": "App.swift",
      "content": "import SwiftUI",
      "language": "swift",
      "size": 14,
      "truncated": false,
      "nextOffset": 14
    }
    """

    static let forkTurnsJSON = """
    [{"turnId":"turn-1","turnIndex":1,"startedAt":"now","status":"completed"}]
    """

    static let exportTurnsJSON = """
    {"turns":[{"turnId":"turn-1","turnNumber":1,"startedAt":"now","status":"completed","userPromptPreview":"Prompt"}],"totalTurnCount":1}
    """

    static let skillsJSON = """
    {
      "cwd": "/repo",
      "skills": [
        {
          "name": "ios-client",
          "description": "Native iOS",
          "shortDescription": "iOS",
          "interface": {"shortDescription": "Native iOS"},
          "path": "/skills/ios",
          "scope": "project",
          "enabled": true
        }
      ],
      "errors": []
    }
    """

    static let mcpServersJSON = """
    {"servers":[{"name":"docs","authStatus":"unsupported","tools":[],"resourceCount":0,"resourceTemplateCount":0}]}
    """

    static let hooksJSON = """
    {
      "cwd": "/repo",
      "hooks": [
        {
          "key": "hook-1",
          "eventName": "preToolUse",
          "handlerType": "command",
          "matcher": null,
          "command": "echo ok",
          "timeoutSec": 10,
          "statusMessage": null,
          "sourcePath": "/repo/hooks.json",
          "source": "project",
          "pluginId": null,
          "displayOrder": 0,
          "enabled": true,
          "isManaged": false,
          "currentHash": "hash-1",
          "trustStatus": "trusted"
        }
      ],
      "warnings": [],
      "errors": [],
      "globalHooksPath": "/home/.codex/hooks.json",
      "projectHooksPath": "/repo/.codex/hooks.json"
    }
    """
}

private final class MockThreadEventStreamFactory {
    private(set) var clients: [MockThreadEventStreamClient] = []

    func makeClient(config _: SupervisorConnectionConfig) -> any SupervisorThreadEventStreaming {
        let client = MockThreadEventStreamClient()
        clients.append(client)
        return client
    }
}

private final class MockThreadEventStreamClient: SupervisorThreadEventStreaming, @unchecked Sendable {
    private var continuation: AsyncStream<SupervisorThreadEvent>.Continuation?
    private var stateHandler: ((SupervisorSocketState) -> Void)?
    private(set) var closeCount = 0
    private(set) var isStarted = false

    func threadEvents(onState: @escaping (SupervisorSocketState) -> Void) -> AsyncStream<SupervisorThreadEvent> {
        AsyncStream { continuation in
            self.continuation = continuation
            stateHandler = onState
            isStarted = true
            onState(.connecting)
        }
    }

    func close() {
        closeCount += 1
        stateHandler?(.closed)
        continuation?.finish()
        continuation = nil
    }

    func emit(state: SupervisorSocketState) {
        stateHandler?(state)
    }

    func emit(event: SupervisorThreadEvent) {
        continuation?.yield(event)
    }

    func finish() {
        continuation?.finish()
        continuation = nil
    }
}

private extension SupervisorHTTPRequest {
    func jsonBodyString(_ key: String) -> String? {
        guard
            let body,
            let json = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
        else {
            return nil
        }
        return json[key] as? String
    }
}
