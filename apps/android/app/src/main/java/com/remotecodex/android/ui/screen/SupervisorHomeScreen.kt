package com.remotecodex.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.components.AppShellSettingsPanel
import com.remotecodex.android.ui.components.GraphActionIcon
import com.remotecodex.android.ui.components.GraphBadge
import com.remotecodex.android.ui.components.GraphBadgeVariant
import com.remotecodex.android.ui.components.GraphButton
import com.remotecodex.android.ui.components.GraphButtonSize
import com.remotecodex.android.ui.components.GraphButtonVariant
import com.remotecodex.android.ui.model.AppShellNavigationItemPreview
import com.remotecodex.android.ui.model.ShellProcessPreview
import com.remotecodex.android.ui.sample.ThreadPreviewSample
import com.remotecodex.android.ui.theme.ThreadColors

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
    onChangeConnection: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val appShell = ThreadPreviewSample.appShell
    val detail = ThreadPreviewSample.detail
    var settingsOpen by remember { mutableStateOf(false) }
    var selectedDestination by remember { mutableStateOf(HomeDestination.Workspaces) }
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
                    appShell.navigationItems.forEach { item ->
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
                        HomeSectionTitle(title = "Workspaces", detail = "Trusted project roots")
                    }
                    val workspaces = homeSnapshot?.workspaces.orEmpty()
                    if (workspaces.isEmpty()) {
                        item {
                            EmptyHomeRow(
                                title = if (homeSnapshotLoading) "Loading workspaces" else "No workspaces loaded",
                                detail = homeSnapshotError ?: "Workspace rows will appear here after `/api/workspaces` returns data.",
                                actionLabel = "Thread Preview",
                                onClick = { onOpenThread(null) },
                            )
                        }
                    } else {
                        items(workspaces.take(8), key = { it.id }) { workspace ->
                            WorkspaceSummaryRow(workspace = workspace)
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
                onThemeModeSelected = onThemeModeSelected,
                onChangeConnection = onChangeConnection,
                onClose = { settingsOpen = false },
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
private fun HomeSectionTitle(title: String, detail: String) {
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
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
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

@Composable
private fun WorkspaceSummaryRow(workspace: SupervisorWorkspaceSummary) {
    SummaryRowFrame(
        title = workspace.label.ifBlank { workspace.absPath },
        detail = workspace.absPath,
        meta = if (workspace.isFavorite) "favorite" else workspace.lastOpenedAt ?: "workspace",
        contentDescription = "Workspace ${workspace.label}",
        onClick = {},
    )
}

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
