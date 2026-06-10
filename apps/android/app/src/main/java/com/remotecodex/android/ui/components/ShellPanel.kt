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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
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
                shell = shell,
                activeProcess = activeProcess,
                processesOpen = processesOpen,
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
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(12.dp),
                    )
                }
                ShellToolboxTrigger(
                    open = toolboxOpen,
                    onToggle = { toolboxOpen = !toolboxOpen },
                    liveCount = shell.processes.size,
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
        ConnectionButton(label = shell.connectionLabel, connected = shell.inputEnabled)
        Spacer(modifier = Modifier.weight(1f))
        ThreadStatusBadge(label = shell.status, status = ThreadStatus.Complete)
        ShellDangerButton(label = "Terminate")
    }
}

@Composable
private fun ConnectionButton(label: String, connected: Boolean) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (connected) ThreadColors.SuccessSoft else ThreadColors.WarningSoft)
            .border(1.dp, if (connected) ThreadColors.Success else ThreadColors.Warning, RoundedCornerShape(999.dp))
            .padding(horizontal = 9.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .clip(CircleShape)
                .background(if (connected) ThreadColors.Success else ThreadColors.Warning),
        )
        Text(
            text = label,
            color = if (connected) ThreadColors.Success else ThreadColors.Warning,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun ShellDangerButton(label: String) {
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.DangerSoft)
            .border(1.dp, ThreadColors.Danger.copy(alpha = 0.55f), RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 7.dp),
        color = ThreadColors.Danger,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun ShellTerminalBar(
    shell: ShellPreview,
    activeProcess: ShellProcessPreview?,
    processesOpen: Boolean,
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
            text = "Live ${shell.processes.size}",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
        Text(
            text = if (processesOpen) "Hide" else "Processes",
            modifier = Modifier
                .clip(RoundedCornerShape(7.dp))
                .background(ThreadColors.Surface.copy(alpha = 0.35f))
                .border(1.dp, ThreadColors.BorderStrong.copy(alpha = 0.65f), RoundedCornerShape(7.dp))
                .clickable(onClick = onToggleProcesses)
                .padding(horizontal = 9.dp, vertical = 6.dp),
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun ShellProcessDrawer(shell: ShellPreview) {
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
                text = "${shell.processes.size} live",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        shell.processes.forEach { process ->
            ShellProcessRow(process = process)
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            Text(
                text = "+",
                modifier = Modifier
                    .clip(RoundedCornerShape(9.dp))
                    .background(ThreadColors.InfoSoft)
                    .border(1.dp, ThreadColors.Info.copy(alpha = 0.6f), RoundedCornerShape(9.dp))
                    .padding(horizontal = 13.dp, vertical = 6.dp),
                color = ThreadColors.Info,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}

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
        Text(
            text = "Kill",
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .border(1.dp, ThreadColors.Danger.copy(alpha = 0.42f), RoundedCornerShape(999.dp))
                .padding(horizontal = 8.dp, vertical = 5.dp),
            color = ThreadColors.Danger,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
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
    modifier: Modifier = Modifier,
) {
    FlowRow(
        modifier = modifier
            .fillMaxWidth(0.72f)
            .clip(RoundedCornerShape(18.dp))
            .background(ThreadColors.CodeBackground.copy(alpha = 0.97f))
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(18.dp))
            .padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        controls.forEach { control ->
            ShellControlPill(label = control)
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
        Text(
            text = "Tools",
            color = if (open) ThreadColors.Primary else ThreadColors.CodeForeground,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = "$liveCount live",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun ShellControlPill(label: String) {
    val isDanger = label.equals("Ctrl-C", ignoreCase = true)
    Text(
        text = label.uppercase(),
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (isDanger) ThreadColors.DangerSoft else ThreadColors.Surface.copy(alpha = 0.55f))
            .border(1.dp, if (isDanger) ThreadColors.Danger.copy(alpha = 0.6f) else ThreadColors.BorderStrong.copy(alpha = 0.65f), RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 7.dp),
        color = if (isDanger) ThreadColors.Danger else ThreadColors.CodeForeground,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
    )
}

@Composable
private fun ShellCommandBar(shell: ShellPreview) {
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
            text = "Run a command...",
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            text = "Send",
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(ThreadColors.PrimaryForeground)
                .padding(horizontal = 13.dp, vertical = 8.dp),
            color = ThreadColors.Primary,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
    }
}
