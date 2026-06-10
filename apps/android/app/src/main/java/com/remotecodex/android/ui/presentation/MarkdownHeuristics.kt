package com.remotecodex.android.ui.presentation

private val blockMarkdownPatterns = listOf(
    Regex("(?m)^(?: {0,3})#{1,6}\\s+\\S"),
    Regex("(?m)^(?: {0,3})>{1,}\\s*\\S"),
    Regex("(?m)^(?: {0,3})(?:[-+*]|\\d{1,9}[.)])\\s+(?:\\[[ xX]\\]\\s+)?\\S"),
    Regex("(?m)^(?: {0,3})(?:```|~~~)"),
    Regex("(?m)^(?: {0,3})(?:[-*_]\\s*){3,}$"),
)

private val tableMarkdownPattern = Regex(
    "(?m)^(?:\\|?[^|\\n]+\\|[^|\\n]+(?:\\|[^|\\n]+)*\\|?\\s*\\n\\|?\\s*:?-{3,}:?\\s*(?:\\|\\s*:?-{3,}:?\\s*)+\\|?\\s*$)",
)
private val inlineLinkPattern = Regex("!?\\[[^\\]\\n]+\\]\\([^)]+\\)")
private val inlineCodePattern = Regex("`[^`\\n]+`")
private val strongEmphasisPattern = Regex("(?:\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__)")
private val emphasisPattern = Regex("(^|[^\\w])(?:\\*[^*\\n]+\\*|_[^_\\n]+_)(?=[^\\w]|$)")
private val strikethroughPattern = Regex("~~[^~\\n]+~~")

fun hasLikelyMarkdownSyntax(text: String): Boolean {
    val trimmed = text.trim()
    if (trimmed.isEmpty()) {
        return false
    }

    if (
        blockMarkdownPatterns.any { it.containsMatchIn(trimmed) } ||
        tableMarkdownPattern.containsMatchIn(trimmed)
    ) {
        return true
    }

    if (!Regex("[`\\[\\]*_~!]").containsMatchIn(trimmed)) {
        return false
    }

    return inlineLinkPattern.containsMatchIn(trimmed) ||
        inlineCodePattern.containsMatchIn(trimmed) ||
        strongEmphasisPattern.containsMatchIn(trimmed) ||
        emphasisPattern.containsMatchIn(trimmed) ||
        strikethroughPattern.containsMatchIn(trimmed)
}
