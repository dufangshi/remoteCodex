import Foundation
@testable import RemoteCodex
import UIKit
import XCTest

@MainActor
final class WorkspaceDetailViewModelTests: XCTestCase {
    func testRefreshSelectLoadMoreAndSaveFile() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = Self.workspaceDetailResponse(for:)
        let environment = try AppEnvironment(
            settingsStore: AppSettingsStore(
                defaults: XCTUnwrap(UserDefaults(suiteName: "WorkspaceDetailViewModelTests-\(UUID().uuidString)")),
                tokenStore: MemoryTokenStore()
            )
        ) { config in
            SupervisorAPIClient(config: config, transport: transport)
        }
        let model = WorkspaceDetailViewModel(
            environment: environment,
            connection: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            workspaceId: "w1"
        )

        await model.refresh()
        await model.loadMorePreview()
        model.editableContent = "hello world"
        await model.saveCurrentFile()
        await model.copyRawFile()
        await model.openRawFile()
        await model.downloadCurrentFile()
        await model.uploadFile(
            filename: "Upload.swift",
            bytes: Data("let upload = true".utf8),
            contentType: "text/x-swift"
        )

        XCTAssertEqual(model.workspace?.id, "w1")
        XCTAssertEqual(model.threads.map(\.id), ["t1"])
        XCTAssertEqual(UIPasteboard.general.string, "raw-content")
        XCTAssertEqual(model.previewFile?.filename, "App.swift")
        XCTAssertEqual(model.downloadedFile?.filename, "App.swift")
        XCTAssertEqual(model.selectedPath, "Sources/Upload.swift")
        XCTAssertEqual(model.preview?.content, "let upload = true")
        XCTAssertEqual(model.message, "Uploaded Sources/Upload.swift")
        XCTAssertTrue(
            try FileManager.default.fileExists(
                atPath: XCTUnwrap(model.downloadedFile?.url.path)
            )
        )
    }

    func testNewThreadLoadsProviderModelsAndStartsWithProvider() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            switch (request.method, request.url.path) {
            case ("GET", "/api/agent-runtimes"):
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.agentBackendsJSON.utf8), headers: [:])
            case ("GET", "/api/agent-runtimes/claude/models"):
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.agentModelsJSON.utf8), headers: [:])
            case ("POST", "/api/threads/start"):
                XCTAssertEqual(request.jsonBodyString("workspaceId"), "w1")
                XCTAssertEqual(request.jsonBodyString("provider"), "claude")
                XCTAssertEqual(request.jsonBodyString("model"), "claude-sonnet-4")
                XCTAssertEqual(request.jsonBodyString("approvalMode"), "yolo")
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.startedThreadJSON.utf8), headers: [:])
            default:
                XCTFail("Unexpected request \(request.method) \(request.url)")
                return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
            }
        }
        let environment = try AppEnvironment(
            settingsStore: AppSettingsStore(
                defaults: XCTUnwrap(UserDefaults(suiteName: "WorkspaceDetailViewModelTests-\(UUID().uuidString)")),
                tokenStore: MemoryTokenStore()
            )
        ) { config in
            SupervisorAPIClient(config: config, transport: transport)
        }
        let model = WorkspaceDetailViewModel(
            environment: environment,
            connection: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            workspaceId: "w1"
        )

        await model.loadNewThreadOptions()
        let threadId = await model.startThread()

        XCTAssertEqual(model.newThreadProvider, "claude")
        XCTAssertEqual(model.newThreadModel, "claude-sonnet-4")
        XCTAssertEqual(threadId, "t2")
    }

    func testRefreshStopsWhenWorkspaceNoLongerExists() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            switch (request.method, request.url.path) {
            case ("GET", "/api/workspaces"):
                return SupervisorHTTPResponse(statusCode: 200, body: Data("[]".utf8), headers: [:])
            case ("GET", "/api/threads"):
                return SupervisorHTTPResponse(statusCode: 200, body: Data("[]".utf8), headers: [:])
            default:
                XCTFail("Unexpected request \(request.method) \(request.url)")
                return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
            }
        }
        let environment = try AppEnvironment(
            settingsStore: AppSettingsStore(
                defaults: XCTUnwrap(UserDefaults(suiteName: "WorkspaceDetailViewModelTests-\(UUID().uuidString)")),
                tokenStore: MemoryTokenStore()
            )
        ) { config in
            SupervisorAPIClient(config: config, transport: transport)
        }
        let model = WorkspaceDetailViewModel(
            environment: environment,
            connection: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            workspaceId: "missing"
        )

        await model.refresh()

        XCTAssertNil(model.workspace)
        XCTAssertNil(model.tree)
        XCTAssertEqual(model.errorMessage, "Workspace is no longer available. Return to Workspaces and refresh.")
        XCTAssertFalse(transport.requests.contains { $0.url.path.contains("/files/tree") })
    }
}

private extension WorkspaceDetailViewModelTests {
    static func workspaceDetailResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        switch (request.method, request.url.path) {
        case ("GET", "/api/workspaces"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(workspacesJSON.utf8), headers: [:])
        case ("GET", "/api/threads"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(threadsJSON.utf8), headers: [:])
        case ("GET", "/api/workspaces/w1/files/tree"):
            return SupervisorHTTPResponse(statusCode: 200, body: Data(treeJSON.utf8), headers: [:])
        case ("GET", "/api/workspaces/w1/files/preview"):
            return workspacePreviewResponse(for: request)
        case ("GET", "/api/workspaces/w1/files/raw"):
            return workspaceRawResponse(for: request)
        case ("PUT", "/api/workspaces/w1/files"):
            XCTAssertEqual(request.jsonBodyString("path"), "Sources/App.swift")
            XCTAssertEqual(request.jsonBodyString("content"), "hello world")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(workspaceFileJSON.utf8), headers: [:])
        case ("GET", "/api/workspaces/w1/files/download"):
            return workspaceDownloadResponse(for: request)
        case ("POST", "/api/workspaces/w1/files/upload"):
            return workspaceUploadResponse(for: request)
        default:
            XCTFail("Unexpected request \(request.method) \(request.url)")
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
    }

    static func workspacePreviewResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        if request.url.absoluteString.contains("Upload.swift") {
            return SupervisorHTTPResponse(statusCode: 200, body: Data(uploadPreviewJSON.utf8), headers: [:])
        }
        if request.url.absoluteString.contains("offset=5") {
            return SupervisorHTTPResponse(statusCode: 200, body: Data(previewTailJSON.utf8), headers: [:])
        }
        return SupervisorHTTPResponse(statusCode: 200, body: Data(previewHeadJSON.utf8), headers: [:])
    }

    static func workspaceRawResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        XCTAssertTrue(request.url.absoluteString.contains("path=Sources%2FApp.swift"))
        return SupervisorHTTPResponse(
            statusCode: 200,
            body: Data("raw-content".utf8),
            headers: ["content-type": "text/plain"]
        )
    }

    static func workspaceDownloadResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        XCTAssertTrue(request.url.absoluteString.contains("path=Sources%2FApp.swift"))
        return SupervisorHTTPResponse(
            statusCode: 200,
            body: Data("downloaded".utf8),
            headers: [
                "content-type": "text/plain",
                "content-disposition": #"attachment; filename="App.swift""#
            ]
        )
    }

    static func workspaceUploadResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        let body = String(data: request.body ?? Data(), encoding: .utf8) ?? ""
        XCTAssertTrue(body.contains("name=\"file\"; filename=\"Upload.swift\""))
        XCTAssertTrue(body.contains("Content-Type: text/x-swift"))
        XCTAssertTrue(body.contains("let upload = true"))
        return SupervisorHTTPResponse(statusCode: 200, body: Data(uploadResultJSON.utf8), headers: [:])
    }

    static let workspacesJSON = """
    [{"id":"w1","label":"Repo","absPath":"/repo","isFavorite":false,"lastOpenedAt":null}]
    """

    static let threadsJSON = """
    [{
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
      "updatedAt": "2026-06-14T00:00:00Z",
      "summaryText": null,
      "isLoaded": true
    }]
    """

    static let treeJSON = """
    {
      "name": "repo",
      "path": "",
      "kind": "directory",
      "size": null,
      "children": [
        {"name":"App.swift","path":"Sources/App.swift","kind":"file","size":5,"children":[]}
      ]
    }
    """

    static let previewHeadJSON = """
    {
      "path": "Sources/App.swift",
      "name": "App.swift",
      "content": "hello",
      "language": "swift",
      "size": 10,
      "truncated": true,
      "nextOffset": 5
    }
    """

    static let previewTailJSON = """
    {
      "path": "Sources/App.swift",
      "name": "App.swift",
      "content": " world",
      "language": "swift",
      "size": 11,
      "truncated": false,
      "nextOffset": 11
    }
    """

    static let uploadPreviewJSON = """
    {
      "path": "Sources/Upload.swift",
      "name": "Upload.swift",
      "content": "let upload = true",
      "language": "swift",
      "size": 17,
      "truncated": false,
      "nextOffset": 17
    }
    """

    static let workspaceFileJSON = """
    {"path":"Sources/App.swift","name":"App.swift","kind":"file","size":11}
    """

    static let uploadResultJSON = """
    {
      "kind": "file",
      "file": {
        "path": "Sources/Upload.swift",
        "name": "Upload.swift",
        "kind": "file",
        "size": 17
      }
    }
    """

    static let agentBackendsJSON = """
    [{
      "provider": "claude",
      "displayName": "Claude Code",
      "description": "Claude runtime",
      "enabled": true,
      "isDefault": false,
      "status": {"state": "ready"},
      "capabilities": {},
      "managementSchema": {
        "hostConfigFiles": [],
        "toolboxItems": [],
        "hookCommandTemplates": [],
        "providerConfigFormat": "json",
        "mcpConfigFormat": "claude-json",
        "configArchives": false,
        "buildRestart": false
      },
      "installation": {
        "packageName": "@anthropic-ai/claude-code",
        "installed": true,
        "installedVersion": "1.0.0",
        "latestVersion": null,
        "installCommand": null,
        "updateCommand": null,
        "busy": false,
        "lastError": null
      }
    }]
    """

    static let agentModelsJSON = """
    [{
      "id": "claude-sonnet-4",
      "model": "claude-sonnet-4",
      "displayName": "Claude Sonnet 4",
      "description": "Balanced Claude model",
      "isDefault": true,
      "hidden": false,
      "supportsPerformanceMode": false,
      "supportedReasoningEfforts": [],
      "defaultReasoningEffort": null
    }]
    """

    static let startedThreadJSON = """
    {
      "id": "t2",
      "workspaceId": "w1",
      "provider": "claude",
      "title": "Claude Sonnet 4",
      "status": "running",
      "model": "claude-sonnet-4",
      "reasoningEffort": null,
      "fastMode": false,
      "collaborationMode": "default",
      "sandboxMode": null,
      "updatedAt": "2026-06-14T02:00:00Z",
      "summaryText": null,
      "isLoaded": true
    }
    """
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
