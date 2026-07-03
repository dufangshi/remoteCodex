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
import com.remotecodex.android.api.CreateSupervisorWorkspaceRequest
import com.remotecodex.android.api.ImportSupervisorThreadRequest
import com.remotecodex.android.api.ImportSupervisorPluginRequest
import com.remotecodex.android.api.SupervisorAgentBackend
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.StartSupervisorThreadRequest
import com.remotecodex.android.api.SupervisorPluginSummary
import com.remotecodex.android.api.SupervisorRuntimeConfig
import com.remotecodex.android.api.SupervisorModelOption
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorWorkspaceSettings
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.api.UpdateSupervisorPluginRequest
import com.remotecodex.android.api.UpdateSupervisorWorkspaceSettingsRequest
import com.remotecodex.android.api.UpdateSupervisorWorkspaceRequest
import com.remotecodex.android.api.canStartSession
import com.remotecodex.android.api.runtimeActionLabel
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
import com.remotecodex.android.ui.components.GraphFloatingIconButton
import com.remotecodex.android.ui.components.GraphIconButton
import com.remotecodex.android.ui.components.GraphSelectionGlyph
import com.remotecodex.android.ui.components.GraphSelectionTone
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
    onOpenWorkspace: (String) -> Unit = {},
    onRefreshHomeSnapshot: () -> Unit = {},
    onChangeConnection: () -> Unit,
    initialPlugins: List<SupervisorPluginSummary>? = null,
    initialRuntimeConfig: SupervisorRuntimeConfig? = null,
    initialWorkspaceSettings: SupervisorWorkspaceSettings? = null,
    initialAgentBackends: List<SupervisorAgentBackend>? = null,
    onImportPluginManifest: (suspend (String) -> SupervisorPluginSummary)? = null,
    onSetPluginEnabled: (suspend (String, Boolean) -> SupervisorPluginSummary)? = null,
    onSaveWorkspaceSettings: (suspend (String, String?) -> SupervisorWorkspaceSettings)? = null,
    modifier: Modifier = Modifier,
) {
    val appShell = ThreadPreviewSample.appShell
    val coroutineScope = rememberCoroutineScope()
    val client = remember(supervisorConnection) { SupervisorApiClient(supervisorConnection) }
    var settingsOpen by remember { mutableStateOf(false) }
    var homeMenuOpen by remember { mutableStateOf(false) }
    var workspaceActionBusyId by remember { mutableStateOf<String?>(null) }
    var workspaceActionError by remember { mutableStateOf<String?>(null) }
    var workspaceDialog by remember { mutableStateOf<WorkspaceActionDialog?>(null) }
    var plugins by remember(supervisorConnection) { mutableStateOf(initialPlugins) }
    var pluginsLoading by remember { mutableStateOf(false) }
    var pluginsError by remember { mutableStateOf<String?>(null) }
    var runtimeConfig by remember(supervisorConnection) { mutableStateOf(initialRuntimeConfig) }
    var workspaceSettings by remember(supervisorConnection) { mutableStateOf(initialWorkspaceSettings) }
    var agentBackends by remember(supervisorConnection) { mutableStateOf(initialAgentBackends) }
    var sessionUsername by remember(supervisorConnection) { mutableStateOf<String?>(null) }
    var backendSettingsLoading by remember { mutableStateOf(false) }
    var backendSettingsSaving by remember { mutableStateOf(false) }
    var backendSettingsError by remember { mutableStateOf<String?>(null) }
    var backendSettingsMessage by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(initialPlugins) {
        if (initialPlugins != null) {
            plugins = initialPlugins
        }
    }
    LaunchedEffect(initialRuntimeConfig, initialWorkspaceSettings) {
        initialRuntimeConfig?.let { runtimeConfig = it }
        initialWorkspaceSettings?.let { workspaceSettings = it }
    }
    LaunchedEffect(supervisorConnection) {
        sessionUsername = withContext(Dispatchers.IO) {
            runCatching { client.fetchAuthSession().username }.getOrNull()
        }
    }
    LaunchedEffect(initialAgentBackends) {
        if (initialAgentBackends != null) {
            agentBackends = initialAgentBackends
        }
    }
    fun refreshBackendSettings() {
        backendSettingsLoading = true
        backendSettingsError = null
        backendSettingsMessage = null
        coroutineScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    Triple(
                        client.fetchRuntimeConfig(),
                        client.fetchWorkspaceSettings(),
                        client.listAgentBackends(),
                    )
                }
            }
            backendSettingsLoading = false
            result
                .onSuccess { (runtime, settings, backends) ->
                    runtimeConfig = runtime
                    workspaceSettings = settings
                    agentBackends = backends
                }
                .onFailure { error ->
                    backendSettingsError = error.message ?: "Backend settings failed."
                }
        }
    }
    fun saveWorkspaceSettings(devHome: String, defaultBackend: String?) {
        backendSettingsSaving = true
        backendSettingsError = null
        backendSettingsMessage = null
        coroutineScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val action = onSaveWorkspaceSettings
                    if (action != null) {
                        action(devHome, defaultBackend)
                    } else {
                        client.updateWorkspaceSettings(
                            UpdateSupervisorWorkspaceSettingsRequest(
                                devHome = devHome,
                                defaultBackend = defaultBackend,
                            ),
                        )
                    }
                }
            }
            backendSettingsSaving = false
            result
                .onSuccess { settings ->
                    workspaceSettings = settings
                    backendSettingsMessage = "Workspace defaults saved."
                }
                .onFailure { error ->
                    backendSettingsError = error.message ?: "Workspace defaults save failed."
                }
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
        if (
            settingsOpen &&
            (runtimeConfig == null || workspaceSettings == null) &&
            !backendSettingsLoading
        ) {
            refreshBackendSettings()
        }
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
    fun runWorkspaceThreadStart(workspaceId: String, draft: StartThreadDraft) {
        workspaceActionBusyId = workspaceId
        workspaceActionError = null
        coroutineScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    client.startThread(
	                        StartSupervisorThreadRequest(
	                            workspaceId = workspaceId,
	                            title = draft.title?.takeIf { it.isNotBlank() },
	                            provider = draft.provider,
	                            model = draft.model,
                                reasoningEffort = draft.reasoningEffort,
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
    fun runThreadImport(provider: String, sessionId: String) {
        workspaceActionBusyId = ImportThreadBusyId
        workspaceActionError = null
        coroutineScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    client.importThread(
                        ImportSupervisorThreadRequest(
                            sessionId = sessionId,
                            provider = provider,
                        ),
                    )
                }
            }
            workspaceActionBusyId = null
            result
                .onSuccess { detail ->
                    workspaceDialog = null
                    onRefreshHomeSnapshot()
                    onOpenThread(detail.thread.id)
                }
                .onFailure { error ->
                    workspaceActionError = error.message ?: "Thread import failed."
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
                    onOpenMenu = { homeMenuOpen = true },
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
            item {
                GraphButton(
                    label = "Import Session",
                    icon = GraphActionIcon.Open,
                    variant = GraphButtonVariant.Outline,
                    size = GraphButtonSize.Small,
                    contentDescription = "Import existing backend session",
                    onClick = {
                        workspaceActionError = null
                        workspaceDialog = WorkspaceActionDialog.ImportThread
                    },
                )
            }
            val workspaces = homeSnapshot?.workspaces.orEmpty()
                .sortedWith(
                    compareByDescending<SupervisorWorkspaceSummary> { it.isFavorite }
                        .thenBy { workspace -> workspace.label.ifBlank { workspace.absPath }.lowercase() },
                )
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
                            onOpenWorkspace(workspace.id)
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
                            if (agentBackends == null && !backendSettingsLoading) {
                                refreshBackendSettings()
                            }
                        },
                        onDeleteWorkspace = {
                            workspaceActionError = null
                            workspaceDialog = WorkspaceActionDialog.Delete(workspace)
                        },
                    )
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
                runtimeConfig = runtimeConfig,
                workspaceSettings = workspaceSettings,
                backendSettingsLoading = backendSettingsLoading,
                backendSettingsSaving = backendSettingsSaving,
                backendSettingsError = backendSettingsError,
                backendSettingsMessage = backendSettingsMessage,
                agentBackends = agentBackends,
                onThemeModeSelected = onThemeModeSelected,
                onChangeConnection = onChangeConnection,
                onRefreshBackendSettings = { refreshBackendSettings() },
                onSaveWorkspaceSettings = { devHome, defaultBackend ->
                    saveWorkspaceSettings(devHome, defaultBackend)
                },
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
        if (homeMenuOpen) {
            HomeOverflowMenuDialog(
                onClose = { homeMenuOpen = false },
                onOpenSettings = {
                    homeMenuOpen = false
                    settingsOpen = true
                },
                onRefresh = {
                    homeMenuOpen = false
                    onRefreshHomeSnapshot()
                },
                onOpenDevices = {
                    homeMenuOpen = false
                    onChangeConnection()
                },
            )
        }
        workspaceDialog?.let { dialog ->
            WorkspaceActionDialogOverlay(
                dialog = dialog,
                backends = agentBackends.orEmpty(),
                backendsLoading = backendSettingsLoading,
                backendsError = backendSettingsError,
                loadModels = { provider -> client.listAgentModels(provider) },
                installOrUpdateBackend = { backend ->
                    val action = if (backend.installed) "update" else "install"
                    client.installOrUpdateAgentBackend(backend.provider, action)
                    agentBackends = client.listAgentBackends()
                },
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
                onStartThread = { draft ->
                    dialog.workspace?.let { workspace ->
                        runWorkspaceThreadStart(workspace.id, draft)
                    }
                },
                onImportThread = { provider, sessionId ->
                    runThreadImport(provider, sessionId)
                },
                onDeleteWorkspace = {
                    dialog.workspace?.let { workspace ->
                        runWorkspaceAction(workspace.id) {
                            client.deleteWorkspace(workspace.id, workspace.label)
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
    onOpenMenu: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
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
        GraphFloatingIconButton(
            icon = GraphActionIcon.Menu,
            contentDescription = "Open home menu",
            onClick = onOpenMenu,
        )
    }
}

@Composable
private fun HomeOverflowMenuDialog(
    onClose: () -> Unit,
    onOpenSettings: () -> Unit,
    onRefresh: () -> Unit,
    onOpenDevices: () -> Unit,
) {
    GraphDialogOverlay(onDismiss = onClose) {
        GraphDialogFrame(
            title = "Actions",
            subtitle = "Supervisor controls",
            onClose = onClose,
            footer = {},
            showFooter = false,
        ) {
            GraphButton(
                label = "Settings",
                modifier = Modifier.fillMaxWidth(),
                icon = GraphActionIcon.Settings,
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Default,
                contentDescription = "Open settings",
                onClick = onOpenSettings,
            )
            GraphButton(
                label = "Refresh",
                modifier = Modifier.fillMaxWidth(),
                icon = GraphActionIcon.Refresh,
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Default,
                contentDescription = "Refresh home",
                onClick = onRefresh,
            )
            GraphButton(
                label = "Devices",
                modifier = Modifier.fillMaxWidth(),
                icon = GraphActionIcon.Devices,
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Default,
                contentDescription = "Open devices",
                onClick = onOpenDevices,
            )
        }
    }
}

private fun accountInitials(value: String): String {
    val letters = value.trim().filter { it.isLetterOrDigit() }.take(2)
    return letters.ifBlank { "RC" }.uppercase()
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
    workspace: SupervisorWorkspaceSummary? = null,
    onClick: () -> Unit,
) {
    SummaryRowFrame(
        title = thread.title.ifBlank { "Untitled thread" },
        detail = listOfNotNull(
            workspace?.label?.ifBlank { workspace.absPath },
            thread.summaryText ?: "Updated ${thread.updatedAt}",
        ).joinToString(" / "),
        meta = listOfNotNull(thread.status.threadStatusLabel(), thread.model).joinToString(" / "),
        contentDescription = "Open thread ${thread.title}",
        onClick = onClick,
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ThreadListControls(
    threads: List<SupervisorThreadSummary>,
    query: String,
    filter: ThreadListFilter,
    sort: ThreadListSort,
    onQueryChange: (String) -> Unit,
    onFilterChange: (ThreadListFilter) -> Unit,
    onSortChange: (ThreadListSort) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = "Thread search input" },
            label = { Text("Search threads") },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodySmall.copy(color = ThreadColors.Foreground),
            colors = workspaceTextFieldColors(),
        )
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ThreadListFilter.entries.forEach { candidate ->
                GraphButton(
                    label = "${candidate.label} ${threads.count(candidate::matches)}",
                    enabled = filter != candidate,
                    variant = if (filter == candidate) GraphButtonVariant.Default else GraphButtonVariant.Outline,
                    size = GraphButtonSize.Small,
                    contentDescription = "Filter threads ${candidate.label}",
                    onClick = { onFilterChange(candidate) },
                )
            }
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ThreadListSort.entries.forEach { candidate ->
                GraphButton(
                    label = candidate.label,
                    enabled = sort != candidate,
                    variant = if (sort == candidate) GraphButtonVariant.Secondary else GraphButtonVariant.Outline,
                    size = GraphButtonSize.Small,
                    contentDescription = "Sort threads by ${candidate.label}",
                    onClick = { onSortChange(candidate) },
                )
            }
        }
    }
}

@Composable
private fun ThreadGroupHeader(group: ThreadGroup) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = group.title,
            modifier = Modifier.weight(1f),
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        GraphBadge(
            label = group.threads.size.toString(),
            variant = GraphBadgeVariant.Secondary,
        )
    }
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
            .clickable(enabled = !busy, onClick = onOpenWorkspace)
            .semantics { contentDescription = "Open workspace ${workspace.label}" }
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
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (workspace.isFavorite) {
                GraphIconButton(
                    icon = GraphActionIcon.Pin,
                    contentDescription = "Pinned workspace",
                    enabled = false,
                    variant = GraphButtonVariant.Ghost,
                    size = GraphButtonSize.Small,
                )
            }
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            GraphButton(
                label = if (workspace.isFavorite) "Unpin" else "Pin",
                icon = GraphActionIcon.Pin,
                enabled = !busy,
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Small,
                contentDescription = "Toggle pinned workspace ${workspace.label}",
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
                icon = GraphActionIcon.Add,
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
        isFavorite -> "pinned"
        lastOpenedAt != null -> "opened"
        else -> "workspace"
    }
}

private const val CreateWorkspaceBusyId = "__create_workspace__"
private const val ImportThreadBusyId = "__import_thread__"

private data class StartThreadDraft(
    val title: String?,
    val provider: String,
    val model: String,
    val reasoningEffort: String?,
)

private sealed class WorkspaceActionDialog {
    abstract val workspace: SupervisorWorkspaceSummary?
    val busyId: String
        get() = when (this) {
            ImportThread -> ImportThreadBusyId
            else -> workspace?.id ?: CreateWorkspaceBusyId
        }

    object Create : WorkspaceActionDialog() {
        override val workspace: SupervisorWorkspaceSummary? = null
    }

    object ImportThread : WorkspaceActionDialog() {
        override val workspace: SupervisorWorkspaceSummary? = null
    }

    class Rename(override val workspace: SupervisorWorkspaceSummary) : WorkspaceActionDialog()
    class StartThread(override val workspace: SupervisorWorkspaceSummary) : WorkspaceActionDialog()
    class Delete(override val workspace: SupervisorWorkspaceSummary) : WorkspaceActionDialog()
}

@Composable
private fun WorkspaceActionDialogOverlay(
    dialog: WorkspaceActionDialog,
    backends: List<SupervisorAgentBackend>,
    backendsLoading: Boolean,
    backendsError: String?,
    loadModels: suspend (String) -> List<SupervisorModelOption>,
    installOrUpdateBackend: suspend (SupervisorAgentBackend) -> Unit,
    busy: Boolean,
    error: String?,
    onClose: () -> Unit,
    onCreateWorkspace: (String, String?) -> Unit,
    onRenameWorkspace: (String) -> Unit,
    onStartThread: (StartThreadDraft) -> Unit,
    onImportThread: (String, String) -> Unit,
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
            is WorkspaceActionDialog.ImportThread -> ImportThreadDialog(
                backends = backends,
                busy = busy,
                error = error,
                onClose = onClose,
                onImportThread = onImportThread,
            )
            is WorkspaceActionDialog.StartThread -> StartThreadDialog(
                workspace = dialog.workspace,
                backends = backends,
                backendsLoading = backendsLoading,
                backendsError = backendsError,
                loadModels = loadModels,
                installOrUpdateBackend = installOrUpdateBackend,
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
    backends: List<SupervisorAgentBackend>,
    backendsLoading: Boolean,
    backendsError: String?,
    loadModels: suspend (String) -> List<SupervisorModelOption>,
    installOrUpdateBackend: suspend (SupervisorAgentBackend) -> Unit,
    busy: Boolean,
    error: String?,
    onClose: () -> Unit,
    onStartThread: (StartThreadDraft) -> Unit,
) {
    var title by rememberSaveable(workspace.id) { mutableStateOf("") }
    val selectableBackends = backends.filter { it.canStartSession }
    var provider by rememberSaveable(workspace.id, backends.map { it.provider }.joinToString(",")) {
        mutableStateOf(selectableBackends.firstOrNull { it.isDefault }?.provider ?: selectableBackends.firstOrNull()?.provider ?: backends.firstOrNull()?.provider ?: "codex")
    }
    var models by remember(provider) { mutableStateOf<List<SupervisorModelOption>>(emptyList()) }
    var modelsLoading by remember(provider) { mutableStateOf(false) }
    var modelsError by remember(provider) { mutableStateOf<String?>(null) }
    var model by rememberSaveable(workspace.id, provider) { mutableStateOf(DefaultStartThreadModel) }
    var reasoningEffort by rememberSaveable(workspace.id, provider, model) { mutableStateOf<String?>(null) }
    var runtimeBusyProvider by remember { mutableStateOf<String?>(null) }
    val dialogScope = rememberCoroutineScope()
    LaunchedEffect(provider, backends) {
        val backend = backends.firstOrNull { it.provider == provider }
        if (backend?.canStartSession != true) {
            models = emptyList()
            model = ""
            reasoningEffort = null
            modelsError = "Install this runtime before creating a thread."
            return@LaunchedEffect
        }
        modelsLoading = true
        modelsError = null
        val result = withContext(Dispatchers.IO) {
            runCatching { loadModels(provider) }
        }
        modelsLoading = false
        result
            .onSuccess { loaded ->
                models = loaded.filterNot { it.hidden }
                val selectedModel = models.firstOrNull { it.model == model }
                    ?: models.firstOrNull { it.isDefault }
                    ?: models.firstOrNull()
                if (selectedModel != null) {
                    model = selectedModel.model
                    reasoningEffort = selectedModel.defaultReasoningEffort
                        ?: selectedModel.supportedReasoningEfforts.firstOrNull()?.reasoningEffort
                }
            }
            .onFailure { throwable ->
                models = emptyList()
                modelsError = throwable.message ?: "Model options failed."
            }
    }
    val selectedModel = models.firstOrNull { it.model == model }
    val reasoningOptions = selectedModel?.supportedReasoningEfforts.orEmpty()
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
                    primaryEnabled = !busy && normalizedModel.isNotBlank() && backends.firstOrNull { it.provider == provider }?.canStartSession == true,
                onCancel = onClose,
                onPrimary = {
                    onStartThread(
                        StartThreadDraft(
                            title = normalizedTitle.takeIf { it.isNotBlank() },
                            provider = provider,
                            model = normalizedModel,
                            reasoningEffort = reasoningEffort,
                        ),
                    )
                },
            )
        },
    ) {
        BackendSelector(
            backends = backends,
            loading = backendsLoading,
            selected = provider,
            enabled = !busy && runtimeBusyProvider == null,
            busyProvider = runtimeBusyProvider,
            onSelected = { provider = it },
            onInstallOrUpdate = { backend ->
                runtimeBusyProvider = backend.provider
                modelsError = null
                dialogScope.launch {
                    val result = withContext(Dispatchers.IO) {
                        runCatching { installOrUpdateBackend(backend) }
                    }
                    runtimeBusyProvider = null
                    result
                        .onSuccess {
                            provider = backend.provider
                        }
                        .onFailure { throwable ->
                            modelsError = throwable.message ?: "Runtime install/update failed."
                        }
                }
            },
        )
        backendsError?.let { message ->
            Text(
                text = message,
                color = ThreadColors.Warning,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        if (models.isNotEmpty()) {
            OptionSelector(
                label = "Model",
                options = models.map { option -> option.model to option.displayName.ifBlank { option.model } },
                selected = model,
                enabled = !busy && !modelsLoading,
                onSelected = { nextModel ->
                    model = nextModel
                    val next = models.firstOrNull { it.model == nextModel }
                    reasoningEffort = next?.defaultReasoningEffort
                        ?: next?.supportedReasoningEfforts?.firstOrNull()?.reasoningEffort
                },
            )
        } else {
            Text(
                text = if (modelsLoading) "Loading model list..." else "No models available for this backend.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        if (reasoningOptions.isNotEmpty()) {
            OptionSelector(
                label = "Reasoning",
                options = reasoningOptions.map { option ->
                    option.reasoningEffort to option.reasoningEffort.uppercase()
                },
                selected = reasoningEffort ?: reasoningOptions.first().reasoningEffort,
                enabled = !busy,
                onSelected = { reasoningEffort = it },
            )
        }
        OutlinedTextField(
            value = title,
            onValueChange = { title = it },
            enabled = !busy,
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = "New thread title" },
            label = { Text("Thread title") },
            singleLine = true,
            colors = workspaceTextFieldColors(),
        )
        modelsError?.let { message ->
            Text(
                text = message,
                color = ThreadColors.Warning,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        Text(
            text = "Starts a ${provider} thread in ${workspace.absPath}.",
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
private fun ImportThreadDialog(
    backends: List<SupervisorAgentBackend>,
    busy: Boolean,
    error: String?,
    onClose: () -> Unit,
    onImportThread: (String, String) -> Unit,
) {
    val enabledBackends = backends.filter { it.enabled }.ifEmpty { backends }
    var provider by rememberSaveable(backends.map { it.provider }.joinToString(",")) {
        mutableStateOf(enabledBackends.firstOrNull { it.isDefault }?.provider ?: enabledBackends.firstOrNull()?.provider ?: "codex")
    }
    var sessionId by rememberSaveable { mutableStateOf("") }
    val normalizedSessionId = sessionId.trim()
    GraphDialogFrame(
        title = "Import Session",
        subtitle = "Existing backend session",
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = if (busy) "Importing" else "Import",
                primaryTone = GraphDialogActionTone.Success,
                primaryEnabled = !busy && normalizedSessionId.isNotBlank(),
                onCancel = onClose,
                onPrimary = { onImportThread(provider, normalizedSessionId) },
            )
        },
    ) {
        OptionSelector(
            label = "Backend",
            options = enabledBackends.map { backend ->
                backend.provider to (backend.displayName.ifBlank { backend.provider } + if (backend.enabled) "" else " (not ready)")
            }.ifEmpty { listOf("codex" to "Codex") },
            selected = provider,
            enabled = !busy,
            onSelected = { provider = it },
        )
        OutlinedTextField(
            value = sessionId,
            onValueChange = { sessionId = it },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Session ID") },
            placeholder = { Text("019d6fb7-7033-7a30-a2c7-74d0919e87d4") },
            singleLine = true,
            colors = workspaceTextFieldColors(),
        )
        Text(
            text = "The selected backend must support local session import on this supervisor.",
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
@OptIn(ExperimentalLayoutApi::class)
private fun BackendSelector(
    backends: List<SupervisorAgentBackend>,
    loading: Boolean,
    selected: String,
    enabled: Boolean,
    busyProvider: String?,
    onSelected: (String) -> Unit,
    onInstallOrUpdate: (SupervisorAgentBackend) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(
            text = "Backend",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (loading && backends.isEmpty()) {
                Text(
                    text = "Loading backend list...",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                )
            } else if (backends.isEmpty()) {
                Text(
                    text = "No agent providers are configured.",
                    color = ThreadColors.Warning,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            backends.forEach { backend ->
                val active = backend.provider == selected
                val canStart = backend.canStartSession
                val action = backend.runtimeActionLabel
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics { contentDescription = "New thread backend ${backend.provider}" }
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (active) ThreadColors.Surface else ThreadColors.SurfaceStrong)
                        .border(
                            1.dp,
                            if (active) ThreadColors.Primary else ThreadColors.Border,
                            RoundedCornerShape(14.dp),
                        )
                        .then(if (enabled && canStart) Modifier.clickable { onSelected(backend.provider) } else Modifier)
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(
                            text = backend.displayName.ifBlank { backend.provider },
                            color = if (canStart) ThreadColors.Foreground else ThreadColors.ForegroundMuted,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = if (canStart) {
                                backend.installedVersion ?: backend.statusState.ifBlank { backend.provider }
                            } else {
                                backend.lastError ?: backend.statusDetail ?: "Runtime is not available."
                            },
                            color = if (canStart) ThreadColors.ForegroundMuted else ThreadColors.Warning,
                            style = MaterialTheme.typography.labelSmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    if (action != null) {
                        GraphButton(
                            label = if (busyProvider == backend.provider || backend.busy) "${action}ing" else action,
                            enabled = enabled && busyProvider == null && !backend.busy,
                            size = GraphButtonSize.Small,
                            variant = GraphButtonVariant.Outline,
                            onClick = { onInstallOrUpdate(backend) },
                        )
                    }
                    if (active) {
                        Text(
                            text = "✓",
                            color = ThreadColors.Primary,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
            }
        }
    }
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
private fun OptionSelector(
    label: String,
    options: List<Pair<String, String>>,
    selected: String,
    enabled: Boolean,
    onSelected: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(7.dp)) {
        Text(
            text = label,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            options.forEach { (value, title) ->
                val active = value == selected
                Box(
                    modifier = Modifier
                        .semantics { contentDescription = "New thread ${label.lowercase()} $value" }
                        .clip(RoundedCornerShape(999.dp))
                        .background(if (active) ThreadColors.Primary else ThreadColors.Surface)
                        .border(
                            1.dp,
                            if (active) ThreadColors.Primary else ThreadColors.Border,
                            RoundedCornerShape(999.dp),
                        )
                        .then(if (enabled) Modifier.clickable { onSelected(value) } else Modifier)
                        .padding(horizontal = 11.dp, vertical = 7.dp),
                ) {
                    Text(
                        text = title,
                        color = if (active) ThreadColors.PrimaryForeground else ThreadColors.ForegroundSoft,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
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
    var confirmed by rememberSaveable(workspace.id) { mutableStateOf(false) }
    val canDelete = confirmed && !busy
    GraphDialogFrame(
        title = "Delete Workspace",
        subtitle = workspace.label.ifBlank { workspace.absPath },
        onClose = onClose,
        footer = {
            GraphDialogFooter(
                primaryLabel = if (busy) "Deleting" else "Delete",
                primaryTone = GraphDialogActionTone.Danger,
                primaryEnabled = canDelete,
                onCancel = onClose,
                onPrimary = onDeleteWorkspace,
            )
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
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
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(ThreadColors.Surface)
                    .border(
                        1.dp,
                        if (confirmed) ThreadColors.Danger.copy(alpha = 0.42f) else ThreadColors.Border,
                        RoundedCornerShape(12.dp),
                    )
                    .clickable(enabled = !busy) { confirmed = !confirmed }
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                GraphSelectionGlyph(
                    selected = confirmed,
                    tone = GraphSelectionTone.Warning,
                    contentDescription = if (confirmed) {
                        "Workspace delete confirmation selected"
                    } else {
                        "Workspace delete confirmation not selected"
                    },
                )
                Text(
                    text = "I understand this removes the workspace record and its related threads.",
                    modifier = Modifier.weight(1f),
                    color = if (confirmed) ThreadColors.Danger else ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
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

private enum class ThreadListFilter(val label: String) {
    All("All"),
    Running("Running"),
    NeedsAttention("Attention"),
    Recent("Recent"),
    Completed("Done"),
    Failed("Failed");

    fun matches(thread: SupervisorThreadSummary): Boolean {
        return when (this) {
            All -> true
            Running -> thread.status.normalizedThreadStatus() == "running"
            NeedsAttention -> thread.needsAttention()
            Recent -> !thread.needsAttention() && thread.status.normalizedThreadStatus() !in setOf("running", "completed", "failed")
            Completed -> thread.status.normalizedThreadStatus() == "completed"
            Failed -> thread.status.normalizedThreadStatus() == "failed"
        }
    }
}

private enum class ThreadListSort(val label: String) {
    Updated("Updated"),
    Status("Status"),
    Title("Title");
}

private data class ThreadGroup(
    val key: String,
    val title: String,
    val threads: List<SupervisorThreadSummary>,
)

private fun buildFilteredThreads(
    threads: List<SupervisorThreadSummary>,
    query: String,
    filter: ThreadListFilter,
    sort: ThreadListSort,
): List<SupervisorThreadSummary> {
    val normalizedQuery = query.trim().lowercase()
    return threads
        .asSequence()
        .filter(filter::matches)
        .filter { thread ->
            normalizedQuery.isBlank() || listOfNotNull(
                thread.title,
                thread.summaryText,
                thread.status,
                thread.model,
                thread.workspaceId,
            ).any { value -> value.lowercase().contains(normalizedQuery) }
        }
        .toList()
        .let { filtered ->
            when (sort) {
                ThreadListSort.Updated -> filtered.sortedByDescending { it.updatedAt }
                ThreadListSort.Status -> filtered.sortedWith(
                    compareBy<SupervisorThreadSummary> { it.threadGroupRank() }
                        .thenByDescending { it.updatedAt },
                )
                ThreadListSort.Title -> filtered.sortedWith(
                    compareBy<SupervisorThreadSummary> { it.title.lowercase() }
                        .thenByDescending { it.updatedAt },
                )
            }
        }
}

private fun groupThreads(threads: List<SupervisorThreadSummary>): List<ThreadGroup> {
    return threads
        .groupBy { it.threadGroupKey() }
        .toList()
        .sortedBy { (key, _) -> threadGroupRank(key) }
        .map { (key, items) ->
            ThreadGroup(
                key = key,
                title = threadGroupTitle(key),
                threads = items,
            )
        }
}

private fun SupervisorThreadSummary.threadGroupKey(): String {
    val status = this.status.normalizedThreadStatus()
    return when {
        status == "running" -> "running"
        needsAttention() -> "attention"
        status == "failed" -> "failed"
        status == "completed" -> "completed"
        else -> "recent"
    }
}

private fun SupervisorThreadSummary.threadGroupRank(): Int = threadGroupRank(threadGroupKey())

private fun threadGroupRank(key: String): Int {
    return when (key) {
        "running" -> 0
        "attention" -> 1
        "failed" -> 2
        "recent" -> 3
        "completed" -> 4
        else -> 5
    }
}

private fun threadGroupTitle(key: String): String {
    return when (key) {
        "running" -> "Running"
        "attention" -> "Needs Attention"
        "failed" -> "Failed"
        "completed" -> "Completed"
        else -> "Recent"
    }
}

private fun SupervisorThreadSummary.needsAttention(): Boolean {
    val status = this.status.normalizedThreadStatus()
    val summary = summaryText.orEmpty().lowercase()
    return status in setOf("waiting", "blocked", "needs-input", "needs_attention", "requires-action", "requires_action") ||
        summary.contains("permission") ||
        summary.contains("confirmation") ||
        summary.contains("input required")
}

private fun String.normalizedThreadStatus(): String = trim().lowercase()

private fun String.threadStatusLabel(): String {
    return when (normalizedThreadStatus()) {
        "running" -> "running"
        "completed" -> "done"
        "failed" -> "failed"
        "waiting", "blocked", "needs-input", "needs_attention", "requires-action", "requires_action" -> "attention"
        else -> trim().ifBlank { "thread" }
    }
}

private const val DefaultStartThreadModel = "gpt-5"
