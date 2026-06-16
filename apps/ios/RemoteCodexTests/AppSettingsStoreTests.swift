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

    func testLastRouteIsScopedByRelayDevice() {
        let first = SupervisorConnectionConfig(mode: .relay, baseURL: "https://relay", relayDeviceId: "a")
        let second = SupervisorConnectionConfig(mode: .relay, baseURL: "https://relay", relayDeviceId: "b")

        store.writeLastRoute(.threadDetail("thread-a"), for: first)
        store.writeLastRoute(.workspaceDetail("workspace-b"), for: second)

        XCTAssertEqual(store.readLastRoute(for: first), .threadDetail("thread-a"))
        XCTAssertEqual(store.readLastRoute(for: second), .workspaceDetail("workspace-b"))
    }
}
