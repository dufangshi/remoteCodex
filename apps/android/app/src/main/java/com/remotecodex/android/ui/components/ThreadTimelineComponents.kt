package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.HistoryGroupPreview
import com.remotecodex.android.ui.model.HistoryItemPreview
import com.remotecodex.android.ui.model.DetailPreview
import com.remotecodex.android.ui.model.LivePlanPreview
import com.remotecodex.android.ui.model.MessageAuthor
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
import com.remotecodex.android.ui.presentation.basenameFromAssetPath
import com.remotecodex.android.ui.presentation.FileChangeSummarySegment
import com.remotecodex.android.ui.presentation.FileChangeSummaryTone
import com.remotecodex.android.ui.presentation.fileChangeSummarySegments
import com.remotecodex.android.ui.presentation.formatTrailingPathLabel
import com.remotecodex.android.ui.presentation.graphChatMessageStatusModel
import com.remotecodex.android.ui.presentation.historyGroupRowOrdinalLabel
import com.remotecodex.android.ui.presentation.hookHistorySummary
import com.remotecodex.android.ui.presentation.parseUserMessageSegments
import com.remotecodex.android.ui.presentation.planStepStatusLabel
import com.remotecodex.android.ui.presentation.summarizeInlinePreviewText
import com.remotecodex.android.ui.presentation.threadStatusLabel
import com.remotecodex.android.ui.presentation.toolResultStatusLabel
import com.remotecodex.android.ui.presentation.toolStatusLabel
import com.remotecodex.android.ui.presentation.UserMessageSegment
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.delay

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
                text = if (turn.optimistic) "SENDING" else "TURN ${turn.index}",
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
                    .padding(horizontal = 8.dp, vertical = 3.dp),
                color = if (turn.optimistic) ThreadColors.Warning else ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
            )
            Text(
                text = turn.timeLabel,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
            ThreadStatusBadge(
                label = turn.statusLabel,
                status = if (turn.statusLabel.equals("running", ignoreCase = true)) {
                    ThreadStatus.Running
                } else {
                    ThreadStatus.Complete
                },
            )
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = turn.tokenSummary,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        turn.messages.forEach { message ->
            MessageBubble(message = message, onOpenDetail = onOpenDetail)
        }
        turn.livePlan?.let { livePlan ->
            LivePlanCard(livePlan = livePlan)
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
                text = if (tone == TimelineNoteTone.Activity) "Activity" else "Resolved",
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.Panel.copy(alpha = 0.70f))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                color = foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = note.title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            note.timeLabel?.let { timeLabel ->
                Text(
                    text = timeLabel,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
            }
        }
        note.summaryLines.take(3).forEach { line ->
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
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(ThreadColors.WarningSoft.copy(alpha = 0.46f))
            .border(1.dp, ThreadColors.Warning.copy(alpha = 0.36f), RoundedCornerShape(11.dp))
            .padding(11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = steer.statusLabel ?: "Queued",
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(ThreadColors.Panel.copy(alpha = 0.72f))
                .padding(horizontal = 8.dp, vertical = 4.dp),
            color = ThreadColors.Warning,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = steer.prompt,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = steer.timeLabel,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
        )
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
                text = livePlan.title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "Live",
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
        livePlan.explanation?.let { explanation ->
            Text(
                text = explanation,
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
            livePlan.steps.forEachIndexed { index, step ->
                LivePlanStepRow(
                    number = index + 1,
                    text = step.step,
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
    val foreground = when (status) {
        PlanStepStatus.Completed -> ThreadColors.Success
        PlanStepStatus.Running -> ThreadColors.Warning
        PlanStepStatus.Failed -> ThreadColors.Danger
        PlanStepStatus.Pending -> ThreadColors.Info
        PlanStepStatus.Unknown -> ThreadColors.ForegroundMuted
    }
    val background = when (status) {
        PlanStepStatus.Completed -> ThreadColors.SuccessSoft
        PlanStepStatus.Running -> ThreadColors.WarningSoft
        PlanStepStatus.Failed -> ThreadColors.DangerSoft
        PlanStepStatus.Pending -> ThreadColors.InfoSoft
        PlanStepStatus.Unknown -> ThreadColors.SurfaceStrong
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, foreground.copy(alpha = 0.42f), RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (status == PlanStepStatus.Running) {
            RunningDots(color = foreground, dotSize = 4.dp, spacing = 2.dp)
        }
        Text(
            text = planStepStatusLabel(status),
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun MessageBubble(
    message: MessagePreview,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    val isUser = message.author == MessageAuthor.User
    val messageStatus = graphChatMessageStatusModel(message.status)
    val assistantStatus = if (isUser) null else messageStatus ?: graphChatMessageStatusModel("Complete")
    Column(
        modifier = Modifier.messageBubbleContainer(isUser = isUser),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (!isUser) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                AssistantSenderPill()
                assistantStatus?.let {
                    MessageStatusBadge(model = it, compact = true)
                }
                Spacer(modifier = Modifier.weight(1f))
                AssistantCopyButton(
                    value = message.text,
                )
                Text(
                    text = message.timeLabel,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
        if (isUser) {
            UserMessageBody(text = message.richText)
        } else {
            RichMessageContent(content = message.richText)
        }
        if (!isUser && message.reasoningItems.isNotEmpty()) {
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
        if (isUser) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                messageStatus?.let { MessageStatusBadge(model = it, compact = true) }
                Text(
                    text = message.timeLabel,
                    modifier = Modifier.padding(start = 8.dp),
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}

@Composable
private fun AssistantCopyButton(value: String) {
    val clipboard = LocalClipboardManager.current
    var copied by remember(value) { mutableStateOf(false) }

    LaunchedEffect(copied) {
        if (copied) {
            delay(1200)
            copied = false
        }
    }

    val shape = RoundedCornerShape(7.dp)
    val foreground = if (copied) ThreadColors.Info else ThreadColors.ForegroundMuted
    val background = if (copied) ThreadColors.InfoSoft else ThreadColors.Panel
    val border = if (copied) ThreadColors.Info.copy(alpha = 0.44f) else ThreadColors.Border
    Box(
        modifier = Modifier
            .size(28.dp)
            .clip(shape)
            .background(background)
            .border(1.dp, border, shape)
            .semantics {
                contentDescription = if (copied) "Assistant reply copied" else "Copy assistant reply"
            }
            .clickable {
                clipboard.setText(AnnotatedString(value))
                copied = true
            },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = if (copied) "OK" else "C",
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun AssistantSenderPill() {
    Text(
        text = "Assistant",
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
                is UserMessageSegment.Text -> Text(
                    text = segment.text,
                    color = ThreadColors.UserBubbleText,
                    style = MaterialTheme.typography.bodyLarge,
                )
                is UserMessageSegment.Photo -> UserPhotoAttachment(path = segment.path)
                is UserMessageSegment.File -> UserFileAttachment(path = segment.path)
            }
        }
    }
}

@Composable
private fun UserPhotoAttachment(path: String) {
    Column(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.InfoSoft.copy(alpha = 0.38f))
            .border(1.dp, ThreadColors.Info.copy(alpha = 0.34f), RoundedCornerShape(14.dp))
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
                text = "PHOTO",
                color = ThreadColors.Info,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        Text(
            text = basenameFromAssetPath(path).ifBlank { "Attached image" },
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
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.SuccessSoft.copy(alpha = 0.36f))
            .border(1.dp, ThreadColors.Success.copy(alpha = 0.34f), RoundedCornerShape(14.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "FILE",
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(ThreadColors.SuccessSoft)
                .border(1.dp, ThreadColors.Success.copy(alpha = 0.32f), RoundedCornerShape(999.dp))
                .padding(horizontal = 7.dp, vertical = 4.dp),
            color = ThreadColors.Success,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = basenameFromAssetPath(path).ifBlank { "Attached file" },
            color = ThreadColors.UserBubbleText,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ReasoningAccordion(items: List<ReasoningPreview>) {
    val running = items.any { it.status == ToolStatus.Running }
    val reasoningText = items.joinToString(separator = "\n\n") { it.text.trim() }
    GraphAccordion(
        modifier = Modifier
            .clip(RoundedCornerShape(10.dp)),
    ) {
        GraphAccordionItem(
            title = if (running) "Thinking" else "Thought Process",
            subtitle = "${items.size} reasoning item${if (items.size == 1) "" else "s"}",
            backgroundColor = ThreadColors.Surface,
            showDivider = false,
            leading = {
                Text(
                    text = "Brain",
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(if (running) ThreadColors.InfoSoft else ThreadColors.SurfaceStrong)
                        .border(
                            1.dp,
                            if (running) ThreadColors.Info.copy(alpha = 0.36f) else ThreadColors.Border,
                            RoundedCornerShape(999.dp),
                        )
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    color = if (running) ThreadColors.Info else ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                )
            },
            trailing = {
                if (running) {
                    RunningDots(color = ThreadColors.Info)
                }
            },
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                CopyTextButton(
                    value = reasoningText,
                    idleLabel = "Copy thoughts",
                    copiedLabel = "Copied",
                    contentDescription = "Copy reasoning text",
                )
            }
            Text(
                text = reasoningText,
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
private fun CopyTextButton(
    value: String,
    idleLabel: String,
    copiedLabel: String,
    contentDescription: String,
) {
    val clipboard = LocalClipboardManager.current
    var copied by remember(value) { mutableStateOf(false) }

    LaunchedEffect(copied) {
        if (copied) {
            delay(1200)
            copied = false
        }
    }

    GraphButton(
        label = if (copied) copiedLabel else idleLabel,
        size = GraphButtonSize.Small,
        variant = if (copied) GraphButtonVariant.Secondary else GraphButtonVariant.Ghost,
        contentDescription = contentDescription,
        onClick = {
            clipboard.setText(AnnotatedString(value))
            copied = true
        },
    )
}

@Composable
private fun HistoryGroupCard(
    group: HistoryGroupPreview,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    val colors = historyItemColors(group.kind)
    GraphAccordion(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, colors.border, RoundedCornerShape(10.dp))
    ) {
        GraphAccordionItem(
            title = group.title,
            subtitle = group.statusLabel ?: "${group.items.size} entries",
            defaultExpanded = group.expandedByDefault,
            showDivider = false,
            titleColor = colors.foreground,
            backgroundColor = colors.background,
            contentBackgroundColor = colors.background,
            leading = {
                HistoryGroupGlyph(group = group, color = colors.foreground)
            },
            trailing = {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (isRunningStatusLabel(group.statusLabel)) {
                        RunningDots(color = colors.foreground, dotSize = 4.dp, spacing = 2.dp)
                    }
                    if (group.kind == HistoryItemKind.FileChange) {
                        FileChangeGroupSummary(group = group)
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
private fun FileChangeGroupSummary(group: HistoryGroupPreview) {
    Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        fileChangeSummarySegments(
            changedFiles = group.changedFiles,
            addedLines = group.addedLines,
            removedLines = group.removedLines,
            previewText = group.countLabel,
        ).forEach { segment ->
            FileChangeSummaryPill(segment = segment)
        }
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
            Text(
                text = item.title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            item.status?.let { status ->
                Row(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (status == ToolStatus.Running) {
                        RunningDots(color = colors.foreground, dotSize = 4.dp, spacing = 2.dp)
                    }
                    Text(
                        text = status.name.lowercase(),
                        color = ThreadColors.ForegroundMuted,
                        style = MaterialTheme.typography.labelSmall,
                        maxLines = 1,
                    )
                }
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
                value = historyItemCopyText(item),
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
    val running = item.status == ToolStatus.Running
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
                text = item.title,
                modifier = Modifier.weight(1f),
                color = colors.foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            item.status?.let { status ->
                ToolStatusBadge(
                    label = toolStatusLabel(status),
                    status = status,
                )
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
        if (item.kind == HistoryItemKind.Hook) {
            HookHistorySummaryRow(item = item, colors = colors)
        } else {
            Text(
                text = historyItemSummary(item),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (running) {
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
                    text = "Running from thread events",
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.Warning,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (item.kind == HistoryItemKind.FileChange) {
            FileChangeDeltaRow(item = item)
        }
        if (item.kind == HistoryItemKind.Image) {
            ImageHistoryPreview(item = item, colors = colors, onOpenDetail = onOpenDetail)
        }
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
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            item.actionLabel?.let { label ->
                Text(
                    text = label,
                    modifier = Modifier
                        .clip(RoundedCornerShape(7.dp))
                        .border(1.dp, colors.border, RoundedCornerShape(7.dp))
                        .clickable { openHistoryItemDetail(item, null, onOpenDetail) }
                        .padding(horizontal = 10.dp, vertical = 7.dp),
                    color = colors.foreground,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            Spacer(modifier = Modifier.weight(1f))
            CopyTextButton(
                value = historyItemCopyText(item),
                idleLabel = "Copy",
                copiedLabel = "Copied",
                contentDescription = "Copy history item details",
            )
        }
    }
}

private fun historyItemCopyText(item: HistoryItemPreview): String {
    return buildString {
        appendLine(item.title)
        item.meta?.takeIf { it.isNotBlank() }?.let { appendLine(it) }
        item.status?.let { appendLine(toolStatusLabel(it)) }
        item.summary.takeIf { it.isNotBlank() }?.let { appendLine(it) }
        item.detail?.takeIf { it.isNotBlank() }?.let {
            if (isNotEmpty()) appendLine()
            appendLine(it)
        }
    }.trim()
}

@Composable
private fun HookHistorySummaryRow(
    item: HistoryItemPreview,
    colors: HistoryItemColors,
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
        if (summary.outputBacked) {
            Text(
                text = summary.hookLabel,
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
        Text(
            text = summary.firstLine,
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
    val summary = summarizeInlinePreviewText(historyGroupRowSummary(item))
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

private fun historyItemSummary(item: HistoryItemPreview): String {
    return if (item.kind == HistoryItemKind.FileChange) {
        formatTrailingPathLabel(item.summary, maxLength = 48)
    } else {
        item.summary
    }
}

private fun historyGroupRowSummary(item: HistoryItemPreview): String {
    return if (item.kind == HistoryItemKind.FileChange) {
        formatTrailingPathLabel(item.summary, maxLength = 34)
    } else {
        item.summary
    }
}

private fun isRunningStatusLabel(statusLabel: String?): Boolean {
    if (statusLabel == null) {
        return false
    }
    val normalized = statusLabel.lowercase()
    return normalized.contains("running") ||
        normalized.contains("inprogress") ||
        normalized.contains("in_progress")
}

private fun openHistoryItemDetail(
    item: HistoryItemPreview,
    index: Int?,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    val title = item.actionLabel
        ?: item.meta
        ?: item.title
    val indexedTitle = index?.let { "$title $it" } ?: title
    val body = item.detail
        ?: item.summary
    onOpenDetail(DetailPreview(title = indexedTitle, text = body))
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
                    line(0.26f, 0.34f, 0.50f, 0.20f)
                    line(0.50f, 0.20f, 0.74f, 0.34f)
                    line(0.74f, 0.34f, 0.74f, 0.64f)
                    line(0.74f, 0.64f, 0.50f, 0.80f)
                    line(0.50f, 0.80f, 0.26f, 0.64f)
                    line(0.26f, 0.64f, 0.26f, 0.34f)
                    line(0.26f, 0.34f, 0.50f, 0.50f)
                    line(0.74f, 0.34f, 0.50f, 0.50f)
                    line(0.50f, 0.50f, 0.50f, 0.80f)
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
private fun HistoryGroupGlyph(group: HistoryGroupPreview, color: Color) {
    Box(
        modifier = Modifier
            .widthIn(min = 30.dp)
            .height(30.dp),
    ) {
        HistoryKindGlyph(kind = group.kind, color = color)
        Text(
            text = graphChatHistoryGroupCountLabel(group.countLabel),
            modifier = Modifier
                .align(Alignment.TopEnd)
                .clip(RoundedCornerShape(999.dp))
                .background(ThreadColors.CodeBackground)
                .border(1.dp, color.copy(alpha = 0.38f), RoundedCornerShape(999.dp))
                .padding(horizontal = 4.dp, vertical = 1.dp),
            color = color,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
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
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, colors.border, RoundedCornerShape(10.dp))
            .clickable {
                onOpenDetail(
                    DetailPreview(
                        title = "Image Path",
                        text = item.assetPath ?: item.detail ?: item.summary,
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
                text = item.imageLabel ?: "Image preview",
                color = colors.foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        item.assetPath?.let { path ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ThreadColors.Panel.copy(alpha = 0.74f))
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
                GraphButton(
                    label = "Open",
                    size = GraphButtonSize.Small,
                    variant = GraphButtonVariant.Ghost,
                    contentDescription = "Open image path",
                    onClick = {
                        onOpenDetail(DetailPreview(title = "Image Path", text = path))
                    },
                )
                CopyTextButton(
                    value = path,
                    idleLabel = "Copy",
                    copiedLabel = "Copied",
                    contentDescription = "Copy image path",
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
    val parametersText = formatToolCallParameters(toolCall.parameters)
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
                Text(
                    text = "⌘",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.titleMedium,
                )
            },
            trailing = {
                ToolStatusBadge(
                    label = toolResultStatusLabel(toolCall.status),
                    status = toolCall.status,
                )
            },
        ) {
            JsonBlock(
                title = "Parameters",
                entries = toolCall.parameters,
                copyText = parametersText,
            )
            toolCall.result?.let {
                CodeBlock(title = "Result", code = it)
            }
        }
    }
}

@Composable
private fun JsonBlock(title: String, entries: List<Pair<String, String>>, copyText: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SectionHeaderWithCopy(title = title, copyText = copyText)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(7.dp))
                .background(ThreadColors.Panel)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(7.dp))
                .padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text("{", color = ThreadColors.ForegroundMuted, fontFamily = FontFamily.Monospace)
            if (entries.isEmpty()) {
                Text(
                    text = "  empty",
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                )
            }
            entries.forEachIndexed { index, entry ->
                Text(
                    text = "  \"${entry.first}\": \"${entry.second}\"${if (index < entries.lastIndex) "," else ""}",
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.bodyMedium,
                    fontFamily = FontFamily.Monospace,
                )
            }
            Text("}", color = ThreadColors.ForegroundMuted, fontFamily = FontFamily.Monospace)
        }
    }
}

@Composable
private fun CodeBlock(title: String, code: String) {
    val displayCode = code.ifEmpty { "(empty)" }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SectionHeaderWithCopy(title = title, copyText = code)
        Text(
            text = displayCode,
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(min = 0.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(ThreadColors.CodeBackground)
                .padding(10.dp),
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.bodyMedium,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun SectionHeaderWithCopy(title: String, copyText: String) {
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
        CopyTextButton(
            value = copyText,
            idleLabel = "Copy",
            copiedLabel = "Copied",
            contentDescription = "Copy $title",
        )
    }
}

private fun formatToolCallParameters(entries: List<Pair<String, String>>): String {
    if (entries.isEmpty()) return "{}"
    return buildString {
        appendLine("{")
        entries.forEachIndexed { index, entry ->
            append("  \"")
            append(entry.first)
            append("\": \"")
            append(entry.second)
            append("\"")
            if (index < entries.lastIndex) {
                append(",")
            }
            appendLine()
        }
        append("}")
    }
}
