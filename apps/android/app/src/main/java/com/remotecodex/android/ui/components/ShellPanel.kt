package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Canvas
import com.remotecodex.android.ui.model.ShellProcessPreview
import com.remotecodex.android.ui.model.ShellPreview
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.theme.ThreadColors

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ShellPanel(
    shell: ShellPreview,
    modifier: Modifier = Modifier,
) {
    var processesOpen by remember { mutableStateOf(false) }
    var toolboxOpen by remember { mutableStateOf(false) }
    val activeProcess = shell.processes.firstOrNull { it.id == shell.activeProcessId }
    val liveProcessCount = shell.processes.count { it.isLiveShellProcess() }
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(ThreadColors.Workspace)
            .padding(8.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(12.dp))
                .background(ThreadColors.CodeBackground)
                .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(12.dp)),
        ) {
            ShellHeader(shell = shell, activeProcess = activeProcess)
            ShellTerminalBar(
                activeProcess = activeProcess,
                processesOpen = processesOpen,
                liveProcessCount = liveProcessCount,
                onToggleProcesses = { processesOpen = !processesOpen },
            )
            if (processesOpen) {
                ShellProcessDrawer(shell = shell)
            }
            Box(modifier = Modifier.weight(1f)) {
                ShellOutput(shell = shell)
                if (toolboxOpen) {
                    ShellToolbox(
                        controls = shell.controls,
                        inputEnabled = shell.inputEnabled,
                        commandRunning = shell.commandRunning,
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(12.dp),
                    )
                }
                ShellToolboxTrigger(
                    open = toolboxOpen,
                    onToggle = { toolboxOpen = !toolboxOpen },
                    liveCount = liveProcessCount,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(12.dp),
                )
            }
            ShellCommandBar(shell = shell)
        }
    }
}

@Composable
private fun ShellHeader(shell: ShellPreview, activeProcess: ShellProcessPreview?) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(64.dp)
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.CodeBackground)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = "Shell",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = activeProcess?.cwd ?: shell.prompt,
                color = ThreadColors.CodeForeground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        ShellConnectionButton(label = shell.connectionLabel, connected = shell.inputEnabled)
        Spacer(modifier = Modifier.weight(1f))
        ThreadStatusBadge(label = shell.status, status = ThreadStatus.Complete)
        ShellIconPill(
            label = "Terminate",
            icon = ShellGlyphKind.Stop,
            tone = ShellControlTone.Danger,
            contentDescription = "Terminate active shell",
        )
    }
}

@Composable
private fun ShellConnectionButton(label: String, connected: Boolean) {
    val tone = if (connected) ShellControlTone.Success else ShellControlTone.Warning
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(shellToneBackground(tone))
            .border(1.dp, shellToneBorder(tone), RoundedCornerShape(999.dp))
            .semantics { contentDescription = if (connected) "Shell connected" else "Shell disconnected" }
            .padding(horizontal = 9.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        ShellGlyph(
            kind = if (connected) ShellGlyphKind.Link else ShellGlyphKind.Unlink,
            color = shellToneForeground(tone),
            modifier = Modifier.size(15.dp),
        )
        Text(
            text = label,
            color = shellToneForeground(tone),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun ShellIconPill(
    label: String,
    icon: ShellGlyphKind,
    tone: ShellControlTone,
    contentDescription: String,
    onClick: (() -> Unit)? = null,
) {
    val clickModifier = if (onClick == null) Modifier else Modifier.clickable(onClick = onClick)
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(shellToneBackground(tone))
            .border(1.dp, shellToneBorder(tone), RoundedCornerShape(999.dp))
            .semantics { this.contentDescription = contentDescription }
            .then(clickModifier)
            .padding(horizontal = 9.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        ShellGlyph(
            kind = icon,
            color = shellToneForeground(tone),
            modifier = Modifier.size(14.dp),
        )
        Text(
            text = label,
            color = shellToneForeground(tone),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun ShellIconButton(
    icon: ShellGlyphKind,
    tone: ShellControlTone,
    contentDescription: String,
    onClick: (() -> Unit)? = null,
) {
    val clickModifier = if (onClick == null) Modifier else Modifier.clickable(onClick = onClick)
    Box(
        modifier = Modifier
            .size(32.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(shellToneBackground(tone))
            .border(1.dp, shellToneBorder(tone), RoundedCornerShape(9.dp))
            .semantics { this.contentDescription = contentDescription }
            .then(clickModifier),
        contentAlignment = Alignment.Center,
    ) {
        ShellGlyph(
            kind = icon,
            color = shellToneForeground(tone),
            modifier = Modifier.size(16.dp),
        )
    }
}

@Composable
private fun ShellGlyph(
    kind: ShellGlyphKind,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        val strokeWidth = 1.45.dp.toPx()
        val stroke = Stroke(width = strokeWidth, cap = StrokeCap.Round)
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
            drawLine(
                color = color,
                start = Offset(size.width * x1, size.height * y1),
                end = Offset(size.width * x2, size.height * y2),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round,
            )
        }
        fun polyline(vararg points: Pair<Float, Float>) {
            if (points.size < 2) {
                return
            }
            points.asList().zipWithNext().forEach { (start, end) ->
                line(start.first, start.second, end.first, end.second)
            }
        }

        when (kind) {
            ShellGlyphKind.Link -> {
                drawArc(
                    color = color,
                    startAngle = 132f,
                    sweepAngle = 248f,
                    useCenter = false,
                    topLeft = Offset(size.width * 0.08f, size.height * 0.28f),
                    size = androidx.compose.ui.geometry.Size(size.width * 0.44f, size.height * 0.44f),
                    style = stroke,
                )
                drawArc(
                    color = color,
                    startAngle = -48f,
                    sweepAngle = 248f,
                    useCenter = false,
                    topLeft = Offset(size.width * 0.48f, size.height * 0.28f),
                    size = androidx.compose.ui.geometry.Size(size.width * 0.44f, size.height * 0.44f),
                    style = stroke,
                )
                line(0.38f, 0.50f, 0.62f, 0.50f)
            }
            ShellGlyphKind.Unlink -> {
                drawArc(
                    color = color,
                    startAngle = 132f,
                    sweepAngle = 172f,
                    useCenter = false,
                    topLeft = Offset(size.width * 0.08f, size.height * 0.28f),
                    size = androidx.compose.ui.geometry.Size(size.width * 0.44f, size.height * 0.44f),
                    style = stroke,
                )
                drawArc(
                    color = color,
                    startAngle = -48f,
                    sweepAngle = 172f,
                    useCenter = false,
                    topLeft = Offset(size.width * 0.48f, size.height * 0.28f),
                    size = androidx.compose.ui.geometry.Size(size.width * 0.44f, size.height * 0.44f),
                    style = stroke,
                )
                line(0.18f, 0.18f, 0.82f, 0.82f)
            }
            ShellGlyphKind.Stop -> {
                val path = Path().apply {
                    moveTo(size.width * 0.36f, size.height * 0.16f)
                    lineTo(size.width * 0.64f, size.height * 0.16f)
                    lineTo(size.width * 0.84f, size.height * 0.36f)
                    lineTo(size.width * 0.84f, size.height * 0.64f)
                    lineTo(size.width * 0.64f, size.height * 0.84f)
                    lineTo(size.width * 0.36f, size.height * 0.84f)
                    lineTo(size.width * 0.16f, size.height * 0.64f)
                    lineTo(size.width * 0.16f, size.height * 0.36f)
                    close()
                }
                drawPath(path = path, color = color, style = stroke)
                line(0.34f, 0.34f, 0.66f, 0.66f)
                line(0.66f, 0.34f, 0.34f, 0.66f)
            }
            ShellGlyphKind.Rows -> {
                line(0.20f, 0.30f, 0.80f, 0.30f)
                line(0.20f, 0.50f, 0.80f, 0.50f)
                line(0.20f, 0.70f, 0.80f, 0.70f)
            }
            ShellGlyphKind.ChevronUp -> {
                polyline(0.24f to 0.62f, 0.50f to 0.36f, 0.76f to 0.62f)
            }
            ShellGlyphKind.Plus -> {
                line(0.50f, 0.20f, 0.50f, 0.80f)
                line(0.20f, 0.50f, 0.80f, 0.50f)
            }
            ShellGlyphKind.Tools -> {
                line(0.20f, 0.78f, 0.58f, 0.40f)
                line(0.42f, 0.22f, 0.78f, 0.58f)
                drawCircle(
                    color = color,
                    radius = size.minDimension * 0.10f,
                    center = Offset(size.width * 0.22f, size.height * 0.78f),
                    style = stroke,
                )
                line(0.62f, 0.28f, 0.74f, 0.16f)
                line(0.74f, 0.16f, 0.84f, 0.26f)
                line(0.84f, 0.26f, 0.72f, 0.38f)
            }
        }
    }
}

@Composable
private fun shellToneBackground(tone: ShellControlTone): Color {
    return when (tone) {
        ShellControlTone.Neutral -> ThreadColors.Surface.copy(alpha = 0.55f)
        ShellControlTone.Info -> ThreadColors.InfoSoft
        ShellControlTone.Success -> ThreadColors.SuccessSoft
        ShellControlTone.Warning -> ThreadColors.WarningSoft
        ShellControlTone.Danger -> ThreadColors.DangerSoft
    }
}

@Composable
private fun shellToneBorder(tone: ShellControlTone): Color {
    return when (tone) {
        ShellControlTone.Neutral -> ThreadColors.BorderStrong.copy(alpha = 0.65f)
        ShellControlTone.Info -> ThreadColors.Info.copy(alpha = 0.60f)
        ShellControlTone.Success -> ThreadColors.Success.copy(alpha = 0.60f)
        ShellControlTone.Warning -> ThreadColors.Warning.copy(alpha = 0.60f)
        ShellControlTone.Danger -> ThreadColors.Danger.copy(alpha = 0.60f)
    }
}

@Composable
private fun shellToneForeground(tone: ShellControlTone): Color {
    return when (tone) {
        ShellControlTone.Neutral -> ThreadColors.CodeForeground
        ShellControlTone.Info -> ThreadColors.Info
        ShellControlTone.Success -> ThreadColors.Success
        ShellControlTone.Warning -> ThreadColors.Warning
        ShellControlTone.Danger -> ThreadColors.Danger
    }
}

@Composable
private fun ShellTerminalBar(
    activeProcess: ShellProcessPreview?,
    processesOpen: Boolean,
    liveProcessCount: Int,
    onToggleProcesses: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(44.dp)
            .background(ThreadColors.Surface.copy(alpha = 0.16f))
            .border(1.dp, ThreadColors.BorderStrong.copy(alpha = 0.55f))
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = activeProcess?.label ?: "No live shell process",
                color = ThreadColors.CodeForeground,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            activeProcess?.status?.let { status ->
                Text(
                    text = status,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
            }
        }
        Text(
            text = "Live $liveProcessCount",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
        ShellIconPill(
            label = if (processesOpen) "Hide" else "Processes",
            icon = if (processesOpen) ShellGlyphKind.ChevronUp else ShellGlyphKind.Rows,
            tone = ShellControlTone.Neutral,
            onClick = onToggleProcesses,
            contentDescription = if (processesOpen) "Hide shell processes" else "Show shell processes",
        )
    }
}

@Composable
private fun ShellProcessDrawer(shell: ShellPreview) {
    val liveProcesses = shell.processes.filter { it.isLiveShellProcess() }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(ThreadColors.CodeBackground.copy(alpha = 0.92f))
            .border(1.dp, ThreadColors.BorderStrong.copy(alpha = 0.55f))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Processes",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = "${liveProcesses.size} live",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        if (liveProcesses.isEmpty()) {
            Text(
                text = "No live shell processes",
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(9.dp))
                    .background(ThreadColors.Surface.copy(alpha = 0.24f))
                    .border(1.dp, ThreadColors.BorderStrong.copy(alpha = 0.46f), RoundedCornerShape(9.dp))
                    .padding(horizontal = 10.dp, vertical = 12.dp),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        } else {
            liveProcesses.forEach { process ->
                ShellProcessRow(process = process)
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            ShellIconButton(
                icon = ShellGlyphKind.Plus,
                tone = ShellControlTone.Info,
                contentDescription = "New shell",
            )
        }
    }
}

private fun ShellProcessPreview.isLiveShellProcess(): Boolean =
    status.equals("running", ignoreCase = true) ||
        status.equals("attached", ignoreCase = true) ||
        runningCommand != null

@Composable
private fun ShellProcessRow(process: ShellProcessPreview) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (process.active) ThreadColors.SurfaceStrong.copy(alpha = 0.58f) else ThreadColors.Surface.copy(alpha = 0.26f))
            .border(1.dp, if (process.active) ThreadColors.Info.copy(alpha = 0.55f) else ThreadColors.BorderStrong.copy(alpha = 0.46f), RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(if (process.status == "running" || process.runningCommand != null) ThreadColors.Warning else ThreadColors.Success),
        )
        Column(modifier = Modifier.weight(1f)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = process.label,
                    color = ThreadColors.CodeForeground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = process.status,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                )
            }
            Text(
                text = process.runningCommand ?: process.cwd,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        ShellIconPill(
            label = "Kill",
            icon = ShellGlyphKind.Stop,
            tone = ShellControlTone.Danger,
            contentDescription = "Kill shell process",
        )
    }
}

@Composable
private fun ShellOutput(shell: ShellPreview) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .horizontalScroll(rememberScrollState())
            .verticalScroll(rememberScrollState())
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        shell.lines.forEach { line ->
            Text(
                text = line,
                color = when {
                    line.contains("SUCCESSFUL") -> ThreadColors.SuccessSoft
                    line.startsWith("> Task") -> ThreadColors.ForegroundMuted
                    else -> ThreadColors.CodeForeground
                },
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
            )
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ShellToolbox(
    controls: List<String>,
    inputEnabled: Boolean,
    commandRunning: Boolean,
    modifier: Modifier = Modifier,
) {
    val feedback = when {
        !inputEnabled -> "Connect the shell first"
        commandRunning -> "Shell is running"
        else -> "Shell tools ready"
    }
    Column(
        modifier = modifier
            .fillMaxWidth(0.72f)
            .clip(RoundedCornerShape(18.dp))
            .background(ThreadColors.CodeBackground.copy(alpha = 0.97f))
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(18.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = feedback,
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(
                    when {
                        !inputEnabled -> ThreadColors.WarningSoft
                        commandRunning -> ThreadColors.SuccessSoft
                        else -> ThreadColors.Surface.copy(alpha = 0.45f)
                    },
                )
                .border(
                    1.dp,
                    when {
                        !inputEnabled -> ThreadColors.Warning.copy(alpha = 0.52f)
                        commandRunning -> ThreadColors.Success.copy(alpha = 0.52f)
                        else -> ThreadColors.BorderStrong.copy(alpha = 0.62f)
                    },
                    RoundedCornerShape(999.dp),
                )
                .padding(horizontal = 9.dp, vertical = 5.dp),
            color = when {
                !inputEnabled -> ThreadColors.Warning
                commandRunning -> ThreadColors.Success
                else -> ThreadColors.ForegroundMuted
            },
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            controls.forEach { control ->
                val requiresInput = !control.equals("Paste", ignoreCase = true) &&
                    !control.equals("Copy", ignoreCase = true)
                val enabled = when {
                    control.equals("Ctrl-C", ignoreCase = true) -> inputEnabled && commandRunning
                    requiresInput -> inputEnabled
                    else -> true
                }
                ShellControlPill(label = control, enabled = enabled)
            }
        }
    }
}

@Composable
private fun ShellToolboxTrigger(
    open: Boolean,
    onToggle: () -> Unit,
    liveCount: Int,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (open) ThreadColors.PrimaryForeground else ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(999.dp))
            .clickable(onClick = onToggle)
            .padding(horizontal = 12.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ShellGlyph(
            kind = ShellGlyphKind.Tools,
            color = if (open) ThreadColors.Primary else ThreadColors.CodeForeground,
            modifier = Modifier.size(16.dp),
        )
        Text(
            text = "$liveCount live",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun ShellControlPill(label: String, enabled: Boolean = true) {
    val tone = when {
        label.equals("Ctrl-C", ignoreCase = true) -> ShellControlTone.Danger
        label.equals("Clear", ignoreCase = true) -> ShellControlTone.Info
        else -> ShellControlTone.Neutral
    }
    val background = if (enabled) shellToneBackground(tone) else ThreadColors.Surface.copy(alpha = 0.24f)
    val border = if (enabled) shellToneBorder(tone) else ThreadColors.BorderStrong.copy(alpha = 0.42f)
    val foreground = if (enabled) shellToneForeground(tone) else ThreadColors.ForegroundMuted
    Text(
        text = label.uppercase(),
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 7.dp),
        color = foreground,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        maxLines = 1,
    )
}

@Composable
private fun ShellCommandBar(shell: ShellPreview) {
    val promptText = when {
        !shell.inputEnabled -> "Connect the shell first"
        shell.commandRunning -> "Command running..."
        else -> "Run a command..."
    }
    val sendEnabled = shell.inputEnabled && !shell.commandRunning
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong.copy(alpha = 0.55f))
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = shell.prompt,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelMedium,
            fontFamily = FontFamily.Monospace,
        )
        Text(
            text = promptText,
            modifier = Modifier.weight(1f),
            color = if (shell.inputEnabled) ThreadColors.ForegroundMuted else ThreadColors.Warning,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = if (shell.commandRunning) "Running" else "Send",
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(if (sendEnabled) ThreadColors.PrimaryForeground else ThreadColors.Surface.copy(alpha = 0.42f))
                .border(1.dp, if (sendEnabled) ThreadColors.PrimaryForeground else ThreadColors.BorderStrong, RoundedCornerShape(999.dp))
                .padding(horizontal = 13.dp, vertical = 8.dp),
            color = if (sendEnabled) ThreadColors.Primary else ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

private enum class ShellGlyphKind {
    Link,
    Unlink,
    Stop,
    Rows,
    ChevronUp,
    Plus,
    Tools,
}

private enum class ShellControlTone {
    Neutral,
    Info,
    Success,
    Warning,
    Danger,
}
