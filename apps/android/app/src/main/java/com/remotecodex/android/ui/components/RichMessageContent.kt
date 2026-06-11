package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.presentation.GraphChatInlineSegment
import com.remotecodex.android.ui.presentation.GraphChatToolEntry
import com.remotecodex.android.ui.presentation.GraphChatToolValueKind
import com.remotecodex.android.ui.presentation.basenameFromAssetPath
import com.remotecodex.android.ui.presentation.hasLikelyMarkdownSyntax
import com.remotecodex.android.ui.presentation.graphChatHighlightedCode
import com.remotecodex.android.ui.presentation.graphChatInlineSegments
import com.remotecodex.android.ui.presentation.graphChatMessagePreviewText
import com.remotecodex.android.ui.presentation.graphChatShowMoreLabel
import com.remotecodex.android.ui.presentation.graphChatToolEntries
import com.remotecodex.android.ui.presentation.looksLikeMoleculeStructure
import com.remotecodex.android.ui.presentation.RichMessageBlock
import com.remotecodex.android.ui.presentation.TableAlignment
import com.remotecodex.android.ui.presentation.TableColumn
import com.remotecodex.android.ui.presentation.parsePlainRichMessageBlocks
import com.remotecodex.android.ui.presentation.parseRichMessageBlocks
import com.remotecodex.android.ui.presentation.parseGraphChatToolBlock
import com.remotecodex.android.ui.presentation.preprocessGraphChatToolBlocks
import com.remotecodex.android.ui.presentation.prettyGraphChatToolJsonValue
import com.remotecodex.android.ui.presentation.shouldShowGraphChatMessageExpansion
import com.remotecodex.android.ui.presentation.toolBlockStatus
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
                is RichMessageBlock.Bullet -> RichBullet(
                    text = block.text,
                    checked = block.checked,
                    level = block.level,
                )
                is RichMessageBlock.OrderedItem -> RichOrderedItem(
                    number = block.number,
                    text = block.text,
                    level = block.level,
                )
                is RichMessageBlock.Quote -> RichQuote(text = block.text)
                RichMessageBlock.HorizontalRule -> RichHorizontalRule()
                is RichMessageBlock.Math -> RichMathBlock(expression = block.expression)
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
private fun RichMathBlock(expression: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(ThreadColors.InfoSoft.copy(alpha = 0.34f))
            .border(1.dp, ThreadColors.Info.copy(alpha = 0.30f), RoundedCornerShape(9.dp))
            .padding(horizontal = 11.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = "Formula",
            color = ThreadColors.Info,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = expression.ifBlank { "empty" },
            modifier = Modifier.horizontalScroll(rememberScrollState()),
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun RichToolBlock(language: String, code: String) {
    val status = toolBlockStatus(language, code)
    val preview = remember(language, code) { parseGraphChatToolBlock(language, code) }
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
    val statusLabel = when (status) {
        "completed" -> "Completed"
        "failed" -> "Failed"
        else -> "Running"
    }
    val toolStatus = when (status) {
        "failed" -> ToolStatus.Failed
        "pending" -> ToolStatus.Running
        else -> ToolStatus.Completed
    }
    GraphAccordion(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .border(1.dp, foreground.copy(alpha = 0.38f), RoundedCornerShape(9.dp)),
    ) {
        GraphAccordionItem(
            title = preview.title,
            subtitle = preview.callId,
            stateKey = "tool:${preview.title}:${preview.callId.orEmpty()}:$status:${code.length}",
            defaultExpanded = status != "completed" || !preview.result.isNullOrBlank(),
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
                        label = statusLabel,
                        status = toolStatus,
                        compact = true,
                    )
                }
            },
        ) {
            ToolBlockActions(copyValue = code.trimEnd())
            GraphChatToolSection(title = "Parameters", body = preview.parameters.ifBlank { "{}" })
            preview.result?.takeIf { it.isNotBlank() }?.let { result ->
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
    val entries = remember(body) { graphChatToolEntries(body) }
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
    val shouldUseOutputBlock = (
        entry.kind == GraphChatToolValueKind.Raw &&
            (entry.key in setOf("stdout", "stderr", "result") || entry.value.contains('\n'))
        ) ||
        (renderObjectAsBlock && entry.kind == GraphChatToolValueKind.Object)
    if (shouldUseOutputBlock) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                ToolPunctuation(text = "  ")
                ToolEntryKey(key = entry.key)
                ToolPunctuation(text = ":")
            }
            ToolRawValue(
                body = if (entry.kind == GraphChatToolValueKind.Object) {
                    prettyGraphChatToolJsonValue(entry.value)
                } else {
                    entry.value.ifBlank { "(empty)" }
                },
            )
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
            key = entry.key,
        )
        ToolPunctuation(text = ": ")
        Text(
            text = toolEntryDisplayValue(entry),
            modifier = Modifier
                .weight(1f)
                .horizontalScroll(rememberScrollState()),
            color = toolEntryValueColor(entry.kind),
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

private fun toolEntryDisplayValue(entry: GraphChatToolEntry): String {
    return when (entry.kind) {
        GraphChatToolValueKind.String -> {
            val value = entry.value.trim()
            if (value.startsWith("\"") && value.endsWith("\"")) value else "\"$value\""
        }
        GraphChatToolValueKind.Null -> "null"
        else -> entry.value.ifBlank { "(empty)" }
    }
}

@Composable
private fun toolEntryValueColor(kind: GraphChatToolValueKind): Color {
    return when (kind) {
        GraphChatToolValueKind.String -> ThreadColors.Success
        GraphChatToolValueKind.Number -> ThreadColors.Warning
        GraphChatToolValueKind.Boolean -> ThreadColors.Info
        GraphChatToolValueKind.Null -> ThreadColors.ForegroundMuted
        GraphChatToolValueKind.Object,
        GraphChatToolValueKind.Raw,
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
private fun RichParagraph(text: String) {
    RichClickableText(
        text = text,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun RichBullet(text: String, checked: Boolean? = null, level: Int = 0) {
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
        )
    }
}

@Composable
private fun RichOrderedItem(number: Int, text: String, level: Int = 0) {
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
        )
    }
}

private fun listIndentPadding(level: Int) = (level.coerceIn(0, 4) * 16).dp

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
                is RichInlineRun.Image -> RichInlineImage(segment = run.segment)
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
private fun RichInlineImage(segment: GraphChatInlineSegment.Image) {
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.InfoSoft.copy(alpha = 0.34f))
            .border(1.dp, ThreadColors.Info.copy(alpha = 0.34f), RoundedCornerShape(10.dp))
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(8.dp))
                .background(ThreadColors.CodeBackground)
                .padding(horizontal = 40.dp, vertical = 24.dp),
        ) {
            Text(
                text = "IMAGE",
                color = ThreadColors.Info,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        Text(
            text = segment.label.ifBlank { "Attached image" },
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = basenameFromAssetPath(segment.source).ifBlank { segment.source },
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
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
        ),
    ) {
        append(expression)
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
