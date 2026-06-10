package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.model.ThreadDetailPreview
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
fun ThreadTopBar(
    detail: ThreadDetailPreview,
    selectedView: ThreadSurfaceView,
    onViewSelected: (ThreadSurfaceView) -> Unit,
    onOpenAppNav: () -> Unit,
    onOpenRooms: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenThreadAction: (ThreadActionDialog) -> Unit,
    themeMode: ThemeMode,
    darkThemeActive: Boolean,
    modifier: Modifier = Modifier,
) {
    var actionsOpen by remember { mutableStateOf(false) }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(ThreadColors.Panel)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = "☰",
                modifier = Modifier
                    .padding(top = 12.dp)
                    .size(28.dp)
                    .clickable(onClick = onOpenAppNav),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.titleMedium,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = detail.title,
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "Workspace ${detail.workspace}",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "Runtime ready",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
            }
            Text(
                text = if (themeMode == ThemeMode.System && darkThemeActive) "System dark" else themeMode.label,
                modifier = Modifier
                    .padding(top = 8.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.Surface)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
            )
            Text(
                text = "Settings",
                modifier = Modifier
                    .padding(top = 8.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.Surface)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
                    .clickable(onClick = onOpenSettings)
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
            )
        }
        if (actionsOpen) {
            ThreadActionMenu(
                onOpenThreadAction = { action ->
                    actionsOpen = false
                    onOpenThreadAction(action)
                },
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            SegmentButton(
                label = "Chat",
                selected = selectedView == ThreadSurfaceView.Chat,
                onClick = { onViewSelected(ThreadSurfaceView.Chat) },
                modifier = Modifier.weight(1f),
            )
            SegmentButton(
                label = "Workspace",
                selected = selectedView == ThreadSurfaceView.Workspace,
                onClick = { onViewSelected(ThreadSurfaceView.Workspace) },
                modifier = Modifier.weight(1f),
            )
            SegmentButton(
                label = "Shell",
                selected = selectedView == ThreadSurfaceView.Shell,
                onClick = { onViewSelected(ThreadSurfaceView.Shell) },
                modifier = Modifier.weight(1f),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MetadataPill(label = detail.usage)
            Text(
                text = "Actions",
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.Surface)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
                    .clickable { actionsOpen = !actionsOpen }
                    .padding(horizontal = 9.dp, vertical = 5.dp),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            Text(
                text = "Threads",
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.Surface)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
                    .clickable(onClick = onOpenRooms)
                    .padding(horizontal = 9.dp, vertical = 5.dp),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            Text(
                text = detail.items,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ThreadActionMenu(
    onOpenThreadAction: (ThreadActionDialog) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(11.dp))
            .padding(8.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ActionMenuButton(
            label = "Rename",
            onClick = { onOpenThreadAction(ThreadActionDialog.Rename) },
            modifier = Modifier.weight(1f),
        )
        ActionMenuButton(
            label = "Export",
            onClick = { onOpenThreadAction(ThreadActionDialog.Export) },
            modifier = Modifier.weight(1f),
        )
        ActionMenuButton(
            label = "Delete",
            onClick = { onOpenThreadAction(ThreadActionDialog.Delete) },
            modifier = Modifier.weight(1f),
            danger = true,
        )
    }
}

@Composable
private fun ActionMenuButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
) {
    val foreground = if (danger) ThreadColors.Danger else ThreadColors.ForegroundSoft
    Text(
        text = label,
        modifier = modifier
            .height(36.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (danger) ThreadColors.DangerSoft else ThreadColors.SurfaceStrong)
            .border(
                1.dp,
                if (danger) ThreadColors.Danger.copy(alpha = 0.36f) else ThreadColors.Border,
                RoundedCornerShape(8.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        color = foreground,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

@Composable
private fun SegmentButton(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val background = if (selected) ThreadColors.Primary else ThreadColors.SurfaceStrong
    val foreground = if (selected) ThreadColors.PrimaryForeground else ThreadColors.ForegroundSoft
    Text(
        text = label,
        modifier = modifier
            .height(40.dp)
            .clip(RoundedCornerShape(7.dp))
            .background(background)
            .border(1.dp, if (selected) ThreadColors.Primary else ThreadColors.Border, RoundedCornerShape(7.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        color = foreground,
        style = MaterialTheme.typography.bodyLarge,
        maxLines = 1,
    )
}

enum class ThreadSurfaceView {
    Chat,
    Workspace,
    Shell,
}
