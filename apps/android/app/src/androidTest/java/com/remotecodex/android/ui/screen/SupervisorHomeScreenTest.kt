package com.remotecodex.android.ui.screen

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SupervisorHomeScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun homeShowsNavigationDestinationsAndOpensThreadPreview() {
        var openedThreadPreview = false

        setHomeContent(onOpenThreadPreview = { openedThreadPreview = true })

        composeRule.onNodeWithText("Remote Codex").assertExists()
        composeRule.onNodeWithContentDescription("Open Workspaces").assertExists()
        composeRule.onNodeWithContentDescription("Open Threads").assertExists()
        composeRule.onNodeWithContentDescription("Open Shells").assertExists()
        composeRule.onNodeWithText("remoteCodex-main").assertExists()

        composeRule.onNodeWithContentDescription("Open Threads").performClick()
        composeRule.onNodeWithText("Android native thread client").assertExists()
        composeRule.onNodeWithContentDescription("Open thread Android native thread client").performClick()

        assertTrue(openedThreadPreview)

        composeRule.onNodeWithContentDescription("Open Shells").performClick()
        composeRule.onNodeWithText("Build shell").assertExists()
        composeRule.onNodeWithText("Shell adapter pending").assertExists()
    }

    @Test
    fun settingsShowsImportPluginDraftForm() {
        setHomeContent()

        composeRule.onNodeWithContentDescription("Open settings").performClick()
        composeRule.onNodeWithText("Import plugin").assertExists()
        composeRule.onNodeWithTag("plugin-manifest-input", useUnmergedTree = true).assertExists()
        composeRule.onNodeWithContentDescription("Import plugin").assertExists()
    }

    private fun setHomeContent(onOpenThreadPreview: () -> Unit = {}) {
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
                                updatedAt = "2026-06-11T12:01:00.000Z",
                                summaryText = "Align Android app shell with thread-ui.",
                            ),
                        ),
                    ),
                    homeSnapshotLoading = false,
                    homeSnapshotError = null,
                    themeMode = ThemeMode.System,
                    darkThemeActive = false,
                    onThemeModeSelected = {},
                    onOpenThreadPreview = onOpenThreadPreview,
                    onChangeConnection = {},
                )
            }
        }
    }
}
