package com.remotecodex.android.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable
fun RunningDots(
    color: Color,
    modifier: Modifier = Modifier,
    dotSize: Dp = 5.dp,
    spacing: Dp = 3.dp,
    active: Boolean = true,
) {
    val transition = if (active) {
        rememberInfiniteTransition(label = "running dots")
    } else {
        null
    }

    Row(
        modifier = modifier.clearAndSetSemantics { },
        horizontalArrangement = Arrangement.spacedBy(spacing),
    ) {
        repeat(3) { index ->
            val alpha = if (transition == null) {
                0.55f
            } else {
                val animatedAlpha by transition.animateFloat(
                    initialValue = 0.35f,
                    targetValue = 0.95f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(
                            durationMillis = 540,
                            delayMillis = index * 150,
                        ),
                        repeatMode = RepeatMode.Reverse,
                    ),
                    label = "running dot $index",
                )
                animatedAlpha
            }
            Dot(color = color.copy(alpha = alpha), size = dotSize)
        }
    }
}

@Composable
fun Dot(
    color: Color,
    modifier: Modifier = Modifier,
    size: Dp = 5.dp,
) {
    Box(
        modifier = modifier
            .size(size)
            .clip(CircleShape)
            .background(color),
    )
}
