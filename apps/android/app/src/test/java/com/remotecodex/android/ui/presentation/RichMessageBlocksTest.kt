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
    fun parsesAllWebMarkdownHeadingLevels() {
        val blocks = parseRichMessageBlocks(
            """
            # One
            ## Two
            ### Three
            #### Four
            ##### Five
            ###### Six
            ####### Not a heading
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Heading(level = 1, text = "One"),
                RichMessageBlock.Heading(level = 2, text = "Two"),
                RichMessageBlock.Heading(level = 3, text = "Three"),
                RichMessageBlock.Heading(level = 4, text = "Four"),
                RichMessageBlock.Heading(level = 5, text = "Five"),
                RichMessageBlock.Heading(level = 6, text = "Six"),
                RichMessageBlock.Paragraph("####### Not a heading"),
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
    fun parsesTablesWithEscapedPipesAndPadsShortRows() {
        val blocks = parseRichMessageBlocks(
            """
            | Pattern | Meaning |
            | --- | --- |
            | `a\|b` | literal pipe |
            | only first |
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Table(
                    columns = listOf(
                        TableColumn("Pattern", TableAlignment.Left),
                        TableColumn("Meaning", TableAlignment.Left),
                    ),
                    rows = listOf(
                        listOf("`a|b`", "literal pipe"),
                        listOf("only first", ""),
                    ),
                ),
            ),
            blocks,
        )
    }

    @Test
    fun parsesSetextHeadingsLikeGfm() {
        val blocks = parseRichMessageBlocks(
            """
            Major heading
            =

            Minor heading
            ---

            - not a heading
            ---
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Heading(level = 1, text = "Major heading"),
                RichMessageBlock.Heading(level = 2, text = "Minor heading"),
                RichMessageBlock.Bullet("not a heading", level = 0),
                RichMessageBlock.HorizontalRule,
            ),
            blocks,
        )
    }

    @Test
    fun preservesHtmlBlocksAsSafeFallback() {
        val blocks = parseRichMessageBlocks(
            """
            <details>
            <summary>Trace</summary>
            <pre>raw output</pre>
            </details>

            After
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Html("<details>\n<summary>Trace</summary>\n<pre>raw output</pre>\n</details>"),
                RichMessageBlock.Paragraph("After"),
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

    @Test
    fun preservesListContinuationLines() {
        val blocks = parseRichMessageBlocks(
            """
            - top line
              continuation line
              second continuation
            - next item

            3. ordered line
               ordered continuation
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Bullet(
                    text = "top line\ncontinuation line\nsecond continuation",
                    level = 0,
                ),
                RichMessageBlock.Bullet("next item", level = 0),
                RichMessageBlock.OrderedItem(
                    number = 3,
                    text = "ordered line\nordered continuation",
                    level = 0,
                ),
            ),
            blocks,
        )
    }

    @Test
    fun keepsNestedListItemsSeparateFromContinuationLines() {
        val blocks = parseRichMessageBlocks(
            """
            - parent
              - child
                child continuation
            - sibling
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Bullet("parent", level = 0),
                RichMessageBlock.Bullet("child\nchild continuation", level = 1),
                RichMessageBlock.Bullet("sibling", level = 0),
            ),
            blocks,
        )
    }

    @Test
    fun parsesTildeCodeFences() {
        val blocks = parseRichMessageBlocks(
            """
            ~~~kotlin
            val value = 2
            ~~~
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Code(language = "kotlin", code = "val value = 2\n"),
            ),
            blocks,
        )
    }

    @Test
    fun parsesCodeFenceInfoStringsLikeWebMarkdownRenderer() {
        val blocks = parseRichMessageBlocks(
            """
            ```kotlin title=Main.kt
            val value = 3
            ```

            ~~~~ json filename=data.json
            {"ok": true}
            ~~~~~
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Code(language = "kotlin", code = "val value = 3\n"),
                RichMessageBlock.Code(language = "json", code = "{\"ok\": true}\n"),
            ),
            blocks,
        )
    }

    @Test
    fun preservesShorterFenceInsideLongerCodeBlock() {
        val blocks = parseRichMessageBlocks(
            """
            ````markdown
            ```kotlin
            val nested = true
            ```
            ````
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Code(
                    language = "markdown",
                    code = "```kotlin\nval nested = true\n```\n",
                ),
            ),
            blocks,
        )
    }

    @Test
    fun parsesDisplayMathBlocks() {
        val blocks = parseRichMessageBlocks(
            """
            Before

            ${'$'}${'$'}
            E = mc^2
            ${'$'}${'$'}

            \[
            \int_0^1 x^2 dx
            \]

            After
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Paragraph("Before"),
                RichMessageBlock.Math("E = mc^2"),
                RichMessageBlock.Math("\\int_0^1 x^2 dx"),
                RichMessageBlock.Paragraph("After"),
            ),
            blocks,
        )
    }

    @Test
    fun parsesSingleLineDisplayMathBlocks() {
        val blocks = parseRichMessageBlocks(
            """
            ${'$'}${'$'}a^2 + b^2 = c^2${'$'}${'$'}

            \[x = y + z\]
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                RichMessageBlock.Math("a^2 + b^2 = c^2"),
                RichMessageBlock.Math("x = y + z"),
            ),
            blocks,
        )
    }

    @Test
    fun detectsMathAsMarkdownSyntax() {
        assertEquals(true, hasLikelyMarkdownSyntax("Use ${'$'}x + y${'$'} inline."))
        assertEquals(true, hasLikelyMarkdownSyntax("\\[x = y\\]"))
    }

    @Test
    fun parsesInlineMathSegments() {
        assertEquals(
            listOf(
                GraphChatInlineSegment.Text("Use "),
                GraphChatInlineSegment.Math("x + y"),
                GraphChatInlineSegment.Text(" and "),
                GraphChatInlineSegment.Math("\\alpha"),
                GraphChatInlineSegment.Text("."),
            ),
            graphChatInlineSegments("Use ${'$'}x + y${'$'} and \\(\\alpha\\)."),
        )
    }
}
