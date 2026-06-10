package com.remotecodex.android.ui.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
fun GraphAccordion(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp)),
    ) {
        content()
    }
}

@Composable
fun GraphAccordionItem(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    enabled: Boolean = true,
    defaultExpanded: Boolean = false,
    showDivider: Boolean = true,
    titleColor: Color = ThreadColors.Foreground,
    subtitleColor: Color = ThreadColors.ForegroundMuted,
    backgroundColor: Color = ThreadColors.Panel,
    contentBackgroundColor: Color? = null,
    leading: @Composable (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    var expanded by rememberSaveable(title) { mutableStateOf(defaultExpanded) }
    val triggerAlpha = if (enabled) 1f else 0.48f
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(backgroundColor),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .clickable(
                    enabled = enabled,
                    role = Role.Button,
                    onClick = { expanded = !expanded },
                )
                .semantics {
                    contentDescription = if (expanded) {
                        "Collapse $title"
                    } else {
                        "Expand $title"
                    }
                }
                .padding(horizontal = 12.dp, vertical = 13.dp),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            leading?.invoke()
            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = title,
                    color = titleColor.copy(alpha = triggerAlpha),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                subtitle?.let {
                    Text(
                        text = it,
                        color = subtitleColor.copy(alpha = triggerAlpha),
                        style = MaterialTheme.typography.labelSmall,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
            trailing?.invoke()
            GraphAccordionChevron(
                expanded = expanded,
                color = subtitleColor.copy(alpha = triggerAlpha),
            )
        }
        AnimatedVisibility(visible = expanded) {
            val contentModifier = if (contentBackgroundColor == null) {
                Modifier
                    .fillMaxWidth()
                    .padding(start = 12.dp, end = 12.dp, bottom = 12.dp)
            } else {
                Modifier
                    .fillMaxWidth()
                    .background(contentBackgroundColor)
                    .padding(12.dp)
            }
            Column(
                modifier = contentModifier,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                content()
            }
        }
        if (showDivider) {
            GraphSeparator()
        }
    }
}

@Composable
fun GraphAccordionIcon(
    label: String,
    modifier: Modifier = Modifier,
    color: Color = ThreadColors.ForegroundSoft,
) {
    Box(
        modifier = modifier
            .size(26.dp)
            .clip(RoundedCornerShape(7.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(7.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = color,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun GraphAccordionChevron(
    expanded: Boolean,
    color: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(
        modifier = modifier
            .padding(top = 3.dp)
            .size(16.dp),
    ) {
        val stroke = Stroke(width = 2.2f, cap = StrokeCap.Round)
        val left = Offset(size.width * 0.25f, size.height * if (expanded) 0.62f else 0.38f)
        val center = Offset(size.width * 0.50f, size.height * if (expanded) 0.38f else 0.62f)
        val right = Offset(size.width * 0.75f, size.height * if (expanded) 0.62f else 0.38f)
        drawLine(color = color, start = left, end = center, strokeWidth = stroke.width, cap = StrokeCap.Round)
        drawLine(color = color, start = center, end = right, strokeWidth = stroke.width, cap = StrokeCap.Round)
    }
}
