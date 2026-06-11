package com.remotecodex.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.AndroidFeatureFlags
import com.remotecodex.android.api.CreateSupervisorWorkspaceRequest
import com.remotecodex.android.api.ImportSupervisorPluginRequest
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.StartSupervisorThreadRequest
import com.remotecodex.android.api.SupervisorPluginSummary
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.api.UpdateSupervisorPluginRequest
import com.remotecodex.android.api.UpdateSupervisorWorkspaceRequest
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.components.AppShellSettingsPanel
import com.remotecodex.android.ui.components.GraphActionIcon
import com.remotecodex.android.ui.components.GraphBadge
import com.remotecodex.android.ui.components.GraphBadgeVariant
import com.remotecodex.android.ui.components.GraphButton
import com.remotecodex.android.ui.components.GraphButtonSize
import com.remotecodex.android.ui.components.GraphButtonVariant
import com.remotecodex.android.ui.components.GraphDialogActionTone
import com.remotecodex.android.ui.components.GraphDialogFooter
import com.remotecodex.android.ui.components.GraphDialogFrame
import com.remotecodex.android.ui.components.GraphDialogOverlay
import com.remotecodex.android.ui.model.AppShellNavigationItemPreview
import com.remotecodex.android.ui.model.ShellProcessPreview
import com.remotecodex.android.ui.sample.ThreadPreviewSample
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SupervisorHomeScreen(
    supervisorConnection: SupervisorConnectionConfig,
    homeSnapshot: SupervisorHomeSnapshot?,
    homeSnapshotLoading: Boolean,
    homeSnapshotError: String?,
    themeMode: ThemeMode,
    darkThemeActive: Boolean,
    onThemeModeSelected: (ThemeMode) -> Unit,
    onOpenThread: (String?) -> Unit,
    onRefreshHomeSnapshot: () -> Unit = {},
    onChangeConnection: () -> Unit,
    initialPlugins: List<SupervisorPluginSummary>? = null,
    onImportPluginManifest: (suspend (String) -> SupervisorPluginSummary)? = null,
    onSetPluginEnabled: (suspend (String, Boolean) -> SupervisorPluginSummary)? = null,
    modifier: Modifier = Modifier,
) {
    val appShell = ThreadPreviewSample.appShell
    val detail = ThreadPreviewSample.detail
    val coroutineScope = rememberCoroutineScope()
    val client = remember(supervisorConnection) { SupervisorApiClient(supervisorConnection) }
    var settingsOpen by remember { mutableStateOf(false) }
    var selectedDestination by remember { mutableStateOf(HomeDestination.Workspaces) }
    var workspaceActionBusyId by remember { mutableStateOf<String?>(null) }
    var workspaceActionError by remember { mutableStateOf<String?>(null) }
    var workspaceDialog by remember { mutableStateOf<WorkspaceActionDialog?>(null) }
    var plugins by remember(supervisorConnection) { mutableStateOf(initialPlugins) }
    var pluginsLoading by remember { mutableStateOf(false) }
    var pluginsError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(initialPlugins) {
        if (initialPlugins != null) {
            plugins = initialPlugins
        }
    }
    fun refreshPlugins() {
        pluginsLoading = true
        pluginsError = null
        coroutineScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { client.listPlugins() }
            }
            pluginsLoading = false
            result
                .onSuccess { loaded -> plugins = loaded }
                .onFailure { error -> pluginsError = error.message ?: "Plugin registry failed." }
        }
    }
    fun setPluginEnabled(pluginId: String, enabled: Boolean) {
        plugins = plugins?.map { plugin ->
            if (plugin.id == pluginId) plugin.copy(enabled = enabled) else plugin
        }
        pluginsError = null
        coroutineScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val action = onSetPluginEnabled
                    if (action != null) {
                        action(pluginId, enabled)
                    } else {
                        client.updatePlugin(
                            pluginId,
                            UpdateSupervisorPluginRequest(enabled = enabled),
                        )
                    }
                }
            }
            result
                .onSuccess { updated ->
                    plugins = plugins?.map { plugin ->
                        if (plugin.id == updated.id) updated else plugin
                    }
                }
                .onFailure { error ->
                    plugins = plugins?.map { plugin ->
                        if (plugin.id == pluginId) plugin.copy(enabled = !enabled) else plugin
                    }
                    pluginsError = error.message ?: "Plugin update failed."
                }
        }
    }
    LaunchedEffect(settingsOpen, supervisorConnection) {
        if (settingsOpen && plugins == null && !pluginsLoading) {
            refreshPlugins()
        }
    }
    fun runWorkspaceCreate(absPath: String, label: String?) {
        workspaceActionBusyId = CreateWorkspaceBusyId
        workspaceActionError = null
        coroutineScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    client.createWorkspace(
                        CreateSupervisorWorkspaceRequest(
                            absPath = absPath,
                            label = label?.takeIf { it.isNotBlank() },
                        ),
                    )
                }
            }
            workspaceActionBusyId = null
            result
                .onSuccess {
                    workspaceDialog = null
                    onRefreshHomeSnapshot()
                }
                .onFailure { error ->
                    workspaceActionError = error.message ?: "Workspace create failed."
                }
        }
    }
    fun runWorkspaceAction(workspaceId: String, action: suspend () -> Unit) {
        workspaceActionBusyId = workspaceId
        workspaceActionError = null
        coroutineScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { action() }
            }
            workspaceActionBusyId = null
            result
                .onSuccess {
                    workspaceDialog = null
                    onRefreshHomeSnapshot()
                }
                .onFailure { error ->
                    workspaceActionError = error.message ?: "Workspace action failed."
                }
        }
    }
    fun runWorkspaceThreadStart(workspaceId: String, title: String?, model: String) {
        workspaceActionBusyId = workspaceId
        workspaceActionError = null
        coroutineScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    client.startThread(
                        StartSupervisorThreadRequest(
                            workspaceId = workspaceId,
                            title = title?.takeIf { it.isNotBlank() },
                            model = model,
                            approvalMode = "yolo",
                        ),
                    )
                }
            }
            workspaceActionBusyId = null
            result
                .onSuccess { thread ->
                    workspaceDialog = null
                    onRefreshHomeSnapshot()
                    onOpenThread(thread.id)
                }
                .onFailure { error ->
                    workspaceActionError = error.message ?: "Thread start failed."
                }
        }
    }
    Box(modifier = modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(ThreadColors.Background)
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                HomeHeader(
                    productName = appShell.productName,
                    connection = supervisorConnection,
                    loading = homeSnapshotLoading,
                    error = homeSnapshotError,
                    onOpenSettings = { settingsOpen = true },
                    onChangeConnection = onChangeConnection,
                )
            }

            item {
                HomeSnapshotBand(
                    snapshot = homeSnapshot,
                    loading = homeSnapshotLoading,
                    error = homeSnapshotError,
                )
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    appShell.navigationItems
                        .filter { item -> AndroidFeatureFlags.ShellEnabled || HomeDestination.fromLabel(item.label) != HomeDestination.Shells }
                        .forEach { item ->
                        val destination = HomeDestination.fromLabel(item.label)
                        HomeDestinationRow(
                            item = item,
                            snapshot = homeSnapshot,
                            selected = destination == selectedDestination,
                            onClick = {
                                selectedDestination = destination
                            },
                        )
                    }
                }
            }

            when (selectedDestination) {
                HomeDestination.Workspaces -> {
                    item {
                        HomeSectionTitle(
                            title = "Workspaces",
                            detail = "Trusted project roots",
                            actionLabel = "New",
                            actionContentDescription = "Create workspace",
                            onAction = {
                                workspaceActionError = null
                                workspaceDialog = WorkspaceActionDialog.Create
                            },
                        )
                    }
                    val workspaces = homeSnapshot?.workspaces.orEmpty()
                    if (workspaces.isEmpty()) {
                        item {
                            EmptyHomeRow(
                                title = if (homeSnapshotLoading) "Loading workspaces" else "No workspaces loaded",
                                detail = homeSnapshotError ?: "Add a trusted project root to start threads from this Android client.",
                                actionLabel = "New Workspace",
                                onClick = {
                                    workspaceActionError = null
                                    workspaceDialog = WorkspaceActionDialog.Create
                                },
                            )
                        }
                    } else {
                        items(workspaces.take(8), key = { it.id }) { workspace ->
                            WorkspaceSummaryRow(
                                workspace = workspace,
                                busy = workspaceActionBusyId == workspace.id,
                                onOpenWorkspace = {
                                    runWorkspaceAction(workspace.id) {
                                        client.openWorkspace(workspace.id)
                                    }
                                },
                                onToggleFavorite = {
                                    runWorkspaceAction(workspace.id) {
                                        client.setWorkspaceFavorite(workspace.id, !workspace.isFavorite)
                                    }
                                },
                                onRenameWorkspace = {
                                    workspaceActionError = null
                                    workspaceDialog = WorkspaceActionDialog.Rename(workspace)
                                },
                                onStartThread = {
                                    workspaceActionError = null
                                    workspaceDialog = WorkspaceActionDialog.StartThread(workspace)
                                },
                                onDeleteWorkspace = {
                                    workspaceActionError = null
                                    workspaceDialog = WorkspaceActionDialog.Delete(workspace)
                                },
                            )
                        }
                    }
                }
                HomeDestination.Threads -> {
                    item {
                        HomeSectionTitle(title = "Active Threads", detail = "Recent supervisor list")
                    }
                    val threads = homeSnapshot?.threads.orEmpty()
                    if (threads.isEmpty()) {
                        item {
                            EmptyHomeRow(
                                title = if (homeSnapshotLoading) "Loading threads" else "No threads loaded",
                                detail = homeSnapshotError ?: "Connect to a supervisor and open a thread preview while the list endpoint is empty.",
                                actionLabel = "Open Preview",
                                onClick = { onOpenThread(null) },
                            )
                        }
                    } else {
                        items(threads.take(8), key = { it.id }) { thread ->
                            ThreadSummaryRow(thread = thread, onClick = { onOpenThread(thread.id) })
                        }
                    }
                }
                HomeDestination.Shells -> {
                    item {
                        HomeSectionTitle(title = "Shells", detail = detail.shellPreview.connectionLabel)
                    }
                    items(detail.shellPreview.processes, key = { it.id }) { process ->
                        ShellProcessSummaryRow(
                            process = process,
                            activeProcessId = detail.shellPreview.activeProcessId,
                            onClick = { onOpenThread(null) },
                        )
                    }
                    item {
                        EmptyHomeRow(
                            title = "Shell adapter pending",
                            detail = "Open the thread preview to inspect current native shell controls while backend shell actions are being wired.",
                            actionLabel = "Open Shell",
                            onClick = { onOpenThread(null) },
                        )
                    }
                }
            }
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
                plugins = plugins,
                pluginsLoading = pluginsLoading,
                pluginsError = pluginsError,
                onThemeModeSelected = onThemeModeSelected,
                onChangeConnection = onChangeConnection,
                onImportPluginManifest = onImportPluginManifest ?: { manifestJson ->
                    withContext(Dispatchers.IO) {
                        client.importPlugin(
                            ImportSupervisorPluginRequest(
                                manifestJson = manifestJson,
                                enabled = true,
                            ),
                        )
                    }
                },
                onRefreshPlugins = { refreshPlugins() },
                onSetPluginEnabled = { pluginId, enabled -> setPluginEnabled(pluginId, enabled) },
                onClose = { settingsOpen = false },
                modifier = Modifier.fillMaxSize(),
            )
        }
        workspaceDialog?.let { dialog ->
            WorkspaceActionDialogOverlay(
                dialog = dialog,
                busy = dialog.busyId == workspaceActionBusyId,
                error = workspaceActionError,
                onClose = {
                    if (workspaceActionBusyId == null) {
                        workspaceDialog = null
                        workspaceActionError = null
                    }
                },
                onCreateWorkspace = { absPath, label ->
                    runWorkspaceCreate(absPath, label)
                },
                onRenameWorkspace = { label ->
                    dialog.workspace?.let { workspace ->
                        runWorkspaceAction(workspace.id) {
                            client.updateWorkspace(workspace.id, UpdateSupervisorWorkspaceRequest(label = label))
                        }
                    }
                },
                onStartThread = { title, model ->
                    dialog.workspace?.let { workspace ->
                        runWorkspaceThreadStart(workspace.id, title, model)
                    }
                },
                onDeleteWorkspace = {
                    dialog.workspace?.let { workspace ->
                        runWorkspaceAction(workspace.id) {
                            client.deleteWorkspace(workspace.id)
                        }
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun HomeHeader(
    productName: String,
    connection: SupervisorConnectionConfig,
    loading: Boolean,
    error: String?,
    onOpenSettings: () -> Unit,
    onChangeConnection: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = productName.take(1),
            modifier = Modifier
                .clip(CircleShape)
                .background(ThreadColors.Primary)
                .padding(horizontal = 14.dp, vertical = 10.dp),
            color = ThreadColors.PrimaryForeground,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = productName,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "${connection.mode.label} / ${connection.normalizedBaseUrl}",
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            GraphBadge(
                label = when {
                    loading -> "Syncing"
                    error != null -> "Needs attention"
                    else -> "Connected"
                },
                variant = if (error == null) GraphBadgeVariant.Outline else GraphBadgeVariant.Destructive,
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), horizontalAlignment = Alignment.End) {
            GraphButton(
                label = "Settings",
                icon = GraphActionIcon.Open,
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Small,
                contentDescription = "Open settings",
                onClick = onOpenSettings,
            )
            GraphButton(
                label = "Change",
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Small,
                contentDescription = "Change connection",
                onClick = onChangeConnection,
            )
        }
    }
}

@Composable
private fun HomeSnapshotBand(
    snapshot: SupervisorHomeSnapshot?,
    loading: Boolean,
    error: String?,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(16.dp))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        SnapshotMetric(
            label = "Workspaces",
            value = snapshot?.workspaces?.size?.toString() ?: if (loading) "..." else "0",
            modifier = Modifier.weight(1f),
        )
        SnapshotMetric(
            label = "Threads",
            value = snapshot?.threads?.size?.toString() ?: if (loading) "..." else "0",
            modifier = Modifier.weight(1f),
        )
        SnapshotMetric(
            label = "Running",
            value = snapshot?.activeThreadCount?.toString() ?: if (loading) "..." else "0",
            modifier = Modifier.weight(1f),
            error = error != null,
        )
    }
}

@Composable
private fun SnapshotMetric(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    error: Boolean = false,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(if (error) ThreadColors.DangerSoft else ThreadColors.SurfaceStrong)
            .border(1.dp, if (error) ThreadColors.Danger else ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = value,
            color = if (error) ThreadColors.Danger else ThreadColors.Foreground,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
        Text(
            text = label,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun HomeDestinationRow(
    item: AppShellNavigationItemPreview,
    snapshot: SupervisorHomeSnapshot?,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val count = when (item.label) {
        "Workspaces" -> snapshot?.workspaces?.size
        "Threads" -> snapshot?.threads?.size
        "Shells" -> snapshot?.activeThreadCount
        else -> null
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) ThreadColors.SurfaceStrong else ThreadColors.Surface)
            .border(1.dp, if (selected) ThreadColors.BorderStrong else ThreadColors.Border, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .semantics { contentDescription = "Open ${item.label}" }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        DestinationMark(label = item.label)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = item.label,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            Text(
                text = item.detail,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        GraphBadge(
            label = if (selected) "Active" else count?.toString() ?: "Preview",
            variant = GraphBadgeVariant.Outline,
        )
    }
}

@Composable
private fun DestinationMark(label: String) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(11.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(11.dp))
            .padding(horizontal = 10.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label.take(1),
            color = ThreadColors.Primary,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
    }
}

@Composable
private fun HomeSectionTitle(
    title: String,
    detail: String,
    actionLabel: String? = null,
    actionContentDescription: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = title,
            modifier = Modifier.weight(1f),
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = detail,
            modifier = Modifier.weight(1f, fill = false),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (actionLabel != null && onAction != null) {
            GraphButton(
                label = actionLabel,
                icon = GraphActionIcon.Open,
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Small,
                contentDescription = actionContentDescription ?: actionLabel,
                onClick = onAction,
            )
        }
    }
}

@Composable
private fun ThreadSummaryRow(
    thread: SupervisorThreadSummary,
    onClick: () -> Unit,
) {
    SummaryRowFrame(
        title = thread.title.ifBlank { "Untitled thread" },
        detail = thread.summaryText ?: "Updated ${thread.updatedAt}",
        meta = listOfNotNull(thread.status, thread.model).joinToString(" / "),
        contentDescription = "Open thread ${thread.title}",
        onClick = onClick,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WorkspaceSummaryRow(
    workspace: SupervisorWorkspaceSummary,
    busy: Boolean,
    onOpenWorkspace: () -> Unit,
    onToggleFavorite: () -> Unit,
    onRenameWorkspace: () -> Unit,
    onStartThread: () -> Unit,
    onDeleteWorkspace: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(11.dp),
        ) {
            DestinationMark(label = workspace.label.ifBlank { workspace.absPath })
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(
                    text = workspace.label.ifBlank { workspace.absPath },
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = workspace.absPath,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = workspace.workspaceMetaLabel(),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            GraphButton(
                label = "Open",
                icon = GraphActionIcon.Open,
                enabled = !busy,
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Small,
                contentDescription = "Open workspace ${workspace.label}",
                onClick = onOpenWorkspace,
            )
            GraphButton(
                label = if (workspace.isFavorite) "Unstar" else "Star",
                enabled = !busy,
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Small,
                contentDescription = "Toggle favorite workspace ${workspace.label}",
                onClick = onToggleFavorite,
            )
            GraphButton(
                label = "Rename",
                enabled = !busy,
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Small,
                contentDescription = "Rename workspace ${workspace.label}",
                onClick = onRenameWorkspace,
            )
            GraphButton(
                label = "New Thread",
                enabled = !busy,
                variant = GraphButtonVariant.Default,
                size = GraphButtonSize.Small,
                contentDescription = "Start thread in workspace ${workspace.label}",
                onClick = onStartThread,
            )
            GraphButton(
                label = "Delete",
                icon = GraphActionIcon.Delete,
                enabled = !busy,
                variant = GraphButtonVariant.Destructive,
                size = GraphButtonSize.Small,
                contentDescription = "Delete workspace ${workspace.label}",
                onClick = onDeleteWorkspace,
            )
        }
    }
}

private fun SupervisorWorkspaceSummary.workspaceMetaLabel(): String {
    return when {
        isFavorite -> "favorite"
        lastOpenedAt != null -> "opened"
        else -> "workspace"
    }
}

private const val CreateWorkspaceBusyId = "__create_workspace__"

private sealed class WorkspaceActionDialog {
    abstract val workspace: SupervisorWorkspaceSummary?
    val busyId: String
        get() = workspace?.id ?: CreateWorkspaceBusyId

    object Create : WorkspaceActionDialog() {
        override val workspace: SupervisorWorkspaceSummary? = null
    }

    class Rename(override val workspace: SupervisorWorkspaceSummary) : WorkspaceActionDialog()
    class StartThread(override val workspace: SupervisorWorkspaceSummary) : WorkspaceActionDialog()
    class Delete(override val workspace: SupervisorWorkspaceSummary) : WorkspaceActionDialog()
}

@Composable
private fun WorkspaceActionDialogOverlay(
    dialog: WorkspaceActionDialog,
    busy: Boolean,
    error: String?,
    onClose: () -> Unit,
    onCreateWorkspace: (String, String?) -> Unit,
    onRenameWorkspace: (String) -> Unit,
    onStartThread: (String?, String) -> Unit,
    onDeleteWorkspace: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GraphDialogOverlay(onDismiss = onClose, modifier = modifier) {
        when (dialog) {
            is WorkspaceActionDialog.Create -> CreateWorkspaceDialog(
                busy = busy,
                error = error,
                onClose = onClose,
                onCreateWorkspace = onCreateWorkspace,
            )
            is WorkspaceActionDialog.Rename -> RenameWorkspaceDialog(
                workspace = dialog.workspace,
                busy = busy,
                error = error,
                onClose = onClose,
                onRenameWorkspace = onRenameWorkspace,
            )
            is WorkspaceActionDialog.StartThread -> StartThreadDialog(
                workspace = dialog.workspace,
                busy = busy,
                error = error,
                onClose = onClose,
                onStartThread = onStartThread,
            )
            is WorkspaceActionDialog.Delete -> DeleteWorkspaceDialog(
                workspace = dialog.workspace,
                busy = busy,
                error = error,
                onClose = onClose,
                onDeleteWorkspace = onDeleteWorkspace,
            )
        }
    }
}

@Composable
private fun CreateWorkspaceDialog(
    busy: Boolean,
    error: String?,
    onClose: () -> Unit,
    onCreateWorkspace: (String, String?) -> Unit,
) {
    var absPath by rememberSaveable { mutableStateOf("") }
    var label by rememberSaveable { mutableStateOf("") }
    val normalizedPath = absPath.trim()
    val normalizedLabel = label.trim()
    GraphDialogFrame(
        title = "New Workspace",
        subtitle = "Trusted project root",
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = if (busy) "Creating" else "Create",
                primaryTone = GraphDialogActionTone.Success,
                primaryEnabled = !busy && normalizedPath.isNotBlank(),
                onCancel = onClose,
                onPrimary = {
                    onCreateWorkspace(
                        normalizedPath,
                        normalizedLabel.takeIf { it.isNotBlank() },
                    )
                },
            )
        },
    ) {
        OutlinedTextField(
            value = absPath,
            onValueChange = { absPath = it },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Workspace path") },
            placeholder = { Text("/home/u/dev/project") },
            singleLine = true,
            colors = workspaceTextFieldColors(),
        )
        OutlinedTextField(
            value = label,
            onValueChange = { label = it },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Label") },
            placeholder = { Text("Optional") },
            singleLine = true,
            colors = workspaceTextFieldColors(),
        )
        Text(
            text = "The supervisor must be able to access this absolute path.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
        error?.let { message ->
            Text(
                text = message,
                color = ThreadColors.Danger,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun StartThreadDialog(
    workspace: SupervisorWorkspaceSummary,
    busy: Boolean,
    error: String?,
    onClose: () -> Unit,
    onStartThread: (String?, String) -> Unit,
) {
    var title by rememberSaveable(workspace.id) { mutableStateOf("") }
    var model by rememberSaveable(workspace.id) { mutableStateOf(DefaultStartThreadModel) }
    val normalizedTitle = title.trim()
    val normalizedModel = model.trim()
    GraphDialogFrame(
        title = "New Thread",
        subtitle = workspace.label.ifBlank { workspace.absPath },
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = if (busy) "Starting" else "Start",
                primaryTone = GraphDialogActionTone.Success,
                primaryEnabled = !busy && normalizedModel.isNotBlank(),
                onCancel = onClose,
                onPrimary = {
                    onStartThread(
                        normalizedTitle.takeIf { it.isNotBlank() },
                        normalizedModel,
                    )
                },
            )
        },
    ) {
        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Thread title") },
            singleLine = true,
            colors = workspaceTextFieldColors(),
        )
        OutlinedTextField(
            value = model,
            onValueChange = { model = it },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Model") },
            singleLine = true,
            colors = workspaceTextFieldColors(),
        )
        Text(
            text = "Starts a Codex thread in ${workspace.absPath}.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
        error?.let { message ->
            Text(
                text = message,
                color = ThreadColors.Danger,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun RenameWorkspaceDialog(
    workspace: SupervisorWorkspaceSummary,
    busy: Boolean,
    error: String?,
    onClose: () -> Unit,
    onRenameWorkspace: (String) -> Unit,
) {
    var label by rememberSaveable(workspace.id) { mutableStateOf(workspace.label) }
    val normalizedLabel = label.trim()
    GraphDialogFrame(
        title = "Rename Workspace",
        subtitle = workspace.absPath,
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = if (busy) "Saving" else "Save",
                primaryTone = GraphDialogActionTone.Success,
                primaryEnabled = !busy && normalizedLabel.isNotBlank(),
                onCancel = onClose,
                onPrimary = { onRenameWorkspace(normalizedLabel) },
            )
        },
    ) {
        OutlinedTextField(
            value = label,
            onValueChange = { label = it },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Workspace label") },
            singleLine = true,
            colors = workspaceTextFieldColors(),
        )
        error?.let { message ->
            Text(
                text = message,
                color = ThreadColors.Danger,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun DeleteWorkspaceDialog(
    workspace: SupervisorWorkspaceSummary,
    busy: Boolean,
    error: String?,
    onClose: () -> Unit,
    onDeleteWorkspace: () -> Unit,
) {
    GraphDialogFrame(
        title = "Delete Workspace",
        subtitle = workspace.label.ifBlank { workspace.absPath },
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = if (busy) "Deleting" else "Delete",
                primaryTone = GraphDialogActionTone.Danger,
                primaryEnabled = !busy,
                onCancel = onClose,
                onPrimary = onDeleteWorkspace,
            )
        },
    ) {
        Text(
            text = "This removes the workspace record and its related threads from the supervisor.",
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.bodyMedium,
        )
        Text(
            text = workspace.absPath,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
        )
        error?.let { message ->
            Text(
                text = message,
                color = ThreadColors.Danger,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun workspaceTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = ThreadColors.Primary,
    unfocusedBorderColor = ThreadColors.BorderStrong,
    focusedLabelColor = ThreadColors.Primary,
    unfocusedLabelColor = ThreadColors.ForegroundMuted,
    cursorColor = ThreadColors.Primary,
    focusedTextColor = ThreadColors.Foreground,
    unfocusedTextColor = ThreadColors.Foreground,
    focusedContainerColor = ThreadColors.Surface,
    unfocusedContainerColor = ThreadColors.Surface,
    disabledContainerColor = ThreadColors.Surface,
)

@Composable
private fun ShellProcessSummaryRow(
    process: ShellProcessPreview,
    activeProcessId: String,
    onClick: () -> Unit,
) {
    SummaryRowFrame(
        title = process.label,
        detail = process.runningCommand ?: process.cwd,
        meta = if (process.id == activeProcessId) "active / ${process.status}" else process.status,
        contentDescription = "Open shell ${process.label}",
        onClick = onClick,
    )
}

@Composable
private fun EmptyHomeRow(
    title: String,
    detail: String,
    actionLabel: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = title,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = detail,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        GraphButton(
            label = actionLabel,
            variant = GraphButtonVariant.Secondary,
            size = GraphButtonSize.Small,
            contentDescription = actionLabel,
            onClick = onClick,
        )
    }
}

@Composable
private fun SummaryRowFrame(
    title: String,
    detail: String,
    meta: String,
    contentDescription: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp))
            .clickable(onClick = onClick)
            .semantics { this.contentDescription = contentDescription }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        DestinationMark(label = title)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = title,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = detail,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            text = meta,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

private enum class HomeDestination {
    Workspaces,
    Threads,
    Shells;

    companion object {
        fun fromLabel(label: String): HomeDestination {
            return when (label) {
                "Threads" -> Threads
                "Shells" -> Shells
                else -> Workspaces
            }
        }
    }
}

private const val DefaultStartThreadModel = "gpt-5"
