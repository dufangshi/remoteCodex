package com.remotecodex.android.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
            "wss://relay.example.test/relay/devices/11111111-1111-4111-8111-111111111111/ws?token=relay-token",
            config.websocketUrl(),
        )
    }

    @Test
    fun parsesJsonPairingPayload() {
        val payload = parseSupervisorPairingPayload(
            """{"mode":"relay","baseUrl":"https://relay.example.test","token":"abc","deviceId":"device-1"}""",
        )

        assertEquals(SupervisorConnectionMode.Relay, payload.mode)
        assertEquals("https://relay.example.test", payload.baseUrl)
        assertEquals("abc", payload.token)
        assertEquals("device-1", payload.relayDeviceId)
    }

    @Test
    fun parsesUriPairingPayload() {
        val payload = parseSupervisorPairingPayload(
            "remote-codex://connect?mode=server&baseUrl=https%3A%2F%2Fserver.example.test&token=abc",
        )

        assertEquals(SupervisorConnectionMode.Server, payload.mode)
        assertEquals("https://server.example.test", payload.baseUrl)
        assertEquals("abc", payload.token)
        assertNull(payload.relayDeviceId)
    }
}
