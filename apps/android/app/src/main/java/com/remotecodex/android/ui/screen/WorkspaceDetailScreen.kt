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
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.ui.components.GraphActionIcon
import com.remotecodex.android.ui.components.GraphBadge
import com.remotecodex.android.ui.components.GraphBadgeVariant
import com.remotecodex.android.ui.components.GraphButton
import com.remotecodex.android.ui.components.GraphButtonSize
import com.remotecodex.android.ui.components.GraphButtonVariant
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun WorkspaceDetailScreen(
    workspaceId: String,
    supervisorConnection: SupervisorConnectionConfig,
    homeSnapshot: SupervisorHomeSnapshot?,
    homeSnapshotLoading: Boolean,
    homeSnapshotError: String?,
    onBackToHome: () -> Unit,
    onOpenThread: (String) -> Unit,
    onRefreshHomeSnapshot: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val client = remember(supervisorConnection) { SupervisorApiClient(supervisorConnection) }
    val coroutineScope = rememberCoroutineScope()
    var actionBusy by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var startExpanded by rememberSaveable(workspaceId) { mutableStateOf(false) }
    var titleDraft by rememberSaveable(workspaceId) { mutableStateOf("") }
    var modelDraft by rememberSaveable(workspaceId) { mutableStateOf(DefaultWorkspaceThreadModel) }

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
                onBack = onBackToHome,
                onRefresh = {
                    onRefreshHomeSnapshot()
                },
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
                threadCount = workspaceThreads.size,
                runningCount = workspaceThreads.count { it.status == "running" },
            )
        }

        item {
            FlowRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                GraphButton(
                    label = if (actionBusy == "open") "Opening..." else "Mark opened",
                    icon = GraphActionIcon.Open,
                    enabled = actionBusy == null,
                    variant = GraphButtonVariant.Secondary,
                    size = GraphButtonSize.Small,
                    contentDescription = "Mark workspace ${workspace.label} opened",
                    onClick = {
                        runAction("open") { client.openWorkspace(workspace.id) }
                    },
                )
                GraphButton(
                    label = if (workspace.isFavorite) "Unstar" else "Star",
                    enabled = actionBusy == null,
                    variant = GraphButtonVariant.Outline,
                    size = GraphButtonSize.Small,
                    contentDescription = "Toggle favorite workspace ${workspace.label}",
                    onClick = {
                        runAction("favorite") {
                            client.setWorkspaceFavorite(workspace.id, !workspace.isFavorite)
                        }
                    },
                )
                GraphButton(
                    label = "New Thread",
                    enabled = actionBusy == null,
                    variant = GraphButtonVariant.Default,
                    size = GraphButtonSize.Small,
                    contentDescription = "Start thread in workspace ${workspace.label}",
                    onClick = { startExpanded = !startExpanded },
                )
            }
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

        if (startExpanded) {
            item {
                WorkspaceStartThreadPanel(
                    workspace = workspace,
                    title = titleDraft,
                    model = modelDraft,
                    busy = actionBusy == "start",
                    onTitleChange = { titleDraft = it },
                    onModelChange = { modelDraft = it },
                    onCancel = { startExpanded = false },
                    onStart = {
                        runAction("start") {
                            val thread = client.startThread(
                                StartSupervisorThreadRequest(
                                    workspaceId = workspace.id,
                                    title = titleDraft.trim().takeIf { it.isNotBlank() },
                                    model = modelDraft.trim().ifBlank { DefaultWorkspaceThreadModel },
                                    approvalMode = "yolo",
                                ),
                            )
                            withContext(Dispatchers.Main) {
                                startExpanded = false
                                titleDraft = ""
                                onOpenThread(thread.id)
                            }
                        }
                    },
                )
            }
        }

        item {
            WorkspaceThreadsSection(
                threads = workspaceThreads,
                loading = homeSnapshotLoading,
                onOpenThread = onOpenThread,
            )
        }
    }
}

@Composable
private fun WorkspaceDetailHeader(
    workspace: SupervisorWorkspaceSummary?,
    workspaceId: String,
    loading: Boolean,
    error: String?,
    onBack: () -> Unit,
    onRefresh: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = "Back",
            modifier = Modifier
                .clip(RoundedCornerShape(9.dp))
                .background(ThreadColors.Surface)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(9.dp))
                .clickable(onClick = onBack)
                .semantics { contentDescription = "Back to home" }
                .padding(horizontal = 12.dp, vertical = 9.dp),
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
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
        GraphButton(
            label = "Refresh",
            enabled = !loading,
            variant = GraphButtonVariant.Secondary,
            size = GraphButtonSize.Small,
            contentDescription = "Refresh workspace detail",
            onClick = onRefresh,
        )
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

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WorkspaceStatusPanel(
    workspace: SupervisorWorkspaceSummary,
    threadCount: Int,
    runningCount: Int,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            WorkspaceInitial(label = workspace.label.ifBlank { workspace.absPath })
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
                    fontFamily = FontFamily.Monospace,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (workspace.isFavorite) {
                GraphBadge(label = "Favorite", variant = GraphBadgeVariant.Outline)
            }
        }
        FlowRow(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            GraphBadge(label = "$threadCount threads", variant = GraphBadgeVariant.Secondary)
            GraphBadge(label = "$runningCount running", variant = GraphBadgeVariant.Secondary)
            GraphBadge(
                label = workspace.lastOpenedAt?.let { "Opened" } ?: "Not opened",
                variant = GraphBadgeVariant.Secondary,
            )
        }
    }
}

@Composable
private fun WorkspaceStartThreadPanel(
    workspace: SupervisorWorkspaceSummary,
    title: String,
    model: String,
    busy: Boolean,
    onTitleChange: (String) -> Unit,
    onModelChange: (String) -> Unit,
    onCancel: () -> Unit,
    onStart: () -> Unit,
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
        Text(
            text = "New thread",
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
        )
        OutlinedTextField(
            value = title,
            onValueChange = onTitleChange,
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = "Workspace thread title input" },
            label = { Text("Thread title") },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodySmall.copy(color = ThreadColors.Foreground),
            colors = workspaceDetailTextFieldColors(),
        )
        OutlinedTextField(
            value = model,
            onValueChange = onModelChange,
            modifier = Modifier
                .fillMaxWidth()
                .semantics { contentDescription = "Workspace thread model input" },
            label = { Text("Model") },
            singleLine = true,
            textStyle = MaterialTheme.typography.bodySmall.copy(
                color = ThreadColors.Foreground,
                fontFamily = FontFamily.Monospace,
            ),
            colors = workspaceDetailTextFieldColors(),
        )
        Text(
            text = "Starts in ${workspace.absPath}.",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
        ) {
            GraphButton(
                label = "Cancel",
                enabled = !busy,
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Small,
                contentDescription = "Cancel workspace thread",
                onClick = onCancel,
            )
            GraphButton(
                label = if (busy) "Starting..." else "Start",
                enabled = !busy && model.isNotBlank(),
                variant = GraphButtonVariant.Default,
                size = GraphButtonSize.Small,
                contentDescription = "Start workspace thread",
                onClick = onStart,
            )
        }
    }
}

@Composable
private fun WorkspaceThreadsSection(
    threads: List<SupervisorThreadSummary>,
    loading: Boolean,
    onOpenThread: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        WorkspaceSectionHeader(
            title = "Threads",
            detail = if (loading) "Refreshing..." else "${threads.size} in this workspace",
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
