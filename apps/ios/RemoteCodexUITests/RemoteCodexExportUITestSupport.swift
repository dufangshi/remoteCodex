import XCTest

extension RemoteCodexUITests {
    @MainActor
    func testThreadExportFixtureExportsPDFAndHTMLCustomTurns() {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-workspace-fixture", "--ui-test-thread-route"]
        app.launch()

        openExportDialog(in: app)
        XCTAssertTrue(tapElement(app.buttons["Custom"], in: app, maxSwipes: 2))
        XCTAssertTrue(tapElement(app.buttons["thread-export-submit"], in: app, maxSwipes: 2))
        XCTAssertTrue(app.buttons["Share fixture-thread.pdf"].waitForExistence(timeout: 5))

        openExportDialog(in: app)
        XCTAssertTrue(tapElement(app.buttons["HTML"], in: app, maxSwipes: 2))
        XCTAssertTrue(tapElement(app.buttons["thread-export-submit"], in: app, maxSwipes: 2))
        XCTAssertTrue(app.buttons["Share fixture-thread.html"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testThreadWebViewFixtureExportsPDFToNativeShareLink() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-ios-thread-webview-fixture",
            "--ui-test-ios-thread-webview-auto-export",
        ]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["thread-webview-share-export"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["Share ios-webview-fixture.pdf"].exists)
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testThreadWebViewFixtureExportsHTMLToNativeShareLink() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-ios-thread-webview-fixture",
            "--ui-test-ios-thread-webview-auto-export",
            "--ui-test-ios-thread-webview-auto-export-html",
        ]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["thread-webview-share-export"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["Share ios-webview-fixture.html"].exists)
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testThreadWebViewFixtureClicksVisibleExportCustomSelectionControls() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-ios-thread-webview-fixture",
            "--ui-test-ios-thread-webview-click-visible-export",
        ]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 20))
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(debug, containing: "visible-export:custom-html:1-turn", timeout: 20),
            debug.exists ? debug.label : "WebView did not click visible export custom selection controls."
        )
        XCTAssertTrue(app.buttons["thread-webview-share-export"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["Share ios-webview-fixture.html"].exists)
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testThreadWebViewFixtureOpensVisibleShareTab() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-ios-thread-webview-fixture",
            "--ui-test-ios-thread-webview-click-visible-share",
        ]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 20))
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForElement(debug, containing: "visible-share:tab-open:available=false", timeout: 20),
            debug.exists ? debug.label : "WebView did not open the visible Share tab."
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewExportsPDFToNativeShareLink() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView Export E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView Export Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )
        let prompt = "iOS WebView export prompt \(UUID().uuidString)"
        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: prompt)
        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-auto-export",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        XCTAssertTrue(app.buttons["thread-webview-share-export"].waitForExistence(timeout: 45))
        XCTAssertTrue(
            waitForElement(
                app.buttons["thread-webview-share-export"],
                containing: "remote-codex-ios-webview-export-thread",
                timeout: 5
            )
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalThreadWebViewExportsHTMLToNativeShareLink() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS WebView HTML Export E2E"
        )
        let thread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS WebView HTML Export Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )
        let prompt = "iOS WebView HTML export prompt \(UUID().uuidString)"
        try await Self.sendLivePrompt(baseURL: baseURL, threadId: thread.id, prompt: prompt)
        try await Self.waitForLiveThreadText(
            baseURL: baseURL,
            threadId: thread.id,
            text: "IOS_STREAM_COMPLETED"
        )

        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-live-local-connection",
            "--use-ios-thread-webview",
            "--ui-test-ios-thread-webview-auto-export",
            "--ui-test-ios-thread-webview-auto-export-html",
        ]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        assertThreadWebViewReady(app, title: thread.title)
        XCTAssertTrue(app.buttons["thread-webview-share-export"].waitForExistence(timeout: 45))
        XCTAssertTrue(
            waitForElement(
                app.buttons["thread-webview-share-export"],
                containing: "remote-codex-ios-webview-html-export-thread",
                timeout: 5
            )
        )
        XCTAssertTrue(
            waitForElement(
                app.buttons["thread-webview-share-export"],
                containing: ".html",
                timeout: 5
            )
        )
        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    private func openExportDialog(in app: XCUIApplication) {
        XCTAssertTrue(tapElement(app.buttons["thread-export-transcript"], in: app, maxSwipes: 12))
        XCTAssertTrue(app.navigationBars["Export"].waitForExistence(timeout: 5))
    }
}
