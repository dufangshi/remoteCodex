package com.remotecodex.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.remotecodex.android.ui.model.ToolCallPreview
import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.model.WorkspaceNodeKind
import com.remotecodex.android.ui.model.WorkspaceNodePreview
import com.remotecodex.android.ui.model.WorkspacePreview
import com.remotecodex.android.ui.presentation.WorkspaceGraphNodeRole
import com.remotecodex.android.ui.presentation.WorkspaceGraphNodeState
import com.remotecodex.android.ui.presentation.WorkspaceGraphRowState
import com.remotecodex.android.ui.presentation.WorkspaceGraphState
import com.remotecodex.android.ui.presentation.buildWorkspaceGraphState
import com.remotecodex.android.ui.presentation.toolStatusLabel
import com.remotecodex.android.ui.theme.ThreadColors
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

private const val WORKSPACE_TEXT_EDIT_MAX_BYTES = 250_000

@Composable
fun WorkspacePanel(
    workspace: WorkspacePreview,
    onSelectFile: ((String) -> Unit)? = null,
    onLoadMorePreview: (() -> Unit)? = null,
    onDownloadFile: ((String) -> Unit)? = null,
    onOpenRawFile: ((String) -> Unit)? = null,
    onCopyRawFile: ((String) -> Unit)? = null,
    onSaveFile: ((String, String) -> Unit)? = null,
    onUploadNote: (() -> Unit)? = null,
    saveBusy: Boolean = false,
    modifier: Modifier = Modifier,
) {
    var selectedTab by remember { mutableStateOf(WorkspaceTab.Explorer) }
    var garbageDialogOpen by remember { mutableStateOf(false) }
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ThreadColors.Workspace)
            .padding(8.dp),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            WorkspaceTabBar(
                selectedTab = selectedTab,
                onTabSelected = { selectedTab = it },
                modifier = Modifier.fillMaxWidth(),
            )
            when (selectedTab) {
                WorkspaceTab.Explorer -> WorkspaceBrowserSurface(
                    workspace = workspace,
                    onOpenGarbage = { garbageDialogOpen = true },
                    onSelectFile = onSelectFile,
                    onDownloadFile = onDownloadFile,
                    onUploadNote = onUploadNote,
                    onLoadMorePreview = onLoadMorePreview,
                    onOpenRawFile = onOpenRawFile,
                    onCopyRawFile = onCopyRawFile,
                    onSaveFile = onSaveFile,
                    saveBusy = saveBusy,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        if (garbageDialogOpen) {
            GraphEmptyGarbageDialogPreview(
                files = workspace.garbageFiles,
                onClose = { garbageDialogOpen = false },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

private fun edgeAnchor(
    center: Offset,
    toward: Offset,
    cardWidth: Float,
    cardHeight: Float,
): Offset {
    val dx = toward.x - center.x
    val dy = toward.y - center.y
    if (dx == 0f && dy == 0f) {
        return center
    }
    val halfWidth = cardWidth / 2f
    val halfHeight = cardHeight / 2f
    val scale = minOf(
        if (dx == 0f) Float.POSITIVE_INFINITY else halfWidth / kotlin.math.abs(dx),
        if (dy == 0f) Float.POSITIVE_INFINITY else halfHeight / kotlin.math.abs(dy),
    )
    return Offset(
        x = center.x + dx * scale,
        y = center.y + dy * scale,
    )
}

@Composable
private fun WorkspaceTabBar(
    selectedTab: WorkspaceTab,
    onTabSelected: (WorkspaceTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .horizontalScroll(rememberScrollState())
            .padding(5.dp),
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        WorkspaceTab.entries.forEach { tab ->
            WorkspaceTabButton(
                tab = tab,
                selected = selectedTab == tab,
                onClick = { onTabSelected(tab) },
            )
        }
    }
}

@Composable
private fun WorkspaceTabButton(
    tab: WorkspaceTab,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val background = if (selected) ThreadColors.Primary else ThreadColors.SurfaceStrong
    val foreground = if (selected) ThreadColors.PrimaryForeground else ThreadColors.ForegroundSoft
    Text(
        text = tab.label,
        modifier = Modifier
            .height(34.dp)
            .clip(RoundedCornerShape(7.dp))
            .background(background)
            .border(1.dp, if (selected) ThreadColors.Primary else ThreadColors.Border, RoundedCornerShape(7.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 11.dp, vertical = 8.dp),
        color = foreground,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

@Composable
private fun WorkspaceBrowserSurface(
    workspace: WorkspacePreview,
    onOpenGarbage: () -> Unit,
    onSelectFile: ((String) -> Unit)?,
    onLoadMorePreview: (() -> Unit)?,
    onDownloadFile: ((String) -> Unit)?,
    onUploadNote: (() -> Unit)?,
    onOpenRawFile: ((String) -> Unit)?,
    onCopyRawFile: ((String) -> Unit)?,
    onSaveFile: ((String, String) -> Unit)?,
    saveBusy: Boolean,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        WorkspaceSummaryStrip(workspace = workspace, modifier = Modifier.fillMaxWidth())
        GraphResizablePanelGroup(modifier = Modifier.weight(1f)) {
            GraphResizablePanel(weight = 1f) {
                WorkspaceExplorerCard(
                    workspace = workspace,
                    onOpenGarbage = onOpenGarbage,
                    onSelectFile = onSelectFile,
                    onDownloadFile = onDownloadFile,
                    onUploadNote = onUploadNote,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            GraphResizableHandle()
            GraphResizablePanel(weight = 1f) {
                WorkspaceViewerCard(
                    workspace = workspace,
                    onLoadMorePreview = onLoadMorePreview,
                    onDownloadFile = onDownloadFile,
                    onOpenRawFile = onOpenRawFile,
                    onCopyRawFile = onCopyRawFile,
                    onSaveFile = onSaveFile,
                    saveBusy = saveBusy,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun ToolUsageSurface(
    events: List<ToolCallPreview>,
    modifier: Modifier = Modifier,
) {
    if (events.isEmpty()) {
        ToolUsageEmptyState(modifier = modifier)
        return
    }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ToolUsageCard(events = events, modifier = Modifier.fillMaxWidth())
        ToolCallLogCard(events = events, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun WorkspaceSummaryStrip(
    workspace: WorkspacePreview,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = workspace.rootLabel,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = workspace.statusMessage ?: workspace.selectedFile.title,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        MetadataPill(label = "${workspace.nodes.size} nodes")
        MetadataPill(label = "${workspace.toolEvents.size} calls")
    }
}

@Composable
private fun WorkspaceExplorerCard(
    workspace: WorkspacePreview,
    onOpenGarbage: () -> Unit,
    onSelectFile: ((String) -> Unit)?,
    onDownloadFile: ((String) -> Unit)?,
    onUploadNote: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    var expandedPaths by remember(workspace.nodes) {
        mutableStateOf(emptySet<String>())
    }
    val visibleNodes = remember(workspace.nodes, expandedPaths) {
        workspace.nodes.filterVisibleWorkspaceNodes(expandedPaths)
    }

    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = workspace.title,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = workspace.rootLabel,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.weight(1f))
            ActionChip(label = "Upload", icon = WorkspaceActionIcon.Open, onClick = onUploadNote)
            ActionChip(label = "Garbage", icon = WorkspaceActionIcon.Trash, onClick = onOpenGarbage)
            ActionChip(label = "Refresh", icon = WorkspaceActionIcon.Refresh)
        }
        Text(
            text = "Explorer",
            modifier = Modifier.padding(start = 12.dp, end = 12.dp, top = 2.dp, bottom = 4.dp),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
        if (workspace.nodes.isEmpty()) {
            WorkspaceEmptyState(
                rootLabel = workspace.rootLabel,
                modifier = Modifier.padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
            )
        } else {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f, fill = false)
                    .verticalScroll(rememberScrollState()),
            ) {
                visibleNodes.forEach { node ->
                    val displayedNode = if (node.kind == WorkspaceNodeKind.Directory) {
                        node.copy(expanded = node.path in expandedPaths)
                    } else {
                        node
                    }
                    WorkspaceRow(
                        node = displayedNode,
                        onClick = when (node.kind) {
                            WorkspaceNodeKind.Directory -> {
                                {
                                    expandedPaths = if (node.path in expandedPaths) {
                                        expandedPaths - node.path
                                    } else {
                                        expandedPaths + node.path
                                    }
                                }
                            }
                            else -> node.path
                                .takeIf { it.isNotBlank() }
                                ?.let { path -> onSelectFile?.let { selectFile -> { selectFile(path) } } }
                        },
                        onDownload = onDownloadFile?.let { downloadFile -> { downloadFile(node.path) } },
                    )
                }
            }
        }
    }
}

private fun List<WorkspaceNodePreview>.filterVisibleWorkspaceNodes(
    expandedPaths: Set<String>,
): List<WorkspaceNodePreview> {
    val collapsedDepths = mutableListOf<Int>()
    return filter { node ->
        collapsedDepths.removeAll { it >= node.depth }
        val hidden = collapsedDepths.any { it < node.depth }
        if (!hidden && node.kind == WorkspaceNodeKind.Directory && node.path !in expandedPaths) {
            collapsedDepths += node.depth
        }
        !hidden
    }
}

@Composable
private fun ToolUsageEmptyState(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            modifier = Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(ThreadColors.Surface)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp)),
            contentAlignment = Alignment.Center,
        ) {
            WorkspaceActionGlyph(
                icon = WorkspaceActionIcon.Refresh,
                color = ThreadColors.ForegroundMuted,
                modifier = Modifier.size(17.dp),
            )
        }
        Text(
            text = "No tool calls yet",
            modifier = Modifier.padding(top = 12.dp),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Text(
            text = "Run the agent to see usage.",
            modifier = Modifier.padding(top = 3.dp),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.bodySmall,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        Text(
            text = "Reload from workspace",
            modifier = Modifier
                .padding(top = 12.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(ThreadColors.SurfaceStrong)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(7.dp))
                .padding(horizontal = 10.dp, vertical = 6.dp),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun ToolUsageCard(
    events: List<ToolCallPreview>,
    modifier: Modifier = Modifier,
) {
    val toolCounts = events
        .groupingBy { it.name }
        .eachCount()
        .entries
        .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
    val maxToolCount = max(1, toolCounts.maxOfOrNull { it.value } ?: 1)

    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Calls this session",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "${events.size} events",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
            Spacer(modifier = Modifier.weight(1f))
            Text(
                text = "Graph",
                modifier = Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.Surface)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
                    .padding(horizontal = 9.dp, vertical = 4.dp),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        toolCounts.forEach { (name, count) ->
            ToolCountRow(
                name = name,
                count = count,
                maxCount = maxToolCount,
            )
        }
    }
}

@Composable
private fun ToolCountRow(
    name: String,
    count: Int,
    maxCount: Int,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Text(
            text = name,
            modifier = Modifier.widthIn(min = 96.dp, max = 148.dp),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Box(
            modifier = Modifier
                .weight(1f)
                .height(14.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(ThreadColors.SurfaceStrong),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(count.toFloat() / maxCount.toFloat())
                    .height(14.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(ThreadColors.Primary.copy(alpha = 0.78f)),
            )
        }
        Text(
            text = count.toString(),
            modifier = Modifier.widthIn(min = 18.dp),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            textAlign = androidx.compose.ui.text.style.TextAlign.End,
        )
    }
}

@Composable
private fun ToolCallLogCard(
    events: List<ToolCallPreview>,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(48.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Call log",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Spacer(modifier = Modifier.weight(1f))
            ActionChip(label = "Reload", icon = WorkspaceActionIcon.Refresh)
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            events.forEach { event ->
                ToolLogEntry(event = event)
            }
        }
    }
}

@Composable
private fun ToolLogEntry(event: ToolCallPreview) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(9.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(RoundedCornerShape(999.dp))
                    .background(ThreadColors.Primary),
            )
            Text(
                text = event.name,
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            ToolStatusBadge(
                label = toolStatusLabel(event.status),
                status = event.status,
            )
        }
        CallSection(label = "Input", value = event.parameters.joinToString { "${it.first}: ${it.second}" })
        event.result?.let { result ->
            CallSection(label = "Output", value = result)
        }
    }
}

@Composable
private fun ToolUsageRow(event: ToolCallPreview) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(ThreadColors.Surface)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "⌘",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelMedium,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = event.name,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = event.result ?: event.parameters.joinToString { "${it.first}: ${it.second}" },
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        ToolStatusBadge(
            label = toolStatusLabel(event.status),
            status = event.status,
        )
    }
}

@Composable
private fun WorkspaceRow(
    node: WorkspaceNodePreview,
    onClick: (() -> Unit)?,
    onDownload: (() -> Unit)?,
) {
    val background = if (node.selected) ThreadColors.SurfaceStrong else ThreadColors.Panel
    val foreground = if (node.selected) ThreadColors.Foreground else ThreadColors.ForegroundSoft
    val clickModifier = if (onClick == null) Modifier else Modifier.clickable(onClick = onClick)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(background)
            .then(clickModifier)
            .padding(
                start = 10.dp + (node.depth * 16).dp,
                end = 10.dp,
                top = 8.dp,
                bottom = 8.dp,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        WorkspaceDisclosureGlyph(
            visible = node.kind == WorkspaceNodeKind.Directory,
            expanded = node.expanded,
            color = ThreadColors.ForegroundMuted,
        )
        WorkspaceNodeGlyph(
            kind = node.kind,
            expanded = node.expanded,
            color = ThreadColors.ForegroundMuted,
        )
        Text(
            text = node.name,
            modifier = Modifier.weight(1f),
            color = foreground,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        WorkspaceRowActionButton(
            icon = WorkspaceActionIcon.Download,
            selected = node.selected,
            contentDescription = "Download ${node.name}",
            onClick = onDownload,
        )
    }
}

@Composable
private fun WorkspaceEmptyState(
    rootLabel: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            modifier = Modifier
                .size(30.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(ThreadColors.SurfaceStrong)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center,
        ) {
            WorkspaceNodeGlyph(
                kind = WorkspaceNodeKind.Directory,
                expanded = true,
                color = ThreadColors.ForegroundMuted,
                modifier = Modifier.size(16.dp),
            )
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = "Workspace is empty",
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
            )
            Text(
                text = "Agent tool runs execute inside $rootLabel, so files should appear here as the session works.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun WorkspaceRowActionButton(
    icon: WorkspaceActionIcon,
    selected: Boolean,
    contentDescription: String,
    onClick: (() -> Unit)? = null,
) {
    val background = if (selected) ThreadColors.Surface else ThreadColors.Panel
    val border = if (selected) ThreadColors.BorderStrong else ThreadColors.Border.copy(alpha = 0.72f)
    Box(
        modifier = Modifier
            .size(26.dp)
            .clip(RoundedCornerShape(7.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(7.dp))
            .then(onClick?.let { Modifier.clickable(onClick = it) } ?: Modifier)
            .semantics { this.contentDescription = contentDescription },
        contentAlignment = Alignment.Center,
    ) {
        WorkspaceActionGlyph(
            icon = icon,
            color = ThreadColors.ForegroundMuted,
            modifier = Modifier.size(13.dp),
        )
    }
}

@Composable
private fun WorkspaceDisclosureGlyph(
    visible: Boolean,
    expanded: Boolean,
    color: Color,
) {
    Canvas(modifier = Modifier.size(12.dp)) {
        if (!visible) {
            return@Canvas
        }
        val strokeWidth = 1.45.dp.toPx()
        val path = Path().apply {
            if (expanded) {
                moveTo(size.width * 0.24f, size.height * 0.38f)
                lineTo(size.width * 0.50f, size.height * 0.64f)
                lineTo(size.width * 0.76f, size.height * 0.38f)
            } else {
                moveTo(size.width * 0.38f, size.height * 0.24f)
                lineTo(size.width * 0.64f, size.height * 0.50f)
                lineTo(size.width * 0.38f, size.height * 0.76f)
            }
        }
        drawPath(
            path = path,
            color = color,
            style = Stroke(width = strokeWidth, cap = StrokeCap.Round),
        )
    }
}

@Composable
private fun WorkspaceNodeGlyph(
    kind: WorkspaceNodeKind,
    expanded: Boolean,
    color: Color,
    modifier: Modifier = Modifier.size(16.dp),
) {
    Canvas(modifier = modifier) {
        val strokeWidth = 1.35.dp.toPx()
        val stroke = Stroke(width = strokeWidth, cap = StrokeCap.Round)
        when (kind) {
            WorkspaceNodeKind.Directory -> drawDirectoryGlyph(
                expanded = expanded,
                color = color,
                stroke = stroke,
            )
            WorkspaceNodeKind.File -> drawFileGlyph(color = color, stroke = stroke)
            WorkspaceNodeKind.Artifact -> drawArtifactGlyph(color = color, stroke = stroke)
            WorkspaceNodeKind.Event -> drawEventGlyph(color = color, stroke = stroke)
        }
    }
}

@Composable
private fun WorkspaceViewerCard(
    workspace: WorkspacePreview,
    onLoadMorePreview: (() -> Unit)?,
    onDownloadFile: ((String) -> Unit)?,
    onOpenRawFile: ((String) -> Unit)?,
    onCopyRawFile: ((String) -> Unit)?,
    onSaveFile: ((String, String) -> Unit)?,
    saveBusy: Boolean,
    modifier: Modifier = Modifier,
) {
    val selectedFile = workspace.selectedFile
    val fileMetaLabel = "${selectedFile.language} | ${selectedFile.sizeLabel}"
    var draft by remember(selectedFile.path, selectedFile.content) { mutableStateOf(selectedFile.content) }
    val fileBytes = selectedFile.sizeBytes ?: selectedFile.content.toByteArray(Charsets.UTF_8).size.toLong()
    val editable = selectedFile.path.isNotBlank() &&
        !selectedFile.truncated &&
        fileBytes <= WORKSPACE_TEXT_EDIT_MAX_BYTES &&
        selectedFile.language.lowercase() != "binary"
    val dirty = draft != selectedFile.content
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "Viewer",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = selectedFile.title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            ActionChip(
                label = "Save",
                icon = WorkspaceActionIcon.Open,
                onClick = if (editable && dirty && !saveBusy) {
                    { onSaveFile?.invoke(selectedFile.path, draft) }
                } else {
                    null
                },
            )
            ActionChip(
                label = "Revert",
                icon = WorkspaceActionIcon.Refresh,
                onClick = if (editable && dirty && !saveBusy) {
                    { draft = selectedFile.content }
                } else {
                    null
                },
            )
            ActionChip(
                label = "Copy",
                icon = WorkspaceActionIcon.Copy,
                onClick = workspace.selectedFile.path.takeIf { it.isNotBlank() }?.let { path ->
                    onCopyRawFile?.let { copyRawFile -> { copyRawFile(path) } }
                },
            )
            ActionChip(
                label = "Open",
                icon = WorkspaceActionIcon.Open,
                onClick = workspace.selectedFile.path.takeIf { it.isNotBlank() }?.let { path ->
                    onOpenRawFile?.let { openRawFile -> { openRawFile(path) } }
                },
            )
            ActionChip(
                label = "Download",
                icon = WorkspaceActionIcon.Download,
                onClick = workspace.selectedFile.path.takeIf { it.isNotBlank() }?.let { path ->
                    onDownloadFile?.let { downloadFile -> { downloadFile(path) } }
                },
            )
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(ThreadColors.Surface)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = fileMetaLabel,
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            selectedFile.truncatedLabel?.let { truncatedLabel ->
                Text(
                    text = truncatedLabel,
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .background(ThreadColors.WarningSoft)
                        .border(1.dp, ThreadColors.Warning.copy(alpha = 0.36f), RoundedCornerShape(999.dp))
                        .padding(horizontal = 8.dp, vertical = 3.dp),
                    color = ThreadColors.Warning,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (!editable && selectedFile.path.isNotBlank()) {
                Text(
                    text = if (selectedFile.truncated) {
                        "read only until fully loaded"
                    } else {
                        "read only"
                    },
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            } else if (dirty) {
                Text(
                    text = "unsaved",
                    color = ThreadColors.Warning,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
            }
        }
        if (editable) {
            OutlinedTextField(
                value = draft,
                onValueChange = { next -> draft = next },
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .semantics { contentDescription = "Edit ${selectedFile.title}" },
                textStyle = MaterialTheme.typography.bodyMedium.copy(
                    color = ThreadColors.CodeForeground,
                    fontFamily = FontFamily.Monospace,
                ),
                enabled = !saveBusy,
                minLines = 10,
                singleLine = false,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = ThreadColors.CodeForeground,
                    unfocusedTextColor = ThreadColors.CodeForeground,
                    disabledTextColor = ThreadColors.CodeForeground,
                    focusedContainerColor = ThreadColors.CodeBackground,
                    unfocusedContainerColor = ThreadColors.CodeBackground,
                    disabledContainerColor = ThreadColors.CodeBackground,
                    focusedBorderColor = ThreadColors.BorderStrong,
                    unfocusedBorderColor = ThreadColors.Border.copy(alpha = 0.72f),
                    disabledBorderColor = ThreadColors.Border.copy(alpha = 0.5f),
                    cursorColor = ThreadColors.Primary,
                ),
            )
        } else {
            Text(
                text = selectedFile.content,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .verticalScroll(rememberScrollState())
                    .background(ThreadColors.CodeBackground)
                    .padding(12.dp),
                color = ThreadColors.CodeForeground,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = FontFamily.Monospace,
            )
        }
        if (selectedFile.truncatedLabel != null) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ThreadColors.Surface)
                    .border(1.dp, ThreadColors.Border.copy(alpha = 0.72f))
                    .padding(horizontal = 12.dp, vertical = 9.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Load more preview",
                    modifier = Modifier
                        .clip(RoundedCornerShape(7.dp))
                        .background(ThreadColors.SurfaceStrong)
                        .border(1.dp, ThreadColors.BorderStrong, RoundedCornerShape(7.dp))
                        .then(onLoadMorePreview?.let { Modifier.clickable(onClick = it) } ?: Modifier)
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun WorkspaceGuideSurface(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp)),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "What can I do?",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = "Upload files, ask in plain language, inspect results.",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 12.dp, vertical = 6.dp),
        ) {
            GraphAccordion {
                GuideSection(
                    title = "Getting Started",
                    icon = "1",
                    defaultExpanded = true,
                    body = "Each Remote Codex thread has a private workspace. Ask a task, then inspect files, tools, artifacts, and shell output as the host reports changes.",
                    bullets = listOf(
                        "Upload or reference data through the workspace.",
                        "Use chat for intent, shell for manual recovery.",
                        "Agent-produced files appear after refresh.",
                    ),
                )
                GuideSection(
                    title = "Workspace Explorer",
                    icon = "2",
                    body = "Explorer keeps the GraphChat tree and preview flow while using mobile drill-in spacing.",
                    bullets = listOf(
                        ".xyz, .cif, and .pdb files use molecule preview when supported.",
                        "Images and text files fall back to native preview surfaces.",
                        "Large files show bounded previews with file metadata.",
                    ),
                )
                GuideSection(
                    title = "Tool Usage & Chat",
                    icon = "3",
                    showDivider = false,
                    body = "Tool usage is summarized separately from the chat so mobile users can scan calls without losing the current conversation.",
                    bullets = listOf(
                        "Counts show what happened in this thread.",
                        "Call log preserves input and output details.",
                        "Live events and persisted history share the same timeline vocabulary.",
                    ),
                )
            }
        }
    }
}

@Composable
private fun GuideSection(
    title: String,
    icon: String,
    body: String,
    bullets: List<String>,
    defaultExpanded: Boolean = false,
    showDivider: Boolean = true,
) {
    GraphAccordionItem(
        title = title,
        subtitle = body,
        defaultExpanded = defaultExpanded,
        showDivider = showDivider,
        leading = {
            Text(
                text = icon,
                modifier = Modifier
                    .size(26.dp)
                    .clip(RoundedCornerShape(7.dp))
                    .background(ThreadColors.SurfaceStrong)
                    .border(1.dp, ThreadColors.Border, RoundedCornerShape(7.dp))
                    .padding(4.dp),
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
        },
    ) {
        bullets.forEach { bullet ->
            GuideBullet(text = bullet)
        }
    }
}

@Composable
private fun GuideBullet(text: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .padding(top = 7.dp)
                .size(4.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(ThreadColors.BorderStrong),
        )
        Text(
            text = text,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
private fun WorkspaceGraphSurface(
    workspace: WorkspacePreview,
    modifier: Modifier = Modifier,
) {
    val graphState = remember(workspace) { buildWorkspaceGraphState(workspace) }
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp)
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = graphState.title,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = graphState.summaryLabel,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        GraphHelperStrip(graphState = graphState)
        WorkspaceGraphCanvas(graphState = graphState)
        GraphLegendRow()
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            graphState.rows.forEach { row ->
                GraphNodeRow(row = row)
            }
        }
    }
}

@Composable
private fun GraphHelperStrip(graphState: WorkspaceGraphState) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(ThreadColors.Surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        graphState.helperLabels.forEachIndexed { index, label ->
            GraphHelperPill(label = label, active = index == graphState.helperLabels.lastIndex)
        }
    }
}

@Composable
private fun WorkspaceGraphCanvas(graphState: WorkspaceGraphState) {
    val textMeasurer = rememberTextMeasurer()
    val graphNodeBackground = ThreadColors.Panel
    val graphNodeBorder = ThreadColors.BorderStrong
    val graphNodeText = ThreadColors.Foreground
    val graphNodeMutedText = ThreadColors.ForegroundMuted
    val graphNodeStatusText = ThreadColors.ForegroundSoft
    val nodeColors = graphState.nodes.associate { node ->
        node.id to graphNodeColor(node)
    }
    Canvas(
        modifier = Modifier
            .fillMaxWidth()
            .height(230.dp)
            .background(ThreadColors.CodeBackground)
            .padding(12.dp),
    ) {
        val cardWidth = 146.dp.toPx()
        val cardHeight = 62.dp.toPx()
        val cornerRadius = 10.dp.toPx()
        val nodePoints = graphState.nodes.associate { node ->
            node.id to Offset(
                x = size.width * node.xFraction,
                y = size.height * node.yFraction,
            )
        }
        graphState.edges.forEach { edge ->
            val start = nodePoints[edge.sourceId]
            val end = nodePoints[edge.targetId]
            if (start != null && end != null) {
                drawFloatingEdge(
                    start = edgeAnchor(start, end, cardWidth, cardHeight),
                    end = edgeAnchor(end, start, cardWidth, cardHeight),
                    color = androidx.compose.ui.graphics.Color(0xFF64748B),
                )
            }
        }
        graphState.nodes.forEach { node ->
            val point = nodePoints[node.id] ?: return@forEach
            val fill = nodeColors[node.id] ?: androidx.compose.ui.graphics.Color(0xFFE5E7EB)
            val topLeft = Offset(
                x = (point.x - cardWidth / 2f).coerceIn(0f, size.width - cardWidth),
                y = (point.y - cardHeight / 2f).coerceIn(0f, size.height - cardHeight),
            )
            drawRoundRect(
                color = graphNodeBackground,
                topLeft = topLeft,
                size = Size(cardWidth, cardHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(cornerRadius, cornerRadius),
                style = Fill,
            )
            drawRoundRect(
                color = graphNodeBorder.copy(alpha = 0.72f),
                topLeft = topLeft,
                size = Size(cardWidth, cardHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(cornerRadius, cornerRadius),
                style = Stroke(width = 1.4.dp.toPx()),
            )
            drawCircle(
                color = fill,
                radius = 4.5.dp.toPx(),
                center = Offset(topLeft.x + 14.dp.toPx(), topLeft.y + 18.dp.toPx()),
            )
            drawText(
                textMeasurer = textMeasurer,
                text = node.canvasLabel,
                topLeft = Offset(topLeft.x + 25.dp.toPx(), topLeft.y + 9.dp.toPx()),
                style = TextStyle(
                    color = graphNodeText,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                maxLines = 1,
            )
            node.canvasDescription?.let { description ->
                drawText(
                    textMeasurer = textMeasurer,
                    text = description,
                    topLeft = Offset(topLeft.x + 12.dp.toPx(), topLeft.y + 31.dp.toPx()),
                    style = TextStyle(
                        color = graphNodeMutedText,
                        fontSize = 9.sp,
                    ),
                    maxLines = 1,
                )
            }
            node.statusLabel?.let { statusLabel ->
                drawText(
                    textMeasurer = textMeasurer,
                    text = statusLabel,
                    topLeft = Offset(topLeft.x + 12.dp.toPx(), topLeft.y + 45.dp.toPx()),
                    style = TextStyle(
                        color = graphNodeStatusText,
                        fontSize = 8.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun GraphLegendRow() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(ThreadColors.Surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        GraphLegendItem(label = "thread", color = ThreadColors.Warning)
        GraphLegendItem(label = "tool", color = ThreadColors.ForegroundMuted)
        GraphLegendItem(label = "artifact", color = ThreadColors.Info)
    }
}

@Composable
private fun GraphHelperPill(
    label: String,
    active: Boolean = false,
) {
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (active) ThreadColors.InfoSoft else ThreadColors.SurfaceStrong)
            .border(1.dp, if (active) ThreadColors.Info.copy(alpha = 0.38f) else ThreadColors.Border, RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        color = if (active) ThreadColors.Info else ThreadColors.ForegroundMuted,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

@Composable
private fun GraphLegendItem(
    label: String,
    color: androidx.compose.ui.graphics.Color,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(color),
        )
        Text(
            text = label,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
        )
    }
}

@Composable
private fun graphNodeColor(node: WorkspaceGraphNodeState): Color {
    return graphNodeRowColor(node.role, node.status)
}

@Composable
private fun graphNodeRowColor(
    role: WorkspaceGraphNodeRole,
    status: ToolStatus?,
): Color {
    if (status == ToolStatus.Running) {
        return ThreadColors.Warning
    }
    if (status == ToolStatus.Failed) {
        return ThreadColors.Danger
    }
    return when (role) {
        WorkspaceGraphNodeRole.Thread -> ThreadColors.Warning
        WorkspaceGraphNodeRole.Workspace -> ThreadColors.ForegroundMuted
        WorkspaceGraphNodeRole.Tool -> ThreadColors.ForegroundSoft
        WorkspaceGraphNodeRole.Artifact -> ThreadColors.Info
    }
}

@Composable
private fun GraphNodeRow(row: WorkspaceGraphRowState) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(ThreadColors.Surface)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(graphNodeRowColor(row.role, row.status)),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = row.label,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = row.detail,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        row.status?.let { status ->
            ToolStatusBadge(
                label = toolStatusLabel(status),
                status = status,
            )
        }
    }
}

@Composable
private fun WorkspaceExtensionsSurface(
    workspace: WorkspacePreview,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        WorkspaceInfoCard(label = "Plugin Panels") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionChip(label = "Terminal")
                ActionChip(label = "Artifacts")
            }
        }
        WorkspaceInfoCard(label = "Enabled Renderers") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ActionChip(label = workspace.artifact.format)
                ActionChip(label = "Text")
                ActionChip(label = "Image")
            }
        }
        WorkspaceInfoCard(label = "Remote Codex Tools") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ExtensionToolRow(
                    icon = WorkspaceActionIcon.Open,
                    title = "Terminal",
                    description = "Terminal stays available when the Terminal plugin and shell adapter are attached.",
                )
                ExtensionToolRow(
                    icon = WorkspaceActionIcon.Copy,
                    title = "Composer tools",
                    description = "Attachments, slash panels, hooks, MCP, goals, and fork controls remain part of the chat surface.",
                )
                ExtensionToolRow(
                    icon = WorkspaceActionIcon.Trash,
                    title = "Destructive actions",
                    description = "Delete thread, interrupt, compact, and hook trust controls remain host governed.",
                )
            }
        }
        WorkspaceInfoCard(label = "Thread Meta") {
            ExtensionMetaRow(label = "Workspace", value = workspace.rootLabel)
            ExtensionMetaRow(label = "Artifact", value = workspace.artifact.title)
            ExtensionMetaRow(label = "Tool calls", value = workspace.toolEvents.size.toString())
        }
        WorkspaceInfoCard(label = "Settings") {
            ExtensionMetaRow(label = "Renderer mode", value = "Native with WebView fallback")
            ExtensionMetaRow(label = "Mobile policy", value = "Host governed")
        }
    }
}

@Composable
private fun ExtensionToolRow(
    icon: WorkspaceActionIcon,
    title: String,
    description: String,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(ThreadColors.Surface)
            .padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier = Modifier
                .size(26.dp)
                .clip(RoundedCornerShape(7.dp))
                .background(ThreadColors.SurfaceStrong)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(7.dp)),
            contentAlignment = Alignment.Center,
        ) {
            WorkspaceActionGlyph(
                icon = icon,
                color = ThreadColors.ForegroundMuted,
                modifier = Modifier.size(13.dp),
            )
        }
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                text = title,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = description,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelMedium,
            )
        }
    }
}

@Composable
private fun ExtensionMetaRow(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            modifier = Modifier.widthIn(min = 88.dp, max = 128.dp),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = value,
            modifier = Modifier.weight(1f),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun CallSection(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            text = label,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = value,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(7.dp))
                .background(ThreadColors.SurfaceStrong)
                .padding(8.dp),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelMedium,
            fontFamily = FontFamily.Monospace,
        )
    }
}

@Composable
private fun ActionChip(
    label: String,
    icon: WorkspaceActionIcon? = null,
    onClick: (() -> Unit)? = null,
) {
    val clickModifier = if (onClick == null) {
        Modifier
    } else {
        Modifier.clickable(onClick = onClick)
    }
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .then(clickModifier)
            .padding(horizontal = 9.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (icon != null) {
            WorkspaceActionGlyph(
                icon = icon,
                color = ThreadColors.ForegroundSoft,
                modifier = Modifier.size(13.dp),
            )
        }
        Text(
            text = label,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
        )
    }
}

@Composable
private fun WorkspaceActionGlyph(
    icon: WorkspaceActionIcon,
    color: Color,
    modifier: Modifier = Modifier.size(14.dp),
) {
    Canvas(modifier = modifier) {
        val strokeWidth = 1.45.dp.toPx()
        val stroke = Stroke(width = strokeWidth, cap = StrokeCap.Round)
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
            drawLine(
                color = color,
                start = Offset(size.width * x1, size.height * y1),
                end = Offset(size.width * x2, size.height * y2),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round,
            )
        }
        fun rect(left: Float, top: Float, right: Float, bottom: Float) {
            line(left, top, right, top)
            line(right, top, right, bottom)
            line(right, bottom, left, bottom)
            line(left, bottom, left, top)
        }

        when (icon) {
            WorkspaceActionIcon.Refresh -> {
                drawArc(
                    color = color,
                    startAngle = 42f,
                    sweepAngle = 250f,
                    useCenter = false,
                    topLeft = Offset(size.width * 0.18f, size.height * 0.18f),
                    size = androidx.compose.ui.geometry.Size(size.width * 0.64f, size.height * 0.64f),
                    style = stroke,
                )
                line(0.70f, 0.18f, 0.82f, 0.18f)
                line(0.82f, 0.18f, 0.82f, 0.30f)
            }
            WorkspaceActionIcon.Trash -> {
                line(0.30f, 0.28f, 0.70f, 0.28f)
                line(0.42f, 0.18f, 0.58f, 0.18f)
                rect(0.34f, 0.34f, 0.66f, 0.82f)
                line(0.45f, 0.44f, 0.45f, 0.72f)
                line(0.55f, 0.44f, 0.55f, 0.72f)
            }
            WorkspaceActionIcon.Copy -> {
                rect(0.32f, 0.24f, 0.72f, 0.72f)
                line(0.24f, 0.36f, 0.24f, 0.84f)
                line(0.24f, 0.84f, 0.60f, 0.84f)
                line(0.60f, 0.84f, 0.60f, 0.72f)
            }
            WorkspaceActionIcon.Open -> {
                rect(0.22f, 0.32f, 0.68f, 0.78f)
                line(0.50f, 0.22f, 0.82f, 0.22f)
                line(0.82f, 0.22f, 0.82f, 0.54f)
                line(0.48f, 0.56f, 0.82f, 0.22f)
            }
            WorkspaceActionIcon.Download -> {
                line(0.50f, 0.18f, 0.50f, 0.58f)
                line(0.34f, 0.42f, 0.50f, 0.58f)
                line(0.66f, 0.42f, 0.50f, 0.58f)
                line(0.22f, 0.68f, 0.22f, 0.82f)
                line(0.22f, 0.82f, 0.78f, 0.82f)
                line(0.78f, 0.82f, 0.78f, 0.68f)
            }
        }
    }
}

@Composable
private fun GraphEmptyGarbageDialogPreview(
    files: List<String>,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val fileCountLabel = if (files.size == 1) "1 file" else "${files.size} files"
    GraphDialogOverlay(
        onDismiss = onClose,
        modifier = modifier,
    ) {
        GraphDialogFrame(
            title = "Empty garbage?",
            subtitle = "Permanently delete files in the garbage/ folder.",
            onClose = onClose,
            footer = {
                if (files.isEmpty()) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End,
                    ) {
                        GraphButton(
                            label = "Cancel",
                            variant = GraphButtonVariant.Ghost,
                            size = GraphButtonSize.Default,
                            icon = GraphActionIcon.Cancel,
                            onClick = onClose,
                        )
                    }
                } else {
                    GraphDialogFooter(
                        primaryLabel = "Yes, empty garbage",
                        primaryTone = GraphDialogActionTone.Danger,
                        onCancel = onClose,
                    )
                }
            },
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Permanently delete all files in",
                    modifier = Modifier.weight(1f, fill = false),
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.bodySmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "garbage/",
                    modifier = Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(ThreadColors.SurfaceStrong)
                        .padding(horizontal = 7.dp, vertical = 4.dp),
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.labelSmall,
                    fontFamily = FontFamily.Monospace,
                )
            }
            if (files.isEmpty()) {
                Text(
                    text = "Garbage is empty.",
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(ThreadColors.Surface)
                        .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
                        .padding(12.dp),
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.bodyMedium,
                )
            } else {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(ThreadColors.DangerSoft)
                        .border(1.dp, ThreadColors.Danger.copy(alpha = 0.34f), RoundedCornerShape(10.dp))
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    WorkspaceActionGlyph(
                        icon = WorkspaceActionIcon.Trash,
                        color = ThreadColors.Danger,
                        modifier = Modifier.size(16.dp),
                    )
                    Column(
                        modifier = Modifier.weight(1f),
                        verticalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        Text(
                            text = fileCountLabel,
                            color = ThreadColors.Danger,
                            style = MaterialTheme.typography.labelMedium,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                        )
                        Text(
                            text = "This permanently removes the listed garbage files.",
                            color = ThreadColors.ForegroundMuted,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 180.dp)
                        .verticalScroll(rememberScrollState())
                        .clip(RoundedCornerShape(12.dp))
                        .background(ThreadColors.Surface)
                        .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
                        .padding(9.dp),
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    files.forEach { file ->
                        Text(
                            text = file,
                            color = ThreadColors.ForegroundSoft,
                            style = MaterialTheme.typography.labelMedium,
                            fontFamily = FontFamily.Monospace,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

private enum class WorkspaceTab(val label: String) {
    Explorer("Explorer"),
}

private enum class WorkspaceActionIcon {
    Refresh,
    Trash,
    Copy,
    Open,
    Download,
}

private fun DrawScope.drawDirectoryGlyph(
    expanded: Boolean,
    color: Color,
    stroke: Stroke,
) {
    val top = if (expanded) 0.34f else 0.38f
    val bottom = if (expanded) 0.78f else 0.74f
    val path = Path().apply {
        moveTo(size.width * 0.12f, size.height * 0.34f)
        lineTo(size.width * 0.36f, size.height * 0.34f)
        lineTo(size.width * 0.44f, size.height * top)
        lineTo(size.width * 0.88f, size.height * top)
        lineTo(size.width * 0.88f, size.height * bottom)
        lineTo(size.width * 0.12f, size.height * bottom)
        close()
    }
    drawPath(path = path, color = color, style = stroke)
}

private fun DrawScope.drawFileGlyph(
    color: Color,
    stroke: Stroke,
) {
    val path = Path().apply {
        moveTo(size.width * 0.26f, size.height * 0.12f)
        lineTo(size.width * 0.58f, size.height * 0.12f)
        lineTo(size.width * 0.76f, size.height * 0.30f)
        lineTo(size.width * 0.76f, size.height * 0.88f)
        lineTo(size.width * 0.26f, size.height * 0.88f)
        close()
        moveTo(size.width * 0.58f, size.height * 0.12f)
        lineTo(size.width * 0.58f, size.height * 0.30f)
        lineTo(size.width * 0.76f, size.height * 0.30f)
    }
    drawPath(path = path, color = color, style = stroke)
}

private fun DrawScope.drawArtifactGlyph(
    color: Color,
    stroke: Stroke,
) {
    val cx = size.width * 0.50f
    val cy = size.height * 0.50f
    val radius = size.minDimension * 0.36f
    val path = Path()
    repeat(6) { index ->
        val angle = Math.toRadians((60.0 * index) - 30.0)
        val point = Offset(
            x = cx + (cos(angle) * radius).toFloat(),
            y = cy + (sin(angle) * radius).toFloat(),
        )
        if (index == 0) {
            path.moveTo(point.x, point.y)
        } else {
            path.lineTo(point.x, point.y)
        }
    }
    path.close()
    drawPath(path = path, color = color, style = stroke)
    drawCircle(
        color = color,
        radius = size.minDimension * 0.08f,
        center = Offset(cx, cy),
    )
}

private fun DrawScope.drawEventGlyph(
    color: Color,
    stroke: Stroke,
) {
    val center = Offset(size.width * 0.50f, size.height * 0.50f)
    drawCircle(
        color = color,
        radius = size.minDimension * 0.28f,
        center = center,
        style = stroke,
    )
    drawCircle(
        color = color,
        radius = size.minDimension * 0.07f,
        center = center,
    )
    val strokeWidth = stroke.width
    listOf(
        Offset(0.50f, 0.10f) to Offset(0.50f, 0.22f),
        Offset(0.50f, 0.78f) to Offset(0.50f, 0.90f),
        Offset(0.10f, 0.50f) to Offset(0.22f, 0.50f),
        Offset(0.78f, 0.50f) to Offset(0.90f, 0.50f),
    ).forEach { (start, end) ->
        drawLine(
            color = color,
            start = Offset(size.width * start.x, size.height * start.y),
            end = Offset(size.width * end.x, size.height * end.y),
            strokeWidth = strokeWidth,
            cap = StrokeCap.Round,
        )
    }
}

private fun DrawScope.drawFloatingEdge(
    start: Offset,
    end: Offset,
    color: androidx.compose.ui.graphics.Color,
) {
    val controlOffset = (end.x - start.x) * 0.42f
    val path = Path().apply {
        moveTo(start.x, start.y)
        cubicTo(
            start.x + controlOffset,
            start.y,
            end.x - controlOffset,
            end.y,
            end.x,
            end.y,
        )
    }
    drawPath(
        path = path,
        color = color,
        style = Stroke(width = 3f, cap = StrokeCap.Round),
    )
    val angle = atan2(end.y - start.y, end.x - start.x)
    val arrowLength = 12f
    val arrowAngle = 0.55f
    val first = Offset(
        x = end.x - arrowLength * cos(angle - arrowAngle),
        y = end.y - arrowLength * sin(angle - arrowAngle),
    )
    val second = Offset(
        x = end.x - arrowLength * cos(angle + arrowAngle),
        y = end.y - arrowLength * sin(angle + arrowAngle),
    )
    drawLine(color = color, start = end, end = first, strokeWidth = 3f, cap = StrokeCap.Round)
    drawLine(color = color, start = end, end = second, strokeWidth = 3f, cap = StrokeCap.Round)
    drawCircle(
        color = androidx.compose.ui.graphics.Color(0xFF111827),
        radius = 4f,
        center = end,
    )
    drawCircle(
        color = color,
        radius = 3f,
        center = end,
    )
}
