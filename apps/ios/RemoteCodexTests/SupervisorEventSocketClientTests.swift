@testable import RemoteCodex
import XCTest

final class SupervisorEventSocketClientTests: XCTestCase {
    func testParsesThreadEventEnvelope() {
        let event = parseSupervisorThreadEvent(
            """
            {
              "type": "thread.output.delta",
              "threadId": "thread-1",
              "eventId": "event-1",
              "cursor": "cursor-1",
              "sequence": 42,
              "timestamp": "2026-06-11T20:00:00.000Z",
              "payload": {
                "turnId": "turn-1",
                "itemId": "item-1",
                "sequence": 1,
                "delta": "hello"
              }
            }
            """
        )

        XCTAssertEqual(event?.type, "thread.output.delta")
        XCTAssertEqual(event?.threadId, "thread-1")
        XCTAssertEqual(event?.eventId, "event-1")
        XCTAssertEqual(event?.cursor, "cursor-1")
        XCTAssertEqual(event?.sequence, 42)
        XCTAssertEqual(event?.timestamp, "2026-06-11T20:00:00.000Z")
        XCTAssertEqual(event?.payload.string("turnId"), "turn-1")
        XCTAssertEqual(event?.payload.string("delta"), "hello")
    }

    func testIgnoresNonThreadAndMalformedMessages() {
        XCTAssertNil(parseSupervisorThreadEvent(#"{"type":"supervisor.connected","timestamp":"now"}"#))
        XCTAssertNil(parseSupervisorThreadEvent(#"{"type":"shell.status","shellId":"shell-1","payload":{"threadId":"thread-1"}}"#))
        XCTAssertNil(parseSupervisorThreadEvent(#"{"type":"thread.output.delta","payload":{}}"#))
        XCTAssertNil(parseSupervisorThreadEvent("not-json"))
    }
}

private extension [String: JSONValue] {
    func string(_ key: String) -> String? {
        guard case let .string(value) = self[key] else { return nil }
        return value
    }
}
