import XCTest

extension RemoteCodexUITests {
    @MainActor
    func testPendingRequestFixtureAutoResolvesApprovalQuestionAndPlanDecisionThroughWebView() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-ios-thread-webview-fixture",
            "--ui-test-ios-thread-webview-auto-resolve-pending",
        ]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 20))
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForStaticText(
                debug,
                labelBeginsWith: "pendingRequests:auto-resolved:ios-web-approval-request,ios-web-question-request,ios-web-plan-request",
                timeout: 10
            ),
            debug.exists ? debug.label : "Pending requests did not resolve through the WebView responder."
        )

        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testPendingRequestFixtureClicksVisibleWebViewControls() {
        let app = XCUIApplication()
        app.launchArguments = [
            "--reset-settings",
            "--ui-test-ios-thread-webview-fixture",
            "--ui-test-ios-thread-webview-click-pending-controls",
        ]
        app.launch()

        XCTAssertTrue(app.descendants(matching: .any)["thread-webview-screen"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["thread-webview-ready"].waitForExistence(timeout: 20))
        let debug = app.staticTexts["thread-webview-debug"]
        XCTAssertTrue(
            waitForStaticText(
                debug,
                labelBeginsWith: "pendingRequests:clicked-controls:ios-web-approval-request,ios-web-question-request,ios-web-plan-request",
                timeout: 15
            ),
            debug.exists ? debug.label : "Pending requests did not resolve through visible WebView controls."
        )

        let error = app.staticTexts["thread-webview-error"]
        XCTAssertFalse(error.exists, error.exists ? error.label : "Thread WebView reported an unknown error.")
    }

    @MainActor
    func testLiveLocalPendingRequestsSubmitThroughUIControls() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        try await Self.requireLiveE2EFakeRuntime(baseURL: baseURL)
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS Pending Request UI E2E"
        )
        let approvalThread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS Approval UI Thread",
            provider: "claude",
            model: "ios-e2e-stream",
            approvalMode: "guarded"
        )
        let questionThread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS Question UI Thread",
            provider: "claude",
            model: "ios-e2e-stream",
            approvalMode: "guarded"
        )
        let planThread = try await Self.createLiveThread(
            baseURL: baseURL,
            workspaceId: workspace.id,
            title: "iOS Plan UI Thread",
            provider: "claude",
            model: "ios-e2e-stream"
        )

        try await Self.sendLivePrompt(baseURL: baseURL, threadId: approvalThread.id, prompt: "IOS_PENDING_APPROVAL")
        _ = try await Self.waitForLivePendingRequest(
            baseURL: baseURL,
            threadId: approvalThread.id,
            title: "Command approval required"
        )
        try await assertInvalidResponseThenSubmitPendingRequestInUI(
            baseURL: baseURL,
            thread: approvalThread,
            expectedTitle: "Command approval required",
            optionIdentifier: "thread-pending-request-option-approval-Allow",
            completionText: "IOS_PENDING_APPROVAL_RESOLVED"
        )

        try await Self.sendLivePrompt(baseURL: baseURL, threadId: questionThread.id, prompt: "IOS_PENDING_QUESTION")
        _ = try await Self.waitForLivePendingRequest(baseURL: baseURL, threadId: questionThread.id, title: "Mode")
        try await submitPendingRequestInUI(
            baseURL: baseURL,
            thread: questionThread,
            optionIdentifier: "thread-pending-request-option-question-1-Detailed",
            completionText: "IOS_PENDING_QUESTION_RESOLVED"
        )

        try await Self.sendLivePrompt(
            baseURL: baseURL,
            threadId: planThread.id,
            prompt: "IOS_PENDING_PLAN",
            collaborationMode: "plan"
        )
        _ = try await Self.waitForLivePendingRequest(baseURL: baseURL, threadId: planThread.id, title: "Plan ready")
        try await submitPlanDecisionInUI(baseURL: baseURL, thread: planThread)
    }

    @MainActor
    private func launchLiveThreadApp(baseURL: URL, thread: LiveThread) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-live-local-connection"]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_THREAD_ID"] = thread.id
        app.launch()
        return app
    }

    @MainActor
    private func assertInvalidResponseThenSubmitPendingRequestInUI(
        baseURL: URL,
        thread: LiveThread,
        expectedTitle: String,
        optionIdentifier: String,
        completionText: String
    ) async throws {
        try await Self.assertInvalidLiveRequestResponseLeavesPendingRequest(
            baseURL: baseURL,
            threadId: thread.id,
            expectedTitle: expectedTitle
        )
        try await submitPendingRequestInUI(
            baseURL: baseURL,
            thread: thread,
            optionIdentifier: optionIdentifier,
            completionText: completionText
        )
    }

    @MainActor
    private func submitPendingRequestInUI(
        baseURL: URL,
        thread: LiveThread,
        optionIdentifier: String,
        completionText: String
    ) async throws {
        let app = launchLiveThreadApp(baseURL: baseURL, thread: thread)
        focusPendingRequests(in: app)
        XCTAssertTrue(tapElement(app.descendants(matching: .any)[optionIdentifier], in: app, maxSwipes: 10))
        XCTAssertTrue(tapElement(app.buttons["Submit Response"], in: app, maxSwipes: 4))
        try await Self.waitForNoLivePendingRequests(baseURL: baseURL, threadId: thread.id)
        try await Self.waitForLiveThreadText(baseURL: baseURL, threadId: thread.id, text: completionText)
        app.terminate()
    }

    @MainActor
    private func submitPlanDecisionInUI(baseURL: URL, thread: LiveThread) async throws {
        let app = launchLiveThreadApp(baseURL: baseURL, thread: thread)
        focusPendingRequests(in: app)
        let planOption = app.descendants(matching: .any)["thread-pending-request-option-plan-decision-Stay-in-plan-mode"]
        XCTAssertTrue(tapElement(planOption, in: app, maxSwipes: 10))
        try await Self.waitForNoLivePendingRequests(baseURL: baseURL, threadId: thread.id)
        app.terminate()
    }

    @MainActor
    private func focusPendingRequests(in app: XCUIApplication) {
        let requestsButton = app.buttons["thread-show-pending-requests"]
        if requestsButton.waitForExistence(timeout: 8) {
            _ = tapElement(requestsButton, in: app, maxSwipes: 2)
            return
        }
        for _ in 0 ..< 8 {
            app.swipeDown()
        }
    }

    @MainActor
    private func tapCurrentElement(_ element: XCUIElement) {
        XCTAssertTrue(element.waitForExistence(timeout: 5))
        if element.isHittable {
            element.tap()
        } else {
            element.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
    }

}
