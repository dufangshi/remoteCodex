@testable import RemoteCodex
import XCTest

final class JSONValueTests: XCTestCase {
    func testPreservesNestedUnknownJSON() throws {
        let data = Data("""
        {
          "type": "thread.custom",
          "payload": {
            "flag": true,
            "count": 2,
            "items": ["a", null, {"nested": "value"}]
          }
        }
        """.utf8)

        let decoded = try JSONDecoder().decode([String: JSONValue].self, from: data)

        XCTAssertEqual(decoded["type"], .string("thread.custom"))
        XCTAssertEqual(
            decoded["payload"],
            .object([
                "flag": .bool(true),
                "count": .number(2),
                "items": .array([
                    .string("a"),
                    .null,
                    .object(["nested": .string("value")])
                ])
            ])
        )
    }
}

final class ThreadDetailWebBootstrapTests: XCTestCase {
    func testJavaScriptAssignmentIncludesConnectionAndUITestFields() throws {
        let bootstrap = ThreadDetailWebBootstrap(
            baseUrl: "http://127.0.0.1:8811",
            mode: "relay",
            authToken: "relay-token",
            relayDeviceId: "device-1",
            threadId: "thread-1",
            theme: "dark",
            fixture: false,
            uiTestInitialSettings: ThreadDetailWebInitialSettings(
                model: "ios-e2e-stream",
                reasoningEffort: "high",
                fastMode: true,
                collaborationMode: "auto",
                sandboxMode: "workspace-write"
            ),
            uiTestAutoResolvePendingRequests: true,
            uiTestClickPendingRequestControls: true,
            uiTestClickVisibleSettingsControls: true,
            uiTestForkMode: "selected",
            uiTestAutoExportTranscript: true,
            uiTestAutoExportTranscriptFormat: "html",
            uiTestClickVisibleExportControls: true,
            uiTestFocusWorkspacePath: "Sources/Long.txt",
            uiTestAutoLoadMoreWorkspacePreview: true,
            uiTestAutoWorkspaceFileActions: true,
            uiTestClickVisibleWorkspaceControls: true,
            uiTestAutoLoadHistoryDetail: true,
            uiTestClickVisibleHistoryDetails: true,
            uiTestAutoLoadOlderHistory: true,
            uiTestAutoVerifyImageAsset: true,
            uiTestAutoVerifyTimelineContent: true,
            uiTestDisableRefreshFallback: true,
            uiTestAutoRenameTitle: "Renamed from test",
            uiTestAutoDeleteThread: true
        )

        let payload = try Self.payload(from: bootstrap.javaScriptAssignment())

        XCTAssertEqual(payload["baseUrl"] as? String, "http://127.0.0.1:8811")
        XCTAssertEqual(payload["mode"] as? String, "relay")
        XCTAssertEqual(payload["authToken"] as? String, "relay-token")
        XCTAssertEqual(payload["relayDeviceId"] as? String, "device-1")
        XCTAssertEqual(payload["threadId"] as? String, "thread-1")
        XCTAssertEqual(payload["theme"] as? String, "dark")
        XCTAssertEqual(payload["fixture"] as? Bool, false)
        XCTAssertEqual(payload["uiTestAutoResolvePendingRequests"] as? Bool, true)
        XCTAssertEqual(payload["uiTestClickPendingRequestControls"] as? Bool, true)
        XCTAssertEqual(payload["uiTestClickVisibleSettingsControls"] as? Bool, true)
        XCTAssertEqual(payload["uiTestForkMode"] as? String, "selected")
        XCTAssertEqual(payload["uiTestAutoExportTranscript"] as? Bool, true)
        XCTAssertEqual(payload["uiTestAutoExportTranscriptFormat"] as? String, "html")
        XCTAssertEqual(payload["uiTestClickVisibleExportControls"] as? Bool, true)
        XCTAssertEqual(payload["uiTestFocusWorkspacePath"] as? String, "Sources/Long.txt")
        XCTAssertEqual(payload["uiTestAutoLoadMoreWorkspacePreview"] as? Bool, true)
        XCTAssertEqual(payload["uiTestAutoWorkspaceFileActions"] as? Bool, true)
        XCTAssertEqual(payload["uiTestClickVisibleWorkspaceControls"] as? Bool, true)
        XCTAssertEqual(payload["uiTestAutoLoadHistoryDetail"] as? Bool, true)
        XCTAssertEqual(payload["uiTestClickVisibleHistoryDetails"] as? Bool, true)
        XCTAssertEqual(payload["uiTestAutoLoadOlderHistory"] as? Bool, true)
        XCTAssertEqual(payload["uiTestAutoVerifyImageAsset"] as? Bool, true)
        XCTAssertEqual(payload["uiTestAutoVerifyTimelineContent"] as? Bool, true)
        XCTAssertEqual(payload["uiTestDisableRefreshFallback"] as? Bool, true)
        XCTAssertEqual(payload["uiTestAutoRenameTitle"] as? String, "Renamed from test")
        XCTAssertEqual(payload["uiTestAutoDeleteThread"] as? Bool, true)

        let settings = try XCTUnwrap(payload["uiTestInitialSettings"] as? [String: Any])
        XCTAssertEqual(settings["model"] as? String, "ios-e2e-stream")
        XCTAssertEqual(settings["reasoningEffort"] as? String, "high")
        XCTAssertEqual(settings["fastMode"] as? Bool, true)
        XCTAssertEqual(settings["collaborationMode"] as? String, "auto")
        XCTAssertEqual(settings["sandboxMode"] as? String, "workspace-write")
    }

    func testJavaScriptAssignmentUsesJSONEscaping() throws {
        let bootstrap = ThreadDetailWebBootstrap(
            baseUrl: "https://example.test",
            mode: "server",
            authToken: "token \"quoted\"",
            relayDeviceId: nil,
            threadId: "thread </script>",
            theme: "system",
            fixture: false,
            uiTestInitialSettings: nil,
            uiTestAutoResolvePendingRequests: false,
            uiTestClickPendingRequestControls: false,
            uiTestClickVisibleSettingsControls: false,
            uiTestForkMode: nil,
            uiTestAutoExportTranscript: false,
            uiTestAutoExportTranscriptFormat: nil,
            uiTestClickVisibleExportControls: false,
            uiTestFocusWorkspacePath: nil,
            uiTestAutoLoadMoreWorkspacePreview: false,
            uiTestAutoWorkspaceFileActions: false,
            uiTestClickVisibleWorkspaceControls: false,
            uiTestAutoLoadHistoryDetail: false,
            uiTestClickVisibleHistoryDetails: false,
            uiTestAutoLoadOlderHistory: false,
            uiTestAutoVerifyImageAsset: false,
            uiTestAutoVerifyTimelineContent: false,
            uiTestDisableRefreshFallback: false,
            uiTestAutoRenameTitle: nil,
            uiTestAutoDeleteThread: false
        )

        let payload = try Self.payload(from: bootstrap.javaScriptAssignment())

        XCTAssertEqual(payload["authToken"] as? String, "token \"quoted\"")
        XCTAssertEqual(payload["threadId"] as? String, "thread </script>")
    }

    private static func payload(from script: String) throws -> [String: Any] {
        let prefix = "window.__REMOTE_CODEX_IOS_BOOTSTRAP__ = "
        XCTAssertTrue(script.hasPrefix(prefix))
        XCTAssertTrue(script.hasSuffix(";"))
        let start = script.index(script.startIndex, offsetBy: prefix.count)
        let end = script.index(before: script.endIndex)
        let json = String(script[start..<end])
        let data = try XCTUnwrap(json.data(using: .utf8))
        return try XCTUnwrap(
            JSONSerialization.jsonObject(with: data) as? [String: Any]
        )
    }
}

final class ThreadDetailWebBridgeTests: XCTestCase {
    func testDecodesNavigationAndOpenMessages() {
        let bridge = ThreadDetailWebBridge()

        let title = bridge.decodeBridgeMessage([
            "type": "setNavigationTitle",
            "title": "Thread From Web"
        ])
        XCTAssertEqual(title?.type, "setNavigationTitle")
        XCTAssertEqual(title?.title, "Thread From Web")

        let openThread = bridge.decodeBridgeMessage([
            "type": "openThread",
            "threadId": "thread-123"
        ])
        XCTAssertEqual(openThread?.type, "openThread")
        XCTAssertEqual(openThread?.threadId, "thread-123")

        let openWorkspace = bridge.decodeBridgeMessage([
            "type": "openWorkspace",
            "workspaceId": "workspace-123"
        ])
        XCTAssertEqual(openWorkspace?.type, "openWorkspace")
        XCTAssertEqual(openWorkspace?.workspaceId, "workspace-123")
    }

    func testDecodesShareDownloadedFileMessage() {
        let bridge = ThreadDetailWebBridge()
        let bytes = Data("iOS WebView export".utf8).base64EncodedString()

        let decoded = bridge.decodeBridgeMessage([
            "type": "shareDownloadedFile",
            "filename": "thread.html",
            "contentType": "text/html",
            "base64": bytes
        ])

        XCTAssertEqual(decoded?.type, "shareDownloadedFile")
        XCTAssertEqual(decoded?.filename, "thread.html")
        XCTAssertEqual(decoded?.contentType, "text/html")
        XCTAssertEqual(decoded?.base64, bytes)
    }

    func testDecodesPickAttachmentsMessage() {
        let bridge = ThreadDetailWebBridge()

        let decoded = bridge.decodeBridgeMessage([
            "type": "pickAttachments",
            "requestId": "ios-attachment-1",
            "kind": "file"
        ])

        XCTAssertEqual(decoded?.type, "pickAttachments")
        XCTAssertEqual(decoded?.requestId, "ios-attachment-1")
        XCTAssertEqual(decoded?.kind, "file")
    }

    func testDecodesReadyDebugOptimisticAndErrorMessages() {
        let bridge = ThreadDetailWebBridge()

        let ready = bridge.decodeBridgeMessage([
            "type": "threadWebReady",
            "title": "Ready Thread"
        ])
        XCTAssertEqual(ready?.type, "threadWebReady")
        XCTAssertEqual(ready?.title, "Ready Thread")

        let debug = bridge.decodeBridgeMessage([
            "type": "threadWebDebug",
            "message": "ws:thread.turn.completed:projected"
        ])
        XCTAssertEqual(debug?.type, "threadWebDebug")
        XCTAssertEqual(debug?.message, "ws:thread.turn.completed:projected")

        let optimistic = bridge.decodeBridgeMessage([
            "type": "threadWebOptimisticPrompt",
            "message": "ios optimistic prompt"
        ])
        XCTAssertEqual(optimistic?.type, "threadWebOptimisticPrompt")
        XCTAssertEqual(optimistic?.message, "ios optimistic prompt")

        let error = bridge.decodeBridgeMessage([
            "type": "reportFatalError",
            "message": "Thread WebView failed"
        ])
        XCTAssertEqual(error?.type, "reportFatalError")
        XCTAssertEqual(error?.message, "Thread WebView failed")
    }

    func testRejectsUnreadableBridgeMessages() {
        let bridge = ThreadDetailWebBridge()

        XCTAssertNil(bridge.decodeBridgeMessage("not-json-object"))
        XCTAssertNil(bridge.decodeBridgeMessage(["title": "Missing type"]))
        XCTAssertNil(bridge.decodeBridgeMessage(["type": 42]))
    }
}
