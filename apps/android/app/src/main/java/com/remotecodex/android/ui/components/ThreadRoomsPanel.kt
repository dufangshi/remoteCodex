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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.ThreadRoomPreview
import com.remotecodex.android.ui.presentation.threadStatusLabel
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
fun ThreadRoomsPanel(
    workspaceLabel: String,
    rooms: List<ThreadRoomPreview>,
    onClose: () -> Unit,
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
            Text(
                text = "Close",
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
                    .clickable(onClick = onClose)
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(11.dp))
                .background(ThreadColors.Primary)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            RoomsGlyph(kind = RoomsGlyphKind.Plus, color = ThreadColors.PrimaryForeground)
            Text(
                text = "New thread",
                color = ThreadColors.PrimaryForeground,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }

        LazyColumn(
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(rooms, key = { it.id }) { room ->
                ThreadRoomCard(room = room)
            }
        }
    }
}

@Composable
private fun ThreadRoomCard(room: ThreadRoomPreview) {
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
            Text(
                text = room.title,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
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
    }
}

@Composable
private fun RoomsGlyph(kind: RoomsGlyphKind, color: Color) {
    Canvas(modifier = Modifier.size(16.dp)) {
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
        }
    }
}

private enum class RoomsGlyphKind {
    Message,
    Plus,
}
