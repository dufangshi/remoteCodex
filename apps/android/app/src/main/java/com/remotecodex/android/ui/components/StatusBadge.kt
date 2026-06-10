package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
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
) {
    val colors = messageStatusBadgeColors(model.tone)
    PillBadge(
        label = model.label,
        colors = colors,
        modifier = modifier,
        leading = {
            if (model.tone == MessageStatusTone.Running) {
                RunningDots(color = colors.foreground)
            } else {
                Dot(color = colors.foreground)
            }
        },
    )
}

@Composable
fun ToolStatusBadge(
    label: String,
    status: ToolStatus,
    modifier: Modifier = Modifier,
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
        modifier = modifier,
        leading = {
            if (status == ToolStatus.Running) {
                RunningDots(color = colors.foreground)
            } else {
                Dot(color = colors.foreground)
            }
        },
    )
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
            Box(modifier = Modifier.size(8.dp))
            leading()
            Text(
                text = label,
                color = colors.foreground,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Medium,
            )
            Box(modifier = Modifier.size(8.dp))
        }
    }
}

private data class BadgeColors(
    val background: Color,
    val border: Color,
    val foreground: Color,
)
