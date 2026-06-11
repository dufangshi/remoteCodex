package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.text.ClickableText
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.HistoryGroupPreview
import com.remotecodex.android.ui.model.HistoryItemPreview
import com.remotecodex.android.ui.model.DetailPreview
import com.remotecodex.android.ui.model.LivePlanPreview
import com.remotecodex.android.ui.model.MessagePreview
import com.remotecodex.android.ui.model.PlanStepStatus
import com.remotecodex.android.ui.model.ReasoningPreview
import com.remotecodex.android.ui.model.TimelineAuxiliaryPreview
import com.remotecodex.android.ui.model.TimelineNotePreview
import com.remotecodex.android.ui.model.TimelineSteerPreview
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.model.ToolCallPreview
import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.model.TurnPreview
import com.remotecodex.android.ui.presentation.artifactHistorySummary
import com.remotecodex.android.ui.presentation.basenameFromAssetPath
import com.remotecodex.android.ui.presentation.buildGraphChatHistoryGroupFrameState
import com.remotecodex.android.ui.presentation.buildGraphChatMessageFrameState
import com.remotecodex.android.ui.presentation.buildContextCompactionHistoryState
import com.remotecodex.android.ui.presentation.buildGraphChatReasoningState
import com.remotecodex.android.ui.presentation.FileChangeSummarySegment
import com.remotecodex.android.ui.presentation.FileChangeSummaryTone
import com.remotecodex.android.ui.presentation.fileChangeSummarySegments
import com.remotecodex.android.ui.presentation.formatGraphChatToolParameterObject
import com.remotecodex.android.ui.presentation.formatTrailingPathLabel
import com.remotecodex.android.ui.presentation.buildGraphChatHistoryItemFrameState
import com.remotecodex.android.ui.presentation.historyGroupRowOrdinalLabel
import com.remotecodex.android.ui.presentation.hookHistorySummary
import com.remotecodex.android.ui.presentation.GraphChatHistoryItemFrameState
import com.remotecodex.android.ui.presentation.GraphChatHistoryGroupFrameState
import com.remotecodex.android.ui.presentation.GraphChatMessageFrameState
import com.remotecodex.android.ui.presentation.GraphChatHistoryStatusState
import com.remotecodex.android.ui.presentation.GraphChatHistoryStatusTone
import com.remotecodex.android.ui.presentation.MessageStatusModel
import com.remotecodex.android.ui.presentation.ComposerStatusTone
import com.remotecodex.android.ui.presentation.GraphChatPlainTextSegment
import com.remotecodex.android.ui.presentation.PendingSteerToneState
import com.remotecodex.android.ui.presentation.TimelineNoteToneState
import com.remotecodex.android.ui.presentation.UserMessageAttachmentState
import com.remotecodex.android.ui.presentation.buildGraphChatImageHistoryState
import com.remotecodex.android.ui.presentation.buildGraphChatLivePlanCardState
import com.remotecodex.android.ui.presentation.buildPendingSteerCardState
import com.remotecodex.android.ui.presentation.buildTimelineNoteCardState
import com.remotecodex.android.ui.presentation.parseUserMessageSegments
import com.remotecodex.android.ui.presentation.buildUserMessageAttachmentState
import com.remotecodex.android.ui.presentation.buildPlanStepStatusPresentationState
import com.remotecodex.android.ui.presentation.PlanStepStatusTone
import com.remotecodex.android.ui.presentation.buildGraphChatTurnFrameState
import com.remotecodex.android.ui.presentation.shouldShowHistoryGroupRowTitle
import com.remotecodex.android.ui.presentation.summarizeInlinePreviewText
import com.remotecodex.android.ui.presentation.threadStatusLabel
import com.remotecodex.android.ui.presentation.toolResultStatusLabel
import com.remotecodex.android.ui.presentation.UserMessageSegment
import com.remotecodex.android.ui.presentation.graphChatPlainTextSegments
import com.remotecodex.android.ui.presentation.graphChatHistoryDetailText
import com.remotecodex.android.ui.presentation.graphChatHistoryItemCopyText
import com.remotecodex.android.ui.presentation.graphChatHistoryGroupRowSummary
import com.remotecodex.android.ui.presentation.graphChatHistoryGroupRowDetailTitle
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.delay

private const val UserMessageUrlAnnotationTag = "user-message-url"

@Composable
fun ThreadTimeline(
    turns: List<TurnPreview>,
    modifier: Modifier = Modifier,
    auxiliary: TimelineAuxiliaryPreview = TimelineAuxiliaryPreview(),
    onOpenDetail: (DetailPreview) -> Unit = {},
) {
    LazyColumn(
        modifier = modifier
            .background(ThreadColors.Workspace),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        reverseLayout = false,
        contentPadding = androidx.compose.foundation.layout.PaddingValues(
            start = 8.dp,
            end = 8.dp,
            top = 8.dp,
            bottom = 132.dp,
        ),
    ) {
        if (auxiliary.canLoadEarlier) {
            item(key = "load-earlier") {
                LoadEarlierRow(loading = auxiliary.loadingEarlier)
            }
        }
        if (auxiliary.activityNotes.isNotEmpty()) {
            items(auxiliary.activityNotes, key = { note -> "activity:${note.title}:${note.timeLabel}" }) { note ->
                TimelineNoteCard(note = note, tone = TimelineNoteTone.Activity)
            }
        }
        items(turns, key = { it.index }) { turn ->
            TurnFrame(turn = turn, onOpenDetail = onOpenDetail)
        }
        if (auxiliary.answeredRequestNotes.isNotEmpty()) {
            items(auxiliary.answeredRequestNotes, key = { note -> "answered:${note.title}:${note.timeLabel}" }) { note ->
                TimelineNoteCard(note = note, tone = TimelineNoteTone.Answered)
            }
        }
        if (auxiliary.pendingSteers.isNotEmpty()) {
            items(auxiliary.pendingSteers, key = { steer -> "steer:${steer.timeLabel}:${steer.prompt}" }) { steer ->
                PendingSteerCard(steer = steer)
            }
        }
        auxiliary.ephemeralUserNote?.let { note ->
            item(key = "ephemeral-user-note") {
                EphemeralUserNoteCard(text = note)
            }
        }
    }
}

@Composable
private fun TurnFrame(
    turn: TurnPreview,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    var collapsed by remember(turn.index, turn.optimistic) { mutableStateOf(false) }
    val frameState = buildGraphChatTurnFrameState(turn = turn, collapsed = collapsed)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = frameState.indexLabel,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
                    .padding(horizontal = 8.dp, vertical = 3.dp),
                color = if (frameState.indexTone == ComposerStatusTone.Warning) {
                    ThreadColors.Warning
                } else {
                    ThreadColors.ForegroundMuted
                },
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
            Text(
                text = frameState.timeLabel,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
            ThreadStatusBadge(
                label = frameState.statusLabel,
                status = frameState.status,
            )
            Spacer(modifier = Modifier.weight(1f))
            frameState.tokenSummary?.let { tokenSummary ->
                Text(
                    text = tokenSummary,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            TurnCollapseButton(
                collapsed = collapsed,
                accessibilityLabel = frameState.collapseAccessibilityLabel,
                onClick = { collapsed = !collapsed },
            )
        }
        if (collapsed) {
            Text(
                text = frameState.collapsedSummary,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(ThreadColors.Surface.copy(alpha = 0.72f))
                    .border(1.dp, ThreadColors.Border.copy(alpha = 0.68f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        } else {
            turn.messages.forEach { message ->
                MessageBubble(message = message, onOpenDetail = onOpenDetail)
            }
            turn.livePlan?.let { livePlan ->
                LivePlanCard(livePlan = livePlan)
            }
        }
    }
}

@Composable
private fun TurnCollapseButton(
    collapsed: Boolean,
    accessibilityLabel: String,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(28.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(ThreadColors.Surface.copy(alpha = 0.78f))
            .border(1.dp, ThreadColors.Border.copy(alpha = 0.72f), RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .semantics {
                contentDescription = accessibilityLabel
            },
        contentAlignment = Alignment.Center,
    ) {
        val chevronColor = ThreadColors.ForegroundMuted
        Canvas(modifier = Modifier.size(14.dp)) {
            val stroke = Stroke(width = 1.7.dp.toPx(), cap = StrokeCap.Round)
            val top = if (collapsed) 0.38f else 0.62f
            val center = if (collapsed) 0.62f else 0.38f
            val bottom = if (collapsed) 0.38f else 0.62f
            drawLine(
                color = chevronColor,
                start = Offset(size.width * 0.25f, size.height * top),
                end = Offset(size.width * 0.50f, size.height * center),
                strokeWidth = stroke.width,
                cap = StrokeCap.Round,
            )
            drawLine(
                color = chevronColor,
                start = Offset(size.width * 0.50f, size.height * center),
                end = Offset(size.width * 0.75f, size.height * bottom),
                strokeWidth = stroke.width,
                cap = StrokeCap.Round,
            )
        }
    }
}

@Composable
private fun LoadEarlierRow(loading: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = if (loading) "Loading earlier..." else "Load 10 earlier",
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
        Text(
            text = "History",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
        )
    }
}

@Composable
private fun TimelineNoteCard(
    note: TimelineNotePreview,
    tone: TimelineNoteTone,
) {
    val state = buildTimelineNoteCardState(
        note = note,
        tone = when (tone) {
            TimelineNoteTone.Activity -> TimelineNoteToneState.Activity
            TimelineNoteTone.Answered -> TimelineNoteToneState.Answered
        },
    )
    val foreground = if (tone == TimelineNoteTone.Activity) ThreadColors.Info else ThreadColors.Success
    val background = if (tone == TimelineNoteTone.Activity) ThreadColors.InfoSoft else ThreadColors.SuccessSoft
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(background.copy(alpha = 0.54f))
            .border(1.dp, foreground.copy(alpha = 0.34f), RoundedCornerShape(11.dp))
            .padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = state.label,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.Panel.copy(alpha = 0.70f))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                color = foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = state.title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            state.timeLabel?.let { timeLabel ->
                Text(
                    text = timeLabel,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
            }
        }
        state.summaryLines.take(3).forEach { line ->
            Text(
                text = line,
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun PendingSteerCard(steer: TimelineSteerPreview) {
    val state = buildPendingSteerCardState(steer)
    val queuedLike = state.tone == PendingSteerToneState.QueuedUserMessage
    val background = if (queuedLike) ThreadColors.UserBubble else ThreadColors.WarningSoft.copy(alpha = 0.46f)
    val border = if (queuedLike) ThreadColors.UserBubbleBorder else ThreadColors.Warning.copy(alpha = 0.36f)
    val statusColor = if (queuedLike) ThreadColors.UserBubbleText.copy(alpha = 0.76f) else ThreadColors.Warning
    val promptColor = if (queuedLike) ThreadColors.UserBubbleText else ThreadColors.ForegroundSoft
    val timeColor = if (queuedLike) ThreadColors.UserBubbleText.copy(alpha = 0.58f) else ThreadColors.ForegroundMuted
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(11.dp))
            .padding(11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = state.statusLabel,
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(ThreadColors.Panel.copy(alpha = 0.72f))
                .padding(horizontal = 8.dp, vertical = 4.dp),
            color = statusColor,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = state.prompt,
            modifier = Modifier.weight(1f),
            color = promptColor,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        state.timeLabel?.let { timeLabel ->
            Text(
                text = timeLabel,
                color = timeColor,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun EphemeralUserNoteCard(text: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.UserBubble)
            .border(1.dp, ThreadColors.UserBubbleBorder, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = "Pending prompt",
            color = ThreadColors.UserBubbleText.copy(alpha = 0.72f),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = text,
            color = ThreadColors.UserBubbleText,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 4,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private enum class TimelineNoteTone {
    Activity,
    Answered,
}

@Composable
private fun LivePlanCard(livePlan: LivePlanPreview) {
    val state = remember(livePlan) { buildGraphChatLivePlanCardState(livePlan) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = state.title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = state.badgeLabel,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.WarningSoft)
                    .border(1.dp, ThreadColors.Warning.copy(alpha = 0.45f), RoundedCornerShape(999.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                color = ThreadColors.Warning,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
        }
        state.explanation?.let { explanation ->
            Text(
                text = explanation,
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            state.steps.forEach { step ->
                LivePlanStepRow(
                    number = step.number,
                    text = step.text,
                    status = step.status,
                )
            }
        }
    }
}

@Composable
private fun LivePlanStepRow(
    number: Int,
    text: String,
    status: PlanStepStatus,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(9.dp))
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Text(
            text = number.toString(),
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(ThreadColors.SurfaceStrong)
                .padding(horizontal = 8.dp, vertical = 4.dp),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = text,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        PlanStepStatusPill(status = status)
    }
}

@Composable
private fun PlanStepStatusPill(status: PlanStepStatus) {
    val state = buildPlanStepStatusPresentationState(status)
    val foreground = when (state.tone) {
        PlanStepStatusTone.Success -> ThreadColors.Success
        PlanStepStatusTone.Running -> ThreadColors.Warning
        PlanStepStatusTone.Danger -> ThreadColors.Danger
        PlanStepStatusTone.Pending -> ThreadColors.Info
        PlanStepStatusTone.Unknown -> ThreadColors.ForegroundMuted
    }
    val background = when (state.tone) {
        PlanStepStatusTone.Success -> ThreadColors.SuccessSoft
        PlanStepStatusTone.Running -> ThreadColors.WarningSoft
        PlanStepStatusTone.Danger -> ThreadColors.DangerSoft
        PlanStepStatusTone.Pending -> ThreadColors.InfoSoft
        PlanStepStatusTone.Unknown -> ThreadColors.SurfaceStrong
    }
    Box(
        modifier = Modifier
            .size(30.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, foreground.copy(alpha = 0.42f), RoundedCornerShape(999.dp))
            .semantics {
                contentDescription = state.accessibilityLabel
            },
        contentAlignment = Alignment.Center,
    ) {
        if (state.running) {
            RunningDots(color = foreground, dotSize = 4.dp, spacing = 2.dp)
        } else {
            PlanStepStatusIcon(status = status, color = foreground)
        }
    }
}

@Composable
private fun PlanStepStatusIcon(status: PlanStepStatus, color: Color) {
    Canvas(modifier = Modifier.size(15.dp)) {
        val stroke = Stroke(width = 1.75.dp.toPx(), cap = StrokeCap.Round)
        val w = size.width
        val h = size.height
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
            drawLine(color, Offset(w * x1, h * y1), Offset(w * x2, h * y2), stroke.width, StrokeCap.Round)
        }
        when (status) {
            PlanStepStatus.Completed -> {
                drawCircle(color, radius = w * 0.42f, center = Offset(w * 0.5f, h * 0.5f), style = stroke)
                line(0.30f, 0.52f, 0.44f, 0.66f)
                line(0.44f, 0.66f, 0.72f, 0.34f)
            }
            PlanStepStatus.Failed -> {
                drawCircle(color, radius = w * 0.42f, center = Offset(w * 0.5f, h * 0.5f), style = stroke)
                line(0.34f, 0.34f, 0.66f, 0.66f)
                line(0.66f, 0.34f, 0.34f, 0.66f)
            }
            PlanStepStatus.Pending -> {
                drawCircle(color, radius = w * 0.42f, center = Offset(w * 0.5f, h * 0.5f), style = stroke)
                line(0.50f, 0.27f, 0.50f, 0.52f)
                line(0.50f, 0.52f, 0.66f, 0.62f)
            }
            PlanStepStatus.Unknown -> {
                drawCircle(color, radius = w * 0.42f, center = Offset(w * 0.5f, h * 0.5f), style = stroke)
                line(0.40f, 0.38f, 0.44f, 0.30f)
                line(0.44f, 0.30f, 0.56f, 0.30f)
                line(0.56f, 0.30f, 0.62f, 0.38f)
                line(0.62f, 0.38f, 0.50f, 0.52f)
                drawCircle(color, radius = w * 0.035f, center = Offset(w * 0.50f, h * 0.70f))
            }
            PlanStepStatus.Running -> Unit
        }
    }
}

@Composable
private fun MessageBubble(
    message: MessagePreview,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    val frameState = buildGraphChatMessageFrameState(
        author = message.author,
        status = message.status,
        timeLabel = message.timeLabel,
        copyText = message.text,
    )
    Column(
        modifier = Modifier.messageBubbleContainer(isUser = frameState.isUser),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (!frameState.isUser) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                frameState.senderLabel?.let { senderLabel ->
                    AssistantSenderPill(label = senderLabel)
                }
                frameState.headerStatus?.let {
                    MessageStatusBadge(model = it, compact = true)
                }
                Spacer(modifier = Modifier.weight(1f))
                if (frameState.showCopyAction) {
                    AssistantCopyButton(value = message.text)
                }
                frameState.timeLabel?.let { timeLabel ->
                    Text(
                        text = timeLabel,
                        color = ThreadColors.ForegroundMuted,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
        if (!frameState.isUser && frameState.showReasoningBeforeContent && message.reasoningItems.isNotEmpty()) {
            ReasoningAccordion(items = message.reasoningItems)
        }
        if (frameState.isUser) {
            UserMessageBody(text = message.richText)
            UserMessageFooter(frameState = frameState)
        } else {
            RichMessageContent(content = message.richText)
        }
        if (!frameState.isUser && !frameState.showReasoningBeforeContent && message.reasoningItems.isNotEmpty()) {
            ReasoningAccordion(items = message.reasoningItems)
        }
        message.toolCall?.let {
            ToolCallCard(toolCall = it)
        }
        GraphChatHistoryEntries(
            entries = buildGraphChatHistoryEntries(
                items = message.historyItems,
                groups = message.historyGroups,
            ),
            renderCommandGroup = { entry ->
                HistoryGroupCard(group = entry.group, onOpenDetail = onOpenDetail)
            },
            renderFileChangeGroup = { entry ->
                HistoryGroupCard(group = entry.group, onOpenDetail = onOpenDetail)
            },
            renderFileReadGroup = { entry ->
                HistoryGroupCard(group = entry.group, onOpenDetail = onOpenDetail)
            },
            renderItem = { entry ->
                HistoryItemCard(item = entry.item, onOpenDetail = onOpenDetail)
            },
            renderSearchGroup = { entry ->
                HistoryGroupCard(group = entry.group, onOpenDetail = onOpenDetail)
            },
        )
    }
}

@Composable
private fun UserMessageFooter(
    frameState: GraphChatMessageFrameState,
) {
    if (!frameState.showFooterMetadata) {
        return
    }
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        frameState.footerStatus?.let { MessageStatusBadge(model = it, compact = true) }
        frameState.timeLabel?.let { timeLabel ->
            Text(
                text = timeLabel,
                modifier = Modifier.padding(start = 8.dp),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun AssistantCopyButton(value: String) {
    val clipboard = LocalClipboardManager.current
    var copyState by remember(value) { mutableStateOf(TimelineCopyFeedbackState.Idle) }

    LaunchedEffect(copyState) {
        if (copyState != TimelineCopyFeedbackState.Idle) {
            delay(1200)
            copyState = TimelineCopyFeedbackState.Idle
        }
    }

    val shape = RoundedCornerShape(7.dp)
    val foreground = when (copyState) {
        TimelineCopyFeedbackState.Idle -> ThreadColors.ForegroundMuted
        TimelineCopyFeedbackState.Copied -> ThreadColors.Info
        TimelineCopyFeedbackState.Failed -> ThreadColors.Danger
    }
    val background = when (copyState) {
        TimelineCopyFeedbackState.Idle -> ThreadColors.Panel
        TimelineCopyFeedbackState.Copied -> ThreadColors.InfoSoft
        TimelineCopyFeedbackState.Failed -> ThreadColors.DangerSoft
    }
    val border = when (copyState) {
        TimelineCopyFeedbackState.Idle -> ThreadColors.Border
        TimelineCopyFeedbackState.Copied -> ThreadColors.Info.copy(alpha = 0.44f)
        TimelineCopyFeedbackState.Failed -> ThreadColors.Danger.copy(alpha = 0.42f)
    }
    Box(
        modifier = Modifier
            .size(28.dp)
            .clip(shape)
            .background(background)
            .border(1.dp, border, shape)
            .semantics {
                contentDescription = when (copyState) {
                    TimelineCopyFeedbackState.Idle -> "Copy assistant reply"
                    TimelineCopyFeedbackState.Copied -> "Assistant reply copied"
                    TimelineCopyFeedbackState.Failed -> "Copy assistant reply failed"
                }
            }
            .clickable {
                copyState = try {
                    clipboard.setText(AnnotatedString(value))
                    TimelineCopyFeedbackState.Copied
                } catch (_: RuntimeException) {
                    TimelineCopyFeedbackState.Failed
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = when (copyState) {
                TimelineCopyFeedbackState.Idle -> "C"
                TimelineCopyFeedbackState.Copied -> "OK"
                TimelineCopyFeedbackState.Failed -> "!"
            },
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun AssistantSenderPill(label: String) {
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.SuccessSoft.copy(alpha = 0.48f))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        color = ThreadColors.Success,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun Modifier.messageBubbleContainer(isUser: Boolean): Modifier {
    val base = fillMaxWidth()
    return if (isUser) {
        base
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.UserBubble)
            .padding(horizontal = 12.dp, vertical = 8.dp)
    } else {
        base.padding(vertical = 2.dp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun UserMessageBody(text: String) {
    val segments = remember(text) { parseUserMessageSegments(text) }
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        segments.forEach { segment ->
            when (segment) {
                is UserMessageSegment.Text -> UserMessageTextSegment(text = segment.text)
                is UserMessageSegment.Photo -> UserPhotoAttachment(path = segment.path)
                is UserMessageSegment.File -> UserFileAttachment(path = segment.path)
            }
        }
    }
}

@Composable
private fun UserMessageTextSegment(text: String) {
    val uriHandler = LocalUriHandler.current
    val linkColor = ThreadColors.Info
    val annotated = remember(text, linkColor) { userMessageAnnotatedString(text, linkColor) }
    ClickableText(
        text = annotated,
        style = MaterialTheme.typography.bodyLarge.copy(color = ThreadColors.UserBubbleText),
        onClick = { offset ->
            annotated
                .getStringAnnotations(tag = UserMessageUrlAnnotationTag, start = offset, end = offset)
                .firstOrNull()
                ?.let { annotation -> uriHandler.openUri(annotation.item) }
        },
    )
}

private fun userMessageAnnotatedString(
    text: String,
    linkColor: Color,
): AnnotatedString {
    return buildAnnotatedString {
        graphChatPlainTextSegments(text).forEach { segment ->
            when (segment) {
                is GraphChatPlainTextSegment.Text -> append(segment.text)
                is GraphChatPlainTextSegment.Url -> {
                    pushStringAnnotation(tag = UserMessageUrlAnnotationTag, annotation = segment.href)
                    withStyle(
                        SpanStyle(
                            color = linkColor,
                            fontWeight = FontWeight.Medium,
                            textDecoration = TextDecoration.Underline,
                        ),
                    ) {
                        append(segment.text)
                    }
                    pop()
                }
            }
        }
    }
}

@Composable
private fun UserPhotoAttachment(path: String) {
    val state = remember(path) { buildUserMessageAttachmentState(UserMessageSegment.Photo(path)) }
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.InfoSoft.copy(alpha = 0.38f))
            .border(1.dp, ThreadColors.Info.copy(alpha = 0.34f), RoundedCornerShape(14.dp))
            .widthIn(max = 124.dp)
            .semantics(mergeDescendants = true) { contentDescription = state.accessibilityLabel }
            .padding(6.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(10.dp))
                .background(ThreadColors.CodeBackground)
                .padding(horizontal = 28.dp, vertical = 22.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = state.typeLabel,
                color = ThreadColors.Info,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        Text(
            text = state.fileName,
            color = ThreadColors.UserBubbleText,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun UserFileAttachment(path: String) {
    val state = remember(path) { buildUserMessageAttachmentState(UserMessageSegment.File(path)) }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.SuccessSoft.copy(alpha = 0.36f))
            .border(1.dp, ThreadColors.Success.copy(alpha = 0.34f), RoundedCornerShape(14.dp))
            .widthIn(max = 192.dp)
            .semantics(mergeDescendants = true) { contentDescription = state.accessibilityLabel }
            .padding(horizontal = 9.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        UserFileGlyph(
            modifier = Modifier
                .size(28.dp),
            color = ThreadColors.Success,
        )
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            Text(
                text = state.fileName,
                color = ThreadColors.UserBubbleText,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = state.fallbackLabel,
                color = ThreadColors.UserBubbleText.copy(alpha = 0.66f),
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun UserFileGlyph(
    modifier: Modifier = Modifier,
    color: Color,
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.SuccessSoft.copy(alpha = 0.92f))
            .border(1.dp, color.copy(alpha = 0.32f), RoundedCornerShape(999.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.size(15.dp)) {
            val stroke = Stroke(width = 1.45.dp.toPx(), cap = StrokeCap.Round)
            val w = size.width
            val h = size.height
            val path = Path().apply {
                moveTo(w * 0.30f, h * 0.14f)
                lineTo(w * 0.58f, h * 0.14f)
                lineTo(w * 0.76f, h * 0.32f)
                lineTo(w * 0.76f, h * 0.86f)
                lineTo(w * 0.30f, h * 0.86f)
                close()
                moveTo(w * 0.58f, h * 0.14f)
                lineTo(w * 0.58f, h * 0.32f)
                lineTo(w * 0.76f, h * 0.32f)
            }
            drawPath(path = path, color = color, style = stroke)
            drawLine(
                color = color,
                start = Offset(w * 0.40f, h * 0.54f),
                end = Offset(w * 0.66f, h * 0.54f),
                strokeWidth = stroke.width,
                cap = StrokeCap.Round,
            )
            drawLine(
                color = color,
                start = Offset(w * 0.40f, h * 0.68f),
                end = Offset(w * 0.58f, h * 0.68f),
                strokeWidth = stroke.width,
                cap = StrokeCap.Round,
            )
        }
    }
}

@Composable
private fun ReasoningAccordion(items: List<ReasoningPreview>) {
    val state = buildGraphChatReasoningState(items)
    if (!state.visible) {
        return
    }
    GraphAccordion(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp)),
    ) {
        GraphAccordionItem(
            title = state.title,
            subtitle = state.subtitle,
            backgroundColor = ThreadColors.Surface,
            showDivider = false,
            leading = {
                ReasoningGlyph(
                    running = state.running,
                    color = if (state.running) ThreadColors.Info else ThreadColors.ForegroundMuted,
                )
            },
            trailing = {
                if (state.running) {
                    RunningDots(color = ThreadColors.Info)
                }
            },
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                CopyTextButton(
                    value = state.text,
                    idleLabel = state.copyLabel,
                    copiedLabel = "Copied",
                    contentDescription = state.copyAccessibilityLabel,
                )
            }
            Text(
                text = state.text,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 224.dp)
                    .verticalScroll(rememberScrollState())
                    .background(ThreadColors.CodeBackground)
                    .padding(12.dp),
                color = ThreadColors.CodeForeground,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
            )
        }
    }
}

@Composable
private fun ReasoningGlyph(
    running: Boolean,
    color: Color,
) {
    val shape = RoundedCornerShape(999.dp)
    Box(
        modifier = Modifier
            .size(30.dp)
            .clip(shape)
            .background(if (running) ThreadColors.InfoSoft else ThreadColors.SurfaceStrong)
            .border(
                1.dp,
                if (running) ThreadColors.Info.copy(alpha = 0.36f) else ThreadColors.Border,
                shape,
            ),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.size(16.dp)) {
            val stroke = Stroke(width = 1.35.dp.toPx(), cap = StrokeCap.Round)
            val w = size.width
            val h = size.height
            fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
                drawLine(
                    color = color,
                    start = Offset(w * x1, h * y1),
                    end = Offset(w * x2, h * y2),
                    strokeWidth = stroke.width,
                    cap = StrokeCap.Round,
                )
            }

            drawCircle(
                color = color,
                radius = w * 0.28f,
                center = Offset(w * 0.38f, h * 0.38f),
                style = stroke,
            )
            drawCircle(
                color = color,
                radius = w * 0.28f,
                center = Offset(w * 0.62f, h * 0.38f),
                style = stroke,
            )
            drawCircle(
                color = color,
                radius = w * 0.30f,
                center = Offset(w * 0.42f, h * 0.64f),
                style = stroke,
            )
            drawCircle(
                color = color,
                radius = w * 0.30f,
                center = Offset(w * 0.58f, h * 0.64f),
                style = stroke,
            )
            line(0.50f, 0.16f, 0.50f, 0.84f)
            line(0.34f, 0.42f, 0.46f, 0.50f)
            line(0.66f, 0.42f, 0.54f, 0.50f)
            line(0.36f, 0.68f, 0.46f, 0.62f)
            line(0.64f, 0.68f, 0.54f, 0.62f)
        }
    }
}

@Composable
private fun CopyTextButton(
    value: String,
    idleLabel: String,
    copiedLabel: String,
    contentDescription: String,
) {
    val clipboard = LocalClipboardManager.current
    var copyState by remember(value) { mutableStateOf(TimelineCopyFeedbackState.Idle) }

    LaunchedEffect(copyState) {
        if (copyState != TimelineCopyFeedbackState.Idle) {
            delay(1200)
            copyState = TimelineCopyFeedbackState.Idle
        }
    }

    GraphButton(
        label = when (copyState) {
            TimelineCopyFeedbackState.Idle -> idleLabel
            TimelineCopyFeedbackState.Copied -> copiedLabel
            TimelineCopyFeedbackState.Failed -> "Copy failed"
        },
        size = GraphButtonSize.Small,
        variant = when (copyState) {
            TimelineCopyFeedbackState.Idle -> GraphButtonVariant.Ghost
            TimelineCopyFeedbackState.Copied -> GraphButtonVariant.Secondary
            TimelineCopyFeedbackState.Failed -> GraphButtonVariant.Destructive
        },
        contentDescription = if (copyState == TimelineCopyFeedbackState.Failed) {
            "$contentDescription failed"
        } else {
            contentDescription
        },
        onClick = {
            copyState = try {
                clipboard.setText(AnnotatedString(value))
                TimelineCopyFeedbackState.Copied
            } catch (_: RuntimeException) {
                TimelineCopyFeedbackState.Failed
            }
        },
    )
}

private enum class TimelineCopyFeedbackState {
    Idle,
    Copied,
    Failed,
}

@Composable
private fun HistoryGroupCard(
    group: HistoryGroupPreview,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    val colors = historyItemColors(group.kind)
    val frameState = buildGraphChatHistoryGroupFrameState(
        kind = group.kind,
        countLabel = group.countLabel,
        statusLabel = group.statusLabel,
        itemCount = group.items.size,
        expanded = group.expandedByDefault,
        changedFiles = group.changedFiles,
        addedLines = group.addedLines,
        removedLines = group.removedLines,
    )
    GraphAccordion(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, colors.border, RoundedCornerShape(10.dp))
    ) {
        GraphAccordionItem(
            title = frameState.title,
            subtitle = frameState.subtitle,
            defaultExpanded = group.expandedByDefault,
            showDivider = false,
            titleColor = colors.foreground,
            backgroundColor = colors.background,
            contentBackgroundColor = colors.background,
            contentDescriptionForExpanded = { expanded ->
                if (expanded) {
                    "Collapse ${frameState.toggleTargetLabel}"
                } else {
                    "Expand ${frameState.toggleTargetLabel}"
                }
            },
            leading = {
                HistoryGroupBadge(group = group, frameState = frameState, colors = colors)
            },
            trailing = {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (frameState.running) {
                        RunningDots(color = colors.foreground, dotSize = 4.dp, spacing = 2.dp)
                    }
                    if (frameState.fileChangeSummarySegments.isNotEmpty()) {
                        FileChangeGroupSummary(segments = frameState.fileChangeSummarySegments)
                    }
                }
            },
        ) {
            group.items.firstOrNull()?.summary?.let { summary ->
                Text(
                    text = summary,
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            group.items.forEachIndexed { index, item ->
                HistoryGroupRow(
                    index = index,
                    item = item,
                    colors = colors,
                    onOpenDetail = onOpenDetail,
                )
            }
        }
    }
}

@Composable
private fun FileChangeGroupSummary(segments: List<FileChangeSummarySegment>) {
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        segments.forEach { segment ->
            FileChangeSummaryPill(segment = segment)
        }
    }
}

@Composable
private fun HistoryGroupBadge(
    group: HistoryGroupPreview,
    frameState: GraphChatHistoryGroupFrameState,
    colors: HistoryItemColors,
) {
    Box(
        modifier = Modifier
            .padding(top = 1.dp, end = 2.dp)
            .size(36.dp),
    ) {
        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .size(31.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(colors.foreground.copy(alpha = 0.12f))
                .border(1.dp, colors.foreground.copy(alpha = 0.30f), RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            HistoryGroupGlyph(
                group = group,
                color = colors.foreground,
            )
        }
        Text(
            text = frameState.countBadgeLabel,
            modifier = Modifier
                .align(Alignment.TopEnd)
                .clip(RoundedCornerShape(999.dp))
                .background(ThreadColors.CodeBackground.copy(alpha = 0.94f))
                .border(1.dp, colors.foreground.copy(alpha = 0.35f), RoundedCornerShape(999.dp))
                .padding(horizontal = 5.dp, vertical = 1.dp),
            color = colors.foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

@Composable
private fun HistoryGroupRow(
    index: Int,
    item: HistoryItemPreview,
    colors: HistoryItemColors,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(ThreadColors.Panel.copy(alpha = 0.58f))
            .border(1.dp, colors.border.copy(alpha = 0.55f), RoundedCornerShape(8.dp))
            .clickable { openHistoryItemDetail(item, index + 1, onOpenDetail) }
            .padding(9.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            historyGroupRowOrdinalLabel(item.kind, index)?.let { label ->
                Text(
                    text = label,
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(colors.foreground.copy(alpha = 0.10f))
                        .border(1.dp, colors.foreground.copy(alpha = 0.22f), RoundedCornerShape(999.dp))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    color = colors.foreground,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                )
            }
            if (shouldShowHistoryGroupRowTitle(item.kind)) {
                Text(
                    text = item.title,
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.labelMedium,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            } else {
                Spacer(modifier = Modifier.weight(1f))
            }
            item.status?.let { status ->
                ToolStatusBadge(
                    label = toolResultStatusLabel(status),
                    status = status,
                    compact = true,
                )
            }
        }
        HistoryGroupRowSummary(item = item)
        if (item.kind == HistoryItemKind.FileChange) {
            FileChangeDeltaRow(item = item)
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            CopyTextButton(
                value = graphChatHistoryItemCopyText(
                    title = item.title,
                    meta = item.meta,
                    status = item.status,
                    summary = item.summary,
                    detail = item.detail,
                ),
                idleLabel = "Copy",
                copiedLabel = "Copied",
                contentDescription = "Copy history item details",
            )
        }
    }
}

@Composable
private fun HistoryItemCard(
    item: HistoryItemPreview,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    val colors = historyItemColors(item.kind)
    val frameState = buildGraphChatHistoryItemFrameState(
        kind = item.kind,
        title = item.title,
        status = item.status,
        meta = item.meta,
        summary = item.summary,
        detail = item.detail,
        actionLabel = item.actionLabel,
        hasDeferredDetail = item.hasDeferredDetail,
        changedFiles = item.changedFiles,
        addedLines = item.addedLines,
        removedLines = item.removedLines,
    )
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(colors.background)
            .border(1.dp, colors.border, RoundedCornerShape(9.dp))
            .padding(11.dp),
        verticalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            HistoryKindGlyph(kind = item.kind, color = colors.foreground)
            Text(
                text = frameState.title,
                modifier = Modifier.weight(1f),
                color = colors.foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            frameState.status?.let { status ->
                HistoryStatusBadge(status = status)
            }
            item.meta?.let { meta ->
                Text(
                    text = meta,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
            }
        }
        when (item.kind) {
            HistoryItemKind.Context -> ContextCompactionSummaryRow(item = item)
            HistoryItemKind.Hook -> HookHistorySummaryRow(item = item)
            HistoryItemKind.Artifact -> ArtifactHistorySummaryBlock(
                item = item,
                colors = colors,
                onOpenDetail = onOpenDetail,
            )
            HistoryItemKind.FileChange -> FileChangeInlineSummary(
                state = frameState,
                colors = colors,
                onOpen = { openHistoryItemDetail(item, null, onOpenDetail, frameState.detailTitle) },
            )
            else -> {
                Text(
                    text = frameState.summary,
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (frameState.running) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(7.dp))
                    .background(ThreadColors.WarningSoft.copy(alpha = 0.72f))
                    .border(1.dp, ThreadColors.Warning.copy(alpha = 0.34f), RoundedCornerShape(7.dp))
                    .padding(horizontal = 9.dp, vertical = 7.dp),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    modifier = Modifier
                        .size(7.dp)
                        .clip(RoundedCornerShape(999.dp))
                        .background(ThreadColors.Warning),
                )
                Text(
                    text = frameState.runningLabel,
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.Warning,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (frameState.showImagePreview) {
            ImageHistoryPreview(item = item, colors = colors, onOpenDetail = onOpenDetail)
        }
        if (frameState.showDetail) {
            item.detail?.let { detail ->
            Text(
                text = detail,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(7.dp))
                    .background(ThreadColors.Panel.copy(alpha = 0.78f))
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(7.dp))
                    .padding(9.dp),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelMedium,
                fontFamily = FontFamily.Monospace,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (frameState.showAction) {
                GraphButton(
                    label = frameState.actionLabel.orEmpty(),
                    variant = GraphButtonVariant.Ghost,
                    icon = GraphActionIcon.Open,
                    contentDescription = frameState.actionAccessibilityLabel,
                    onClick = { openHistoryItemDetail(item, null, onOpenDetail, frameState.detailTitle) },
                )
            }
            Spacer(modifier = Modifier.weight(1f))
            if (frameState.showCopy) {
                CopyTextButton(
                    value = frameState.copyText,
                    idleLabel = "Copy",
                    copiedLabel = "Copied",
                    contentDescription = "Copy history item details",
                )
            }
        }
    }
}

@Composable
private fun HistoryStatusBadge(status: GraphChatHistoryStatusState) {
    val foreground = when (status.tone) {
        GraphChatHistoryStatusTone.Success -> ThreadColors.Success
        GraphChatHistoryStatusTone.Danger -> ThreadColors.Danger
        GraphChatHistoryStatusTone.Running -> ThreadColors.Warning
        GraphChatHistoryStatusTone.Neutral -> ThreadColors.ForegroundMuted
    }
    val background = when (status.tone) {
        GraphChatHistoryStatusTone.Success -> ThreadColors.SuccessSoft
        GraphChatHistoryStatusTone.Danger -> ThreadColors.DangerSoft
        GraphChatHistoryStatusTone.Running -> ThreadColors.WarningSoft
        GraphChatHistoryStatusTone.Neutral -> ThreadColors.SurfaceStrong
    }
    val shape = RoundedCornerShape(999.dp)
    Row(
        modifier = Modifier
            .clip(shape)
            .background(background.copy(alpha = 0.78f))
            .border(1.dp, foreground.copy(alpha = 0.36f), shape)
            .semantics { contentDescription = status.accessibilityLabel }
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (status.tone == GraphChatHistoryStatusTone.Running) {
            RunningDots(color = foreground, dotSize = 3.5.dp, spacing = 1.5.dp)
        } else {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(foreground),
            )
        }
        Text(
            text = status.label,
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun FileChangeInlineSummary(
    state: GraphChatHistoryItemFrameState,
    colors: HistoryItemColors,
    onOpen: () -> Unit,
) {
    val shape = RoundedCornerShape(8.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(ThreadColors.Panel.copy(alpha = 0.58f))
            .border(1.dp, colors.border.copy(alpha = 0.55f), shape)
            .then(
                if (state.fileChangeCanOpen) {
                    Modifier
                        .clickable(onClick = onOpen)
                        .semantics {
                            contentDescription = state.fileChangeOpenAccessibilityLabel
                                ?: "Open file change details"
                        }
                } else {
                    Modifier
                },
            )
            .padding(horizontal = 9.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = state.summary,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelMedium,
            fontFamily = FontFamily.Monospace,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (state.fileChangeSummarySegments.isNotEmpty()) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                state.fileChangeSummarySegments.forEach { segment ->
                    FileChangeSummaryPill(segment = segment)
                }
            }
        }
    }
}

@Composable
private fun ArtifactHistorySummaryBlock(
    item: HistoryItemPreview,
    colors: HistoryItemColors,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    var expanded by remember(item.summary, item.detail, item.artifactTitle, item.artifactSummary) { mutableStateOf(false) }
    val summary = artifactHistorySummary(
        text = item.summary,
        previewText = item.detail,
        artifactType = item.artifactType,
        artifactTitle = item.artifactTitle,
        artifactSummary = item.artifactSummary,
        hasRenderer = item.artifactHasRenderer,
        actionLabel = item.actionLabel,
    )
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(7.dp))
            .background(ThreadColors.Panel.copy(alpha = 0.58f))
            .border(1.dp, colors.border.copy(alpha = 0.55f), RoundedCornerShape(7.dp))
            .clickable { expanded = !expanded }
            .padding(9.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = summary.title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = summary.typeLabel,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(colors.foreground.copy(alpha = 0.10f))
                    .border(1.dp, colors.foreground.copy(alpha = 0.22f), RoundedCornerShape(999.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                color = colors.foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
        }
        if (summary.rendererLabel != null || summary.inspectLabel != null) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                summary.rendererLabel?.let { label ->
                    GraphBadge(
                        label = label,
                        variant = GraphBadgeVariant.Outline,
                    )
                }
                summary.inspectLabel?.let { label ->
                    GraphButton(
                        label = label,
                        variant = GraphButtonVariant.Ghost,
                        icon = GraphActionIcon.Package,
                        contentDescription = summary.inspectAccessibilityLabel,
                        onClick = { openHistoryItemDetail(item, null, onOpenDetail) },
                    )
                }
                Spacer(modifier = Modifier.weight(1f))
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = summary.summary,
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = if (expanded) summary.expandedToggleLabel else summary.collapsedToggleLabel,
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(colors.foreground.copy(alpha = 0.10f))
                    .border(1.dp, colors.foreground.copy(alpha = 0.22f), RoundedCornerShape(999.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                color = colors.foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
        }
        if (expanded) {
            Text(
                text = summary.detailText,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(7.dp))
                    .background(ThreadColors.CodeBackground.copy(alpha = 0.88f))
                    .border(1.dp, ThreadColors.Border.copy(alpha = 0.72f), RoundedCornerShape(7.dp))
                    .padding(9.dp),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                maxLines = 8,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ContextCompactionSummaryRow(
    item: HistoryItemPreview,
) {
    val state = buildContextCompactionHistoryState(
        text = item.summary,
        status = item.status,
        detailText = item.detail,
    )
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = state.primaryText,
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (state.running) {
                RunningDots(color = ThreadColors.Success, dotSize = 4.dp, spacing = 2.dp)
            }
        }
        state.secondaryText?.let { secondary ->
            Text(
                text = secondary,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun HookHistorySummaryRow(
    item: HistoryItemPreview,
) {
    val summary = hookHistorySummary(
        text = item.summary,
        hookEventLabel = item.hookEventLabel,
        hookStatusMessage = item.hookStatusMessage,
        previewText = item.summary,
        hookOutput = item.hookOutput,
    )
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (summary.showMetaLabel) {
            Text(
                text = summary.hookMetaLabel,
                modifier = Modifier.widthIn(max = 160.dp),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            text = summary.displayText,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (summary.showGap) {
            Text(
                text = "...",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun HistoryGroupRowSummary(item: HistoryItemPreview) {
    val summary = summarizeInlinePreviewText(
        graphChatHistoryGroupRowSummary(
            kind = item.kind,
            summary = item.summary,
        ),
    )
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = summary.firstLine,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (summary.showGap) {
            Text(
                text = "...",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
        }
    }
}

private fun openHistoryItemDetail(
    item: HistoryItemPreview,
    index: Int?,
    onOpenDetail: (DetailPreview) -> Unit,
    titleOverride: String? = null,
) {
    val title = titleOverride
        ?: index?.let {
            graphChatHistoryGroupRowDetailTitle(
                kind = item.kind,
                index = it - 1,
                meta = item.meta,
                actionLabel = item.actionLabel,
                title = item.title,
            )
        }
        ?: item.meta
        ?: item.actionLabel
        ?: item.title
    val body = graphChatHistoryDetailText(
        kind = item.kind,
        title = item.title,
        summary = item.summary,
        detail = item.detail,
        hasDeferredDetail = item.hasDeferredDetail,
    )
    onOpenDetail(DetailPreview(title = title, text = body))
}

@Composable
private fun HistoryKindGlyph(kind: HistoryItemKind, color: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(7.dp))
            .background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.35f), RoundedCornerShape(7.dp))
            .padding(6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Canvas(modifier = Modifier.size(16.dp)) {
            val stroke = Stroke(width = 1.45.dp.toPx(), cap = StrokeCap.Round)
            val w = size.width
            val h = size.height
            fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
                drawLine(color, Offset(w * x1, h * y1), Offset(w * x2, h * y2), stroke.width, StrokeCap.Round)
            }
            fun document() {
                val path = Path().apply {
                    moveTo(w * 0.28f, h * 0.16f)
                    lineTo(w * 0.62f, h * 0.16f)
                    lineTo(w * 0.78f, h * 0.32f)
                    lineTo(w * 0.78f, h * 0.84f)
                    lineTo(w * 0.28f, h * 0.84f)
                    close()
                    moveTo(w * 0.62f, h * 0.16f)
                    lineTo(w * 0.62f, h * 0.32f)
                    lineTo(w * 0.78f, h * 0.32f)
                }
                drawPath(path, color, style = stroke)
            }

            when (kind) {
                HistoryItemKind.Command -> {
                    line(0.18f, 0.28f, 0.82f, 0.28f)
                    line(0.18f, 0.28f, 0.18f, 0.78f)
                    line(0.18f, 0.78f, 0.82f, 0.78f)
                    line(0.82f, 0.28f, 0.82f, 0.78f)
                    line(0.30f, 0.44f, 0.43f, 0.53f)
                    line(0.43f, 0.53f, 0.30f, 0.62f)
                    line(0.50f, 0.62f, 0.68f, 0.62f)
                }
                HistoryItemKind.WebSearch -> {
                    drawCircle(color, radius = w * 0.23f, center = Offset(w * 0.43f, h * 0.43f), style = stroke)
                    line(0.60f, 0.60f, 0.80f, 0.80f)
                    line(0.28f, 0.43f, 0.58f, 0.43f)
                    line(0.43f, 0.26f, 0.43f, 0.60f)
                }
                HistoryItemKind.FileRead -> {
                    document()
                    line(0.38f, 0.50f, 0.67f, 0.50f)
                    line(0.38f, 0.64f, 0.58f, 0.64f)
                }
                HistoryItemKind.FileChange -> {
                    document()
                    line(0.34f, 0.64f, 0.58f, 0.40f)
                    line(0.58f, 0.40f, 0.68f, 0.50f)
                }
                HistoryItemKind.Image -> {
                    line(0.18f, 0.24f, 0.82f, 0.24f)
                    line(0.18f, 0.24f, 0.18f, 0.78f)
                    line(0.18f, 0.78f, 0.82f, 0.78f)
                    line(0.82f, 0.24f, 0.82f, 0.78f)
                    drawCircle(color, radius = w * 0.05f, center = Offset(w * 0.66f, h * 0.38f))
                    line(0.26f, 0.70f, 0.44f, 0.52f)
                    line(0.44f, 0.52f, 0.58f, 0.66f)
                    line(0.58f, 0.66f, 0.70f, 0.54f)
                }
                HistoryItemKind.Artifact -> {
                    line(0.22f, 0.36f, 0.50f, 0.20f)
                    line(0.50f, 0.20f, 0.78f, 0.36f)
                    line(0.78f, 0.36f, 0.50f, 0.52f)
                    line(0.50f, 0.52f, 0.22f, 0.36f)
                    line(0.22f, 0.36f, 0.22f, 0.66f)
                    line(0.22f, 0.66f, 0.50f, 0.82f)
                    line(0.50f, 0.82f, 0.78f, 0.66f)
                    line(0.78f, 0.66f, 0.78f, 0.36f)
                    line(0.50f, 0.52f, 0.50f, 0.82f)
                }
                HistoryItemKind.AgentTool -> {
                    drawCircle(color, radius = w * 0.25f, center = Offset(w * 0.50f, h * 0.52f), style = stroke)
                    line(0.36f, 0.46f, 0.36f, 0.46f)
                    line(0.64f, 0.46f, 0.64f, 0.46f)
                    line(0.42f, 0.62f, 0.58f, 0.62f)
                    line(0.50f, 0.18f, 0.50f, 0.28f)
                    drawCircle(color, radius = w * 0.04f, center = Offset(w * 0.50f, h * 0.16f))
                }
                HistoryItemKind.SkillTool -> {
                    line(0.50f, 0.14f, 0.57f, 0.42f)
                    line(0.57f, 0.42f, 0.84f, 0.50f)
                    line(0.84f, 0.50f, 0.57f, 0.58f)
                    line(0.57f, 0.58f, 0.50f, 0.86f)
                    line(0.50f, 0.86f, 0.43f, 0.58f)
                    line(0.43f, 0.58f, 0.16f, 0.50f)
                    line(0.16f, 0.50f, 0.43f, 0.42f)
                    line(0.43f, 0.42f, 0.50f, 0.14f)
                }
                HistoryItemKind.Hook -> {
                    line(0.30f, 0.22f, 0.30f, 0.78f)
                    line(0.70f, 0.22f, 0.70f, 0.78f)
                    line(0.30f, 0.40f, 0.70f, 0.40f)
                    line(0.30f, 0.60f, 0.70f, 0.60f)
                    line(0.18f, 0.32f, 0.30f, 0.40f)
                    line(0.82f, 0.68f, 0.70f, 0.60f)
                }
                HistoryItemKind.Plan -> {
                    line(0.26f, 0.26f, 0.74f, 0.26f)
                    line(0.26f, 0.50f, 0.74f, 0.50f)
                    line(0.26f, 0.74f, 0.74f, 0.74f)
                    drawCircle(color, radius = w * 0.035f, center = Offset(w * 0.16f, h * 0.26f))
                    drawCircle(color, radius = w * 0.035f, center = Offset(w * 0.16f, h * 0.50f))
                    drawCircle(color, radius = w * 0.035f, center = Offset(w * 0.16f, h * 0.74f))
                }
                HistoryItemKind.Context -> {
                    line(0.24f, 0.26f, 0.66f, 0.18f)
                    line(0.24f, 0.26f, 0.24f, 0.76f)
                    line(0.24f, 0.76f, 0.66f, 0.84f)
                    line(0.66f, 0.18f, 0.66f, 0.84f)
                    line(0.66f, 0.32f, 0.78f, 0.38f)
                    line(0.66f, 0.68f, 0.78f, 0.62f)
                }
                HistoryItemKind.ToolCall,
                HistoryItemKind.Generic,
                -> {
                    line(0.24f, 0.68f, 0.66f, 0.26f)
                    drawCircle(color, radius = w * 0.12f, center = Offset(w * 0.70f, h * 0.22f), style = stroke)
                    drawCircle(color, radius = w * 0.07f, center = Offset(w * 0.22f, h * 0.72f))
                }
            }
        }
    }
}

@Composable
private fun HistoryGroupGlyph(
    group: HistoryGroupPreview,
    color: Color,
) {
    Box(
        modifier = Modifier
            .widthIn(min = 30.dp)
            .height(30.dp),
    ) {
        HistoryKindGlyph(kind = group.kind, color = color)
    }
}

@Composable
private fun FileChangeDeltaRow(item: HistoryItemPreview) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        fileChangeSummarySegments(
            changedFiles = item.changedFiles,
            addedLines = item.addedLines,
            removedLines = item.removedLines,
            previewText = item.summary,
        ).forEach { segment ->
            FileChangeSummaryPill(segment = segment)
        }
    }
}

@Composable
private fun FileChangeSummaryPill(segment: FileChangeSummarySegment) {
    when (segment.tone) {
        FileChangeSummaryTone.Added -> DeltaPill(label = segment.label, positive = true)
        FileChangeSummaryTone.Removed -> DeltaPill(label = segment.label, positive = false)
        FileChangeSummaryTone.Files,
        FileChangeSummaryTone.Neutral,
        -> NeutralSummaryPill(label = segment.label)
    }
}

@Composable
private fun NeutralSummaryPill(label: String) {
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.BorderStrong.copy(alpha = 0.58f), RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        color = ThreadColors.ForegroundSoft,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

@Composable
private fun DeltaPill(label: String, positive: Boolean) {
    val foreground = if (positive) ThreadColors.Success else ThreadColors.Danger
    val background = if (positive) ThreadColors.SuccessSoft else ThreadColors.DangerSoft
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, foreground.copy(alpha = 0.45f), RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        color = foreground,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
    )
}

@Composable
private fun historyItemColors(kind: HistoryItemKind): HistoryItemColors {
    return when (kind) {
        HistoryItemKind.Command -> HistoryItemColors(
            background = ThreadColors.WarningSoft.copy(alpha = 0.38f),
            border = ThreadColors.Warning.copy(alpha = 0.34f),
            foreground = ThreadColors.Warning,
        )
        HistoryItemKind.WebSearch -> HistoryItemColors(
            background = ThreadColors.InfoSoft.copy(alpha = 0.46f),
            border = ThreadColors.Info.copy(alpha = 0.36f),
            foreground = ThreadColors.Info,
        )
        HistoryItemKind.FileRead -> HistoryItemColors(
            background = ThreadColors.Surface,
            border = ThreadColors.Info.copy(alpha = 0.25f),
            foreground = ThreadColors.Info,
        )
        HistoryItemKind.FileChange -> HistoryItemColors(
            background = ThreadColors.SuccessSoft.copy(alpha = 0.34f),
            border = ThreadColors.Success.copy(alpha = 0.36f),
            foreground = ThreadColors.Success,
        )
        HistoryItemKind.Image -> HistoryItemColors(
            background = ThreadColors.Surface,
            border = ThreadColors.Info.copy(alpha = 0.30f),
            foreground = ThreadColors.Info,
        )
        HistoryItemKind.Artifact -> HistoryItemColors(
            background = ThreadColors.Surface,
            border = ThreadColors.Warning.copy(alpha = 0.28f),
            foreground = ThreadColors.Warning,
        )
        HistoryItemKind.AgentTool,
        HistoryItemKind.SkillTool -> HistoryItemColors(
            background = ThreadColors.Surface,
            border = ThreadColors.BorderStrong,
            foreground = ThreadColors.ForegroundSoft,
        )
        HistoryItemKind.Plan,
        HistoryItemKind.Context,
        HistoryItemKind.ToolCall,
        HistoryItemKind.Hook,
        HistoryItemKind.Generic -> HistoryItemColors(
            background = ThreadColors.Surface,
            border = ThreadColors.Border,
            foreground = ThreadColors.ForegroundSoft,
        )
    }
}

@Composable
private fun ImageHistoryPreview(
    item: HistoryItemPreview,
    colors: HistoryItemColors,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    val state = buildGraphChatImageHistoryState(
        text = item.summary,
        detail = item.detail,
        assetPath = item.assetPath,
        imageLabel = item.imageLabel,
    )
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, colors.border, RoundedCornerShape(10.dp))
            .clickable {
                onOpenDetail(
                    DetailPreview(
                        title = state.openTitle,
                        text = state.openText,
                    ),
                )
            },
        verticalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .background(colors.foreground.copy(alpha = 0.12f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = state.previewLabel,
                color = colors.foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        state.assetPath?.let { path ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ThreadColors.Panel.copy(alpha = 0.72f))
                    .border(1.dp, colors.border.copy(alpha = 0.42f))
                    .clickable {
                        onOpenDetail(DetailPreview(title = state.openTitle, text = path))
                    }
                    .semantics {
                        contentDescription = state.pathAccessibilityLabel ?: "Open image path"
                    }
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = path,
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "Open",
                    color = colors.foreground,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
                CopyTextButton(
                    value = path,
                    idleLabel = "Copy",
                    copiedLabel = "Copied",
                    contentDescription = state.copyAccessibilityLabel ?: "Copy image path",
                )
            }
        }
    }
}

private data class HistoryItemColors(
    val background: Color,
    val border: Color,
    val foreground: Color,
)

@Composable
private fun ToolCallCard(toolCall: ToolCallPreview) {
    val parametersText = formatGraphChatToolParameterObject(toolCall.parameters)
    val shouldOpen = toolCall.status == ToolStatus.Running || !toolCall.result.isNullOrBlank()
    GraphAccordion(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(8.dp)),
    ) {
        GraphAccordionItem(
            title = toolCall.name,
            subtitle = "Tool call",
            defaultExpanded = shouldOpen,
            showDivider = false,
            backgroundColor = ThreadColors.Surface,
            leading = {
                ToolCallGlyph(color = ThreadColors.ForegroundMuted)
            },
            trailing = {
                ToolStatusBadge(
                    label = toolResultStatusLabel(toolCall.status),
                    status = toolCall.status,
                )
            },
        ) {
            GraphChatToolSection(
                title = "Parameters",
                body = parametersText,
                copyText = parametersText,
            )
            toolCall.result?.takeIf { it.isNotBlank() }?.let { result ->
                GraphChatToolSection(
                    title = "Result",
                    body = result,
                    copyText = result,
                )
            }
        }
    }
}

@Composable
private fun ToolCallGlyph(color: Color) {
    Canvas(
        modifier = Modifier
            .padding(top = 2.dp)
            .size(18.dp),
    ) {
        val strokeWidth = 1.8.dp.toPx()
        drawLine(
            color = color,
            start = Offset(size.width * 0.30f, size.height * 0.72f),
            end = Offset(size.width * 0.68f, size.height * 0.34f),
            strokeWidth = strokeWidth,
            cap = StrokeCap.Round,
        )
        drawCircle(
            color = color,
            radius = 3.1.dp.toPx(),
            center = Offset(size.width * 0.72f, size.height * 0.28f),
            style = Stroke(width = strokeWidth),
        )
        drawCircle(
            color = color,
            radius = 1.9.dp.toPx(),
            center = Offset(size.width * 0.24f, size.height * 0.78f),
        )
    }
}
