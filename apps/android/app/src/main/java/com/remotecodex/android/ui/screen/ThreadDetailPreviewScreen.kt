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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.AndroidFeatureFlags
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.ExportThreadRequest
import com.remotecodex.android.api.SendThreadPromptRequest
import com.remotecodex.android.api.UpdateThreadGoalRequest
import com.remotecodex.android.api.UpdateThreadSettingsRequest
import com.remotecodex.android.ui.model.DetailPreview
import com.remotecodex.android.ui.model.DetailRequest
import com.remotecodex.android.ui.model.InlineImagePreview
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
import com.remotecodex.android.ui.components.PendingPromptAttachmentUpload
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
import com.remotecodex.android.ui.sample.ThreadPreviewSample
import com.remotecodex.android.ui.theme.ThreadColors
import androidx.compose.foundation.lazy.rememberLazyListState
import kotlinx.coroutines.launch

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
    onSubmitPromptRequest: ((SendThreadPromptRequest) -> Unit)? = null,
    onPickPromptAttachment: ((com.remotecodex.android.ui.presentation.ComposerAttachmentActionKind) -> Unit)? = null,
    pendingPromptAttachment: PendingPromptAttachmentUpload? = null,
    onInterruptThread: (() -> Unit)? = null,
    onUpdateThreadSettings: ((UpdateThreadSettingsRequest) -> Unit)? = null,
    onUpdateThreadGoal: ((UpdateThreadGoalRequest) -> Unit)? = null,
    onCompactThread: (() -> Unit)? = null,
    onForkLatest: (() -> Unit)? = null,
    onForkTurn: ((String) -> Unit)? = null,
    onExportThread: ((ExportThreadRequest) -> Unit)? = null,
    onTrustHook: ((String, String) -> Unit)? = null,
    onUntrustHook: ((String) -> Unit)? = null,
    onOpenDetail: ((DetailRequest) -> Unit)? = null,
    onCreateShell: (() -> Unit)? = null,
    onTerminateShell: ((String) -> Unit)? = null,
    onSendShellInput: ((String) -> Unit)? = null,
    onSendShellControl: ((String) -> Unit)? = null,
    onClearShell: (() -> Unit)? = null,
    onSelectWorkspaceFile: ((String) -> Unit)? = null,
    onLoadMoreWorkspacePreview: (() -> Unit)? = null,
    onDownloadWorkspaceFile: ((String) -> Unit)? = null,
    onOpenWorkspaceRawFile: ((String) -> Unit)? = null,
    onCopyWorkspaceRawFile: ((String) -> Unit)? = null,
    onUploadWorkspaceNote: (() -> Unit)? = null,
    onDenyPendingRequest: (PendingRequestPreview) -> Unit = {},
    onSubmitPendingRequest: (PendingRequestPreview, Map<String, List<String>>) -> Unit = { _, _ -> },
    onLoadEarlier: (() -> Unit)? = null,
    imageResolver: (suspend (String) -> InlineImagePreview?)? = null,
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
    val timelineListState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    val timelineTailVisible by remember(timelineListState) {
        derivedStateOf { timelineListState.isTailVisible() }
    }
    val timelineContentKey = displayedDetail.timelineContentKey()
    LaunchedEffect(timelineContentKey) {
        if (timelineTailVisible) {
            timelineListState.scrollToItem(timelineLastIndex(displayedDetail))
        }
    }
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
                            onViewSelected = { view ->
                                selectedView = if (view == ThreadSurfaceView.Shell && !AndroidFeatureFlags.ShellEnabled) {
                                    ThreadSurfaceView.Chat
                                } else {
                                    view
                                }
                            },
                            shellEnabled = AndroidFeatureFlags.ShellEnabled,
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
                                timelineListState = timelineListState,
                                onOpenDetail = { request ->
                                    if (onOpenDetail != null) {
                                        onOpenDetail(request)
                                    } else {
                                        openDetail = request.fallback
                                    }
                                },
                                onDenyPendingRequest = onDenyPendingRequest,
                                onSubmitPendingRequest = onSubmitPendingRequest,
                                onLoadEarlier = onLoadEarlier,
                                imageResolver = imageResolver,
                                modifier = Modifier.fillMaxSize(),
                            )
                            ThreadSurfaceView.Workspace -> WorkspacePanel(
                                workspace = displayedDetail.workspacePreview,
                                onSelectFile = onSelectWorkspaceFile,
                                onLoadMorePreview = onLoadMoreWorkspacePreview,
                                onDownloadFile = onDownloadWorkspaceFile,
                                onOpenRawFile = onOpenWorkspaceRawFile,
                                onCopyRawFile = onCopyWorkspaceRawFile,
                                onUploadNote = onUploadWorkspaceNote,
                                modifier = Modifier.fillMaxSize(),
                            )
                            ThreadSurfaceView.Shell -> {
                                if (AndroidFeatureFlags.ShellEnabled) {
                                    ShellPanel(
                                        shell = displayedDetail.shellPreview,
                                        onCreateShell = onCreateShell,
                                        onTerminateShell = onTerminateShell,
                                        onSendShellInput = onSendShellInput,
                                        onSendShellControl = onSendShellControl,
                                        onClearShell = onClearShell,
                                        modifier = Modifier.fillMaxSize(),
                                    )
                                } else {
                                    selectedView = ThreadSurfaceView.Chat
                                }
                            }
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
                    onSubmitPromptRequest = onSubmitPromptRequest,
                    onInterruptThread = onInterruptThread,
                    onUpdateSettings = onUpdateThreadSettings,
                    onUpdateGoal = onUpdateThreadGoal,
                    onCompactThread = onCompactThread,
                    onForkLatest = onForkLatest,
                    onForkTurn = onForkTurn,
                    onTrustHook = onTrustHook,
                    onUntrustHook = onUntrustHook,
                    onPickPromptAttachment = onPickPromptAttachment,
                    pendingPromptAttachment = pendingPromptAttachment,
                    onSendShellInput = if (AndroidFeatureFlags.ShellEnabled) onSendShellInput else null,
                    onSendShellControl = if (AndroidFeatureFlags.ShellEnabled) onSendShellControl else null,
                    followTailOverride = timelineTailVisible,
                    onJumpLatest = {
                        coroutineScope.launch {
                            timelineListState.animateScrollToItem(timelineLastIndex(displayedDetail))
                        }
                    },
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
                    exportTurns = displayedDetail.exportTurns,
                    onClose = {
                        threadActionDialog = null
                        threadActionRoom = null
                    },
                    busy = threadActionBusy,
                    error = threadActionError,
                    onRenameThread = onRenameThread,
                    onExportThread = onExportThread,
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
    timelineListState: androidx.compose.foundation.lazy.LazyListState,
    onOpenDetail: (DetailRequest) -> Unit,
    onLoadEarlier: (() -> Unit)?,
    onDenyPendingRequest: (PendingRequestPreview) -> Unit,
    onSubmitPendingRequest: (PendingRequestPreview, Map<String, List<String>>) -> Unit,
    imageResolver: (suspend (String) -> InlineImagePreview?)?,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.background(ThreadColors.Workspace),
    ) {
        ThreadTimeline(
            turns = detail.turns,
            listState = timelineListState,
            auxiliary = detail.timelineAuxiliary,
            pendingRequests = detail.pendingRequests,
            onOpenDetail = onOpenDetail,
            onLoadEarlier = onLoadEarlier,
            onDenyPendingRequest = onDenyPendingRequest,
            onSubmitPendingRequest = onSubmitPendingRequest,
            imageResolver = imageResolver,
            modifier = Modifier.weight(1f),
        )
    }
}

private fun androidx.compose.foundation.lazy.LazyListState.isTailVisible(): Boolean {
    val totalItems = layoutInfo.totalItemsCount
    if (totalItems == 0) {
        return true
    }
    val lastVisible = layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: return true
    return lastVisible >= totalItems - 2
}

private fun timelineLastIndex(detail: ThreadDetailPreview): Int {
    return maxOf(detail.timelineItemCount() - 1, 0)
}

private fun ThreadDetailPreview.timelineContentKey(): String {
    val turnKey = turns.joinToString("|") { turn ->
        val lastMessage = turn.messages.lastOrNull()
        listOf(
            turn.index,
            turn.statusLabel,
            lastMessage?.status,
            lastMessage?.text?.length,
            lastMessage?.richText?.length,
            lastMessage?.toolCall?.name,
            lastMessage?.toolCall?.result?.length,
        ).joinToString(":")
    }
    return listOf(
        timelineAuxiliary.activityNotes.size,
        pendingRequests.size,
        timelineAuxiliary.answeredRequestNotes.size,
        timelineAuxiliary.canLoadEarlier,
        turns.size,
        timelineAuxiliary.pendingSteers.size,
        timelineAuxiliary.ephemeralUserNote?.length ?: 0,
        turnKey,
    ).joinToString("#")
}

private fun ThreadDetailPreview.timelineItemCount(): Int {
    return timelineAuxiliary.activityNotes.size +
        pendingRequests.size +
        timelineAuxiliary.answeredRequestNotes.size +
        (if (timelineAuxiliary.canLoadEarlier) 1 else 0) +
        turns.size +
        timelineAuxiliary.pendingSteers.size +
        (if (timelineAuxiliary.ephemeralUserNote != null) 1 else 0)
}
