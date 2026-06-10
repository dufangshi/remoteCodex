package com.remotecodex.android.ui.presentation

const val LargeMessagePreviewChars = 4_000

sealed interface GraphChatPlainTextSegment {
    data class Text(val text: String) : GraphChatPlainTextSegment
    data class Url(val text: String, val href: String) : GraphChatPlainTextSegment
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
