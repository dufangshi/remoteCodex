package com.remotecodex.android.ui.screen

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ThreadDetailPreviewScreenTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun widePreviewShowsCollapsedRoomsRail() {
        composeRule.setContent {
            RemoteCodexTheme(dark = false) {
                Box(modifier = Modifier.requiredSize(width = 900.dp, height = 760.dp)) {
                    ThreadDetailPreviewScreen(
                        themeMode = ThemeMode.System,
                        darkThemeActive = false,
                        supervisorConnection = SupervisorConnectionConfig(
                            mode = SupervisorConnectionMode.Local,
                            baseUrl = "http://10.0.2.2:8787",
                        ),
                        homeSnapshot = null,
                        homeSnapshotLoading = false,
                        homeSnapshotError = null,
                        onThemeModeSelected = {},
                        onChangeConnection = {},
                    )
                }
            }
        }

        composeRule.onNodeWithContentDescription("Expand thread rooms").assertExists()
        composeRule.onNodeWithContentDescription("New Chat").assertExists()
        composeRule.onNodeWithContentDescription("Open thread Android native thread client").assertExists()
        composeRule.onNodeWithContentDescription("Open thread Auth runtime modes").assertExists()
        composeRule.onAllNodesWithText("Shell").assertCountEquals(0)
    }
}
