package com.remotecodex.android.ui.screen

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.api.SupervisorAgentBackend
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.SupervisorPluginSummary
import com.remotecodex.android.api.SupervisorRuntimeConfig
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorWorkspaceSettings
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SupervisorHomeScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun homeShowsNavigationDestinationsAndOpensThreadPreview() {
        var openedThreadId: String? = null
        var openedWorkspaceId: String? = null

        setHomeContent(
            onOpenThread = { openedThreadId = it },
            onOpenWorkspace = { openedWorkspaceId = it },
        )

        composeRule.onNodeWithText("Remote Codex").assertExists()
        composeRule.onNodeWithContentDescription("Open Workspaces").assertExists()
        composeRule.onNodeWithContentDescription("Open Threads").assertExists()
        composeRule.onAllNodesWithContentDescription("Open Shells").assertCountEquals(0)
        composeRule.onNodeWithText("remoteCodex-main").assertExists()
        composeRule.onNodeWithContentDescription("Open workspace remoteCodex-main").assertExists()
        composeRule.onNodeWithContentDescription("Toggle favorite workspace remoteCodex-main").assertExists()
        composeRule.onNodeWithContentDescription("Rename workspace remoteCodex-main").assertExists()
        composeRule.onNodeWithContentDescription("Start thread in workspace remoteCodex-main").assertExists()
        composeRule.onNodeWithContentDescription("Delete workspace remoteCodex-main").assertExists()
        composeRule.onNodeWithContentDescription("Create workspace").assertExists()
        composeRule.onNodeWithContentDescription("Open workspace remoteCodex-main").performClick()
        assertEquals("workspace-1", openedWorkspaceId)

        composeRule.onNodeWithContentDescription("Open Threads").performClick()
        composeRule.onNodeWithContentDescription("Thread search input").assertExists()
        composeRule.onNodeWithContentDescription("Filter threads Running").assertExists()
        composeRule.onNodeWithContentDescription("Filter threads Attention").assertExists()
        composeRule.onNodeWithText("Android native thread client").assertExists()
        composeRule.onNodeWithContentDescription("Open thread Android native thread client").performClick()

        assertEquals("thread-1", openedThreadId)
    }

    @Test
    fun threadListFiltersSearchesSortsAndGroups() {
        setHomeContent()

        composeRule.onNodeWithContentDescription("Open Threads").performClick()
        composeRule.onNodeWithText("Needs Attention").assertExists()
        composeRule.onNodeWithText("Waiting for approval").assertExists()
        composeRule.onNodeWithText("Completed").assertExists()
        composeRule.onNodeWithText("Finished transcript export").assertExists()

        composeRule.onNodeWithContentDescription("Filter threads Attention").performClick()
        composeRule.onNodeWithText("Waiting for approval").assertExists()
        composeRule.onNodeWithText("Android native thread client").assertDoesNotExist()

        composeRule.onNodeWithContentDescription("Thread search input").performTextInput("transcript")
        composeRule.onNodeWithText("No matching threads").assertExists()

        composeRule.onNodeWithContentDescription("Filter threads All").performClick()
        composeRule.onNodeWithText("Finished transcript export").assertExists()
        composeRule.onNodeWithContentDescription("Sort threads by Title").performClick()
        composeRule.onNodeWithText("Completed").assertExists()
    }

    @Test
    fun workspaceRowsExposeRenameAndDeleteDialogs() {
        setHomeContent()

        composeRule.onNodeWithContentDescription("Create workspace").performClick()
        composeRule.onNodeWithText("New Workspace").assertExists()
        composeRule.onNodeWithText("Workspace path").assertExists()
        composeRule.onNodeWithText("Label").assertExists()
        composeRule.onNodeWithText("The supervisor must be able to access this absolute path.").assertExists()
        composeRule.onNodeWithContentDescription("Close dialog").performClick()

        composeRule.onNodeWithContentDescription("Start thread in workspace remoteCodex-main").performClick()
        composeRule.onNodeWithText("Thread title").assertExists()
        composeRule.onNodeWithText("Model").assertExists()
        composeRule.onNodeWithText("gpt-5").assertExists()
        composeRule.onNodeWithText("Starts a Codex thread in /home/u/dev/remoteCodex-main.").assertExists()
        composeRule.onNodeWithContentDescription("Close dialog").performClick()

        composeRule.onNodeWithContentDescription("Rename workspace remoteCodex-main").performClick()
        composeRule.onNodeWithText("Rename Workspace").assertExists()
        composeRule.onNodeWithText("Workspace label").assertExists()
        composeRule.onNodeWithContentDescription("Close dialog").performClick()

        composeRule.onNodeWithContentDescription("Delete workspace remoteCodex-main").performClick()
        composeRule.onNodeWithText("Delete Workspace").assertExists()
        composeRule.onNodeWithText("This removes the workspace record and its related threads from the supervisor.").assertExists()
    }

    @Test
    fun settingsShowsImportPluginDraftForm() {
        setHomeContent()

        composeRule.onNodeWithContentDescription("Open settings").performClick()
        composeRule.onNodeWithText("remote-codex 0.1.0 / test").assertExists()
        composeRule.onNodeWithText("local 127.0.0.1:8787").assertExists()
        composeRule.onAllNodesWithText("/home/u/dev").assertCountEquals(2)
        composeRule.onNodeWithText("Codex").assertExists()
        composeRule.onNodeWithText("Version: 1.2.3 / Latest: 1.2.4").assertExists()
        composeRule.onNodeWithText("2/3 ready").assertExists()
        composeRule.onNodeWithContentDescription("Workspace dev home input").assertExists()
        composeRule.onNodeWithContentDescription("Default backend input").assertExists()
        composeRule.onNodeWithContentDescription("Save workspace defaults").assertExists()
        composeRule.onNodeWithText("Example Plugin").assertExists()
        composeRule.onNodeWithText("chemistry.molecule3d").assertExists()
        composeRule.onNodeWithContentDescription("Disable plugin Example Plugin").assertExists()
        composeRule.onNodeWithContentDescription("Refresh plugins").assertExists()
        composeRule.onNodeWithText("Import plugin").assertExists()
        composeRule.onNodeWithTag("plugin-manifest-input", useUnmergedTree = true)
            .assertExists()
        composeRule.onNodeWithContentDescription("Import plugin").assertExists()
    }

    private fun setHomeContent(
        onOpenThread: (String?) -> Unit = {},
        onOpenWorkspace: (String) -> Unit = {},
    ) {
        composeRule.setContent {
            RemoteCodexTheme(dark = false) {
                SupervisorHomeScreen(
                    supervisorConnection = SupervisorConnectionConfig(
                        mode = SupervisorConnectionMode.Local,
                        baseUrl = "http://10.0.2.2:8787",
                    ),
                    homeSnapshot = SupervisorHomeSnapshot(
                        workspaces = listOf(
                            SupervisorWorkspaceSummary(
                                id = "workspace-1",
                                label = "remoteCodex-main",
                                absPath = "/home/u/dev/remoteCodex-main",
                                isFavorite = true,
                                lastOpenedAt = "2026-06-11T12:00:00.000Z",
                            ),
                        ),
                        threads = listOf(
                            SupervisorThreadSummary(
                                id = "thread-1",
                                workspaceId = "workspace-1",
                                title = "Android native thread client",
                                status = "running",
                                model = "gpt-5",
                                reasoningEffort = "medium",
                                fastMode = false,
                                collaborationMode = "default",
                                sandboxMode = "workspace-write",
                                updatedAt = "2026-06-11T12:01:00.000Z",
                                summaryText = "Align Android app shell with thread-ui.",
                            ),
                            SupervisorThreadSummary(
                                id = "thread-2",
                                workspaceId = "workspace-1",
                                title = "Waiting for approval",
                                status = "waiting",
                                model = "gpt-5",
                                reasoningEffort = "medium",
                                fastMode = false,
                                collaborationMode = "default",
                                sandboxMode = "workspace-write",
                                updatedAt = "2026-06-11T12:02:00.000Z",
                                summaryText = "Permission required before editing files.",
                            ),
                            SupervisorThreadSummary(
                                id = "thread-3",
                                workspaceId = "workspace-1",
                                title = "Finished transcript export",
                                status = "completed",
                                model = "gpt-5",
                                reasoningEffort = "low",
                                fastMode = false,
                                collaborationMode = "default",
                                sandboxMode = "workspace-write",
                                updatedAt = "2026-06-11T11:58:00.000Z",
                                summaryText = "Exported PDF and HTML artifacts.",
                            ),
                        ),
                    ),
                    homeSnapshotLoading = false,
                    homeSnapshotError = null,
                    themeMode = ThemeMode.System,
                    darkThemeActive = false,
                    onThemeModeSelected = {},
                    onOpenThread = onOpenThread,
                    onOpenWorkspace = onOpenWorkspace,
                    initialPlugins = listOf(examplePlugin(enabled = true)),
                    initialRuntimeConfig = SupervisorRuntimeConfig(
                        appName = "remote-codex",
                        appVersion = "0.1.0",
                        mode = "local",
                        host = "127.0.0.1",
                        port = 8787,
                        workspaceRoot = "/home/u/dev",
                        environment = "test",
                    ),
                    initialWorkspaceSettings = SupervisorWorkspaceSettings(
                        workspaceRoot = "/home/u/dev",
                        devHome = "/home/u/dev",
                        defaultBackend = "codex",
                    ),
                    initialAgentBackends = listOf(
                        exampleBackend(
                            provider = "codex",
                            displayName = "Codex",
                            enabled = true,
                            isDefault = true,
                            installedVersion = "1.2.3",
                            latestVersion = "1.2.4",
                        ),
                        exampleBackend(
                            provider = "claude",
                            displayName = "Claude",
                            enabled = true,
                        ),
                        exampleBackend(
                            provider = "opencode",
                            displayName = "OpenCode",
                            enabled = false,
                            installed = false,
                            installedVersion = null,
                        ),
                    ),
                    onImportPluginManifest = {
                        examplePlugin(enabled = true)
                    },
                    onChangeConnection = {},
                )
            }
        }
    }

    private fun examplePlugin(enabled: Boolean): SupervisorPluginSummary {
        return SupervisorPluginSummary(
            id = "example-plugin",
            name = "Example Plugin",
            version = "1.0.0",
            description = "Example manifest plugin",
            remoteCodex = "0.1",
            enabled = enabled,
            source = "imported",
            artifactTypes = listOf("chemistry.molecule3d"),
        )
    }

    private fun exampleBackend(
        provider: String,
        displayName: String,
        enabled: Boolean,
        isDefault: Boolean = false,
        installed: Boolean = true,
        installedVersion: String? = "1.0.0",
        latestVersion: String? = null,
    ): SupervisorAgentBackend {
        return SupervisorAgentBackend(
            provider = provider,
            displayName = displayName,
            description = "$displayName runtime",
            enabled = enabled,
            isDefault = isDefault,
            statusState = if (enabled) "running" else "stopped",
            statusDetail = null,
            installed = installed,
            installedVersion = installedVersion,
            latestVersion = latestVersion,
            installAvailable = !installed,
            updateAvailable = latestVersion != null,
            busy = false,
            lastError = null,
            configArchives = provider == "codex",
            buildRestart = provider == "codex",
        )
    }
}
