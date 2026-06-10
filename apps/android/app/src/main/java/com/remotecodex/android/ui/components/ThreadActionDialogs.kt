package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import com.remotecodex.android.ui.model.ExportTurnPreview
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.presentation.exportStatusLabel
import com.remotecodex.android.ui.theme.ThreadColors

enum class ThreadActionDialog {
    Rename,
    Export,
    Delete,
    Create,
}

@Composable
fun ThreadActionDialogOverlay(
    dialog: ThreadActionDialog,
    threadTitle: String,
    exportTurns: List<ExportTurnPreview>,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GraphDialogOverlay(
        onDismiss = onClose,
        modifier = modifier,
    ) {
        when (dialog) {
            ThreadActionDialog.Create -> CreateThreadDialogPreview(
                onClose = onClose,
            )
            ThreadActionDialog.Rename -> RenameThreadDialogPreview(
                threadTitle = threadTitle,
                onClose = onClose,
            )
            ThreadActionDialog.Export -> ExportTranscriptDialogPreview(
                exportTurns = exportTurns,
                onClose = onClose,
            )
            ThreadActionDialog.Delete -> DeleteThreadDialogPreview(
                threadTitle = threadTitle,
                onClose = onClose,
            )
        }
    }
}

@Composable
private fun CreateThreadDialogPreview(
    onClose: () -> Unit,
) {
    GraphDialogFrame(
        title = "Create New Chat",
        subtitle = "Name the room so it is easy to find later.",
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = "Create",
                primaryTone = GraphDialogActionTone.Default,
                onCancel = onClose,
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "Chat name",
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "Android parity spike",
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(ThreadColors.CodeBackground)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp))
                    .padding(horizontal = 13.dp, vertical = 12.dp),
                color = ThreadColors.CodeForeground,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "Preview only: native creation will call the supervisor thread-start API after the client layer is wired.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun RenameThreadDialogPreview(
    threadTitle: String,
    onClose: () -> Unit,
) {
    GraphDialogFrame(
        title = "Rename thread",
        subtitle = "Changes are saved only after confirmation.",
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = "Save",
                primaryTone = GraphDialogActionTone.Success,
                onCancel = onClose,
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                text = "Thread name",
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = threadTitle,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(ThreadColors.CodeBackground)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp))
                    .padding(horizontal = 13.dp, vertical = 12.dp),
                color = ThreadColors.CodeForeground,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ExportTranscriptDialogPreview(
    exportTurns: List<ExportTurnPreview>,
    onClose: () -> Unit,
) {
    val selectedCount = exportTurns.count { it.selected }
    GraphDialogFrame(
        title = "Export transcript",
        subtitle = "Review copy summarizes command batches and file changes.",
        onClose = onClose,
        wide = true,
        footer = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = "$selectedCount turns selected",
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                GraphDialogFooter(
                    primaryLabel = "Export PDF",
                    primaryTone = GraphDialogActionTone.Warning,
                    onCancel = onClose,
                    compact = true,
                )
            }
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChoicePill(label = "Latest 10", selected = true, modifier = Modifier.weight(1f))
                ChoicePill(label = "Custom", selected = false, modifier = Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChoicePill(label = "PDF", selected = true, modifier = Modifier.weight(1f))
                ChoicePill(label = "HTML", selected = false, modifier = Modifier.weight(1f))
            }
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(ThreadColors.Surface)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp))
                    .padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                exportTurns.forEach { turn ->
                    ExportTurnRow(turn = turn)
                }
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(ThreadColors.SurfaceStrong)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                GraphSelectionGlyph(
                    selected = true,
                    contentDescription = "Token and price summary enabled",
                )
                Text(
                    text = "Token and price summary",
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun DeleteThreadDialogPreview(
    threadTitle: String,
    onClose: () -> Unit,
) {
    GraphDialogFrame(
        title = "Delete thread",
        subtitle = "This removes the thread from the local supervisor history.",
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = "Delete",
                primaryTone = GraphDialogActionTone.Danger,
                onCancel = onClose,
            )
        },
    ) {
        Text(
            text = threadTitle,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(13.dp))
                .background(ThreadColors.DangerSoft)
                .border(1.dp, ThreadColors.Danger.copy(alpha = 0.38f), RoundedCornerShape(13.dp))
                .padding(12.dp),
            color = ThreadColors.Danger,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ChoicePill(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
) {
    Text(
        text = label,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (selected) ThreadColors.WarningSoft else ThreadColors.SurfaceStrong)
            .border(
                1.dp,
                if (selected) ThreadColors.Warning.copy(alpha = 0.45f) else ThreadColors.Border,
                RoundedCornerShape(999.dp),
            )
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = if (selected) ThreadColors.Warning else ThreadColors.ForegroundSoft,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

@Composable
private fun ExportTurnRow(turn: ExportTurnPreview) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(if (turn.selected) ThreadColors.SurfaceStrong else ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(11.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        GraphSelectionGlyph(
            selected = turn.selected,
            contentDescription = if (turn.selected) "Turn selected" else "Turn not selected",
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "Turn ${turn.number}",
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
                Text(
                    text = turn.timeLabel,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
                MiniStatus(label = exportStatusLabel(turn.status), status = turn.status)
            }
            Text(
                text = turn.promptPreview,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun MiniStatus(label: String, status: ThreadStatus) {
    val foreground = when (status) {
        ThreadStatus.Running -> ThreadColors.Warning
        ThreadStatus.Complete -> ThreadColors.Success
        ThreadStatus.Failed -> ThreadColors.Danger
        ThreadStatus.Waiting -> ThreadColors.Info
    }
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(foreground.copy(alpha = 0.10f))
            .padding(horizontal = 7.dp, vertical = 3.dp),
        color = foreground,
        style = MaterialTheme.typography.labelSmall,
        maxLines = 1,
    )
}
