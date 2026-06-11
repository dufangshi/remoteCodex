package com.remotecodex.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.model.DetailPreview
import com.remotecodex.android.ui.model.ThreadRoomPreview
import com.remotecodex.android.ui.components.AppShellNavigationPanel
import com.remotecodex.android.ui.components.AppShellSettingsPanel
import com.remotecodex.android.ui.components.GraphChatMainShell
import com.remotecodex.android.ui.components.GraphChatMobileScrim
import com.remotecodex.android.ui.components.GraphChatRoomsRailShell
import com.remotecodex.android.ui.components.GraphChatShellFrame
import com.remotecodex.android.ui.components.GraphChatShellRoot
import com.remotecodex.android.ui.components.GraphChatSplitRegion
import com.remotecodex.android.ui.components.GraphChatTopbarShell
import com.remotecodex.android.ui.components.LongTextDialog
import com.remotecodex.android.ui.components.PendingRequestCard
import com.remotecodex.android.ui.components.ShellPanel
import com.remotecodex.android.ui.components.ThreadActionDialog
import com.remotecodex.android.ui.components.ThreadActionDialogOverlay
import com.remotecodex.android.ui.components.ThreadComposer
import com.remotecodex.android.ui.components.ThreadRoomsPanel
import com.remotecodex.android.ui.components.ThreadTimeline
import com.remotecodex.android.ui.components.ThreadSurfaceView
import com.remotecodex.android.ui.components.ThreadTopBar
import com.remotecodex.android.ui.components.WorkspacePanel
import com.remotecodex.android.ui.sample.ThreadPreviewSample
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
fun ThreadDetailPreviewScreen(
    themeMode: ThemeMode,
    darkThemeActive: Boolean,
    onThemeModeSelected: (ThemeMode) -> Unit,
) {
    val appShell = ThreadPreviewSample.appShell
    val detail = ThreadPreviewSample.detail
    var selectedView by remember { mutableStateOf(ThreadSurfaceView.Chat) }
    var appNavOpen by remember { mutableStateOf(false) }
    var settingsOpen by remember { mutableStateOf(false) }
    var roomsOpen by remember { mutableStateOf(false) }
    var threadActionDialog by remember { mutableStateOf<ThreadActionDialog?>(null) }
    var threadActionRoom by remember { mutableStateOf<ThreadRoomPreview?>(null) }
    var copiedSessionRoomId by remember { mutableStateOf<String?>(null) }
    var openDetail by remember { mutableStateOf<DetailPreview?>(null) }
    GraphChatShellRoot {
        GraphChatShellFrame {
            GraphChatMainShell {
                GraphChatTopbarShell {
                    ThreadTopBar(
                        detail = detail,
                        selectedView = selectedView,
                        onViewSelected = { selectedView = it },
                        onOpenAppNav = { appNavOpen = true },
                        onOpenRooms = { roomsOpen = true },
                        onOpenSettings = { settingsOpen = true },
                        onOpenThreadAction = { threadActionDialog = it },
                        onReturnToWorkspace = { selectedView = ThreadSurfaceView.Workspace },
                        onCreateThreadShortcut = {
                            threadActionRoom = null
                            threadActionDialog = ThreadActionDialog.Create
                        },
                        themeMode = themeMode,
                        darkThemeActive = darkThemeActive,
                    )
                }
                GraphChatSplitRegion(modifier = Modifier.weight(1f)) {
                    when (selectedView) {
                        ThreadSurfaceView.Chat -> ChatPreviewSurface(
                            detail = detail,
                            onOpenDetail = { openDetail = it },
                            modifier = Modifier.fillMaxSize(),
                        )
                        ThreadSurfaceView.Workspace -> WorkspacePanel(
                            workspace = detail.workspacePreview,
                            modifier = Modifier.fillMaxSize(),
                        )
                        ThreadSurfaceView.Shell -> ShellPanel(
                            shell = detail.shellPreview,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
            }
        }
        if (selectedView == ThreadSurfaceView.Chat) {
            ThreadComposer(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding(),
            )
        }
        GraphChatMobileScrim(
            open = roomsOpen,
            onClose = { roomsOpen = false },
        )
        GraphChatRoomsRailShell(
            mobileOpen = roomsOpen,
            modifier = Modifier
                .align(Alignment.CenterStart)
                .fillMaxWidth(0.86f),
        ) {
            ThreadRoomsPanel(
                workspaceLabel = detail.workspacePreview.rootLabel,
                rooms = detail.rooms,
                onClose = { roomsOpen = false },
                onCreateThread = {
                    roomsOpen = false
                    threadActionRoom = null
                    threadActionDialog = ThreadActionDialog.Create
                },
                copiedSessionRoomId = copiedSessionRoomId,
                onRenameThread = { room ->
                    roomsOpen = false
                    threadActionRoom = room
                    threadActionDialog = ThreadActionDialog.Rename
                },
                onCopySessionId = { room ->
                    copiedSessionRoomId = room.id
                },
                onDeleteThread = { room ->
                    roomsOpen = false
                    threadActionRoom = room
                    threadActionDialog = ThreadActionDialog.Delete
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
        if (appNavOpen) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(ThreadColors.Primary.copy(alpha = 0.30f))
                    .clickable { appNavOpen = false },
            )
            AppShellNavigationPanel(
                appShell = appShell,
                onOpenSettings = {
                    appNavOpen = false
                    settingsOpen = true
                },
                onClose = { appNavOpen = false },
                modifier = Modifier
                    .align(Alignment.CenterStart)
                    .navigationBarsPadding()
                    .fillMaxWidth(0.86f),
            )
        }
        if (settingsOpen) {
            AppShellSettingsPanel(
                appShell = appShell,
                themeMode = themeMode,
                darkThemeActive = darkThemeActive,
                onThemeModeSelected = onThemeModeSelected,
                onClose = { settingsOpen = false },
                modifier = Modifier
                    .fillMaxSize()
                    .navigationBarsPadding(),
            )
        }
        threadActionDialog?.let { dialog ->
            ThreadActionDialogOverlay(
                dialog = dialog,
                threadTitle = threadActionRoom?.title ?: detail.title,
                exportTurns = ThreadPreviewSample.exportTurns,
                onClose = {
                    threadActionDialog = null
                    threadActionRoom = null
                },
                modifier = Modifier
                    .fillMaxSize()
                    .navigationBarsPadding(),
            )
        }
        openDetail?.let { detailPreview ->
            LongTextDialog(
                detail = detailPreview,
                onClose = { openDetail = null },
                modifier = Modifier
                    .fillMaxSize()
                    .navigationBarsPadding(),
            )
        }
    }
}

@Composable
private fun ChatPreviewSurface(
    detail: com.remotecodex.android.ui.model.ThreadDetailPreview,
    onOpenDetail: (DetailPreview) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.background(ThreadColors.Workspace),
    ) {
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .background(ThreadColors.Workspace),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(
                start = 8.dp,
                end = 8.dp,
                top = 8.dp,
                bottom = 8.dp,
            ),
        ) {
            item {
                PendingRequestCard(request = detail.pendingRequest)
            }
        }
        ThreadTimeline(
            turns = detail.turns,
            auxiliary = detail.timelineAuxiliary,
            onOpenDetail = onOpenDetail,
            modifier = Modifier.weight(4f),
        )
    }
}
