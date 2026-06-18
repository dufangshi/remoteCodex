package com.remotecodex.android.ui.components

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.remotecodex.android.ui.model.ArtifactPreview
import com.remotecodex.android.ui.model.WorkspaceFilePreview
import com.remotecodex.android.ui.model.WorkspaceNodeKind
import com.remotecodex.android.ui.model.WorkspaceNodePreview
import com.remotecodex.android.ui.model.WorkspacePreview
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WorkspacePanelTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun explorerTogglesSelectsAndDownloadsFolders() {
        var selectedPath: String? = null
        var downloadedPath: String? = null

        composeRule.setContent {
            RemoteCodexTheme(dark = false) {
                WorkspacePanel(
                    workspace = sampleWorkspace(),
                    onSelectFile = { selectedPath = it },
                    onDownloadFile = { downloadedPath = it },
                )
            }
        }

        composeRule.onNodeWithText("remote-codex-android-e2e").assertExists()
        composeRule.onNodeWithText("download-me").assertExists()
        composeRule.onNodeWithText("a.txt").assertDoesNotExist()

        composeRule.onNodeWithText("download-me").performClick()
        composeRule.onNodeWithText("a.txt").assertExists().performClick()
        composeRule.runOnIdle {
            assertEquals("download-me/a.txt", selectedPath)
        }

        composeRule.onNodeWithText("download-me").performClick()
        composeRule.onNodeWithText("a.txt").assertDoesNotExist()

        composeRule.onNodeWithText("download-me").performClick()
        composeRule.onNodeWithContentDescription("Download download-me").performClick()
        composeRule.runOnIdle {
            assertEquals("download-me", downloadedPath)
        }
    }

    @Test
    fun explorerKeepsExpandedFoldersWhenPreviewChanges() {
        var workspace by mutableStateOf(sampleWorkspace())

        composeRule.setContent {
            RemoteCodexTheme(dark = false) {
                WorkspacePanel(
                    workspace = workspace,
                    onSelectFile = { path ->
                        workspace = workspace.copy(
                            nodes = workspace.nodes.map { node -> node.copy(selected = node.path == path) },
                            selectedFile = WorkspaceFilePreview(
                                title = path,
                                language = "text",
                                sizeLabel = "5 bytes",
                                truncatedLabel = null,
                                content = "hello",
                                path = path,
                                sizeBytes = 5,
                            ),
                        )
                    },
                )
            }
        }

        composeRule.onNodeWithText("download-me").performClick()
        composeRule.onNodeWithText("a.txt").assertExists().performClick()

        composeRule.onNodeWithText("download-me").assertExists()
        composeRule.onNodeWithText("a.txt").assertExists()
        composeRule.onNodeWithText("b.txt").assertExists()
    }
}

private fun sampleWorkspace(): WorkspacePreview {
    return WorkspacePreview(
        title = "Workspace",
        rootLabel = "Android E2E",
        nodes = listOf(
            WorkspaceNodePreview(
                name = "remote-codex-android-e2e",
                path = "",
                kind = WorkspaceNodeKind.Directory,
                depth = 0,
                expanded = true,
            ),
            WorkspaceNodePreview(
                name = "download-me",
                path = "download-me",
                kind = WorkspaceNodeKind.Directory,
                depth = 1,
                expanded = true,
            ),
            WorkspaceNodePreview(
                name = "a.txt",
                path = "download-me/a.txt",
                kind = WorkspaceNodeKind.File,
                depth = 2,
            ),
            WorkspaceNodePreview(
                name = "b.txt",
                path = "download-me/b.txt",
                kind = WorkspaceNodeKind.File,
                depth = 2,
            ),
            WorkspaceNodePreview(
                name = "README.md",
                path = "README.md",
                kind = WorkspaceNodeKind.File,
                depth = 1,
            ),
        ),
        selectedFile = WorkspaceFilePreview(
            title = "README.md",
            language = "text",
            sizeLabel = "12 bytes",
            truncatedLabel = null,
            content = "hello",
            path = "README.md",
            sizeBytes = 12,
        ),
        toolEvents = emptyList(),
        artifact = ArtifactPreview(
            id = "artifact-placeholder",
            title = "No artifact selected",
            type = "workspace",
            summary = "No artifact selected.",
            format = "text",
            sourcePreview = "",
            atomCount = null,
            frameCount = null,
        ),
    )
}
