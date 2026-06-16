@testable import RemoteCodex
import XCTest

final class JSONValueTests: XCTestCase {
    func testPreservesNestedUnknownJSON() throws {
        let data = Data("""
        {
          "type": "thread.custom",
          "payload": {
            "flag": true,
            "count": 2,
            "items": ["a", null, {"nested": "value"}]
          }
        }
        """.utf8)

        let decoded = try JSONDecoder().decode([String: JSONValue].self, from: data)

        XCTAssertEqual(decoded["type"], .string("thread.custom"))
        XCTAssertEqual(
            decoded["payload"],
            .object([
                "flag": .bool(true),
                "count": .number(2),
                "items": .array([
                    .string("a"),
                    .null,
                    .object(["nested": .string("value")])
                ])
            ])
        )
    }
}
