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
    func testThreadDetailFixtureShowsComposerAndTimeline() {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-workspace-fixture", "--ui-test-thread-route"]
        app.launch()

        let summary = app.staticTexts
            .containing(NSPredicate(format: "label CONTAINS %@", "Working from fixture"))
            .firstMatch
        XCTAssertTrue(app.staticTexts["Fixture Thread"].waitForExistence(timeout: 5))
        XCTAssertTrue(summary.waitForExistence(timeout: 5))
        let composer = app.staticTexts["thread-composer-section"]
        XCTAssertTrue(app.buttons["thread-switch-workspace"].waitForExistence(timeout: 5))
        for _ in 0 ..< 4 where !composer.exists {
            app.swipeUp()
        }
        XCTAssertTrue(composer.waitForExistence(timeout: 5))
        let attach = app.buttons["thread-attach-file"]
        for _ in 0 ..< 3 where !attach.exists {
            app.swipeUp()
        }
        XCTAssertTrue(attach.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["thread-slash-toggle"].exists)
        XCTAssertTrue(app.buttons["thread-send-prompt"].exists)

        let plan = app.staticTexts["Plan update"]
        for _ in 0 ..< 4 where !plan.exists {
            app.swipeUp()
        }
        XCTAssertTrue(plan.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["1.7k tokens"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["68% remaining"].waitForExistence(timeout: 5))
        let commandOutput = app.buttons["thread-history-detail-cmd-1"]
        for _ in 0 ..< 4 where !commandOutput.exists {
            app.swipeUp()
        }
        XCTAssertTrue(commandOutput.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["thread-history-copy-cmd-1"].exists)
        XCTAssertTrue(app.buttons["thread-history-detail-tool-1"].exists)
    }

    @MainActor
    func testLiveLocalConnectionLoadsHomeWorkspaceAndThread() async throws {
        let baseURL = try await Self.liveLocalBaseURL()
        let workspacePath = try Self.makeLiveWorkspaceDirectory()
        let workspace = try await Self.createLiveWorkspace(
            baseURL: baseURL,
            path: workspacePath,
            label: "iOS Live Local E2E"
        )
        let thread = try await Self.createLiveThreadWithLocalFallback(baseURL: baseURL, workspaceId: workspace.id)

        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-live-local-connection"]
        app.launchEnvironment["REMOTE_CODEX_IOS_E2E_BASE_URL"] = baseURL.absoluteString
        app.launch()

        let workspaceButton = app.buttons["workspace-open-\(workspace.id)"]
        XCTAssertTrue(scrollUntilExists(workspaceButton, in: app))
        let threadButton = app.buttons["thread-open-\(thread.id)"]
        XCTAssertTrue(scrollUntilExists(threadButton, in: app))
        threadButton.tap()
        XCTAssertTrue(app.staticTexts[thread.title].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Events"].waitForExistence(timeout: 8))
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
        XCTAssertTrue(app.staticTexts[thread.title].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Events"].waitForExistence(timeout: 8))

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
        XCTAssertTrue(app.staticTexts[thread.title].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Events"].waitForExistence(timeout: 8))

        app.terminate()
        app.launchArguments = []
        app.launchEnvironment = [:]
        app.launch()
        XCTAssertTrue(app.staticTexts[thread.title].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Events"].waitForExistence(timeout: 8))
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
        XCTAssertTrue(app.staticTexts[thread.title].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Events"].waitForExistence(timeout: 8))
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
    private func openLiveThread(app: XCUIApplication, thread: LiveThread) async throws {
        let threadButton = app.buttons["thread-open-\(thread.id)"]
        XCTAssertTrue(scrollUntilExists(threadButton, in: app, maxSwipes: 10))
        threadButton.tap()
        XCTAssertTrue(app.staticTexts[thread.title].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["Events"].waitForExistence(timeout: 8))
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

    static func requireLiveE2EFakeRuntime(baseURL: URL) async throws {
        let url = baseURL.appendingPathComponent("api/agent-runtimes")
        let (data, response) = try await liveURLSession.data(from: url)
        let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard statusCode == 200 else {
            throw XCTSkip("The live local supervisor does not expose agent runtimes.")
        }
        let text = String(data: data, encoding: .utf8) ?? ""
        guard text.contains("E2E Fake Runtime") || text.contains("ios-e2e-stream") else {
            throw XCTSkip("Start the supervisor with REMOTE_CODEX_E2E_FAKE_RUNTIME=1 to run this smoke.")
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
        do {
            return try await createLiveThread(baseURL: baseURL, workspaceId: workspaceId)
        } catch {
            return try await createLiveThread(
                baseURL: baseURL,
                workspaceId: workspaceId,
                provider: "claude",
                model: "ios-e2e-stream"
            )
        }
    }

    static func sendLivePrompt(
        baseURL: URL,
        threadId: String,
        prompt: String,
        collaborationMode: String? = nil
    ) async throws {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/threads/\(threadId)/prompt"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
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

    static func waitForLiveThreadText(baseURL: URL, threadId: String, text: String) async throws {
        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline {
            let url = baseURL.appendingPathComponent("api/threads/\(threadId)")
            let (data, response) = try await liveURLSession.data(from: url)
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
        workspaceId: String
    ) async throws -> LiveThread {
        try await postJSON(
            baseURL: baseURL,
            path: "/relay/devices/\(registration.deviceId)/api/threads/start",
            body: [
                "workspaceId": workspaceId,
                "model": "gpt-5.4",
                "approvalMode": "yolo",
                "title": "iOS Live Relay Thread"
            ],
            bearerToken: registration.relayToken
        )
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
