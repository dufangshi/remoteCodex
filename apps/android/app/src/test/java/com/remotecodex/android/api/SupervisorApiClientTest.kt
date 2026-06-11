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
    fun workspaceTreeAndPreviewUseRelayDevicePath() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"name":"repo","path":"","kind":"directory","children":[{"name":"src","path":"src","kind":"directory","children":[{"name":"Main.kt","path":"src/Main.kt","kind":"file","size":42}]}]}""",
            ),
            SupervisorHttpResponse(
                200,
                """{"path":"src/Main.kt","name":"Main.kt","content":"fun main() = println(\"ok\")","language":"kotlin","size":42,"truncated":true,"nextOffset":24}""",
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

        val tree = client.fetchWorkspaceTree("workspace-1")
        val preview = client.fetchWorkspaceFilePreview(
            workspaceId = "workspace-1",
            path = "src/Main.kt",
            limit = 50000,
        )

        assertEquals("repo", tree.name)
        assertEquals("src", tree.children.single().path)
        assertEquals("Main.kt", tree.children.single().children.single().name)
        assertEquals("src/Main.kt", preview.path)
        assertEquals("kotlin", preview.language)
        assertTrue(preview.truncated)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/workspaces/workspace-1/files/tree",
            transport.requests[0].url,
        )
        assertEquals("GET", transport.requests[0].method)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/workspaces/workspace-1/files/preview?path=src%2FMain.kt&limit=50000",
            transport.requests[1].url,
        )
        assertEquals("GET", transport.requests[1].method)
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
    fun workspaceThreadDetailAndPromptUseRelayDevicePath() {
        val workspaceJson = """{"id":"workspace-1","hostId":"host","label":"Remote Codex","absPath":"/repo","isFavorite":false,"createdAt":"2026-01-01T00:00:00.000Z","lastOpenedAt":null}"""
        val threadJson = """{"id":"thread-1","workspaceId":"workspace-1","title":"Android API","status":"idle","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Wire detail"}"""
        val detailJson = """{"thread":$threadJson,"workspace":$workspaceJson,"workspacePathStatus":"present","turns":[{"id":"turn-1","startedAt":null,"status":"completed","error":null,"tokenUsage":{"total":{"inputTokens":10,"cachedInputTokens":2,"outputTokens":3,"reasoningOutputTokens":1},"last":{"inputTokens":10,"cachedInputTokens":2,"outputTokens":3,"reasoningOutputTokens":1},"modelContextWindow":128000},"items":[{"id":"item-1","kind":"userMessage","text":"Continue"},{"id":"item-2","kind":"agentMessage","text":"Android API reply"}]}],"pendingRequests":[{"id":"request-1","kind":"requestUserInput","title":"Choose mode","description":"Pick a mode","turnId":null,"itemId":null,"createdAt":"2026-01-03T00:00:02.000Z","questions":[{"id":"question-1","header":"Mode","question":"Which mode?","multiSelect":false,"isOther":true,"isSecret":false,"options":[{"label":"Implement","description":"Start coding"}]}]}],"answeredRequestNotes":[{"id":"answered-1","turnId":null,"title":"Mode selected","summaryLines":["Implement"],"createdAt":"2026-01-03T00:00:03.000Z"}],"pendingSteers":[],"liveItems":{"items":[{"id":"item-1"}]},"goal":{"status":"active","objective":"Ship Android client"}}"""
        val transport = RecordingTransport(
            SupervisorHttpResponse(200, workspaceJson),
            SupervisorHttpResponse(200, threadJson),
            SupervisorHttpResponse(200, detailJson),
            SupervisorHttpResponse(200, """{"id":"thread-1","workspaceId":"workspace-1","title":"Android API","status":"running","model":"gpt-5","updatedAt":"2026-01-03T00:00:01.000Z","summaryText":"Continue"}"""),
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

        val workspace = client.createWorkspace(
            CreateSupervisorWorkspaceRequest(
                absPath = "/repo",
                label = "Remote Codex",
            ),
        )
        val thread = client.startThread(
            StartSupervisorThreadRequest(
                workspaceId = "workspace-1",
                title = "Android API",
                model = "gpt-5",
            ),
        )
        val detail = client.fetchThreadDetail("thread-1", limit = 20)
        val prompted = client.sendThreadPrompt("thread-1", SendThreadPromptRequest("Continue"))
        val responded = client.respondToThreadRequest(
            threadId = "thread-1",
            requestId = "request-1",
            request = RespondThreadRequest(
                answers = mapOf(
                    "question-1" to RespondThreadRequestAnswer(listOf("Implement")),
                ),
            ),
        )

        assertEquals("workspace-1", workspace.id)
        assertEquals("thread-1", thread.id)
        assertEquals("Android API", detail.thread.title)
        assertEquals(1, detail.turnCount)
        assertEquals(1, detail.liveItemCount)
        assertEquals(1, detail.pendingRequests.size)
        assertEquals("question-1", detail.pendingRequests.single().questions.single().id)
        assertEquals("Implement", detail.pendingRequests.single().questions.single().options.single().label)
        assertEquals(1, detail.answeredRequestNotes.size)
        assertEquals("Android API reply", detail.latestAgentMessage)
        assertEquals("running", prompted.status)
        assertEquals("Android API", responded.thread.title)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/workspaces",
            transport.requests[0].url,
        )
        assertEquals("POST", transport.requests[0].method)
        assertTrue(transport.requests[0].body!!.contains("\"absPath\":\"/repo\""))
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/start",
            transport.requests[1].url,
        )
        assertEquals("POST", transport.requests[1].method)
        assertTrue(transport.requests[1].body!!.contains("\"workspaceId\":\"workspace-1\""))
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1?limit=20",
            transport.requests[2].url,
        )
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/prompt",
            transport.requests[3].url,
        )
        assertEquals("POST", transport.requests[3].method)
        assertTrue(transport.requests[3].body!!.contains("\"prompt\":\"Continue\""))
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/requests/request-1/respond",
            transport.requests[4].url,
        )
        assertEquals("POST", transport.requests[4].method)
        assertTrue(transport.requests[4].body!!.contains("\"question-1\":{\"answers\":[\"Implement\"]}"))
    }

    @Test
    fun threadShellStateCreateAndTerminateUseRelayDevicePath() {
        val shellJson = """{"id":"shell-1","threadId":"thread-1","workspaceId":"workspace-1","label":"Android shell","tmuxSessionName":"rcd-shell","backend":"tmux","cwd":"/repo","status":"running","attachedViewerId":null,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:01.000Z","lastActivityAt":"2026-01-01T00:00:02.000Z"}"""
        val stateJson = """{"threadId":"thread-1","workspaceId":"workspace-1","workspacePathStatus":"present","state":"running","shell":$shellJson,"shells":[$shellJson],"activeShellId":"shell-1"}"""
        val terminatedStateJson = """{"threadId":"thread-1","workspaceId":"workspace-1","workspacePathStatus":"present","state":"exited","shell":null,"shells":[],"activeShellId":null}"""
        val transport = RecordingTransport(
            SupervisorHttpResponse(200, stateJson),
            SupervisorHttpResponse(200, stateJson),
            SupervisorHttpResponse(200, terminatedStateJson),
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

        val state = client.fetchThreadShellState("thread-1")
        val created = client.createThreadShell(
            threadId = "thread-1",
            request = CreateSupervisorShellRequest(cols = 120, rows = 30, label = "Android shell"),
        )
        val terminated = client.terminateShell("shell-1")

        assertEquals("running", state.state)
        assertEquals("Android shell", state.shell!!.label)
        assertEquals("shell-1", created.activeShellId)
        assertEquals("exited", terminated.state)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/shell",
            transport.requests[0].url,
        )
        assertEquals("GET", transport.requests[0].method)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/shell",
            transport.requests[1].url,
        )
        assertEquals("POST", transport.requests[1].method)
        assertTrue(transport.requests[1].body!!.contains("\"cols\":120"))
        assertTrue(transport.requests[1].body!!.contains("\"rows\":30"))
        assertTrue(transport.requests[1].body!!.contains("\"label\":\"Android shell\""))
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/shells/shell-1/terminate",
            transport.requests[2].url,
        )
        assertEquals("POST", transport.requests[2].method)
    }

    @Test
    fun threadRenameAndDeleteUseRelayDevicePath() {
        val renamedThreadJson = """{"id":"thread-1","workspaceId":"workspace-1","title":"Renamed Android API","status":"idle","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Wire detail"}"""
        val deletedThreadJson = """{"id":"thread-1","workspaceId":"workspace-1","title":"Renamed Android API","status":"idle","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Wire detail"}"""
        val transport = RecordingTransport(
            SupervisorHttpResponse(200, renamedThreadJson),
            SupervisorHttpResponse(200, deletedThreadJson),
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

        val renamed = client.updateThread("thread-1", UpdateThreadRequest(title = "Renamed Android API"))
        val deleted = client.deleteThread("thread-1")

        assertEquals("Renamed Android API", renamed.title)
        assertEquals("thread-1", deleted.id)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1",
            transport.requests[0].url,
        )
        assertEquals("PATCH", transport.requests[0].method)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertTrue(transport.requests[0].body!!.contains("\"title\":\"Renamed Android API\""))
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1",
            transport.requests[1].url,
        )
        assertEquals("DELETE", transport.requests[1].method)
        assertEquals("relay-token", transport.requests[1].bearerToken)
    }

    @Test
    fun interruptThreadUsesRelayDevicePath() {
        val interruptedThreadJson = """{"id":"thread-1","workspaceId":"workspace-1","title":"Android API","status":"interrupted","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Stopped"}"""
        val transport = RecordingTransport(
            SupervisorHttpResponse(200, interruptedThreadJson),
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

        val interrupted = client.interruptThread("thread-1", turnId = "turn-1")

        assertEquals("interrupted", interrupted.status)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/interrupt",
            transport.requests.single().url,
        )
        assertEquals("POST", transport.requests.single().method)
        assertEquals("relay-token", transport.requests.single().bearerToken)
        assertTrue(transport.requests.single().body!!.contains("\"turnId\":\"turn-1\""))
    }

    @Test
    fun updateThreadSettingsUsesRelayDevicePath() {
        val updatedThreadJson = """{"id":"thread-1","workspaceId":"workspace-1","title":"Android API","status":"idle","model":"gpt-5.1","reasoningEffort":"high","fastMode":true,"collaborationMode":"plan","sandboxMode":"danger-full-access","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Settings updated"}"""
        val transport = RecordingTransport(
            SupervisorHttpResponse(200, updatedThreadJson),
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

        val updated = client.updateThreadSettings(
            "thread-1",
            UpdateThreadSettingsRequest(
                model = "gpt-5.1",
                reasoningEffort = "high",
                fastMode = true,
                collaborationMode = "plan",
                sandboxMode = "danger-full-access",
            ),
        )

        assertEquals("gpt-5.1", updated.model)
        assertEquals("high", updated.reasoningEffort)
        assertTrue(updated.fastMode)
        assertEquals("plan", updated.collaborationMode)
        assertEquals("danger-full-access", updated.sandboxMode)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/settings",
            transport.requests.single().url,
        )
        assertEquals("PATCH", transport.requests.single().method)
        assertEquals("relay-token", transport.requests.single().bearerToken)
        val body = transport.requests.single().body!!
        assertTrue(body.contains("\"model\":\"gpt-5.1\""))
        assertTrue(body.contains("\"reasoningEffort\":\"high\""))
        assertTrue(body.contains("\"fastMode\":true"))
        assertTrue(body.contains("\"collaborationMode\":\"plan\""))
        assertTrue(body.contains("\"sandboxMode\":\"danger-full-access\""))
    }

    @Test
    fun updateThreadGoalUsesRelayDevicePath() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"goal":{"status":"active","objective":"Ship Android goal","tokenBudget":12500}}""",
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

        client.updateThreadGoal(
            "thread-1",
            UpdateThreadGoalRequest(
                objective = "Ship Android goal",
                status = "active",
                tokenBudget = 12500,
            ),
        )

        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/goal",
            transport.requests.single().url,
        )
        assertEquals("PATCH", transport.requests.single().method)
        assertEquals("relay-token", transport.requests.single().bearerToken)
        val body = transport.requests.single().body!!
        assertTrue(body.contains("\"objective\":\"Ship Android goal\""))
        assertTrue(body.contains("\"status\":\"active\""))
        assertTrue(body.contains("\"tokenBudget\":12500"))
    }

    @Test
    fun compactThreadUsesRelayDevicePath() {
        val compactedThreadJson = """{"id":"thread-1","workspaceId":"workspace-1","title":"Android API","status":"idle","model":"gpt-5","reasoningEffort":"medium","fastMode":false,"collaborationMode":"default","sandboxMode":"workspace-write","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Compacted"}"""
        val transport = RecordingTransport(
            SupervisorHttpResponse(200, compactedThreadJson),
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

        val compacted = client.compactThread("thread-1")

        assertEquals("Compacted", compacted.summaryText)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/compact",
            transport.requests.single().url,
        )
        assertEquals("POST", transport.requests.single().method)
        assertEquals("relay-token", transport.requests.single().bearerToken)
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
