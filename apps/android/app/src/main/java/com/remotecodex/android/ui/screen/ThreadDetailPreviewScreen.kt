package com.remotecodex.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.UpdateThreadSettingsRequest
import com.remotecodex.android.ui.model.DetailPreview
import com.remotecodex.android.ui.model.PendingRequestPreview
import com.remotecodex.android.ui.model.ThreadRoomPreview
import com.remotecodex.android.ui.model.ThreadDetailPreview
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
import com.remotecodex.android.ui.components.ShellPanel
import com.remotecodex.android.ui.components.ThreadActionDialog
import com.remotecodex.android.ui.components.ThreadActionDialogOverlay
import com.remotecodex.android.ui.components.ThreadComposer
import com.remotecodex.android.ui.components.ThreadRoomsCollapsedRail
import com.remotecodex.android.ui.components.ThreadRoomsPanel
import com.remotecodex.android.ui.components.ThreadTimeline
import com.remotecodex.android.ui.components.ThreadSurfaceView
import com.remotecodex.android.ui.components.ThreadTopBar
import com.remotecodex.android.ui.components.WorkspacePanel
import com.remotecodex.android.ui.presentation.buildGraphChatThreadUsageFooterState
import com.remotecodex.android.ui.sample.ThreadPreviewSample
import com.remotecodex.android.ui.theme.ThreadColors

@Composable
fun ThreadDetailPreviewScreen(
    themeMode: ThemeMode,
    darkThemeActive: Boolean,
    supervisorConnection: SupervisorConnectionConfig,
    homeSnapshot: SupervisorHomeSnapshot?,
    homeSnapshotLoading: Boolean,
    homeSnapshotError: String?,
    onThemeModeSelected: (ThemeMode) -> Unit,
    onChangeConnection: () -> Unit,
) {
    val appShell = ThreadPreviewSample.appShell
    val detail = ThreadPreviewSample.detail
    ThreadDetailSurface(
        appShell = appShell,
        initialDetail = detail,
        themeMode = themeMode,
        darkThemeActive = darkThemeActive,
        supervisorConnection = supervisorConnection,
        homeSnapshot = homeSnapshot,
        homeSnapshotLoading = homeSnapshotLoading,
        homeSnapshotError = homeSnapshotError,
        onThemeModeSelected = onThemeModeSelected,
        onChangeConnection = onChangeConnection,
    )
}

@Composable
fun ThreadDetailSurface(
    appShell: com.remotecodex.android.ui.model.AppShellPreview,
    initialDetail: ThreadDetailPreview,
    themeMode: ThemeMode,
    darkThemeActive: Boolean,
    supervisorConnection: SupervisorConnectionConfig,
    homeSnapshot: SupervisorHomeSnapshot?,
    homeSnapshotLoading: Boolean,
    homeSnapshotError: String?,
    onThemeModeSelected: (ThemeMode) -> Unit,
    onChangeConnection: () -> Unit,
    onSubmitPrompt: ((String) -> Unit)? = null,
    onInterruptThread: (() -> Unit)? = null,
    onUpdateThreadSettings: ((UpdateThreadSettingsRequest) -> Unit)? = null,
    onDenyPendingRequest: (PendingRequestPreview) -> Unit = {},
    onSubmitPendingRequest: (PendingRequestPreview, Map<String, List<String>>) -> Unit = { _, _ -> },
    onRenameThread: ((String) -> Unit)? = null,
    onDeleteThread: (() -> Unit)? = null,
    submittingPrompt: Boolean = false,
    threadActionBusy: Boolean = false,
    threadActionError: String? = null,
) {
    val detail = initialDetail
    var activeRoomId by remember {
        mutableStateOf(detail.rooms.firstOrNull { it.active }?.id ?: detail.rooms.firstOrNull()?.id)
    }
    val rooms = detail.rooms.map { room -> room.copy(active = room.id == activeRoomId) }
    val activeRoom = rooms.firstOrNull { it.active }
    val displayedDetail = detail.copy(
        title = activeRoom?.title ?: detail.title,
        workspace = activeRoom?.workspaceLabel ?: detail.workspace,
        rooms = rooms,
    )
    var selectedView by remember { mutableStateOf(ThreadSurfaceView.Chat) }
    var appNavOpen by remember { mutableStateOf(false) }
    var settingsOpen by remember { mutableStateOf(false) }
    var roomsOpen by remember { mutableStateOf(false) }
    var threadActionDialog by remember { mutableStateOf<ThreadActionDialog?>(null) }
    var threadActionRoom by remember { mutableStateOf<ThreadRoomPreview?>(null) }
    var copiedSessionRoomId by remember { mutableStateOf<String?>(null) }
    var openDetail by remember { mutableStateOf<DetailPreview?>(null) }
    GraphChatShellRoot {
        BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
            val showCollapsedRoomsRail = maxWidth >= 720.dp
            val contentStartPadding = if (showCollapsedRoomsRail) 72.dp else 0.dp
            if (showCollapsedRoomsRail) {
                ThreadRoomsCollapsedRail(
                    workspaceLabel = displayedDetail.workspacePreview.rootLabel,
                    rooms = displayedDetail.rooms,
                    activeRoomId = activeRoomId,
                    onCreateThread = {
                        threadActionRoom = null
                        threadActionDialog = ThreadActionDialog.Create
                    },
                    onOpenThread = { room ->
                        activeRoomId = room.id
                        roomsOpen = false
                    },
                    onExpandRooms = { roomsOpen = true },
                    modifier = Modifier.align(Alignment.CenterStart),
                )
            }
            GraphChatShellFrame(modifier = Modifier.padding(start = contentStartPadding)) {
                GraphChatMainShell {
                    GraphChatTopbarShell {
                        ThreadTopBar(
                            detail = displayedDetail,
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
                                detail = displayedDetail,
                                onOpenDetail = { openDetail = it },
                                onDenyPendingRequest = onDenyPendingRequest,
                                onSubmitPendingRequest = onSubmitPendingRequest,
                                modifier = Modifier.fillMaxSize(),
                            )
                            ThreadSurfaceView.Workspace -> WorkspacePanel(
                                workspace = displayedDetail.workspacePreview,
                                modifier = Modifier.fillMaxSize(),
                            )
                            ThreadSurfaceView.Shell -> ShellPanel(
                                shell = displayedDetail.shellPreview,
                                modifier = Modifier.fillMaxSize(),
                            )
                        }
                    }
                }
            }
            if (selectedView == ThreadSurfaceView.Chat) {
                ThreadComposer(
                    composer = displayedDetail.composer.copy(
                        busy = displayedDetail.composer.busy || submittingPrompt,
                    ),
                    onSubmitPrompt = onSubmitPrompt,
                    onInterruptThread = onInterruptThread,
                    onUpdateSettings = onUpdateThreadSettings,
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(start = contentStartPadding)
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
                    .fillMaxWidth(if (showCollapsedRoomsRail) 0.40f else 0.86f),
            ) {
                ThreadRoomsPanel(
                    workspaceLabel = displayedDetail.workspacePreview.rootLabel,
                    rooms = displayedDetail.rooms,
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
                    supervisorConnection = supervisorConnection,
                    homeSnapshot = homeSnapshot,
                    homeSnapshotLoading = homeSnapshotLoading,
                    homeSnapshotError = homeSnapshotError,
                    onThemeModeSelected = onThemeModeSelected,
                    onChangeConnection = onChangeConnection,
                    onClose = { settingsOpen = false },
                    modifier = Modifier
                        .fillMaxSize()
                        .navigationBarsPadding(),
                )
            }
            threadActionDialog?.let { dialog ->
                ThreadActionDialogOverlay(
                    dialog = dialog,
                    threadTitle = threadActionRoom?.title ?: displayedDetail.title,
                    exportTurns = ThreadPreviewSample.exportTurns,
                    onClose = {
                        threadActionDialog = null
                        threadActionRoom = null
                    },
                    busy = threadActionBusy,
                    error = threadActionError,
                    onRenameThread = onRenameThread,
                    onDeleteThread = onDeleteThread,
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
}

@Composable
private fun ChatPreviewSurface(
    detail: ThreadDetailPreview,
    onOpenDetail: (DetailPreview) -> Unit,
    onDenyPendingRequest: (PendingRequestPreview) -> Unit,
    onSubmitPendingRequest: (PendingRequestPreview, Map<String, List<String>>) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.background(ThreadColors.Workspace),
    ) {
        ThreadTimeline(
            turns = detail.turns,
            auxiliary = detail.timelineAuxiliary,
            pendingRequests = detail.pendingRequests,
            onOpenDetail = onOpenDetail,
            onDenyPendingRequest = onDenyPendingRequest,
            onSubmitPendingRequest = onSubmitPendingRequest,
            modifier = Modifier.weight(1f),
        )
        ThreadUsageFooter(detail = detail)
    }
}

@Composable
private fun ThreadUsageFooter(detail: ThreadDetailPreview) {
    val state = buildGraphChatThreadUsageFooterState(detail)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(ThreadColors.Panel)
            .semantics { contentDescription = state.accessibilityLabel }
            .padding(horizontal = 14.dp, vertical = 5.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = state.transcriptLabel,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = state.usageLabel,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
