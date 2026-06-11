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

    @Test
    fun relayPortalListsDeviceConnectionStatus() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"user":{"id":"u1","email":"dev@example.test","username":"dev","role":"user","enabled":true,"createdAt":"2026-01-01T00:00:00.000Z"},"devices":[{"id":"device-1","ownerUserId":"u1","name":"Home workstation","tokenPreview":"rcd_abc...xyz","connected":true,"connectedAt":"2026-01-02T00:00:00.000Z","lastHeartbeatAt":"2026-01-02T00:00:30.000Z","createdAt":"2026-01-01T00:00:00.000Z"}],"sharedWithMe":[],"sharedByMe":[]}""",
            ),
        )
        val client = SupervisorApiClient(
            SupervisorConnectionConfig(
                mode = SupervisorConnectionMode.Relay,
                baseUrl = "https://relay.example.test",
                authToken = "relay-token",
            ),
            transport,
        )

        val portal = client.fetchRelayPortal()

        assertEquals(1, portal.devices.size)
        assertEquals("Home workstation", portal.devices.single().name)
        assertTrue(portal.devices.single().connected)
        assertEquals("2026-01-02T00:00:30.000Z", portal.devices.single().lastHeartbeatAt)
        assertEquals("https://relay.example.test/relay/portal", transport.requests.single().url)
        assertEquals("relay-token", transport.requests.single().bearerToken)
    }

    @Test
    fun createRelayDeviceReturnsOneTimeToken() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"device":{"id":"device-1","ownerUserId":"u1","name":"Phone registered backend","tokenPreview":"rcd_abc...xyz","connected":false,"connectedAt":null,"lastHeartbeatAt":null,"createdAt":"2026-01-01T00:00:00.000Z"},"token":"rcd_secret_device_token"}""",
            ),
        )
        val client = SupervisorApiClient(
            SupervisorConnectionConfig(
                mode = SupervisorConnectionMode.Relay,
                baseUrl = "https://relay.example.test",
                authToken = "relay-token",
            ),
            transport,
        )

        val result = client.createRelayDevice("Phone registered backend")

        assertEquals("device-1", result.device.id)
        assertEquals("rcd_secret_device_token", result.token)
        assertEquals("https://relay.example.test/relay/devices", transport.requests.single().url)
        assertEquals("POST", transport.requests.single().method)
        assertTrue(transport.requests.single().body!!.contains("\"name\":\"Phone registered backend\""))
    }

    @Test
    fun threadDetailAndPromptUseRelayDevicePath() {
        val detailJson = """{"thread":{"id":"thread-1","workspaceId":"workspace-1","title":"Android API","status":"running","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Wire detail"},"workspace":{"id":"workspace-1","hostId":"host","label":"Remote Codex","absPath":"/repo","isFavorite":false,"createdAt":"2026-01-01T00:00:00.000Z","lastOpenedAt":null},"workspacePathStatus":"present","turns":[{"id":"turn-1","startedAt":null,"status":"inProgress","error":null,"items":[]}],"pendingRequests":[],"pendingSteers":[],"liveItems":{"items":[{"id":"item-1"}]},"goal":{"status":"active","objective":"Ship Android client"}}"""
        val transport = RecordingTransport(
            SupervisorHttpResponse(200, detailJson),
            SupervisorHttpResponse(200, detailJson),
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

        val detail = client.fetchThreadDetail("thread-1", limit = 20)
        val prompted = client.sendThreadPrompt("thread-1", SendThreadPromptRequest("Continue"))

        assertEquals("Android API", detail.thread.title)
        assertEquals(1, detail.turnCount)
        assertEquals(1, detail.liveItemCount)
        assertEquals("active", prompted.goalStatus)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1?limit=20",
            transport.requests[0].url,
        )
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/prompt",
            transport.requests[1].url,
        )
        assertEquals("POST", transport.requests[1].method)
        assertTrue(transport.requests[1].body!!.contains("\"prompt\":\"Continue\""))
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
