package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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

        Text(
            text = "New thread",
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(11.dp))
                .background(ThreadColors.Primary)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            color = ThreadColors.PrimaryForeground,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )

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
        Text(
            text = "□",
            modifier = Modifier
                .clip(CircleShape)
                .background(ThreadColors.Panel)
                .padding(horizontal = 9.dp, vertical = 7.dp),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelMedium,
        )
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
