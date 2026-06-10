package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.presentation.GraphChatInlineSegment
import com.remotecodex.android.ui.presentation.hasLikelyMarkdownSyntax
import com.remotecodex.android.ui.presentation.graphChatHighlightedCode
import com.remotecodex.android.ui.presentation.graphChatInlineSegments
import com.remotecodex.android.ui.presentation.graphChatMessagePreviewText
import com.remotecodex.android.ui.presentation.RichMessageBlock
import com.remotecodex.android.ui.presentation.parsePlainRichMessageBlocks
import com.remotecodex.android.ui.presentation.parseRichMessageBlocks
import com.remotecodex.android.ui.presentation.preprocessGraphChatToolBlocks
import com.remotecodex.android.ui.presentation.shouldShowGraphChatMessageExpansion
import com.remotecodex.android.ui.presentation.toolBlockStatus
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.delay

private const val UrlAnnotationTag = "URL"

@Composable
fun RichMessageContent(
    content: String,
    modifier: Modifier = Modifier,
) {
    val processedContent = preprocessGraphChatToolBlocks(content).processedContent
    var expanded by remember(processedContent) { mutableStateOf(false) }
    val shouldShowExpansion = shouldShowGraphChatMessageExpansion(processedContent)
    val displayContent = graphChatMessagePreviewText(
        text = processedContent,
        expanded = expanded,
    )
    val blocks = if (hasLikelyMarkdownSyntax(displayContent)) {
        parseRichMessageBlocks(displayContent)
    } else {
        parsePlainRichMessageBlocks(displayContent)
    }
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        blocks.forEach { block ->
            when (block) {
                is RichMessageBlock.Paragraph -> RichParagraph(text = block.text)
                is RichMessageBlock.Heading -> RichHeading(block = block)
                is RichMessageBlock.Bullet -> RichBullet(text = block.text, checked = block.checked)
                is RichMessageBlock.OrderedItem -> RichOrderedItem(number = block.number, text = block.text)
                is RichMessageBlock.Quote -> RichQuote(text = block.text)
                RichMessageBlock.HorizontalRule -> RichHorizontalRule()
                is RichMessageBlock.Table -> RichTable(rows = block.rows)
                is RichMessageBlock.Code -> {
                    if (block.language.startsWith("tool-")) {
                        RichToolBlock(language = block.language, code = block.code)
                    } else {
                        RichCodeBlock(language = block.language, code = block.code)
                    }
                }
            }
        }
        if (shouldShowExpansion) {
            GraphButton(
                label = if (expanded) {
                    "Show less"
                } else {
                    "Show more (${processedContent.length} chars)"
                },
                modifier = Modifier.fillMaxWidth(),
                size = GraphButtonSize.Small,
                variant = GraphButtonVariant.Outline,
                contentDescription = if (expanded) "Collapse message" else "Expand full message",
                onClick = { expanded = !expanded },
            )
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
            CopyCodeButton(value = code.trimEnd())
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
private fun RichHeading(block: RichMessageBlock.Heading) {
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
    RichClickableText(
        text = text,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun RichBullet(text: String, checked: Boolean? = null) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = when (checked) {
                true -> "✓"
                false -> "□"
                null -> "•"
            },
            color = if (checked == true) ThreadColors.Success else ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = if (checked == null) FontWeight.Normal else FontWeight.SemiBold,
        )
        RichClickableText(
            text = text,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun RichOrderedItem(number: Int, text: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "$number.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.SemiBold,
        )
        RichClickableText(
            text = text,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun RichQuote(text: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(8.dp))
            .padding(horizontal = 11.dp, vertical = 9.dp),
    ) {
        RichClickableText(text = text, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun RichHorizontalRule() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(ThreadColors.BorderStrong),
    )
}

@Composable
private fun RichTable(rows: List<List<String>>) {
    if (rows.isEmpty()) return
    val columnCount = rows.maxOf { it.size }.coerceAtLeast(1)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(8.dp)),
    ) {
        rows.forEachIndexed { rowIndex, row ->
            Row(
                modifier = Modifier
                    .background(if (rowIndex == 0) ThreadColors.SurfaceStrong else ThreadColors.Surface),
            ) {
                repeat(columnCount) { columnIndex ->
                    val value = row.getOrNull(columnIndex).orEmpty()
                    Box(
                        modifier = Modifier
                            .border(0.5.dp, ThreadColors.Border)
                            .padding(horizontal = 10.dp, vertical = 8.dp),
                    ) {
                        Text(
                            text = inlineCodeAndLinkAnnotatedString(value),
                            color = if (rowIndex == 0) ThreadColors.Foreground else ThreadColors.ForegroundSoft,
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = if (rowIndex == 0) FontWeight.SemiBold else FontWeight.Normal,
                        )
                    }
                }
            }
        }
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
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ThreadColors.Surface.copy(alpha = 0.18f))
                .padding(horizontal = 10.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = language.ifBlank { "text" },
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
            )
            CopyCodeButton(value = code.trimEnd())
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
private fun CopyCodeButton(value: String) {
    val clipboard = LocalClipboardManager.current
    var copied by remember(value) { mutableStateOf(false) }

    LaunchedEffect(copied) {
        if (copied) {
            delay(1200)
            copied = false
        }
    }

    GraphButton(
        label = if (copied) "Copied" else "Copy",
        size = GraphButtonSize.Small,
        variant = if (copied) GraphButtonVariant.Secondary else GraphButtonVariant.Ghost,
        contentDescription = "Copy code",
        onClick = {
            clipboard.setText(AnnotatedString(value))
            copied = true
        },
    )
}

@Composable
private fun RichClickableText(
    text: String,
    modifier: Modifier = Modifier,
) {
    val uriHandler = LocalUriHandler.current
    val annotated = inlineCodeAndLinkAnnotatedString(text)
    ClickableText(
        text = annotated,
        modifier = modifier,
        style = MaterialTheme.typography.bodyLarge.copy(color = ThreadColors.Foreground),
        onClick = { offset ->
            annotated
                .getStringAnnotations(tag = UrlAnnotationTag, start = offset, end = offset)
                .firstOrNull()
                ?.let { annotation -> uriHandler.openUri(annotation.item) }
        },
    )
}

@Composable
private fun inlineCodeAndLinkAnnotatedString(text: String): AnnotatedString {
    val segments = graphChatInlineSegments(text)
    return buildAnnotatedString {
        segments.forEach { segment ->
            when (segment) {
                is GraphChatInlineSegment.Text -> append(segment.text)
                is GraphChatInlineSegment.Url -> {
                    pushStringAnnotation(tag = UrlAnnotationTag, annotation = segment.href)
                    withStyle(
                        SpanStyle(
                            color = ThreadColors.Info,
                            fontWeight = FontWeight.Medium,
                            textDecoration = TextDecoration.Underline,
                        ),
                    ) {
                        append(segment.text)
                    }
                    pop()
                }
                is GraphChatInlineSegment.Code -> appendInlineCodeSegment(segment.text)
                is GraphChatInlineSegment.Strong -> {
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
                        append(segment.text)
                    }
                }
                is GraphChatInlineSegment.Emphasis -> {
                    withStyle(SpanStyle(fontStyle = FontStyle.Italic)) {
                        append(segment.text)
                    }
                }
                is GraphChatInlineSegment.Strikethrough -> {
                    withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) {
                        append(segment.text)
                    }
                }
            }
        }
    }
}

@Composable
private fun AnnotatedString.Builder.appendInlineCodeSegment(text: String) {
    withStyle(
        SpanStyle(
            color = ThreadColors.ForegroundSoft,
            background = ThreadColors.SurfaceStrong,
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
        ),
    ) {
        append(text)
    }
}
