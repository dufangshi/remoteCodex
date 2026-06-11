package com.remotecodex.android.ui.components

import android.graphics.BitmapFactory
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.BaselineShift
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.InlineImagePreview
import com.remotecodex.android.ui.presentation.GraphChatInlineSegment
import com.remotecodex.android.ui.presentation.GraphChatToolEntry
import com.remotecodex.android.ui.presentation.GraphChatToolValueKind
import com.remotecodex.android.ui.presentation.MathToken
import com.remotecodex.android.ui.presentation.basenameFromAssetPath
import com.remotecodex.android.ui.presentation.buildMathPresentation
import com.remotecodex.android.ui.presentation.hasLikelyMarkdownSyntax
import com.remotecodex.android.ui.presentation.graphChatHighlightedCode
import com.remotecodex.android.ui.presentation.graphChatInlineSegments
import com.remotecodex.android.ui.presentation.graphChatMessagePreviewText
import com.remotecodex.android.ui.presentation.graphChatShowMoreLabel
import com.remotecodex.android.ui.presentation.graphChatToolEntries
import com.remotecodex.android.ui.presentation.isSafeMarkdownImageSource
import com.remotecodex.android.ui.presentation.looksLikeMoleculeStructure
import com.remotecodex.android.ui.presentation.RichMessageBlock
import com.remotecodex.android.ui.presentation.TableAlignment
import com.remotecodex.android.ui.presentation.TableColumn
import com.remotecodex.android.ui.presentation.parsePlainRichMessageBlocks
import com.remotecodex.android.ui.presentation.parseRichMessageBlocks
import com.remotecodex.android.ui.presentation.GraphChatToolCallTone
import com.remotecodex.android.ui.presentation.GraphChatToolEntryDisplayKind
import com.remotecodex.android.ui.presentation.GraphChatToolEntryValueTone
import com.remotecodex.android.ui.presentation.GraphChatToolEntryUsage
import com.remotecodex.android.ui.presentation.buildGraphChatToolCallState
import com.remotecodex.android.ui.presentation.buildGraphChatToolEntryDisplayState
import com.remotecodex.android.ui.presentation.preprocessGraphChatToolBlocks
import com.remotecodex.android.ui.presentation.shouldShowGraphChatMessageExpansion
import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.delay

private const val UrlAnnotationTag = "URL"

private sealed interface RichInlineRun {
    data class Text(val segments: List<GraphChatInlineSegment>) : RichInlineRun
    data class Image(val segment: GraphChatInlineSegment.Image) : RichInlineRun
}

@Composable
fun RichMessageContent(
    content: String,
    modifier: Modifier = Modifier,
    imageResolver: (suspend (String) -> InlineImagePreview?)? = null,
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
                is RichMessageBlock.Paragraph -> RichParagraph(
                    text = block.text,
                    imageResolver = imageResolver,
                )
                is RichMessageBlock.Heading -> RichHeading(block = block)
                is RichMessageBlock.Bullet -> RichBullet(
                    text = block.text,
                    checked = block.checked,
                    level = block.level,
                    imageResolver = imageResolver,
                )
                is RichMessageBlock.OrderedItem -> RichOrderedItem(
                    number = block.number,
                    text = block.text,
                    level = block.level,
                    imageResolver = imageResolver,
                )
                is RichMessageBlock.Quote -> RichQuote(
                    text = block.text,
                    imageResolver = imageResolver,
                )
                RichMessageBlock.HorizontalRule -> RichHorizontalRule()
                is RichMessageBlock.Math -> RichMathBlock(expression = block.expression)
                is RichMessageBlock.Html -> RichHtmlBlock(source = block.source)
                is RichMessageBlock.Table -> RichTable(columns = block.columns, rows = block.rows)
                is RichMessageBlock.Code -> {
                    if (block.language.startsWith("tool-")) {
                        RichToolBlock(language = block.language, code = block.code)
                    } else if (isMoleculeCodeBlock(block.language, block.code)) {
                        InlineMoleculePreviewCard(
                            language = block.language,
                            code = block.code,
                            modifier = Modifier.fillMaxWidth(),
                        )
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
                    graphChatShowMoreLabel(processedContent.length)
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

private fun isMoleculeCodeBlock(language: String, code: String): Boolean {
    val normalized = language.trim().lowercase()
    if (normalized !in setOf("xyz", "extxyz", "cif", "pdb")) {
        return false
    }
    return looksLikeMoleculeStructure(code, normalized)
}

@Composable
private fun RichHtmlBlock(source: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(9.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "HTML",
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
            CopyCodeButton(value = source)
        }
        Text(
            text = source,
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun RichMathBlock(expression: String) {
    val presentation = remember(expression) { buildMathPresentation(expression) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(ThreadColors.InfoSoft.copy(alpha = 0.34f))
            .border(1.dp, ThreadColors.Info.copy(alpha = 0.30f), RoundedCornerShape(9.dp))
            .padding(horizontal = 11.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Formula",
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
            CopyCodeButton(value = presentation.copyText)
        }
        Text(
            text = mathAnnotatedString(presentation.tokens),
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Medium,
        )
    }
}

@Composable
private fun RichToolBlock(language: String, code: String) {
    val state = remember(language, code) { buildGraphChatToolCallState(language, code) }
    val foreground = when (state.tone) {
        GraphChatToolCallTone.Failed -> ThreadColors.Danger
        GraphChatToolCallTone.Running -> ThreadColors.Warning
        GraphChatToolCallTone.Completed -> ThreadColors.Success
    }
    val background = when (state.tone) {
        GraphChatToolCallTone.Failed -> ThreadColors.DangerSoft
        GraphChatToolCallTone.Running -> ThreadColors.WarningSoft
        GraphChatToolCallTone.Completed -> ThreadColors.SuccessSoft
    }
    val toolStatus = when (state.tone) {
        GraphChatToolCallTone.Failed -> ToolStatus.Failed
        GraphChatToolCallTone.Running -> ToolStatus.Running
        GraphChatToolCallTone.Completed -> ToolStatus.Completed
    }
    GraphAccordion(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .border(1.dp, foreground.copy(alpha = 0.38f), RoundedCornerShape(9.dp)),
    ) {
        GraphAccordionItem(
            title = state.title,
            subtitle = state.callId,
            stateKey = state.stateKey,
            defaultExpanded = state.defaultExpanded,
            showDivider = false,
            titleColor = foreground,
            titleFontFamily = FontFamily.Monospace,
            subtitleColor = ThreadColors.ForegroundMuted,
            backgroundColor = background,
            contentBackgroundColor = ThreadColors.Surface,
            leading = {
                ToolGlyph(color = foreground)
            },
            trailing = {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    ToolStatusBadge(
                        label = state.statusLabel,
                        status = toolStatus,
                        compact = true,
                    )
                }
            },
        ) {
            ToolBlockActions(copyValue = code.trimEnd())
            GraphChatToolSection(title = "Parameters", body = state.parameters)
            state.result?.let { result ->
                GraphChatToolSection(title = "Result", body = result)
            }
        }
    }
}

@Composable
private fun ToolBlockActions(copyValue: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CopyCodeButton(value = copyValue)
    }
}

@Composable
private fun ToolGlyph(
    color: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(
        modifier = modifier
            .padding(top = 2.dp)
            .size(20.dp),
    ) {
        val strokeWidth = 2.dp.toPx()
        val handleStart = Offset(size.width * 0.30f, size.height * 0.72f)
        val handleEnd = Offset(size.width * 0.68f, size.height * 0.34f)
        drawLine(
            color = color,
            start = handleStart,
            end = handleEnd,
            strokeWidth = strokeWidth,
            cap = StrokeCap.Round,
        )
        drawCircle(
            color = color,
            radius = 3.4.dp.toPx(),
            center = Offset(size.width * 0.72f, size.height * 0.28f),
            style = Stroke(width = strokeWidth),
        )
        drawCircle(
            color = color,
            radius = 2.1.dp.toPx(),
            center = Offset(size.width * 0.24f, size.height * 0.78f),
        )
    }
}

@Composable
fun GraphChatToolSection(
    title: String,
    body: String,
    copyText: String? = null,
) {
    val usage = if (title == "Result") GraphChatToolEntryUsage.Result else GraphChatToolEntryUsage.Parameter
    val entries = remember(body, usage) { graphChatToolEntries(body, usage) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        GraphChatToolSectionHeader(title = title, copyText = copyText)
        if (
            entries.size == 1 &&
            entries.first().key == "value" &&
            entries.first().kind == GraphChatToolValueKind.Raw
        ) {
            ToolRawValue(body = entries.first().value)
        } else {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(7.dp))
                    .background(ThreadColors.CodeBackground)
                    .padding(10.dp),
                verticalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                ToolPunctuation(text = "{")
                if (entries.isEmpty()) {
                    ToolPunctuation(text = "  empty")
                } else {
                    entries.forEachIndexed { index, entry ->
                        ToolEntryRow(
                            entry = entry,
                            trailingComma = index < entries.lastIndex,
                            renderObjectAsBlock = title == "Result",
                        )
                    }
                }
                ToolPunctuation(text = "}")
            }
        }
    }
}

@Composable
private fun GraphChatToolSectionHeader(title: String, copyText: String?) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = title,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        copyText?.let { value ->
            CopyCodeButton(value = value)
        }
    }
}

@Composable
private fun ToolEntryRow(
    entry: GraphChatToolEntry,
    trailingComma: Boolean,
    renderObjectAsBlock: Boolean,
) {
    val displayState = remember(entry, renderObjectAsBlock) {
        buildGraphChatToolEntryDisplayState(entry, renderObjectAsBlock)
    }
    if (displayState.displayKind == GraphChatToolEntryDisplayKind.OutputBlock) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                ToolPunctuation(text = "  ")
                ToolEntryKey(key = displayState.key)
                ToolPunctuation(text = ":")
            }
            ToolRawValue(body = displayState.displayValue)
            if (trailingComma) {
                ToolPunctuation(text = ",")
            }
        }
        return
    }

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        ToolPunctuation(text = "  ")
        ToolEntryKey(
            key = displayState.key,
        )
        ToolPunctuation(text = ": ")
        Text(
            text = displayState.displayValue,
            modifier = Modifier
                .weight(1f)
                .horizontalScroll(rememberScrollState()),
            color = toolEntryValueColor(displayState.tone),
            style = MaterialTheme.typography.labelMedium,
            fontFamily = FontFamily.Monospace,
        )
        if (trailingComma) {
            ToolPunctuation(text = ",")
        }
    }
}

@Composable
private fun ToolPunctuation(text: String) {
    Text(
        text = text,
        color = ThreadColors.ForegroundMuted,
        style = MaterialTheme.typography.labelMedium,
        fontFamily = FontFamily.Monospace,
        maxLines = 1,
    )
}

@Composable
private fun ToolEntryKey(
    key: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = "\"$key\"",
        modifier = modifier,
        color = ThreadColors.Info,
        style = MaterialTheme.typography.labelMedium,
        fontFamily = FontFamily.Monospace,
        maxLines = 1,
    )
}

@Composable
private fun toolEntryValueColor(tone: GraphChatToolEntryValueTone): Color {
    return when (tone) {
        GraphChatToolEntryValueTone.String -> ThreadColors.Success
        GraphChatToolEntryValueTone.Number -> ThreadColors.Warning
        GraphChatToolEntryValueTone.Boolean -> ThreadColors.Info
        GraphChatToolEntryValueTone.Null -> ThreadColors.ForegroundMuted
        GraphChatToolEntryValueTone.Object,
        GraphChatToolEntryValueTone.Raw,
        -> ThreadColors.CodeForeground
    }
}

@Composable
private fun ToolRawValue(body: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .clip(RoundedCornerShape(7.dp))
            .background(ThreadColors.CodeBackground)
            .padding(10.dp),
    ) {
        Text(
            text = body,
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
        )
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
private fun RichParagraph(
    text: String,
    imageResolver: (suspend (String) -> InlineImagePreview?)?,
) {
    RichClickableText(
        text = text,
        modifier = Modifier.fillMaxWidth(),
        imageResolver = imageResolver,
    )
}

@Composable
private fun RichBullet(
    text: String,
    checked: Boolean? = null,
    level: Int = 0,
    imageResolver: (suspend (String) -> InlineImagePreview?)?,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = listIndentPadding(level)),
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
            imageResolver = imageResolver,
        )
    }
}

@Composable
private fun RichOrderedItem(
    number: Int,
    text: String,
    level: Int = 0,
    imageResolver: (suspend (String) -> InlineImagePreview?)?,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = listIndentPadding(level)),
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
            imageResolver = imageResolver,
        )
    }
}

private fun listIndentPadding(level: Int) = (level.coerceIn(0, 4) * 16).dp

@Composable
private fun RichQuote(
    text: String,
    imageResolver: (suspend (String) -> InlineImagePreview?)?,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(8.dp))
            .padding(horizontal = 11.dp, vertical = 9.dp),
    ) {
        RichClickableText(
            text = text,
            modifier = Modifier.fillMaxWidth(),
            imageResolver = imageResolver,
        )
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
private fun RichTable(
    columns: List<TableColumn>,
    rows: List<List<String>>,
) {
    if (columns.isEmpty()) return
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(8.dp)),
    ) {
        RichTableRow(
            values = columns.map { it.header },
            alignments = columns.map { it.alignment },
            header = true,
        )
        rows.forEach { row ->
            RichTableRow(
                values = row,
                alignments = columns.map { it.alignment },
                header = false,
            )
        }
    }
}

@Composable
private fun RichTableRow(
    values: List<String>,
    alignments: List<TableAlignment>,
    header: Boolean,
) {
    Row(
        modifier = Modifier
            .background(if (header) ThreadColors.SurfaceStrong else ThreadColors.Surface),
    ) {
        repeat(alignments.size) { columnIndex ->
            val value = values.getOrNull(columnIndex).orEmpty()
            Box(
                modifier = Modifier
                    .border(0.5.dp, ThreadColors.Border)
                    .padding(horizontal = 10.dp, vertical = 8.dp),
            ) {
                Text(
                    text = inlineCodeAndLinkAnnotatedString(value),
                    color = if (header) ThreadColors.Foreground else ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = if (header) FontWeight.SemiBold else FontWeight.Normal,
                    textAlign = when (alignments[columnIndex]) {
                        TableAlignment.Left -> TextAlign.Start
                        TableAlignment.Center -> TextAlign.Center
                        TableAlignment.Right -> TextAlign.End
                    },
                )
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
    var copyState by remember(value) { mutableStateOf(RichCopyFeedbackState.Idle) }

    LaunchedEffect(copyState) {
        if (copyState != RichCopyFeedbackState.Idle) {
            delay(1200)
            copyState = RichCopyFeedbackState.Idle
        }
    }

    GraphButton(
        label = when (copyState) {
            RichCopyFeedbackState.Idle -> "Copy"
            RichCopyFeedbackState.Copied -> "Copied"
            RichCopyFeedbackState.Failed -> "Copy failed"
        },
        size = GraphButtonSize.Small,
        variant = when (copyState) {
            RichCopyFeedbackState.Idle -> GraphButtonVariant.Ghost
            RichCopyFeedbackState.Copied -> GraphButtonVariant.Secondary
            RichCopyFeedbackState.Failed -> GraphButtonVariant.Destructive
        },
        contentDescription = if (copyState == RichCopyFeedbackState.Failed) {
            "Copy code failed"
        } else {
            "Copy code"
        },
        onClick = {
            copyState = try {
                clipboard.setText(AnnotatedString(value))
                RichCopyFeedbackState.Copied
            } catch (_: RuntimeException) {
                RichCopyFeedbackState.Failed
            }
        },
    )
}

private enum class RichCopyFeedbackState {
    Idle,
    Copied,
    Failed,
}

@Composable
private fun RichClickableText(
    text: String,
    modifier: Modifier = Modifier,
    imageResolver: (suspend (String) -> InlineImagePreview?)? = null,
) {
    val segments = graphChatInlineSegments(text)
    if (segments.none { it is GraphChatInlineSegment.Image }) {
        RichAnnotatedText(
            segments = segments,
            modifier = modifier,
        )
        return
    }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        richInlineRuns(segments).forEach { run ->
            when (run) {
                is RichInlineRun.Text -> RichAnnotatedText(
                    segments = run.segments,
                    modifier = Modifier.fillMaxWidth(),
                )
                is RichInlineRun.Image -> RichInlineImage(
                    segment = run.segment,
                    imageResolver = imageResolver,
                )
            }
        }
    }
}

private fun richInlineRuns(segments: List<GraphChatInlineSegment>): List<RichInlineRun> {
    val runs = mutableListOf<RichInlineRun>()
    val pending = mutableListOf<GraphChatInlineSegment>()

    fun flushText() {
        if (pending.isNotEmpty()) {
            runs += RichInlineRun.Text(pending.toList())
            pending.clear()
        }
    }

    segments.forEach { segment ->
        if (segment is GraphChatInlineSegment.Image) {
            flushText()
            runs += RichInlineRun.Image(segment)
        } else {
            pending += segment
        }
    }
    flushText()
    return runs
}

@Composable
private fun RichAnnotatedText(
    segments: List<GraphChatInlineSegment>,
    modifier: Modifier = Modifier,
) {
    val uriHandler = LocalUriHandler.current
    val annotated = inlineSegmentsAnnotatedString(segments)
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
    return inlineSegmentsAnnotatedString(graphChatInlineSegments(text))
}

@Composable
private fun inlineSegmentsAnnotatedString(segments: List<GraphChatInlineSegment>): AnnotatedString {
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
                is GraphChatInlineSegment.Math -> appendInlineMathSegment(segment.expression)
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
                is GraphChatInlineSegment.Image -> {
                    append(segment.label)
                }
            }
        }
    }
}

@Composable
private fun RichInlineImage(
    segment: GraphChatInlineSegment.Image,
    imageResolver: (suspend (String) -> InlineImagePreview?)?,
) {
    var image by remember(segment.source) { mutableStateOf<InlineImagePreview?>(null) }
    var failed by remember(segment.source) { mutableStateOf(false) }
    LaunchedEffect(segment.source, imageResolver) {
        image = null
        failed = false
        val resolver = imageResolver ?: return@LaunchedEffect
        if (!isSafeMarkdownImageSource(segment.source)) return@LaunchedEffect
        val resolved = runCatching { resolver(segment.source) }.getOrNull()
        if (resolved == null) {
            failed = true
        } else {
            image = resolved
        }
    }
    val bitmap = remember(image?.bytes) {
        image?.bytes?.let { bytes ->
            runCatching {
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }.getOrNull()
        }
    }
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.InfoSoft.copy(alpha = 0.34f))
            .border(1.dp, ThreadColors.Info.copy(alpha = 0.34f), RoundedCornerShape(10.dp))
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap,
                contentDescription = segment.label.ifBlank { "Markdown image" },
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(ThreadColors.CodeBackground),
            )
        } else {
            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(8.dp))
                    .background(ThreadColors.CodeBackground)
                    .padding(horizontal = 40.dp, vertical = 24.dp),
            ) {
                Text(
                    text = if (failed) "IMAGE UNAVAILABLE" else "IMAGE",
                    color = if (failed) ThreadColors.Warning else ThreadColors.Info,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
        Text(
            text = segment.label.ifBlank { "Attached image" },
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = image?.filename?.takeIf { it.isNotBlank() }
                ?: basenameFromAssetPath(segment.source).ifBlank { segment.source },
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun AnnotatedString.Builder.appendInlineMathSegment(expression: String) {
    withStyle(
        SpanStyle(
            color = ThreadColors.Info,
            background = ThreadColors.InfoSoft.copy(alpha = 0.58f),
            fontWeight = FontWeight.Medium,
        ),
    ) {
        append(mathAnnotatedString(buildMathPresentation(expression).tokens))
    }
}

@Composable
private fun mathAnnotatedString(tokens: List<MathToken>): AnnotatedString {
    return buildAnnotatedString {
        if (tokens.isEmpty()) {
            append("empty")
        }
        tokens.forEach { token ->
            when (token) {
                is MathToken.Text -> append(token.text)
                is MathToken.Superscript -> {
                    withStyle(
                        SpanStyle(
                            baselineShift = BaselineShift.Superscript,
                            fontSize = MaterialTheme.typography.bodySmall.fontSize,
                            fontWeight = FontWeight.Medium,
                        ),
                    ) {
                        append(token.text)
                    }
                }
                is MathToken.Subscript -> {
                    withStyle(
                        SpanStyle(
                            baselineShift = BaselineShift.Subscript,
                            fontSize = MaterialTheme.typography.bodySmall.fontSize,
                            fontWeight = FontWeight.Medium,
                        ),
                    ) {
                        append(token.text)
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
