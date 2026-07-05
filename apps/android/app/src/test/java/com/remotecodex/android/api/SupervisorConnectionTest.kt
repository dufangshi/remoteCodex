package com.remotecodex.android.api

import org.junit.Assert.assertEquals
import org.junit.Test

class SupervisorConnectionTest {
    @Test
    fun normalizesBaseUrlAndBuildsDirectPaths() {
        val config = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Server,
            baseUrl = "remote.example.test/",
            authToken = "token value",
        )

        assertEquals("http://remote.example.test", config.normalizedBaseUrl)
        assertEquals("/api/auth/session", config.restPath("/api/auth/session"))
        assertEquals("ws://remote.example.test/ws?token=token+value", config.websocketUrl())
    }

    @Test
    fun buildsRelayDevicePathsAndWebsocketUrl() {
        val config = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Relay,
            baseUrl = "https://relay.example.test",
            authToken = "relay-token",
            relayDeviceId = "11111111-1111-4111-8111-111111111111",
        )

        assertEquals(
            "/relay/devices/11111111-1111-4111-8111-111111111111/api/threads",
            config.restPath("/api/threads"),
        )
        assertEquals(
            "wss://relay.example.test/relay/devices/11111111-1111-4111-8111-111111111111/ws?relaySession=relay-token",
            config.websocketUrl(),
        )
    }

    @Test
    fun addsRelayThreadScopeToWebsocketUrl() {
        val config = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Relay,
            baseUrl = "https://relay.example.test",
            authToken = "relay token",
            relayDeviceId = "device/one",
            relayThreadId = "thread shared",
        )

        assertEquals(
            "wss://relay.example.test/relay/devices/device%2Fone/ws?relaySession=relay+token&threadId=thread+shared",
            config.websocketUrl(),
        )
    }

}
