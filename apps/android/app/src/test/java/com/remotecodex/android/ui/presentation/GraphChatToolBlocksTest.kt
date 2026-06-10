package com.remotecodex.android.ui.presentation

import org.junit.Assert.assertEquals
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
    fun fallsBackToRawValueEntry() {
        assertEquals(
            listOf(GraphChatToolEntry("value", "plain output", GraphChatToolValueKind.Raw)),
            graphChatToolEntries("plain output"),
        )
    }
}
