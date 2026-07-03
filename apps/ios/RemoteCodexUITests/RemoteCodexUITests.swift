import XCTest

final class RemoteCodexUITests: XCTestCase {
    @MainActor
    func testAppLaunches() {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Remote Codex"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Connect"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Next"].exists)
    }

    @MainActor
    func testWorkspaceDetailFixtureShowsFileActions() {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-workspace-fixture"]
        app.launch()

        XCTAssertTrue(app.navigationBars["Remote Codex"].waitForExistence(timeout: 5))
        let workspaceButton = app.buttons["workspace-open-w1"]
        XCTAssertTrue(workspaceButton.waitForExistence(timeout: 5))
        workspaceButton.tap()

        XCTAssertTrue(app.buttons["workspace-file-upload"].waitForExistence(timeout: 5))
        for _ in 0 ..< 4 where !app.buttons["workspace-file-copy-raw"].exists {
            app.swipeUp()
        }

        XCTAssertTrue(app.buttons["workspace-file-copy-raw"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["workspace-file-save"].exists)
        XCTAssertTrue(app.buttons["workspace-file-open"].exists)
        XCTAssertTrue(app.buttons["workspace-file-download"].exists)
    }

    @MainActor
    func testThreadWebViewFixtureLoadsSharedThreadUI() {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-ios-thread-webview-fixture"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: "iOS WebView migration fixture", timeout: 20)
    }

    @MainActor
    func testThreadWebViewFixtureShowsThreadManagementAndHidesUnavailableRuntimeActions() {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-ios-thread-webview-fixture"]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: "iOS WebView migration fixture", timeout: 20)

        let renameButton = app.buttons
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Rename thread"))
            .firstMatch
        let deleteButton = app.buttons
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Delete thread"))
            .firstMatch
        XCTAssertTrue(renameButton.waitForExistence(timeout: 10))
        XCTAssertTrue(deleteButton.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Stop Current Turn"].exists)
        XCTAssertFalse(app.buttons["Send Ctrl-C"].exists)
        XCTAssertFalse(app.buttons["Switch to shell"].exists)
        XCTAssertFalse(app.buttons["Open shell tools"].exists)
        XCTAssertFalse(app.buttons["Send Shell Input"].exists)
        XCTAssertFalse(app.buttons["Resume"].exists)
        XCTAssertFalse(app.buttons["Resume thread"].exists)

        let slashToolboxButton = app.buttons["Open slash toolbox"]
        XCTAssertTrue(slashToolboxButton.waitForExistence(timeout: 10))
        slashToolboxButton.tap()

        XCTAssertTrue(app.staticTexts["No backend tools are available for this thread."].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["/compact"].exists)
        XCTAssertFalse(app.buttons["/resume"].exists)
        XCTAssertFalse(app.buttons["PreCompact"].exists)
        XCTAssertFalse(app.buttons["PostCompact"].exists)
        XCTAssertFalse(app.buttons["/fork"].exists)
        XCTAssertFalse(app.buttons["Fork from latest"].exists)
        XCTAssertFalse(app.buttons["Fork from selected turn"].exists)
        XCTAssertFalse(app.buttons["Skills"].exists)
        XCTAssertFalse(app.buttons["MCP"].exists)
        XCTAssertFalse(app.buttons["Hooks"].exists)
    }

    @MainActor
    func testThreadWebViewFixtureRendersTimelineAndPendingRequestContent() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-ios-thread-webview-fixture",
            "--ui-test-ios-thread-webview-auto-verify-timeline",
        ]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 20))

        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(debug, containing: "timeline-fixture:ready", timeout: 20),
            debug.exists ? debug.label : "WebView did not report timeline fixture verification."
        )
        XCTAssertTrue(debug.label.contains("commandExecution"), debug.label)
        XCTAssertTrue(debug.label.contains("toolCall"), debug.label)
        XCTAssertTrue(debug.label.contains("pending=3"), debug.label)
        XCTAssertTrue(debug.label.contains("buttons=5"), debug.label)
    }

    @MainActor
    func testThreadWebViewFixtureOpensVisibleHistoryDetailKinds() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-ios-thread-webview-fixture",
            "--ui-test-ios-thread-webview-click-visible-history-details",
        ]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 20))

        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(
                debug,
                containing: "visible-history-details:tool=true:search=true:fileRead=true",
                timeout: 30
            ),
            debug.exists ? debug.label : "WebView did not open all visible history detail kinds."
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewLoadsRealThreadDetail() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Local E2E"
        )
        let thread = try await Self.createLiveThreadWithLocalFallback(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Live Local Thread"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewRenamesThreadThroughAdapter() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Rename E2E"
        )
        let thread = try await Self.createLiveThreadWithLocalFallback(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Rename Original"
        )

        let renamedTitle = "iOS WebView Renamed \(UUID().uuidString.prefix(8))"
        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_RENAME_TITLE"] = renamedTitle
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 30))

        let renameButton = app.buttons
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Rename thread"))
            .firstMatch
        XCTAssertTrue(scrollUntilExists(renameButton, in: app, maxSwipes: 6))

        try await Self.waitForLiveThreadTitle(
            baseURL: baseURL,
            threadId: thread.id,
            title: renamedTitle
        )
        assertThreadWebViewReady(app, title: renamedTitle, timeout: 20)
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(debug, containing: "thread-action:renamed:", timeout: 10),
            debug.exists ? debug.label : "WebView did not report a rename action."
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewDeletesThreadThroughAdapter() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Delete E2E"
        )
        let thread = try await Self.createLiveThreadWithLocalFallback(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Delete Target"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-auto-delete-thread",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        try await Self.waitForLiveThreadDeleted(baseURL: baseURL, threadId: thread.id)
        let screen = app.descendants(matching: .any)["thread-webview-screen"]
        let deadline = Date().addingTimeInterval(10)
        while Date() < deadline, screen.exists {
            try await Task.sleep(for: .milliseconds(200))
        }
        XCTAssertFalse(screen.exists)
    }

    @MainActor
    func testLiveLocalThreadWebViewRefreshesAfterExternalPrompt() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Refresh E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Refresh Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-auto-history-detail",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)

        let prompt = "iOS WebView refresh prompt \(UUID().uuidString)"
        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: prompt)
        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )

        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 45, maxSwipes: 12))
        XCTAssertTrue(scrollUntilElement(containing: prompt, in: app, timeout: 12, maxSwipes: 12))
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewRefreshesFromWebSocketEvent() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView WebSocket E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView WebSocket Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-auto-history-detail",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_HISTORY_DETAIL"] = "1"
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(debug.waitForExistence(timeout: 10))
        XCTAssertEqual(debug.label, "ws:open")

        let prompt = "iOS WebView websocket prompt \(UUID().uuidString)"
        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: prompt)
        XCTAssertTrue(
            waitForStaticText(debug, labelBeginsWith: "ws:thread.", timeout: 10),
            debug.exists ? debug.label : "No WebView WebSocket thread event was observed."
        )

        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )
        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 20, maxSwipes: 12))
        XCTAssertTrue(scrollUntilElement(containing: prompt, in: app, timeout: 12, maxSwipes: 12))
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewProjectsWebSocketEventsWithoutRefreshFallback() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView WS Projection E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView WS Projection Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-disable-refresh-fallback",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WEBVIEW_DISABLE_REFRESH_FALLBACK"] = "1"
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(debug.waitForExistence(timeout: 10))
        XCTAssertEqual(debug.label, "ws:open")

        let prompt = "iOS WebView websocket projection prompt \(UUID().uuidString)"
        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: prompt)
        XCTAssertTrue(
            waitForElement(debug, containing: "ws:thread.turn.completed:projected", timeout: 30),
            debug.exists ? debug.label : "WebView did not project the completed WebSocket turn."
        )
        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 12, maxSwipes: 12))
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewReconnectsAfterBackgroundForeground() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Lifecycle E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Lifecycle Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)

        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(debug.waitForExistence(timeout: 10))
        XCTAssertEqual(debug.label, "ws:open")

        XCUIDevice.shared.press(.home)
        try await Task.sleep(nanoseconds: 2_000_000_000)
        app.activate()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        let observedReconnect = waitForStaticText(
            debug,
            labelBeginsWith: "scene:lifecycle:inactive=1:active=2:wsOpen=2",
            timeout: 5
        )
        if observedReconnect {
            XCTAssertTrue(waitForElement(debug, containing: "wsClose=1", timeout: 5), debug.label)
        } else {
            XCTAssertEqual(debug.label, "ws:open")
        }

        let prompt = "iOS WebView lifecycle prompt \(UUID().uuidString)"
        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: prompt)
        XCTAssertTrue(
            waitForStaticText(debug, labelBeginsWith: "ws:thread.", timeout: 10),
            debug.exists ? debug.label : "No WebView WebSocket thread event was observed after foregrounding."
        )

        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )
        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 20, maxSwipes: 12))
        XCTAssertTrue(scrollUntilElement(containing: prompt, in: app, timeout: 12, maxSwipes: 12))
        XCTAssertFalse(Self.element(containing: "IOS_STREAM_COMPLETEDIOS_STREAM_COMPLETED", in: app).exists)
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewLoadsDeferredHistoryDetail() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView History Detail E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView History Detail Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: "IOS_HISTORY_DETAIL")
        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_HISTORY_DETAIL_SUMMARY"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-auto-history-detail",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_HISTORY_DETAIL"] = "1"
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(debug, containing: "history-detail:", timeout: 20),
            debug.exists ? debug.label : "WebView did not attempt to load deferred history detail."
        )
        XCTAssertTrue(
            waitForElement(debug, containing: "Command Output:true", timeout: 20),
            debug.exists ? debug.label : "WebView deferred history detail did not include the full command output."
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewTapsVisibleHistoryDetailButton() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Visible History Detail E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Visible History Detail Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: "IOS_HISTORY_DETAIL")
        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_HISTORY_DETAIL_SUMMARY"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        XCTAssertTrue(
            tapWebElement(label: "Expand command history item", in: app, timeout: 20),
            "Could not tap the visible command history accordion trigger."
        )
        XCTAssertTrue(
            tapWebElement(label: "Open full command", in: app, timeout: 20),
            "Could not tap the visible command history detail button."
        )
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(debug, containing: "history-detail-selected:", timeout: 20),
            debug.exists ? debug.label : "WebView did not select the visible history detail."
        )
        XCTAssertTrue(
            waitForElement(debug, containing: "Command Output:true", timeout: 20),
            debug.exists ? debug.label : "Visible history detail tap did not load the full command output."
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewComposerSubmitsPromptAndRefreshesCompletion() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Composer E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Composer Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)

        let prompt = "iOS WebView composer prompt \(UUID().uuidString)"
        XCTAssertTrue(typeIntoWebPrompt(prompt, in: app))
        let sendButton = webElement("Send Prompt", in: app).firstMatch
        if sendButton.waitForExistence(timeout: 3) {
            sendButton.tap()
        } else {
            tapWebComposerSend(in: app)
        }

        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: prompt
        )
        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )

        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 45, maxSwipes: 12))
        XCTAssertTrue(scrollUntilElement(containing: prompt, in: app, timeout: 12, maxSwipes: 12))
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewComposerSubmitsRealClaudeHaikuPrompt() async throws {
        try await runLiveLocalRealBackendComposerSmoke(
            provider: "claude",
            model: "haiku",
            label: "Claude Haiku",
            markerPrefix: "IOS_CLAUDE_HAIKU_WEBVIEW_PROMPT_OK"
        )
    }

    @MainActor
    func testLiveLocalThreadWebViewComposerSubmitsRealOpenCodePrompt() async throws {
        try await runLiveLocalRealBackendComposerSmoke(
            provider: "opencode",
            model: "opencode/mimo-v2.5-free",
            label: "OpenCode MiMo",
            markerPrefix: "IOS_OPENCODE_WEBVIEW_PROMPT_OK"
        )
    }

    @MainActor
    func testLiveLocalThreadWebViewOptimisticallyRendersSubmittedPrompt() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Optimistic Prompt E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Optimistic Prompt Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)

        let prompt = "iOS WebView optimistic prompt \(UUID().uuidString)"
        XCTAssertTrue(typeIntoWebPrompt(prompt, in: app))
        let sendButton = webElement("Send Prompt", in: app).firstMatch
        if sendButton.waitForExistence(timeout: 3) {
            sendButton.tap()
        } else {
            tapWebComposerSend(in: app)
        }

        let optimisticMarker = app.staticTexts["thread-webview-optimistic-prompt"]
        XCTAssertTrue(
            waitForElement(optimisticMarker, containing: "optimistic-prompt:", timeout: 8),
            optimisticMarker.exists ? optimisticMarker.label : "WebView did not report an optimistic prompt."
        )
        XCTAssertTrue(
            waitForElement(optimisticMarker, containing: prompt, timeout: 2),
            optimisticMarker.exists ? optimisticMarker.label : "Optimistic prompt marker did not include the submitted prompt."
        )
        XCTAssertTrue(
            scrollUntilElement(containing: prompt, in: app, timeout: 5, maxSwipes: 4),
            "Submitted prompt was not rendered optimistically in the WebView."
        )

        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )
        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 45, maxSwipes: 12))
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    private func runLiveLocalRealBackendComposerSmoke(
        provider: String,
        model: String,
        label: String,
        markerPrefix: String
    ) async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS \(label) WebView Prompt E2E"
        )
        let marker = "\(markerPrefix)_\(UUID().uuidString.prefix(8))"
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS \(label) WebView Prompt Thread",
            provider: provider,
            model: model
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)

        let prompt = "Reply with exactly: \(marker)"
        XCTAssertTrue(typeIntoWebPrompt(prompt, in: app))
        let sendButton = webElement("Send Prompt", in: app).firstMatch
        if sendButton.waitForExistence(timeout: 3) {
            sendButton.tap()
        } else {
            tapWebComposerSend(in: app)
        }

        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: prompt
        )
        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: marker,
            timeout: 90
        )

        XCTAssertTrue(scrollUntilElement(containing: marker, in: app, timeout: 30, maxSwipes: 12))
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewLoadsOlderHistory() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Older History E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Older History Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: "IOS_HISTORY_PAGE_45")
        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_HISTORY_PAGE_TURN_45"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-auto-load-older-history",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(debug, containing: "history-page:loaded:40:45", timeout: 20),
            debug.exists ? debug.label : "WebView did not report loading an older history page."
        )
        XCTAssertTrue(
            scrollUntilElement(containing: "IOS_HISTORY_PAGE_TURN_6", in: app, timeout: 20, maxSwipes: 6),
            "The older history page did not render the newly loaded turn."
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewReasoningSettingSubmitsPrompt() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Reasoning E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Reasoning Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-reasoning-high",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WEBVIEW_REASONING"] = "high"
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        XCTAssertTrue(app.staticTexts["thread-webview-swift-settings"].waitForExistence(timeout: 5))
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(debug.waitForExistence(timeout: 10))
        XCTAssertEqual(debug.label, "uiTestInitialSettings:applying")

        try await Self.waitForLiveThreadSetting(
            baseURL: baseURL,
            threadId: thread.id,
            key: "reasoningEffort",
            value: "high"
        )

        let prompt = "iOS WebView reasoning prompt \(UUID().uuidString)"
        XCTAssertTrue(typeIntoWebPrompt(prompt, in: app))
        let sendButton = webElement("Send Prompt", in: app).firstMatch
        if sendButton.waitForExistence(timeout: 3) {
            sendButton.tap()
        } else {
            tapWebComposerSend(in: app)
        }

        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )
        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 45, maxSwipes: 12))
        XCTAssertTrue(scrollUntilElement(containing: prompt, in: app, timeout: 12, maxSwipes: 12))
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewVisibleSettingsControlsSubmitPrompt() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Visible Settings E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Visible Settings Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-click-visible-settings",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForStaticText(
                debug,
                labelBeginsWith: "visible-settings:updated:ios-e2e-alt:high:plan:danger-full-access",
                timeout: 20
            ),
            debug.exists ? debug.label : "Visible WebView settings controls did not update thread settings."
        )

        try await Self.waitForLiveThreadSetting(
            baseURL: baseURL,
            threadId: thread.id,
            key: "model",
            value: "ios-e2e-alt"
        )
        try await Self.waitForLiveThreadSetting(
            baseURL: baseURL,
            threadId: thread.id,
            key: "reasoningEffort",
            value: "high"
        )
        try await Self.waitForLiveThreadSetting(
            baseURL: baseURL,
            threadId: thread.id,
            key: "collaborationMode",
            value: "plan"
        )
        try await Self.waitForLiveThreadSetting(
            baseURL: baseURL,
            threadId: thread.id,
            key: "sandboxMode",
            value: "danger-full-access"
        )

        let prompt = "iOS WebView visible settings prompt \(UUID().uuidString)"
        XCTAssertTrue(typeIntoWebPrompt(prompt, in: app))
        let sendButton = webElement("Send Prompt", in: app).firstMatch
        if sendButton.waitForExistence(timeout: 3) {
            sendButton.tap()
        } else {
            tapWebComposerSend(in: app)
        }

        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )
        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 45, maxSwipes: 12))
        XCTAssertTrue(scrollUntilElement(containing: prompt, in: app, timeout: 12, maxSwipes: 12))
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewForksLatestThroughVisibleControls() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Fork Latest E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Fork Latest Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: "IOS_FORK_LATEST_TURN_ONE")
        try await Self.waitForLiveThreadText(baseURL: baseURL, threadId: thread.id, text: "IOS_STREAM_COMPLETED")
        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: "IOS_FORK_LATEST_TURN_TWO")
        try await Self.waitForLiveTurnCount(baseURL: baseURL, threadId: thread.id, count: 2)

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-fork-latest",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        let ready = app.staticTexts["thread-webview-ready"]
        XCTAssertTrue(waitForElement(ready, containing: thread.title, timeout: 30))
        XCTAssertTrue(waitForElement(ready, containing: "\(thread.title) / fork", timeout: 30))
        try await Self.waitForLiveForkActivityNote(
            baseURL: baseURL,
            threadId: thread.id,
            turnIndex: 2
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewForksSelectedTurnThroughVisibleControls() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Fork Selected E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Fork Selected Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: "IOS_FORK_SELECTED_TURN_ONE")
        try await Self.waitForLiveThreadText(baseURL: baseURL, threadId: thread.id, text: "IOS_STREAM_COMPLETED")
        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: "IOS_FORK_SELECTED_TURN_TWO")
        try await Self.waitForLiveTurnCount(baseURL: baseURL, threadId: thread.id, count: 2)

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-fork-selected",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        let ready = app.staticTexts["thread-webview-ready"]
        XCTAssertTrue(waitForElement(ready, containing: thread.title, timeout: 30))
        XCTAssertTrue(waitForElement(ready, containing: "\(thread.title) / fork", timeout: 30))
        try await Self.waitForLiveForkActivityNote(
            baseURL: baseURL,
            threadId: thread.id,
            turnIndex: 1
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalHomeWorkspaceAndWebThreadRoute() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS Live Local E2E"
        )
        let thread = try await Self.createLiveThreadWithLocalFallback(baseURL: baseURL, workspaceId: workspace.id)

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launch()

        let workspaceButton = app.buttons["workspace-open-\(workspace.id)"]
        XCTAssertTrue(scrollUntilExists(workspaceButton, in: app))
        workspaceButton.tap()
        let threadButton = app.buttons["thread-open-\(thread.id)"]
        XCTAssertTrue(scrollUntilExists(threadButton, in: app))
        threadButton.tap()
        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalCreatesClaudeHaikuThreadFromWorkspacePicker() async throws {
        try await runLiveLocalWorkspacePickerCreateThread(
            providerButtonId: "new-thread-provider-claude",
            modelButtonId: "new-thread-model-haiku",
            expectedProvider: "claude",
            expectedModel: "haiku",
            titlePrefix: "iOS Claude Haiku Picker"
        )
    }

    @MainActor
    func testLiveLocalCreatesOpenCodeThreadFromWorkspacePicker() async throws {
        try await runLiveLocalWorkspacePickerCreateThread(
            providerButtonId: "new-thread-provider-opencode",
            modelButtonId: nil,
            expectedProvider: "opencode",
            expectedModel: "opencode/mimo-v2.5-free",
            titlePrefix: "iOS OpenCode Picker"
        )
    }

    @MainActor
    func testLiveLocalWorkspaceFilesRoundTripTreePreviewDownloadUpload() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        try Self.writeLiveWorkspaceFileFixture(rootPath: workspacePath)
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS Workspace Files E2E"
        )
        try await Self.assertLiveWorkspaceFilesRoundTrip(baseURL: baseURL, workspaceId: workspace.id)

        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-live-local-connection"]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WORKSPACE_ID"] = workspace.id
        app.launch()

        XCTAssertTrue(app.staticTexts["iOS Workspace Files E2E"].waitForExistence(timeout: 8))
        let fileRow = app.descendants(matching: .any)["workspace-file-row-Sources-Long-txt"]
        XCTAssertTrue(tapElement(fileRow, in: app, maxSwipes: 10))
        let loadMore = app.buttons["workspace-file-load-more"]
        XCTAssertTrue(tapElement(loadMore, in: app, maxSwipes: 10))
        let copyRaw = app.buttons["workspace-file-copy-raw"]
        XCTAssertTrue(tapElement(copyRaw, in: app, maxSwipes: 4))
        XCTAssertTrue(waitForElement(app.staticTexts["workspace-file-message"], containing: "Copied Sources/Long.txt raw text"))
        XCTAssertTrue(tapElement(app.buttons["workspace-file-download"], in: app, maxSwipes: 4))
        XCTAssertTrue(waitForElement(app.staticTexts["workspace-file-message"], containing: "Downloaded"))
    }

    @MainActor
    func testLiveLocalThreadWebViewLoadsWorkspaceTreeAndFilePreview() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        try Self.writeLiveWorkspaceFileFixture(rootPath: workspacePath)
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Workspace E2E"
        )
        let thread = try await Self.createLiveThreadWithLocalFallback(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Workspace Thread"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-auto-load-more-workspace-preview",
            "--ui-test-ios-thread-webview-auto-workspace-file-actions",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WEBVIEW_WORKSPACE_FOCUS_PATH"] = "Sources/Long.txt"
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(debug, containing: "tree:Sources:", timeout: 20),
            debug.exists ? debug.label : "WebView workspace tree did not load the Sources directory."
        )
        XCTAssertTrue(
            waitForElement(debug, containing: "Long.txt", timeout: 20),
            debug.exists ? debug.label : "WebView workspace tree did not include Sources/Long.txt."
        )
        XCTAssertTrue(
            waitForElement(
                debug,
                containing: "preview:Sources/Long.txt:offset=0:limit=24000:truncated=true:line0=true:line500=false",
                timeout: 20
            ),
            debug.exists ? debug.label : "WebView workspace preview did not read Sources/Long.txt."
        )
        XCTAssertTrue(
            waitForElement(
                debug,
                containing: "preview:Sources/Long.txt:offset=24000:limit=24000:truncated=true:line0=false:line500=true",
                timeout: 20
            ),
            debug.exists ? debug.label : "WebView workspace preview did not load the next Sources/Long.txt chunk."
        )
        XCTAssertTrue(
            waitForElement(
                debug,
                containing: "write-preview:Sources/ios-webview-write.txt:true",
                timeout: 20
            ),
            debug.exists ? debug.label : "WebView workspace write adapter did not save and reread the file."
        )
        XCTAssertTrue(
            waitForElement(
                debug,
                containing: "upload-preview:Sources/ios-webview-upload.txt:true",
                timeout: 20
            ),
            debug.exists ? debug.label : "WebView workspace upload adapter did not upload and reread the file."
        )
        XCTAssertTrue(
            waitForElement(debug, containing: "download:Sources/Long.txt:Long.txt", timeout: 20),
            debug.exists ? debug.label : "WebView workspace download adapter did not hand off the file."
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewClicksVisibleWorkspaceFileControls() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        try Self.writeLiveWorkspaceFileFixture(rootPath: workspacePath)
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Workspace Controls E2E"
        )
        let thread = try await Self.createLiveThreadWithLocalFallback(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Workspace Controls Thread"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-click-visible-workspace-controls",
            "--ui-test-ios-thread-webview-auto-attachment-picker",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WEBVIEW_WORKSPACE_FOCUS_PATH"] = "Sources/Editable.txt"
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        let ready = app.staticTexts["thread-webview-ready"]
        XCTAssertTrue(waitForElement(ready, containing: thread.title, timeout: 30))
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(
                debug,
                containing: "visible-controls:raw=true:write=true:download=true:upload=true:input=native-picker",
                timeout: 45
            ),
            debug.exists ? debug.label : "WebView did not finish visible workspace controls."
        )
        XCTAssertTrue(app.buttons["thread-webview-share-export"].waitForExistence(timeout: 20))
        XCTAssertTrue(
            waitForElement(
                app.buttons["thread-webview-share-export"],
                containing: "Editable.txt",
                timeout: 5
            )
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalStreamingPromptRendersDeltaAndCompletion() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS Live Streaming E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS Live Streaming Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )
        let prompt = "iOS optimistic streaming prompt \(UUID().uuidString)"

        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-live-local-connection"]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launch()

        let workspaceButton = app.buttons["workspace-open-\(workspace.id)"]
        XCTAssertTrue(scrollUntilExists(workspaceButton, in: app))
        let threadButton = app.buttons["thread-open-\(thread.id)"]
        XCTAssertTrue(scrollUntilExists(threadButton, in: app))
        threadButton.tap()
        assertThreadWebViewReady(app, title: thread.title, timeout: 20)

        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: prompt)

        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_DELTA_READY", in: app))
        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )
        app.buttons["Actions"].tap()
        app.buttons["Refresh"].tap()
        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 30))
        XCTAssertTrue(scrollUntilElement(containing: prompt, in: app))
    }

    @MainActor
    func testLiveLocalPendingRequestsSubmitApprovalQuestionAndPlanDecision() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS Pending Request E2E"
        )
        let approvalThread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS Approval Request Thread",
            provider: "claude",
            model: "ios-e2e-stream",
            approvalMode: "guarded"
        )
        let questionThread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS Question Request Thread",
            provider: "claude",
            model: "ios-e2e-stream",
            approvalMode: "guarded"
        )
        let planThread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS Plan Decision Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        try await Self.completeLiveApprovalRequest(baseURL: baseURL, thread: approvalThread)
        try await Self.completeLiveQuestionRequest(baseURL: baseURL, thread: questionThread)
        try await Self.completeLivePlanDecision(baseURL: baseURL, thread: planThread)
    }

    @MainActor
    func testLiveServerConnectionAuthenticatesLoadsAndRestoresThread() async throws {
        let baseURL = try await Self.liveServerBaseURL()
        let credentials = Self.liveServerCredentials()
        try await Self.assertWorkspacesRequireAuth(baseURL: baseURL)
        let token = try await Self.loginServer(baseURL: baseURL, credentials: credentials)
        try await Self.assertAuthenticatedSession(baseURL: baseURL, token: token, username: credentials.username)

        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS Live Server E2E",
            bearerToken: token
        )
        let thread = try await Self.createLiveThread(baseURL: baseURL, workspaceId: workspace.id, bearerToken: token)

        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-live-server-connection"]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_SERVER_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_AUTH_TOKEN"] = token
        app.launch()

        let workspaceButton = app.buttons["workspace-open-\(workspace.id)"]
        XCTAssertTrue(scrollUntilExists(workspaceButton, in: app))
        let threadButton = app.buttons["thread-open-\(thread.id)"]
        XCTAssertTrue(scrollUntilExists(threadButton, in: app))
        threadButton.tap()
        assertThreadWebViewReady(app, title: thread.title, timeout: 20)

        app.terminate()
        app.launchArguments = []
        app.launchEnvironment = [:]
        app.launch()
        assertThreadWebViewReady(app, title: thread.title, timeout: 20)
    }

    @MainActor
    func testLiveServerThreadWebViewLoadsAuthenticatedThreadDetail() async throws {
        let baseURL = try await Self.liveServerBaseURL()
        let credentials = Self.liveServerCredentials()
        try await Self.assertWorkspacesRequireAuth(baseURL: baseURL)
        let token = try await Self.loginServer(baseURL: baseURL, credentials: credentials)
        try await Self.assertAuthenticatedSession(baseURL: baseURL, token: token, username: credentials.username)

        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Server E2E",
            bearerToken: token
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            bearerToken: token,
            title: "iOS WebView Server Thread"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-server-connection",
            "--use-ios-thread-webview",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_SERVER_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_AUTH_TOKEN"] = token
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveServerThreadWebViewLoadsAuthenticatedImageAsset() async throws {
        let baseURL = try await Self.liveServerBaseURL()
        let credentials = Self.liveServerCredentials()
        try await Self.assertWorkspacesRequireAuth(baseURL: baseURL)
        let token = try await Self.loginServer(baseURL: baseURL, credentials: credentials)
        try await Self.assertAuthenticatedSession(baseURL: baseURL, token: token, username: credentials.username)
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL, bearerToken: token)

        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Image Asset E2E",
            bearerToken: token
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            bearerToken: token,
            title: "iOS WebView Image Asset Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        try await Self.sendLivePrompt(
            baseURL: baseURL,
            threadId: thread.id,
            prompt: "IOS_IMAGE_ASSET",
            bearerToken: token
        )
        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_IMAGE_ASSET_READY",
            bearerToken: token
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-server-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-auto-image-asset",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_SERVER_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_AUTH_TOKEN"] = token
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_IMAGE_ASSET"] = "1"
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(debug, containing: "image-asset:loaded:true", timeout: 30),
            debug.exists ? debug.label : "WebView did not report an authenticated image asset load."
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveRelayConnectionLoadsForwardedRestAndWebSocket() async throws {
        let baseURL = try await Self.liveRelayBaseURL()
        let registration = try Self.liveRelayRegistration()
        try await Self.waitForRelayDeviceOnline(baseURL: baseURL, registration: registration)

        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveRelayWorkspace(
            baseURL: baseURL,
            registration: registration,
            path: workspacePath,
            label: "iOS Live Relay E2E"
        )
        let thread = try await Self.createLiveRelayThread(
            baseURL: baseURL,
            registration: registration,
            workspaceId: workspace.id
        )

        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-live-relay-connection"]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_TOKEN"] = registration.relayToken
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_DEVICE_ID"] = registration.deviceId
        app.launch()

        let workspaceButton = app.buttons["workspace-open-\(workspace.id)"]
        XCTAssertTrue(scrollUntilExists(workspaceButton, in: app))
        let threadButton = app.buttons["thread-open-\(thread.id)"]
        XCTAssertTrue(scrollUntilExists(threadButton, in: app))
        threadButton.tap()
        assertThreadWebViewReady(app, title: thread.title, timeout: 20)
    }

    @MainActor
    func testLiveRelayThreadWebViewLoadsForwardedThreadDetail() async throws {
        let baseURL = try await Self.liveRelayBaseURL()
        let registration = try Self.liveRelayRegistration()
        try await Self.waitForRelayDeviceOnline(baseURL: baseURL, registration: registration)

        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveRelayWorkspace(
            baseURL: baseURL,
            registration: registration,
            path: workspacePath,
            label: "iOS WebView Relay E2E"
        )
        let thread = try await Self.createLiveRelayThread(
            baseURL: baseURL,
            registration: registration,
            workspaceId: workspace.id
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-relay-connection",
            "--use-ios-thread-webview",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_TOKEN"] = registration.relayToken
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_DEVICE_ID"] = registration.deviceId
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveRelayThreadWebViewSubmitsPromptThroughComposer() async throws {
        let baseURL = try await Self.liveRelayBaseURL()
        let registration = try Self.liveRelayRegistration()
        try await Self.waitForRelayDeviceOnline(baseURL: baseURL, registration: registration)
        try await Self.requireLiveRelayE2EFakeRuntime(baseURL: baseURL, registration: registration)

        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveRelayWorkspace(
            baseURL: baseURL,
            registration: registration,
            path: workspacePath,
            label: "iOS WebView Relay Composer E2E"
        )
        let thread = try await Self.createLiveRelayThread(
            baseURL: baseURL,
            registration: registration,
            workspaceId: workspace.id,
            title: "iOS WebView Relay Composer Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-relay-connection",
            "--use-ios-thread-webview",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_TOKEN"] = registration.relayToken
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_DEVICE_ID"] = registration.deviceId
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)

        let prompt = "iOS WebView relay composer prompt \(UUID().uuidString)"
        XCTAssertTrue(typeIntoWebPrompt(prompt, in: app))
        let sendButton = webElement("Send Prompt", in: app).firstMatch
        if sendButton.waitForExistence(timeout: 3) {
            sendButton.tap()
        } else {
            tapWebComposerSend(in: app)
        }

        try await Self.waitForLiveRelayThreadText(
            baseURL: baseURL,
            registration: registration,
            threadId: thread.id,
            text: prompt
        )
        try await Self.waitForLiveRelayThreadText(
            baseURL: baseURL,
            registration: registration,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )

        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 45, maxSwipes: 12))
        XCTAssertTrue(scrollUntilElement(containing: prompt, in: app, timeout: 12, maxSwipes: 12))
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveRelayThreadWebViewProjectsWebSocketEventsWithoutRefreshFallback() async throws {
        let baseURL = try await Self.liveRelayBaseURL()
        let registration = try Self.liveRelayRegistration()
        try await Self.waitForRelayDeviceOnline(baseURL: baseURL, registration: registration)
        try await Self.requireLiveRelayE2EFakeRuntime(baseURL: baseURL, registration: registration)

        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveRelayWorkspace(
            baseURL: baseURL,
            registration: registration,
            path: workspacePath,
            label: "iOS WebView Relay WS Projection E2E"
        )
        let thread = try await Self.createLiveRelayThread(
            baseURL: baseURL,
            registration: registration,
            workspaceId: workspace.id,
            title: "iOS WebView Relay WS Projection Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-relay-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-disable-refresh-fallback",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_TOKEN"] = registration.relayToken
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_DEVICE_ID"] = registration.deviceId
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WEBVIEW_DISABLE_REFRESH_FALLBACK"] = "1"
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(debug.waitForExistence(timeout: 10))
        XCTAssertEqual(debug.label, "ws:open")

        let prompt = "iOS WebView relay websocket projection prompt \(UUID().uuidString)"
        try await Self.sendLiveRelayPrompt(
            baseURL: baseURL,
            registration: registration,
            threadId: thread.id,
            prompt: prompt
        )
        XCTAssertTrue(
            waitForElement(debug, containing: "ws:thread.turn.completed:projected", timeout: 35),
            debug.exists ? debug.label : "Relay WebView did not project the completed WebSocket turn."
        )
        XCTAssertTrue(scrollUntilElement(containing: "IOS_STREAM_COMPLETED", in: app, timeout: 12, maxSwipes: 12))
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveRelayThreadWebViewLoadsForwardedImageAsset() async throws {
        let baseURL = try await Self.liveRelayBaseURL()
        let registration = try Self.liveRelayRegistration()
        try await Self.waitForRelayDeviceOnline(baseURL: baseURL, registration: registration)
        try await Self.requireLiveRelayE2EFakeRuntime(baseURL: baseURL, registration: registration)

        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveRelayWorkspace(
            baseURL: baseURL,
            registration: registration,
            path: workspacePath,
            label: "iOS WebView Relay Image Asset E2E"
        )
        let thread = try await Self.createLiveRelayThread(
            baseURL: baseURL,
            registration: registration,
            workspaceId: workspace.id,
            title: "iOS WebView Relay Image Asset Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        try await Self.sendLiveRelayPrompt(
            baseURL: baseURL,
            registration: registration,
            threadId: thread.id,
            prompt: "IOS_IMAGE_ASSET"
        )
        try await Self.waitForLiveRelayThreadText(
            baseURL: baseURL,
            registration: registration,
            threadId: thread.id,
            text: "IOS_IMAGE_ASSET_READY"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-relay-connection",
            "--ui-test-ios-thread-webview-auto-image-asset",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_TOKEN"] = registration.relayToken
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_RELAY_DEVICE_ID"] = registration.deviceId
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_IMAGE_ASSET"] = "1"
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(debug, containing: "image-asset:loaded:true", timeout: 30),
            debug.exists ? debug.label : "WebView did not report a relay-authenticated image asset load."
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func scrollUntilExists(_ element: XCUIElement, in app: XCUIApplication, maxSwipes: Int = 8) -> Bool {
        if element.waitForExistence(timeout: 3) {
            return true
        }
        for _ in 0 ..< maxSwipes {
            app.swipeUp()
            if element.waitForExistence(timeout: 1) {
                return true
            }
        }
        return false
    }

    @MainActor
    func tapElement(_ element: XCUIElement, in app: XCUIApplication, maxSwipes: Int = 8) -> Bool {
        for attempt in 0 ... maxSwipes {
            if element.waitForExistence(timeout: attempt == 0 ? 3 : 1) {
                if element.isHittable {
                    element.tap()
                    return true
                }
                if elementIsVisible(element, in: app) {
                    element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                    return true
                }
            }
            if attempt < maxSwipes {
                app.swipeUp()
            }
        }
        return false
    }

    @MainActor
    private func elementIsVisible(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
        guard element.exists, !element.frame.isEmpty else {
            return false
        }
        guard element.frame.origin.x.isFinite,
              element.frame.origin.y.isFinite,
              element.frame.size.width.isFinite,
              element.frame.size.height.isFinite
        else {
            return false
        }
        let viewport = app.windows.firstMatch.exists ? app.windows.firstMatch.frame : app.frame
        return viewport.insetBy(dx: 0, dy: 24).intersects(element.frame)
    }

    @MainActor
    func waitForElement(
        _ element: XCUIElement,
        containing text: String,
        timeout: TimeInterval = 8
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.exists, element.label.contains(text) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return false
    }

    @MainActor
    func assertThreadWebViewReady(
        _ app: XCUIApplication,
        title: String,
        timeout: TimeInterval = 30,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertTrue(
            app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: timeout),
            "Thread WebView screen did not appear.",
            file: file,
            line: line
        )
        XCTAssertTrue(
            app.webViews.firstMatch.waitForExistence(timeout: timeout),
            "Thread WebView did not appear.",
            file: file,
            line: line
        )
        let ready = app.staticTexts["thread-webview-ready"]
        XCTAssertTrue(
            waitForElement(ready, containing: title, timeout: timeout),
            ready.exists ? ready.label : "Thread WebView did not report ready for \(title).",
            file: file,
            line: line
        )
        XCTAssertTrue(
            app.buttons["thread-webview-menu"].waitForExistence(timeout: 5),
            "Thread WebView floating menu did not appear.",
            file: file,
            line: line
        )
    }

    @MainActor
    func waitForStaticText(
        _ element: XCUIElement,
        labelBeginsWith prefix: String,
        timeout: TimeInterval = 8
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.exists, element.label.hasPrefix(prefix) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        return false
    }

    @MainActor
    func scrollUntilElement(
        containing text: String,
        in app: XCUIApplication,
        timeout: TimeInterval = 8,
        maxSwipes: Int = 8
    ) -> Bool {
        let element = Self.element(containing: text, in: app)
        if element.waitForExistence(timeout: 1) {
            return true
        }
        for _ in 0 ..< maxSwipes {
            app.swipeUp()
            if element.waitForExistence(timeout: timeout / TimeInterval(maxSwipes)) {
                return true
            }
        }
        for _ in 0 ..< maxSwipes {
            app.swipeDown()
            if element.waitForExistence(timeout: timeout / TimeInterval(maxSwipes)) {
                return true
            }
        }
        return false
    }

    @MainActor
    static func element(containing text: String, in app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)
            .containing(NSPredicate(format: "label CONTAINS %@", text))
            .firstMatch
    }

    @MainActor
    private func typeIntoWebPrompt(_ prompt: String, in app: XCUIApplication) -> Bool {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: 10) else {
            return false
        }

        var editor = webElement("Prompt", in: app).firstMatch
        if !editor.waitForExistence(timeout: 3) {
            let showChat = webElement("Show chat", in: app).firstMatch
            if showChat.waitForExistence(timeout: 2) {
                showChat.tap()
            } else {
                let chat = webElement("Chat", in: app).firstMatch
                if chat.waitForExistence(timeout: 2) {
                    chat.tap()
                }
            }
            editor = webElement("Prompt", in: app).firstMatch
        }
        if !editor.waitForExistence(timeout: 3) {
            let chat = webElement("Chat", in: app).firstMatch
            if chat.waitForExistence(timeout: 2) {
                chat.tap()
            }
            editor = webElement("Prompt", in: app).firstMatch
        }
        if editor.waitForExistence(timeout: 5) {
            if editor.isHittable {
                editor.tap()
            } else {
                editor.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            }
            editor.typeText(prompt)
        } else {
            webView.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.90)).tap()
            app.typeText(prompt)
        }
        return true
    }

    @MainActor
    private func webElement(_ identifier: String, in app: XCUIApplication) -> XCUIElementQuery {
        let webView = app.webViews.firstMatch
        return webView.descendants(matching: .any).matching(identifier: identifier)
    }

    @MainActor
    private func tapWebElement(
        label: String,
        in app: XCUIApplication,
        timeout: TimeInterval = 8,
        maxSwipes: Int = 6
    ) -> Bool {
        let webView = app.webViews.firstMatch
        guard webView.waitForExistence(timeout: timeout) else {
            return false
        }
        let deadline = Date().addingTimeInterval(timeout)
        var swipes = 0
        while Date() < deadline {
            let predicate = NSPredicate(format: "label == %@", label)
            let labeled = webView.descendants(matching: .any).matching(predicate).firstMatch
            let identified = webElement(label, in: app).firstMatch
            let element = labeled.exists ? labeled : identified
            if element.exists {
                if element.isHittable {
                    element.tap()
                } else {
                    element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                }
                return true
            }
            if swipes < maxSwipes {
                webView.swipeUp()
                swipes += 1
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        return false
    }

    @MainActor
    private func tapWebComposerSend(in app: XCUIApplication) {
        app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.90)).tap()
    }

    @MainActor
    private func openLiveThread(app: XCUIApplication, thread: LiveThread) async throws {
        let threadButton = app.buttons["thread-open-\(thread.id)"]
        XCTAssertTrue(scrollUntilExists(threadButton, in: app, maxSwipes: 10))
        threadButton.tap()
        assertThreadWebViewReady(app, title: thread.title, timeout: 20)
    }

    @MainActor
    private func runLiveLocalWorkspacePickerCreateThread(
        providerButtonId: String,
        modelButtonId: String?,
        expectedProvider: String,
        expectedModel: String,
        titlePrefix: String
    ) async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "\(titlePrefix) Workspace"
        )
        let title = "\(titlePrefix) \(UUID().uuidString.prefix(8))"

        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-live-local-connection"]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WORKSPACE_ID"] = workspace.id
        app.launch()

        XCTAssertTrue(app.staticTexts["\(titlePrefix) Workspace"].waitForExistence(timeout: 10))
        XCTAssertTrue(tapElement(app.buttons["New"], in: app, maxSwipes: 6))

        let titleField = app.textFields["new-thread-title"]
        XCTAssertTrue(titleField.waitForExistence(timeout: 10))
        titleField.tap()
        titleField.typeText(title)
        dismissKeyboardIfPresent(in: app)

        _ = app.buttons["new-thread-model-gpt-5.4"].waitForExistence(timeout: 15)
        let providerButton = app.buttons[providerButtonId]
        guard tapElement(providerButton, in: app, maxSwipes: 8) else {
            XCTFail("Provider button \(providerButtonId) was not tappable.")
            return
        }
        if let modelButtonId {
            let modelButton = app.buttons[modelButtonId]
            guard waitForAndTapElement(modelButton, in: app, timeout: 20, maxSwipes: 12) else {
                XCTFail("Model button \(modelButtonId) was not tappable.")
                return
            }
            try await Task.sleep(for: .milliseconds(300))
        }
        guard tapElement(app.buttons["new-thread-start"], in: app, maxSwipes: 4) else {
            XCTFail("Start button was not tappable.")
            return
        }

        let created = try await Self.waitForLiveThreadSummary(
            baseURL: baseURL,
            title: title,
            provider: expectedProvider,
            model: expectedModel
        )
        XCTAssertEqual(created.workspaceId, workspace.id)
    }

    @MainActor
    private func waitForAndTapElement(
        _ element: XCUIElement,
        in app: XCUIApplication,
        timeout: TimeInterval,
        maxSwipes: Int
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if tapElement(element, in: app, maxSwipes: maxSwipes) {
                return true
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.3))
        }
        return false
    }

    @MainActor
    private func dismissKeyboardIfPresent(in app: XCUIApplication) {
        guard app.keyboards.firstMatch.exists else {
            return
        }
        if app.keyboards.buttons["Done"].exists {
            app.keyboards.buttons["Done"].tap()
        } else if app.keyboards.buttons["Return"].exists {
            app.keyboards.buttons["Return"].tap()
        } else {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
        }
    }
}

extension RemoteCodexUITests {
    struct LiveWorkspace: Decodable {
        let id: String
    }

    struct LiveThread: Decodable {
        let id: String
        let title: String
    }

    struct LiveThreadSummary: Decodable {
        let id: String
        let workspaceId: String
        let title: String
        let provider: String
        let model: String
        let status: String
    }

    struct LiveServerCredentials {
        let username: String
        let password: String
    }

    struct LiveServerLoginResult: Decodable {
        let token: String
    }

    struct LiveServerSession: Decodable {
        let authenticated: Bool
        let username: String?
    }

    struct LiveRelayRegistration: Decodable {
        let relayToken: String
        let deviceId: String
        let deviceToken: String
    }

    struct LiveRelayPortal: Decodable {
        let devices: [LiveRelayDevice]
    }

    static func liveLocalBaseURL() async throws -> URL {
        let value = ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_BASE_URL"]?.trimmedNonEmpty
            ?? liveBaseURLFileValue()
        guard let value, let url = URL(string: value) else {
            throw XCTSkip("Set REMOTE_CODEX_IOS_E2E_BASE_URL to run the live local iOS smoke.")
        }
        try await waitForLiveHealth(baseURL: url)
        return url
    }

    static func liveRelayBaseURL() async throws -> URL {
        let value = ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_RELAY_BASE_URL"]?.trimmedNonEmpty
            ?? liveRelayBaseURLFileValue()
        guard let value, let url = URL(string: value) else {
            throw XCTSkip("Set REMOTE_CODEX_IOS_E2E_RELAY_BASE_URL to run the live relay iOS smoke.")
        }
        try await waitForLiveHealth(baseURL: url)
        return url
    }

    static func liveServerBaseURL() async throws -> URL {
        let value = ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_SERVER_BASE_URL"]?.trimmedNonEmpty
            ?? liveServerBaseURLFileValue()
        guard let value, let url = URL(string: value) else {
            throw XCTSkip("Set REMOTE_CODEX_IOS_E2E_SERVER_BASE_URL to run the live server iOS smoke.")
        }
        try await waitForLiveHealth(baseURL: url)
        return url
    }

    static func liveServerCredentials() -> LiveServerCredentials {
        LiveServerCredentials(
            username: ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_SERVER_USERNAME"]?.trimmedNonEmpty
                ?? "ios-admin",
            password: ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_SERVER_PASSWORD"]?.trimmedNonEmpty
                ?? "ios-password"
        )
    }

    static func waitForLiveHealth(baseURL: URL) async throws {
        let deadline = Date().addingTimeInterval(10)
        var lastError: Error?
        while Date() < deadline {
            do {
                let url = baseURL.appendingPathComponent("healthz")
                let (_, response) = try await liveURLSession.data(from: url)
                let statusCode = (response as? HTTPURLResponse)?.statusCode
                if statusCode == 200 {
                    return
                }
            } catch {
                lastError = error
            }
            try await Task.sleep(for: .milliseconds(250))
        }
        if let lastError {
            throw lastError
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for live local supervisor health."]
        )
    }

    static func requireLiveE2EFakeRuntime(baseURL: URL, bearerToken: String? = nil) async throws {
        let url = baseURL.appendingPathComponent("api/agent-runtimes")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await liveURLSession.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard statusCode == 200 else {
            throw XCTSkip("The live local supervisor does not expose agent runtimes.")
        }
        let text = String(data: data, encoding: .utf8) ?? ""
        guard text.contains("E2E Fake Runtime") || text.contains("ios-e2e-stream") else {
            throw XCTSkip("Start the supervisor with REMOTE_CODEX_E2E_FAKE_RUNTIME=1 to run this smoke.")
        }
    }

    static func requireLiveRelayE2EFakeRuntime(
        baseURL: URL,
        registration: LiveRelayRegistration
    ) async throws {
        let url = baseURL.appendingPathComponent(
            "relay/devices/\(registration.deviceId)/api/agent-runtimes"
        )
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("Bearer \(registration.relayToken)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await liveURLSession.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard statusCode == 200 else {
            throw XCTSkip("The live relay supervisor does not expose agent runtimes.")
        }
        let text = String(data: data, encoding: .utf8) ?? ""
        guard text.contains("E2E Fake Runtime") || text.contains("ios-e2e-stream") else {
            throw XCTSkip("Start the relay supervisor with REMOTE_CODEX_E2E_FAKE_RUNTIME=1 to run this smoke.")
        }
    }

    static func makeLiveWorkspaceDirectory() throws -> String {
        let root = repoRoot()
        let directory = root
            .appendingPathComponent(".local", isDirectory: true)
            .appendingPathComponent("ios-e2e-workspaces", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try "# iOS live local E2E\n".write(
            to: directory.appendingPathComponent("README.md"),
            atomically: true,
            encoding: .utf8
        )
        return directory.path
    }

    static func liveBaseURLFileValue() -> String? {
        let file = repoRoot()
            .appendingPathComponent(".local", isDirectory: true)
            .appendingPathComponent("ios-e2e", isDirectory: true)
            .appendingPathComponent("base-url.txt")
        return try? String(contentsOf: file, encoding: .utf8).trimmedNonEmpty
    }

    static func liveServerBaseURLFileValue() -> String? {
        let file = repoRoot()
            .appendingPathComponent(".local", isDirectory: true)
            .appendingPathComponent("ios-e2e", isDirectory: true)
            .appendingPathComponent("server-base-url.txt")
        return try? String(contentsOf: file, encoding: .utf8).trimmedNonEmpty
    }

    static func liveRelayBaseURLFileValue() -> String? {
        let file = repoRoot()
            .appendingPathComponent(".local", isDirectory: true)
            .appendingPathComponent("ios-e2e", isDirectory: true)
            .appendingPathComponent("relay-base-url.txt")
        return try? String(contentsOf: file, encoding: .utf8).trimmedNonEmpty
    }

    static func liveRelayRegistration() throws -> LiveRelayRegistration {
        let environment = ProcessInfo.processInfo.environment
        let relayToken = environment["REMOTE_CODEX_IOS_E2E_RELAY_TOKEN"]?.trimmedNonEmpty
        let deviceId = environment["REMOTE_CODEX_IOS_E2E_RELAY_DEVICE_ID"]?.trimmedNonEmpty
        let deviceToken = environment["REMOTE_CODEX_IOS_E2E_RELAY_DEVICE_TOKEN"]?.trimmedNonEmpty
        if let relayToken, let deviceId, let deviceToken {
            return LiveRelayRegistration(relayToken: relayToken, deviceId: deviceId, deviceToken: deviceToken)
        }

        let file = repoRoot()
            .appendingPathComponent(".local", isDirectory: true)
            .appendingPathComponent("ios-e2e", isDirectory: true)
            .appendingPathComponent("relay-registration.json")
        guard FileManager.default.fileExists(atPath: file.path) else {
            throw XCTSkip("Create .local/ios-e2e/relay-registration.json to run the live relay iOS smoke.")
        }
        let data = try Data(contentsOf: file)
        return try JSONDecoder().decode(LiveRelayRegistration.self, from: data)
    }

    static func repoRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }

    static func assertWorkspacesRequireAuth(baseURL: URL) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/workspaces"))
        request.httpMethod = "GET"
        let (_, response) = try await liveURLSession.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 401)
    }

    static func loginServer(baseURL: URL, credentials: LiveServerCredentials) async throws -> String {
        let result: LiveServerLoginResult = try await postJSON(
            baseURL: baseURL,
            path: "/api/auth/login",
            body: [
                "username": credentials.username,
                "password": credentials.password
            ]
        )
        XCTAssertFalse(result.token.isEmpty)
        return result.token
    }

    static func assertAuthenticatedSession(baseURL: URL, token: String, username: String) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/auth/session"))
        request.httpMethod = "GET"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await liveURLSession.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let session = try JSONDecoder().decode(LiveServerSession.self, from: data)
        XCTAssertTrue(session.authenticated)
        XCTAssertEqual(session.username, username)
    }

    static func createLiveWorkspace(
        baseURL: URL,
        path: String,
        label: String,
        bearerToken: String? = nil
    ) async throws -> LiveWorkspace {
        try await postJSON(
            baseURL: baseURL,
            path: "/api/workspaces",
            body: ["absPath": path, "label": label],
            bearerToken: bearerToken
        )
    }

    static func createLiveThread(
        baseURL: URL,
        workspaceId: String,
        bearerToken: String? = nil,
        title: String = "iOS Live Local Thread",
        provider: String? = nil,
        model: String = "gpt-5.4",
        approvalMode: String = "yolo"
    ) async throws -> LiveThread {
        var body = [
            "workspaceId": workspaceId,
            "model": model,
            "approvalMode": approvalMode,
            "title": title
        ]
        if let provider {
            body["provider"] = provider
        }
        return try await postJSON(
            baseURL: baseURL,
            path: "/api/threads/start",
            body: body,
            bearerToken: bearerToken
        )
    }

    static func createLiveThreadWithLocalFallback(baseURL: URL, workspaceId: String) async throws -> LiveThread {
        try await createLiveThreadWithLocalFallback(
            baseURL: baseURL,
            workspaceId: workspaceId,
            title: "iOS Live Local Thread"
        )
    }

    static func createLiveThreadWithLocalFallback(
        baseURL: URL,
        workspaceId: String,
        title: String
    ) async throws -> LiveThread {
        do {
            return try await createLiveThread(baseURL: baseURL, workspaceId: workspaceId, title: title)
        } catch {
            return try await createLiveThread(
                baseURL: baseURL,
                workspaceId: workspaceId,
                title: title,
                provider: "claude",
                model: "ios-e2e-stream"
            )
        }
    }

    static func sendLivePrompt(
        baseURL: URL,
        threadId: String,
        prompt: String,
        collaborationMode: String? = nil,
        bearerToken: String? = nil
    ) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/threads/\(threadId)/prompt"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        var body = [
            "prompt": prompt,
            "clientRequestId": UUID().uuidString,
            "model": "ios-e2e-stream"
        ]
        if let collaborationMode {
            body["collaborationMode"] = collaborationMode
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await liveURLSession.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(
                domain: "RemoteCodexUITests",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: "POST prompt failed: \(text)"]
            )
        }
    }

    static func completeLiveApprovalRequest(baseURL: URL, thread: LiveThread) async throws {
        try await sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: "IOS_PENDING_APPROVAL")
        let requestId = try await waitForLivePendingRequest(
            baseURL: baseURL,
            threadId: thread.id,
            title: "Command approval required"
        )
        try await assertInvalidLiveRequestResponseLeavesPendingRequest(
            baseURL: baseURL,
            threadId: thread.id,
            expectedTitle: "Command approval required"
        )
        try await respondToLivePendingRequest(
            baseURL: baseURL,
            threadId: thread.id,
            requestId: requestId,
            answers: ["approval": ["Allow"]]
        )
        try await waitForNoLivePendingRequests(baseURL: baseURL, threadId: thread.id)
        try await waitForLiveThreadText(baseURL: baseURL, threadId: thread.id, text: "IOS_PENDING_APPROVAL_RESOLVED")
    }

    static func completeLiveQuestionRequest(baseURL: URL, thread: LiveThread) async throws {
        try await sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: "IOS_PENDING_QUESTION")
        let requestId = try await waitForLivePendingRequest(baseURL: baseURL, threadId: thread.id, title: "Mode")
        try await respondToLivePendingRequest(
            baseURL: baseURL,
            threadId: thread.id,
            requestId: requestId,
            answers: ["question-1": ["Detailed"]]
        )
        try await waitForNoLivePendingRequests(baseURL: baseURL, threadId: thread.id)
        try await waitForLiveThreadText(baseURL: baseURL, threadId: thread.id, text: "IOS_PENDING_QUESTION_RESOLVED")
    }

    static func completeLivePlanDecision(baseURL: URL, thread: LiveThread) async throws {
        try await sendLivePrompt(
            baseURL: baseURL,
            threadId: thread.id,
            prompt: "IOS_PENDING_PLAN",
            collaborationMode: "plan"
        )
        let requestId = try await waitForLivePendingRequest(baseURL: baseURL, threadId: thread.id, title: "Plan ready")
        try await respondToLivePendingRequest(
            baseURL: baseURL,
            threadId: thread.id,
            requestId: requestId,
            answers: ["plan-decision": ["Stay in plan mode"]]
        )
        try await waitForNoLivePendingRequests(baseURL: baseURL, threadId: thread.id)
    }

    static func waitForLiveThreadText(
        baseURL: URL,
        threadId: String,
        text: String,
        bearerToken: String? = nil,
        timeout: TimeInterval = 30
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            let url = baseURL.appendingPathComponent("api/threads/\(threadId)")
            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            if let bearerToken {
                request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
            }
            let (data, response) = try await liveURLSession.data(for: request)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            if statusCode == 200, String(data: data, encoding: .utf8)?.contains(text) == true {
                return
            }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for live thread text: \(text)"]
        )
    }

    static func waitForLiveThreadTitle(
        baseURL: URL,
        threadId: String,
        title: String
    ) async throws {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            let detail = try await liveThreadObject(baseURL: baseURL, threadId: threadId)
            let thread = detail["thread"] as? [String: Any]
            if thread?["title"] as? String == title {
                return
            }
            try await Task.sleep(for: .milliseconds(300))
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for live thread title: \(title)"]
        )
    }

    static func waitForLiveThreadSummary(
        baseURL: URL,
        title: String,
        provider: String,
        model: String
    ) async throws -> LiveThreadSummary {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            let threads: [LiveThreadSummary] = try await getJSON(baseURL: baseURL, path: "/api/threads")
            if let thread = threads.first(where: {
                $0.title == title && $0.provider == provider && $0.model == model
            }) {
                return thread
            }
            try await Task.sleep(for: .milliseconds(300))
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [
                NSLocalizedDescriptionKey:
                    "Timed out waiting for thread \(title) with \(provider) / \(model)"
            ]
        )
    }

    static func waitForLiveThreadDeleted(baseURL: URL, threadId: String) async throws {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            let url = baseURL.appendingPathComponent("api/threads/\(threadId)")
            let (_, response) = try await liveURLSession.data(from: url)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            if statusCode == 404 {
                return
            }
            try await Task.sleep(for: .milliseconds(300))
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for live thread deletion: \(threadId)"]
        )
    }

    static func waitForLiveRelayThreadText(
        baseURL: URL,
        registration: LiveRelayRegistration,
        threadId: String,
        text: String
    ) async throws {
        let deadline = Date().addingTimeInterval(30)
        let path = "relay/devices/\(registration.deviceId)/api/threads/\(threadId)"
        while Date() < deadline {
            var request = URLRequest(url: baseURL.appendingPathComponent(path))
            request.httpMethod = "GET"
            request.setValue("Bearer \(registration.relayToken)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await liveURLSession.data(for: request)
            let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
            if statusCode == 200, String(data: data, encoding: .utf8)?.contains(text) == true {
                return
            }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for relay thread text: \(text)"]
        )
    }

    static func waitForLivePendingRequest(baseURL: URL, threadId: String, title: String) async throws -> String {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            let detail = try await liveThreadObject(baseURL: baseURL, threadId: threadId)
            let requests = detail["pendingRequests"] as? [[String: Any]] ?? []
            if let request = requests.first(where: { ($0["title"] as? String) == title }) {
                guard let id = request["id"] as? String else { continue }
                return id
            }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for pending request: \(title)"]
        )
    }

    static func waitForNoLivePendingRequests(baseURL: URL, threadId: String) async throws {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            let detail = try await liveThreadObject(baseURL: baseURL, threadId: threadId)
            let requests = detail["pendingRequests"] as? [Any] ?? []
            if requests.isEmpty {
                return
            }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for pending requests to clear."]
        )
    }

    static func waitForLiveThreadSetting(
        baseURL: URL,
        threadId: String,
        key: String,
        value: String
    ) async throws {
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            let detail = try await liveThreadObject(baseURL: baseURL, threadId: threadId)
            let thread = detail["thread"] as? [String: Any] ?? [:]
            if (thread[key] as? String) == value {
                return
            }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for thread setting \(key)=\(value)."]
        )
    }

    static func waitForLiveTurnCount(
        baseURL: URL,
        threadId: String,
        count: Int
    ) async throws {
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline {
            let detail = try await liveThreadObject(baseURL: baseURL, threadId: threadId)
            if let turns = detail["turns"] as? [[String: Any]],
               turns.count >= count,
               turns.prefix(count).allSatisfy({ ($0["status"] as? String) == "completed" })
            {
                return
            }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for \(count) completed live thread turns."]
        )
    }

    static func waitForLiveForkActivityNote(
        baseURL: URL,
        threadId: String,
        turnIndex: Int
    ) async throws {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            let detail = try await liveThreadObject(baseURL: baseURL, threadId: threadId)
            let notes = detail["activityNotes"] as? [[String: Any]] ?? []
            if notes.contains(where: { note in
                (note["kind"] as? String) == "forkCreated"
                    && (note["turnIndex"] as? Int) == turnIndex
                    && (note["linkedThreadTitle"] as? String)?.hasSuffix(" / fork") == true
            }) {
                return
            }
            try await Task.sleep(for: .milliseconds(500))
        }
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for forkCreated note at turn \(turnIndex)."]
        )
    }

    static func assertInvalidLiveRequestResponseLeavesPendingRequest(
        baseURL: URL,
        threadId: String,
        expectedTitle: String
    ) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/threads/\(threadId)/requests/missing-request/respond"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "answers": [
                "approval": [
                    "answers": ["Allow"]
                ]
            ]
        ])
        let (_, response) = try await liveURLSession.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 404)
        _ = try await waitForLivePendingRequest(baseURL: baseURL, threadId: threadId, title: expectedTitle)
    }

    static func respondToLivePendingRequest(
        baseURL: URL,
        threadId: String,
        requestId: String,
        answers: [String: [String]]
    ) async throws {
        let url = URL(string: "\(baseURL.absoluteString)/api/threads/\(threadId)/requests/\(requestId)/respond")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "answers": answers.mapValues { value in
                ["answers": value]
            }
        ])
        let (data, response) = try await liveURLSession.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(
                domain: "RemoteCodexUITests",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: "POST pending request response failed: \(text)"]
            )
        }
    }

    static func liveThreadObject(baseURL: URL, threadId: String) async throws -> [String: Any] {
        let url = baseURL.appendingPathComponent("api/threads/\(threadId)")
        let (data, response) = try await liveURLSession.data(from: url)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard statusCode == 200 else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(
                domain: "RemoteCodexUITests",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: "GET thread failed: \(text)"]
            )
        }
        let object = try JSONSerialization.jsonObject(with: data)
        guard let dictionary = object as? [String: Any] else {
            throw NSError(
                domain: "RemoteCodexUITests",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Thread detail was not a JSON object."]
            )
        }
        return dictionary
    }

    static func createLiveRelayWorkspace(
        baseURL: URL,
        registration: LiveRelayRegistration,
        path: String,
        label: String
    ) async throws -> LiveWorkspace {
        try await postJSON(
            baseURL: baseURL,
            path: "/relay/devices/\(registration.deviceId)/api/workspaces",
            body: ["absPath": path, "label": label],
            bearerToken: registration.relayToken
        )
    }

    static func createLiveRelayThread(
        baseURL: URL,
        registration: LiveRelayRegistration,
        workspaceId: String,
        title: String = "iOS Live Relay Thread",
        provider: String? = nil,
        model: String = "gpt-5.4"
    ) async throws -> LiveThread {
        var body = [
            "workspaceId": workspaceId,
            "model": model,
            "approvalMode": "yolo",
            "title": title
        ]
        if let provider {
            body["provider"] = provider
        }
        return try await postJSON(
            baseURL: baseURL,
            path: "/relay/devices/\(registration.deviceId)/api/threads/start",
            body: body,
            bearerToken: registration.relayToken
        )
    }

    static func sendLiveRelayPrompt(
        baseURL: URL,
        registration: LiveRelayRegistration,
        threadId: String,
        prompt: String
    ) async throws {
        let path = "relay/devices/\(registration.deviceId)/api/threads/\(threadId)/prompt"
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(registration.relayToken)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "prompt": prompt,
            "clientRequestId": UUID().uuidString,
            "model": "ios-e2e-stream"
        ])
        let (data, response) = try await liveURLSession.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(
                domain: "RemoteCodexUITests",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: "POST relay prompt failed: \(text)"]
            )
        }
    }

    static func waitForRelayDeviceOnline(baseURL: URL, registration: LiveRelayRegistration) async throws {
        let deadline = Date().addingTimeInterval(15)
        var lastPortal: LiveRelayPortal?
        while Date() < deadline {
            let portal: LiveRelayPortal = try await getJSON(
                baseURL: baseURL,
                path: "/relay/portal",
                bearerToken: registration.relayToken
            )
            lastPortal = portal
            if portal.devices.contains(where: { $0.id == registration.deviceId && $0.online }) {
                return
            }
            try await Task.sleep(for: .milliseconds(500))
        }
        let onlineState = lastPortal?.devices.map { "\($0.id):\($0.online)" }.joined(separator: ", ") ?? "none"
        throw NSError(
            domain: "RemoteCodexUITests",
            code: 2,
            userInfo: [NSLocalizedDescriptionKey: "Relay device did not become online. Devices: \(onlineState)"]
        )
    }

    static func getJSON<T: Decodable>(baseURL: URL, path: String, bearerToken: String? = nil) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = "GET"
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await liveURLSession.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(
                domain: "RemoteCodexUITests",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: "GET \(path) failed: \(text)"]
            )
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static func postJSON<T: Decodable>(
        baseURL: URL,
        path: String,
        body: [String: String],
        bearerToken: String? = nil
    ) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearerToken {
            request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await liveURLSession.data(for: request)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ... 299).contains(statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw NSError(
                domain: "RemoteCodexUITests",
                code: statusCode,
                userInfo: [NSLocalizedDescriptionKey: "POST \(path) failed: \(text)"]
            )
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    static var liveURLSession: URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        return URLSession(configuration: configuration)
    }
}

struct LiveRelayDevice: Decodable {
    let id: String
    let online: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case online
        case connected
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        online = try container.decodeIfPresent(Bool.self, forKey: .online)
            ?? container.decodeIfPresent(Bool.self, forKey: .connected)
            ?? false
    }
}

private extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
