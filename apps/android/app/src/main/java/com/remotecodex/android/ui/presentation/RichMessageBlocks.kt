package com.remotecodex.android.ui.presentation

sealed interface RichMessageBlock {
    data class Paragraph(val text: String) : RichMessageBlock
    data class Heading(val level: Int, val text: String) : RichMessageBlock
    data class Bullet(val text: String, val checked: Boolean? = null) : RichMessageBlock
    data class OrderedItem(val number: Int, val text: String) : RichMessageBlock
    data class Quote(val text: String) : RichMessageBlock
    data object HorizontalRule : RichMessageBlock
    data class Table(
        val columns: List<TableColumn>,
        val rows: List<List<String>>,
    ) : RichMessageBlock
    data class Code(val language: String, val code: String) : RichMessageBlock
}

data class TableColumn(
    val header: String,
    val alignment: TableAlignment = TableAlignment.Left,
)

enum class TableAlignment {
    Left,
    Center,
    Right,
}

fun parsePlainRichMessageBlocks(content: String): List<RichMessageBlock> {
    return content
        .trim()
        .split(Regex("\\n{2,}"))
        .mapNotNull { block ->
            val value = block.trim()
            if (value.isEmpty()) {
                null
            } else {
                RichMessageBlock.Paragraph(value)
            }
        }
}

fun parseRichMessageBlocks(content: String): List<RichMessageBlock> {
    val lines = content.trim().lines()
    val blocks = mutableListOf<RichMessageBlock>()
    val paragraph = StringBuilder()
    var codeLanguage: String? = null
    val code = StringBuilder()
    var index = 0

    fun flushParagraph() {
        val value = paragraph.toString().trim()
        if (value.isNotEmpty()) {
            blocks += RichMessageBlock.Paragraph(value)
        }
        paragraph.clear()
    }

    fun appendParagraphLine(value: String) {
        if (paragraph.isNotEmpty()) {
            paragraph.append('\n')
        }
        paragraph.append(value)
    }

    while (index < lines.size) {
        val line = lines[index]
        val trimmed = line.trimEnd()
        if (codeLanguage != null) {
            if (trimmed.trim() == "```") {
                blocks += RichMessageBlock.Code(codeLanguage.orEmpty(), code.toString())
                codeLanguage = null
                code.clear()
            } else {
                code.appendLine(line)
            }
            index += 1
            continue
        }

        val fenceMatch = Regex("^```([A-Za-z0-9_-]*)\\s*$").matchEntire(trimmed.trim())
        if (fenceMatch != null) {
            flushParagraph()
            codeLanguage = fenceMatch.groupValues.getOrNull(1).orEmpty()
            index += 1
            continue
        }

        if (trimmed.isBlank()) {
            flushParagraph()
            index += 1
            continue
        }

        val table = readSimpleMarkdownTable(lines, index)
        if (table != null) {
            flushParagraph()
            blocks += RichMessageBlock.Table(
                columns = table.columns,
                rows = table.rows,
            )
            index = table.nextIndex
            continue
        }

        val heading = Regex("^(#{1,4})\\s+(.+)$").matchEntire(trimmed.trim())
        if (heading != null) {
            flushParagraph()
            blocks += RichMessageBlock.Heading(
                level = heading.groupValues[1].length,
                text = heading.groupValues[2],
            )
            index += 1
            continue
        }

        if (Regex("^(?:[-*_]\\s*){3,}$").matches(trimmed.trim())) {
            flushParagraph()
            blocks += RichMessageBlock.HorizontalRule
            index += 1
            continue
        }

        val quote = Regex("^>\\s?(.*)$").matchEntire(trimmed.trim())
        if (quote != null) {
            flushParagraph()
            val quoteLines = mutableListOf(quote.groupValues[1])
            index += 1
            while (index < lines.size) {
                val nextQuote = Regex("^>\\s?(.*)$").matchEntire(lines[index].trimEnd().trim())
                if (nextQuote == null) break
                quoteLines += nextQuote.groupValues[1]
                index += 1
            }
            blocks += RichMessageBlock.Quote(quoteLines.joinToString("\n").trim())
            continue
        }

        val taskBullet = Regex("^[-*+]\\s+\\[([ xX])]\\s+(.+)$").matchEntire(trimmed.trim())
        if (taskBullet != null) {
            flushParagraph()
            blocks += RichMessageBlock.Bullet(
                text = taskBullet.groupValues[2],
                checked = taskBullet.groupValues[1].equals("x", ignoreCase = true),
            )
            index += 1
            continue
        }

        val bullet = Regex("^[-*+]\\s+(.+)$").matchEntire(trimmed.trim())
        if (bullet != null) {
            flushParagraph()
            blocks += RichMessageBlock.Bullet(bullet.groupValues[1])
            index += 1
            continue
        }

        val ordered = Regex("^(\\d{1,9})[.)]\\s+(.+)$").matchEntire(trimmed.trim())
        if (ordered != null) {
            flushParagraph()
            blocks += RichMessageBlock.OrderedItem(
                number = ordered.groupValues[1].toIntOrNull() ?: 1,
                text = ordered.groupValues[2],
            )
            index += 1
            continue
        }

        appendParagraphLine(trimmed)
        index += 1
    }

    if (codeLanguage != null) {
        blocks += RichMessageBlock.Code(codeLanguage.orEmpty(), code.toString())
    }
    flushParagraph()
    return blocks
}

private data class TableReadResult(
    val columns: List<TableColumn>,
    val rows: List<List<String>>,
    val nextIndex: Int,
)

private fun readSimpleMarkdownTable(lines: List<String>, startIndex: Int): TableReadResult? {
    if (startIndex + 1 >= lines.size) return null
    val header = parseTableRow(lines[startIndex]) ?: return null
    val alignments = parseTableSeparator(lines[startIndex + 1]) ?: return null
    if (header.size < 2 || alignments.size < 2) return null

    val columns = header.mapIndexed { index, title ->
        TableColumn(
            header = title,
            alignment = alignments.getOrNull(index) ?: TableAlignment.Left,
        )
    }
    val rows = mutableListOf<List<String>>()
    var index = startIndex + 2
    while (index < lines.size) {
        val row = parseTableRow(lines[index]) ?: break
        if (row.size < 2) break
        rows += row
        index += 1
    }
    return TableReadResult(columns = columns, rows = rows, nextIndex = index)
}

private fun parseTableRow(line: String): List<String>? {
    val trimmed = line.trim()
    if (!trimmed.contains("|")) return null
    return trimmed
        .trim('|')
        .split('|')
        .map { it.trim() }
}

private fun parseTableSeparator(line: String): List<TableAlignment>? {
    val cells = parseTableRow(line) ?: return null
    if (cells.any { cell -> !Regex(":?-{3,}:?").matches(cell) }) {
        return null
    }
    return cells.map { cell ->
        when {
            cell.startsWith(":") && cell.endsWith(":") -> TableAlignment.Center
            cell.endsWith(":") -> TableAlignment.Right
            else -> TableAlignment.Left
        }
    }
}
