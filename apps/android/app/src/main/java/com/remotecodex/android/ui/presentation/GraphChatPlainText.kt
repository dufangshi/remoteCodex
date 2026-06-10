package com.remotecodex.android.ui.presentation

const val LargeMessagePreviewChars = 4_000

sealed interface GraphChatPlainTextSegment {
    data class Text(val text: String) : GraphChatPlainTextSegment
    data class Url(val text: String, val href: String) : GraphChatPlainTextSegment
}

sealed interface GraphChatInlineSegment {
    data class Text(val text: String) : GraphChatInlineSegment
    data class Url(val text: String, val href: String) : GraphChatInlineSegment
    data class Code(val text: String) : GraphChatInlineSegment
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

fun graphChatPlainTextSegments(text: String): List<GraphChatPlainTextSegment> {
    if (text.isEmpty()) return emptyList()

    val markdownLinkPattern = Regex("!?\\[([^\\]\\n]+)]\\(([^)\\s]+)\\)")
    val segments = mutableListOf<GraphChatPlainTextSegment>()
    var cursor = 0

    for (match in markdownLinkPattern.findAll(text)) {
        val start = match.range.first
        if (start > cursor) {
            segments += plainUrlSegments(text.substring(cursor, start))
        }

        val label = match.groupValues.getOrNull(1).orEmpty()
        val href = match.groupValues.getOrNull(2).orEmpty()
        if (label.isNotBlank() && href.isNotBlank()) {
            segments += GraphChatPlainTextSegment.Url(
                text = label,
                href = normalizeGraphChatHref(href),
            )
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
    return graphChatPlainTextSegments(text).flatMap { segment ->
        when (segment) {
            is GraphChatPlainTextSegment.Text -> inlineStyleSegments(segment.text)
            is GraphChatPlainTextSegment.Url -> listOf(
                GraphChatInlineSegment.Url(text = segment.text, href = segment.href),
            )
        }
    }
}

private fun inlineStyleSegments(text: String): List<GraphChatInlineSegment> {
    if (text.isEmpty()) return emptyList()

    val pattern = Regex("(`[^`\\n]+`|~~[^~\\n]+~~|\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|(?<!\\w)\\*[^*\\n]+\\*(?!\\w)|(?<!\\w)_[^_\\n]+_(?!\\w))")
    val segments = mutableListOf<GraphChatInlineSegment>()
    var cursor = 0

    for (match in pattern.findAll(text)) {
        val start = match.range.first
        if (start > cursor) {
            segments += GraphChatInlineSegment.Text(text.substring(cursor, start))
        }
        segments += styledInlineSegment(match.value)
        cursor = match.range.last + 1
    }

    if (cursor < text.length) {
        segments += GraphChatInlineSegment.Text(text.substring(cursor))
    }

    return segments
}

private fun styledInlineSegment(raw: String): GraphChatInlineSegment {
    return when {
        raw.startsWith("`") && raw.endsWith("`") -> {
            GraphChatInlineSegment.Code(raw.substring(1, raw.length - 1))
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
