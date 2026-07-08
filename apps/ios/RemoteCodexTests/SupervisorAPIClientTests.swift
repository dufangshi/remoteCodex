import Foundation
@testable import RemoteCodex
import XCTest

final class SupervisorAPIClientTests: XCTestCase {
    func testFetchAuthSessionUsesDirectPathAndBearerToken() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            XCTAssertEqual(request.url.absoluteString, "http://127.0.0.1:8787/api/auth/session")
            XCTAssertEqual(request.method, "GET")
            XCTAssertEqual(request.bearerToken, "token")
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data("""
                {"authenticated":true,"username":"admin","expiresAt":null,"mode":"server","authRequired":true}
                """.utf8),
                headers: [:]
            )
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .server, baseURL: "127.0.0.1:8787", authToken: "token"),
            transport: transport
        )

        let session = try await client.fetchAuthSession()

        XCTAssertTrue(session.authenticated)
        XCTAssertEqual(session.username, "admin")
        XCTAssertEqual(transport.requests.count, 1)
    }

    func testRelayAuthSessionMapsRelaySession() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            XCTAssertEqual(request.url.absoluteString, "https://relay.example.com/relay/auth/session")
            let body = """
            {
              "authenticated": true,
              "registrationEnabled": true,
              "user": {
                "id": "u1",
                "email": "u@example.com",
                "username": "dev",
                "role": "user",
                "enabled": true
              }
            }
            """
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data(body.utf8),
                headers: [:]
            )
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .relay, baseURL: "https://relay.example.com", authToken: "relay"),
            transport: transport
        )

        let session = try await client.fetchAuthSession()

        XCTAssertTrue(session.authenticated)
        XCTAssertEqual(session.username, "dev")
        XCTAssertEqual(session.mode, "relay")
    }

    func testRelayLoginPostsIdentifierAndPassword() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            XCTAssertEqual(request.url.path, "/relay/auth/login")
            XCTAssertEqual(request.method, "POST")
            XCTAssertEqual(request.jsonBodyString("identifier"), "dev@example.com")
            XCTAssertEqual(request.jsonBodyString("password"), "pw")
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data(Self.relayLoginJSON.utf8),
                headers: [:]
            )
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .relay, baseURL: "https://relay.example.com"),
            transport: transport
        )

        let result = try await client.relayLogin(identifier: "dev@example.com", password: "pw")

        XCTAssertEqual(result.token, "relay-token")
        XCTAssertEqual(result.session.user?.username, "dev")
    }

    func testRelayPortalDecodesConnectedDevicesAsOnline() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            XCTAssertEqual(request.url.path, "/relay/portal")
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data("""
                {
                  "devices": [
                    {
                      "id": "device-a",
                      "name": "Backend",
                      "connected": true,
                      "createdAt": "now",
                      "lastHeartbeatAt": "now"
                    }
                  ],
                  "sharedDevicesWithMe": [
                    {
                      "id": "grant-a",
                      "ownerUserId": "owner",
                      "ownerUsername": "owner",
                      "targetUsername": "dev",
                      "targetUserId": "dev",
                      "deviceId": "device-shared",
                      "deviceName": "Office server",
                      "scope": "device",
                      "threadId": null,
                      "workspaceId": null,
                      "workspaceScope": "all",
                      "workspaceIds": [],
                      "label": "Office server",
                      "threadAccess": "control",
                      "workspaceAccess": "write",
                      "canCreateThreads": true,
                      "createdAt": "now",
                      "revokedAt": null,
                      "expiresAt": null
                    }
                  ]
                }
                """.utf8),
                headers: [:]
            )
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .relay, baseURL: "https://relay.example.com", authToken: "relay"),
            transport: transport
        )

        let portal = try await client.fetchRelayPortal()

        XCTAssertEqual(portal.devices.first?.id, "device-a")
        XCTAssertEqual(portal.devices.first?.online, true)
        XCTAssertEqual(portal.sharedDevicesWithMe.first?.id, "grant-a")
        XCTAssertEqual(portal.sharedDevicesWithMe.first?.scope, "device")
        XCTAssertEqual(portal.sharedDevicesWithMe.first?.canCreateThreads, true)
    }

    func testHomeSnapshotUsesRelayDevicePaths() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            if request.url.path.hasSuffix("/api/workspaces") {
                return SupervisorHTTPResponse(
                    statusCode: 200,
                    body: Data("""
                    [{"id":"w1","label":"Repo","absPath":"/repo","isFavorite":true,"lastOpenedAt":null}]
                    """.utf8),
                    headers: [:]
                )
            }
            if request.url.path.hasSuffix("/api/threads") {
                return SupervisorHTTPResponse(
                    statusCode: 200,
                    body: Data(Self.threadListJSON.utf8),
                    headers: [:]
                )
            }
            XCTFail("Unexpected request \(request.url)")
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(
                mode: .relay,
                baseURL: "https://relay.example.com",
                authToken: "relay",
                relayDeviceId: "device-a"
            ),
            transport: transport
        )

        let snapshot = try await client.fetchHomeSnapshot()

        XCTAssertEqual(snapshot.workspaces.map(\.id), ["w1"])
        XCTAssertEqual(snapshot.activeThreadCount, 1)
        XCTAssertEqual(
            Set(transport.requests.map(\.url.path)),
            [
                "/relay/devices/device-a/api/workspaces",
                "/relay/devices/device-a/api/threads"
            ]
        )
    }

    func testWorkspaceFavoriteUsesRelayForwardedPath() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            XCTAssertTrue(
                request.url.absoluteString.contains(
                    "/relay/devices/device-a/api/workspaces/workspace%2Fone/favorite"
                )
            )
            XCTAssertEqual(request.method, "POST")
            XCTAssertEqual(request.jsonBodyBool("isFavorite"), true)
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data(Self.workspaceJSON.utf8),
                headers: [:]
            )
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(
                mode: .relay,
                baseURL: "https://relay.example.com",
                authToken: "relay",
                relayDeviceId: "device-a"
            ),
            transport: transport
        )

        let workspace = try await client.setWorkspaceFavorite(workspaceId: "workspace/one", isFavorite: true)

        XCTAssertEqual(workspace.id, "w1")
        XCTAssertTrue(workspace.isFavorite)
    }

    func testDeleteWorkspacePostsConfirmationBody() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            XCTAssertEqual(request.url.path, "/api/workspaces/w1")
            XCTAssertEqual(request.method, "DELETE")
            XCTAssertEqual(request.jsonBodyString("confirmWorkspaceId"), "w1")
            XCTAssertEqual(request.jsonBodyString("confirmLabel"), "Demo Workspace")
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data(#"{"id":"w1"}"#.utf8),
                headers: [:]
            )
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .local, baseURL: "http://127.0.0.1:8787"),
            transport: transport
        )

        let deleted = try await client.deleteWorkspace(
            workspace: SupervisorWorkspaceSummary(
                id: "w1",
                label: "Demo Workspace",
                absPath: "/Users/test/demo",
                isFavorite: false,
                lastOpenedAt: nil
            )
        )

        XCTAssertEqual(deleted.id, "w1")
    }

    func testStartThreadPostsExpectedBody() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            XCTAssertEqual(request.url.path, "/api/threads/start")
            XCTAssertEqual(request.method, "POST")
            XCTAssertEqual(request.jsonBodyString("workspaceId"), "w1")
            XCTAssertEqual(request.jsonBodyString("model"), "gpt-5.4")
            XCTAssertEqual(request.jsonBodyString("approvalMode"), "yolo")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.threadJSON.utf8), headers: [:])
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .local, baseURL: "http://127.0.0.1:8787"),
            transport: transport
        )

        let thread = try await client.startThread(
            StartSupervisorThreadRequest(
                workspaceId: "w1",
                title: "New thread",
                provider: nil,
                model: "gpt-5.4",
                reasoningEffort: nil,
                approvalMode: "yolo"
            )
        )

        XCTAssertEqual(thread.id, "t1")
    }

    func testSupervisorAPIErrorUsesReadableDescription() {
        XCTAssertEqual(
            SupervisorAPIError.http(statusCode: 404, message: "Workspace was not found.", body: nil).localizedDescription,
            "Workspace was not found."
        )
        XCTAssertEqual(
            SupervisorAPIError.invalidURL("not a url").localizedDescription,
            "Invalid URL: not a url"
        )
    }

    func testListAgentBackendsDecodesRuntimeDtoAndModels() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            switch (request.method, request.url.path) {
            case ("GET", "/api/agent-runtimes"):
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.agentBackendsJSON.utf8), headers: [:])
            case ("GET", "/api/agent-runtimes/claude/models"):
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.agentModelsJSON.utf8), headers: [:])
            default:
                XCTFail("Unexpected request \(request.method) \(request.url.path)")
                return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
            }
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            transport: transport
        )

        let backends = try await client.listAgentBackends()
        let models = try await client.listAgentModels(provider: "claude")

        XCTAssertEqual(backends.first?.provider, "claude")
        XCTAssertEqual(backends.first?.displayName, "Claude Code")
        XCTAssertEqual(backends.first?.statusState, "ready")
        XCTAssertEqual(backends.first?.installedVersion, "1.0.0")
        XCTAssertTrue(backends.first?.installAvailable == true)
        XCTAssertTrue(backends.first?.configArchives == true)
        XCTAssertEqual(models.first?.model, "claude-sonnet-4")
        XCTAssertEqual(models.first?.defaultReasoningEffort, "medium")
    }

    func testInstallOrUpdateAgentBackendPostsExpectedAction() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            XCTAssertEqual(request.method, "POST")
            XCTAssertEqual(request.url.path, "/api/agent-runtimes/claude/install")
            XCTAssertEqual(request.jsonBodyString("action"), "install")
            let backendJSON = Self.agentBackendsJSON
                .replacingOccurrences(of: #"^\s*\[\s*"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"\s*\]\s*$"#, with: "", options: .regularExpression)
            return SupervisorHTTPResponse(statusCode: 200, body: Data(backendJSON.utf8), headers: [:])
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            transport: transport
        )

        let backend = try await client.installOrUpdateAgentBackend(provider: "claude", action: "install")

        XCTAssertEqual(backend.provider, "claude")
    }

    func testSettingsAndPluginEndpointsUseExpectedPaths() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            switch (request.method, request.url.path) {
            case ("GET", "/api/config/runtime"):
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.runtimeJSON.utf8), headers: [:])
            case ("GET", "/api/plugins"):
                return SupervisorHTTPResponse(statusCode: 200, body: Data("[\(Self.pluginJSON)]".utf8), headers: [:])
            case ("PATCH", "/api/config/workspace-settings"):
                XCTAssertEqual(request.jsonBodyString("devHome"), "/Users/dev")
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.workspaceSettingsJSON.utf8), headers: [:])
            case ("PATCH", "/api/plugins/plugin/one"):
                XCTAssertEqual(request.jsonBodyBool("enabled"), false)
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.pluginJSON.utf8), headers: [:])
            case ("POST", "/api/plugins/import"):
                XCTAssertEqual(request.jsonBodyString("manifestJson"), #"{"id":"plugin/one"}"#)
                XCTAssertEqual(request.jsonBodyBool("enabled"), true)
                return SupervisorHTTPResponse(statusCode: 200, body: Data(Self.pluginJSON.utf8), headers: [:])
            default:
                XCTFail("Unexpected request \(request.method) \(request.url.path)")
                return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
            }
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .server, baseURL: "http://host", authToken: "token"),
            transport: transport
        )

        let runtime = try await client.fetchRuntimeConfig()
        let settings = try await client.updateWorkspaceSettings(
            UpdateSupervisorWorkspaceSettingsRequest(devHome: "/Users/dev", defaultBackend: nil)
        )
        let plugins = try await client.listPlugins()
        let plugin = try await client.updatePlugin(
            pluginId: "plugin/one",
            request: UpdateSupervisorPluginRequest(enabled: false)
        )
        let imported = try await client.importPlugin(
            ImportSupervisorPluginRequest(manifestJson: #"{"id":"plugin/one"}"#, enabled: true)
        )

        XCTAssertEqual(runtime.appName, "Remote Codex")
        XCTAssertEqual(settings.devHome, "/Users/dev")
        XCTAssertEqual(plugins.first?.capabilities?.artifactTypes?.first?.type, "terminal")
        XCTAssertEqual(plugins.first?.capabilities?.threadPanels?.first?.kind, "terminal")
        XCTAssertEqual(plugins.first?.capabilities?.mcpServers?.first?.command, "remote-codex-terminal")
        XCTAssertFalse(plugin.enabled)
        XCTAssertEqual(imported.id, "plugin/one")
    }

    func testHTTPErrorParsesMessage() async {
        let transport = MockSupervisorTransport()
        transport.handler = { _ in
            SupervisorHTTPResponse(statusCode: 401, body: Data(#"{"message":"Login required"}"#.utf8), headers: [:])
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .server, baseURL: "http://host"),
            transport: transport
        )

        do {
            let _: AuthSession = try await client.requestJSON("/api/auth/session")
            XCTFail("Expected request failure")
        } catch let error as SupervisorAPIError {
            XCTAssertEqual(
                error,
                .http(statusCode: 401, message: "Login required", body: #"{"message":"Login required"}"#)
            )
        } catch {
            XCTFail("Unexpected error \(error)")
        }
    }

    func testMultipartRequestBuildsFormDataBody() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            XCTAssertEqual(request.method, "POST")
            XCTAssertEqual(request.url.path, "/api/upload")
            XCTAssertTrue(request.contentType?.hasPrefix("multipart/form-data; boundary=remoteCodexIOS") == true)

            let body = String(data: request.body ?? Data(), encoding: .utf8) ?? ""
            XCTAssertTrue(body.contains("Content-Disposition: form-data; name=\"path\""))
            XCTAssertTrue(body.contains("notes/readme.md"))
            XCTAssertTrue(body.contains("Content-Disposition: form-data; name=\"file\"; filename=\"readme.md\""))
            XCTAssertTrue(body.contains("Content-Type: text/markdown"))
            XCTAssertTrue(body.contains("# hello"))

            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data(#"{"path":"notes/readme.md","name":"readme.md","kind":"file","size":7}"#.utf8),
                headers: [:]
            )
        }
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .local, baseURL: "http://127.0.0.1:8787"),
            transport: transport
        )

        let result: SupervisorWorkspaceFile = try await client.requestMultipartJSON(
            "/api/upload",
            parts: [
                SupervisorMultipartPart(
                    fieldName: "file",
                    filename: "readme.md",
                    contentType: "text/markdown",
                    bytes: Data("# hello".utf8)
                )
            ],
            fields: ["path": "notes/readme.md"]
        )

        XCTAssertEqual(result.path, "notes/readme.md")
    }

    func testWorkspaceTreePreviewWriteAndDownloadEndpoints() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = Self.workspaceFileResponse(for:)
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            transport: transport
        )

        let tree = try await client.fetchWorkspaceTree(workspaceId: "w1", path: "Sources")
        let preview = try await client.fetchWorkspaceFilePreview(
            workspaceId: "w1",
            path: "Sources/App.swift",
            limit: 50000
        )
        let saved = try await client.writeWorkspaceFile(workspaceId: "w1", path: "Sources/App.swift", content: "updated")
        let raw = try await client.fetchWorkspaceRawFile(workspaceId: "w1", path: "Sources/App.swift")
        let download = try await client.downloadWorkspaceFile(workspaceId: "w1", path: "Sources/App.swift")

        XCTAssertEqual(tree.children?.first?.path, "Sources/App.swift")
        XCTAssertEqual(preview.path, "Sources/App.swift")
        XCTAssertEqual(saved.path, "Sources/App.swift")
        XCTAssertEqual(raw.text, "raw file")
        XCTAssertEqual(download.bytes, Data("file".utf8))
    }

    func testWorkspaceUploadEndpointBuildsMultipartBody() async throws {
        let transport = MockSupervisorTransport()
        transport.handler = Self.workspaceUploadResponse(for:)
        let client = SupervisorAPIClient(
            config: SupervisorConnectionConfig(mode: .local, baseURL: "http://host"),
            transport: transport
        )

        let upload = try await client.uploadWorkspaceFile(
            workspaceId: "w1",
            request: UploadWorkspaceFileRequest(
                filename: "Upload.swift",
                contentType: "text/x-swift",
                bytes: Data("let uploaded = true".utf8),
                path: "Sources/Upload.swift"
            )
        )

        XCTAssertEqual(upload.kind, "file")
        XCTAssertEqual(upload.file?.path, "Sources/Upload.swift")
    }
}

private extension SupervisorAPIClientTests {
    static func workspaceFileResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        switch (request.method, request.url.path) {
        case ("GET", "/api/workspaces/w1/files/tree"):
            XCTAssertEqual(request.url.query, "path=Sources")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(workspaceTreeJSON.utf8), headers: [:])
        case ("GET", "/api/workspaces/w1/files/preview"):
            XCTAssertTrue(request.url.absoluteString.contains("path=Sources%2FApp.swift"))
            XCTAssertTrue(request.url.absoluteString.contains("limit=50000"))
            return SupervisorHTTPResponse(statusCode: 200, body: Data(filePreviewJSON.utf8), headers: [:])
        case ("PUT", "/api/workspaces/w1/files"):
            XCTAssertEqual(request.jsonBodyString("path"), "Sources/App.swift")
            XCTAssertEqual(request.jsonBodyString("content"), "updated")
            return SupervisorHTTPResponse(statusCode: 200, body: Data(workspaceFileJSON.utf8), headers: [:])
        case ("GET", "/api/workspaces/w1/files/raw"):
            XCTAssertTrue(request.url.absoluteString.contains("path=Sources%2FApp.swift"))
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data("raw file".utf8),
                headers: ["content-type": "text/plain"]
            )
        case ("GET", "/api/workspaces/w1/files/download"):
            XCTAssertTrue(request.url.absoluteString.contains("path=Sources%2FApp.swift"))
            return SupervisorHTTPResponse(
                statusCode: 200,
                body: Data("file".utf8),
                headers: ["Content-Type": "text/plain"]
            )
        default:
            XCTFail("Unexpected request \(request.method) \(request.url)")
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
    }

    static func workspaceUploadResponse(for request: SupervisorHTTPRequest) -> SupervisorHTTPResponse {
        XCTAssertEqual(request.method, "POST")
        XCTAssertEqual(request.url.path, "/api/workspaces/w1/files/upload")
        XCTAssertTrue(request.contentType?.hasPrefix("multipart/form-data; boundary=remoteCodexIOS") == true)
        let body = String(data: request.body ?? Data(), encoding: .utf8) ?? ""
        XCTAssertTrue(body.contains("Content-Disposition: form-data; name=\"path\""))
        XCTAssertTrue(body.contains("Sources/Upload.swift"))
        XCTAssertTrue(body.contains("name=\"file\"; filename=\"Upload.swift\""))
        XCTAssertTrue(body.contains("Content-Type: text/x-swift"))
        XCTAssertTrue(body.contains("let uploaded = true"))
        return SupervisorHTTPResponse(statusCode: 200, body: Data(workspaceUploadJSON.utf8), headers: [:])
    }

    static let relayLoginJSON = """
    {
      "token": "relay-token",
      "session": {
        "authenticated": true,
        "registrationEnabled": true,
        "user": {
          "id": "u1",
          "email": "u@example.com",
          "username": "dev",
          "role": "user",
          "enabled": true
        }
      }
    }
    """

    static let workspaceJSON = """
    {"id":"w1","label":"Repo","absPath":"/repo","isFavorite":true,"lastOpenedAt":null}
    """

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

    static let runtimeJSON = """
    {
      "appName": "Remote Codex",
      "appVersion": "0.1.0",
      "mode": "local",
      "host": "127.0.0.1",
      "port": 8787,
      "workspaceRoot": "/Users",
      "environment": "test"
    }
    """

    static let workspaceSettingsJSON = """
    {"workspaceRoot":"/Users","devHome":"/Users/dev","defaultBackend":"codex"}
    """

    static let pluginJSON = """
    {
      "id": "plugin/one",
      "name": "Plugin One",
      "version": "1.0.0",
      "description": "Built-in durable terminal panel backed by the supervisor.",
      "remoteCodex": "0.1.0",
      "enabled": false,
      "source": "builtin",
      "capabilities": {
        "artifactTypes": [
          {"type": "terminal", "title": "Terminal", "fileExtensions": ["log"]}
        ],
        "timelineRenderers": ["terminal"],
        "threadPanels": [
          {"id": "terminal", "label": "Terminal", "kind": "terminal", "artifactTypes": ["terminal"]}
        ],
        "modelHints": [
          {"id": "terminal", "text": "Use the durable terminal when requested."}
        ],
        "mcpServers": [
          {"id": "terminal", "name": "Terminal", "command": "remote-codex-terminal", "args": ["serve"], "env": {"MODE": "test"}}
        ],
        "frontend": {"entry": "dist/index.js", "style": "dist/style.css"},
        "backend": {"entry": "dist/backend.js"}
      }
    }
    """

    static let workspaceTreeJSON = """
    {
      "name": "repo",
      "path": "",
      "kind": "directory",
      "size": null,
      "children": [
        {"name":"App.swift","path":"Sources/App.swift","kind":"file","size":12,"children":[]}
      ]
    }
    """

    static let filePreviewJSON = """
    {
      "path": "Sources/App.swift",
      "name": "App.swift",
      "content": "print(1)",
      "language": "swift",
      "size": 8,
      "truncated": false,
      "nextOffset": 8
    }
    """

    static let workspaceFileJSON = """
    {"path":"Sources/App.swift","name":"App.swift","kind":"file","size":7}
    """

    static let workspaceUploadJSON = """
    {
      "kind": "file",
      "file": {
        "path": "Sources/Upload.swift",
        "name": "Upload.swift",
        "kind": "file",
        "size": 19
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
      "status": {
        "state": "ready",
        "detail": "Runtime is ready"
      },
      "capabilities": {},
      "managementSchema": {
        "hostConfigFiles": [],
        "toolboxItems": [],
        "hookCommandTemplates": [],
        "providerConfigFormat": "json",
        "mcpConfigFormat": "claude-json",
        "configArchives": true,
        "buildRestart": false
      },
      "installation": {
        "packageName": "@anthropic-ai/claude-code",
        "installed": true,
        "installedVersion": "1.0.0",
        "latestVersion": "1.1.0",
        "installCommand": "pnpm add claude",
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
      "supportedReasoningEfforts": [
        {"reasoningEffort": "medium", "description": "Balanced"}
      ],
      "defaultReasoningEffort": "medium"
    }]
    """

    static let threadListJSON = """
    [{
      "id": "t1",
      "workspaceId": "w1",
      "provider": "codex",
      "title": "Thread",
      "status": "running",
      "model": "gpt",
      "reasoningEffort": null,
      "fastMode": false,
      "collaborationMode": "default",
      "sandboxMode": null,
      "updatedAt": "now",
      "summaryText": null,
      "isLoaded": true
    }]
    """
}

private extension SupervisorHTTPRequest {
    func jsonBodyString(_ key: String) -> String? {
        jsonBody?[key] as? String
    }

    func jsonBodyBool(_ key: String) -> Bool? {
        jsonBody?[key] as? Bool
    }

    var jsonBody: [String: Any]? {
        guard let body else { return nil }
        return try? JSONSerialization.jsonObject(with: body) as? [String: Any]
    }
}
