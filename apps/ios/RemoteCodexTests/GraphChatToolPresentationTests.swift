@testable import RemoteCodex
import XCTest

final class GraphChatToolPresentationTests: XCTestCase {
    func testBuildsPendingAndCompletedToolCallStates() {
        let pending = buildGraphChatToolCallState(
            language: "tool-call",
            body: #"{"tool":"file.read","call_id":"call_1","args":{"path":"README.md"}}"#
        )

        XCTAssertEqual(pending.title, "file.read")
        XCTAssertEqual(pending.callId, "call_1")
        XCTAssertEqual(pending.status, "pending")
        XCTAssertEqual(pending.statusLabel, "Running")
        XCTAssertEqual(pending.tone, .running)
        XCTAssertEqual(pending.parameters, #"{"path":"README.md"}"#)
        XCTAssertNil(pending.result)
        XCTAssertFalse(pending.hasTextualOutput)
        XCTAssertTrue(pending.defaultExpanded)
        XCTAssertTrue(pending.stateKey.hasPrefix("tool:file.read:call_1:pending:"))

        let completed = buildGraphChatToolCallState(
            language: "tool-merged",
            body: """
            tool: shell.exec
            call_id: call_shell
            args:
            {"cmd":"./gradlew test"}
            result:
            stdout: BUILD SUCCESSFUL
            """
        )

        XCTAssertEqual(completed.title, "shell.exec")
        XCTAssertEqual(completed.statusLabel, "Completed")
        XCTAssertEqual(completed.tone, .completed)
        XCTAssertEqual(completed.result, "stdout: BUILD SUCCESSFUL")
        XCTAssertTrue(completed.hasTextualOutput)
        XCTAssertTrue(completed.defaultExpanded)
    }

    func testPreprocessMergesToolResultStreamsIntoPreview() throws {
        let processed = preprocessGraphChatToolBlocks(
            #"""
            ```tool-call
            {"tool":"shell.exec","call_id":"call_stream","args":{"cmd":"test"}}
            ```

            ```tool-result
            {"call_id":"call_stream","result":{"status":"stream","stream":"stdout","chunk":"line 1\n"}}
            ```

            ```tool-result
            {"call_id":"call_stream","result":{"status":"stream","stream":"stderr","chunk":"warn\n"}}
            ```
            """#
        )

        let block = try XCTUnwrap(parseRichMessageBlocks(processed.processedContent).singleCodeBlock)
        let preview = parseGraphChatToolBlock(language: block.language, body: block.code)

        XCTAssertEqual(block.language, "tool-merged")
        XCTAssertEqual(preview.title, "shell.exec")
        XCTAssertEqual(preview.callId, "call_stream")
        XCTAssertEqual(preview.parameters, #"{"cmd":"test"}"#)
        XCTAssertEqual(preview.result, "stdout:\nline 1\nstderr:\nwarn")
    }

    func testReadsToolEntriesAndDisplayState() {
        XCTAssertEqual(
            graphChatToolEntries(#"{"cmd":"./gradlew test","timeout":120,"env":{"CI":true},"items":["a","b"],"missing":null}"#),
            [
                GraphChatToolEntry(key: "cmd", value: #""./gradlew test""#, kind: .string),
                GraphChatToolEntry(key: "timeout", value: "120", kind: .number),
                GraphChatToolEntry(key: "env", value: #"{"CI":true}"#, kind: .object),
                GraphChatToolEntry(key: "items", value: #"["a","b"]"#, kind: .object),
                GraphChatToolEntry(key: "missing", value: "null", kind: .null)
            ]
        )
        XCTAssertEqual(
            graphChatToolEntries(
                """
                stdout: BUILD SUCCESSFUL
                stderr: warn
                """
            ),
            [
                GraphChatToolEntry(key: "stdout", value: "BUILD SUCCESSFUL", kind: .raw),
                GraphChatToolEntry(key: "stderr", value: "warn", kind: .raw)
            ]
        )
        XCTAssertEqual(
            buildGraphChatToolEntryDisplayState(
                entry: GraphChatToolEntry(key: "stdout", value: "", kind: .raw),
                renderObjectAsBlock: false
            ),
            GraphChatToolEntryDisplayState(
                key: "stdout",
                value: "",
                displayValue: "(empty)",
                copyValue: "",
                kind: .raw,
                displayKind: .outputBlock,
                tone: .raw
            )
        )
    }

    func testJsonFormattingAndTextualOutputDetection() {
        XCTAssertEqual(
            formatGraphChatToolParameterObject([
                ("cmd", #"./gradlew "test""#),
                ("timeout", "120"),
                ("interactive", "false"),
                ("env", #"{"CI":true}"#),
                ("items", #"["a","b"]"#),
                ("missing", "null")
            ]),
            #"""
            {
              "cmd": "./gradlew \"test\"",
              "timeout": 120,
              "interactive": false,
              "env": {"CI":true},
              "items": ["a","b"],
              "missing": null
            }
            """#
        )
        XCTAssertEqual(
            prettyGraphChatToolJsonValue(#"{"ok":true,"items":["a,b",2]}"#),
            #"""
            {
              "ok": true,
              "items": [
                "a,b",
                2
              ]
            }
            """#
        )
        XCTAssertTrue(graphChatToolHasTextualOutput("plain output"))
        XCTAssertTrue(graphChatToolHasTextualOutput(#""plain output""#))
        XCTAssertTrue(graphChatToolHasTextualOutput(#"{"stdout":"ok"}"#))
        XCTAssertFalse(graphChatToolHasTextualOutput(#"{"stdout":""}"#))
        XCTAssertFalse(graphChatToolHasTextualOutput("42"))
        XCTAssertFalse(graphChatToolHasTextualOutput("null"))
    }
}

private extension [RichMessageBlock] {
    var singleCodeBlock: (language: String, code: String)? {
        guard count == 1, case let .code(language, code) = self[0] else { return nil }
        return (language, code)
    }
}
