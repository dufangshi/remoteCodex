package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
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
import com.remotecodex.android.ui.presentation.historyItemShortLabel
import com.remotecodex.android.ui.presentation.planStepStatusLabel
import com.remotecodex.android.ui.presentation.threadStatusLabel
import com.remotecodex.android.ui.presentation.toolResultStatusLabel
import com.remotecodex.android.ui.presentation.toolStatusLabel
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
    Text(
        text = planStepStatusLabel(status),
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, foreground.copy(alpha = 0.42f), RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        color = foreground,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

@Composable
private fun MessageBubble(
    message: MessagePreview,
    onOpenDetail: (DetailPreview) -> Unit,
) {
    val isUser = message.author == MessageAuthor.User
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (isUser) ThreadColors.UserBubble else ThreadColors.Panel)
            .border(
                1.dp,
                if (isUser) ThreadColors.UserBubbleBorder else ThreadColors.Border,
                RoundedCornerShape(14.dp),
            )
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (!isUser) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Assistant",
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(ThreadColors.SurfaceStrong)
                        .padding(horizontal = 10.dp, vertical = 4.dp),
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                )
                message.status?.let {
                    ThreadStatusBadge(label = threadStatusLabel(it), status = it)
                }
                Spacer(modifier = Modifier.weight(1f))
                CopyTextButton(
                    value = message.text,
                    idleLabel = "Copy",
                    copiedLabel = "Copied",
                    contentDescription = "Copy assistant reply",
                )
                Text(
                    text = message.timeLabel,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
        if (isUser) {
            Text(
                text = message.richText,
                color = ThreadColors.UserBubbleText,
                style = MaterialTheme.typography.bodyLarge,
            )
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
                message.status?.let { ThreadStatusBadge(label = threadStatusLabel(it), status = it) }
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
                    Text(
                        text = "...",
                        color = ThreadColors.Info,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                    )
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
                HistoryIcon(label = "BATCH", color = colors.foreground)
            },
            trailing = {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = group.countLabel,
                        color = ThreadColors.ForegroundMuted,
                        style = MaterialTheme.typography.labelSmall,
                        maxLines = 1,
                    )
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
        group.changedFiles?.takeIf { it > 0 }?.let { files ->
            Text(
                text = "$files files",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
            )
        }
        group.addedLines?.takeIf { it > 0 }?.let { added ->
            DeltaPill(label = "+$added", positive = true)
        }
        group.removedLines?.takeIf { it > 0 }?.let { removed ->
            DeltaPill(label = "-$removed", positive = false)
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
            Text(
                text = "Step ${index + 1}",
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(colors.foreground.copy(alpha = 0.10f))
                    .border(1.dp, colors.foreground.copy(alpha = 0.22f), RoundedCornerShape(999.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                color = colors.foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
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
                Text(
                    text = status.name.lowercase(),
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
            }
        }
        Text(
            text = item.summary,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
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
            HistoryIcon(label = historyItemShortLabel(item.kind), color = colors.foreground)
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
        Text(
            text = item.summary,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
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
private fun HistoryIcon(label: String, color: Color) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(7.dp))
            .background(color.copy(alpha = 0.12f))
            .border(1.dp, color.copy(alpha = 0.35f), RoundedCornerShape(7.dp))
            .padding(horizontal = 7.dp, vertical = 5.dp),
    ) {
        Text(
            text = label,
            color = color,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun FileChangeDeltaRow(item: HistoryItemPreview) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        item.addedLines?.takeIf { it > 0 }?.let { added ->
            DeltaPill(label = "+$added", positive = true)
        }
        item.removedLines?.takeIf { it > 0 }?.let { removed ->
            DeltaPill(label = "-$removed", positive = false)
        }
    }
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
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        SectionHeaderWithCopy(title = title, copyText = code)
        Text(
            text = code,
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
