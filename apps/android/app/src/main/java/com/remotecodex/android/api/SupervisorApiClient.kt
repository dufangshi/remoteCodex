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
