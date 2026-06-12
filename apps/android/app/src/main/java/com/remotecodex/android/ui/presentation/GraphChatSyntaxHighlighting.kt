package com.remotecodex.android.ui.presentation

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import com.remotecodex.android.ui.theme.ThreadColors

private val keywordPattern = Regex(
    "\\b(class|data|fun|val|var|if|else|for|while|return|when|import|package|private|public|const|function|const|let|type|interface|from|export|async|await|def|None|True|False)\\b",
)
private val stringPattern = Regex("(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*')")
private val commentPattern = Regex("(//.*$|#.*$)", RegexOption.MULTILINE)
private val numberPattern = Regex("\\b\\d+(?:\\.\\d+)?\\b")

@Composable
fun graphChatHighlightedCode(language: String, code: String): AnnotatedString {
    val normalizedLanguage = language.lowercase()
    val text = code.trimEnd()
    if (normalizedLanguage in setOf("text", "txt", "csv", "")) {
        return AnnotatedString(text)
    }
    val ranges = buildList {
        addMatches(text, stringPattern, GraphSyntaxToken.String)
        addMatches(text, commentPattern, GraphSyntaxToken.Comment)
        addMatches(text, numberPattern, GraphSyntaxToken.Number)
        addMatches(text, keywordPattern, GraphSyntaxToken.Keyword)
    }.sortedWith(compareBy<GraphSyntaxRange> { it.start }.thenByDescending { it.end - it.start })

    return buildAnnotatedString {
        var cursor = 0
        for (range in ranges) {
            if (range.start < cursor) {
                continue
            }
            if (range.start > cursor) {
                append(text.substring(cursor, range.start))
            }
            withStyle(range.token.style()) {
                append(text.substring(range.start, range.end))
            }
            cursor = range.end
        }
        if (cursor < text.length) {
            append(text.substring(cursor))
        }
    }
}

private fun MutableList<GraphSyntaxRange>.addMatches(
    text: String,
    pattern: Regex,
    token: GraphSyntaxToken,
) {
    pattern.findAll(text).forEach { match ->
        add(GraphSyntaxRange(start = match.range.first, end = match.range.last + 1, token = token))
    }
}

private data class GraphSyntaxRange(
    val start: Int,
    val end: Int,
    val token: GraphSyntaxToken,
)

private enum class GraphSyntaxToken {
    Keyword,
    String,
    Comment,
    Number,
}

@Composable
private fun GraphSyntaxToken.style(): SpanStyle {
    return when (this) {
        GraphSyntaxToken.Keyword -> SpanStyle(
            color = ThreadColors.Info,
            fontWeight = FontWeight.SemiBold,
        )
        GraphSyntaxToken.String -> SpanStyle(color = Color(0xFF86EFAC))
        GraphSyntaxToken.Comment -> SpanStyle(color = ThreadColors.ForegroundMuted)
        GraphSyntaxToken.Number -> SpanStyle(color = ThreadColors.Warning)
    }
}
