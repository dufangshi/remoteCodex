package com.remotecodex.android.ui.screen

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.settings.SavedSupervisorDevice
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SupervisorConnectionSetupScreenRelayE2ETest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun addRelayAccountThroughUiLogsInAndCreatesDevice() {
        val args = InstrumentationRegistry.getArguments()
        val relayBaseUrl = args.getString("relayBaseUrl") ?: "http://10.0.2.2:8788"
        val username = args.getString("relayUsername") ?: "admin"
        val password = args.getString("relayPassword") ?: "relay-admin-password"

        assumeTrue("Relay server is not reachable at $relayBaseUrl", relayModeReachable(relayBaseUrl))

        var savedDevices by mutableStateOf<List<SavedSupervisorDevice>>(emptyList())

        composeRule.setContent {
            RemoteCodexTheme(dark = false) {
                SupervisorConnectionSetupScreen(
                    initialConfig = null,
                    savedDevices = savedDevices,
                    activeDeviceId = null,
                    onConnectionReady = { _, _ -> },
                    onSavedDeviceUpsert = { device ->
                        savedDevices = savedDevices
                            .filterNot { it.id == device.id }
                            .plus(device)
                    },
                )
            }
        }

        composeRule.onNodeWithContentDescription("Add device").performClick()
        composeRule.onNodeWithText("Add Device").assertExists()
        composeRule.onNodeWithContentDescription("Connection mode Relay").performClick()
        composeRule.onNodeWithContentDescription("Device URL").performTextReplacement(relayBaseUrl)
        composeRule.onNodeWithContentDescription("Device username").performTextReplacement(username)
        composeRule.onNodeWithContentDescription("Device password").performTextReplacement(password)
        composeRule.onNodeWithText("Save").performClick()

        composeRule.waitUntil(timeoutMillis = 5_000) {
            savedDevices.any {
                it.mode == SupervisorConnectionMode.Relay &&
                    it.normalizedBaseUrl == relayBaseUrl &&
                    it.username == username &&
                    it.password == password
            }
        }
        composeRule.onNodeWithContentDescription("Open relay devices Relay").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000) {
            savedDevices.any { it.mode == SupervisorConnectionMode.Relay && !it.authToken.isNullOrBlank() }
        }
        assertTrue(composeRule.onAllNodesWithText("Relay Devices").fetchSemanticsNodes().isNotEmpty())
        assertTrue(savedDevices.any { it.mode == SupervisorConnectionMode.Relay && !it.authToken.isNullOrBlank() })

        composeRule.onNodeWithContentDescription("Create relay device").performClick()
        composeRule.onNodeWithContentDescription("New relay device name")
            .performTextReplacement("Android relay login test")
        composeRule.onNodeWithText("Create").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000) {
            savedDevices.any {
                it.mode == SupervisorConnectionMode.Relay &&
                    !it.authToken.isNullOrBlank() &&
                    !it.relayDeviceId.isNullOrBlank()
            }
        }
        composeRule.onNodeWithText("Android relay login test").assertExists()
        assertTrue(savedDevices.any { it.mode == SupervisorConnectionMode.Relay && !it.relayDeviceId.isNullOrBlank() })
    }

    private fun relayModeReachable(baseUrl: String): Boolean {
        return runCatching {
            val connection = (URL("$baseUrl/relay/auth/session").openConnection() as HttpURLConnection).apply {
                connectTimeout = 1_000
                readTimeout = 1_000
                requestMethod = "GET"
            }
            try {
                connection.responseCode == 200
            } finally {
                connection.disconnect()
            }
        }.getOrDefault(false)
    }
}
