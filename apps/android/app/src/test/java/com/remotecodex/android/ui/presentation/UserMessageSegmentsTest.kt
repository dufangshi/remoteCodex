package com.remotecodex.android.ui.presentation

import org.junit.Assert.assertEquals
import org.junit.Test

class UserMessageSegmentsTest {
    @Test
    fun parsesPlainTextWithoutAttachments() {
        assertEquals(
            listOf(UserMessageSegment.Text("Continue the Android build.")),
            parseUserMessageSegments("Continue the Android build."),
        )
    }

    @Test
    fun parsesPhotoAndFileTokensBetweenTextSegments() {
        val segments = parseUserMessageSegments(
            "Inspect this:\n[PHOTO apps/android/output/shell-preview.png]\nthen update [FILE docs/android-client-architecture.md]",
        )

        assertEquals(
            listOf(
                UserMessageSegment.Text("Inspect this:\n"),
                UserMessageSegment.Photo("apps/android/output/shell-preview.png"),
                UserMessageSegment.Text("\nthen update "),
                UserMessageSegment.File("docs/android-client-architecture.md"),
            ),
            segments,
        )
    }

    @Test
    fun preservesUrlTextAroundAttachmentTokensForLinkification() {
        val segments = parseUserMessageSegments(
            "Open www.example.com/docs, then [FILE docs/android-client-architecture.md] and https://example.dev/run.",
        )

        assertEquals(
            listOf(
                UserMessageSegment.Text("Open www.example.com/docs, then "),
                UserMessageSegment.File("docs/android-client-architecture.md"),
                UserMessageSegment.Text(" and https://example.dev/run."),
            ),
            segments,
        )
        assertEquals(
            listOf(
                GraphChatPlainTextSegment.Text("Open "),
                GraphChatPlainTextSegment.Url("www.example.com/docs", "https://www.example.com/docs"),
                GraphChatPlainTextSegment.Text(","),
                GraphChatPlainTextSegment.Text(" then "),
            ),
            graphChatPlainTextSegments((segments.first() as UserMessageSegment.Text).text),
        )
        assertEquals(
            listOf(
                GraphChatPlainTextSegment.Text(" and "),
                GraphChatPlainTextSegment.Url("https://example.dev/run", "https://example.dev/run"),
                GraphChatPlainTextSegment.Text("."),
            ),
            graphChatPlainTextSegments((segments.last() as UserMessageSegment.Text).text),
        )
    }

    @Test
    fun preservesMalformedOrBlankAttachmentTokensAsText() {
        assertEquals(
            listOf(UserMessageSegment.Text("[PHOTO ] [FILE]")),
            parseUserMessageSegments("[PHOTO ] [FILE]"),
        )
    }

    @Test
    fun extractsBasenameFromUnixWindowsAndTrailingSlashPaths() {
        assertEquals("shell-preview.png", basenameFromAssetPath("apps/android/output/shell-preview.png"))
        assertEquals("thread.log", basenameFromAssetPath("C:\\Users\\u\\thread.log"))
        assertEquals("output", basenameFromAssetPath("apps/android/output/"))
        assertEquals("", basenameFromAssetPath("   "))
    }

    @Test
    fun buildsPhotoAttachmentPresentationState() {
        assertEquals(
            UserMessageAttachmentState(
                kind = UserMessageAttachmentKind.Photo,
                path = "apps/android/output/shell-preview.png",
                fileName = "shell-preview.png",
                typeLabel = "PHOTO",
                fallbackLabel = "Attached image",
                accessibilityLabel = "image attachment: shell-preview.png",
            ),
            buildUserMessageAttachmentState(
                UserMessageSegment.Photo("apps/android/output/shell-preview.png"),
            ),
        )
    }

    @Test
    fun buildsFileAttachmentPresentationStateWithFallbackName() {
        assertEquals(
            UserMessageAttachmentState(
                kind = UserMessageAttachmentKind.File,
                path = "   ",
                fileName = "Attached file",
                typeLabel = "FILE",
                fallbackLabel = "Attached file",
                accessibilityLabel = "file attachment: Attached file",
            ),
            buildUserMessageAttachmentState(UserMessageSegment.File("   ")),
        )
    }
}
