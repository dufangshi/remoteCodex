package com.remotecodex.android.api

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

class SupervisorApiClient(
    private val config: SupervisorConnectionConfig,
    private val transport: SupervisorHttpTransport = UrlConnectionSupervisorHttpTransport(),
) {
    fun fetchAuthSession(): AuthSession {
        return when (config.mode) {
            SupervisorConnectionMode.Local,
            SupervisorConnectionMode.Server,
            -> requestJson(config.restPath("/api/auth/session")).toAuthSession()
            SupervisorConnectionMode.Relay -> requestJson("/relay/auth/session").toRelaySession().toAuthSession()
        }
    }

    fun login(username: String, password: String): AuthLoginResult {
        val body = JSONObject()
            .put("username", username)
            .put("password", password)
            .toString()
        val json = requestJson(config.restPath("/api/auth/login"), method = "POST", body = body)
        return json.toAuthLoginResult()
    }

    fun relayLogin(identifier: String, password: String): RelayLoginResult {
        val body = JSONObject()
            .put("identifier", identifier)
            .put("password", password)
            .toString()
        val json = requestJson("/relay/auth/login", method = "POST", body = body)
        return json.toRelayLoginResult()
    }

    fun fetchHealth(): SupervisorHealth {
        val path = when (config.mode) {
            SupervisorConnectionMode.Local,
            SupervisorConnectionMode.Server,
            -> "/healthz"
            SupervisorConnectionMode.Relay -> "/healthz"
        }
        return requestJson(path).toSupervisorHealth()
    }

    fun listWorkspaces(): List<SupervisorWorkspaceSummary> {
        return requestArray(config.restPath("/api/workspaces")).map { item ->
            item.toWorkspaceSummary()
        }
    }

    fun listThreads(): List<SupervisorThreadSummary> {
        return requestArray(config.restPath("/api/threads")).map { item ->
            item.toThreadSummary()
        }
    }

    fun createWorkspace(request: CreateSupervisorWorkspaceRequest): SupervisorWorkspaceSummary {
        val body = JSONObject()
            .put("absPath", request.absPath)
        request.label?.takeIf { it.isNotBlank() }?.let { body.put("label", it) }
        return requestJson(
            config.restPath("/api/workspaces"),
            method = "POST",
            body = body.toString(),
        ).toWorkspaceSummary()
    }

    fun updateWorkspace(workspaceId: String, request: UpdateSupervisorWorkspaceRequest): SupervisorWorkspaceSummary {
        val body = JSONObject()
            .put("label", request.label)
            .toString()
        return requestJson(
            config.restPath("/api/workspaces/${urlEncodePathSegment(workspaceId)}"),
            method = "PATCH",
            body = body,
        ).toWorkspaceSummary()
    }

    fun deleteWorkspace(workspaceId: String): String {
        val json = requestJson(
            config.restPath("/api/workspaces/${urlEncodePathSegment(workspaceId)}"),
            method = "DELETE",
        )
        return json.optString("id", workspaceId)
    }

    fun setWorkspaceFavorite(workspaceId: String, isFavorite: Boolean): SupervisorWorkspaceSummary {
        val body = JSONObject()
            .put("isFavorite", isFavorite)
            .toString()
        return requestJson(
            config.restPath("/api/workspaces/${urlEncodePathSegment(workspaceId)}/favorite"),
            method = "POST",
            body = body,
        ).toWorkspaceSummary()
    }

    fun openWorkspace(workspaceId: String): SupervisorWorkspaceSummary {
        return requestJson(
            config.restPath("/api/workspaces/${urlEncodePathSegment(workspaceId)}/open"),
            method = "POST",
        ).toWorkspaceSummary()
    }

    fun startThread(request: StartSupervisorThreadRequest): SupervisorThreadSummary {
        val body = JSONObject()
            .put("workspaceId", request.workspaceId)
            .put("model", request.model)
            .put("approvalMode", request.approvalMode)
        request.title?.takeIf { it.isNotBlank() }?.let { body.put("title", it) }
        request.provider?.takeIf { it.isNotBlank() }?.let { body.put("provider", it) }
        return requestJson(
            config.restPath("/api/threads/start"),
            method = "POST",
            body = body.toString(),
        ).toThreadSummary()
    }

    fun fetchHomeSnapshot(): SupervisorHomeSnapshot {
        return SupervisorHomeSnapshot(
            workspaces = listWorkspaces(),
            threads = listThreads(),
        )
    }

    fun fetchWorkspaceTree(workspaceId: String, path: String? = null): SupervisorWorkspaceTreeNode {
        val query = buildQuery("path" to path)
        return requestJson(
            config.restPath("/api/workspaces/${urlEncodePathSegment(workspaceId)}/files/tree$query"),
        ).toWorkspaceTreeNode()
    }

    fun fetchWorkspaceFilePreview(
        workspaceId: String,
        path: String,
        offset: Long? = null,
        limit: Int? = null,
    ): SupervisorWorkspaceFilePreview {
        val query = buildQuery(
            "path" to path,
            "offset" to offset?.toString(),
            "limit" to limit?.toString(),
        )
        return requestJson(
            config.restPath("/api/workspaces/${urlEncodePathSegment(workspaceId)}/files/preview$query"),
        ).toWorkspaceFilePreview()
    }

    fun fetchRelayPortal(): RelayPortalSummary {
        return requestJson("/relay/portal").toRelayPortalSummary()
    }

    fun createRelayDevice(name: String): RelayCreateDeviceResult {
        val body = JSONObject()
            .put("name", name)
            .toString()
        return requestJson("/relay/devices", method = "POST", body = body).toRelayCreateDeviceResult()
    }

    fun fetchThreadDetail(threadId: String, limit: Int? = null, beforeTurnId: String? = null): SupervisorThreadDetail {
        val query = buildQuery(
            "limit" to limit?.toString(),
            "beforeTurnId" to beforeTurnId,
        )
        return requestJson(config.restPath("/api/threads/${urlEncodePathSegment(threadId)}$query")).toThreadDetail()
    }

    fun fetchThreadShellState(threadId: String): SupervisorThreadShellState {
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/shell"),
        ).toThreadShellState()
    }

    fun fetchThreadForkTurns(threadId: String): List<SupervisorThreadForkTurnOption> {
        return requestArray(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/fork-turns"),
        ).map { item ->
            item.toThreadForkTurnOption()
        }
    }

    fun forkThread(threadId: String, request: ForkThreadRequest): SupervisorThreadForkResult {
        val body = JSONObject()
            .put("mode", request.mode)
        request.turnId?.takeIf { it.isNotBlank() }?.let { body.put("turnId", it) }
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/fork"),
            method = "POST",
            body = body.toString(),
        ).toThreadForkResult()
    }

    fun fetchThreadSkills(threadId: String): SupervisorThreadSkills {
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/skills"),
        ).toThreadSkills()
    }

    fun fetchThreadMcpServers(threadId: String): SupervisorThreadMcpServers {
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/mcp-servers"),
        ).toThreadMcpServers()
    }

    fun fetchThreadHooks(threadId: String): SupervisorThreadHooks {
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/hooks"),
        ).toThreadHooks()
    }

    fun trustThreadHook(threadId: String, request: TrustThreadHookRequest): SupervisorThreadHooks {
        val body = JSONObject()
            .put("key", request.key)
            .put("currentHash", request.currentHash)
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/hooks/trust"),
            method = "POST",
            body = body.toString(),
        ).toThreadHooks()
    }

    fun untrustThreadHook(threadId: String, request: UntrustThreadHookRequest): SupervisorThreadHooks {
        val body = JSONObject()
            .put("key", request.key)
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/hooks/untrust"),
            method = "POST",
            body = body.toString(),
        ).toThreadHooks()
    }

    fun createThreadShell(threadId: String, request: CreateSupervisorShellRequest = CreateSupervisorShellRequest()): SupervisorThreadShellState {
        val body = JSONObject()
        request.cols?.let { body.put("cols", it) }
        request.rows?.let { body.put("rows", it) }
        request.label?.takeIf { it.isNotBlank() }?.let { body.put("label", it) }
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/shell"),
            method = "POST",
            body = body.toString(),
        ).toThreadShellState()
    }

    fun terminateShell(shellId: String): SupervisorThreadShellState {
        return requestJson(
            config.restPath("/api/shells/${urlEncodePathSegment(shellId)}/terminate"),
            method = "POST",
        ).toThreadShellState()
    }

    fun sendThreadPrompt(threadId: String, request: SendThreadPromptRequest): SupervisorThreadSummary {
        val body = JSONObject()
            .put("prompt", request.prompt)
        request.clientRequestId?.takeIf { it.isNotBlank() }?.let { body.put("clientRequestId", it) }
        request.model?.takeIf { it.isNotBlank() }?.let { body.put("model", it) }
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/prompt"),
            method = "POST",
            body = body.toString(),
        ).toThreadSummary()
    }

    fun updateThread(threadId: String, request: UpdateThreadRequest): SupervisorThreadSummary {
        val body = JSONObject()
            .put("title", request.title)
            .toString()
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}"),
            method = "PATCH",
            body = body,
        ).toThreadSummary()
    }

    fun updateThreadSettings(threadId: String, request: UpdateThreadSettingsRequest): SupervisorThreadSummary {
        val body = JSONObject()
        request.model?.takeIf { it.isNotBlank() }?.let { body.put("model", it) }
        request.reasoningEffort?.let { body.put("reasoningEffort", it) }
        request.fastMode?.let { body.put("fastMode", it) }
        request.collaborationMode?.takeIf { it.isNotBlank() }?.let { body.put("collaborationMode", it) }
        request.sandboxMode?.let { body.put("sandboxMode", it) }
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/settings"),
            method = "PATCH",
            body = body.toString(),
        ).toThreadSummary()
    }

    fun deleteThread(threadId: String): SupervisorThreadSummary {
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}"),
            method = "DELETE",
        ).toThreadSummary()
    }

    fun interruptThread(threadId: String, turnId: String? = null): SupervisorThreadSummary {
        val body = JSONObject()
        turnId?.takeIf { it.isNotBlank() }?.let { body.put("turnId", it) }
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/interrupt"),
            method = "POST",
            body = body.toString(),
        ).toThreadSummary()
    }

    fun compactThread(threadId: String): SupervisorThreadSummary {
        return requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/compact"),
            method = "POST",
        ).toThreadSummary()
    }

    fun updateThreadGoal(threadId: String, request: UpdateThreadGoalRequest) {
        val body = JSONObject()
        request.objective?.let { body.put("objective", it) }
        request.status?.let { body.put("status", it) }
        request.tokenBudget?.let { body.put("tokenBudget", it) }
        requestJson(
            config.restPath("/api/threads/${urlEncodePathSegment(threadId)}/goal"),
            method = "PATCH",
            body = body.toString(),
        )
    }

    fun respondToThreadRequest(
        threadId: String,
        requestId: String,
        request: RespondThreadRequest,
    ): SupervisorThreadDetail {
        val answersJson = JSONObject()
        request.answers.forEach { (questionId, answer) ->
            answersJson.put(
                questionId,
                JSONObject().put("answers", org.json.JSONArray(answer.answers)),
            )
        }
        val body = JSONObject()
            .put("answers", answersJson)
            .toString()
        return requestJson(
            config.restPath(
                "/api/threads/${urlEncodePathSegment(threadId)}/requests/${urlEncodePathSegment(requestId)}/respond",
            ),
            method = "POST",
            body = body,
        ).toThreadDetail()
    }

    fun checkConnection(): SupervisorConnectionCheck {
        val session = fetchAuthSession()
        val health = fetchHealth()
        return SupervisorConnectionCheck(
            config = config,
            authenticated = session.authenticated,
            authRequired = session.authRequired,
            sessionLabel = when {
                session.authenticated && session.authRequired -> "Authenticated as ${session.username ?: "admin"}"
                session.authenticated -> "Trusted ${session.mode} session"
                else -> "Login required"
            },
            healthLabel = when {
                health.supervisorConnected == true -> "Relay connected"
                health.supervisorConnected == false -> "Relay waiting for supervisor"
                else -> "Supervisor ${health.status}"
            },
            websocketUrl = config.websocketUrl(),
        )
    }

    private fun requestJson(path: String, method: String = "GET", body: String? = null): JSONObject {
        val response = transport.request(
            SupervisorHttpRequest(
                url = config.normalizedBaseUrl + path,
                method = method,
                body = body,
                bearerToken = config.authToken,
            ),
        )
        if (response.statusCode !in 200..299) {
            val message = response.body?.let(::parseErrorMessage) ?: "HTTP ${response.statusCode}"
            throw SupervisorClientError.Http(response.statusCode, message, response.body)
        }
        try {
            return JSONObject(response.body ?: "{}")
        } catch (error: Exception) {
            throw SupervisorClientError.Parse("Response was not valid JSON.", error)
        }
    }

    private fun requestArray(path: String, method: String = "GET", body: String? = null): List<JSONObject> {
        val response = transport.request(
            SupervisorHttpRequest(
                url = config.normalizedBaseUrl + path,
                method = method,
                body = body,
                bearerToken = config.authToken,
            ),
        )
        if (response.statusCode !in 200..299) {
            val message = response.body?.let(::parseErrorMessage) ?: "HTTP ${response.statusCode}"
            throw SupervisorClientError.Http(response.statusCode, message, response.body)
        }
        try {
            val array = org.json.JSONArray(response.body ?: "[]")
            return List(array.length()) { index -> array.getJSONObject(index) }
        } catch (error: Exception) {
            throw SupervisorClientError.Parse("Response was not a valid JSON array.", error)
        }
    }
}

data class SupervisorHttpRequest(
    val url: String,
    val method: String,
    val body: String? = null,
    val bearerToken: String? = null,
)

data class SupervisorHttpResponse(
    val statusCode: Int,
    val body: String?,
)

interface SupervisorHttpTransport {
    fun request(request: SupervisorHttpRequest): SupervisorHttpResponse
}

class UrlConnectionSupervisorHttpTransport : SupervisorHttpTransport {
    override fun request(request: SupervisorHttpRequest): SupervisorHttpResponse {
        val connection = try {
            (URL(request.url).openConnection() as HttpURLConnection).apply {
                requestMethod = request.method
                connectTimeout = 10_000
                readTimeout = 15_000
                setRequestProperty("Accept", "application/json")
                request.bearerToken?.takeIf { it.isNotBlank() }?.let { token ->
                    setRequestProperty("Authorization", "Bearer $token")
                }
                request.body?.let { payload ->
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { stream ->
                        stream.write(payload.toByteArray(Charsets.UTF_8))
                    }
                }
            }
        } catch (error: IOException) {
            throw SupervisorClientError.Network("Could not open supervisor connection.", error)
        }

        try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
            return SupervisorHttpResponse(statusCode = status, body = body)
        } catch (error: IOException) {
            throw SupervisorClientError.Network("Supervisor request failed.", error)
        } finally {
            connection.disconnect()
        }
    }
}

private fun JSONObject.toAuthLoginResult(): AuthLoginResult {
    return AuthLoginResult(
        token = optNullableString("token"),
        session = getJSONObject("session").toAuthSession(),
    )
}

private fun JSONObject.toAuthSession(): AuthSession {
    return AuthSession(
        authenticated = optBoolean("authenticated", false),
        username = optNullableString("username"),
        expiresAt = optNullableString("expiresAt"),
        mode = optString("mode", "local"),
        authRequired = optBoolean("authRequired", false),
    )
}

private fun JSONObject.toRelayLoginResult(): RelayLoginResult {
    return RelayLoginResult(
        token = getString("token"),
        session = getJSONObject("session").toRelaySession(),
    )
}

private fun JSONObject.toRelaySession(): RelaySession {
    return RelaySession(
        authenticated = optBoolean("authenticated", false),
        user = optJSONObject("user")?.toRelayUser(),
        registrationEnabled = optBoolean("registrationEnabled", false),
    )
}

private fun JSONObject.toRelayUser(): RelayUser {
    return RelayUser(
        id = optString("id"),
        email = optString("email"),
        username = optString("username"),
        role = optString("role"),
        enabled = optBoolean("enabled", true),
    )
}

private fun RelaySession.toAuthSession(): AuthSession {
    return AuthSession(
        authenticated = authenticated,
        username = user?.username,
        expiresAt = null,
        mode = "relay",
        authRequired = true,
    )
}

private fun JSONObject.toSupervisorHealth(): SupervisorHealth {
    return SupervisorHealth(
        status = optString("status", "unknown"),
        timestamp = optNullableString("timestamp"),
        supervisorConnected = if (has("supervisorConnected")) optBoolean("supervisorConnected") else null,
    )
}

private fun JSONObject.toWorkspaceSummary(): SupervisorWorkspaceSummary {
    return SupervisorWorkspaceSummary(
        id = optString("id"),
        label = optString("label"),
        absPath = optString("absPath"),
        isFavorite = optBoolean("isFavorite", false),
        lastOpenedAt = optNullableString("lastOpenedAt"),
    )
}

private fun JSONObject.toWorkspaceTreeNode(): SupervisorWorkspaceTreeNode {
    val childrenJson = optJSONArray("children") ?: org.json.JSONArray()
    return SupervisorWorkspaceTreeNode(
        name = optString("name"),
        path = optString("path"),
        kind = optString("kind"),
        size = if (has("size") && !isNull("size")) optLong("size") else null,
        children = List(childrenJson.length()) { index ->
            childrenJson.getJSONObject(index).toWorkspaceTreeNode()
        },
    )
}

private fun JSONObject.toWorkspaceFilePreview(): SupervisorWorkspaceFilePreview {
    return SupervisorWorkspaceFilePreview(
        path = optString("path"),
        name = optString("name"),
        content = optString("content"),
        language = optString("language", "text"),
        size = optLong("size", 0L),
        truncated = optBoolean("truncated", false),
        nextOffset = optLong("nextOffset", 0L),
    )
}

private fun JSONObject.toThreadShellState(): SupervisorThreadShellState {
    val shellsJson = optJSONArray("shells") ?: org.json.JSONArray()
    return SupervisorThreadShellState(
        threadId = optString("threadId"),
        workspaceId = optString("workspaceId"),
        workspacePathStatus = optString("workspacePathStatus"),
        state = optString("state"),
        shell = optJSONObject("shell")?.toShellSession(),
        shells = List(shellsJson.length()) { index ->
            shellsJson.getJSONObject(index).toShellSession()
        },
        activeShellId = optNullableString("activeShellId"),
    )
}

private fun JSONObject.toShellSession(): SupervisorShellSession {
    return SupervisorShellSession(
        id = optString("id"),
        threadId = optString("threadId"),
        workspaceId = optString("workspaceId"),
        label = optNullableString("label"),
        tmuxSessionName = optString("tmuxSessionName"),
        backend = optString("backend"),
        cwd = optString("cwd"),
        status = optString("status"),
        attachedViewerId = optNullableString("attachedViewerId"),
        createdAt = optString("createdAt"),
        updatedAt = optString("updatedAt"),
        lastActivityAt = optNullableString("lastActivityAt"),
    )
}

private fun JSONObject.toRelayPortalSummary(): RelayPortalSummary {
    val devicesArray = optJSONArray("devices") ?: org.json.JSONArray()
    return RelayPortalSummary(
        devices = List(devicesArray.length()) { index ->
            devicesArray.getJSONObject(index).toRelayDeviceSummary()
        },
    )
}

private fun JSONObject.toRelayCreateDeviceResult(): RelayCreateDeviceResult {
    return RelayCreateDeviceResult(
        device = getJSONObject("device").toRelayDeviceSummary(),
        token = getString("token"),
    )
}

private fun JSONObject.toRelayDeviceSummary(): RelayDeviceSummary {
    return RelayDeviceSummary(
        id = getString("id"),
        name = optString("name", "Remote Codex device"),
        tokenPreview = optString("tokenPreview"),
        connected = optBoolean("connected", false),
        connectedAt = optNullableString("connectedAt"),
        lastHeartbeatAt = optNullableString("lastHeartbeatAt"),
        createdAt = optString("createdAt"),
    )
}

private fun JSONObject.toThreadSummary(): SupervisorThreadSummary {
    return SupervisorThreadSummary(
        id = optString("id"),
        workspaceId = optString("workspaceId"),
        title = optString("title"),
        status = optString("status"),
        model = optNullableString("model"),
        reasoningEffort = optNullableString("reasoningEffort"),
        fastMode = optBoolean("fastMode", false),
        collaborationMode = optString("collaborationMode", "default"),
        sandboxMode = optNullableString("sandboxMode"),
        updatedAt = optString("updatedAt"),
        summaryText = optNullableString("summaryText"),
    )
}

private fun JSONObject.toThreadDetail(): SupervisorThreadDetail {
    val threadJson = getJSONObject("thread")
    val workspaceJson = getJSONObject("workspace")
    val liveItemsJson = optJSONObject("liveItems")
    val goalJson = optJSONObject("goal")
    val turns = optJSONArray("turns") ?: org.json.JSONArray()
    val parsedTurns = List(turns.length()) { index ->
        turns.getJSONObject(index).toThreadTurn()
    }
    return SupervisorThreadDetail(
        thread = threadJson.toThreadSummary(),
        workspace = workspaceJson.toWorkspaceSummary(),
        turns = parsedTurns,
        turnCount = optJSONArray("turns")?.length() ?: 0,
        pendingRequests = (optJSONArray("pendingRequests") ?: org.json.JSONArray()).let { array ->
            List(array.length()) { index -> array.getJSONObject(index).toThreadActionRequest() }
        },
        answeredRequestNotes = (optJSONArray("answeredRequestNotes") ?: org.json.JSONArray()).let { array ->
            List(array.length()) { index -> array.getJSONObject(index).toAnsweredRequestNote() }
        },
        liveItemCount = liveItemsJson?.optJSONArray("items")?.length() ?: 0,
        goalStatus = goalJson?.optNullableString("status"),
        goalObjective = goalJson?.optNullableString("objective"),
    )
}

private fun JSONObject.toThreadForkTurnOption(): SupervisorThreadForkTurnOption {
    return SupervisorThreadForkTurnOption(
        turnId = optString("turnId"),
        turnIndex = optInt("turnIndex", 0),
        startedAt = optNullableString("startedAt"),
        status = optString("status"),
    )
}

private fun JSONObject.toThreadForkResult(): SupervisorThreadForkResult {
    return SupervisorThreadForkResult(
        thread = getJSONObject("thread").toThreadDetail(),
        sourceThreadId = optString("sourceThreadId"),
        sourceTurnId = optNullableString("sourceTurnId"),
        sourceTurnIndex = if (has("sourceTurnIndex") && !isNull("sourceTurnIndex")) {
            optInt("sourceTurnIndex")
        } else {
            null
        },
    )
}

private fun JSONObject.toThreadSkills(): SupervisorThreadSkills {
    val skillsJson = optJSONArray("skills") ?: org.json.JSONArray()
    val errorsJson = optJSONArray("errors") ?: org.json.JSONArray()
    return SupervisorThreadSkills(
        cwd = optString("cwd"),
        skills = List(skillsJson.length()) { index ->
            skillsJson.getJSONObject(index).toAgentSkill()
        },
        errors = List(errorsJson.length()) { index ->
            errorsJson.getJSONObject(index).toAgentSkillError()
        },
    )
}

private fun JSONObject.toAgentSkill(): SupervisorAgentSkill {
    val interfaceJson = optJSONObject("interface")
    return SupervisorAgentSkill(
        name = optString("name"),
        description = optString("description"),
        shortDescription = optNullableString("shortDescription"),
        interfaceShortDescription = interfaceJson?.optNullableString("shortDescription"),
        path = optString("path"),
        scope = optString("scope"),
        enabled = optBoolean("enabled", true),
    )
}

private fun JSONObject.toAgentSkillError(): SupervisorAgentSkillError {
    return SupervisorAgentSkillError(
        path = optString("path"),
        message = optString("message"),
    )
}

private fun JSONObject.toThreadMcpServers(): SupervisorThreadMcpServers {
    val serversJson = optJSONArray("servers") ?: org.json.JSONArray()
    return SupervisorThreadMcpServers(
        servers = List(serversJson.length()) { index ->
            serversJson.getJSONObject(index).toAgentMcpServer()
        },
    )
}

private fun JSONObject.toAgentMcpServer(): SupervisorAgentMcpServer {
    val toolsJson = optJSONArray("tools") ?: org.json.JSONArray()
    return SupervisorAgentMcpServer(
        name = optString("name"),
        authStatus = optString("authStatus"),
        tools = List(toolsJson.length()) { index ->
            toolsJson.getJSONObject(index).toAgentMcpTool()
        },
        resourceCount = optInt("resourceCount", 0),
        resourceTemplateCount = optInt("resourceTemplateCount", 0),
    )
}

private fun JSONObject.toAgentMcpTool(): SupervisorAgentMcpTool {
    return SupervisorAgentMcpTool(
        name = optString("name"),
        title = optNullableString("title"),
        description = optNullableString("description"),
    )
}

private fun JSONObject.toThreadHooks(): SupervisorThreadHooks {
    val hooksJson = optJSONArray("hooks") ?: org.json.JSONArray()
    val warningsJson = optJSONArray("warnings") ?: org.json.JSONArray()
    val errorsJson = optJSONArray("errors") ?: org.json.JSONArray()
    return SupervisorThreadHooks(
        cwd = optString("cwd"),
        hooks = List(hooksJson.length()) { index ->
            hooksJson.getJSONObject(index).toAgentHook()
        },
        warnings = List(warningsJson.length()) { index -> warningsJson.optString(index) },
        errors = List(errorsJson.length()) { index ->
            errorsJson.getJSONObject(index).toAgentHookError()
        },
        globalHooksPath = optString("globalHooksPath"),
        projectHooksPath = optString("projectHooksPath"),
    )
}

private fun JSONObject.toAgentHook(): SupervisorAgentHook {
    return SupervisorAgentHook(
        key = optString("key"),
        eventName = optString("eventName"),
        handlerType = optString("handlerType"),
        matcher = optNullableString("matcher"),
        command = optNullableString("command"),
        timeoutSec = optInt("timeoutSec", 0),
        statusMessage = optNullableString("statusMessage"),
        sourcePath = optString("sourcePath"),
        source = optString("source"),
        pluginId = optNullableString("pluginId"),
        displayOrder = optInt("displayOrder", 0),
        enabled = optBoolean("enabled", true),
        isManaged = optBoolean("isManaged", false),
        currentHash = optNullableString("currentHash"),
        trustStatus = optString("trustStatus"),
    )
}

private fun JSONObject.toAgentHookError(): SupervisorAgentHookError {
    return SupervisorAgentHookError(
        path = optString("path"),
        message = optString("message"),
    )
}

private fun JSONObject.toThreadActionRequest(): SupervisorThreadActionRequest {
    val questionsJson = optJSONArray("questions") ?: org.json.JSONArray()
    return SupervisorThreadActionRequest(
        id = optString("id"),
        kind = optString("kind"),
        title = optString("title"),
        description = optNullableString("description"),
        createdAt = optString("createdAt"),
        questions = List(questionsJson.length()) { index ->
            questionsJson.getJSONObject(index).toThreadActionQuestion()
        },
    )
}

private fun JSONObject.toThreadActionQuestion(): SupervisorThreadActionQuestion {
    val optionsJson = optJSONArray("options") ?: org.json.JSONArray()
    return SupervisorThreadActionQuestion(
        id = optString("id"),
        header = optString("header"),
        question = optString("question"),
        multiSelect = optBoolean("multiSelect", false),
        isOther = optBoolean("isOther", false),
        options = List(optionsJson.length()) { index ->
            optionsJson.getJSONObject(index).toThreadActionQuestionOption()
        },
    )
}

private fun JSONObject.toThreadActionQuestionOption(): SupervisorThreadActionQuestionOption {
    return SupervisorThreadActionQuestionOption(
        label = optString("label"),
        description = optString("description"),
    )
}

private fun JSONObject.toAnsweredRequestNote(): SupervisorThreadAnsweredRequestNote {
    val linesJson = optJSONArray("summaryLines") ?: org.json.JSONArray()
    return SupervisorThreadAnsweredRequestNote(
        id = optString("id"),
        title = optString("title"),
        summaryLines = List(linesJson.length()) { index -> linesJson.optString(index) },
        createdAt = optString("createdAt"),
    )
}

private fun JSONObject.toThreadTurn(): SupervisorThreadTurn {
    val itemsJson = optJSONArray("items") ?: org.json.JSONArray()
    return SupervisorThreadTurn(
        id = optString("id"),
        startedAt = optNullableString("startedAt"),
        status = optString("status"),
        error = optNullableString("error"),
        model = optNullableString("model"),
        tokenUsage = optJSONObject("tokenUsage")?.toThreadTurnTokenUsage(),
        items = List(itemsJson.length()) { index -> itemsJson.getJSONObject(index).toThreadTurnItem() },
    )
}

private fun JSONObject.toThreadTurnTokenUsage(): SupervisorThreadTurnTokenUsage {
    return SupervisorThreadTurnTokenUsage(
        total = getJSONObject("total").toTokenBreakdown(),
        last = getJSONObject("last").toTokenBreakdown(),
        modelContextWindow = if (has("modelContextWindow") && !isNull("modelContextWindow")) {
            optInt("modelContextWindow")
        } else {
            null
        },
    )
}

private fun JSONObject.toTokenBreakdown(): SupervisorTokenBreakdown {
    return SupervisorTokenBreakdown(
        inputTokens = optInt("inputTokens", 0),
        cachedInputTokens = optInt("cachedInputTokens", 0),
        outputTokens = optInt("outputTokens", 0),
        reasoningOutputTokens = optInt("reasoningOutputTokens", 0),
    )
}

private fun JSONObject.toThreadTurnItem(): SupervisorThreadTurnItem {
    return SupervisorThreadTurnItem(
        id = optString("id"),
        kind = optString("kind"),
        text = optString("text"),
    )
}

private fun JSONObject.optNullableString(name: String): String? {
    return if (has(name) && !isNull(name)) optString(name) else null
}

private fun buildQuery(vararg pairs: Pair<String, String?>): String {
    val entries = pairs.filter { (_, value) -> !value.isNullOrBlank() }
    if (entries.isEmpty()) {
        return ""
    }
    return entries.joinToString(prefix = "?", separator = "&") { (key, value) ->
        "${urlEncodeQueryValue(key)}=${urlEncodeQueryValue(value.orEmpty())}"
    }
}

private fun urlEncodePathSegment(value: String): String {
    return java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}

private fun urlEncodeQueryValue(value: String): String {
    return java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
}

private fun parseErrorMessage(body: String): String {
    return try {
        JSONObject(body).optString("message", "Request failed.")
    } catch (_: Exception) {
        body.ifBlank { "Request failed." }
    }
}
