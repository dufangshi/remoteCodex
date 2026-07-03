import Foundation

struct AppEnvironment {
    let settingsStore: AppSettingsStore
    let apiClientFactory: (SupervisorConnectionConfig) -> SupervisorAPIClient
    let eventStreamFactory: (SupervisorConnectionConfig) -> any SupervisorThreadEventStreaming

    init(
        settingsStore: AppSettingsStore,
        apiClientFactory: @escaping (SupervisorConnectionConfig) -> SupervisorAPIClient,
        eventStreamFactory: @escaping (SupervisorConnectionConfig) -> any SupervisorThreadEventStreaming = {
            SupervisorEventSocketClient(config: $0)
        }
    ) {
        self.settingsStore = settingsStore
        self.apiClientFactory = apiClientFactory
        self.eventStreamFactory = eventStreamFactory
    }

    static func live() -> AppEnvironment {
        let settingsStore = AppSettingsStore(
            defaults: .standard,
            tokenStore: KeychainTokenStore(service: "com.remotecodex.ios")
        )
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--reset-settings") {
            settingsStore.clearSupervisorConnection()
            settingsStore.writeThemeMode(.system)
        }
        if arguments.contains("--ui-test-live-local-connection") {
            let environment = ProcessInfo.processInfo.environment
            let baseURL = ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_BASE_URL"]
                ?? "http://127.0.0.1:8787"
            let config = SupervisorConnectionConfig(mode: .local, baseURL: baseURL)
            try? settingsStore.writeSupervisorConnection(config)
            settingsStore.writeLastRoute(liveUITestRoute(environment: environment), for: config)
        }
        if arguments.contains("--ui-test-live-server-connection") {
            let environment = ProcessInfo.processInfo.environment
            let baseURL = environment["REMOTE_CODEX_IOS_E2E_SERVER_BASE_URL"]
                ?? environment["REMOTE_CODEX_IOS_E2E_BASE_URL"]
                ?? "http://127.0.0.1:8787"
            let config = SupervisorConnectionConfig(
                mode: .server,
                baseURL: baseURL,
                authToken: environment["REMOTE_CODEX_IOS_E2E_AUTH_TOKEN"]?.trimmedNonEmpty
            )
            try? settingsStore.writeSupervisorConnection(config)
            settingsStore.writeLastRoute(liveUITestRoute(environment: environment), for: config)
        }
        if arguments.contains("--ui-test-live-relay-connection") {
            let environment = ProcessInfo.processInfo.environment
            let baseURL = environment["REMOTE_CODEX_IOS_E2E_RELAY_BASE_URL"]
                ?? environment["REMOTE_CODEX_IOS_E2E_BASE_URL"]
                ?? "http://127.0.0.1:8788"
            let config = SupervisorConnectionConfig(
                mode: .relay,
                baseURL: baseURL,
                authToken: environment["REMOTE_CODEX_IOS_E2E_RELAY_TOKEN"]?.trimmedNonEmpty,
                relayDeviceId: environment["REMOTE_CODEX_IOS_E2E_RELAY_DEVICE_ID"]?.trimmedNonEmpty
            )
            try? settingsStore.writeSupervisorConnection(config)
            settingsStore.writeLastRoute(liveUITestRoute(environment: environment), for: config)
        }
        if arguments.contains("--ui-test-ios-thread-webview-fixture") {
            let config = SupervisorConnectionConfig(mode: .local, baseURL: "http://fixture.local")
            try? settingsStore.writeSupervisorConnection(config)
            settingsStore.writeLastRoute(.threadDetail("ios-web-fixture-thread"), for: config)
        }
        if arguments.contains("--ui-test-workspace-fixture") {
            let config = SupervisorConnectionConfig(mode: .local, baseURL: "http://fixture.local")
            try? settingsStore.writeSupervisorConnection(config)
            let route: SavedAppRoute = arguments.contains("--ui-test-thread-route") ? .threadDetail("t1") : .home
            settingsStore.writeLastRoute(route, for: config)
            return AppEnvironment(
                settingsStore: settingsStore,
                apiClientFactory: { config in
                    SupervisorAPIClient(config: config, transport: WorkspaceFixtureTransport())
                },
                eventStreamFactory: { _ in FixtureSupervisorThreadEventStreamClient() }
            )
        }
        return AppEnvironment(settingsStore: settingsStore) { config in
            SupervisorAPIClient(config: config, transport: URLSessionSupervisorTransport())
        }
    }
}

private func liveUITestRoute(environment: [String: String]) -> SavedAppRoute {
    if let threadId = environment["REMOTE_CODEX_IOS_E2E_THREAD_ID"]?.trimmedNonEmpty {
        return .threadDetail(threadId)
    }
    if let workspaceId = environment["REMOTE_CODEX_IOS_E2E_WORKSPACE_ID"]?.trimmedNonEmpty {
        return .workspaceDetail(workspaceId)
    }
    return .home
}

private final class FixtureSupervisorThreadEventStreamClient: SupervisorThreadEventStreaming, @unchecked Sendable {
    private var continuation: AsyncStream<SupervisorThreadEvent>.Continuation?
    private var stateHandler: ((SupervisorSocketState) -> Void)?

    func threadEvents(onState: @escaping (SupervisorSocketState) -> Void) -> AsyncStream<SupervisorThreadEvent> {
        AsyncStream { continuation in
            self.continuation = continuation
            stateHandler = onState
            onState(.open)
        }
    }

    func close() {
        continuation?.finish()
        continuation = nil
        stateHandler?(.closed)
    }
}

private struct WorkspaceFixtureTransport: SupervisorHTTPTransport {
    func request(_ request: SupervisorHTTPRequest) async throws -> SupervisorHTTPResponse {
        if let response = threadResponse(for: request) {
            return response
        }
        if let response = workspaceResponse(for: request) {
            return response
        }
        if request.method == "GET", request.url.path == "/api/agent-runtimes/codex/models" {
            return response(Self.modelsJSON)
        }
        return SupervisorHTTPResponse(
            statusCode: 404,
            body: Data(#"{"message":"Fixture route not found"}"#.utf8),
            headers: [:]
        )
    }

    private func threadResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse? {
        if let response = threadActionResponse(for: request) {
            return response
        }
        if let response = threadBundleResponse(for: request) {
            return response
        }
        switch (request.method, request.url.path) {
        case ("GET", "/api/threads"):
            return response(Self.threadsJSON)
        case ("GET", "/api/threads/t1"):
            return response(Self.threadDetailJSON)
        case ("POST", "/api/threads/t1/prompt"):
            return response(Self.threadPromptJSON)
        default:
            return nil
        }
    }

    private func threadActionResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse? {
        switch (request.method, request.url.path) {
        case ("POST", "/api/threads/t1/requests/req-approval/respond"):
            return response(Self.threadDetailAfterApprovalJSON)
        case ("POST", "/api/threads/t1/requests/req-question/respond"):
            return response(Self.threadDetailAfterQuestionJSON)
        case ("POST", "/api/threads/t1/requests/req-plan/respond"):
            return response(Self.threadDetailAfterPlanJSON)
        case ("POST", "/api/threads/t1/fork"):
            return response(Self.forkResultJSON)
        case ("GET", "/api/threads/t1/exports/pdf"):
            let format = URLComponents(url: request.url, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first { $0.name == "format" }?
                .value
            if format == "html" {
                return SupervisorHTTPResponse(
                    statusCode: 200,
                    body: Data("<html><body>fixture</body></html>".utf8),
                    headers: ["content-disposition": #"attachment; filename="fixture-thread.html""#]
                )
            }
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data("%PDF fixture".utf8),
                headers: ["content-disposition": #"attachment; filename="fixture-thread.pdf""#]
            )
        default:
            return nil
        }
    }

    private func threadBundleResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse? {
        switch (request.method, request.url.path) {
        case ("GET", "/api/threads/t1/fork-turns"):
            response(Self.forkTurnsJSON)
        case ("GET", "/api/threads/t1/export-turns"):
            response(Self.exportTurnsJSON)
        case ("GET", "/api/threads/t1/skills"):
            response(Self.skillsJSON)
        case ("GET", "/api/threads/t1/mcp-servers"):
            response(Self.mcpServersJSON)
        case ("GET", "/api/threads/t1/hooks"):
            response(Self.hooksJSON)
        default:
            nil
        }
    }

    private func workspaceResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse? {
        switch (request.method, request.url.path) {
        case ("GET", "/api/workspaces"):
            response(Self.workspacesJSON)
        case ("POST", "/api/workspaces/w1/open"):
            response(Self.workspaceJSON)
        case ("GET", "/api/workspaces/w1/files/tree"):
            response(Self.workspaceTreeJSON)
        case ("GET", "/api/workspaces/w1/files/preview"):
            response(Self.workspacePreviewJSON)
        default:
            nil
        }
    }

    private func response(_ body: String) -> SupervisorHTTPResponse {
        SupervisorHTTPResponse(
            statusCode: 200,
            body: Data(body.utf8),
            headers: ["content-type": "application/json"]
        )
    }

    private static let workspacesJSON = """
    [{"id":"w1","label":"Repo","absPath":"/Users/mac/dev/remoteCodex","isFavorite":true,"lastOpenedAt":null}]
    """

    private static let workspaceJSON = """
    {"id":"w1","label":"Repo","absPath":"/Users/mac/dev/remoteCodex","isFavorite":true,"lastOpenedAt":null}
    """

    private static let threadsJSON = """
    [{
      "id": "t1",
      "workspaceId": "w1",
      "provider": "codex",
      "title": "Fixture Thread",
      "status": "running",
      "model": "gpt-5.4",
      "reasoningEffort": null,
      "fastMode": false,
      "collaborationMode": "default",
      "sandboxMode": null,
      "updatedAt": "now",
      "summaryText": "Working from fixture",
      "isLoaded": true
    }]
    """

    private static let threadPromptJSON = """
    {
      "id": "t1",
      "workspaceId": "w1",
      "provider": "codex",
      "title": "Fixture Thread",
      "status": "running",
      "model": "gpt-5.4",
      "reasoningEffort": null,
      "fastMode": false,
      "collaborationMode": "default",
      "sandboxMode": null,
      "updatedAt": "now",
      "summaryText": "Prompt accepted",
      "isLoaded": true
    }
    """

    private static var threadDetailJSON: String {
        threadDetailJSON(pendingRequests: allPendingRequestsJSON)
    }

    private static var threadDetailAfterApprovalJSON: String {
        threadDetailJSON(pendingRequests: "[\(questionPendingRequestJSON),\(planPendingRequestJSON)]")
    }

    private static var threadDetailAfterQuestionJSON: String {
        threadDetailJSON(pendingRequests: "[\(planPendingRequestJSON)]")
    }

    private static var threadDetailAfterPlanJSON: String {
        threadDetailJSON(pendingRequests: "[]")
    }

    private static func threadDetailJSON(pendingRequests: String) -> String {
        "\(threadDetailJSONPrefix)\(pendingRequests)\(threadDetailJSONSuffix)"
    }

    private static let threadDetailJSONPrefix = """
    {
          "thread": {
            "id": "t1",
            "workspaceId": "w1",
            "provider": "codex",
            "title": "Fixture Thread",
            "status": "running",
            "model": "gpt-5.4",
            "reasoningEffort": null,
            "fastMode": false,
            "collaborationMode": "default",
            "sandboxMode": null,
            "updatedAt": "now",
            "summaryText": "Working from fixture",
            "isLoaded": true
          },
          "workspace": {
            "id": "w1",
            "label": "Repo",
            "absPath": "/Users/mac/dev/remoteCodex",
            "isFavorite": true,
            "lastOpenedAt": null
          },
          "turns": [
            {
              "id": "turn-1",
              "startedAt": "now",
              "status": "running",
              "error": null,
              "model": "gpt-5.4",
              "tokenUsage": {
                "inputTokens": 1200,
                "outputTokens": 480,
                "totalTokens": 1680
              },
              "items": [
                {
                  "id": "item-1",
                  "kind": "assistant",
                  "text": "Working from fixture",
                  "status": "running",
                  "sequence": 1,
                  "callId": null,
                  "toolName": null,
                  "payload": null
                },
                {
                  "id": "cmd-1",
                  "kind": "commandExecution",
                  "text": "swift test",
                  "status": "completed",
                  "sequence": 2,
                  "callId": "call-command-1",
                  "toolName": "shell",
                  "payload": null
                },
                {
                  "id": "tool-1",
                  "kind": "toolCall",
                  "text": "Read project file",
                  "status": "completed",
                  "sequence": 3,
                  "callId": "call-tool-1",
                  "toolName": "read_file",
                  "payload": null
                }
              ]
            }
          ],
          "pendingRequests":
    """

    private static let threadDetailJSONSuffix = """
    ,
          "answeredRequestNotes": [],
          "activityNotes": [
            {
              "id": "activity-1",
              "kind": "forkCreated",
              "createdAt": "now",
              "text": "Created a fixture fork for timeline review.",
              "anchorTurnId": "turn-1",
              "linkedThreadId": "t2",
              "linkedThreadTitle": "Fixture Fork",
              "turnIndex": 1
            }
          ],
          "turnCount": 1,
          "totalTurnCount": 1,
          "liveItemCount": 1,
          "contextUsage": {
            "availability": "high",
            "remainingPercent": 68,
            "tokensInContextWindow": 4200,
            "modelContextWindow": 128000,
            "updatedAt": "now",
            "usedTokens": 4200,
            "maxTokens": 128000,
            "percent": null
          },
          "goalStatus": null,
          "goalObjective": null,
          "livePlan": {
            "turnId": "turn-1",
            "explanation": "Ship the fixture timeline in three steps.",
            "plan": [
              {"step": "Inspect current state", "status": "in_progress"},
              {"step": "Patch the UI", "status": "pending"},
              {"step": "Verify the result", "status": "pending"}
            ],
            "updatedAt": "now"
          }
        }
    """

    private static let allPendingRequestsJSON = "[\(approvalPendingRequestJSON),\(questionPendingRequestJSON),\(planPendingRequestJSON)]"

    private static let approvalPendingRequestJSON = """
    {
      "id": "req-approval",
      "kind": "approval",
      "status": "pending",
      "title": "Approve command",
      "description": "Run fixture command?",
      "createdAt": "now",
      "questions": [
        {
          "id": "q-approval",
          "header": "Approval",
          "question": "Allow this command?",
          "multiSelect": false,
          "isOther": false,
          "options": [
            {"label":"Approve","description":"Allow it"},
            {"label":"Deny","description":"Do not allow it"}
          ]
        }
      ],
      "turnId": "turn-1",
      "itemId": "item-1",
      "payload": null
    }
    """

    private static let questionPendingRequestJSON = """
    {
      "id": "req-question",
      "kind": "requestUserInput",
      "status": "pending",
      "title": "Mode",
      "description": "Choose fixture detail level.",
      "createdAt": "now",
      "questions": [
        {
          "id": "q-question",
          "header": "Mode",
          "question": "Which fixture path should continue?",
          "multiSelect": false,
          "isOther": true,
          "isSecret": false,
          "options": [
            {"label":"Short","description":"Keep it concise"},
            {"label":"Detailed","description":"Include more context"}
          ]
        }
      ],
      "turnId": "turn-1",
      "itemId": "item-1",
      "payload": null
    }
    """

    private static let planPendingRequestJSON = """
    {
      "id": "req-plan",
      "kind": "planDecision",
      "status": "pending",
      "title": "Plan ready",
      "description": "Choose how to proceed.",
      "createdAt": "now",
      "questions": [
        {
          "id": "plan-decision",
          "header": "Plan ready",
          "question": "How should the plan continue?",
          "multiSelect": false,
          "isOther": false,
          "isSecret": false,
          "options": [
            {"label":"Continue implementation","description":"Exit plan mode and continue immediately."},
            {"label":"Stay in plan mode","description":"Keep reviewing the plan."}
          ]
        }
      ],
      "turnId": "turn-1",
      "itemId": "item-1",
      "payload": null
    }
    """

    private static let modelsJSON = """
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

    private static let forkTurnsJSON = """
    [{"turnId":"turn-1","turnIndex":1,"startedAt":"now","status":"completed"}]
    """

    private static var forkResultJSON: String {
        """
        {"thread":\(threadDetailJSON),"sourceThreadId":"t1","sourceTurnId":null,"sourceTurnIndex":null}
        """
    }

    private static let exportTurnsJSON = """
    {
      "turns": [
        {
          "turnId": "turn-1",
          "turnNumber": 1,
          "startedAt": "now",
          "status": "completed",
          "userPromptPreview": "Fixture prompt"
        }
      ],
      "totalTurnCount": 1
    }
    """

    private static let skillsJSON = """
    {
      "cwd": "/Users/mac/dev/remoteCodex",
      "skills": [
        {
          "name": "ios-client",
          "description": "Native iOS client work",
          "shortDescription": "iOS client",
          "interface": {"shortDescription": "Native iOS"},
          "path": "/skills/ios",
          "scope": "project",
          "enabled": true
        }
      ],
      "errors": []
    }
    """

    private static let mcpServersJSON = """
    {
      "servers": [
        {
          "name": "docs",
          "authStatus": "unsupported",
          "tools": [
            {"name": "search", "title": "Search docs", "description": "Search documentation"}
          ],
          "resourceCount": 1,
          "resourceTemplateCount": 0
        }
      ]
    }
    """

    private static let hooksJSON = """
    {
      "cwd": "/Users/mac/dev/remoteCodex",
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

    private static let workspaceTreeJSON = """
    {
      "name": "remoteCodex",
      "path": "",
      "kind": "directory",
      "size": null,
      "children": [
        {"name":"App.swift","path":"Sources/App.swift","kind":"file","size":20,"children":[]}
      ]
    }
    """

    private static let workspacePreviewJSON = """
    {
      "path": "Sources/App.swift",
      "name": "App.swift",
      "content": "import SwiftUI\\n",
      "language": "swift",
      "size": 15,
      "truncated": false,
      "nextOffset": 15
    }
    """
}
