package com.remotecodex.android.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ExportFileStoreTest {
    @Test
    fun normalizesExportFilenameAndAddsFormatExtension() {
        assertEquals(
            "thread_export.pdf",
            normalizeExportFilename("""../thread:export""", "application/pdf"),
        )
        assertEquals(
            "transcript.html",
            normalizeExportFilename("transcript", "text/html; charset=utf-8"),
        )
        assertEquals(
            "already.html",
            normalizeExportFilename("already.html", "application/pdf"),
        )
    }

    @Test
    fun normalizesBlankAndLongExportFilename() {
        assertEquals(
            "remote-codex-transcript.pdf",
            normalizeExportFilename("...   ", "application/pdf"),
        )
        val filename = normalizeExportFilename("a".repeat(200), "text/html")
        assertTrue(filename.endsWith(".html"))
        assertTrue(filename.length <= 125)
    }
}
