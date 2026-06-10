package com.remotecodex.android.ui.presentation

import com.remotecodex.android.ui.model.WorkspaceNodeKind
import com.remotecodex.android.ui.model.WorkspaceNodePreview

data class WorkspaceTreePath(
    val path: String,
    val kind: WorkspaceNodeKind = WorkspaceNodeKind.File,
)

fun extensionOf(path: String): String {
    return path.substringAfterLast('.', missingDelimiterValue = "").lowercase()
}

fun fileNameFromPath(path: String): String {
    return path.split('/').filter { it.isNotBlank() }.lastOrNull() ?: path
}

fun collectAncestorPaths(path: String): Set<String> {
    val segments = path.split('/').filter { it.isNotBlank() }
    return buildSet {
        for (index in 1 until segments.size) {
            add(segments.take(index).joinToString("/"))
        }
    }
}

fun buildWorkspaceTreeNodes(
    paths: List<WorkspaceTreePath>,
    selectedPath: String,
): List<WorkspaceNodePreview> {
    val expandedPaths = collectAncestorPaths(selectedPath)
    val root = MutableWorkspaceNode(path = "", name = "", kind = WorkspaceNodeKind.Directory)
    paths.forEach { item ->
        root.addPath(item.path, item.kind)
    }

    return buildList {
        root.children
            .sortedWith(workspaceNodeComparator)
            .forEach { child ->
                flattenWorkspaceNode(
                    node = child,
                    selectedPath = selectedPath,
                    expandedPaths = expandedPaths,
                    output = this,
                )
            }
    }
}

private fun depthForPath(path: String): Int {
    return path.split('/').count { it.isNotBlank() } - 1
}

private fun flattenWorkspaceNode(
    node: MutableWorkspaceNode,
    selectedPath: String,
    expandedPaths: Set<String>,
    output: MutableList<WorkspaceNodePreview>,
) {
    val expanded = node.kind == WorkspaceNodeKind.Directory && (node.path in expandedPaths || node.path.count { it == '/' } == 0)
    output.add(
        WorkspaceNodePreview(
            name = node.name,
            path = node.path,
            kind = node.kind,
            depth = depthForPath(node.path),
            selected = node.path == selectedPath,
            expanded = expanded,
        ),
    )
    if (!expanded) {
        return
    }
    node.children
        .sortedWith(workspaceNodeComparator)
        .forEach { child ->
            flattenWorkspaceNode(
                node = child,
                selectedPath = selectedPath,
                expandedPaths = expandedPaths,
                output = output,
            )
        }
}

private val workspaceNodeComparator = compareBy<MutableWorkspaceNode> {
    if (it.kind == WorkspaceNodeKind.Directory) 0 else 1
}.thenBy { it.name.lowercase() }

private data class MutableWorkspaceNode(
    val path: String,
    val name: String,
    var kind: WorkspaceNodeKind,
) {
    val children: MutableList<MutableWorkspaceNode> = mutableListOf()

    fun addPath(path: String, kind: WorkspaceNodeKind) {
        val segments = path.split('/').filter { it.isNotBlank() }
        var current = this
        var currentPath = ""
        segments.forEachIndexed { index, segment ->
            currentPath = if (currentPath.isEmpty()) segment else "$currentPath/$segment"
            val isLeaf = index == segments.lastIndex
            val childKind = if (isLeaf) kind else WorkspaceNodeKind.Directory
            val child = current.children.firstOrNull { it.path == currentPath }
                ?: MutableWorkspaceNode(
                    path = currentPath,
                    name = segment,
                    kind = childKind,
                ).also { current.children.add(it) }
            if (isLeaf) {
                child.kind = childKind
            }
            current = child
        }
    }
}
