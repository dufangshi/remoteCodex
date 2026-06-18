import Foundation
@testable import RemoteCodex
import XCTest

final class SupervisorThreadAPIClientTests: XCTestCase {
    func testThreadDetailPromptResumeAndSettingsEndpointsUseExpectedPathsAndBodies() async throws {
        let client = threadActionClient()

        let detail = try await client.fetchThreadDetail(threadId: "t1", limit: 30, beforeTurnId: "turn-0")
        let prompt = try await client.sendThreadPrompt(
            threadId: "t1",
            request: SendThreadPromptRequest(
                prompt: "next",
                clientRequestId: "client-1",
                model: "gpt-5.4",
                reasoningEffort: nil,
                collaborationMode: nil,
                sandboxMode: nil
            )
        )
        let resumed = try await client.resumeThread(
            threadId: "t1",
            request: ResumeThreadRequest(model: "gpt-5.4", sandboxMode: "workspace-write")
        )
        let renamed = try await client.updateThread(threadId: "t1", request: UpdateThreadRequest(title: "Renamed"))
        let settings = try await client.updateThreadSettings(
            threadId: "t1",
            request: UpdateThreadSettingsRequest(
                model: "gpt-5.4",
                reasoningEffort: "medium",
                fastMode: true,
                collaborationMode: "plan",
                sandboxMode: "workspace-write"
            )
        )

        XCTAssertEqual(detail.thread.id, "t1")
        XCTAssertEqual(prompt.id, "t1")
        XCTAssertEqual(resumed.thread.status, "running")
        XCTAssertEqual(renamed.title, "Thread")
        XCTAssertEqual(settings.model, "gpt-5.4")
    }

    func testThreadLifecycleGoalAndDeleteEndpointsUseExpectedPathsAndBodies() async throws {
        let client = threadActionClient()

        let interrupted = try await client.interruptThread(threadId: "t1", turnId: "turn-1")
        let compacted = try await client.compactThread(threadId: "t1")
        let goal = try await client.updateThreadGoal(
            threadId: "t1",
            request: UpdateThreadGoalRequest(objective: "Ship iOS", status: nil, tokenBudget: 1200)
        )
        let cleared = try await client.clearThreadGoal(threadId: "t1")
        let deleted = try await client.deleteThread(threadId: "t1")

        XCTAssertEqual(interrupted.status, "running")
        XCTAssertEqual(compacted.id, "t1")
        XCTAssertEqual(goal.goal?.objective, "Ship iOS")
        XCTAssertTrue(cleared.cleared)
        XCTAssertEqual(deleted.id, "t1")
    }

    func testThreadBundleEndpointsUseExpectedPathsAndDecodeSummaries() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = Self.threadBundleResponse(for:)
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .relay, baseURL: "https://relay.test", authToken: "token", relayDeviceId: "device-1"),
            transport: transport
        )

        let models = try await client.listAgentModels(provider: "codex")
        let forkTurns = try await client.fetchThreadForkTurns(threadId: "t1")
        let fork = try await client.forkThread(threadId: "t1", request: ForkThreadRequest(mode: "turn", turnId: "turn-1"))
        let exportTurns = try await client.fetchThreadExportTurns(threadId: "t1")
        let itemDetail = try await client.fetchThreadHistoryItemDetail(threadId: "t1", itemId: "item 1")
        let imageAsset = try await client.fetchThreadImageAsset(threadId: "t1", path: "assets/plot 1.png")
        let skills = try await client.fetchThreadSkills(threadId: "t1")
        let mcpServers = try await client.fetchThreadMcpServers(threadId: "t1")
        let hooks = try await client.fetchThreadHooks(threadId: "t1")
        let trusted = try await client.trustThreadHook(
            threadId: "t1",
            request: TrustThreadHookRequest(key: "hook-1", currentHash: "hash-1")
        )
        let untrusted = try await client.untrustThreadHook(
            threadId: "t1",
            request: UntrustThreadHookRequest(key: "hook-1")
        )

        XCTAssertEqual(models.first?.defaultReasoningEffort, "medium")
        XCTAssertEqual(forkTurns.first?.turnId, "turn-1")
        XCTAssertEqual(fork.sourceTurnId, "turn-1")
        XCTAssertEqual(exportTurns.turns.first?.userPromptPreview, "Ship export")
        XCTAssertEqual(itemDetail.sourcePath, "App.swift")
        XCTAssertEqual(itemDetail.assetPath, "patches/app.diff")
        XCTAssertEqual(imageAsset.filename, "plot-1.png")
        XCTAssertEqual(imageAsset.contentType, "image/png")
        XCTAssertEqual(imageAsset.bytes, Data("png".utf8))
        XCTAssertEqual(skills.skills.first?.interfaceShortDescription, "Native iOS")
        XCTAssertEqual(mcpServers.servers.first?.tools.first?.title, "Search docs")
        XCTAssertEqual(hooks.hooks.first?.trustStatus, "modified")
        XCTAssertEqual(trusted.hooks.first?.trustStatus, "modified")
        XCTAssertEqual(untrusted.hooks.first?.key, "hook-1")
    }

    func testThreadPromptUploadRespondAndExportEndpointsUseExpectedRequests() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = Self.threadUploadRespondExportResponse(for:)
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            transport: transport
        )

        let upload = try await client.sendThreadPromptUpload(
            threadId: "t1",
            request: SendThreadPromptUploadRequest(
                prompt: "review [FILE 1: notes.txt]",
                clientRequestId: "client-upload",
                model: "gpt-5.4",
                reasoningEffort: "medium",
                collaborationMode: "plan",
                sandboxMode: "workspace-write",
                attachments: [
                    PromptAttachmentUploadRequest(
                        clientId: "att-1",
                        kind: "file",
                        originalName: "notes.txt",
                        placeholder: "[FILE 1: notes.txt]",
                        bytes: Data("hello".utf8),
                        contentType: "text/plain"
                    )
                ]
            )
        )
        let responded = try await client.respondToThreadRequest(
            threadId: "t1",
            requestId: "req-1",
            request: RespondThreadRequest(
                answers: ["q1": RespondThreadRequestAnswer(answers: ["Approve"])]
            )
        )
        let export = try await client.downloadThreadTranscriptExport(
            threadId: "t1",
            request: ExportThreadRequest(
                format: "html",
                mode: "custom",
                limit: nil,
                turnIds: ["turn-1", "turn-2"],
                profile: "standard",
                includeTokenAndPrice: true,
                includeCommandOutput: false,
                includeAbsolutePaths: true
            )
        )

        XCTAssertEqual(upload.id, "t1")
        XCTAssertEqual(responded.pendingRequests?.count, 1)
        XCTAssertEqual(responded.pendingRequests?.first?.questions?.first?.options.first?.label, "Approve")
        XCTAssertEqual(export.filename, "thread.html")
        XCTAssertEqual(export.bytes, Data("<html></html>".utf8))
    }
}

private extension SupervisorThreadAPIClientTests {
    func threadActionClient() -> SupervisorAPIClient {
        let transport = MockSupervisorTransport()
        transport.handler = Self.threadActionResponse(for:)
        return SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            transport: transport
        )
    }

    static func threadActionResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        if request.url.path.contains("/goal") || request.method == "DELETE" {
            return threadGoalOrDeleteResponse(for: request)
        }
        switch (request.method, request.url.path) {
        case ("GET", "/api/threads/t1"):
            return threadDetailResponse(for: request)
        case ("POST", "/api/threads/t1/prompt"):
            return promptResponse(for: request)
        case ("POST", "/api/threads/t1/resume"):
            XCTAssertEqual(request.jsonBodyString("sandboxMode"), "workspace-write")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadDetailJSON.utf8), headers: [:])
        case ("PATCH", "/api/threads/t1"):
            XCTAssertEqual(request.jsonBodyString("title"), "Renamed")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadJSON.utf8), headers: [:])
        case ("PATCH", "/api/threads/t1/settings"):
            return settingsResponse(for: request)
        case ("POST", "/api/threads/t1/interrupt"):
            XCTAssertEqual(request.jsonBodyString("turnId"), "turn-1")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadJSON.utf8), headers: [:])
        case ("POST", "/api/threads/t1/compact"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadJSON.utf8), headers: [:])
        default:
            XCTFail("Unexpected request \(request.method) \(request.url)")
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
    }

    // swiftlint:disable:next cyclomatic_complexity
    static func threadBundleResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        switch (request.method, request.url.path) {
        case ("GET", "/relay/devices/device-1/api/agent-runtimes/codex/models"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(modelsJSON.utf8), headers: [:])
        case ("GET", "/relay/devices/device-1/api/threads/t1/fork-turns"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(forkTurnsJSON.utf8), headers: [:])
        case ("POST", "/relay/devices/device-1/api/threads/t1/fork"):
            XCTAssertEqual(request.jsonBodyString("mode"), "turn")
            XCTAssertEqual(request.jsonBodyString("turnId"), "turn-1")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(forkResultJSON.utf8), headers: [:])
        case ("GET", "/relay/devices/device-1/api/threads/t1/export-turns"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(exportTurnsJSON.utf8), headers: [:])
        case ("GET", "/relay/devices/device-1/api/threads/t1/items/item 1/detail"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(historyItemDetailJSON.utf8), headers: [:])
        case ("GET", "/relay/devices/device-1/api/threads/t1/assets/image"):
            XCTAssertEqual(request.url.query, "path=assets%2Fplot%201.png")
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data("png".utf8),
                headers: [
                    "content-type": "image/png",
                    "content-disposition": #"attachment; filename="plot-1.png""#
                ]
            )
        case ("GET", "/relay/devices/device-1/api/threads/t1/skills"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(skillsJSON.utf8), headers: [:])
        case ("GET", "/relay/devices/device-1/api/threads/t1/mcp-servers"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(mcpServersJSON.utf8), headers: [:])
        case ("GET", "/relay/devices/device-1/api/threads/t1/hooks"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(hooksJSON.utf8), headers: [:])
        case ("POST", "/relay/devices/device-1/api/threads/t1/hooks/trust"):
            XCTAssertEqual(request.jsonBodyString("currentHash"), "hash-1")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(hooksJSON.utf8), headers: [:])
        case ("POST", "/relay/devices/device-1/api/threads/t1/hooks/untrust"):
            XCTAssertEqual(request.jsonBodyString("key"), "hook-1")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(hooksJSON.utf8), headers: [:])
        default:
            XCTFail("Unexpected request \(request.method) \(request.url)")
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
    }

    static func threadUploadRespondExportResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        switch (request.method, request.url.path) {
        case ("POST", "/api/threads/t1/prompt"):
            XCTAssertTrue(request.contentType?.hasPrefix("multipart/form-data; boundary=remoteCodexIOS") == true)
            let body = String(data: request.body ?? Data(), encoding: .utf8) ?? ""
            XCTAssertTrue(body.contains("Content-Disposition: form-data; name=\"prompt\""))
            XCTAssertTrue(body.contains("review [FILE 1: notes.txt]"))
            XCTAssertTrue(body.contains("Content-Disposition: form-data; name=\"attachmentManifest\""))
            XCTAssertTrue(body.contains(#""clientId":"att-1""#))
            XCTAssertTrue(body.contains("name=\"attachments\"; filename=\"notes.txt\""))
            XCTAssertTrue(body.contains("Content-Type: text/plain"))
            XCTAssertTrue(body.contains("hello"))
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadJSON.utf8), headers: [:])
        case ("POST", "/api/threads/t1/requests/req-1/respond"):
            let answers = request.jsonBody?["answers"] as? [String: Any]
            let questionAnswer = answers?["q1"] as? [String: Any]
            XCTAssertEqual(questionAnswer?["answers"] as? [String], ["Approve"])
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadDetailWithPendingRequestJSON.utf8), headers: [:])
        case ("GET", "/api/threads/t1/exports/pdf"):
            XCTAssertTrue(request.url.absoluteString.contains("format=html"))
            XCTAssertTrue(request.url.absoluteString.contains("mode=custom"))
            XCTAssertTrue(request.url.absoluteString.contains("turnIds=turn-1%2Cturn-2"))
            XCTAssertTrue(request.url.absoluteString.contains("includeTokenAndPrice=true"))
            XCTAssertTrue(request.url.absoluteString.contains("includeCommandOutput=false"))
            XCTAssertTrue(request.url.absoluteString.contains("includeAbsolutePaths=true"))
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data("<html></html>".utf8),
                headers: ["content-disposition": #"attachment; filename="thread.html""#]
            )
        default:
            XCTFail("Unexpected request \(request.method) \(request.url)")
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
    }

    static func threadGoalOrDeleteResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        switch (request.method, request.url.path) {
        case ("PATCH", "/api/threads/t1/goal"):
            return goalResponse(for: request)
        case ("DELETE", "/api/threads/t1/goal"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(clearGoalJSON.utf8), headers: [:])
        case ("DELETE", "/api/threads/t1"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadJSON.utf8), headers: [:])
        default:
            XCTFail("Unexpected request \(request.method) \(request.url)")
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
    }

    static func threadDetailResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        XCTAssertTrue(request.url.absoluteString.contains("limit=30"))
        XCTAssertTrue(request.url.absoluteString.contains("beforeTurnId=turn-0"))
        return SupervisorHTTPResponse(statusCode: 200, body: Data(threadDetailJSON.utf8), headers: [:])
    }

    static func promptResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        XCTAssertEqual(request.jsonBodyString("prompt"), "next")
        XCTAssertEqual(request.jsonBodyString("clientRequestId"), "client-1")
        return SupervisorHTTPResponse(statusCode: 200, body: Data(threadJSON.utf8), headers: [:])
    }

    static func settingsResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        XCTAssertEqual(request.jsonBodyBool("fastMode"), true)
        XCTAssertEqual(request.jsonBodyString("collaborationMode"), "plan")
        return SupervisorHTTPResponse(statusCode: 200, body: Data(threadJSON.utf8), headers: [:])
    }

    static func goalResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        XCTAssertEqual(request.jsonBodyString("objective"), "Ship iOS")
        XCTAssertEqual(request.jsonBodyInt("tokenBudget"), 1200)
        return SupervisorHTTPResponse(statusCode: 200, body: Data(goalResponseJSON.utf8), headers: [:])
    }

    static let threadJSON = """
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

    static let threadDetailJSON = """
    {
      "thread": {
        "id": "t1",
        "workspaceId": "w1",
        "provider": "codex",
        "title": "Thread",
        "status": "running",
        "model": "gpt-5.4",
        "reasoningEffort": "medium",
        "fastMode": false,
        "collaborationMode": "default",
        "sandboxMode": "workspace-write",
        "updatedAt": "now",
        "summaryText": null,
        "isLoaded": true
      },
      "workspace": {
        "id": "w1",
        "label": "Repo",
        "absPath": "/repo",
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
          "tokenUsage": null,
          "items": [
            {
              "id": "item-1",
              "kind": "assistant",
              "text": "Working",
              "status": "running",
              "sequence": 1,
              "callId": null,
              "toolName": null,
              "payload": null
            }
          ]
        }
      ],
      "pendingRequests": [],
      "answeredRequestNotes": [],
      "turnCount": 1,
      "totalTurnCount": 1,
      "liveItemCount": 1,
      "contextUsage": null,
      "goalStatus": "active",
      "goalObjective": "Ship iOS"
    }
    """

    static let threadDetailWithPendingRequestJSON = """
    {
      "thread": {
        "id": "t1",
        "workspaceId": "w1",
        "provider": "codex",
        "title": "Thread",
        "status": "running",
        "model": "gpt-5.4",
        "reasoningEffort": "medium",
        "fastMode": false,
        "collaborationMode": "default",
        "sandboxMode": "workspace-write",
        "updatedAt": "now",
        "summaryText": null,
        "isLoaded": true
      },
      "workspace": {
        "id": "w1",
        "label": "Repo",
        "absPath": "/repo",
        "isFavorite": true,
        "lastOpenedAt": null
      },
      "turns": [],
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
          "payload": {"risk":"medium"}
        }
      ],
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
        "tokenBudget": 1200,
        "tokensUsed": 0,
        "timeUsedSeconds": 0,
        "createdAt": "now",
        "updatedAt": "now",
        "completedAt": null
      }
    }
    """

    static let clearGoalJSON = """
    {"cleared":true,"goalHistory":[]}
    """

    static let modelsJSON = """
    [{
      "id": "gpt-5.4",
      "model": "gpt-5.4",
      "displayName": "GPT-5.4",
      "description": "Flagship",
      "isDefault": true,
      "hidden": false,
      "supportedReasoningEfforts": [
        {"reasoningEffort":"low","description":"Fast"},
        {"reasoningEffort":"medium","description":"Balanced"}
      ],
      "defaultReasoningEffort": "medium"
    }]
    """

    static let forkTurnsJSON = """
    [{"turnId":"turn-1","turnIndex":1,"startedAt":"now","status":"completed"}]
    """

    static var forkResultJSON: String {
        """
        {"thread":\(threadDetailJSON),"sourceThreadId":"t1","sourceTurnId":"turn-1","sourceTurnIndex":1}
        """
    }

    static let exportTurnsJSON = """
    {
      "turns": [
        {
          "turnId": "turn-1",
          "turnNumber": 1,
          "startedAt": "now",
          "status": "completed",
          "userPromptPreview": "Ship export"
        }
      ],
      "totalTurnCount": 1
    }
    """

    static let historyItemDetailJSON = """
    {
      "id": "item-1",
      "kind": "fileChange",
      "title": "File Change Details",
      "text": "diff --git a/App.swift b/App.swift",
      "contentType": "text/x-diff",
      "sourcePath": "App.swift",
      "assetPath": "patches/app.diff"
    }
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
    {
      "servers": [
        {
          "name": "docs",
          "authStatus": "unsupported",
          "tools": [
            {"name": "search", "title": "Search docs", "description": "Search documentation"}
          ],
          "resourceCount": 1,
          "resourceTemplateCount": 2
        }
      ]
    }
    """

    static let hooksJSON = """
    {
      "cwd": "/repo",
      "hooks": [
        {
          "key": "hook-1",
          "eventName": "preToolUse",
          "handlerType": "command",
          "matcher": "*",
          "command": "echo ok",
          "timeoutSec": 10,
          "statusMessage": "Checking",
          "sourcePath": "/repo/hooks.json",
          "source": "project",
          "pluginId": null,
          "displayOrder": 0,
          "enabled": true,
          "isManaged": false,
          "currentHash": "hash-1",
          "trustStatus": "modified"
        }
      ],
      "warnings": [],
      "errors": [],
      "globalHooksPath": "/home/.codex/hooks.json",
      "projectHooksPath": "/repo/.codex/hooks.json"
    }
    """
}

private extension SupervisorHTTPRequest {
    func jsonBodyString(_ key: String) -> String? {
        jsonBody?[key] as? String
    }

    func jsonBodyBool(_ key: String) -> Bool? {
        jsonBody?[key] as? Bool
    }

    func jsonBodyInt(_ key: String) -> Int? {
        jsonBody?[key] as? Int
    }

    var jsonBody: [String: Any]? {
        guard let body else { return nil }
        return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
    }
}
