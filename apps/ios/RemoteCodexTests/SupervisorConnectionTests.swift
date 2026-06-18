@testable import RemoteCodex
import XCTest

final class SupervisorConnectionTests: XCTestCase {
    func testNormalizesBaseURL() {
        XCTAssertEqual(normalizeBaseURL("127.0.0.1:8787/"), "http://127.0.0.1:8787")
        XCTAssertEqual(normalizeBaseURL(" https://relay.example.com/// "), "https://relay.example.com")
        XCTAssertEqual(normalizeBaseURL(""), "http://127.0.0.1:8787")
    }

    func testDirectRestPathAndWebSocketURL() {
        let config = SupervisorConnectionConfig(mode: .server, baseURL: "https://host", authToken: "abc 123")

        XCTAssertEqual(config.restPath("api/threads"), "/api/threads")
        XCTAssertEqual(config.webSocketURL(), "wss://host/ws?token=abc%20123")
    }

    func testRelayDeviceRestPathAndWebSocketURL() {
        let config = SupervisorConnectionConfig(
            mode: .relay,
            baseURL: "https://relay.example.com",
            authToken: "relay token",
            relayDeviceId: "device/one"
        )

        XCTAssertEqual(config.restPath("/api/workspaces"), "/relay/devices/device%2Fone/api/workspaces")
        XCTAssertEqual(
            config.webSocketURL(),
            "wss://relay.example.com/relay/devices/device%2Fone/ws?relaySession=relay%20token"
        )
    }

    func testRelayFallbackPathWithoutSelectedDevice() {
        let config = SupervisorConnectionConfig(mode: .relay, baseURL: "http://relay.local:8788")

        XCTAssertEqual(config.restPath("/api/threads"), "/relay/api/threads")
        XCTAssertEqual(config.webSocketURL(), "ws://relay.local:8788/relay/ws")
    }
}
