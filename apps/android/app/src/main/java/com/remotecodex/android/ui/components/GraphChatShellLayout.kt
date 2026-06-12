package com.remotecodex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
fun GraphChatShellRoot(
    modifier: Modifier = Modifier,
    viewportConstrained: Boolean = true,
    content: @Composable BoxScope.() -> Unit,
) {
    val rootModifier = if (viewportConstrained) {
        modifier.fillMaxSize()
    } else {
        modifier.fillMaxWidth()
    }
    Box(
        modifier = rootModifier
            .background(ThreadColors.Background)
            .statusBarsPadding(),
    ) {
        content()
    }
}

@Composable
fun GraphChatShellFrame(
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    Box(modifier = modifier.fillMaxSize()) {
        content()
    }
}

@Composable
fun GraphChatMainShell(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(ThreadColors.Panel),
    ) {
        content()
    }
}

@Composable
fun GraphChatTopbarShell(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border),
    ) {
        content()
    }
}

@Composable
fun GraphChatSplitRegion(
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ThreadColors.Workspace),
    ) {
        content()
    }
}

@Composable
fun GraphChatMobileScrim(
    open: Boolean,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!open) {
        return
    }
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ThreadColors.Primary.copy(alpha = 0.30f))
            .clickable(onClick = onClose),
    )
}

@Composable
fun GraphChatRoomsRailShell(
    mobileOpen: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    if (!mobileOpen) {
        return
    }
    Box(
        modifier = modifier
            .fillMaxHeight()
            .widthIn(max = 360.dp)
            .clip(RoundedCornerShape(topEnd = 14.dp, bottomEnd = 14.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(topEnd = 14.dp, bottomEnd = 14.dp))
            .statusBarsPadding()
            .navigationBarsPadding(),
        contentAlignment = Alignment.CenterStart,
    ) {
        content()
    }
}
