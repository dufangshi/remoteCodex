package com.remotecodex.android.ui.presentation

import com.remotecodex.android.ui.model.ArtifactPreview
import com.remotecodex.android.ui.model.ToolCallPreview
import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.model.WorkspaceFilePreview
import com.remotecodex.android.ui.model.WorkspacePreview
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceGraphPresentationTest {
    @Test
    fun buildsEdgesOnlyForKnownTargets() {
        val state = buildWorkspaceGraphState(
            listOf(
                WorkspaceGraphInputNode(
                    id = "thread",
                    name = "Thread",
                    outNodeIds = listOf("workspace", "missing"),
                    role = WorkspaceGraphNodeRole.Thread,
                ),
                WorkspaceGraphInputNode(
                    id = "workspace",
                    name = "remoteCodex-main",
                    role = WorkspaceGraphNodeRole.Workspace,
                ),
            ),
        )

        assertEquals(
            listOf(WorkspaceGraphEdgeState("thread-workspace", "thread", "workspace")),
            state.edges,
        )
        assertEquals("2 nodes · 1 edge", state.summaryLabel)
    }

    @Test
    fun supportsMultipleOutputTargets() {
        val state = buildWorkspaceGraphState(
            listOf(
                WorkspaceGraphInputNode(
                    id = "thread",
                    name = "Thread",
                    outNodeIds = listOf("tool-a", "tool-b"),
                    role = WorkspaceGraphNodeRole.Thread,
                ),
                WorkspaceGraphInputNode(id = "tool-a", name = "file.read"),
                WorkspaceGraphInputNode(id = "tool-b", name = "shell.exec"),
            ),
        )

        assertEquals(
            listOf(
                WorkspaceGraphEdgeState("thread-tool-a", "thread", "tool-a"),
                WorkspaceGraphEdgeState("thread-tool-b", "thread", "tool-b"),
            ),
            state.edges,
        )
        assertTrue(state.nodes.first { it.id == "thread" }.xFraction < state.nodes.first { it.id == "tool-a" }.xFraction)
        assertEquals("3 nodes · 2 edges", state.summaryLabel)
    }

    @Test
    fun projectsWorkspacePreviewIntoThreadWorkspaceToolArtifactGraph() {
        val state = buildWorkspaceGraphState(
            WorkspacePreview(
                title = "Workspace",
                rootLabel = "remoteCodex-main",
                nodes = emptyList(),
                selectedFile = WorkspaceFilePreview(
                    title = "README.md",
                    language = "markdown",
                    sizeLabel = "1 KB",
                    truncatedLabel = null,
                    content = "# Remote Codex",
                ),
                toolEvents = listOf(
                    ToolCallPreview(
                        name = "file.read",
                        status = ToolStatus.Completed,
                        parameters = listOf("path" to "README.md"),
                        result = "Loaded README.",
                    ),
                    ToolCallPreview(
                        name = "shell.exec",
                        status = ToolStatus.Running,
                        parameters = listOf("cmd" to "./gradlew test"),
                        result = null,
                    ),
                ),
                artifact = ArtifactPreview(
                    id = "artifact-1",
                    title = "Debug APK",
                    type = "android.apk",
                    summary = "Assembled debug package.",
                    format = "APK",
                    sourcePreview = "",
                    atomCount = null,
                    frameCount = null,
                ),
            ),
        )

        assertEquals(
            listOf("thread-workspace", "workspace-tool-0", "tool-0-tool-1", "tool-1-artifact"),
            state.edges.map { it.id },
        )
        assertEquals(
            listOf("Workspace", "remoteCodex-main", "file.read", "shell.exec", "Debug APK"),
            state.rows.map { it.label },
        )
        assertEquals("Loaded README.", state.rows.first { it.label == "file.read" }.detail)
        assertEquals("cmd: ./gradlew test", state.rows.first { it.label == "shell.exec" }.detail)
        assertEquals("Live node", state.helperLabels.last())
    }
}
