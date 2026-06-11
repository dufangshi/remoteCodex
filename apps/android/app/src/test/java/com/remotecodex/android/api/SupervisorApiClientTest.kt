package com.remotecodex.android.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SupervisorApiClientTest {
    @Test
    fun serverLoginPostsCredentialsAndReturnsToken() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"token":"server-token","session":{"authenticated":true,"username":"admin","expiresAt":"2026-01-01T00:00:00.000Z","mode":"server","authRequired":true}}""",
            ),
        )
        val client = SupervisorApiClient(
            SupervisorConnectionConfig(SupervisorConnectionMode.Server, "https://server.example.test"),
            transport,
        )

        val result = client.login("admin", "password")

        assertEquals("server-token", result.token)
        assertEquals("https://server.example.test/api/auth/login", transport.requests.single().url)
        assertEquals("POST", transport.requests.single().method)
        assertTrue(transport.requests.single().body!!.contains("\"username\":\"admin\""))
    }

    @Test
    fun relayLoginUsesRelayAuthEndpoint() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"token":"relay-token","session":{"authenticated":true,"registrationEnabled":true,"user":{"id":"u1","email":"dev@example.test","username":"dev","role":"user","enabled":true}}}""",
            ),
        )
        val client = SupervisorApiClient(
            SupervisorConnectionConfig(SupervisorConnectionMode.Relay, "https://relay.example.test"),
            transport,
        )

        val result = client.relayLogin("dev", "password")

        assertEquals("relay-token", result.token)
        assertEquals("https://relay.example.test/relay/auth/login", transport.requests.single().url)
        assertEquals("POST", transport.requests.single().method)
        assertTrue(transport.requests.single().body!!.contains("\"identifier\":\"dev\""))
    }

    @Test
    fun checkConnectionUsesBearerTokenAndRelayHealth() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"authenticated":true,"registrationEnabled":true,"user":{"id":"u1","email":"dev@example.test","username":"dev","role":"user","enabled":true}}""",
            ),
            SupervisorHttpResponse(
                200,
                """{"status":"ok","supervisorConnected":true,"supervisorConnectedAt":"2026-01-01T00:00:00.000Z","lastSupervisorHeartbeatAt":"2026-01-01T00:00:01.000Z","supervisorCount":1}""",
            ),
        )
        val client = SupervisorApiClient(
            SupervisorConnectionConfig(
                mode = SupervisorConnectionMode.Relay,
                baseUrl = "https://relay.example.test",
                authToken = "relay-token",
                relayDeviceId = "device-1",
            ),
            transport,
        )

        val check = client.checkConnection()

        assertEquals("Authenticated as dev", check.sessionLabel)
        assertTrue(check.authenticated)
        assertEquals("Relay connected", check.healthLabel)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertEquals("https://relay.example.test/relay/auth/session", transport.requests[0].url)
        assertEquals("https://relay.example.test/healthz", transport.requests[1].url)
    }

    @Test
    fun homeSnapshotReadsWorkspaceAndThreadListsThroughRelayDevicePath() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """[{"id":"w1","hostId":"host","label":"Remote Codex","absPath":"/repo","isFavorite":true,"createdAt":"2026-01-01T00:00:00.000Z","lastOpenedAt":"2026-01-02T00:00:00.000Z"}]""",
            ),
            SupervisorHttpResponse(
                200,
                """[{"id":"t1","workspaceId":"w1","title":"Android client","status":"running","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Wire API"}]""",
            ),
        )
        val client = SupervisorApiClient(
            SupervisorConnectionConfig(
                mode = SupervisorConnectionMode.Relay,
                baseUrl = "https://relay.example.test",
                authToken = "relay-token",
                relayDeviceId = "device-1",
            ),
            transport,
        )

        val snapshot = client.fetchHomeSnapshot()

        assertEquals(1, snapshot.workspaces.size)
        assertEquals("Remote Codex", snapshot.workspaces.single().label)
        assertEquals(1, snapshot.threads.size)
        assertEquals("Android client", snapshot.threads.single().title)
        assertEquals(1, snapshot.activeThreadCount)
        assertEquals("https://relay.example.test/relay/devices/device-1/api/workspaces", transport.requests[0].url)
        assertEquals("https://relay.example.test/relay/devices/device-1/api/threads", transport.requests[1].url)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertEquals("relay-token", transport.requests[1].bearerToken)
    }

    private class RecordingTransport(
        private vararg val responses: SupervisorHttpResponse,
    ) : SupervisorHttpTransport {
        val requests = mutableListOf<SupervisorHttpRequest>()

        override fun request(request: SupervisorHttpRequest): SupervisorHttpResponse {
            requests += request
            return responses.getOrElse(requests.size - 1) {
                SupervisorHttpResponse(500, """{"message":"Unexpected request"}""")
            }
        }
    }
}
