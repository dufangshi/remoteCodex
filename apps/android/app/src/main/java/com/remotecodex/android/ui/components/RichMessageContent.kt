package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.presentation.hasLikelyMarkdownSyntax
import com.remotecodex.android.ui.presentation.graphChatHighlightedCode
import com.remotecodex.android.ui.presentation.preprocessGraphChatToolBlocks
import com.remotecodex.android.ui.presentation.toolBlockStatus
import com.remotecodex.android.ui.theme.ThreadColors

private sealed interface RichBlock {
    data class Paragraph(val text: String) : RichBlock
    data class Heading(val level: Int, val text: String) : RichBlock
    data class Bullet(val text: String) : RichBlock
    data class Code(val language: String, val code: String) : RichBlock
}

@Composable
fun RichMessageContent(
    content: String,
    modifier: Modifier = Modifier,
) {
    val processedContent = preprocessGraphChatToolBlocks(content).processedContent
    val blocks = if (hasLikelyMarkdownSyntax(processedContent)) {
        parseRichBlocks(processedContent)
    } else {
        parsePlainBlocks(processedContent)
    }
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        blocks.forEach { block ->
            when (block) {
                is RichBlock.Paragraph -> RichParagraph(text = block.text)
                is RichBlock.Heading -> RichHeading(block = block)
                is RichBlock.Bullet -> RichBullet(text = block.text)
                is RichBlock.Code -> {
                    if (block.language.startsWith("tool-")) {
                        RichToolBlock(language = block.language, code = block.code)
                    } else {
                        RichCodeBlock(language = block.language, code = block.code)
                    }
                }
            }
        }
    }
}

private fun parsePlainBlocks(content: String): List<RichBlock> {
    return content
        .trim()
        .split(Regex("\\n{2,}"))
        .mapNotNull { block ->
            val value = block.trim()
            if (value.isEmpty()) {
                null
            } else {
                RichBlock.Paragraph(value)
            }
        }
}

@Composable
private fun RichToolBlock(language: String, code: String) {
    val status = toolBlockStatus(language, code)
    val foreground = when (status) {
        "failed" -> ThreadColors.Danger
        "pending" -> ThreadColors.Warning
        else -> ThreadColors.Success
    }
    val background = when (status) {
        "failed" -> ThreadColors.DangerSoft
        "pending" -> ThreadColors.WarningSoft
        else -> ThreadColors.SuccessSoft
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, foreground.copy(alpha = 0.38f), RoundedCornerShape(9.dp)),
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(background)
                .padding(horizontal = 10.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = when (language) {
                    "tool-merged" -> "Tool Result"
                    "tool-call" -> "Tool Call"
                    "tool-result" -> "Tool Output"
                    else -> "Tool"
                },
                modifier = Modifier.weight(1f),
                color = foreground,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = status,
                color = foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .background(ThreadColors.CodeBackground)
                .padding(10.dp),
        ) {
            Text(
                text = code.trimEnd(),
                color = ThreadColors.CodeForeground,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
            )
        }
    }
}

@Composable
private fun RichHeading(block: RichBlock.Heading) {
    Text(
        text = block.text,
        color = ThreadColors.Foreground,
        style = if (block.level <= 2) {
            MaterialTheme.typography.titleMedium
        } else {
            MaterialTheme.typography.bodyLarge
        },
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun RichParagraph(text: String) {
    Text(
        text = inlineCodeAnnotatedString(text),
        color = ThreadColors.Foreground,
        style = MaterialTheme.typography.bodyLarge,
    )
}

@Composable
private fun RichBullet(text: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "•",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.bodyLarge,
        )
        Text(
            text = inlineCodeAnnotatedString(text),
            modifier = Modifier.weight(1f),
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}

@Composable
private fun RichCodeBlock(language: String, code: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(8.dp)),
    ) {
        if (language.isNotBlank()) {
            Text(
                text = language,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ThreadColors.Surface.copy(alpha = 0.18f))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Text(
            text = graphChatHighlightedCode(language = language, code = code),
            modifier = Modifier
                .horizontalScroll(rememberScrollState())
                .padding(10.dp),
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun inlineCodeAnnotatedString(text: String) = buildAnnotatedString {
    val pattern = Regex("`([^`\\n]+)`")
    var cursor = 0
    for (match in pattern.findAll(text)) {
        if (match.range.first > cursor) {
            append(text.substring(cursor, match.range.first))
        }
        val value = match.groupValues.getOrNull(1).orEmpty()
        withStyle(
            SpanStyle(
                color = ThreadColors.ForegroundSoft,
                background = ThreadColors.SurfaceStrong,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Medium,
            ),
        ) {
            append(value)
        }
        cursor = match.range.last + 1
    }
    if (cursor < text.length) {
        append(text.substring(cursor))
    }
}

private fun parseRichBlocks(content: String): List<RichBlock> {
    val lines = content.trim().lines()
    val blocks = mutableListOf<RichBlock>()
    val paragraph = StringBuilder()
    var codeLanguage: String? = null
    val code = StringBuilder()

    fun flushParagraph() {
        val value = paragraph.toString().trim()
        if (value.isNotEmpty()) {
            blocks += RichBlock.Paragraph(value)
        }
        paragraph.clear()
    }

    for (line in lines) {
        val trimmed = line.trimEnd()
        if (codeLanguage != null) {
            if (trimmed.trim() == "```") {
                blocks += RichBlock.Code(codeLanguage.orEmpty(), code.toString())
                codeLanguage = null
                code.clear()
            } else {
                code.appendLine(line)
            }
            continue
        }

        val fenceMatch = Regex("^```([A-Za-z0-9_-]*)\\s*$").matchEntire(trimmed.trim())
        if (fenceMatch != null) {
            flushParagraph()
            codeLanguage = fenceMatch.groupValues.getOrNull(1).orEmpty()
            continue
        }

        if (trimmed.isBlank()) {
            flushParagraph()
            continue
        }

        val heading = Regex("^(#{1,4})\\s+(.+)$").matchEntire(trimmed.trim())
        if (heading != null) {
            flushParagraph()
            blocks += RichBlock.Heading(
                level = heading.groupValues[1].length,
                text = heading.groupValues[2],
            )
            continue
        }

        val bullet = Regex("^[-*+]\\s+(.+)$").matchEntire(trimmed.trim())
        if (bullet != null) {
            flushParagraph()
            blocks += RichBlock.Bullet(bullet.groupValues[1])
            continue
        }

        if (paragraph.isNotEmpty()) {
            paragraph.append('\n')
        }
        paragraph.append(trimmed)
    }

    if (codeLanguage != null) {
        blocks += RichBlock.Code(codeLanguage.orEmpty(), code.toString())
    }
    flushParagraph()
    return blocks
}
