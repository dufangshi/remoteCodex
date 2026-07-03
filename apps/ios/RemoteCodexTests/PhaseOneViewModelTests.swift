import Foundation
@testable import RemoteCodex
import XCTest

final class PhaseOneViewModelTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!
    private var tokenStore: MemoryTokenStore!

    override func setUp() {
        super.setUp()
        suiteName = "RemoteCodexPhaseOneTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        tokenStore = MemoryTokenStore()
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        suiteName = nil
        defaults = nil
        tokenStore = nil
        super.tearDown()
    }

    @MainActor
    func testHomeViewModelRefreshFilterGroupingAndThemePersistence() async {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            if request.url.path == "/api/workspaces" {
                return SupervisorHTTPResponse(
                    statusCode: 200,
                    body: Data(Self.workspacesJSON.utf8),
                    headers: [:]
                )
            }
            if request.url.path == "/api/threads" {
                return SupervisorHTTPResponse(
                    statusCode: 200,
                    body: Data(Self.threadsJSON.utf8),
                    headers: [:]
                )
            }
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
        let environment = makeEnvironment(transport: transport)
        let model = HomeViewModel(
            environment: environment,
            connection: SupervisorConnectionConfig(mode: .local, baseURL: "http://host")
        )

        await model.refresh()
        model.searchText = "needs"
        model.threadFilter = .attention
        model.setTheme(.dark)

        XCTAssertEqual(model.snapshot?.workspaces.count, 1)
        XCTAssertEqual(model.filteredThreads.map(\.id), ["t2"])
        XCTAssertEqual(model.groupedThreads.first?.0, "Attention")
        XCTAssertEqual(environment.settingsStore.readThemeMode(), .dark)
    }

    @MainActor
    func testRelayOfflineSaveAnywayPersistsSelectedDeviceAndCallsReady() async {
        let transport = MockSupervisorTransport()
        let environment = makeEnvironment(transport: transport)
        var readyConfig: SupervisorConnectionConfig?
        let model = ConnectionViewModel(environment: environment) { config in
            readyConfig = config
        }
        model.mode = .relay
        model.baseURL = "https://relay.example.com"
        model.authToken = "relay-token"

        await model.saveRelayDeviceWithoutHealthCheck(
            RelayDeviceSummary(
                id: "device-a",
                name: "Offline backend",
                online: false,
                createdAt: nil,
                lastHeartbeatAt: nil,
                lastSeenAt: nil
            )
        )

        XCTAssertEqual(readyConfig?.relayDeviceId, "device-a")
        XCTAssertEqual(environment.settingsStore.readSupervisorConnection()?.relayDeviceId, "device-a")
        XCTAssertEqual(environment.settingsStore.readSupervisorConnection()?.authToken, "relay-token")
    }

    @MainActor
    func testRelayConnectionWithoutDeviceStartsAtDeviceList() async throws {
        let transport = MockSupervisorTransport()
        let environment = makeEnvironment(transport: transport)
        try environment.settingsStore.writeSupervisorConnection(
            SupervisorConnectionConfig(
                mode: .relay,
                baseURL: "https://relay.example.com",
                authToken: "relay-token",
                relayDeviceId: nil
            )
        )

        let model = ConnectionViewModel(environment: environment) { _ in }

        XCTAssertEqual(model.mode, .relay)
        XCTAssertEqual(model.route, .relayDevices)
        XCTAssertEqual(model.authToken, "relay-token")
    }

    @MainActor
    func testLocalModeDoesNotRouteToServerLoginWhenUrlIsServerMode() async {
        let transport = MockSupervisorTransport()
        transport.handler = { request in
            if request.url.path == "/api/auth/session" {
                return SupervisorHTTPResponse(
                    statusCode: 200,
                    body: Data("""
                    {"authenticated":false,"username":null,"expiresAt":null,"mode":"server","authRequired":true}
                    """.utf8),
                    headers: [:]
                )
            }
            if request.url.path == "/healthz" {
                return SupervisorHTTPResponse(
                    statusCode: 200,
                    body: Data(#"{"status":"ok"}"#.utf8),
                    headers: [:]
                )
            }
            return SupervisorHTTPResponse(statusCode: 404, body: Data(), headers: [:])
        }
        let environment = makeEnvironment(transport: transport)
        var readyConfig: SupervisorConnectionConfig?
        let model = ConnectionViewModel(environment: environment) { config in
            readyConfig = config
        }
        model.mode = .local
        model.baseURL = "http://127.0.0.1:8787"

        await model.connectDirect()

        XCTAssertNil(readyConfig)
        XCTAssertEqual(model.route, .modeSelect)
        XCTAssertEqual(model.errorMessage, "This URL is running server mode. Choose Server or use a Local / Intranet supervisor URL.")
    }

    @MainActor
    private func makeEnvironment(transport: MockSupervisorTransport) -> AppEnvironment {
        let settingsStore = AppSettingsStore(defaults: defaults, tokenStore: tokenStore)
        return AppEnvironment(settingsStore: settingsStore) { config in
            SupervisorAPIClient(config: config, transport: transport)
        }
    }
}

private extension PhaseOneViewModelTests {
    static let workspacesJSON = """
    [{"id":"w1","label":"Repo","absPath":"/repo","isFavorite":false,"lastOpenedAt":null}]
    """

    static let threadsJSON = """
    [
      {
        "id": "t1",
        "workspaceId": "w1",
        "provider": "codex",
        "title": "Running thread",
        "status": "running",
        "model": "gpt-5.4",
        "reasoningEffort": null,
        "fastMode": false,
        "collaborationMode": "default",
        "sandboxMode": null,
        "updatedAt": "2026-06-14T00:00:00Z",
        "summaryText": null,
        "isLoaded": true
      },
      {
        "id": "t2",
        "workspaceId": "w1",
        "provider": "codex",
        "title": "Needs input",
        "status": "waiting",
        "model": "gpt-5.4",
        "reasoningEffort": null,
        "fastMode": false,
        "collaborationMode": "default",
        "sandboxMode": null,
        "updatedAt": "2026-06-14T01:00:00Z",
        "summaryText": "needs approval",
        "isLoaded": true
      }
    ]
    """
}
