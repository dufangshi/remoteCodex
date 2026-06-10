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
}
