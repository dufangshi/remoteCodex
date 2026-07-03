package com.remotecodex.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import com.remotecodex.android.api.StartSupervisorThreadRequest
import com.remotecodex.android.api.SupervisorAgentBackend
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.SupervisorModelOption
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.api.canStartSession
import com.remotecodex.android.api.runtimeActionLabel
import com.remotecodex.android.ui.components.GraphButton
import com.remotecodex.android.ui.components.GraphButtonSize
import com.remotecodex.android.ui.components.GraphButtonVariant
import com.remotecodex.android.ui.components.GraphDialogActionTone
import com.remotecodex.android.ui.components.GraphDialogFrame
import com.remotecodex.android.ui.components.GraphDialogFooter
import com.remotecodex.android.ui.components.GraphDialogOverlay
import com.remotecodex.android.ui.components.GraphActionIcon
import com.remotecodex.android.ui.components.GraphFloatingIconButton
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun WorkspaceDetailScreen(
    workspaceId: String,
    supervisorConnection: SupervisorConnectionConfig,
    homeSnapshot: SupervisorHomeSnapshot?,
    homeSnapshotLoading: Boolean,
    homeSnapshotError: String?,
    onBackToHome: () -> Unit,
    onOpenDevices: () -> Unit,
    onOpenThread: (String) -> Unit,
    onRefreshHomeSnapshot: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val client = remember(supervisorConnection) { SupervisorApiClient(supervisorConnection) }
    val coroutineScope = rememberCoroutineScope()
    var actionBusy by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var startDialogOpen by rememberSaveable(workspaceId) { mutableStateOf(false) }
    var workspaceMenuOpen by remember { mutableStateOf(false) }
    var agentBackends by remember(supervisorConnection) { mutableStateOf<List<SupervisorAgentBackend>>(emptyList()) }
    var agentBackendsLoading by remember(supervisorConnection) { mutableStateOf(false) }
    var agentBackendsError by remember(supervisorConnection) { mutableStateOf<String?>(null) }

    LaunchedEffect(supervisorConnection) {
        agentBackendsLoading = true
        agentBackendsError = null
        val result = withContext(Dispatchers.IO) {
            runCatching { client.listAgentBackends() }
        }
        agentBackendsLoading = false
        result
            .onSuccess { loaded -> agentBackends = loaded }
            .onFailure { error ->
                agentBackends = emptyList()
                agentBackendsError = error.message ?: "Backend list failed."
            }
    }

    fun runAction(label: String, action: suspend () -> Unit) {
        actionBusy = label
        actionError = null
        coroutineScope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching { action() }
            }
            actionBusy = null
            result
                .onSuccess { onRefreshHomeSnapshot() }
                .onFailure { error -> actionError = error.message ?: "$label failed." }
        }
    }

    val workspace = homeSnapshot?.workspaces?.firstOrNull { it.id == workspaceId }
    val workspaceThreads = homeSnapshot?.threads.orEmpty()
        .filter { it.workspaceId == workspaceId }
        .sortedWith(
            compareByDescending<SupervisorThreadSummary> { it.status == "running" }
                .thenByDescending { it.updatedAt },
        )

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(ThreadColors.Background)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            WorkspaceDetailHeader(
                workspace = workspace,
                workspaceId = workspaceId,
                loading = homeSnapshotLoading,
                error = homeSnapshotError,
                onOpenMenu = { workspaceMenuOpen = true },
            )
        }

        if (workspace == null) {
            item {
                WorkspaceDetailEmptyState(
                    loading = homeSnapshotLoading,
                    error = homeSnapshotError,
                    onRefresh = onRefreshHomeSnapshot,
                )
            }
            return@LazyColumn
        }

        item {
            WorkspaceStatusPanel(
                workspace = workspace,
            )
        }

        item {
            actionError?.let { text ->
                Text(
                    text = text,
                    color = ThreadColors.Danger,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }

        item {
            WorkspaceThreadsSection(
                threads = workspaceThreads,
                loading = homeSnapshotLoading,
                onOpenThread = onOpenThread,
                onStartThread = {
                    actionError = null
                    startDialogOpen = true
                },
            )
        }
    }

    if (workspaceMenuOpen) {
        WorkspaceDetailMenuDialog(
            workspace = workspace,
            loading = homeSnapshotLoading,
            onClose = { workspaceMenuOpen = false },
            onBack = {
                workspaceMenuOpen = false
                onBackToHome()
            },
            onRefresh = {
                workspaceMenuOpen = false
                onRefreshHomeSnapshot()
            },
            onOpenDevices = {
                workspaceMenuOpen = false
                onOpenDevices()
            },
        )
    }

    if (startDialogOpen && workspace != null) {
        WorkspaceStartThreadDialog(
            workspace = workspace,
            backends = agentBackends,
            backendsLoading = agentBackendsLoading,
            backendsError = agentBackendsError,
            loadModels = { provider -> client.listAgentModels(provider) },
            installOrUpdateBackend = { backend ->
                val action = if (backend.installed) "update" else "install"
                client.installOrUpdateAgentBackend(backend.provider, action)
                agentBackends = client.listAgentBackends()
            },
            busy = actionBusy == "start",
            error = actionError,
            onClose = {
                if (actionBusy == null) {
                    startDialogOpen = false
                    actionError = null
                }
            },
            onStartThread = { draft ->
                runAction("start") {
                    val thread = client.startThread(
                        StartSupervisorThreadRequest(
                            workspaceId = workspace.id,
                            title = draft.title?.takeIf { it.isNotBlank() },
                            provider = draft.provider,
                            model = draft.model.trim().ifBlank { DefaultWorkspaceThreadModel },
                            reasoningEffort = draft.reasoningEffort,
                            approvalMode = "yolo",
                        ),
                    )
                    withContext(Dispatchers.Main) {
                        startDialogOpen = false
                        onOpenThread(thread.id)
                    }
                }
            },
        )
    }
}

@Composable
private fun WorkspaceDetailHeader(
    workspace: SupervisorWorkspaceSummary?,
    workspaceId: String,
    loading: Boolean,
    error: String?,
    onOpenMenu: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = workspace?.label?.ifBlank { workspace.absPath } ?: "Workspace",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = when {
                    error != null -> error
                    loading -> "Refreshing workspace snapshot..."
                    workspace != null -> workspace.absPath
                    else -> "Workspace id $workspaceId"
                },
                color = if (error == null) ThreadColors.ForegroundMuted else ThreadColors.Danger,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        GraphFloatingIconButton(
            icon = GraphActionIcon.Menu,
            contentDescription = "Open workspace menu",
            onClick = onOpenMenu,
        )
    }
}

@Composable
private fun WorkspaceDetailMenuDialog(
    workspace: SupervisorWorkspaceSummary?,
    loading: Boolean,
    onClose: () -> Unit,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
    onOpenDevices: () -> Unit,
) {
    GraphDialogOverlay(onDismiss = onClose) {
        GraphDialogFrame(
            title = "Actions",
            subtitle = workspace?.label?.ifBlank { workspace.absPath } ?: "Workspace actions",
            onClose = onClose,
            footer = {},
            showFooter = false,
        ) {
            GraphButton(
                label = "Home",
                modifier = Modifier.fillMaxWidth(),
                icon = GraphActionIcon.Home,
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Default,
                contentDescription = "Back to home",
                onClick = onBack,
            )
            GraphButton(
                label = if (loading) "Refreshing..." else "Refresh",
                modifier = Modifier.fillMaxWidth(),
                icon = GraphActionIcon.Refresh,
                enabled = !loading,
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Default,
                contentDescription = "Refresh workspace detail",
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

@Composable
private fun WorkspaceDetailEmptyState(
    loading: Boolean,
    error: String?,
    onRefresh: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (error == null) ThreadColors.Surface else ThreadColors.DangerSoft)
            .border(1.dp, if (error == null) ThreadColors.Border else ThreadColors.Danger, RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = if (loading) "Loading workspace" else "Workspace unavailable",
            color = if (error == null) ThreadColors.Foreground else ThreadColors.Danger,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = error ?: "This workspace is not present in the current supervisor snapshot.",
            color = if (error == null) ThreadColors.ForegroundMuted else ThreadColors.Danger,
            style = MaterialTheme.typography.labelSmall,
        )
        GraphButton(
            label = "Refresh",
            variant = GraphButtonVariant.Secondary,
            size = GraphButtonSize.Small,
            contentDescription = "Refresh workspace snapshot",
            onClick = onRefresh,
        )
    }
}

@Composable
private fun WorkspaceStatusPanel(
    workspace: SupervisorWorkspaceSummary,
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
        Text(
            text = "Path",
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = workspace.absPath,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun WorkspaceStartThreadDialog(
    workspace: SupervisorWorkspaceSummary,
    backends: List<SupervisorAgentBackend>,
    backendsLoading: Boolean,
    backendsError: String?,
    loadModels: suspend (String) -> List<SupervisorModelOption>,
    installOrUpdateBackend: suspend (SupervisorAgentBackend) -> Unit,
    busy: Boolean,
    error: String?,
    onClose: () -> Unit,
    onStartThread: (WorkspaceStartThreadDraft) -> Unit,
) {
    var title by rememberSaveable(workspace.id) { mutableStateOf("") }
    val selectableBackends = backends.filter { it.canStartSession }
    var provider by rememberSaveable(workspace.id, backends.map { it.provider }.joinToString(",")) {
        mutableStateOf(selectableBackends.firstOrNull { it.isDefault }?.provider ?: selectableBackends.firstOrNull()?.provider ?: backends.firstOrNull()?.provider ?: "codex")
    }
    var models by remember(provider) { mutableStateOf<List<SupervisorModelOption>>(emptyList()) }
    var modelsLoading by remember(provider) { mutableStateOf(false) }
    var modelsError by remember(provider) { mutableStateOf<String?>(null) }
    var model by rememberSaveable(workspace.id, provider) { mutableStateOf(DefaultWorkspaceThreadModel) }
    var reasoningEffort by rememberSaveable(workspace.id, provider, model) { mutableStateOf<String?>(null) }
    var runtimeBusyProvider by remember { mutableStateOf<String?>(null) }
    val dialogScope = rememberCoroutineScope()
    LaunchedEffect(provider) {
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
    GraphDialogOverlay(onDismiss = onClose) {
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
                            WorkspaceStartThreadDraft(
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
            WorkspaceBackendSelector(
                backends = backends,
                selected = provider,
                enabled = !busy && !backendsLoading && runtimeBusyProvider == null,
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
                                if (provider == backend.provider) {
                                    provider = backend.provider
                                }
                            }
                            .onFailure { throwable ->
                                modelsError = throwable.message ?: "Runtime install/update failed."
                            }
                    }
                },
            )
            if (models.isNotEmpty()) {
                WorkspaceOptionSelector(
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
                WorkspaceOptionSelector(
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
                    .semantics { contentDescription = "Workspace thread title input" },
                label = { Text("Thread title") },
                singleLine = true,
                textStyle = MaterialTheme.typography.bodySmall.copy(color = ThreadColors.Foreground),
                colors = workspaceDetailTextFieldColors(),
            )
            listOfNotNull(backendsError, modelsError).forEach { message ->
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
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
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
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
private fun WorkspaceBackendSelector(
    backends: List<SupervisorAgentBackend>,
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
            backends.ifEmpty {
                listOf(
                    SupervisorAgentBackend(
                        provider = "codex",
                        displayName = "Codex",
                        description = "",
                        enabled = true,
                        isDefault = true,
                        statusState = "ready",
                        statusDetail = null,
                        installed = true,
                        installedVersion = null,
                        latestVersion = null,
                        installAvailable = false,
                        updateAvailable = false,
                        busy = false,
                        lastError = null,
                        configArchives = false,
                        buildRestart = false,
                    ),
                )
            }.forEach { backend ->
                val active = backend.provider == selected
                val canStart = backend.canStartSession
                val action = backend.runtimeActionLabel
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
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
private fun WorkspaceOptionSelector(
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
                        fontWeight = if (active) FontWeight.Bold else FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

private data class WorkspaceStartThreadDraft(
    val title: String?,
    val provider: String,
    val model: String,
    val reasoningEffort: String?,
)

@Composable
private fun WorkspaceThreadsSection(
    threads: List<SupervisorThreadSummary>,
    loading: Boolean,
    onOpenThread: (String) -> Unit,
    onStartThread: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        WorkspaceSectionHeader(
            title = "Threads",
            detail = if (loading) "Refreshing..." else "${threads.size} in this workspace",
            actionLabel = "New",
            onAction = onStartThread,
        )
        if (threads.isEmpty()) {
            WorkspaceInfoRow(
                title = if (loading) "Loading threads" else "No workspace threads",
                detail = "Start a thread from this workspace to keep follow-up work scoped to the project root.",
                meta = "thread",
                contentDescription = "Workspace threads empty",
            )
        } else {
            threads.forEach { thread ->
                WorkspaceInfoRow(
                    title = thread.title.ifBlank { "Untitled thread" },
                    detail = thread.summaryText ?: "Updated ${thread.updatedAt}",
                    meta = listOfNotNull(thread.status, thread.model).joinToString(" / "),
                    contentDescription = "Open workspace thread ${thread.title}",
                    onClick = { onOpenThread(thread.id) },
                )
            }
        }
    }
}

@Composable
private fun WorkspaceSectionHeader(
    title: String,
    detail: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
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
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (actionLabel != null && onAction != null) {
            GraphButton(
                label = actionLabel,
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Small,
                contentDescription = "$actionLabel workspace section",
                onClick = onAction,
            )
        }
    }
}

@Composable
private fun WorkspaceInfoRow(
    title: String,
    detail: String,
    meta: String,
    contentDescription: String,
    danger: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(13.dp))
            .background(if (danger) ThreadColors.DangerSoft else ThreadColors.Surface)
            .border(1.dp, if (danger) ThreadColors.Danger else ThreadColors.Border, RoundedCornerShape(13.dp))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .semantics { this.contentDescription = contentDescription }
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        WorkspaceInitial(label = title)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                text = title,
                color = if (danger) ThreadColors.Danger else ThreadColors.Foreground,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = detail,
                color = if (danger) ThreadColors.Danger else ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            text = meta,
            color = if (danger) ThreadColors.Danger else ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun WorkspaceInitial(label: String) {
    Box(
        modifier = Modifier
            .clip(CircleShape)
            .background(ThreadColors.Panel)
            .padding(horizontal = 11.dp, vertical = 7.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label.trim().take(1).ifBlank { "W" }.uppercase(),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
private fun workspaceDetailTextFieldColors() = OutlinedTextFieldDefaults.colors(
    focusedTextColor = ThreadColors.Foreground,
    unfocusedTextColor = ThreadColors.Foreground,
    focusedContainerColor = ThreadColors.Surface,
    unfocusedContainerColor = ThreadColors.Surface,
    focusedBorderColor = ThreadColors.Primary.copy(alpha = 0.58f),
    unfocusedBorderColor = ThreadColors.Border,
    cursorColor = ThreadColors.Primary,
    focusedLabelColor = ThreadColors.ForegroundSoft,
    unfocusedLabelColor = ThreadColors.ForegroundMuted,
)

private const val DefaultWorkspaceThreadModel = "gpt-5"
