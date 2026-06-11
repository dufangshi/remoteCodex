package com.remotecodex.android.ui.presentation

import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.model.WorkspacePreview

data class WorkspaceGraphInputNode(
    val id: String,
    val name: String,
    val description: String? = null,
    val outNodeIds: List<String> = emptyList(),
    val role: WorkspaceGraphNodeRole = WorkspaceGraphNodeRole.Tool,
    val status: ToolStatus? = null,
)

enum class WorkspaceGraphNodeRole {
    Thread,
    Workspace,
    Tool,
    Artifact,
}

data class WorkspaceGraphNodeState(
    val id: String,
    val label: String,
    val description: String?,
    val role: WorkspaceGraphNodeRole,
    val status: ToolStatus?,
    val xFraction: Float,
    val yFraction: Float,
)

data class WorkspaceGraphEdgeState(
    val id: String,
    val sourceId: String,
    val targetId: String,
)

data class WorkspaceGraphRowState(
    val label: String,
    val detail: String,
    val role: WorkspaceGraphNodeRole,
    val status: ToolStatus?,
)

data class WorkspaceGraphState(
    val title: String,
    val summaryLabel: String,
    val helperLabels: List<String>,
    val nodes: List<WorkspaceGraphNodeState>,
    val edges: List<WorkspaceGraphEdgeState>,
    val rows: List<WorkspaceGraphRowState>,
)

fun buildWorkspaceGraphState(workspace: WorkspacePreview): WorkspaceGraphState {
    val toolNodeIds = workspace.toolEvents.mapIndexed { index, _ -> "tool-$index" }
    val firstWorkNodeId = toolNodeIds.firstOrNull() ?: "artifact"

    val inputNodes = mutableListOf(
        WorkspaceGraphInputNode(
            id = "thread",
            name = workspace.title.trim().ifEmpty { "Thread" },
            description = "Current thread",
            outNodeIds = listOf("workspace"),
            role = WorkspaceGraphNodeRole.Thread,
        ),
        WorkspaceGraphInputNode(
            id = "workspace",
            name = workspace.rootLabel.trim().ifEmpty { "Workspace" },
            description = "Workspace root",
            outNodeIds = listOf(firstWorkNodeId),
            role = WorkspaceGraphNodeRole.Workspace,
        ),
    )

    workspace.toolEvents.forEachIndexed { index, event ->
        val nextNodeId = toolNodeIds.getOrNull(index + 1) ?: "artifact"
        inputNodes += WorkspaceGraphInputNode(
            id = toolNodeIds[index],
            name = event.name.trim().ifEmpty { "tool.${index + 1}" },
            description = event.result?.lineSequence()?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
                ?: event.parameters.joinToString { "${it.first}: ${it.second}" }.takeIf { it.isNotBlank() }
                ?: toolResultStatusLabel(event.status),
            outNodeIds = listOf(nextNodeId),
            role = WorkspaceGraphNodeRole.Tool,
            status = event.status,
        )
    }

    inputNodes += WorkspaceGraphInputNode(
        id = "artifact",
        name = workspace.artifact.title.trim().ifEmpty { "Artifact" },
        description = workspace.artifact.summary.trim().ifEmpty { workspace.artifact.type },
        role = WorkspaceGraphNodeRole.Artifact,
    )

    return buildWorkspaceGraphState(inputNodes)
}

fun buildWorkspaceGraphState(inputNodes: List<WorkspaceGraphInputNode>): WorkspaceGraphState {
    val nodesById = linkedMapOf<String, WorkspaceGraphInputNode>()
    inputNodes.forEach { node ->
        val id = node.id.trim()
        if (id.isNotEmpty() && !nodesById.containsKey(id)) {
            nodesById[id] = node.copy(id = id)
        }
    }

    val edges = nodesById.values.flatMap { node ->
        node.outNodeIds.mapNotNull { targetId ->
            val normalizedTargetId = targetId.trim()
            if (normalizedTargetId.isEmpty() || !nodesById.containsKey(normalizedTargetId)) {
                null
            } else {
                WorkspaceGraphEdgeState(
                    id = "${node.id}-$normalizedTargetId",
                    sourceId = node.id,
                    targetId = normalizedTargetId,
                )
            }
        }
    }

    val depths = workspaceGraphDepths(nodesById.keys.toList(), edges)
    val maxDepth = depths.values.maxOrNull() ?: 0
    val groupedIds = nodesById.keys.groupBy { depths[it] ?: 0 }
    val nodes = nodesById.values.map { node ->
        val depth = depths[node.id] ?: 0
        val group = groupedIds[depth].orEmpty()
        val indexInDepth = group.indexOf(node.id).coerceAtLeast(0)
        val xFraction = if (maxDepth == 0) {
            0.5f
        } else {
            (depth + 1).toFloat() / (maxDepth + 2).toFloat()
        }
        val yFraction = (indexInDepth + 1).toFloat() / (group.size + 1).toFloat()
        WorkspaceGraphNodeState(
            id = node.id,
            label = node.name.trim().ifEmpty { node.id },
            description = node.description?.trim()?.takeIf { it.isNotEmpty() },
            role = node.role,
            status = node.status,
            xFraction = xFraction,
            yFraction = yFraction,
        )
    }

    val rows = nodes.map { node ->
        WorkspaceGraphRowState(
            label = node.label,
            detail = node.description ?: workspaceGraphRoleLabel(node.role),
            role = node.role,
            status = node.status,
        )
    }
    val nodeLabel = if (nodes.size == 1) "1 node" else "${nodes.size} nodes"
    val edgeLabel = if (edges.size == 1) "1 edge" else "${edges.size} edges"
    val running = nodes.any { it.status == ToolStatus.Running }

    return WorkspaceGraphState(
        title = "Thread graph",
        summaryLabel = "$nodeLabel · $edgeLabel",
        helperLabels = listOf(
            "Filtered targets",
            "Arrow targets",
            if (running) "Live node" else "Static projection",
        ),
        nodes = nodes,
        edges = edges,
        rows = rows,
    )
}

private fun workspaceGraphDepths(
    nodeIds: List<String>,
    edges: List<WorkspaceGraphEdgeState>,
): Map<String, Int> {
    val incomingTargets = edges.map { it.targetId }.toSet()
    val roots = nodeIds.filterNot { incomingTargets.contains(it) }.ifEmpty { nodeIds.take(1) }
    val depths = nodeIds.associateWith { 0 }.toMutableMap()
    val queue = ArrayDeque<String>()
    roots.forEach { queue += it }

    while (queue.isNotEmpty()) {
        val sourceId = queue.removeFirst()
        val sourceDepth = depths[sourceId] ?: 0
        edges.filter { it.sourceId == sourceId }.forEach { edge ->
            val nextDepth = sourceDepth + 1
            if (nextDepth > (depths[edge.targetId] ?: 0)) {
                depths[edge.targetId] = nextDepth
                queue += edge.targetId
            }
        }
    }

    return depths
}

private fun workspaceGraphRoleLabel(role: WorkspaceGraphNodeRole): String {
    return when (role) {
        WorkspaceGraphNodeRole.Thread -> "Thread"
        WorkspaceGraphNodeRole.Workspace -> "Workspace"
        WorkspaceGraphNodeRole.Tool -> "Tool"
        WorkspaceGraphNodeRole.Artifact -> "Artifact"
    }
}
