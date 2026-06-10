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
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.ui.model.ToolCallPreview
import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.model.WorkspaceNodeKind
import com.remotecodex.android.ui.model.WorkspaceNodePreview
import com.remotecodex.android.ui.model.WorkspacePreview
import com.remotecodex.android.ui.presentation.toolStatusLabel
import com.remotecodex.android.ui.theme.ThreadColors
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

@Composable
fun WorkspacePanel(
    workspace: WorkspacePreview,
    modifier: Modifier = Modifier,
) {
    var selectedTab by remember { mutableStateOf(WorkspaceTab.Workspace) }
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
                WorkspaceTab.Workspace -> WorkspaceBrowserSurface(
                    workspace = workspace,
                    onOpenGarbage = { garbageDialogOpen = true },
                    modifier = Modifier.weight(1f),
                )
                WorkspaceTab.Tools -> ToolUsageSurface(
                    events = workspace.toolEvents,
                    modifier = Modifier.weight(1f),
                )
                WorkspaceTab.Guide -> WorkspaceGuideSurface(modifier = Modifier.weight(1f))
                WorkspaceTab.Graph -> WorkspaceGraphSurface(
                    workspace = workspace,
                    modifier = Modifier.weight(1f),
                )
                WorkspaceTab.Extensions -> WorkspaceExtensionsSurface(
                    workspace = workspace,
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
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        WorkspaceSummaryStrip(workspace = workspace, modifier = Modifier.fillMaxWidth())
        GraphResizablePanelGroup(modifier = Modifier.weight(1f)) {
            GraphResizablePanel {
                WorkspaceExplorerCard(
                    workspace = workspace,
                    onOpenGarbage = onOpenGarbage,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            GraphResizableHandle()
            GraphResizablePanel {
                ArtifactPreviewCard(artifact = workspace.artifact, modifier = Modifier.fillMaxWidth())
            }
            GraphResizableHandle()
            GraphResizablePanel(weight = 1f) {
                WorkspaceViewerCard(workspace = workspace, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun ToolUsageSurface(
    events: List<ToolCallPreview>,
    modifier: Modifier = Modifier,
) {
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
                text = workspace.selectedFile.title,
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
            ActionChip(label = "Garbage", onClick = onOpenGarbage)
            ActionChip(label = "Refresh")
        }
        workspace.nodes.take(10).forEach { node ->
            WorkspaceRow(node = node)
        }
    }
}

@Composable
private fun ToolUsageCard(
    events: List<ToolCallPreview>,
    modifier: Modifier = Modifier,
) {
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
                text = "Tool usage",
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
        events.take(2).forEach { event ->
            ToolUsageRow(event = event)
        }
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
            ActionChip(label = "Reload")
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
private fun WorkspaceRow(node: WorkspaceNodePreview) {
    val background = if (node.selected) ThreadColors.SurfaceStrong else ThreadColors.Panel
    val foreground = if (node.selected) ThreadColors.Foreground else ThreadColors.ForegroundSoft
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(background)
            .padding(
                start = 10.dp + (node.depth * 16).dp,
                end = 10.dp,
                top = 8.dp,
                bottom = 8.dp,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = if (node.kind == WorkspaceNodeKind.Directory) {
                if (node.expanded) "▾" else "▸"
            } else {
                " "
            },
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelMedium,
        )
        Text(
            text = iconFor(node.kind),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelMedium,
        )
        Text(
            text = node.name,
            modifier = Modifier.weight(1f),
            color = foreground,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun WorkspaceViewerCard(
    workspace: WorkspacePreview,
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
                text = workspace.selectedFile.title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            ActionChip(label = "Copy")
            ActionChip(label = "Open")
        }
        Text(
            text = "${workspace.selectedFile.language} | ${workspace.selectedFile.sizeLabel}" +
                (workspace.selectedFile.truncatedLabel?.let { " | $it" } ?: ""),
            modifier = Modifier
                .fillMaxWidth()
                .background(ThreadColors.Surface)
                .padding(horizontal = 12.dp, vertical = 8.dp),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
        Text(
            text = workspace.selectedFile.content,
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
                text = "Thread graph",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "floating edges",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
        GraphHelperStrip()
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(190.dp)
                .background(ThreadColors.CodeBackground)
                .padding(12.dp),
        ) {
            val nodeColor = androidx.compose.ui.graphics.Color(0xFFE5E7EB)
            val accent = androidx.compose.ui.graphics.Color(0xFF7DD3FC)
            val warning = androidx.compose.ui.graphics.Color(0xFFFBBF24)
            val muted = androidx.compose.ui.graphics.Color(0xFF64748B)
            val points = listOf(
                Offset(size.width * 0.16f, size.height * 0.50f),
                Offset(size.width * 0.38f, size.height * 0.30f),
                Offset(size.width * 0.38f, size.height * 0.70f),
                Offset(size.width * 0.62f, size.height * 0.40f),
                Offset(size.width * 0.80f, size.height * 0.58f),
            )
            listOf(0 to 1, 0 to 2, 1 to 3, 2 to 3, 3 to 4).forEachIndexed { index, (start, end) ->
                drawFloatingEdge(
                    start = points[start],
                    end = points[end],
                    color = if (index == 4) accent else muted,
                )
            }
            points.forEachIndexed { index, point ->
                drawCircle(
                    color = when (index) {
                        0 -> warning
                        4 -> accent
                        else -> nodeColor
                    },
                    radius = if (index == 0) 14f else 11f,
                    center = point,
                )
                drawCircle(
                    color = androidx.compose.ui.graphics.Color(0xFF0F172A).copy(alpha = 0.28f),
                    radius = if (index == 0) 18f else 15f,
                    center = point,
                    style = Stroke(width = 2f),
                )
            }
        }
        GraphLegendRow()
        Column(
            modifier = Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            GraphNodeRow(label = "Thread", detail = workspace.title)
            GraphNodeRow(label = "Workspace", detail = workspace.rootLabel)
            workspace.toolEvents.forEach { event ->
                GraphNodeRow(label = event.name, detail = event.result ?: "pending")
            }
            GraphNodeRow(label = "Artifact", detail = workspace.artifact.title)
        }
    }
}

@Composable
private fun GraphHelperStrip() {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(ThreadColors.Surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        GraphHelperPill(label = "Bezier edges")
        GraphHelperPill(label = "Arrow targets")
        GraphHelperPill(label = "Live node", active = true)
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
private fun GraphNodeRow(label: String, detail: String) {
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
                .background(ThreadColors.Info),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = label,
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
        GraphAccordion {
            GraphAccordionItem(
                title = "Plugin Panels",
                subtitle = "Panels available from thread-ui extension slots.",
                defaultExpanded = true,
                leading = { GraphAccordionIcon(label = "P") },
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActionChip(label = "Terminal")
                    ActionChip(label = "Artifacts")
                }
            }
            GraphAccordionItem(
                title = "Enabled Renderers",
                subtitle = "Native renderers and WebView fallback candidates.",
                leading = { GraphAccordionIcon(label = "R") },
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ActionChip(label = workspace.artifact.format)
                    ActionChip(label = "Text")
                    ActionChip(label = "Image")
                }
            }
            GraphAccordionItem(
                title = "Remote Codex Tools",
                subtitle = "Thread controls that need host-governed policies.",
                showDivider = false,
                leading = { GraphAccordionIcon(label = "T") },
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ExtensionToolRow(
                        title = "Terminal",
                        description = "Shell stays available when a thread shell is attached.",
                    )
                    ExtensionToolRow(
                        title = "Composer tools",
                        description = "Attachments, slash panels, hooks, MCP, goals, and fork controls remain part of chat.",
                    )
                    ExtensionToolRow(
                        title = "Destructive actions",
                        description = "Delete, interrupt, compact, and trust controls stay explicit and host governed.",
                    )
                }
            }
        }
    }
}

@Composable
private fun ExtensionToolRow(title: String, description: String) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(9.dp))
            .background(ThreadColors.Surface)
            .padding(10.dp),
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
    onClick: (() -> Unit)? = null,
) {
    val clickModifier = if (onClick == null) {
        Modifier
    } else {
        Modifier.clickable(onClick = onClick)
    }
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
            .then(clickModifier)
            .padding(horizontal = 9.dp, vertical = 5.dp),
        color = ThreadColors.ForegroundSoft,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
    )
}

@Composable
private fun GraphEmptyGarbageDialogPreview(
    files: List<String>,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .background(ThreadColors.Primary.copy(alpha = 0.42f))
            .padding(14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .matchParentSize()
                .clickable(onClick = onClose),
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .widthIn(max = 390.dp)
                .heightIn(max = 520.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(ThreadColors.Panel)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(20.dp))
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "Empty garbage?",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Permanently delete files in",
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
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Cancel",
                    modifier = Modifier
                        .clip(RoundedCornerShape(999.dp))
                        .border(1.dp, ThreadColors.Border, RoundedCornerShape(999.dp))
                        .clickable(onClick = onClose)
                        .padding(horizontal = 13.dp, vertical = 8.dp),
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                if (files.isNotEmpty()) {
                    Text(
                        text = "Empty garbage",
                        modifier = Modifier
                            .padding(start = 8.dp)
                            .clip(RoundedCornerShape(999.dp))
                            .background(ThreadColors.DangerSoft)
                            .border(1.dp, ThreadColors.Danger.copy(alpha = 0.45f), RoundedCornerShape(999.dp))
                            .clickable(onClick = onClose)
                            .padding(horizontal = 13.dp, vertical = 8.dp),
                        color = ThreadColors.Danger,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}

private fun iconFor(kind: WorkspaceNodeKind): String {
    return when (kind) {
        WorkspaceNodeKind.Directory -> "□"
        WorkspaceNodeKind.File -> "◇"
        WorkspaceNodeKind.Artifact -> "⬡"
        WorkspaceNodeKind.Event -> "◌"
    }
}

private enum class WorkspaceTab(val label: String) {
    Workspace("Workspace"),
    Tools("Tool Usage"),
    Guide("Guide"),
    Graph("Graph"),
    Extensions("Extensions"),
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
