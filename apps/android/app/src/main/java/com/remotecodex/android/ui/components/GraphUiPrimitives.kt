package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.theme.ThreadColors

enum class GraphButtonVariant {
    Default,
    Destructive,
    Outline,
    Secondary,
    Ghost,
}

enum class GraphButtonSize(
    val minHeight: Dp,
    val horizontalPadding: Dp,
    val verticalPadding: Dp,
) {
    Default(minHeight = 36.dp, horizontalPadding = 12.dp, verticalPadding = 7.dp),
    Small(minHeight = 32.dp, horizontalPadding = 10.dp, verticalPadding = 6.dp),
    Large(minHeight = 40.dp, horizontalPadding = 16.dp, verticalPadding = 8.dp),
    Icon(minHeight = 36.dp, horizontalPadding = 9.dp, verticalPadding = 7.dp),
}

enum class GraphBadgeVariant {
    Default,
    Secondary,
    Destructive,
    Outline,
}

enum class GraphButtonGroupOrientation {
    Horizontal,
    Vertical,
}

enum class GraphSeparatorOrientation {
    Horizontal,
    Vertical,
}

enum class GraphDialogActionTone {
    Default,
    Success,
    Warning,
    Danger,
}

@Composable
fun GraphButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    variant: GraphButtonVariant = GraphButtonVariant.Outline,
    size: GraphButtonSize = GraphButtonSize.Small,
    contentDescription: String? = null,
    onClick: () -> Unit = {},
) {
    val colors = graphButtonColors(variant = variant)
    val shape = RoundedCornerShape(8.dp)
    Text(
        text = label,
        modifier = modifier
            .defaultMinSize(minHeight = size.minHeight)
            .clip(shape)
            .background(colors.background)
            .border(1.dp, colors.border, shape)
            .then(if (contentDescription != null) Modifier.semantics { this.contentDescription = contentDescription } else Modifier)
            .then(if (enabled) Modifier.clickable(onClick = onClick) else Modifier)
            .alpha(if (enabled) 1f else 0.52f)
            .padding(horizontal = size.horizontalPadding, vertical = size.verticalPadding),
        color = colors.foreground,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
fun GraphBadge(
    label: String,
    modifier: Modifier = Modifier,
    variant: GraphBadgeVariant = GraphBadgeVariant.Secondary,
) {
    val colors = graphBadgeColors(variant = variant)
    Text(
        text = label,
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(colors.background)
            .border(1.dp, colors.border, RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
        color = colors.foreground,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Medium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun GraphButtonGroup(
    modifier: Modifier = Modifier,
    orientation: GraphButtonGroupOrientation = GraphButtonGroupOrientation.Horizontal,
    content: @Composable () -> Unit,
) {
    val groupModifier = modifier
        .clip(RoundedCornerShape(10.dp))
        .background(ThreadColors.Panel)
        .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
        .padding(7.dp)

    if (orientation == GraphButtonGroupOrientation.Vertical) {
        Column(
            modifier = groupModifier,
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            content()
        }
    } else {
        FlowRow(
            modifier = groupModifier,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            content()
        }
    }
}

@Composable
fun GraphButtonGroupText(
    label: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(8.dp))
            .padding(horizontal = 10.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = label,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
fun GraphButtonGroupSeparator(
    modifier: Modifier = Modifier,
    orientation: GraphSeparatorOrientation = GraphSeparatorOrientation.Vertical,
) {
    GraphSeparator(
        modifier = modifier,
        orientation = orientation,
    )
}

@Composable
fun GraphSeparator(
    modifier: Modifier = Modifier,
    orientation: GraphSeparatorOrientation = GraphSeparatorOrientation.Horizontal,
) {
    val sizeModifier = if (orientation == GraphSeparatorOrientation.Horizontal) {
        Modifier
            .fillMaxWidth()
            .height(1.dp)
    } else {
        Modifier
            .width(1.dp)
            .height(28.dp)
    }
    Box(
        modifier = modifier
            .then(sizeModifier)
            .background(ThreadColors.Border),
    )
}

@Composable
fun GraphTooltipAnchor(
    description: String,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(modifier = modifier.semantics { contentDescription = description }) {
        content()
    }
}

@Composable
fun GraphDialogOverlay(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ThreadColors.Primary.copy(alpha = 0.72f))
            .padding(14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .matchParentSize()
                .clickable(onClick = onDismiss),
        )
        content()
    }
}

@Composable
fun GraphDialogFrame(
    title: String,
    subtitle: String,
    onClose: () -> Unit,
    footer: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    wide: Boolean = false,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .widthIn(max = if (wide) 680.dp else 440.dp)
            .heightIn(max = 720.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(24.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ThreadColors.Surface.copy(alpha = 0.58f))
                .padding(14.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = subtitle,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            GraphButton(
                label = "Close",
                variant = GraphButtonVariant.Ghost,
                size = GraphButtonSize.Default,
                onClick = onClose,
            )
        }
        Column(
            modifier = Modifier
                .weight(1f, fill = false)
                .verticalScroll(rememberScrollState())
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            content()
        }
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .background(ThreadColors.Surface.copy(alpha = 0.36f))
                .border(1.dp, ThreadColors.Border)
                .padding(14.dp),
        ) {
            footer()
        }
    }
}

@Composable
fun GraphDialogFooter(
    primaryLabel: String,
    primaryTone: GraphDialogActionTone,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    onPrimary: () -> Unit = onCancel,
    compact: Boolean = false,
) {
    Row(
        modifier = modifier,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        GraphButton(
            label = "Cancel",
            variant = GraphButtonVariant.Ghost,
            size = if (compact) GraphButtonSize.Small else GraphButtonSize.Default,
            onClick = onCancel,
        )
        Text(
            text = primaryLabel,
            modifier = Modifier
                .clip(RoundedCornerShape(999.dp))
                .background(primaryTone.background())
                .border(1.dp, primaryTone.foreground().copy(alpha = 0.45f), RoundedCornerShape(999.dp))
                .clickable(onClick = onPrimary)
                .padding(horizontal = if (compact) 11.dp else 14.dp, vertical = 8.dp),
            color = primaryTone.foreground(),
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun graphButtonColors(variant: GraphButtonVariant): GraphPrimitiveColors =
    when (variant) {
        GraphButtonVariant.Default -> GraphPrimitiveColors(
            background = ThreadColors.Primary,
            border = ThreadColors.Primary,
            foreground = ThreadColors.PrimaryForeground,
        )
        GraphButtonVariant.Destructive -> GraphPrimitiveColors(
            background = ThreadColors.DangerSoft,
            border = ThreadColors.Danger.copy(alpha = 0.42f),
            foreground = ThreadColors.Danger,
        )
        GraphButtonVariant.Outline -> GraphPrimitiveColors(
            background = ThreadColors.SurfaceStrong,
            border = ThreadColors.Border,
            foreground = ThreadColors.ForegroundSoft,
        )
        GraphButtonVariant.Secondary -> GraphPrimitiveColors(
            background = ThreadColors.Surface,
            border = ThreadColors.Border,
            foreground = ThreadColors.Foreground,
        )
        GraphButtonVariant.Ghost -> GraphPrimitiveColors(
            background = Color.Transparent,
            border = Color.Transparent,
            foreground = ThreadColors.ForegroundMuted,
        )
    }

@Composable
private fun graphBadgeColors(variant: GraphBadgeVariant): GraphPrimitiveColors =
    when (variant) {
        GraphBadgeVariant.Default -> GraphPrimitiveColors(
            background = ThreadColors.Primary,
            border = ThreadColors.Primary,
            foreground = ThreadColors.PrimaryForeground,
        )
        GraphBadgeVariant.Secondary -> GraphPrimitiveColors(
            background = ThreadColors.Surface,
            border = ThreadColors.Border,
            foreground = ThreadColors.ForegroundSoft,
        )
        GraphBadgeVariant.Destructive -> GraphPrimitiveColors(
            background = ThreadColors.DangerSoft,
            border = ThreadColors.Danger.copy(alpha = 0.42f),
            foreground = ThreadColors.Danger,
        )
        GraphBadgeVariant.Outline -> GraphPrimitiveColors(
            background = Color.Transparent,
            border = ThreadColors.Border,
            foreground = ThreadColors.ForegroundMuted,
        )
    }

private data class GraphPrimitiveColors(
    val background: Color,
    val border: Color,
    val foreground: Color,
)

@Composable
private fun GraphDialogActionTone.foreground() = when (this) {
    GraphDialogActionTone.Default -> ThreadColors.Primary
    GraphDialogActionTone.Success -> ThreadColors.Success
    GraphDialogActionTone.Warning -> ThreadColors.Warning
    GraphDialogActionTone.Danger -> ThreadColors.Danger
}

@Composable
private fun GraphDialogActionTone.background() = when (this) {
    GraphDialogActionTone.Default -> ThreadColors.SurfaceStrong
    GraphDialogActionTone.Success -> ThreadColors.SuccessSoft
    GraphDialogActionTone.Warning -> ThreadColors.WarningSoft
    GraphDialogActionTone.Danger -> ThreadColors.DangerSoft
}
