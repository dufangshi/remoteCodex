package com.remotecodex.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.presentation.MessageStatusModel
import com.remotecodex.android.ui.presentation.MessageStatusTone
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
fun ThreadStatusBadge(
    label: String,
    status: ThreadStatus,
    modifier: Modifier = Modifier,
) {
    val colors = when (status) {
        ThreadStatus.Running -> BadgeColors(
            background = ThreadColors.WarningSoft,
            border = Color(0xFFFACC15),
            foreground = ThreadColors.Warning,
        )
        ThreadStatus.Complete -> BadgeColors(
            background = ThreadColors.SuccessSoft,
            border = Color(0xFF86EFAC),
            foreground = ThreadColors.Success,
        )
        ThreadStatus.Failed -> BadgeColors(
            background = ThreadColors.DangerSoft,
            border = Color(0xFFFDA4AF),
            foreground = ThreadColors.Danger,
        )
        ThreadStatus.Waiting -> BadgeColors(
            background = ThreadColors.InfoSoft,
            border = Color(0xFF7DD3FC),
            foreground = ThreadColors.Info,
        )
    }
    PillBadge(
        label = label,
        colors = colors,
        modifier = modifier,
        leading = {
            if (status == ThreadStatus.Running) {
                RunningDots(color = colors.foreground)
            } else {
                Dot(color = colors.foreground)
            }
        },
    )
}

@Composable
fun MessageStatusBadge(
    model: MessageStatusModel,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    val colors = messageStatusBadgeColors(model.tone)
    PillBadge(
        label = model.label,
        colors = colors,
        modifier = (if (compact) modifier.defaultMinSize(minWidth = 24.dp) else modifier)
            .semantics {
                contentDescription = model.accessibilityLabel
            },
        edgeSize = if (compact) 6.dp else 8.dp,
        leading = {
            MessageStatusLeadingIcon(
                tone = model.tone,
                color = colors.foreground,
            )
        },
    )
}

@Composable
private fun MessageStatusLeadingIcon(
    tone: MessageStatusTone,
    color: Color,
) {
    if (tone == MessageStatusTone.Running) {
        RunningDots(color = color)
        return
    }

    CircleStatusIcon(
        color = color,
        glyph = when (tone) {
            MessageStatusTone.Success -> CircleStatusGlyph.Check
            MessageStatusTone.Danger -> CircleStatusGlyph.X
            MessageStatusTone.Neutral -> CircleStatusGlyph.Circle
            MessageStatusTone.Running -> CircleStatusGlyph.Circle
        },
    )
}

@Composable
fun ToolStatusBadge(
    label: String,
    status: ToolStatus,
    modifier: Modifier = Modifier,
    compact: Boolean = false,
) {
    val colors = when (status) {
        ToolStatus.Running -> BadgeColors(
            background = ThreadColors.WarningSoft,
            border = Color(0xFFFACC15),
            foreground = ThreadColors.Warning,
        )
        ToolStatus.Completed -> BadgeColors(
            background = ThreadColors.SuccessSoft,
            border = Color(0xFF86EFAC),
            foreground = ThreadColors.Success,
        )
        ToolStatus.Failed -> BadgeColors(
            background = ThreadColors.DangerSoft,
            border = Color(0xFFFDA4AF),
            foreground = ThreadColors.Danger,
        )
    }
    PillBadge(
        label = label,
        colors = colors,
        modifier = if (compact) modifier.defaultMinSize(minWidth = 24.dp) else modifier,
        showLabel = !compact,
        leading = {
            ToolStatusLeadingIcon(status = status, color = colors.foreground)
        },
    )
}

@Composable
private fun ToolStatusLeadingIcon(
    status: ToolStatus,
    color: Color,
) {
    when (status) {
        ToolStatus.Running -> RunningDots(color = color)
        ToolStatus.Completed -> CircleStatusIcon(color = color, glyph = CircleStatusGlyph.Check)
        ToolStatus.Failed -> CircleStatusIcon(color = color, glyph = CircleStatusGlyph.X)
    }
}

private enum class CircleStatusGlyph {
    Check,
    X,
    Circle,
}

@Composable
private fun CircleStatusIcon(
    color: Color,
    glyph: CircleStatusGlyph,
) {
    Canvas(modifier = Modifier.size(14.dp)) {
        val stroke = Stroke(width = 1.7.dp.toPx(), cap = StrokeCap.Round)
        val w = size.width
        val h = size.height
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
            drawLine(
                color = color,
                start = Offset(w * x1, h * y1),
                end = Offset(w * x2, h * y2),
                strokeWidth = stroke.width,
                cap = StrokeCap.Round,
            )
        }

        drawCircle(
            color = color,
            radius = w * 0.42f,
            center = Offset(w * 0.5f, h * 0.5f),
            style = stroke,
        )
        when (glyph) {
            CircleStatusGlyph.Check -> {
                line(0.30f, 0.52f, 0.44f, 0.66f)
                line(0.44f, 0.66f, 0.72f, 0.34f)
            }
            CircleStatusGlyph.X -> {
                line(0.34f, 0.34f, 0.66f, 0.66f)
                line(0.66f, 0.34f, 0.34f, 0.66f)
            }
            CircleStatusGlyph.Circle -> Unit
        }
    }
}

@Composable
private fun messageStatusBadgeColors(tone: MessageStatusTone): BadgeColors {
    return when (tone) {
        MessageStatusTone.Running -> BadgeColors(
            background = ThreadColors.WarningSoft,
            border = Color(0xFFFACC15),
            foreground = ThreadColors.Warning,
        )
        MessageStatusTone.Success -> BadgeColors(
            background = ThreadColors.SuccessSoft,
            border = Color(0xFF86EFAC),
            foreground = ThreadColors.Success,
        )
        MessageStatusTone.Danger -> BadgeColors(
            background = ThreadColors.DangerSoft,
            border = Color(0xFFFDA4AF),
            foreground = ThreadColors.Danger,
        )
        MessageStatusTone.Neutral -> BadgeColors(
            background = ThreadColors.SurfaceStrong,
            border = ThreadColors.BorderStrong,
            foreground = ThreadColors.ForegroundMuted,
        )
    }
}

@Composable
fun MetadataPill(
    label: String,
    modifier: Modifier = Modifier,
) {
    PillBadge(
        label = label,
        colors = BadgeColors(
            background = ThreadColors.InfoSoft,
            border = Color(0xFFBAE6FD),
            foreground = ThreadColors.ForegroundMuted,
        ),
        modifier = modifier,
        leading = { RunningDots(color = Color(0xFF7DD3FC), active = false) },
    )
}

@Composable
private fun PillBadge(
    label: String,
    colors: BadgeColors,
    modifier: Modifier = Modifier,
    showLabel: Boolean = true,
    edgeSize: Dp = if (showLabel) 8.dp else 4.dp,
    leading: @Composable () -> Unit,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(colors.background)
            .border(1.dp, colors.border, RoundedCornerShape(999.dp)),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier,
            horizontalArrangement = Arrangement.spacedBy(5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(modifier = Modifier.size(edgeSize))
            leading()
            if (showLabel) {
                Text(
                    text = label,
                    color = colors.foreground,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Medium,
                )
            }
            Box(modifier = Modifier.size(edgeSize))
        }
    }
}

private data class BadgeColors(
    val background: Color,
    val border: Color,
    val foreground: Color,
)
