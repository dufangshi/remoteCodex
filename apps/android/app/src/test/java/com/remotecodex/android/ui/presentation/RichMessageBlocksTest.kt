package com.remotecodex.android.ui.presentation

import org.junit.Assert.assertEquals
import org.junit.Test

class RichMessageBlocksTest {
    @Test
    fun parsesExistingBasicMarkdownBlocks() {
        val blocks = parseRichMessageBlocks(
            """
            ## Summary

            - first
            - second

            ```kotlin
            val value = 1
            ```
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Heading(level = 2, text = "Summary"),
                RichMessageBlock.Bullet("first"),
                RichMessageBlock.Bullet("second"),
                RichMessageBlock.Code(language = "kotlin", code = "val value = 1\n"),
            ),
            blocks,
        )
    }

    @Test
    fun parsesGfmBlocks() {
        val blocks = parseRichMessageBlocks(
            """
            > Keep this visible
            > across lines

            1. Read web renderer
            2. Port native behavior

            - [x] shipped
            - [ ] pending

            ---

            | Area | Status |
            | --- | --- |
            | Links | Done |
            | Tables | Native |
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Quote("Keep this visible\nacross lines"),
                RichMessageBlock.OrderedItem(number = 1, text = "Read web renderer"),
                RichMessageBlock.OrderedItem(number = 2, text = "Port native behavior"),
                RichMessageBlock.Bullet(text = "shipped", checked = true),
                RichMessageBlock.Bullet(text = "pending", checked = false),
                RichMessageBlock.HorizontalRule,
                RichMessageBlock.Table(
                    rows = listOf(
                        listOf("Area", "Status"),
                        listOf("Links", "Done"),
                        listOf("Tables", "Native"),
                    ),
                ),
            ),
            blocks,
        )
    }
}
