package com.remotecodex.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.model.ThreadDetailPreview
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.delay

@Composable
@OptIn(ExperimentalLayoutApi::class)
fun ThreadTopBar(
    detail: ThreadDetailPreview,
    selectedView: ThreadSurfaceView,
    onViewSelected: (ThreadSurfaceView) -> Unit,
    shellEnabled: Boolean = false,
    onOpenRooms: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var detailsOpen by remember { mutableStateOf(false) }
    val activeRoom = detail.rooms.firstOrNull { it.active } ?: detail.rooms.firstOrNull()
    val sessionLabel = activeRoom?.sessionId ?: detail.runtime
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
            TopBarIconButton(
                icon = TopBarIcon.Menu,
                contentDescription = "Open threads",
                onClick = onOpenRooms,
                modifier = Modifier.padding(top = 7.dp),
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
                TopBarMetaRow(
                    label = "Workspace",
                    value = detail.workspace,
                    expanded = detailsOpen,
                    onClick = { detailsOpen = !detailsOpen },
                )
            }
        }
        if (detailsOpen) {
            ThreadTopBarDetails(
                room = activeRoom?.id ?: detail.title,
                workspace = detail.workspace,
                session = sessionLabel,
                usage = detail.usage,
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
            if (shellEnabled) {
                SegmentButton(
                    label = "Shell",
                    selected = selectedView == ThreadSurfaceView.Shell,
                    onClick = { onViewSelected(ThreadSurfaceView.Shell) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun TopBarMetaRow(
    label: String,
    value: String,
    expanded: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .padding(top = 2.dp)
            .clip(RoundedCornerShape(999.dp))
            .semantics { contentDescription = if (expanded) "Hide session and usage" else "Show session and usage" }
            .clickable(onClick = onClick)
            .padding(horizontal = 0.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(
            text = label,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
        )
        Text(
            text = value,
            modifier = Modifier.weight(1f, fill = false),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        TopBarGlyph(
            icon = if (expanded) TopBarIcon.ChevronUp else TopBarIcon.ChevronDown,
            color = ThreadColors.ForegroundMuted,
            modifier = Modifier.size(11.dp),
        )
    }
}

@Composable
private fun ThreadTopBarDetails(
    room: String,
    workspace: String,
    session: String,
    usage: String,
) {
    val clipboard = LocalClipboardManager.current
    var copiedLabel by remember(room, session) { mutableStateOf<String?>(null) }

    LaunchedEffect(copiedLabel) {
        if (copiedLabel != null) {
            delay(1200)
            copiedLabel = null
        }
    }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(11.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        TopBarDetailRow(
            label = "Room",
            value = room,
            copyable = true,
            copied = copiedLabel == "Room",
            onCopy = {
                clipboard.setText(AnnotatedString(room))
                copiedLabel = "Room"
            },
        )
        TopBarDetailRow(label = "Workspace", value = workspace)
        TopBarDetailRow(
            label = "Session",
            value = session,
            copyable = true,
            copied = copiedLabel == "Session",
            onCopy = {
                clipboard.setText(AnnotatedString(session))
                copiedLabel = "Session"
            },
        )
        TopBarDetailRow(label = "Usage", value = usage)
    }
}

@Composable
private fun TopBarDetailRow(
    label: String,
    value: String,
    copyable: Boolean = false,
    copied: Boolean = false,
    onCopy: () -> Unit = {},
) {
    val baseModifier = Modifier
        .fillMaxWidth()
        .clip(RoundedCornerShape(7.dp))
    val rowModifier = if (copyable) {
        baseModifier
            .semantics { contentDescription = if (copied) "$label copied" else "Copy $label" }
            .clickable(onClick = onCopy)
            .padding(horizontal = 6.dp, vertical = 4.dp)
    } else {
        baseModifier.padding(horizontal = 6.dp, vertical = 4.dp)
    }
    Row(
        modifier = rowModifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = label,
            modifier = Modifier.weight(0.34f),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
        Text(
            text = value,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (copyable) {
            Text(
                text = if (copied) "Copied" else "Copy",
                color = if (copied) ThreadColors.Info else ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun TopBarActionPill(
    label: String,
    icon: TopBarIcon,
    contentDescription: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .semantics { this.contentDescription = contentDescription }
            .clickable(onClick = onClick)
            .padding(horizontal = 9.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        TopBarGlyph(icon = icon, color = ThreadColors.ForegroundSoft, modifier = Modifier.size(13.dp))
        Text(
            text = label,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun TopBarIconButton(
    icon: TopBarIcon,
    contentDescription: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .size(32.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .semantics { this.contentDescription = contentDescription }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        TopBarGlyph(icon = icon, color = ThreadColors.ForegroundSoft)
    }
}

@Composable
private fun ThemeModeStatusButton(
    themeMode: ThemeMode,
    darkThemeActive: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val icon = when (themeMode) {
        ThemeMode.System -> TopBarIcon.SystemTheme
        ThemeMode.Light -> TopBarIcon.LightTheme
        ThemeMode.Dark -> TopBarIcon.DarkTheme
    }
    val effectiveTheme = if (darkThemeActive) "dark" else "light"
    Box(
        modifier = modifier
            .size(32.dp)
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .semantics {
                contentDescription = "Current theme: ${themeMode.label}, effective $effectiveTheme. Open settings"
            }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        TopBarGlyph(icon = icon, color = ThreadColors.ForegroundSoft, modifier = Modifier.size(15.dp))
    }
}

@Composable
private fun TopBarGlyph(
    icon: TopBarIcon,
    color: Color,
    modifier: Modifier = Modifier.size(16.dp),
) {
    Canvas(modifier = modifier) {
        val strokeWidth = 1.5.dp.toPx()
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

        when (icon) {
            TopBarIcon.Menu -> {
                line(0.22f, 0.32f, 0.78f, 0.32f)
                line(0.22f, 0.50f, 0.78f, 0.50f)
                line(0.22f, 0.68f, 0.78f, 0.68f)
            }
            TopBarIcon.Settings -> {
                drawCircle(
                    color = color,
                    radius = w * 0.17f,
                    center = Offset(w * 0.50f, h * 0.50f),
                    style = Stroke(width = strokeWidth),
                )
                line(0.50f, 0.13f, 0.50f, 0.25f)
                line(0.50f, 0.75f, 0.50f, 0.87f)
                line(0.13f, 0.50f, 0.25f, 0.50f)
                line(0.75f, 0.50f, 0.87f, 0.50f)
                line(0.24f, 0.24f, 0.32f, 0.32f)
                line(0.68f, 0.68f, 0.76f, 0.76f)
                line(0.76f, 0.24f, 0.68f, 0.32f)
                line(0.32f, 0.68f, 0.24f, 0.76f)
            }
            TopBarIcon.Actions -> {
                line(0.18f, 0.30f, 0.82f, 0.30f)
                line(0.18f, 0.50f, 0.82f, 0.50f)
                line(0.18f, 0.70f, 0.82f, 0.70f)
            }
            TopBarIcon.Threads -> {
                line(0.20f, 0.25f, 0.80f, 0.25f)
                line(0.80f, 0.25f, 0.80f, 0.68f)
                line(0.80f, 0.68f, 0.56f, 0.68f)
                line(0.56f, 0.68f, 0.42f, 0.82f)
                line(0.42f, 0.82f, 0.42f, 0.68f)
                line(0.42f, 0.68f, 0.20f, 0.68f)
                line(0.20f, 0.68f, 0.20f, 0.25f)
            }
            TopBarIcon.ArrowLeft -> {
                line(0.72f, 0.50f, 0.24f, 0.50f)
                line(0.24f, 0.50f, 0.44f, 0.30f)
                line(0.24f, 0.50f, 0.44f, 0.70f)
            }
            TopBarIcon.Plus -> {
                line(0.50f, 0.22f, 0.50f, 0.78f)
                line(0.22f, 0.50f, 0.78f, 0.50f)
            }
            TopBarIcon.ChevronDown -> {
                line(0.24f, 0.38f, 0.50f, 0.64f)
                line(0.50f, 0.64f, 0.76f, 0.38f)
            }
            TopBarIcon.ChevronUp -> {
                line(0.24f, 0.62f, 0.50f, 0.36f)
                line(0.50f, 0.36f, 0.76f, 0.62f)
            }
            TopBarIcon.Rename -> {
                line(0.22f, 0.78f, 0.34f, 0.58f)
                line(0.34f, 0.58f, 0.70f, 0.22f)
                line(0.70f, 0.22f, 0.82f, 0.34f)
                line(0.82f, 0.34f, 0.46f, 0.70f)
                line(0.46f, 0.70f, 0.22f, 0.78f)
                line(0.62f, 0.30f, 0.74f, 0.42f)
            }
            TopBarIcon.Export -> {
                line(0.50f, 0.18f, 0.50f, 0.58f)
                line(0.34f, 0.42f, 0.50f, 0.58f)
                line(0.66f, 0.42f, 0.50f, 0.58f)
                line(0.22f, 0.68f, 0.22f, 0.82f)
                line(0.22f, 0.82f, 0.78f, 0.82f)
                line(0.78f, 0.82f, 0.78f, 0.68f)
            }
            TopBarIcon.Delete -> {
                line(0.30f, 0.28f, 0.70f, 0.28f)
                line(0.42f, 0.18f, 0.58f, 0.18f)
                line(0.38f, 0.18f, 0.62f, 0.18f)
                rect(0.34f, 0.34f, 0.66f, 0.82f)
                line(0.45f, 0.44f, 0.45f, 0.72f)
                line(0.55f, 0.44f, 0.55f, 0.72f)
            }
            TopBarIcon.SystemTheme -> {
                rect(0.18f, 0.24f, 0.82f, 0.66f)
                line(0.38f, 0.82f, 0.62f, 0.82f)
                line(0.50f, 0.66f, 0.50f, 0.82f)
            }
            TopBarIcon.LightTheme -> {
                drawCircle(
                    color = color,
                    radius = w * 0.18f,
                    center = Offset(w * 0.50f, h * 0.50f),
                    style = Stroke(width = strokeWidth),
                )
                line(0.50f, 0.12f, 0.50f, 0.24f)
                line(0.50f, 0.76f, 0.50f, 0.88f)
                line(0.12f, 0.50f, 0.24f, 0.50f)
                line(0.76f, 0.50f, 0.88f, 0.50f)
                line(0.23f, 0.23f, 0.31f, 0.31f)
                line(0.69f, 0.69f, 0.77f, 0.77f)
                line(0.77f, 0.23f, 0.69f, 0.31f)
                line(0.31f, 0.69f, 0.23f, 0.77f)
            }
            TopBarIcon.DarkTheme -> {
                val moon = androidx.compose.ui.graphics.Path().apply {
                    moveTo(w * 0.68f, h * 0.18f)
                    cubicTo(w * 0.50f, h * 0.22f, w * 0.36f, h * 0.38f, w * 0.36f, h * 0.58f)
                    cubicTo(w * 0.36f, h * 0.76f, w * 0.50f, h * 0.88f, w * 0.68f, h * 0.86f)
                    cubicTo(w * 0.54f, h * 0.94f, w * 0.24f, h * 0.82f, w * 0.22f, h * 0.54f)
                    cubicTo(w * 0.20f, h * 0.30f, w * 0.42f, h * 0.12f, w * 0.68f, h * 0.18f)
                }
                drawPath(path = moon, color = color, style = Stroke(width = strokeWidth, cap = StrokeCap.Round))
            }
        }
    }
}

private enum class TopBarIcon {
    Menu,
    Settings,
    Actions,
    Threads,
    ArrowLeft,
    Plus,
    ChevronDown,
    ChevronUp,
    Rename,
    Export,
    Delete,
    SystemTheme,
    LightTheme,
    DarkTheme,
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ThreadActionMenu(
    onOpenAppNav: () -> Unit,
    onOpenRooms: () -> Unit,
    onReturnToWorkspace: () -> Unit,
    onCreateThreadShortcut: () -> Unit,
    onOpenThreadAction: (ThreadActionDialog) -> Unit,
) {
    FlowRow(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(11.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(11.dp))
            .padding(8.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        ActionMenuButton(
            label = "App",
            icon = TopBarIcon.Menu,
            onClick = onOpenAppNav,
        )
        ActionMenuButton(
            label = "Threads",
            icon = TopBarIcon.Threads,
            onClick = onOpenRooms,
        )
        ActionMenuButton(
            label = "Workspace",
            icon = TopBarIcon.ArrowLeft,
            onClick = onReturnToWorkspace,
        )
        ActionMenuButton(
            label = "New",
            icon = TopBarIcon.Plus,
            onClick = onCreateThreadShortcut,
        )
        ActionMenuButton(
            label = "Rename",
            icon = TopBarIcon.Rename,
            onClick = { onOpenThreadAction(ThreadActionDialog.Rename) },
        )
        ActionMenuButton(
            label = "Export",
            icon = TopBarIcon.Export,
            onClick = { onOpenThreadAction(ThreadActionDialog.Export) },
        )
        ActionMenuButton(
            label = "Delete",
            icon = TopBarIcon.Delete,
            onClick = { onOpenThreadAction(ThreadActionDialog.Delete) },
            danger = true,
        )
    }
}

@Composable
private fun ActionMenuButton(
    label: String,
    icon: TopBarIcon,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
) {
    val foreground = if (danger) ThreadColors.Danger else ThreadColors.ForegroundSoft
    Row(
        modifier = modifier
            .height(36.dp)
            .widthIn(min = 96.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (danger) ThreadColors.DangerSoft else ThreadColors.SurfaceStrong)
            .border(
                1.dp,
                if (danger) ThreadColors.Danger.copy(alpha = 0.36f) else ThreadColors.Border,
                RoundedCornerShape(8.dp),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        TopBarGlyph(icon = icon, color = foreground, modifier = Modifier.size(14.dp))
        Text(
            text = label,
            color = foreground,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
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
