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
                RichMessageBlock.Bullet("first", level = 0),
                RichMessageBlock.Bullet("second", level = 0),
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
                RichMessageBlock.OrderedItem(number = 1, text = "Read web renderer", level = 0),
                RichMessageBlock.OrderedItem(number = 2, text = "Port native behavior", level = 0),
                RichMessageBlock.Bullet(text = "shipped", checked = true, level = 0),
                RichMessageBlock.Bullet(text = "pending", checked = false, level = 0),
                RichMessageBlock.HorizontalRule,
                RichMessageBlock.Table(
                    columns = listOf(
                        TableColumn("Area", TableAlignment.Left),
                        TableColumn("Status", TableAlignment.Left),
                    ),
                    rows = listOf(
                        listOf("Links", "Done"),
                        listOf("Tables", "Native"),
                    ),
                ),
            ),
            blocks,
        )
    }

    @Test
    fun parsesTableColumnAlignment() {
        val blocks = parseRichMessageBlocks(
            """
            | Area | Count | State |
            | :--- | ---: | :---: |
            | Links | 3 | Done |
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Table(
                    columns = listOf(
                        TableColumn("Area", TableAlignment.Left),
                        TableColumn("Count", TableAlignment.Right),
                        TableColumn("State", TableAlignment.Center),
                    ),
                    rows = listOf(
                        listOf("Links", "3", "Done"),
                    ),
                ),
            ),
            blocks,
        )
    }

    @Test
    fun preservesNestedListLevels() {
        val blocks = parseRichMessageBlocks(
            """
            - top
              - child
                1. ordered child
                  - deep child
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Bullet("top", level = 0),
                RichMessageBlock.Bullet("child", level = 1),
                RichMessageBlock.OrderedItem(number = 1, text = "ordered child", level = 2),
                RichMessageBlock.Bullet("deep child", level = 3),
            ),
            blocks,
        )
    }
}
