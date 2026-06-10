package com.remotecodex.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.theme.ThreadColors

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ThreadComposer(
    modifier: Modifier = Modifier,
) {
    var openMenu by remember { mutableStateOf<ComposerMenu?>(null) }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (openMenu != null) {
            when (openMenu) {
                ComposerMenu.Slash -> SlashToolboxPanel()
                ComposerMenu.Attachments -> AttachmentPanel()
                ComposerMenu.Model -> ModelPickerPanel()
                ComposerMenu.Effort -> EffortPickerPanel()
                ComposerMenu.ShellTools -> ShellToolsPanel()
                null -> Unit
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ComposerIcon(
                icon = ComposerToolIcon.Slash,
                selected = openMenu == ComposerMenu.Slash,
                onClick = { openMenu = openMenu.toggle(ComposerMenu.Slash) },
            )
            ComposerIcon(
                icon = ComposerToolIcon.Plus,
                selected = openMenu == ComposerMenu.Attachments,
                onClick = { openMenu = openMenu.toggle(ComposerMenu.Attachments) },
            )
            ComposerIcon(
                icon = ComposerToolIcon.Terminal,
                selected = openMenu == ComposerMenu.ShellTools,
                onClick = { openMenu = openMenu.toggle(ComposerMenu.ShellTools) },
            )
            Box(modifier = Modifier.weight(1f))
            InlineToggle(
                label = "gpt-5.4",
                selected = openMenu == ComposerMenu.Model,
                onClick = { openMenu = openMenu.toggle(ComposerMenu.Model) },
                modifier = Modifier.weight(1.25f, fill = false),
            )
            InlineToggle(
                label = "medium",
                selected = openMenu == ComposerMenu.Effort,
                onClick = { openMenu = openMenu.toggle(ComposerMenu.Effort) },
            )
        }
        ComposerInputGroupPreview()
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ComposerModeChip(label = "Plan", selected = false)
            ComposerModeChip(label = "2 files", selected = true)
            Text(
                text = "workspace write",
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Box(modifier = Modifier.weight(1f))
            ComposerViewToggleButton(
                icon = ComposerToolIcon.Terminal,
                label = "Shell",
            )
            ComposerSendButton()
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ComposerInputGroupPreview() {
    GraphInputGroup(
        blockStart = {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                AttachmentChip(kind = "PHOTO", name = "shell-preview.png")
                AttachmentChip(kind = "FILE", name = "android-client-architecture.md")
            }
        },
        control = {
            Text(
                text = "Ask the backend to inspect, modify, or explain code...",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodyLarge,
            )
            ContextProgressPreview()
        },
        blockEnd = {
            GraphInputGroupAddonRow {
                GraphInputGroupAddon(label = "Prompt")
                GraphInputGroupAddon(label = "Markdown")
                Box(modifier = Modifier.weight(1f))
                GraphInputGroupText(text = "42.8k / 128k")
            }
        },
    )
}

@Composable
private fun ContextProgressPreview() {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        GraphSlider(fraction = 0.67f)
        Text(
            text = "67% context left",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
        )
    }
}

@Composable
private fun AttachmentChip(
    kind: String,
    name: String,
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Text(
            text = kind,
            color = ThreadColors.Info,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
        Text(
            text = name,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ContextUsageRow() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Context window",
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            Text(
                text = "85.2k left",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
            )
        }
        ContextProgressPreview()
    }
}

@Composable
private fun ValueSliderPreview(
    label: String,
    valueLabel: String,
    fraction: Float,
) {
    GraphLabeledSlider(label = label, valueLabel = valueLabel, fraction = fraction)
}

@Composable
private fun AttachmentPreviewStrip() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "Queued attachments",
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            AttachmentChip(kind = "PHOTO", name = "shell-preview.png")
            AttachmentChip(kind = "FILE", name = "architecture.md")
        }
    }
}

@Composable
private fun ComposerIcon(
    icon: ComposerToolIcon,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val background = if (selected) ThreadColors.Primary else ThreadColors.Panel
    val foreground = if (selected) ThreadColors.PrimaryForeground else ThreadColors.ForegroundSoft
    Box(
        modifier = Modifier
            .size(34.dp)
            .clip(CircleShape)
            .background(background)
            .border(1.dp, if (selected) ThreadColors.Primary else ThreadColors.Border, CircleShape)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        ComposerToolGlyph(icon = icon, color = foreground)
    }
}

@Composable
private fun ComposerToolGlyph(icon: ComposerToolIcon, color: Color) {
    Canvas(modifier = Modifier.size(16.dp)) {
        val strokeWidth = 1.5.dp.toPx()
        val terminalStrokeWidth = 1.35.dp.toPx()
        val w = size.width
        val h = size.height
        fun line(
            startX: Float,
            startY: Float,
            endX: Float,
            endY: Float,
            width: Float = strokeWidth,
        ) {
            drawLine(
                color = color,
                start = Offset(w * startX, h * startY),
                end = Offset(w * endX, h * endY),
                strokeWidth = width,
                cap = StrokeCap.Round,
            )
        }

        when (icon) {
            ComposerToolIcon.Slash -> {
                line(0.67f, 0.16f, 0.33f, 0.84f)
                line(0.27f, 0.33f, 0.41f, 0.33f)
                line(0.59f, 0.67f, 0.73f, 0.67f)
            }
            ComposerToolIcon.Plus -> {
                line(0.50f, 0.20f, 0.50f, 0.80f)
                line(0.20f, 0.50f, 0.80f, 0.50f)
            }
            ComposerToolIcon.Terminal -> {
                line(0.25f, 0.31f, 0.38f, 0.44f, terminalStrokeWidth)
                line(0.38f, 0.44f, 0.25f, 0.56f, terminalStrokeWidth)
                line(0.48f, 0.59f, 0.75f, 0.59f, terminalStrokeWidth)
            }
            ComposerToolIcon.Chat -> {
                line(0.19f, 0.28f, 0.19f, 0.55f, terminalStrokeWidth)
                line(0.19f, 0.28f, 0.31f, 0.18f, terminalStrokeWidth)
                line(0.31f, 0.18f, 0.69f, 0.18f, terminalStrokeWidth)
                line(0.69f, 0.18f, 0.81f, 0.28f, terminalStrokeWidth)
                line(0.81f, 0.28f, 0.81f, 0.55f, terminalStrokeWidth)
                line(0.81f, 0.55f, 0.69f, 0.65f, terminalStrokeWidth)
                line(0.69f, 0.65f, 0.50f, 0.65f, terminalStrokeWidth)
                line(0.50f, 0.65f, 0.31f, 0.82f, terminalStrokeWidth)
                line(0.31f, 0.82f, 0.31f, 0.65f, terminalStrokeWidth)
                line(0.31f, 0.65f, 0.19f, 0.55f, terminalStrokeWidth)
            }
            ComposerToolIcon.Send -> {
                line(0.50f, 0.82f, 0.50f, 0.18f, 1.8.dp.toPx())
                line(0.25f, 0.43f, 0.50f, 0.18f, 1.8.dp.toPx())
                line(0.75f, 0.43f, 0.50f, 0.18f, 1.8.dp.toPx())
            }
        }
    }
}

@Composable
private fun ComposerSendButton() {
    Box(
        modifier = Modifier
            .size(36.dp)
            .clip(CircleShape)
            .background(ThreadColors.Primary)
            .border(1.dp, ThreadColors.Primary, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        ComposerToolGlyph(icon = ComposerToolIcon.Send, color = ThreadColors.PrimaryForeground)
    }
}

@Composable
private fun ComposerViewToggleButton(
    icon: ComposerToolIcon,
    label: String,
) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .padding(horizontal = 9.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        ComposerToolGlyph(icon = icon, color = ThreadColors.ForegroundSoft)
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
private fun InlineToggle(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val background = if (selected) ThreadColors.SurfaceStrong else ThreadColors.Panel
    Text(
        text = label,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 9.dp, vertical = 7.dp),
        color = ThreadColors.ForegroundSoft,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun ComposerModeChip(label: String, selected: Boolean) {
    val background = if (selected) ThreadColors.WarningSoft else ThreadColors.SurfaceStrong
    val foreground = if (selected) ThreadColors.Warning else ThreadColors.ForegroundMuted
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 6.dp),
        color = foreground,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun SlashToolboxPanel() {
    ComposerMenuSurface(title = "Slash toolbox", subtitle = "Thread actions") {
        ToolboxRow(command = "/goal", status = "Open", description = "Create or update the active thread goal.")
        ToolboxRow(command = "/fork", status = "Idle only", description = "Fork from latest or selected turn.")
        ToolboxRow(command = "/skills", status = "Open", description = "Inspect skills and copy invocation names.")
        ToolboxRow(command = "/mcp", status = "Open", description = "Inspect MCP servers, tools, resources, and auth.")
        ToolboxRow(command = "/hooks", status = "Open", description = "Review hook trust and project hook source.")
    }
}

@Composable
private fun AttachmentPanel() {
    ComposerMenuSurface(title = "Add attachment", subtitle = "Prompt context") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AttachmentButton(label = "Photo", detail = "camera or gallery", modifier = Modifier.weight(1f))
            AttachmentButton(label = "File", detail = "workspace upload", modifier = Modifier.weight(1f))
        }
        AttachmentPreviewStrip()
    }
}

@Composable
private fun ModelPickerPanel() {
    ComposerMenuSurface(title = "Model", subtitle = "Runtime preference") {
        ContextUsageRow()
        listOf("gpt-5.4", "gpt-5-codex", "gpt-4.1").forEachIndexed { index, model ->
            SelectionRow(label = model, detail = if (index == 0) "current" else "available", selected = index == 0)
        }
    }
}

@Composable
private fun EffortPickerPanel() {
    ComposerMenuSurface(title = "Reasoning effort", subtitle = "Per-thread setting") {
        ValueSliderPreview(label = "Effort budget", valueLabel = "medium", fraction = 0.58f)
        listOf("low", "medium", "high").forEach { effort ->
            SelectionRow(label = effort, detail = if (effort == "medium") "current" else "available", selected = effort == "medium")
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ShellToolsPanel() {
    ComposerMenuSurface(title = "Shell tools", subtitle = "Mobile terminal controls") {
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            listOf("Paste", "Copy", "Clear", "Ctrl-C", "Ctrl-D", "Esc", "Tab", "Up", "Down").forEach { label ->
                ShellToolPill(label = label)
            }
        }
    }
}

@Composable
private fun ComposerMenuSurface(
    title: String,
    subtitle: String,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(16.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    color = ThreadColors.CodeForeground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = subtitle,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            Box(
                modifier = Modifier
                    .size(7.dp)
                    .clip(CircleShape)
                    .background(ThreadColors.Info),
            )
        }
        content()
    }
}

@Composable
private fun ToolboxRow(command: String, status: String, description: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = command,
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = status,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
        }
        Text(
            text = description,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun AttachmentButton(label: String, detail: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = label,
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = detail,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun SelectionRow(label: String, detail: String, selected: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) ThreadColors.WarningSoft else ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(if (selected) ThreadColors.Warning else ThreadColors.BorderStrong),
        )
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            color = if (selected) ThreadColors.Warning else ThreadColors.Foreground,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = detail,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
    }
}

@Composable
private fun ShellToolPill(label: String) {
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = ThreadColors.ForegroundSoft,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
    )
}

private fun ComposerMenu?.toggle(target: ComposerMenu): ComposerMenu? {
    return if (this == target) null else target
}

private enum class ComposerMenu {
    Slash,
    Attachments,
    Model,
    Effort,
    ShellTools,
}

private enum class ComposerToolIcon {
    Slash,
    Plus,
    Terminal,
    Chat,
    Send,
}
