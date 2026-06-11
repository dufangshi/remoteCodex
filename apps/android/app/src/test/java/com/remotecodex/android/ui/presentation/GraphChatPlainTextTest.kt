package com.remotecodex.android.ui.presentation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

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
        val segments = graphChatPlainTextSegments("Read [architecture docs](docs/android-client-architecture.md), not ![chart](image.png), or www.example.com.")

        assertEquals(
            listOf(
                GraphChatPlainTextSegment.Text("Read "),
                GraphChatPlainTextSegment.Url("architecture docs", "docs/android-client-architecture.md"),
                GraphChatPlainTextSegment.Text(", not "),
                GraphChatPlainTextSegment.Text("![chart](image.png)"),
                GraphChatPlainTextSegment.Text(", or "),
                GraphChatPlainTextSegment.Url("www.example.com", "https://www.example.com"),
                GraphChatPlainTextSegment.Text("."),
            ),
            segments,
        )
    }

    @Test
    fun parsesInlineCodeAndEmphasisAroundLinks() {
        val segments = graphChatInlineSegments(
            "Use `code`, **strong**, *emphasis*, ~~old~~, and [docs](https://example.com).",
        )

        assertEquals(
            listOf(
                GraphChatInlineSegment.Text("Use "),
                GraphChatInlineSegment.Code("code"),
                GraphChatInlineSegment.Text(", "),
                GraphChatInlineSegment.Strong("strong"),
                GraphChatInlineSegment.Text(", "),
                GraphChatInlineSegment.Emphasis("emphasis"),
                GraphChatInlineSegment.Text(", "),
                GraphChatInlineSegment.Strikethrough("old"),
                GraphChatInlineSegment.Text(", and "),
                GraphChatInlineSegment.Url("docs", "https://example.com"),
                GraphChatInlineSegment.Text("."),
            ),
            segments,
        )
    }

    @Test
    fun parsesMultiBacktickInlineCodeSpansLikeMarkdown() {
        val segments = graphChatInlineSegments(
            "Use ``code with ` backtick`` and leave `unterminated alone.",
        )

        assertEquals(
            listOf(
                GraphChatInlineSegment.Text("Use "),
                GraphChatInlineSegment.Code("code with ` backtick"),
                GraphChatInlineSegment.Text(" and leave `unterminated alone."),
            ),
            segments,
        )
    }

    @Test
    fun parsesMarkdownImagesAsInlineImageSegments() {
        val segments = graphChatInlineSegments("Before ![shell preview](apps/android/output/shell-preview.png) after [docs](https://example.com).")

        assertEquals(
            listOf(
                GraphChatInlineSegment.Text("Before "),
                GraphChatInlineSegment.Image("shell preview", "apps/android/output/shell-preview.png"),
                GraphChatInlineSegment.Text(" after "),
                GraphChatInlineSegment.Url("docs", "https://example.com"),
                GraphChatInlineSegment.Text("."),
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

    @Test
    fun formatsLargeMessageShowMoreLabelWithGroupedCharacterCount() {
        assertEquals(
            "Show more (4,020 chars)",
            graphChatShowMoreLabel(LargeMessagePreviewChars + 20, Locale.US),
        )
    }
}
