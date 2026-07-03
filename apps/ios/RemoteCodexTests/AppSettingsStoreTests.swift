@testable import RemoteCodex
import XCTest

final class AppSettingsStoreTests: XCTestCase {
    private var suiteName: String!
    private var defaults: UserDefaults!
    private var tokenStore: MemoryTokenStore!
    private var store: AppSettingsStore!

    override func setUp() {
        super.setUp()
        suiteName = "RemoteCodexTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)
        tokenStore = MemoryTokenStore()
        store = AppSettingsStore(defaults: defaults, tokenStore: tokenStore)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        suiteName = nil
        defaults = nil
        tokenStore = nil
        store = nil
        super.tearDown()
    }

    func testPersistsConnectionWithTokenOutsideDefaults() throws {
        let config = SupervisorConnectionConfig(
            mode: .relay,
            baseURL: "https://relay.example.com/",
            authToken: "secret",
            relayDeviceId: "device-a"
        )

        try store.writeSupervisorConnection(config)
        let restored = store.readSupervisorConnection()

        XCTAssertEqual(
            restored,
            SupervisorConnectionConfig(
                mode: .relay,
                baseURL: "https://relay.example.com",
                authToken: "secret",
                relayDeviceId: "device-a"
            )
        )
        XCTAssertNil(defaults.string(forKey: "supervisor_auth_token"))
    }

    func testClearingRelayDeviceKeepsToken() throws {
        try store.writeSupervisorConnection(
            SupervisorConnectionConfig(
                mode: .relay,
                baseURL: "https://relay.example.com",
                authToken: "secret",
                relayDeviceId: "device-a"
            )
        )

        store.clearRelayDeviceSelection()
        let restored = store.readSupervisorConnection()

        XCTAssertEqual(restored?.authToken, "secret")
        XCTAssertNil(restored?.relayDeviceId)
    }

    func testSavedSupervisorDevicesSupportMultipleModesAndTokenStorage() throws {
        let local = try store.upsertSavedSupervisorDevice(
            config: SupervisorConnectionConfig(mode: .local, baseURL: "http://localhost:8821/"),
            name: "Mac local"
        )
        let server = try store.upsertSavedSupervisorDevice(
            config: SupervisorConnectionConfig(
                mode: .server,
                baseURL: "https://server.example.com/",
                authToken: "server-secret"
            ),
            name: "Production server"
        )
        let relay = try store.upsertSavedSupervisorDevice(
            config: SupervisorConnectionConfig(
                mode: .relay,
                baseURL: "https://relay.example.com/",
                authToken: "relay-secret",
                relayDeviceId: "relay-device-a"
            ),
            name: "Team relay"
        )

        let devices = store.readSavedSupervisorDevices()
        XCTAssertEqual(devices.count, 3)
        XCTAssertEqual(devices.first { $0.id == local.id }?.name, "Mac local")
        XCTAssertEqual(store.supervisorConnection(for: server).authToken, "server-secret")
        XCTAssertEqual(store.supervisorConnection(for: relay, relayDeviceId: "relay-device-b").relayDeviceId, "relay-device-b")
        XCTAssertNil(devices.first { $0.id == relay.id }?.relayDeviceId)
        XCTAssertNil(defaults.string(forKey: "supervisor_auth_token"))

        store.updateSavedSupervisorDevice(id: local.id, name: "Laptop local", baseURL: "http://127.0.0.1:8821/")
        XCTAssertEqual(store.readSavedSupervisorDevices().first { $0.id == local.id }?.name, "Laptop local")
        XCTAssertEqual(store.readSavedSupervisorDevices().first { $0.id == local.id }?.baseURL, "http://127.0.0.1:8821")

        store.deleteSavedSupervisorDevice(id: server.id)
        XCTAssertEqual(store.readSavedSupervisorDevices().count, 2)
        XCTAssertNil(store.supervisorConnection(for: server).authToken)
    }

    func testSavedSupervisorDevicesExposeLegacyConnection() throws {
        try tokenStore.writeToken("legacy-secret", account: "legacy-account")
        defaults.set("server", forKey: "supervisor_mode")
        defaults.set("https://legacy.example.com/", forKey: "supervisor_base_url")
        defaults.set("legacy-account", forKey: "supervisor_auth_token_key")

        let devices = store.readSavedSupervisorDevices()

        XCTAssertEqual(devices.count, 1)
        XCTAssertEqual(devices[0].name, "Server supervisor")
        XCTAssertEqual(devices[0].baseURL, "https://legacy.example.com")
        XCTAssertEqual(store.supervisorConnection(for: devices[0]).authToken, "legacy-secret")
    }

    func testLastRouteIsScopedByRelayDevice() {
        let first = SupervisorConnectionConfig(mode: .relay, baseURL: "https://relay", relayDeviceId: "a")
        let second = SupervisorConnectionConfig(mode: .relay, baseURL: "https://relay", relayDeviceId: "b")

        store.writeLastRoute(.threadDetail("thread-a"), for: first)
        store.writeLastRoute(.workspaceDetail("workspace-b"), for: second)

        XCTAssertEqual(store.readLastRoute(for: first), .threadDetail("thread-a"))
        XCTAssertEqual(store.readLastRoute(for: second), .workspaceDetail("workspace-b"))
    }
}
