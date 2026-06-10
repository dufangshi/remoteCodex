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
}
