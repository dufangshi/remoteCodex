package com.remotecodex.android.ui.presentation

import com.remotecodex.android.api.SupervisorThreadHistoryItemDetail
import com.remotecodex.android.ui.model.DetailPreview
import org.junit.Assert.assertEquals
import org.junit.Test

class HistoryDetailPresentationTest {
    @Test
    fun preservesBackendContentTypeAndSourcePath() {
        val preview = buildHistoryDetailPreview(
            item = SupervisorThreadHistoryItemDetail(
                id = "item-1",
                kind = "fileRead",
                title = "config.json",
                text = """{"ok":true}""",
                contentType = "application/json",
                sourcePath = "config.json",
            ),
            fallback = DetailPreview(title = "Fallback", text = "fallback"),
        )

        assertEquals("config.json", preview.title)
        assertEquals("application/json", preview.contentType)
        assertEquals("config.json", preview.sourcePath)
        assertEquals("""{"ok":true}""", preview.text)
    }

    @Test
    fun infersCommonHistoryDetailContentTypes() {
        assertEquals(
            "application/json",
            inferHistoryDetailContentType(
                kind = "toolCall",
                title = "result",
                text = """{"items":[1,2]}""",
            ),
        )
        assertEquals(
            "text/markdown",
            inferHistoryDetailContentType(
                kind = "fileRead",
                title = "README.md",
                text = "# Title",
            ),
        )
        assertEquals(
            "image/reference",
            inferHistoryDetailContentType(
                kind = "image",
                title = "screen.png",
                text = "screen.png",
                sourcePath = "output/screen.png",
            ),
        )
    }
}
