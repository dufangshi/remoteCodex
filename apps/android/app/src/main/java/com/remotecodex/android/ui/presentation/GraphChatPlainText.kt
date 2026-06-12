package com.remotecodex.android.ui.presentation

import java.text.NumberFormat
import java.util.Locale

const val LargeMessagePreviewChars = 4_000

sealed interface GraphChatPlainTextSegment {
    data class Text(val text: String) : GraphChatPlainTextSegment
    data class Url(val text: String, val href: String) : GraphChatPlainTextSegment
}

sealed interface GraphChatInlineSegment {
    data class Text(val text: String) : GraphChatInlineSegment
    data class Url(val text: String, val href: String) : GraphChatInlineSegment
    data class Image(val label: String, val source: String) : GraphChatInlineSegment
    data class Code(val text: String) : GraphChatInlineSegment
    data class Math(val expression: String) : GraphChatInlineSegment
    data class Strong(val text: String) : GraphChatInlineSegment
    data class Emphasis(val text: String) : GraphChatInlineSegment
    data class Strikethrough(val text: String) : GraphChatInlineSegment
}

fun graphChatMessagePreviewText(
    text: String,
    expanded: Boolean,
    streaming: Boolean = false,
): String {
    if (streaming || expanded || text.length <= LargeMessagePreviewChars) {
        return text
    }
    return "${text.take(LargeMessagePreviewChars).trimEnd()}\n\n..."
}

fun shouldShowGraphChatMessageExpansion(text: String, streaming: Boolean = false): Boolean {
    return !streaming && text.length > LargeMessagePreviewChars
}

fun graphChatShowMoreLabel(
    charCount: Int,
    locale: Locale = Locale.getDefault(),
): String {
    val formattedCount = NumberFormat.getIntegerInstance(locale).format(charCount)
    return "Show more ($formattedCount chars)"
}

fun graphChatPlainTextSegments(text: String): List<GraphChatPlainTextSegment> {
    if (text.isEmpty()) return emptyList()

    val markdownLinkPattern = Regex("(!?)\\[([^\\]\\n]+)]\\(([^)\\s]+)\\)")
    val segments = mutableListOf<GraphChatPlainTextSegment>()
    var cursor = 0

    for (match in markdownLinkPattern.findAll(text)) {
        val start = match.range.first
        if (start > cursor) {
            segments += plainUrlSegments(text.substring(cursor, start))
        }

        val imagePrefix = match.groupValues.getOrNull(1).orEmpty()
        val label = match.groupValues.getOrNull(2).orEmpty()
        val href = match.groupValues.getOrNull(3).orEmpty()
        if (imagePrefix.isNotEmpty()) {
            segments += GraphChatPlainTextSegment.Text(match.value)
        } else if (label.isNotBlank() && href.isNotBlank()) {
            segments += GraphChatPlainTextSegment.Url(text = label, href = normalizeGraphChatHref(href))
        } else {
            segments += GraphChatPlainTextSegment.Text(match.value)
        }
        cursor = match.range.last + 1
    }

    if (cursor < text.length) {
        segments += plainUrlSegments(text.substring(cursor))
    }

    return segments
}

fun graphChatInlineSegments(text: String): List<GraphChatInlineSegment> {
    if (text.isEmpty()) return emptyList()

    val imagePattern = Regex("!\\[([^\\]\\n]+)]\\(([^)\\s]+)\\)")
    val segments = mutableListOf<GraphChatInlineSegment>()
    var cursor = 0

    for (match in imagePattern.findAll(text)) {
        val start = match.range.first
        if (start > cursor) {
            segments += nonImageInlineSegments(text.substring(cursor, start))
        }

        val label = match.groupValues.getOrNull(1).orEmpty()
        val source = match.groupValues.getOrNull(2).orEmpty()
        if (label.isNotBlank() && source.isNotBlank()) {
            segments += GraphChatInlineSegment.Image(label = label, source = source)
        } else {
            segments += GraphChatInlineSegment.Text(match.value)
        }
        cursor = match.range.last + 1
    }

    if (cursor < text.length) {
        segments += nonImageInlineSegments(text.substring(cursor))
    }

    return segments
}

private fun nonImageInlineSegments(text: String): List<GraphChatInlineSegment> {
    return graphChatPlainTextSegments(text).flatMap { segment ->
        when (segment) {
            is GraphChatPlainTextSegment.Text -> inlineStyleSegments(segment.text)
            is GraphChatPlainTextSegment.Url -> listOf(GraphChatInlineSegment.Url(segment.text, segment.href))
        }
    }
}

private fun inlineStyleSegments(text: String): List<GraphChatInlineSegment> {
    if (text.isEmpty()) return emptyList()

    val segments = mutableListOf<GraphChatInlineSegment>()
    var cursor = 0

    while (cursor < text.length) {
        val match = findNextInlineStyleMatch(text, cursor) ?: break
        val start = match.start
        if (start > cursor) {
            segments += GraphChatInlineSegment.Text(text.substring(cursor, start))
        }
        segments += styledInlineSegment(match.value)
        cursor = match.endExclusive
    }

    if (cursor < text.length) {
        segments += GraphChatInlineSegment.Text(text.substring(cursor))
    }

    return segments
}

private data class InlineStyleMatch(
    val start: Int,
    val endExclusive: Int,
    val value: String,
)

private val inlineStylePatterns = listOf(
    Regex("\\\\\\([^\\n]+?\\\\\\)"),
    Regex("\\$(?!\\s)[^$\\n]+?(?<!\\s)\\$"),
    Regex("~~[^~\\n]+~~"),
    Regex("\\*\\*[^*\\n]+\\*\\*"),
    Regex("__[^_\\n]+__"),
    Regex("(?<!\\w)\\*[^*\\n]+\\*(?!\\w)"),
    Regex("(?<!\\w)_[^_\\n]+_(?!\\w)"),
)

private fun findNextInlineStyleMatch(text: String, startIndex: Int): InlineStyleMatch? {
    val codeMatch = findNextInlineCodeSpan(text, startIndex)
    val patternMatch = inlineStylePatterns
        .mapNotNull { pattern -> pattern.find(text, startIndex) }
        .minByOrNull { it.range.first }
        ?.let { match ->
            InlineStyleMatch(
                start = match.range.first,
                endExclusive = match.range.last + 1,
                value = match.value,
            )
        }

    return listOfNotNull(codeMatch, patternMatch)
        .minWithOrNull(compareBy<InlineStyleMatch> { it.start }.thenBy { it.endExclusive })
}

private fun findNextInlineCodeSpan(text: String, startIndex: Int): InlineStyleMatch? {
    var index = text.indexOf('`', startIndex)
    while (index >= 0) {
        val delimiterLength = countRepeatedCharacter(text, index, '`')
        val closingIndex = findClosingBacktickDelimiter(
            text = text,
            startIndex = index + delimiterLength,
            delimiterLength = delimiterLength,
        )
        if (closingIndex >= 0) {
            return InlineStyleMatch(
                start = index,
                endExclusive = closingIndex + delimiterLength,
                value = text.substring(index, closingIndex + delimiterLength),
            )
        }
        index = text.indexOf('`', index + delimiterLength)
    }
    return null
}

private fun findClosingBacktickDelimiter(
    text: String,
    startIndex: Int,
    delimiterLength: Int,
): Int {
    var index = text.indexOf('`', startIndex)
    while (index >= 0) {
        val runLength = countRepeatedCharacter(text, index, '`')
        if (runLength == delimiterLength) {
            return index
        }
        index = text.indexOf('`', index + runLength)
    }
    return -1
}

private fun countRepeatedCharacter(text: String, startIndex: Int, character: Char): Int {
    var index = startIndex
    while (index < text.length && text[index] == character) {
        index += 1
    }
    return index - startIndex
}

private fun styledInlineSegment(raw: String): GraphChatInlineSegment {
    return when {
        raw.startsWith("\\(") && raw.endsWith("\\)") -> {
            GraphChatInlineSegment.Math(raw.substring(2, raw.length - 2))
        }
        raw.startsWith("$") && raw.endsWith("$") -> {
            GraphChatInlineSegment.Math(raw.substring(1, raw.length - 1))
        }
        raw.startsWith("`") && raw.endsWith("`") -> {
            val delimiterLength = countRepeatedCharacter(raw, 0, '`')
            GraphChatInlineSegment.Code(raw.substring(delimiterLength, raw.length - delimiterLength))
        }
        raw.startsWith("~~") && raw.endsWith("~~") -> {
            GraphChatInlineSegment.Strikethrough(raw.substring(2, raw.length - 2))
        }
        raw.startsWith("**") && raw.endsWith("**") -> {
            GraphChatInlineSegment.Strong(raw.substring(2, raw.length - 2))
        }
        raw.startsWith("__") && raw.endsWith("__") -> {
            GraphChatInlineSegment.Strong(raw.substring(2, raw.length - 2))
        }
        raw.startsWith("*") && raw.endsWith("*") -> {
            GraphChatInlineSegment.Emphasis(raw.substring(1, raw.length - 1))
        }
        raw.startsWith("_") && raw.endsWith("_") -> {
            GraphChatInlineSegment.Emphasis(raw.substring(1, raw.length - 1))
        }
        else -> GraphChatInlineSegment.Text(raw)
    }
}

private fun plainUrlSegments(text: String): List<GraphChatPlainTextSegment> {
    if (text.isEmpty()) return emptyList()

    val matcher = Regex("\\b(?:https?://|www\\.)[^\\s<>\"'`]+", RegexOption.IGNORE_CASE)
    val trailingPunctuationPattern = Regex("[),.;:!?]+$")
    val segments = mutableListOf<GraphChatPlainTextSegment>()
    var cursor = 0

    for (match in matcher.findAll(text)) {
        val rawMatch = match.value
        val trailingPunctuation = trailingPunctuationPattern.find(rawMatch)?.value.orEmpty()
        val urlText = if (trailingPunctuation.isNotEmpty()) {
            rawMatch.dropLast(trailingPunctuation.length)
        } else {
            rawMatch
        }

        if (urlText.isEmpty()) continue

        val start = match.range.first
        if (start > cursor) {
            segments += GraphChatPlainTextSegment.Text(text.substring(cursor, start))
        }

        segments += GraphChatPlainTextSegment.Url(
            text = urlText,
            href = normalizeGraphChatHref(urlText),
        )

        if (trailingPunctuation.isNotEmpty()) {
            segments += GraphChatPlainTextSegment.Text(trailingPunctuation)
        }

        cursor = match.range.last + 1
    }

    if (cursor < text.length) {
        segments += GraphChatPlainTextSegment.Text(text.substring(cursor))
    }

    return segments
}

fun normalizeGraphChatHref(value: String): String {
    return if (value.startsWith("www.", ignoreCase = true)) {
        "https://$value"
    } else {
        value
    }
}
