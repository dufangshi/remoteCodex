package com.remotecodex.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.ThreadRoomPreview
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.presentation.threadStatusLabel
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
fun ThreadRoomsPanel(
    workspaceLabel: String,
    rooms: List<ThreadRoomPreview>,
    onClose: () -> Unit,
    onCreateThread: () -> Unit,
    copiedSessionRoomId: String?,
    onRenameThread: (ThreadRoomPreview) -> Unit,
    onCopySessionId: (ThreadRoomPreview) -> Unit,
    onDeleteThread: (ThreadRoomPreview) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .widthIn(max = 360.dp)
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border)
            .padding(horizontal = 12.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = workspaceLabel.take(1).uppercase(),
                modifier = Modifier
                    .clip(CircleShape)
                    .background(ThreadColors.Primary)
                    .padding(horizontal = 13.dp, vertical = 9.dp),
                color = ThreadColors.PrimaryForeground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = workspaceLabel,
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "Threads",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            GraphIconButton(
                icon = GraphActionIcon.Cancel,
                contentDescription = "Close thread rooms",
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Default,
                onClick = onClose,
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(11.dp))
                .background(ThreadColors.Primary)
                .clickable(onClick = onCreateThread)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            RoomsGlyph(kind = RoomsGlyphKind.Plus, color = ThreadColors.PrimaryForeground)
            Text(
                text = "New Chat",
                color = ThreadColors.PrimaryForeground,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }

        RoomsListHeader(count = rooms.size)

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(rooms, key = { it.id }) { room ->
                ThreadRoomCard(
                    room = room,
                    copied = copiedSessionRoomId == room.id,
                    onRenameThread = { onRenameThread(room) },
                    onCopySessionId = { onCopySessionId(room) },
                    onDeleteThread = { onDeleteThread(room) },
                )
            }
        }
    }
}

@Composable
fun ThreadRoomsCollapsedRail(
    workspaceLabel: String,
    rooms: List<ThreadRoomPreview>,
    activeRoomId: String?,
    onCreateThread: () -> Unit,
    onOpenThread: (ThreadRoomPreview) -> Unit,
    onExpandRooms: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .width(72.dp)
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border)
            .padding(horizontal = 8.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(42.dp)
                .clip(CircleShape)
                .background(ThreadColors.Primary)
                .semantics { contentDescription = "Workspace ${workspaceLabel}" },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = workspaceLabel.take(1).uppercase(),
                color = ThreadColors.PrimaryForeground,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        CollapsedRailButton(
            kind = RoomsGlyphKind.Rows,
            contentDescription = "Expand thread rooms",
            onClick = onExpandRooms,
        )
        CollapsedRailButton(
            kind = RoomsGlyphKind.Plus,
            selected = true,
            contentDescription = "New Chat",
            onClick = onCreateThread,
        )
        CollapsedRailSeparator()
        Column(
            modifier = Modifier.weight(1f),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            rooms.take(8).forEach { room ->
                CollapsedRoomButton(
                    room = room,
                    selected = room.id == activeRoomId || room.active,
                    onClick = { onOpenThread(room) },
                )
            }
            if (rooms.size > 8) {
                Text(
                    text = "+${rooms.size - 8}",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun CollapsedRoomButton(
    room: ThreadRoomPreview,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val statusColor = when (room.status) {
        ThreadStatus.Running -> ThreadColors.Warning
        ThreadStatus.Complete -> ThreadColors.Success
        ThreadStatus.Failed -> ThreadColors.Danger
        ThreadStatus.Waiting -> ThreadColors.Info
    }
    Box(
        modifier = Modifier
            .size(46.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) ThreadColors.SurfaceStrong else ThreadColors.Surface)
            .border(
                1.dp,
                if (selected) ThreadColors.Primary.copy(alpha = 0.58f) else ThreadColors.Border,
                RoundedCornerShape(14.dp),
            )
            .clickable(onClick = onClick)
            .semantics { contentDescription = "Open thread ${room.title}" },
        contentAlignment = Alignment.Center,
    ) {
        RoomsGlyph(
            kind = RoomsGlyphKind.Message,
            color = if (selected) ThreadColors.Primary else ThreadColors.ForegroundMuted,
            modifier = Modifier.size(18.dp),
        )
        Box(
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .size(10.dp)
                .clip(CircleShape)
                .background(statusColor)
                .border(1.dp, ThreadColors.Panel, CircleShape),
        )
    }
}

@Composable
private fun CollapsedRailButton(
    kind: RoomsGlyphKind,
    contentDescription: String,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(42.dp)
            .clip(RoundedCornerShape(13.dp))
            .background(if (selected) ThreadColors.Primary else ThreadColors.SurfaceStrong)
            .border(
                1.dp,
                if (selected) ThreadColors.Primary else ThreadColors.Border,
                RoundedCornerShape(13.dp),
            )
            .clickable(onClick = onClick)
            .semantics { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        RoomsGlyph(
            kind = kind,
            color = if (selected) ThreadColors.PrimaryForeground else ThreadColors.ForegroundMuted,
            modifier = Modifier.size(17.dp),
        )
    }
}

@Composable
private fun CollapsedRailSeparator() {
    Box(
        modifier = Modifier
            .fillMaxWidth(0.72f)
            .height(1.dp)
            .background(ThreadColors.Border),
    )
}

@Composable
private fun RoomsListHeader(count: Int) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        RoomsGlyph(
            kind = RoomsGlyphKind.Rows,
            color = ThreadColors.ForegroundMuted,
            modifier = Modifier.size(14.dp),
        )
        Text(
            text = "Rooms",
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        GraphBadge(
            label = "$count",
            variant = GraphBadgeVariant.Outline,
        )
    }
}

@Composable
private fun ThreadRoomCard(
    room: ThreadRoomPreview,
    copied: Boolean,
    onRenameThread: () -> Unit,
    onCopySessionId: () -> Unit,
    onDeleteThread: () -> Unit,
) {
    val background = if (room.active) ThreadColors.SurfaceStrong else ThreadColors.Surface
    val border = if (room.active) ThreadColors.BorderStrong else ThreadColors.Border
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(ThreadColors.Panel)
                .border(
                    1.dp,
                    if (room.active) ThreadColors.Primary.copy(alpha = 0.42f) else ThreadColors.Border,
                    CircleShape,
                ),
            contentAlignment = Alignment.Center,
        ) {
            RoomsGlyph(
                kind = RoomsGlyphKind.Message,
                color = if (room.active) ThreadColors.Primary else ThreadColors.ForegroundMuted,
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text(
                    text = room.title,
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                RoomQuietButton(
                    kind = RoomsGlyphKind.Rename,
                    contentDescription = "Rename thread ${room.title}",
                    onClick = onRenameThread,
                )
                if (room.sessionId != null) {
                    if (copied) {
                        GraphBadge(
                            label = "Copied",
                            variant = GraphBadgeVariant.Outline,
                        )
                    } else {
                        RoomQuietButton(
                            kind = RoomsGlyphKind.Copy,
                            contentDescription = "Copy session ID",
                            onClick = onCopySessionId,
                        )
                    }
                }
                if (room.active) {
                    GraphBadge(
                        label = "Active",
                        variant = GraphBadgeVariant.Outline,
                    )
                }
            }
            Row(
                horizontalArrangement = Arrangement.spacedBy(7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = room.workspaceLabel,
                    modifier = Modifier.weight(1f, fill = false),
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                ThreadStatusBadge(
                    label = threadStatusLabel(room.status),
                    status = room.status,
                )
                Text(
                    text = room.updatedLabel,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
        if (!room.active) {
            RoomQuietButton(
                kind = RoomsGlyphKind.Delete,
                danger = true,
                contentDescription = "Delete thread ${room.title}",
                onClick = onDeleteThread,
            )
        }
    }
}

@Composable
private fun RoomQuietButton(
    kind: RoomsGlyphKind,
    contentDescription: String,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val color = if (danger) ThreadColors.Danger else ThreadColors.ForegroundMuted
    Box(
        modifier = Modifier
            .size(26.dp)
            .clip(CircleShape)
            .background(if (danger) ThreadColors.DangerSoft else ThreadColors.Panel.copy(alpha = 0.72f))
            .border(
                1.dp,
                if (danger) ThreadColors.Danger.copy(alpha = 0.36f) else ThreadColors.Border.copy(alpha = 0.72f),
                CircleShape,
            )
            .clickable(onClick = onClick)
            .semantics { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        RoomsGlyph(
            kind = kind,
            color = color,
            modifier = Modifier.size(14.dp),
        )
    }
}

@Composable
private fun RoomsGlyph(
    kind: RoomsGlyphKind,
    color: Color,
    modifier: Modifier = Modifier.size(16.dp),
) {
    Canvas(modifier = modifier) {
        val strokeWidth = 1.45.dp.toPx()
        val w = size.width
        val h = size.height
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
            drawLine(
                color = color,
                start = Offset(w * x1, h * y1),
                end = Offset(w * x2, h * y2),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round,
            )
        }
        fun rect(left: Float, top: Float, right: Float, bottom: Float) {
            line(left, top, right, top)
            line(right, top, right, bottom)
            line(right, bottom, left, bottom)
            line(left, bottom, left, top)
        }

        when (kind) {
            RoomsGlyphKind.Message -> {
                line(0.22f, 0.28f, 0.22f, 0.56f)
                line(0.22f, 0.28f, 0.34f, 0.18f)
                line(0.34f, 0.18f, 0.72f, 0.18f)
                line(0.72f, 0.18f, 0.82f, 0.30f)
                line(0.82f, 0.30f, 0.82f, 0.56f)
                line(0.82f, 0.56f, 0.70f, 0.66f)
                line(0.70f, 0.66f, 0.50f, 0.66f)
                line(0.50f, 0.66f, 0.32f, 0.82f)
                line(0.32f, 0.82f, 0.32f, 0.66f)
                line(0.32f, 0.66f, 0.22f, 0.56f)
            }
            RoomsGlyphKind.Plus -> {
                line(0.50f, 0.22f, 0.50f, 0.78f)
                line(0.22f, 0.50f, 0.78f, 0.50f)
            }
            RoomsGlyphKind.Rename -> {
                line(0.22f, 0.78f, 0.34f, 0.58f)
                line(0.34f, 0.58f, 0.70f, 0.22f)
                line(0.70f, 0.22f, 0.82f, 0.34f)
                line(0.82f, 0.34f, 0.46f, 0.70f)
                line(0.46f, 0.70f, 0.22f, 0.78f)
                line(0.62f, 0.30f, 0.74f, 0.42f)
            }
            RoomsGlyphKind.Copy -> {
                rect(0.32f, 0.24f, 0.72f, 0.72f)
                line(0.24f, 0.36f, 0.24f, 0.84f)
                line(0.24f, 0.84f, 0.60f, 0.84f)
                line(0.60f, 0.84f, 0.60f, 0.72f)
            }
            RoomsGlyphKind.Rows -> {
                line(0.20f, 0.28f, 0.80f, 0.28f)
                line(0.20f, 0.50f, 0.80f, 0.50f)
                line(0.20f, 0.72f, 0.80f, 0.72f)
            }
            RoomsGlyphKind.Delete -> {
                line(0.30f, 0.28f, 0.70f, 0.28f)
                line(0.42f, 0.18f, 0.58f, 0.18f)
                rect(0.34f, 0.34f, 0.66f, 0.82f)
                line(0.45f, 0.44f, 0.45f, 0.72f)
                line(0.55f, 0.44f, 0.55f, 0.72f)
            }
        }
    }
}

private enum class RoomsGlyphKind {
    Message,
    Plus,
    Rename,
    Copy,
    Rows,
    Delete,
}
