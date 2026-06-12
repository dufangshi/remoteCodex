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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.api.ExportThreadRequest
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

private enum class ExportMode {
    Latest,
    Custom,
}

private enum class ExportFormat(val label: String) {
    Pdf("PDF"),
    Html("HTML"),
}

@Composable
fun ThreadActionDialogOverlay(
    dialog: ThreadActionDialog,
    threadTitle: String,
    exportTurns: List<ExportTurnPreview>,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    busy: Boolean = false,
    error: String? = null,
    onRenameThread: ((String) -> Unit)? = null,
    onExportThread: ((ExportThreadRequest) -> Unit)? = null,
    onDeleteThread: (() -> Unit)? = null,
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
                busy = busy,
                error = error,
                onRenameThread = onRenameThread,
            )
            ThreadActionDialog.Export -> ExportTranscriptDialogPreview(
                exportTurns = exportTurns,
                onClose = onClose,
                busy = busy,
                error = error,
                onExportThread = onExportThread,
            )
            ThreadActionDialog.Delete -> DeleteThreadDialogPreview(
                threadTitle = threadTitle,
                onClose = onClose,
                busy = busy,
                error = error,
                onDeleteThread = onDeleteThread,
            )
        }
    }
}

@Composable
private fun CreateThreadDialogPreview(
    onClose: () -> Unit,
) {
    var titleDraft by rememberSaveable { mutableStateOf("") }
    val titleReady = titleDraft.trim().isNotEmpty()
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
            ThreadTitleField(
                value = titleDraft,
                onValueChange = { titleDraft = it },
                placeholder = "Chat name",
            )
            Text(
                text = if (titleReady) {
                    "Will create: ${titleDraft.trim()}"
                } else {
                    "Leave blank to start an untitled chat."
                },
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun RenameThreadDialogPreview(
    threadTitle: String,
    onClose: () -> Unit,
    busy: Boolean,
    error: String?,
    onRenameThread: ((String) -> Unit)?,
) {
    var titleDraft by rememberSaveable(threadTitle) { mutableStateOf(threadTitle) }
    var previewBusy by rememberSaveable(threadTitle) { mutableStateOf(false) }
    val normalizedTitle = titleDraft.trim()
    val saving = busy || previewBusy
    val canSave = normalizedTitle.isNotEmpty() && !saving
    GraphDialogFrame(
        title = "Rename thread",
        subtitle = "Changes are saved only after confirmation.",
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = if (saving) "Saving..." else "Save",
                primaryTone = GraphDialogActionTone.Success,
                onCancel = onClose,
                primaryEnabled = canSave,
                onPrimary = {
                    if (onRenameThread != null) {
                        onRenameThread(normalizedTitle)
                    } else {
                        previewBusy = true
                    }
                },
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
            ThreadTitleField(
                value = titleDraft,
                onValueChange = { titleDraft = it },
                placeholder = "Thread name",
            )
            Text(
                text = if (normalizedTitle.isEmpty()) {
                    "Enter a thread name before saving."
                } else {
                    "Will save: $normalizedTitle"
                },
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            error?.let { message ->
                Text(
                    text = message,
                    color = ThreadColors.Danger,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun ThreadTitleField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier.fillMaxWidth(),
        singleLine = true,
        placeholder = {
            Text(
                text = placeholder,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodyMedium,
            )
        },
        textStyle = MaterialTheme.typography.bodyMedium.copy(color = ThreadColors.Foreground),
        shape = RoundedCornerShape(14.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = ThreadColors.Foreground,
            unfocusedTextColor = ThreadColors.Foreground,
            focusedContainerColor = ThreadColors.SurfaceStrong,
            unfocusedContainerColor = ThreadColors.SurfaceStrong,
            cursorColor = ThreadColors.Primary,
            focusedBorderColor = ThreadColors.Primary.copy(alpha = 0.58f),
            unfocusedBorderColor = ThreadColors.Border,
            focusedPlaceholderColor = ThreadColors.ForegroundMuted,
            unfocusedPlaceholderColor = ThreadColors.ForegroundMuted,
        ),
    )
}

@Composable
private fun ExportTranscriptDialogPreview(
    exportTurns: List<ExportTurnPreview>,
    onClose: () -> Unit,
    busy: Boolean,
    error: String?,
    onExportThread: ((ExportThreadRequest) -> Unit)?,
) {
    var exportMode by rememberSaveable { mutableStateOf(ExportMode.Latest) }
    var exportFormat by rememberSaveable { mutableStateOf(ExportFormat.Pdf) }
    var includeTokenAndPrice by rememberSaveable { mutableStateOf(true) }
    var exportBusy by rememberSaveable { mutableStateOf(false) }
    var selectedTurnIds by rememberSaveable {
        mutableStateOf(exportTurns.filter { it.selected }.map { it.id })
    }
    val selectedTurnIdSet = selectedTurnIds.toSet()
    val selectedTurnCount = selectedTurnIdSet.size
    val exportCount = if (exportMode == ExportMode.Latest) {
        minOf(10, exportTurns.size)
    } else {
        selectedTurnCount
    }
    val effectiveBusy = busy || exportBusy
    val canExport = !effectiveBusy && (exportMode == ExportMode.Latest || selectedTurnCount > 0)
    val exportSummary = if (exportMode == ExportMode.Custom && selectedTurnCount == 0) {
        "Select at least one turn to export"
    } else {
        "$exportCount ${if (exportCount == 1) "turn" else "turns"} will be exported"
    }
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
                    text = exportSummary,
                    modifier = Modifier.weight(1f),
                    color = if (canExport) ThreadColors.ForegroundMuted else ThreadColors.Warning,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                GraphDialogFooter(
                    primaryLabel = if (effectiveBusy) "Exporting..." else "Export ${exportFormat.label}",
                    primaryTone = GraphDialogActionTone.Warning,
                    onCancel = onClose,
                    primaryEnabled = canExport,
                    onPrimary = {
                        val request = ExportThreadRequest(
                            format = exportFormat.name.lowercase(),
                            mode = if (exportMode == ExportMode.Latest) "latest" else "selected",
                            limit = if (exportMode == ExportMode.Latest) 10 else null,
                            turnIds = if (exportMode == ExportMode.Custom) selectedTurnIds else emptyList(),
                            profile = "review",
                            includeTokenAndPrice = includeTokenAndPrice,
                        )
                        if (onExportThread != null) {
                            onExportThread(request)
                        } else {
                            exportBusy = true
                        }
                    },
                    compact = true,
                )
            }
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            error?.takeIf { it.isNotBlank() }?.let { message ->
                Text(
                    text = message,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(ThreadColors.WarningSoft)
                        .border(1.dp, ThreadColors.Warning.copy(alpha = 0.36f), RoundedCornerShape(10.dp))
                        .padding(10.dp),
                    color = ThreadColors.Warning,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChoicePill(
                    label = "Latest 10",
                    selected = exportMode == ExportMode.Latest,
                    onClick = { exportMode = ExportMode.Latest },
                    modifier = Modifier.weight(1f),
                )
                ChoicePill(
                    label = "Custom",
                    selected = exportMode == ExportMode.Custom,
                    onClick = { exportMode = ExportMode.Custom },
                    modifier = Modifier.weight(1f),
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ChoicePill(
                    label = "PDF",
                    selected = exportFormat == ExportFormat.Pdf,
                    onClick = { exportFormat = ExportFormat.Pdf },
                    modifier = Modifier.weight(1f),
                )
                ChoicePill(
                    label = "HTML",
                    selected = exportFormat == ExportFormat.Html,
                    onClick = { exportFormat = ExportFormat.Html },
                    modifier = Modifier.weight(1f),
                )
            }
            Text(
                text = if (exportMode == ExportMode.Latest) {
                    "Exports the latest 10 turns in chronological order."
                } else if (selectedTurnCount == 0) {
                    "Custom export needs at least one selected turn."
                } else {
                    "Selected $selectedTurnCount of ${exportTurns.size} turns."
                },
                color = if (exportMode == ExportMode.Custom && selectedTurnCount == 0) {
                    ThreadColors.Warning
                } else {
                    ThreadColors.ForegroundMuted
                },
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (exportMode == ExportMode.Custom) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(ThreadColors.Surface)
                        .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp))
                        .padding(8.dp),
                    verticalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            text = "Selected $selectedTurnCount of ${exportTurns.size}",
                            modifier = Modifier.weight(1f),
                            color = ThreadColors.ForegroundMuted,
                            style = MaterialTheme.typography.labelSmall,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        GraphButton(
                            label = "Select all",
                            variant = GraphButtonVariant.Ghost,
                            size = GraphButtonSize.Small,
                            onClick = { selectedTurnIds = exportTurns.map { it.id } },
                        )
                        GraphButton(
                            label = "Clear",
                            variant = GraphButtonVariant.Ghost,
                            size = GraphButtonSize.Small,
                            onClick = { selectedTurnIds = emptyList() },
                        )
                    }
                    exportTurns.forEach { turn ->
                        val selected = selectedTurnIdSet.contains(turn.id)
                        ExportTurnRow(
                            turn = turn,
                            selected = selected,
                            onToggle = {
                                selectedTurnIds = if (selected) {
                                    selectedTurnIds.filterNot { it == turn.id }
                                } else {
                                    selectedTurnIds + turn.id
                                }
                            },
                        )
                    }
                }
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(ThreadColors.SurfaceStrong)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
                    .clickable { includeTokenAndPrice = !includeTokenAndPrice }
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                GraphSelectionGlyph(
                    selected = includeTokenAndPrice,
                    contentDescription = "Token and price summary enabled",
                )
                Text(
                    text = "Token and price summary",
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                GraphButton(
                    label = if (includeTokenAndPrice) "Included" else "Omitted",
                    variant = GraphButtonVariant.Ghost,
                    size = GraphButtonSize.Small,
                    onClick = { includeTokenAndPrice = !includeTokenAndPrice },
                )
            }
            Text(
                text = if (exportFormat == ExportFormat.Html) {
                    "HTML keeps the chat timeline styling and omits raw command output."
                } else {
                    "Review exports keep message text readable and omit tool activity."
                },
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun DeleteThreadDialogPreview(
    threadTitle: String,
    onClose: () -> Unit,
    busy: Boolean,
    error: String?,
    onDeleteThread: (() -> Unit)?,
) {
    var confirmed by rememberSaveable(threadTitle) { mutableStateOf(false) }
    var previewBusy by rememberSaveable(threadTitle) { mutableStateOf(false) }
    val deleteBusy = busy || previewBusy
    val canDelete = confirmed && !deleteBusy
    GraphDialogFrame(
        title = "Delete thread",
        subtitle = "This removes the thread from the local supervisor history.",
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = if (deleteBusy) "Deleting..." else "Delete",
                primaryTone = GraphDialogActionTone.Danger,
                onCancel = onClose,
                primaryEnabled = canDelete,
                onPrimary = {
                    if (onDeleteThread != null) {
                        onDeleteThread()
                    } else {
                        previewBusy = true
                    }
                },
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(
                text = "Thread to delete",
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
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
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(13.dp))
                    .background(ThreadColors.SurfaceStrong)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(13.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                ConfirmRiskRow(label = "Scope", value = "Local supervisor history")
                ConfirmRiskRow(label = "Recovery", value = "Cannot be undone in this preview")
                ConfirmRiskRow(label = "Next step", value = "Use Delete only when the room is no longer needed")
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(ThreadColors.Surface)
                    .border(
                        1.dp,
                        if (confirmed) ThreadColors.Danger.copy(alpha = 0.42f) else ThreadColors.Border,
                        RoundedCornerShape(12.dp),
                    )
                    .clickable(enabled = !deleteBusy) { confirmed = !confirmed }
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                GraphSelectionGlyph(
                    selected = confirmed,
                    tone = GraphSelectionTone.Warning,
                    contentDescription = if (confirmed) {
                        "Delete confirmation selected"
                    } else {
                        "Delete confirmation not selected"
                    },
                )
                Text(
                    text = "I understand this thread cannot be restored from this preview.",
                    modifier = Modifier.weight(1f),
                    color = if (confirmed) ThreadColors.Danger else ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            error?.let { message ->
                Text(
                    text = message,
                    color = ThreadColors.Danger,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun ConfirmRiskRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = label,
            modifier = Modifier.weight(0.35f),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = value,
            modifier = Modifier.weight(0.65f),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ChoicePill(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
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
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = if (selected) ThreadColors.Warning else ThreadColors.ForegroundSoft,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

@Composable
private fun ExportTurnRow(
    turn: ExportTurnPreview,
    selected: Boolean,
    onToggle: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(if (selected) ThreadColors.SurfaceStrong else ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(11.dp))
            .clickable(onClick = onToggle)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        GraphSelectionGlyph(
            selected = selected,
            contentDescription = if (selected) "Turn selected" else "Turn not selected",
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
