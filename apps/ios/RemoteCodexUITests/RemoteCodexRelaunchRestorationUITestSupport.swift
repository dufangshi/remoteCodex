import XCTest

extension RemoteCodexUITests {
    @MainActor
    func testLiveLocalRelaunchRestoresHomeWorkspaceAndThreadByConnectionKey() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS Relaunch Restoration E2E"
        )
        let thread = try await Self.createLiveThreadWithLocalFallback(baseURL: baseURL, workspaceId: workspace.id)

        let app = XCUIApplication()
        launchLiveLocalRoute(app, baseURL: baseURL, reset: true)
        XCTAssertTrue(scrollUntilExists(app.buttons["workspace-open-\(workspace.id)"], in: app))
        relaunchFromPersistedSettings(app)
        XCTAssertTrue(scrollUntilExists(app.buttons["workspace-open-\(workspace.id)"], in: app))

        launchLiveLocalRoute(app, baseURL: baseURL, workspaceId: workspace.id)
        XCTAssertTrue(app.staticTexts["iOS Relaunch Restoration E2E"].waitForExistence(timeout: 8))
        relaunchFromPersistedSettings(app)
        XCTAssertTrue(app.staticTexts["iOS Relaunch Restoration E2E"].waitForExistence(timeout: 8))

        launchLiveLocalRoute(app, baseURL: baseURL, threadId: thread.id)
        assertThreadWebViewReady(app, title: thread.title, timeout: 20)
        relaunchFromPersistedSettings(app)
        assertThreadWebViewReady(app, title: thread.title, timeout: 20)
    }

    @MainActor
    private func launchLiveLocalRoute(
        _ app: XCUIApplication,
        baseURL: URL,
        workspaceId: String? = nil,
        threadId: String? = nil,
        reset: Bool = false
    ) {
        app.terminate()
        app.launchArguments = (reset ? ["--reset-settings"] : []) + ["--ui-test-live-local-connection"]
        app.launchEnvironment = ["REMOTE_CODEX_IOS_E2E_BASE_URL": baseURL.absoluteString]
        if let workspaceId {
            app.launchEnvironment["REMOTE_CODEX_IOS_E2E_WORKSPACE_ID"] = workspaceId
        }
        if let threadId {
            app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = threadId
        }
        app.launch()
    }

    @MainActor
    private func relaunchFromPersistedSettings(_ app: XCUIApplication) {
        app.terminate()
        app.launchArguments = []
        app.launchEnvironment = [:]
        app.launch()
    }
}
