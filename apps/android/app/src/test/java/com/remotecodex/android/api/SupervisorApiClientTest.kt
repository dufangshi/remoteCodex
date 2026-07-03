package com.remotecodex.android.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    fun relayRegisterUsesRelayAuthEndpoint() {
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

        val result = client.relayRegister("dev@example.test", "dev", "password123")

        assertEquals("relay-token", result.token)
        assertEquals("https://relay.example.test/relay/auth/register", transport.requests.single().url)
        assertEquals("POST", transport.requests.single().method)
        assertTrue(transport.requests.single().body!!.contains("\"email\":\"dev@example.test\""))
        assertTrue(transport.requests.single().body!!.contains("\"username\":\"dev\""))
    }

    @Test
    fun checkConnectionUsesBearerTokenAndRelayDeviceHealth() {
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
        assertEquals("https://relay.example.test/relay/devices/device-1/healthz", transport.requests[1].url)
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
    fun startThreadPostsWorkspaceModelAndTitleThroughRelayDevicePath() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"id":"thread-1","workspaceId":"workspace-1","title":"Android started thread","status":"idle","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":null}""",
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

        val thread = client.startThread(
            StartSupervisorThreadRequest(
                workspaceId = "workspace-1",
                title = "Android started thread",
                model = "gpt-5",
                approvalMode = "yolo",
                provider = "codex",
                reasoningEffort = "xhigh",
            ),
        )

        assertEquals("thread-1", thread.id)
        assertEquals("workspace-1", thread.workspaceId)
        assertEquals("Android started thread", thread.title)
        assertEquals("https://relay.example.test/relay/devices/device-1/api/threads/start", transport.requests.single().url)
        assertEquals("POST", transport.requests.single().method)
        assertEquals("relay-token", transport.requests.single().bearerToken)
        val body = transport.requests.single().body!!
        assertTrue(body.contains("\"workspaceId\":\"workspace-1\""))
        assertTrue(body.contains("\"title\":\"Android started thread\""))
        assertTrue(body.contains("\"model\":\"gpt-5\""))
        assertTrue(body.contains("\"approvalMode\":\"yolo\""))
        assertTrue(body.contains("\"provider\":\"codex\""))
        assertTrue(body.contains("\"reasoningEffort\":\"xhigh\""))
    }

    @Test
    fun listAgentModelsParsesReasoningOptions() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """[{"id":"gpt-5","model":"gpt-5","displayName":"GPT-5","description":"Flagship","isDefault":true,"hidden":false,"defaultReasoningEffort":"xhigh","supportedReasoningEfforts":[{"reasoningEffort":"low","description":"Fast"},{"reasoningEffort":"xhigh","description":"Deep"}]}]""",
            ),
        )
        val client = SupervisorApiClient(
            SupervisorConnectionConfig(SupervisorConnectionMode.Server, "https://server.example.test"),
            transport,
        )

        val models = client.listAgentModels("codex")

        assertEquals("https://server.example.test/api/agent-runtimes/codex/models", transport.requests.single().url)
        assertEquals("gpt-5", models.single().model)
        assertEquals("xhigh", models.single().defaultReasoningEffort)
        assertEquals(listOf("low", "xhigh"), models.single().supportedReasoningEfforts.map { it.reasoningEffort })
    }

    @Test
    fun importThreadPostsProviderAndSessionThroughRelayDevicePath() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"thread":{"id":"thread-imported","workspaceId":"workspace-1","title":"Imported","status":"idle","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":null},"workspace":{"id":"workspace-1","label":"Remote Codex","absPath":"/repo","isFavorite":false,"lastOpenedAt":null},"turns":[],"pendingRequests":[],"answeredRequestNotes":[],"liveItems":{"items":[]}}""",
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

        val detail = client.importThread(
            ImportSupervisorThreadRequest(
                sessionId = "session-1",
                provider = "claude",
            ),
        )

        assertEquals("thread-imported", detail.thread.id)
        assertEquals("https://relay.example.test/relay/devices/device-1/api/threads/import", transport.requests.single().url)
        assertEquals("POST", transport.requests.single().method)
        val body = transport.requests.single().body!!
        assertTrue(body.contains("\"sessionId\":\"session-1\""))
        assertTrue(body.contains("\"provider\":\"claude\""))
    }

    @Test
    fun forkThreadUsesRelayDevicePathAndParsesForkResult() {
        val workspaceJson = """{"id":"workspace-1","label":"Remote Codex","absPath":"/repo","isFavorite":false,"lastOpenedAt":null}"""
        val forkedThreadJson = """{"id":"thread-2","workspaceId":"workspace-1","title":"Forked Android API","status":"idle","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Forked"}"""
        val forkedDetailJson = """{"thread":$forkedThreadJson,"workspace":$workspaceJson,"workspacePathStatus":"present","turns":[],"pendingRequests":[],"answeredRequestNotes":[],"pendingSteers":[],"liveItems":{"items":[]}}"""
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """[{"turnId":"turn-1","turnIndex":1,"startedAt":"2026-01-03T00:00:00.000Z","status":"completed"}]""",
            ),
            SupervisorHttpResponse(
                200,
                """{"thread":$forkedDetailJson,"sourceThreadId":"thread-1","sourceTurnId":"turn-1","sourceTurnIndex":1}""",
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

        val options = client.fetchThreadForkTurns("thread-1")
        val result = client.forkThread("thread-1", ForkThreadRequest(mode = "turn", turnId = "turn-1"))

        assertEquals("turn-1", options.single().turnId)
        assertEquals(1, options.single().turnIndex)
        assertEquals("completed", options.single().status)
        assertEquals("thread-2", result.thread.thread.id)
        assertEquals("thread-1", result.sourceThreadId)
        assertEquals("turn-1", result.sourceTurnId)
        assertEquals(1, result.sourceTurnIndex)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/fork-turns",
            transport.requests[0].url,
        )
        assertEquals("GET", transport.requests[0].method)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/fork",
            transport.requests[1].url,
        )
        assertEquals("POST", transport.requests[1].method)
        assertEquals("relay-token", transport.requests[1].bearerToken)
        val body = transport.requests[1].body!!
        assertTrue(body.contains("\"mode\":\"turn\""))
        assertTrue(body.contains("\"turnId\":\"turn-1\""))
    }

    @Test
    fun threadExportTurnsAndDownloadUseRelayDevicePath() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"turns":[{"turnId":"turn-1","turnIndex":1,"startedAt":"2026-01-03T00:00:00.000Z","status":"completed","userPromptPreview":"Ship export"}],"totalTurnCount":1}""",
            ),
            SupervisorHttpResponse(
                statusCode = 200,
                body = null,
                headers = mapOf(
                    "content-disposition" to """attachment; filename="android-export.html"""",
                    "content-type" to "text/html",
                ),
                bytes = "<html>ok</html>".toByteArray(),
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

        val turns = client.fetchThreadExportTurns("thread-1")
        val download = client.downloadThreadTranscriptExport(
            "thread-1",
            ExportThreadRequest(
                format = "html",
                mode = "selected",
                turnIds = listOf("turn-1"),
                includeTokenAndPrice = false,
            ),
        )

        assertEquals("turn-1", turns.turns.single().turnId)
        assertEquals("Ship export", turns.turns.single().userPromptPreview)
        assertEquals("android-export.html", download.filename)
        assertEquals("text/html", download.contentType)
        assertEquals("<html>ok</html>", download.bytes.toString(Charsets.UTF_8))
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/export-turns",
            transport.requests[0].url,
        )
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/exports/pdf?format=html&mode=selected&turnIds=turn-1&profile=review&includeTokenAndPrice=false",
            transport.requests[1].url,
        )
        assertEquals("*/*", transport.requests[1].accept)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertEquals("relay-token", transport.requests[1].bearerToken)
    }

    @Test
    fun composerPanelsUseRelayDevicePathAndParseSkillsMcpHooks() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"cwd":"/repo","skills":[{"name":"android-client","description":"Android work","shortDescription":"Android","interface":{"shortDescription":"Native Android"},"path":"/repo/.codex/skills/android-client/SKILL.md","scope":"repo","enabled":true}],"errors":[{"path":"/bad/SKILL.md","message":"bad skill"}]}""",
            ),
            SupervisorHttpResponse(
                200,
                """{"servers":[{"name":"docs","authStatus":"unsupported","tools":[{"name":"search_docs","title":"Search docs","description":"Search"}],"resourceCount":1,"resourceTemplateCount":2}]}""",
            ),
            SupervisorHttpResponse(
                200,
                """{"cwd":"/repo","hooks":[{"key":"hook-1","eventName":"preToolUse","handlerType":"command","matcher":"Bash","command":"scripts/check.sh","timeoutSec":30,"statusMessage":"Checking","sourcePath":"/repo/.codex/hooks.json","source":"project","pluginId":null,"displayOrder":1,"enabled":true,"isManaged":false,"currentHash":"hash-1","trustStatus":"modified"}],"warnings":["review hook"],"errors":[{"path":"/bad/hooks.json","message":"bad hook"}],"globalHooksPath":"/home/u/.codex/hooks.json","projectHooksPath":"/repo/.codex/hooks.json"}""",
            ),
            SupervisorHttpResponse(
                200,
                """{"cwd":"/repo","hooks":[],"warnings":[],"errors":[],"globalHooksPath":"/home/u/.codex/hooks.json","projectHooksPath":"/repo/.codex/hooks.json"}""",
            ),
            SupervisorHttpResponse(
                200,
                """{"cwd":"/repo","hooks":[],"warnings":[],"errors":[],"globalHooksPath":"/home/u/.codex/hooks.json","projectHooksPath":"/repo/.codex/hooks.json"}""",
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

        val skills = client.fetchThreadSkills("thread-1")
        val mcp = client.fetchThreadMcpServers("thread-1")
        val hooks = client.fetchThreadHooks("thread-1")
        client.trustThreadHook("thread-1", TrustThreadHookRequest(key = "hook-1", currentHash = "hash-1"))
        client.untrustThreadHook("thread-1", UntrustThreadHookRequest(key = "hook-1"))

        assertEquals("android-client", skills.skills.single().name)
        assertEquals("Native Android", skills.skills.single().interfaceShortDescription)
        assertEquals("bad skill", skills.errors.single().message)
        assertEquals("docs", mcp.servers.single().name)
        assertEquals("Search docs", mcp.servers.single().tools.single().title)
        assertEquals("hook-1", hooks.hooks.single().key)
        assertEquals("hash-1", hooks.hooks.single().currentHash)
        assertEquals("modified", hooks.hooks.single().trustStatus)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/skills",
            transport.requests[0].url,
        )
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/mcp-servers",
            transport.requests[1].url,
        )
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/hooks",
            transport.requests[2].url,
        )
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/hooks/trust",
            transport.requests[3].url,
        )
        assertEquals("POST", transport.requests[3].method)
        assertTrue(transport.requests[3].body!!.contains("\"currentHash\":\"hash-1\""))
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/hooks/untrust",
            transport.requests[4].url,
        )
        assertEquals("POST", transport.requests[4].method)
        assertTrue(transport.requests[4].body!!.contains("\"key\":\"hook-1\""))
        transport.requests.forEach { request ->
            assertEquals("relay-token", request.bearerToken)
        }
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
    fun workspaceRawAndDownloadUseRelayDevicePath() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                statusCode = 200,
                body = "raw-content",
                headers = mapOf("content-type" to "text/plain"),
                bytes = "raw-content".toByteArray(),
            ),
            SupervisorHttpResponse(
                statusCode = 200,
                body = null,
                headers = mapOf(
                    "content-disposition" to """attachment; filename="Main.kt"""",
                    "content-type" to "text/x-kotlin",
                ),
                bytes = "fun main() = Unit".toByteArray(),
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

        val raw = client.fetchWorkspaceRawFile("workspace-1", "src/Main.kt")
        val download = client.downloadWorkspaceFile("workspace-1", "src/Main.kt")

        assertEquals("src/Main.kt", raw.path)
        assertEquals("raw-content", raw.text)
        assertEquals("Main.kt", download.filename)
        assertEquals("text/x-kotlin", download.contentType)
        assertEquals("fun main() = Unit", download.bytes.toString(Charsets.UTF_8))
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/workspaces/workspace-1/files/raw?path=src%2FMain.kt",
            transport.requests[0].url,
        )
        assertEquals("*/*", transport.requests[0].accept)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/workspaces/workspace-1/files/download?path=src%2FMain.kt",
            transport.requests[1].url,
        )
        assertEquals("*/*", transport.requests[1].accept)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertEquals("relay-token", transport.requests[1].bearerToken)
    }

    @Test
    fun workspaceUploadUsesMultipartRelayDevicePathAndParsesResult() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"kind":"file","file":{"path":"android-upload.txt","name":"android-upload.txt","size":12}}""",
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

        val result = client.uploadWorkspaceFile(
            workspaceId = "workspace-1",
            request = UploadWorkspaceFileRequest(
                filename = "android-upload.txt",
                bytes = "hello upload".toByteArray(),
                contentType = "text/plain",
            ),
        )

        assertEquals("file", result.kind)
        assertEquals("android-upload.txt", result.file?.path)
        assertEquals(12L, result.file?.size)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/workspaces/workspace-1/files/upload",
            transport.requests.single().url,
        )
        assertEquals("POST", transport.requests.single().method)
        assertTrue(transport.requests.single().contentType.startsWith("multipart/form-data; boundary="))
        assertEquals("relay-token", transport.requests.single().bearerToken)
        val body = transport.requests.single().rawBody!!.toString(Charsets.UTF_8)
        assertTrue(body.contains("""name="file"; filename="android-upload.txt""""))
        assertTrue(body.contains("Content-Type: text/plain"))
        assertTrue(body.contains("hello upload"))
    }

    @Test
    fun promptAttachmentsUseMultipartRelayDevicePath() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"id":"thread-1","workspaceId":"workspace-1","title":"Android attachments","status":"running","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Attached"}""",
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

        val thread = client.sendThreadPrompt(
            "thread-1",
            SendThreadPromptRequest(
                prompt = "Review [FILE notes.txt]",
                attachments = listOf(
                    PromptAttachmentUploadRequest(
                        clientId = "attachment-1",
                        kind = "file",
                        originalName = "notes.txt",
                        placeholder = "[FILE notes.txt]",
                        bytes = "hello notes".toByteArray(),
                        contentType = "text/plain",
                    ),
                ),
            ),
        )

        assertEquals("thread-1", thread.id)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/prompt",
            transport.requests.single().url,
        )
        assertEquals("POST", transport.requests.single().method)
        assertTrue(transport.requests.single().contentType.startsWith("multipart/form-data; boundary="))
        assertEquals("relay-token", transport.requests.single().bearerToken)
        val body = transport.requests.single().rawBody!!.toString(Charsets.UTF_8)
        assertTrue(body.contains("""name="prompt""""))
        assertTrue(body.contains("Review [FILE notes.txt]"))
        assertTrue(body.contains("""name="attachmentManifest""""))
        assertTrue(body.contains(""""clientId":"attachment-1""""))
        assertTrue(body.contains(""""kind":"file""""))
        assertTrue(body.contains(""""placeholder":"[FILE notes.txt]""""))
        assertTrue(body.contains("""name="attachments"; filename="notes.txt""""))
        assertTrue(body.contains("Content-Type: text/plain"))
        assertTrue(body.contains("hello notes"))
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
    fun deleteRelayDeviceRevokesDeviceWithBearerToken() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(200, """{"id":"device-1"}"""),
        )
        val client = SupervisorApiClient(
            SupervisorConnectionConfig(
                mode = SupervisorConnectionMode.Relay,
                baseUrl = "https://relay.example.test",
                authToken = "relay-token",
            ),
            transport,
        )

        val revokedId = client.deleteRelayDevice("device-1")

        assertEquals("device-1", revokedId)
        assertEquals("https://relay.example.test/relay/devices/device-1", transport.requests.single().url)
        assertEquals("DELETE", transport.requests.single().method)
        assertEquals("relay-token", transport.requests.single().bearerToken)
    }

    @Test
    fun workspaceThreadDetailAndPromptUseRelayDevicePath() {
        val workspaceJson = """{"id":"workspace-1","hostId":"host","label":"Remote Codex","absPath":"/repo","isFavorite":false,"createdAt":"2026-01-01T00:00:00.000Z","lastOpenedAt":null}"""
        val threadJson = """{"id":"thread-1","workspaceId":"workspace-1","title":"Android API","status":"idle","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Wire detail","contextUsage":{"availability":"available","remainingPercent":38,"tokensInContextWindow":160000,"modelContextWindow":258400,"updatedAt":"2026-01-03T00:00:04.000Z"}}"""
        val detailJson = """{"thread":$threadJson,"workspace":$workspaceJson,"workspacePathStatus":"present","turns":[{"id":"turn-1","startedAt":null,"status":"completed","error":null,"tokenUsage":{"total":{"inputTokens":10,"cachedInputTokens":2,"outputTokens":3,"reasoningOutputTokens":1},"last":{"inputTokens":10,"cachedInputTokens":2,"outputTokens":3,"reasoningOutputTokens":1},"modelContextWindow":128000},"items":[{"id":"item-1","kind":"userMessage","text":"Continue"},{"id":"item-2","kind":"agentMessage","text":"Android API reply","sequence":2},{"id":"item-3","kind":"toolCall","text":"file.read","previewText":"README.md","call_id":"call_1","tool":"file.read","sequence":3}]}],"pendingRequests":[{"id":"request-1","kind":"requestUserInput","title":"Choose mode","description":"Pick a mode","turnId":"turn-1","itemId":"item-2","createdAt":"2026-01-03T00:00:02.000Z","questions":[{"id":"question-1","header":"Mode","question":"Which mode?","multiSelect":false,"isOther":true,"isSecret":false,"options":[{"label":"Implement","description":"Start coding"}]}]}],"answeredRequestNotes":[{"id":"answered-1","turnId":"turn-1","title":"Mode selected","summaryLines":["Implement"],"createdAt":"2026-01-03T00:00:03.000Z"}],"pendingSteers":[],"liveItems":{"items":[{"id":"item-1"}]},"goal":{"status":"active","objective":"Ship Android client"}}"""
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
        assertEquals(1, detail.totalTurnCount)
        assertEquals(1, detail.liveItemCount)
        assertEquals("available", detail.contextUsage?.availability)
        assertEquals(38, detail.contextUsage?.remainingPercent)
        assertEquals(160000, detail.contextUsage?.tokensInContextWindow)
        assertEquals(258400, detail.contextUsage?.modelContextWindow)
        assertEquals(1, detail.pendingRequests.size)
        assertEquals("question-1", detail.pendingRequests.single().questions.single().id)
        assertEquals("turn-1", detail.pendingRequests.single().turnId)
        assertEquals("item-2", detail.pendingRequests.single().itemId)
        assertEquals("Implement", detail.pendingRequests.single().questions.single().options.single().label)
        assertEquals("call_1", detail.turns.single().items.last().callId)
        assertEquals("file.read", detail.turns.single().items.last().toolName)
        assertEquals(3, detail.turns.single().items.last().sequence)
        assertEquals(1, detail.answeredRequestNotes.size)
        assertEquals("turn-1", detail.answeredRequestNotes.single().turnId)
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
    fun resumeThreadUsesRelayDevicePathAndParsesLoadedState() {
        val workspaceJson = """{"id":"workspace-1","hostId":"host","label":"Remote Codex","absPath":"/repo","isFavorite":false,"createdAt":"2026-01-01T00:00:00.000Z","lastOpenedAt":null}"""
        val threadJson = """{"id":"thread-1","workspaceId":"workspace-1","title":"Android API","status":"idle","isLoaded":true,"model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Resumed"}"""
        val detailJson = """{"thread":$threadJson,"workspace":$workspaceJson,"workspacePathStatus":"present","turns":[],"totalTurnCount":0,"pendingRequests":[],"answeredRequestNotes":[],"pendingSteers":[],"liveItems":{"items":[]}}"""
        val transport = RecordingTransport(SupervisorHttpResponse(200, detailJson))
        val client = SupervisorApiClient(
            SupervisorConnectionConfig(
                mode = SupervisorConnectionMode.Relay,
                baseUrl = "https://relay.example.test",
                authToken = "relay-token",
                relayDeviceId = "device-1",
            ),
            transport,
        )

        val detail = client.resumeThread(
            "thread-1",
            ResumeThreadRequest(model = "gpt-5", sandboxMode = "danger-full-access"),
        )

        assertEquals(true, detail.thread.isLoaded)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/resume",
            transport.requests.single().url,
        )
        assertEquals("POST", transport.requests.single().method)
        assertTrue(transport.requests.single().body!!.contains("\"model\":\"gpt-5\""))
        assertFalse(transport.requests.single().body!!.contains("sandboxMode"))
    }

    @Test
    fun fetchThreadDetailUsesBeforeTurnIdAndParsesTotalTurnCount() {
        val workspaceJson = """{"id":"workspace-1","hostId":"host","label":"Remote Codex","absPath":"/repo","isFavorite":false,"createdAt":"2026-01-01T00:00:00.000Z","lastOpenedAt":null}"""
        val threadJson = """{"id":"thread-1","workspaceId":"workspace-1","title":"Android API","status":"idle","model":"gpt-5","updatedAt":"2026-01-03T00:00:00.000Z","summaryText":"Wire detail"}"""
        val detailJson = """{"thread":$threadJson,"workspace":$workspaceJson,"workspacePathStatus":"present","turns":[{"id":"turn-older","startedAt":null,"status":"completed","error":null,"items":[{"id":"item-older","kind":"agentMessage","text":"Older reply"}]}],"totalTurnCount":12,"pendingRequests":[],"answeredRequestNotes":[],"pendingSteers":[],"liveItems":{"items":[]}}"""
        val transport = RecordingTransport(SupervisorHttpResponse(200, detailJson))
        val client = SupervisorApiClient(
            SupervisorConnectionConfig(
                mode = SupervisorConnectionMode.Relay,
                baseUrl = "https://relay.example.test",
                authToken = "relay-token",
                relayDeviceId = "device-1",
            ),
            transport,
        )

        val detail = client.fetchThreadDetail("thread-1", limit = 10, beforeTurnId = "turn-current")

        assertEquals(1, detail.turnCount)
        assertEquals(12, detail.totalTurnCount)
        assertEquals("turn-older", detail.turns.single().id)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1?limit=10&beforeTurnId=turn-current",
            transport.requests.single().url,
        )
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
    fun workspaceManagementUsesRelayDevicePath() {
        val renamedWorkspaceJson = """{"id":"workspace-1","label":"Renamed Workspace","absPath":"/repo","isFavorite":false,"lastOpenedAt":null}"""
        val favoriteWorkspaceJson = """{"id":"workspace-1","label":"Renamed Workspace","absPath":"/repo","isFavorite":true,"lastOpenedAt":null}"""
        val openedWorkspaceJson = """{"id":"workspace-1","label":"Renamed Workspace","absPath":"/repo","isFavorite":true,"lastOpenedAt":"2026-01-03T00:00:00.000Z"}"""
        val transport = RecordingTransport(
            SupervisorHttpResponse(200, renamedWorkspaceJson),
            SupervisorHttpResponse(200, favoriteWorkspaceJson),
            SupervisorHttpResponse(200, openedWorkspaceJson),
            SupervisorHttpResponse(200, """{"id":"workspace-1"}"""),
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

        val renamed = client.updateWorkspace("workspace-1", UpdateSupervisorWorkspaceRequest("Renamed Workspace"))
        val favorite = client.setWorkspaceFavorite("workspace-1", true)
        val opened = client.openWorkspace("workspace-1")
        val deletedId = client.deleteWorkspace("workspace-1", "Renamed Workspace")

        assertEquals("Renamed Workspace", renamed.label)
        assertTrue(favorite.isFavorite)
        assertEquals("2026-01-03T00:00:00.000Z", opened.lastOpenedAt)
        assertEquals("workspace-1", deletedId)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/workspaces/workspace-1",
            transport.requests[0].url,
        )
        assertEquals("PATCH", transport.requests[0].method)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertTrue(transport.requests[0].body!!.contains("\"label\":\"Renamed Workspace\""))
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/workspaces/workspace-1/favorite",
            transport.requests[1].url,
        )
        assertEquals("POST", transport.requests[1].method)
        assertTrue(transport.requests[1].body!!.contains("\"isFavorite\":true"))
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/workspaces/workspace-1/open",
            transport.requests[2].url,
        )
        assertEquals("POST", transport.requests[2].method)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/workspaces/workspace-1",
            transport.requests[3].url,
        )
        assertEquals("DELETE", transport.requests[3].method)
        assertTrue(transport.requests[3].body!!.contains("\"confirmWorkspaceId\":\"workspace-1\""))
        assertTrue(transport.requests[3].body!!.contains("\"confirmLabel\":\"Renamed Workspace\""))
    }

    @Test
    fun runtimeAndWorkspaceSettingsUseRelayDevicePath() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"appName":"remote-codex","appVersion":"0.1.0","mode":"local","host":"127.0.0.1","port":8787,"workspaceRoot":"/workspaces","environment":"test"}""",
            ),
            SupervisorHttpResponse(
                200,
                """{"workspaceRoot":"/workspaces","devHome":"/home/u/dev","defaultBackend":"codex"}""",
            ),
            SupervisorHttpResponse(
                200,
                """{"workspaceRoot":"/workspaces","devHome":"/home/u/projects","defaultBackend":"codex"}""",
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

        val runtime = client.fetchRuntimeConfig()
        val settings = client.fetchWorkspaceSettings()
        val updated = client.updateWorkspaceSettings(
            UpdateSupervisorWorkspaceSettingsRequest(
                devHome = "/home/u/projects",
                defaultBackend = "codex",
            ),
        )

        assertEquals("remote-codex", runtime.appName)
        assertEquals(8787, runtime.port)
        assertEquals("/home/u/dev", settings.devHome)
        assertEquals("/home/u/projects", updated.devHome)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/config/runtime",
            transport.requests[0].url,
        )
        assertEquals("GET", transport.requests[0].method)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/config/workspace-settings",
            transport.requests[1].url,
        )
        assertEquals("GET", transport.requests[1].method)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/config/workspace-settings",
            transport.requests[2].url,
        )
        assertEquals("PATCH", transport.requests[2].method)
        assertEquals("relay-token", transport.requests[2].bearerToken)
        assertTrue(transport.requests[2].body!!.contains("\"devHome\":\"/home/u/projects\""))
        assertTrue(transport.requests[2].body!!.contains("\"defaultBackend\":\"codex\""))
    }

    @Test
    fun listAgentBackendsUsesRelayDevicePathAndParsesInstallState() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """[{"provider":"codex","displayName":"Codex","description":"OpenAI Codex","enabled":true,"isDefault":true,"status":{"state":"running"},"capabilities":{},"managementSchema":{"hostConfigFiles":[],"toolboxItems":[],"hookCommandTemplates":[],"providerConfigFormat":"toml","mcpConfigFormat":"codex-toml","configArchives":true,"buildRestart":true},"installation":{"packageName":"@openai/codex","installed":true,"installedVersion":"1.2.3","latestVersion":"1.2.4","installCommand":null,"updateCommand":"npm install -g @openai/codex","busy":false,"lastError":null}},{"provider":"opencode","displayName":"OpenCode","description":"OpenCode runtime","enabled":false,"isDefault":false,"status":{"state":"stopped","detail":"Not installed"},"capabilities":{},"managementSchema":{"hostConfigFiles":[],"toolboxItems":[],"hookCommandTemplates":[],"providerConfigFormat":"json","mcpConfigFormat":"none","configArchives":false,"buildRestart":false},"installation":{"packageName":"opencode-ai","installed":false,"installedVersion":null,"latestVersion":null,"installCommand":"npm install -g opencode-ai","updateCommand":null,"busy":false,"lastError":"missing"}}]""",
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

        val backends = client.listAgentBackends()

        assertEquals(2, backends.size)
        assertEquals("codex", backends[0].provider)
        assertEquals("Codex", backends[0].displayName)
        assertTrue(backends[0].enabled)
        assertTrue(backends[0].isDefault)
        assertEquals("running", backends[0].statusState)
        assertEquals("1.2.3", backends[0].installedVersion)
        assertEquals("1.2.4", backends[0].latestVersion)
        assertTrue(backends[0].updateAvailable)
        assertTrue(backends[0].configArchives)
        assertTrue(backends[0].buildRestart)
        assertEquals("Not installed", backends[1].statusDetail)
        assertTrue(backends[1].installAvailable)
        assertEquals("missing", backends[1].lastError)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/agent-runtimes",
            transport.requests.single().url,
        )
        assertEquals("GET", transport.requests.single().method)
        assertEquals("relay-token", transport.requests.single().bearerToken)
    }

    @Test
    fun installOrUpdateAgentBackendUsesRelayDevicePathAndPostsAction() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"provider":"claude","displayName":"Claude Code","description":"Claude runtime","enabled":true,"isDefault":false,"status":{"state":"ready"},"capabilities":{},"managementSchema":{"hostConfigFiles":[],"toolboxItems":[],"hookCommandTemplates":[],"providerConfigFormat":"json","mcpConfigFormat":"none","configArchives":false,"buildRestart":false},"installation":{"packageName":"@anthropic-ai/claude-agent-sdk","installed":true,"installedVersion":"2.1.197","latestVersion":"2.1.197","installCommand":"npm install -g @anthropic-ai/claude-code @anthropic-ai/claude-agent-sdk","updateCommand":"npm install -g @anthropic-ai/claude-code@latest @anthropic-ai/claude-agent-sdk@latest","busy":false,"lastError":null}}""",
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

        val backend = client.installOrUpdateAgentBackend("claude", "install")

        assertEquals("claude", backend.provider)
        assertTrue(backend.enabled)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/agent-runtimes/claude/install",
            transport.requests.single().url,
        )
        assertEquals("POST", transport.requests.single().method)
        assertEquals("relay-token", transport.requests.single().bearerToken)
        assertTrue(transport.requests.single().body!!.contains("\"action\":\"install\""))
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
        assertFalse(body.contains("sandboxMode"))
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

    @Test
    fun fetchThreadHistoryItemDetailUsesRelayDevicePath() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"id":"item-1","kind":"fileChange","title":"File Change Details","text":"diff --git a/App.kt b/App.kt","contentType":"text/x-diff","sourcePath":"App.kt","assetPath":"patches/app.diff"}""",
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

        val detail = client.fetchThreadHistoryItemDetail("thread-1", "item 1")

        assertEquals("item-1", detail.id)
        assertEquals("File Change Details", detail.title)
        assertEquals("diff --git a/App.kt b/App.kt", detail.text)
        assertEquals("text/x-diff", detail.contentType)
        assertEquals("App.kt", detail.sourcePath)
        assertEquals("patches/app.diff", detail.assetPath)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/items/item%201/detail",
            transport.requests.single().url,
        )
        assertEquals("relay-token", transport.requests.single().bearerToken)
    }

    @Test
    fun fetchThreadImageAssetUsesRelayDevicePathAndDownloadHeaders() {
        val bytes = byteArrayOf(1, 2, 3, 4)
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                statusCode = 200,
                body = null,
                headers = mapOf("content-type" to "image/png"),
                bytes = bytes,
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

        val image = client.fetchThreadImageAsset("thread-1", "output/screen shot.png")

        assertEquals("screen shot.png", image.filename)
        assertEquals("image/png", image.contentType)
        assertEquals(4, image.bytes.size)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/threads/thread-1/assets/image?path=output%2Fscreen+shot.png",
            transport.requests.single().url,
        )
        assertEquals("*/*", transport.requests.single().accept)
        assertEquals("relay-token", transport.requests.single().bearerToken)
    }

    @Test
    fun importPluginUsesRelayDevicePathAndManifestJsonBody() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """{"id":"example-plugin","name":"Example Plugin","version":"1.0.0","description":"Example","remoteCodex":"0.1","enabled":true,"source":"imported","capabilities":{"artifactTypes":[],"timelineRenderers":[],"threadPanels":[]}}""",
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

        val plugin = client.importPlugin(
            ImportSupervisorPluginRequest(
                manifestJson = """{"id":"example-plugin"}""",
                enabled = true,
            ),
        )

        assertEquals("example-plugin", plugin.id)
        assertEquals("Example Plugin", plugin.name)
        assertEquals("Example", plugin.description)
        assertTrue(plugin.enabled)
        assertEquals("imported", plugin.source)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/plugins/import",
            transport.requests.single().url,
        )
        assertEquals("POST", transport.requests.single().method)
        assertEquals("relay-token", transport.requests.single().bearerToken)
        val body = transport.requests.single().body!!
        assertTrue(body.contains("\"manifestJson\":\"{\\\"id\\\":\\\"example-plugin\\\"}\""))
        assertTrue(body.contains("\"enabled\":true"))
    }

    @Test
    fun listAndUpdatePluginsUseRelayDevicePathAndCapabilities() {
        val transport = RecordingTransport(
            SupervisorHttpResponse(
                200,
                """[{"id":"molecule","name":"Molecule","version":"1.0.0","description":"Molecule renderer","remoteCodex":"0.1","enabled":true,"source":"builtin","capabilities":{"artifactTypes":[{"type":"chemistry.molecule3d","title":"Molecule"}],"timelineRenderers":["xyz"],"threadPanels":[{"id":"molecules","label":"Molecules","kind":"artifact","artifactTypes":["chemistry.molecule3d"]}],"modelHints":[{"id":"hint-1","text":"Use XYZ"}],"mcpServers":[{"id":"server-1","name":"Molecule MCP","command":"molecule"}]}}]""",
            ),
            SupervisorHttpResponse(
                200,
                """{"id":"molecule","name":"Molecule","version":"1.0.0","description":"Molecule renderer","remoteCodex":"0.1","enabled":false,"source":"builtin","capabilities":{"artifactTypes":[{"type":"chemistry.molecule3d","title":"Molecule"}],"timelineRenderers":["xyz"],"threadPanels":[]}}""",
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

        val plugins = client.listPlugins()
        val updated = client.updatePlugin("molecule", UpdateSupervisorPluginRequest(enabled = false))

        assertEquals(1, plugins.size)
        assertEquals("chemistry.molecule3d", plugins.single().artifactTypes.single())
        assertEquals("xyz", plugins.single().timelineRenderers.single())
        assertEquals("artifact", plugins.single().threadPanels.single())
        assertEquals("Use XYZ", plugins.single().modelHints.single())
        assertEquals("Molecule MCP", plugins.single().mcpServers.single())
        assertFalse(updated.enabled)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/plugins",
            transport.requests[0].url,
        )
        assertEquals("GET", transport.requests[0].method)
        assertEquals("relay-token", transport.requests[0].bearerToken)
        assertEquals(
            "https://relay.example.test/relay/devices/device-1/api/plugins/molecule",
            transport.requests[1].url,
        )
        assertEquals("PATCH", transport.requests[1].method)
        assertEquals("relay-token", transport.requests[1].bearerToken)
        assertTrue(transport.requests[1].body!!.contains("\"enabled\":false"))
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
