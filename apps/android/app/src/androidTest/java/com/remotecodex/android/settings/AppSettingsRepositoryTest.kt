package com.remotecodex.android.settings

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppSettingsRepositoryTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        clearPreferences()
    }

    @After
    fun tearDown() {
        clearPreferences()
    }

    @Test
    fun savedSupervisorDevicesPersistAcrossRepositoryInstances() {
        val repository = AppSettingsRepository(context)
        val local = SavedSupervisorDevice(
            id = "local-1",
            name = "Local 8821",
            mode = SupervisorConnectionMode.Local,
            baseUrl = "http://10.0.2.2:8821/",
        )
        val server = SavedSupervisorDevice(
            id = "server-1",
            name = "Server staging",
            mode = SupervisorConnectionMode.Server,
            baseUrl = "https://server.example.test/",
            username = "admin",
            password = "server-password",
            authToken = "server-token",
        )
        val relay = SavedSupervisorDevice(
            id = "relay-1",
            name = "Relay mac",
            mode = SupervisorConnectionMode.Relay,
            baseUrl = "https://relay.example.test/",
            username = "relay-user",
            password = "relay-password",
            authToken = "relay-session",
            relayDeviceId = "device-mac",
        )

        repository.writeSavedSupervisorDevices(listOf(local, server, relay))

        val restored = AppSettingsRepository(context).readSavedSupervisorDevices()
        assertEquals(listOf("local-1", "server-1", "relay-1"), restored.map { it.id })
        assertEquals("http://10.0.2.2:8821", restored[0].normalizedBaseUrl)
        assertEquals("https://server.example.test", restored[1].normalizedBaseUrl)
        assertEquals("admin", restored[1].username)
        assertEquals("server-password", restored[1].password)
        assertEquals("server-token", restored[1].authToken)
        assertEquals("https://relay.example.test", restored[2].normalizedBaseUrl)
        assertEquals("relay-session", restored[2].authToken)
        assertEquals("device-mac", restored[2].relayDeviceId)

        repository.upsertSavedSupervisorDevice(server.copy(name = "Server renamed", authToken = "server-token-2"))
        repository.deleteSavedSupervisorDevice(local.id)

        val updated = AppSettingsRepository(context).readSavedSupervisorDevices()
        assertEquals(listOf("relay-1", "server-1"), updated.map { it.id })
        assertEquals("Server renamed", updated.single { it.id == "server-1" }.name)
        assertEquals("server-token-2", updated.single { it.id == "server-1" }.authToken)
    }

    @Test
    fun activeConnectionAndLastRoutesAreIsolatedPerDevice() {
        val repository = AppSettingsRepository(context)
        val localConfig = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Local,
            baseUrl = "http://10.0.2.2:8821/",
        )
        val relayMacConfig = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Relay,
            baseUrl = "https://relay.example.test/",
            authToken = "relay-session",
            relayDeviceId = "mac",
        )
        val relayWslConfig = relayMacConfig.copy(relayDeviceId = "wsl")

        repository.writeSupervisorConnection(relayMacConfig)
        repository.writeLastRoute(localConfig, SavedAppRoute.WorkspaceDetail("workspace-local"))
        repository.writeLastRoute(relayMacConfig, SavedAppRoute.ThreadDetail("thread-mac", "workspace-mac"))
        repository.writeLastRoute(relayWslConfig, SavedAppRoute.WorkspaceDetail("workspace-wsl"))

        val restored = AppSettingsRepository(context)
        assertEquals(relayMacConfig.copy(baseUrl = relayMacConfig.normalizedBaseUrl), restored.readSupervisorConnection())
        assertEquals(SavedAppRoute.WorkspaceDetail("workspace-local"), restored.readLastRoute(localConfig))
        assertEquals(SavedAppRoute.ThreadDetail("thread-mac", "workspace-mac"), restored.readLastRoute(relayMacConfig))
        assertEquals(SavedAppRoute.WorkspaceDetail("workspace-wsl"), restored.readLastRoute(relayWslConfig))

        restored.clearRelayDeviceSelection()
        val withoutDevice = AppSettingsRepository(context).readSupervisorConnection()
        assertEquals(SupervisorConnectionMode.Relay, withoutDevice?.mode)
        assertEquals("https://relay.example.test", withoutDevice?.normalizedBaseUrl)
        assertEquals("relay-session", withoutDevice?.authToken)
        assertNull(withoutDevice?.relayDeviceId)
    }

    private fun clearPreferences() {
        context.getSharedPreferences("remote_codex_preferences", Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }
}
