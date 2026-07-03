package com.remotecodex.android.ui.screen

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.remotecodex.android.api.SupervisorConnectionCheck
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.settings.SavedSupervisorDevice
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SupervisorConnectionSetupScreenServerE2ETest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun addServerDeviceThroughUiLogsInAndConnects() {
        val args = InstrumentationRegistry.getArguments()
        val serverBaseUrl = args.getString("serverBaseUrl") ?: "http://10.0.2.2:8791"
        val username = args.getString("serverUsername") ?: "admin"
        val password = args.getString("serverPassword") ?: "server-mode-password"

        assumeTrue("Server-mode supervisor is not reachable at $serverBaseUrl", serverModeReachable(serverBaseUrl))

        var savedDevices by mutableStateOf<List<SavedSupervisorDevice>>(emptyList())
        var connectedConfig: SupervisorConnectionConfig? = null
        var connectedCheck: SupervisorConnectionCheck? = null
        var connectionError: Throwable? = null

        composeRule.setContent {
            RemoteCodexTheme(dark = false) {
                SupervisorConnectionSetupScreen(
                    initialConfig = null,
                    savedDevices = savedDevices,
                    activeDeviceId = null,
                    onConnectionReady = { config, check ->
                        connectedConfig = config
                        connectedCheck = check
                    },
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
        composeRule.onNodeWithContentDescription("Connection mode Server").performClick()
        composeRule.onNodeWithContentDescription("Device URL").performTextReplacement(serverBaseUrl)
        composeRule.onNodeWithContentDescription("Device username").performTextReplacement(username)
        composeRule.onNodeWithContentDescription("Device password").performTextReplacement(password)
        composeRule.onNodeWithText("Save").performClick()

        composeRule.waitUntil(timeoutMillis = 5_000) {
            savedDevices.any {
                it.mode == SupervisorConnectionMode.Server &&
                    it.normalizedBaseUrl == serverBaseUrl &&
                    it.username == username &&
                    it.password == password
            }
        }
        composeRule.onNodeWithContentDescription("Connect device Server").performClick()

        composeRule.waitUntil(timeoutMillis = 10_000) {
            try {
                connectedConfig != null || connectionError != null
            } catch (error: Throwable) {
                connectionError = error
                true
            }
        }

        assertNull(connectionError)
        val config = requireNotNull(connectedConfig)
        assertEquals(SupervisorConnectionMode.Server, config.mode)
        assertEquals(serverBaseUrl, config.normalizedBaseUrl)
        assertTrue(config.authToken?.isNotBlank() == true)
        assertNotNull(connectedCheck)
        assertTrue(connectedCheck?.authenticated == true)
        assertTrue(savedDevices.any { it.mode == SupervisorConnectionMode.Server && !it.authToken.isNullOrBlank() })
    }

    private fun serverModeReachable(baseUrl: String): Boolean {
        return runCatching {
            val connection = (URL("$baseUrl/api/auth/session").openConnection() as HttpURLConnection).apply {
                connectTimeout = 1_000
                readTimeout = 1_000
                requestMethod = "GET"
            }
            try {
                connection.responseCode == 200 &&
                    connection.inputStream.bufferedReader().use { body ->
                        body.readText().contains("\"mode\":\"server\"")
                    }
            } finally {
                connection.disconnect()
            }
        }.getOrDefault(false)
    }
}
