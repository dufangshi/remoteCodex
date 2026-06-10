package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.theme.ThreadColors

enum class GraphPanelGroupOrientation {
    Vertical,
}

@Composable
fun GraphResizablePanelGroup(
    modifier: Modifier = Modifier,
    orientation: GraphPanelGroupOrientation = GraphPanelGroupOrientation.Vertical,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier,
        verticalArrangement = if (orientation == GraphPanelGroupOrientation.Vertical) {
            Arrangement.spacedBy(8.dp)
        } else {
            Arrangement.spacedBy(8.dp)
        },
    ) {
        content()
    }
}

@Composable
fun ColumnScope.GraphResizablePanel(
    modifier: Modifier = Modifier,
    weight: Float? = null,
    content: @Composable () -> Unit,
) {
    val panelModifier = if (weight == null) {
        modifier
    } else {
        modifier.weight(weight)
    }
    Box(modifier = panelModifier) {
        content()
    }
}

@Composable
fun GraphResizableHandle(
    modifier: Modifier = Modifier,
    withHandle: Boolean = true,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .weight(1f)
                .height(1.dp)
                .background(ThreadColors.Border),
        )
        if (withHandle) {
            Box(
                modifier = Modifier
                    .padding(horizontal = 8.dp)
                    .size(width = 28.dp, height = 12.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(ThreadColors.SurfaceStrong)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(4.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                    repeat(3) {
                        Box(
                            modifier = Modifier
                                .size(3.dp)
                                .clip(RoundedCornerShape(999.dp))
                                .background(ThreadColors.ForegroundMuted),
                        )
                    }
                }
            }
        }
        Box(
            modifier = Modifier
                .weight(1f)
                .height(1.dp)
                .background(ThreadColors.Border),
        )
    }
}
