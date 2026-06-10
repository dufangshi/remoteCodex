package com.remotecodex.android.ui.presentation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GraphChatPlainTextTest {
    @Test
    fun normalizesWwwUrls() {
        assertEquals("https://www.example.com/docs", normalizeGraphChatHref("www.example.com/docs"))
        assertEquals("https://example.com/docs", normalizeGraphChatHref("https://example.com/docs"))
    }

    @Test
    fun linkifiesUrlsAndKeepsTrailingPunctuationAsText() {
        val segments = graphChatPlainTextSegments("Open www.example.com/docs, then https://example.dev/test.")

        assertEquals(
            listOf(
                GraphChatPlainTextSegment.Text("Open "),
                GraphChatPlainTextSegment.Url("www.example.com/docs", "https://www.example.com/docs"),
                GraphChatPlainTextSegment.Text(","),
                GraphChatPlainTextSegment.Text(" then "),
                GraphChatPlainTextSegment.Url("https://example.dev/test", "https://example.dev/test"),
                GraphChatPlainTextSegment.Text("."),
            ),
            segments,
        )
    }

    @Test
    fun linkifiesMarkdownInlineLinksBeforePlainUrls() {
        val segments = graphChatPlainTextSegments("Read [architecture docs](docs/android-client-architecture.md) or www.example.com.")

        assertEquals(
            listOf(
                GraphChatPlainTextSegment.Text("Read "),
                GraphChatPlainTextSegment.Url("architecture docs", "docs/android-client-architecture.md"),
                GraphChatPlainTextSegment.Text(" or "),
                GraphChatPlainTextSegment.Url("www.example.com", "https://www.example.com"),
                GraphChatPlainTextSegment.Text("."),
            ),
            segments,
        )
    }

    @Test
    fun previewsLargeNonStreamingMessagesAtWebThreshold() {
        val text = "a".repeat(LargeMessagePreviewChars + 20)

        assertTrue(shouldShowGraphChatMessageExpansion(text))
        assertFalse(shouldShowGraphChatMessageExpansion(text, streaming = true))
        assertEquals("${"a".repeat(LargeMessagePreviewChars)}\n\n...", graphChatMessagePreviewText(text, expanded = false))
        assertEquals(text, graphChatMessagePreviewText(text, expanded = true))
        assertEquals(text, graphChatMessagePreviewText(text, expanded = false, streaming = true))
    }
}
