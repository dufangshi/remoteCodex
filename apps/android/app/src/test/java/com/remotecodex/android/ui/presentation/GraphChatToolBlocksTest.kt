package com.remotecodex.android.ui.presentation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GraphChatToolBlocksTest {
    @Test
    fun parsesPendingToolCallPreview() {
        val preview = parseGraphChatToolBlock(
            language = "tool-call",
            body = """{"tool":"file.read","call_id":"call_1","args":{"path":"README.md"}}""",
        )

        assertEquals("file.read", preview.title)
        assertEquals("call_1", preview.callId)
        assertEquals("""{"path":"README.md"}""", preview.parameters)
        assertEquals(null, preview.result)
    }

    @Test
    fun buildsPendingToolCallStateExpandedByDefault() {
        val state = buildGraphChatToolCallState(
            language = "tool-call",
            body = """{"tool":"file.read","call_id":"call_1","args":{"path":"README.md"}}""",
        )

        assertEquals("file.read", state.title)
        assertEquals("call_1", state.callId)
        assertEquals("pending", state.status)
        assertEquals("Running", state.statusLabel)
        assertEquals(GraphChatToolCallTone.Running, state.tone)
        assertEquals("""{"path":"README.md"}""", state.parameters)
        assertEquals(null, state.result)
        assertEquals(false, state.hasTextualOutput)
        assertEquals(true, state.defaultExpanded)
        assertTrue(state.stateKey.startsWith("tool:file.read:call_1:pending:"))
    }

    @Test
    fun buildsCompletedToolCallStateExpandedWhenResultHasTextualOutput() {
        val state = buildGraphChatToolCallState(
            language = "tool-merged",
            body = """
                tool: shell.exec
                call_id: call_shell
                args:
                {"cmd":"./gradlew test"}
                result:
                stdout: BUILD SUCCESSFUL
            """.trimIndent(),
        )

        assertEquals("shell.exec", state.title)
        assertEquals("Completed", state.statusLabel)
        assertEquals(GraphChatToolCallTone.Completed, state.tone)
        assertEquals(true, state.hasTextualOutput)
        assertEquals(true, state.defaultExpanded)
        assertEquals("stdout: BUILD SUCCESSFUL", state.result)
    }

    @Test
    fun buildsCompletedToolCallStateCollapsedWithoutTextualOutput() {
        val state = buildGraphChatToolCallState(
            language = "tool-merged",
            body = """
                tool: file.read
                call_id: call_read
                args:
                {"path":"README.md"}
            """.trimIndent(),
        )

        assertEquals("file.read", state.title)
        assertEquals("Completed", state.statusLabel)
        assertEquals(GraphChatToolCallTone.Completed, state.tone)
        assertEquals(false, state.hasTextualOutput)
        assertEquals(false, state.defaultExpanded)
        assertEquals(null, state.result)
    }

    @Test
    fun parsesMergedToolPreview() {
        val preview = parseGraphChatToolBlock(
            language = "tool-merged",
            body = """
                tool: shell.exec
                call_id: call_shell
                args:
                {"cmd":"./gradlew test"}
                result:
                stdout:
                BUILD SUCCESSFUL
            """.trimIndent(),
        )

        assertEquals("shell.exec", preview.title)
        assertEquals("call_shell", preview.callId)
        assertEquals("""{"cmd":"./gradlew test"}""", preview.parameters)
        assertEquals("stdout:\nBUILD SUCCESSFUL", preview.result)
    }

    @Test
    fun mergesToolResultStreamsIntoPreview() {
        val processed = preprocessGraphChatToolBlocks(
            """
            ```tool-call
            {"tool":"shell.exec","call_id":"call_stream","args":{"cmd":"test"}}
            ```

            ```tool-result
            {"call_id":"call_stream","result":{"status":"stream","stream":"stdout","chunk":"line 1\n"}}
            ```

            ```tool-result
            {"call_id":"call_stream","result":{"status":"stream","stream":"stderr","chunk":"warn\n"}}
            ```
            """.trimIndent(),
        )

        val block = parseRichMessageBlocks(processed.processedContent).single() as RichMessageBlock.Code
        val preview = parseGraphChatToolBlock(block.language, block.code)

        assertEquals("tool-merged", block.language)
        assertEquals("shell.exec", preview.title)
        assertEquals("call_stream", preview.callId)
        assertEquals("""{"cmd":"test"}""", preview.parameters)
        assertEquals("stdout:\nline 1\nstderr:\nwarn", preview.result)
    }

    @Test
    fun readsFlatJsonToolEntries() {
        assertEquals(
            listOf(
                GraphChatToolEntry("cmd", """"./gradlew test"""", GraphChatToolValueKind.String),
                GraphChatToolEntry("cwd", """"apps/android"""", GraphChatToolValueKind.String),
                GraphChatToolEntry("timeout", "120", GraphChatToolValueKind.Number),
                GraphChatToolEntry("env", """{"CI":true}""", GraphChatToolValueKind.Object),
            ),
            graphChatToolEntries("""{"cmd":"./gradlew test","cwd":"apps/android","timeout":120,"env":{"CI":true}}"""),
        )
    }

    @Test
    fun formatsToolCallParametersAsJsonObject() {
        assertEquals(
            """
            {
              "cmd": "./gradlew \"test\"",
              "timeout": 120,
              "interactive": false,
              "env": {"CI":true},
              "items": ["a","b"],
              "missing": null
            }
            """.trimIndent(),
            formatGraphChatToolParameterObject(
                listOf(
                    "cmd" to "./gradlew \"test\"",
                    "timeout" to "120",
                    "interactive" to "false",
                    "env" to """{"CI":true}""",
                    "items" to """["a","b"]""",
                    "missing" to "null",
                ),
            ),
        )
    }

    @Test
    fun formatsEmptyToolCallParametersAsJsonObject() {
        assertEquals("{}", formatGraphChatToolParameterObject(emptyList()))
    }

    @Test
    fun readsColonToolEntries() {
        assertEquals(
            listOf(
                GraphChatToolEntry("stdout", "BUILD SUCCESSFUL", GraphChatToolValueKind.Raw),
                GraphChatToolEntry("stderr", "warn", GraphChatToolValueKind.Raw),
            ),
            graphChatToolEntries(
                """
                stdout: BUILD SUCCESSFUL
                stderr: warn
                """.trimIndent(),
            ),
        )
    }

    @Test
    fun buildsInlineToolEntryDisplayState() {
        assertEquals(
            GraphChatToolEntryDisplayState(
                key = "cmd",
                value = "gradlew test",
                displayValue = "\"gradlew test\"",
                copyValue = "\"gradlew test\"",
                kind = GraphChatToolValueKind.String,
                displayKind = GraphChatToolEntryDisplayKind.Inline,
                tone = GraphChatToolEntryValueTone.String,
            ),
            buildGraphChatToolEntryDisplayState(
                entry = GraphChatToolEntry("cmd", "gradlew test", GraphChatToolValueKind.String),
                renderObjectAsBlock = false,
            ),
        )
        assertEquals(
            GraphChatToolEntryDisplayState(
                key = "missing",
                value = "",
                displayValue = "null",
                copyValue = "null",
                kind = GraphChatToolValueKind.Null,
                displayKind = GraphChatToolEntryDisplayKind.Inline,
                tone = GraphChatToolEntryValueTone.Null,
            ),
            buildGraphChatToolEntryDisplayState(
                entry = GraphChatToolEntry("missing", "", GraphChatToolValueKind.Null),
                renderObjectAsBlock = false,
            ),
        )
    }

    @Test
    fun buildsOutputBlockToolEntryDisplayState() {
        assertEquals(
            GraphChatToolEntryDisplayState(
                key = "stdout",
                value = "",
                displayValue = "(empty)",
                copyValue = "",
                kind = GraphChatToolValueKind.Raw,
                displayKind = GraphChatToolEntryDisplayKind.OutputBlock,
                tone = GraphChatToolEntryValueTone.Raw,
            ),
            buildGraphChatToolEntryDisplayState(
                entry = GraphChatToolEntry("stdout", "", GraphChatToolValueKind.Raw),
                renderObjectAsBlock = false,
            ),
        )
        assertEquals(
            GraphChatToolEntryDisplayState(
                key = "items",
                value = """["a",2]""",
                displayValue = """
                [
                  "a",
                  2
                ]
                """.trimIndent(),
                copyValue = """["a",2]""",
                kind = GraphChatToolValueKind.Object,
                displayKind = GraphChatToolEntryDisplayKind.OutputBlock,
                tone = GraphChatToolEntryValueTone.Object,
            ),
            buildGraphChatToolEntryDisplayState(
                entry = GraphChatToolEntry("items", """["a",2]""", GraphChatToolValueKind.Object),
                renderObjectAsBlock = true,
            ),
        )
    }

    @Test
    fun readsJsonPrimitiveToolEntryKinds() {
        assertEquals(
            listOf(
                GraphChatToolEntry("ok", "true", GraphChatToolValueKind.Boolean),
                GraphChatToolEntry("missing", "null", GraphChatToolValueKind.Null),
                GraphChatToolEntry("items", """["a","b"]""", GraphChatToolValueKind.Object),
            ),
            graphChatToolEntries("""{"ok":true,"missing":null,"items":["a","b"]}"""),
        )
    }

    @Test
    fun keepsEmptyJsonObjectAsStructuredEntries() {
        assertEquals(emptyList<GraphChatToolEntry>(), graphChatToolEntries("{}"))
        assertEquals(emptyList<GraphChatToolEntry>(), graphChatToolEntries("{   }"))
    }

    @Test
    fun readsTopLevelJsonArrayAsStructuredValueEntry() {
        assertEquals(
            listOf(GraphChatToolEntry("value", """["a",2]""", GraphChatToolValueKind.Object)),
            graphChatToolEntries("""["a",2]"""),
        )
    }

    @Test
    fun readsPrimitiveJsonResultValuesAsValueEntries() {
        assertEquals(
            listOf(GraphChatToolEntry("value", "\"done\"", GraphChatToolValueKind.String)),
            graphChatToolEntries("\"done\"", GraphChatToolEntryUsage.Result),
        )
        assertEquals(
            listOf(GraphChatToolEntry("value", "42", GraphChatToolValueKind.Number)),
            graphChatToolEntries("42", GraphChatToolEntryUsage.Result),
        )
        assertEquals(
            listOf(GraphChatToolEntry("value", "false", GraphChatToolValueKind.Boolean)),
            graphChatToolEntries("false", GraphChatToolEntryUsage.Result),
        )
    }

    @Test
    fun omitsBlankJsonResultScalars() {
        assertEquals(emptyList<GraphChatToolEntry>(), graphChatToolEntries("null", GraphChatToolEntryUsage.Result))
        assertEquals(emptyList<GraphChatToolEntry>(), graphChatToolEntries("\"\"", GraphChatToolEntryUsage.Result))
    }

    @Test
    fun detectsTextualOutputLikeWebToolCall() {
        assertEquals(true, graphChatToolHasTextualOutput("plain output"))
        assertEquals(true, graphChatToolHasTextualOutput("\"plain output\""))
        assertEquals(true, graphChatToolHasTextualOutput("""{"stdout":"ok"}"""))
        assertEquals(false, graphChatToolHasTextualOutput("""{"stdout":""}"""))
        assertEquals(false, graphChatToolHasTextualOutput("42"))
        assertEquals(false, graphChatToolHasTextualOutput("false"))
        assertEquals(false, graphChatToolHasTextualOutput("null"))
        assertEquals(false, graphChatToolHasTextualOutput("\"\""))
    }

    @Test
    fun expandsCompletedToolCallForPrimitiveStringResultOnly() {
        val stringState = buildGraphChatToolCallState(
            language = "tool-merged",
            body = """
                tool: task.note
                call_id: call_note
                args:
                {}
                result:
                "saved"
            """.trimIndent(),
        )
        val numberState = buildGraphChatToolCallState(
            language = "tool-merged",
            body = """
                tool: task.count
                call_id: call_count
                args:
                {}
                result:
                42
            """.trimIndent(),
        )

        assertEquals(true, stringState.hasTextualOutput)
        assertEquals(true, stringState.defaultExpanded)
        assertEquals(false, numberState.hasTextualOutput)
        assertEquals(false, numberState.defaultExpanded)
    }

    @Test
    fun prettyPrintsToolJsonValues() {
        assertEquals(
            """
            {
              "ok": true,
              "items": [
                "a,b",
                2
              ]
            }
            """.trimIndent(),
            prettyGraphChatToolJsonValue("""{"ok":true,"items":["a,b",2]}"""),
        )
    }

    @Test
    fun prettyPrintsTopLevelToolJsonArrays() {
        assertEquals(
            """
            [
              "a",
              2
            ]
            """.trimIndent(),
            prettyGraphChatToolJsonValue("""["a",2]"""),
        )
    }

    @Test
    fun prettyPrintsNestedToolJsonWithEscapedStringsAndKeepsRawCopyValue() {
        val raw = """{"request":{"path":"apps/android","args":["a,b",{"quoted":"x\"y"}]},"ok":true}"""
        val displayState = buildGraphChatToolEntryDisplayState(
            entry = GraphChatToolEntry("request", raw, GraphChatToolValueKind.Object),
            renderObjectAsBlock = true,
        )

        assertEquals(
            """
            {
              "request": {
                "path": "apps/android",
                "args": [
                  "a,b",
                  {
                    "quoted": "x\"y"
                  }
                ]
              },
              "ok": true
            }
            """.trimIndent(),
            displayState.displayValue,
        )
        assertEquals(raw, displayState.copyValue)
    }

    @Test
    fun fallsBackToRawValueEntry() {
        assertEquals(
            listOf(GraphChatToolEntry("value", "plain output", GraphChatToolValueKind.Raw)),
            graphChatToolEntries("plain output"),
        )
    }
}
