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

    fun fetchHomeSnapshot(): SupervisorHomeSnapshot {
        return SupervisorHomeSnapshot(
            workspaces = listWorkspaces(),
            threads = listThreads(),
        )
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

private fun JSONObject.optNullableString(name: String): String? {
    return if (has(name) && !isNull(name)) optString(name) else null
}

private fun parseErrorMessage(body: String): String {
    return try {
        JSONObject(body).optString("message", "Request failed.")
    } catch (_: Exception) {
        body.ifBlank { "Request failed." }
    }
}
