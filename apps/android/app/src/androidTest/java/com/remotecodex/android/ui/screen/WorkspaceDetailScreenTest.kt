package com.remotecodex.android.ui.screen

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WorkspaceDetailScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun workspaceDetailShowsScopedThreadsAndOpensThread() {
        var openedThreadId: String? = null

        composeRule.setContent {
            RemoteCodexTheme(dark = false) {
                WorkspaceDetailScreen(
                    workspaceId = "workspace-1",
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
                                id = "thread-other",
                                workspaceId = "workspace-other",
                                title = "Other workspace thread",
                                status = "idle",
                                model = "gpt-5",
                                reasoningEffort = "low",
                                fastMode = false,
                                collaborationMode = "default",
                                sandboxMode = "workspace-write",
                                updatedAt = "2026-06-11T11:00:00.000Z",
                                summaryText = null,
                            ),
                        ),
                    ),
                    homeSnapshotLoading = false,
                    homeSnapshotError = null,
                    onBackToHome = {},
                    onOpenDevices = {},
                    onOpenThread = { openedThreadId = it },
                    onRefreshHomeSnapshot = {},
                )
            }
        }

        composeRule.onNodeWithText("remoteCodex-main").assertExists()
        composeRule.onAllNodesWithText("/home/u/dev/remoteCodex-main").assertCountEquals(2)
        composeRule.onNodeWithText("1 in this workspace").assertExists()
        composeRule.onNodeWithContentDescription("Open workspace menu").assertExists()
        composeRule.onNodeWithText("Threads").assertExists()
        composeRule.onNodeWithText("Android native thread client").assertExists()
        composeRule.onNodeWithText("running / gpt-5").assertExists()
        composeRule.onNodeWithText("Other workspace thread").assertDoesNotExist()
        composeRule.onNodeWithText("Files").assertDoesNotExist()

        composeRule.onNodeWithContentDescription("Open workspace thread Android native thread client").performClick()
        assertEquals("thread-1", openedThreadId)
    }

    @Test
    fun workspaceMenuRoutesBackHomeAndDevices() {
        var backHomeCount = 0
        var openDevicesCount = 0

        composeRule.setContent {
            RemoteCodexTheme(dark = false) {
                WorkspaceDetailScreen(
                    workspaceId = "workspace-1",
                    supervisorConnection = SupervisorConnectionConfig(
                        mode = SupervisorConnectionMode.Local,
                        baseUrl = "http://10.0.2.2:8787",
                    ),
                    homeSnapshot = workspaceSnapshot(),
                    homeSnapshotLoading = false,
                    homeSnapshotError = null,
                    onBackToHome = { backHomeCount += 1 },
                    onOpenDevices = { openDevicesCount += 1 },
                    onOpenThread = {},
                    onRefreshHomeSnapshot = {},
                )
            }
        }

        composeRule.onNodeWithContentDescription("Open workspace menu").performClick()
        composeRule.onNodeWithContentDescription("Back to home").performClick()
        assertEquals(1, backHomeCount)

        composeRule.onNodeWithContentDescription("Open workspace menu").performClick()
        composeRule.onNodeWithContentDescription("Open devices").performClick()
        assertEquals(1, openDevicesCount)
    }

    private fun workspaceSnapshot(): SupervisorHomeSnapshot {
        return SupervisorHomeSnapshot(
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
                    id = "thread-other",
                    workspaceId = "workspace-other",
                    title = "Other workspace thread",
                    status = "idle",
                    model = "gpt-5",
                    reasoningEffort = "low",
                    fastMode = false,
                    collaborationMode = "default",
                    sandboxMode = "workspace-write",
                    updatedAt = "2026-06-11T11:00:00.000Z",
                    summaryText = null,
                ),
            ),
        )
    }
}
