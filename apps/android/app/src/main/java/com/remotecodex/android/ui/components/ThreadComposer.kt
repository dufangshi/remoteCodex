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
import com.remotecodex.android.ui.model.ComposerPreview
import com.remotecodex.android.ui.presentation.ComposerActionState
import com.remotecodex.android.ui.presentation.ComposerPrimaryActionKind
import com.remotecodex.android.ui.presentation.ComposerStatusChipModel
import com.remotecodex.android.ui.presentation.ComposerStatusTone
import com.remotecodex.android.ui.presentation.buildComposerActionState
import com.remotecodex.android.ui.presentation.buildComposerStatusStrip
import com.remotecodex.android.ui.theme.ThreadColors

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ThreadComposer(
    modifier: Modifier = Modifier,
    composer: ComposerPreview = ComposerPreview(),
) {
    var openMenu by remember { mutableStateOf<ComposerMenu?>(null) }
    val statusChips = buildComposerStatusStrip(
        threadConnected = composer.threadConnected,
        busy = composer.busy,
        followTail = composer.followTail,
        activeView = composer.activeView,
        workspaceModeLabel = composer.workspaceModeLabel,
    )
    val actionState = buildComposerActionState(
        threadConnected = composer.threadConnected,
        busy = composer.busy,
        activeView = composer.activeView,
        canInterrupt = composer.canInterrupt,
    )
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
        ComposerStatusStrip(chips = statusChips)
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ComposerModeChip(label = "Plan", selected = false)
            ComposerModeChip(label = "2 files", selected = true)
            Box(modifier = Modifier.weight(1f))
            ComposerViewToggleButton(
                icon = ComposerToolIcon.Terminal,
                label = "Shell",
            )
            ComposerActionControls(actionState = actionState)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ComposerStatusStrip(chips: List<ComposerStatusChipModel>) {
    FlowRow(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        chips.forEach { chip ->
            ComposerStatusChip(chip = chip)
        }
    }
}

@Composable
private fun ComposerStatusChip(chip: ComposerStatusChipModel) {
    val foreground = when (chip.tone) {
        ComposerStatusTone.Neutral -> ThreadColors.ForegroundMuted
        ComposerStatusTone.Running -> ThreadColors.Warning
        ComposerStatusTone.Success -> ThreadColors.Success
        ComposerStatusTone.Danger -> ThreadColors.Danger
        ComposerStatusTone.Warning -> ThreadColors.Warning
    }
    val background = when (chip.tone) {
        ComposerStatusTone.Neutral -> ThreadColors.SurfaceStrong
        ComposerStatusTone.Running -> ThreadColors.WarningSoft.copy(alpha = 0.58f)
        ComposerStatusTone.Success -> ThreadColors.SuccessSoft.copy(alpha = 0.56f)
        ComposerStatusTone.Danger -> ThreadColors.DangerSoft.copy(alpha = 0.58f)
        ComposerStatusTone.Warning -> ThreadColors.WarningSoft.copy(alpha = 0.58f)
    }
    val border = when (chip.tone) {
        ComposerStatusTone.Neutral -> ThreadColors.Border
        else -> foreground.copy(alpha = 0.38f)
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (chip.tone != ComposerStatusTone.Neutral) {
            Box(
                modifier = Modifier
                    .size(6.dp)
                    .clip(CircleShape)
                    .background(foreground),
            )
        }
        Text(
            text = chip.label,
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
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
                AttachmentChip(icon = AttachmentTileIcon.Photo, name = "shell-preview.png")
                AttachmentChip(icon = AttachmentTileIcon.File, name = "android-client-architecture.md")
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
    icon: AttachmentTileIcon,
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
        AttachmentTileGlyph(icon = icon, color = ThreadColors.Info)
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
            AttachmentChip(icon = AttachmentTileIcon.Photo, name = "shell-preview.png")
            AttachmentChip(icon = AttachmentTileIcon.File, name = "architecture.md")
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
private fun ComposerActionControls(actionState: ComposerActionState) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        if (actionState.showInterrupt) {
            ComposerInterruptButton(label = actionState.interruptLabel)
        }
        ComposerPrimaryActionButton(actionState = actionState)
    }
}

@Composable
private fun ComposerInterruptButton(label: String) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.DangerSoft.copy(alpha = 0.58f))
            .border(1.dp, ThreadColors.Danger.copy(alpha = 0.42f), RoundedCornerShape(999.dp))
            .padding(horizontal = 9.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            modifier = Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(ThreadColors.Danger),
        )
        Text(
            text = label,
            color = ThreadColors.Danger,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ComposerPrimaryActionButton(actionState: ComposerActionState) {
    val enabled = actionState.sendEnabled
    val isStop = actionState.primaryKind == ComposerPrimaryActionKind.Stop
    val isConnecting = actionState.primaryKind == ComposerPrimaryActionKind.Connecting
    val background = when {
        isStop -> ThreadColors.Danger
        isConnecting -> ThreadColors.WarningSoft
        enabled -> ThreadColors.Primary
        else -> ThreadColors.SurfaceStrong
    }
    val foreground = when {
        isStop -> ThreadColors.PrimaryForeground
        isConnecting -> ThreadColors.Warning
        enabled -> ThreadColors.PrimaryForeground
        else -> ThreadColors.ForegroundMuted
    }
    val border = when {
        isStop -> ThreadColors.Danger
        isConnecting -> ThreadColors.Warning.copy(alpha = 0.46f)
        enabled -> ThreadColors.Primary
        else -> ThreadColors.Border
    }
    val horizontalPadding = if (actionState.primaryLabel == "Send") 0.dp else 11.dp
    Row(
        modifier = Modifier
            .then(
                if (actionState.primaryLabel == "Send") {
                    Modifier.size(36.dp)
                } else {
                    Modifier
                },
            )
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(999.dp))
            .padding(horizontal = horizontalPadding, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = if (actionState.primaryLabel == "Send") {
            Arrangement.Center
        } else {
            Arrangement.spacedBy(7.dp)
        },
    ) {
        ComposerPrimaryActionGlyph(kind = actionState.primaryKind, color = foreground)
        if (actionState.primaryLabel != "Send") {
            Text(
                text = actionState.primaryLabel,
                color = foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ComposerPrimaryActionGlyph(
    kind: ComposerPrimaryActionKind,
    color: Color,
) {
    when (kind) {
        ComposerPrimaryActionKind.Stop -> Box(
            modifier = Modifier
                .size(10.dp)
                .clip(RoundedCornerShape(2.dp))
                .background(color),
        )
        ComposerPrimaryActionKind.Send -> ComposerToolGlyph(icon = ComposerToolIcon.Send, color = color)
        ComposerPrimaryActionKind.Connecting -> Box(
            modifier = Modifier
                .size(10.dp)
                .clip(CircleShape)
                .background(color),
        )
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
        GoalPreviewGroup()
        ForkPreviewGroup()
        SkillsPreviewGroup()
        McpPreviewGroup()
        HooksPreviewGroup()
    }
}

@Composable
private fun GoalPreviewGroup() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "/goal",
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            GraphBadge(
                label = "Active",
                variant = GraphBadgeVariant.Default,
            )
        }
        Text(
            text = "Create or update the active thread goal.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        GoalComposePreviewCard()
        GoalStatusPreviewRow()
        HookStatusRow(
            message = "Fast mode is on. Turn it off from the slash toolbox to edit reasoning.",
            tone = HookStatusTone.Warning,
        )
    }
}

@Composable
private fun GoalComposePreviewCard() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Goal",
                color = ThreadColors.CodeForeground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
            GraphBadge(label = "12.5k budget", variant = GraphBadgeVariant.Outline)
        }
        Text(
            text = "Describe the goal the backend should continue working toward...",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            GraphBadge(label = "Cancel", variant = GraphBadgeVariant.Outline)
            GraphBadge(label = "Set goal", variant = GraphBadgeVariant.Default)
            GraphBadge(label = "Setting...", variant = GraphBadgeVariant.Outline)
        }
    }
}

@Composable
private fun GoalStatusPreviewRow() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.SurfaceStrong)
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
                text = "Current goal",
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            GraphBadge(label = "Budget", variant = GraphBadgeVariant.Outline)
        }
        Text(
            text = "Keep Android client parity moving through composer and control surface gaps.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        HookStatusRow(
            message = "Token budget must be a positive number in thousands.",
            tone = HookStatusTone.Error,
        )
    }
}

@Composable
private fun ForkPreviewGroup() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "/fork",
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            GraphBadge(
                label = "Idle only",
                variant = GraphBadgeVariant.Outline,
            )
        }
        Text(
            text = "Fork is only available while the thread is idle.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        ForkActionRow(label = "Fork from latest", state = "Run")
        ForkActionRow(label = "Fork from selected turn", state = "Pick")
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            forkTurnPreviewItems.forEach { item ->
                ForkTurnRow(item = item)
            }
        }
    }
}

@Composable
private fun ForkActionRow(
    label: String,
    state: String,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = label,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = state,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

@Composable
private fun ForkTurnRow(item: ForkTurnPreviewItem) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "Turn ${item.index}",
            modifier = Modifier.weight(1f),
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        GraphBadge(
            label = item.status,
            variant = GraphBadgeVariant.Outline,
        )
    }
}

@Composable
private fun SkillsPreviewGroup() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "/skills",
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            GraphBadge(
                label = "Open",
                variant = GraphBadgeVariant.Outline,
            )
        }
        Text(
            text = "Inspect skills and copy invocation names.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        skillsPreviewItems.forEach { item ->
            SkillPreviewRow(item = item)
        }
        SkillWarningRow(
            message = "Skill metadata incomplete",
            path = "~/.codex/skills/local-experiment/SKILL.md",
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SkillPreviewRow(item: SkillPreviewItem) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Text(
            text = item.displayName,
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            GraphBadge(
                label = item.scope,
                variant = GraphBadgeVariant.Outline,
            )
            GraphBadge(
                label = if (item.copied) "Copied ${item.invokeName}" else item.invokeName,
                variant = if (item.copied) GraphBadgeVariant.Default else GraphBadgeVariant.Outline,
            )
        }
        Text(
            text = item.description,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun SkillWarningRow(
    message: String,
    path: String,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.WarningSoft.copy(alpha = 0.52f))
            .border(1.dp, ThreadColors.Warning.copy(alpha = 0.34f), RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = message,
            color = ThreadColors.Warning,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = path,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun McpPreviewGroup() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = "/mcp",
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "~/.codex/config.toml",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            GraphBadge(
                label = "Add MCP",
                variant = GraphBadgeVariant.Outline,
            )
        }
        McpAddOptionRow(
            title = "HTTP / Streamable HTTP",
            mode = "Form",
            description = "Add an MCP server with a name and URL.",
        )
        McpAddOptionRow(
            title = "stdio / raw block",
            mode = "TOML",
            description = "Write a single provider config block.",
        )
        mcpServerPreviewItems.forEach { item ->
            McpServerRow(item = item)
        }
    }
}

@Composable
private fun McpAddOptionRow(
    title: String,
    mode: String,
    description: String,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = mode,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
        }
        Text(
            text = description,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun McpServerRow(item: McpServerPreviewItem) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = item.name,
                    color = ThreadColors.CodeForeground,
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "${item.toolCount} tools | ${item.resourceCount} resources | ${item.templateCount} templates",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            GraphBadge(
                label = item.authStatus,
                variant = GraphBadgeVariant.Outline,
            )
        }
        Text(
            text = item.toolPreview,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HooksPreviewGroup() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = "/hooks",
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = ".codex/hooks.json",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            GraphBadge(
                label = "Add Hook",
                variant = GraphBadgeVariant.Outline,
            )
        }
        HookFormPreview()
        HookStatusRow(
            message = "Project hook changed since last trust.",
            tone = HookStatusTone.Warning,
        )
        hooksPreviewItems.forEach { item ->
            HookPreviewRow(item = item)
        }
    }
}

@Composable
private fun HookFormPreview() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HookFieldPreview(label = "Scope", value = "Project", modifier = Modifier.weight(1f))
            HookFieldPreview(label = "Event", value = "PreToolUse", modifier = Modifier.weight(1f))
        }
        HookFieldPreview(label = "Matcher", value = "Bash")
        HookFieldPreview(label = "Command", value = "scripts/check-command.sh", mono = true)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HookFieldPreview(label = "Timeout", value = "30s", modifier = Modifier.weight(1f))
            HookFieldPreview(label = "Status", value = "Checking shell command", modifier = Modifier.weight(1f))
        }
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            GraphBadge(label = "Back", variant = GraphBadgeVariant.Outline)
            GraphBadge(label = "Write Hook", variant = GraphBadgeVariant.Default)
        }
    }
}

@Composable
private fun HookFieldPreview(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    mono: Boolean = false,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(9.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(9.dp))
            .padding(horizontal = 9.dp, vertical = 7.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            text = label,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = value,
            color = ThreadColors.CodeForeground,
            style = if (mono) MaterialTheme.typography.labelSmall else MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun HookPreviewRow(item: HookPreviewItem) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.CodeBackground)
            .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Text(
            text = if (item.matcher.isBlank()) item.event else "${item.event} | ${item.matcher}",
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = item.command,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (item.statusMessage.isNotBlank()) {
            Text(
                text = item.statusMessage,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            GraphBadge(label = "Edit", variant = GraphBadgeVariant.Outline)
            GraphBadge(label = item.trust, variant = GraphBadgeVariant.Outline)
            GraphBadge(label = item.source, variant = GraphBadgeVariant.Outline)
            GraphBadge(label = if (item.enabled) "Enabled" else "Disabled", variant = GraphBadgeVariant.Outline)
            GraphBadge(label = "${item.timeoutSec}s", variant = GraphBadgeVariant.Outline)
        }
    }
}

@Composable
private fun HookStatusRow(
    message: String,
    tone: HookStatusTone,
) {
    val foreground = when (tone) {
        HookStatusTone.Warning -> ThreadColors.Warning
        HookStatusTone.Error -> ThreadColors.Danger
        HookStatusTone.Success -> ThreadColors.Success
    }
    val background = when (tone) {
        HookStatusTone.Warning -> ThreadColors.WarningSoft.copy(alpha = 0.52f)
        HookStatusTone.Error -> ThreadColors.DangerSoft.copy(alpha = 0.56f)
        HookStatusTone.Success -> ThreadColors.SuccessSoft.copy(alpha = 0.54f)
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(background)
            .border(1.dp, foreground.copy(alpha = 0.34f), RoundedCornerShape(10.dp))
            .padding(10.dp),
    ) {
        Text(
            text = message,
            color = foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun AttachmentPanel() {
    ComposerMenuSurface(title = "Add attachment", subtitle = "Prompt context") {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AttachmentButton(
                label = "Photo",
                detail = "camera or gallery",
                icon = AttachmentTileIcon.Photo,
                modifier = Modifier.weight(1f),
            )
            AttachmentButton(
                label = "File",
                detail = "workspace upload",
                icon = AttachmentTileIcon.File,
                modifier = Modifier.weight(1f),
            )
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
            shellToolPreviewItems.forEach { item ->
                ShellToolPill(label = item.label, tone = item.tone)
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
            GraphBadge(
                label = status,
                variant = GraphBadgeVariant.Outline,
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
private fun AttachmentButton(
    label: String,
    detail: String,
    icon: AttachmentTileIcon,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Box(
            modifier = Modifier
                .size(30.dp)
                .clip(RoundedCornerShape(9.dp))
                .background(ThreadColors.SurfaceStrong)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(9.dp)),
            contentAlignment = Alignment.Center,
        ) {
            AttachmentTileGlyph(icon = icon, color = ThreadColors.Info)
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = label,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = detail,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun AttachmentTileGlyph(icon: AttachmentTileIcon, color: Color) {
    Canvas(modifier = Modifier.size(15.dp)) {
        val strokeWidth = 1.35.dp.toPx()
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

        when (icon) {
            AttachmentTileIcon.Photo -> {
                line(0.18f, 0.26f, 0.82f, 0.26f)
                line(0.82f, 0.26f, 0.82f, 0.78f)
                line(0.82f, 0.78f, 0.18f, 0.78f)
                line(0.18f, 0.78f, 0.18f, 0.26f)
                drawCircle(
                    color = color,
                    radius = w * 0.07f,
                    center = Offset(w * 0.66f, h * 0.40f),
                )
                line(0.25f, 0.70f, 0.42f, 0.52f)
                line(0.42f, 0.52f, 0.55f, 0.66f)
                line(0.55f, 0.66f, 0.66f, 0.56f)
                line(0.66f, 0.56f, 0.76f, 0.70f)
            }
            AttachmentTileIcon.File -> {
                line(0.28f, 0.18f, 0.62f, 0.18f)
                line(0.62f, 0.18f, 0.76f, 0.34f)
                line(0.76f, 0.34f, 0.76f, 0.82f)
                line(0.76f, 0.82f, 0.28f, 0.82f)
                line(0.28f, 0.82f, 0.28f, 0.18f)
                line(0.62f, 0.18f, 0.62f, 0.34f)
                line(0.62f, 0.34f, 0.76f, 0.34f)
                line(0.38f, 0.50f, 0.66f, 0.50f)
                line(0.38f, 0.64f, 0.62f, 0.64f)
            }
        }
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
        GraphSelectionGlyph(
            selected = selected,
            tone = GraphSelectionTone.Warning,
            contentDescription = if (selected) "$label selected" else "$label available",
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
private fun ShellToolPill(label: String, tone: ShellToolTone) {
    val foreground = when (tone) {
        ShellToolTone.Neutral -> ThreadColors.ForegroundSoft
        ShellToolTone.Info -> ThreadColors.Info
        ShellToolTone.Danger -> ThreadColors.Danger
    }
    val background = when (tone) {
        ShellToolTone.Neutral -> ThreadColors.Surface
        ShellToolTone.Info -> ThreadColors.InfoSoft.copy(alpha = 0.50f)
        ShellToolTone.Danger -> ThreadColors.DangerSoft.copy(alpha = 0.52f)
    }
    val border = when (tone) {
        ShellToolTone.Neutral -> ThreadColors.Border
        ShellToolTone.Info -> ThreadColors.Info.copy(alpha = 0.36f)
        ShellToolTone.Danger -> ThreadColors.Danger.copy(alpha = 0.40f)
    }
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(999.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        color = foreground,
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

private data class ShellToolPreviewItem(
    val label: String,
    val tone: ShellToolTone = ShellToolTone.Neutral,
)

private data class ForkTurnPreviewItem(
    val index: Int,
    val status: String,
)

private data class SkillPreviewItem(
    val displayName: String,
    val scope: String,
    val invokeName: String,
    val description: String,
    val copied: Boolean = false,
)

private data class McpServerPreviewItem(
    val name: String,
    val toolCount: Int,
    val resourceCount: Int,
    val templateCount: Int,
    val authStatus: String,
    val toolPreview: String,
)

private data class HookPreviewItem(
    val event: String,
    val matcher: String,
    val command: String,
    val statusMessage: String,
    val trust: String,
    val source: String,
    val enabled: Boolean,
    val timeoutSec: Int,
)

private enum class ShellToolTone {
    Neutral,
    Info,
    Danger,
}

private enum class HookStatusTone {
    Warning,
    Error,
    Success,
}

private enum class AttachmentTileIcon {
    Photo,
    File,
}

private val shellToolPreviewItems = listOf(
    ShellToolPreviewItem(label = "PASTE"),
    ShellToolPreviewItem(label = "COPY"),
    ShellToolPreviewItem(label = "CLEAR", tone = ShellToolTone.Info),
    ShellToolPreviewItem(label = "CTRL-C", tone = ShellToolTone.Danger),
    ShellToolPreviewItem(label = "CTRL-D"),
    ShellToolPreviewItem(label = "ESC"),
    ShellToolPreviewItem(label = "TAB"),
    ShellToolPreviewItem(label = "UP"),
    ShellToolPreviewItem(label = "DOWN"),
)

private val forkTurnPreviewItems = listOf(
    ForkTurnPreviewItem(index = 12, status = "completed"),
    ForkTurnPreviewItem(index = 11, status = "interrupted"),
    ForkTurnPreviewItem(index = 10, status = "failed"),
)

private val skillsPreviewItems = listOf(
    SkillPreviewItem(
        displayName = "Android Client Work",
        scope = "project",
        invokeName = "\$android-client",
        description = "Builds and verifies native Android surfaces against the supervisor UI.",
        copied = true,
    ),
    SkillPreviewItem(
        displayName = "OpenAI Docs",
        scope = "global",
        invokeName = "\$openai-docs",
        description = "Looks up current OpenAI API guidance and returns source-backed answers.",
    ),
)

private val mcpServerPreviewItems = listOf(
    McpServerPreviewItem(
        name = "openaiDeveloperDocs",
        toolCount = 4,
        resourceCount = 0,
        templateCount = 0,
        authStatus = "ready",
        toolPreview = "Search docs | Fetch doc | OpenAPI spec | Endpoint list",
    ),
    McpServerPreviewItem(
        name = "local-workspace",
        toolCount = 7,
        resourceCount = 3,
        templateCount = 2,
        authStatus = "local",
        toolPreview = "Read file | List resources | Inspect schema | Run task",
    ),
)

private val hooksPreviewItems = listOf(
    HookPreviewItem(
        event = "PreToolUse",
        matcher = "Bash",
        command = "scripts/check-command.sh",
        statusMessage = "Checking shell command",
        trust = "modified",
        source = "project",
        enabled = true,
        timeoutSec = 30,
    ),
    HookPreviewItem(
        event = "UserPromptSubmit",
        matcher = "",
        command = "scripts/log-prompt.sh",
        statusMessage = "Prompt audit",
        trust = "trusted",
        source = "global",
        enabled = true,
        timeoutSec = 10,
    ),
)

private enum class ComposerToolIcon {
    Slash,
    Plus,
    Terminal,
    Chat,
    Send,
}
