package com.remotecodex.android.api

enum class SupervisorConnectionMode(
    val storageKey: String,
    val label: String,
    val detail: String,
) {
    Local(
        storageKey = "local",
        label = "Intranet",
        detail = "Direct supervisor on localhost, LAN, or VPN. No login is normally required.",
    ),
    Server(
        storageKey = "server",
        label = "Server",
        detail = "Direct supervisor with admin login and bearer-token protected REST and WebSocket.",
    ),
    Relay(
        storageKey = "relay",
        label = "Relay",
        detail = "Public relay server forwarding to a private supervisor through an outbound tunnel.",
    );

    companion object {
        fun fromStorageKey(value: String?): SupervisorConnectionMode {
            return entries.firstOrNull { it.storageKey == value } ?: Local
        }
    }
}

data class SupervisorConnectionConfig(
    val mode: SupervisorConnectionMode,
    val baseUrl: String,
    val authToken: String? = null,
    val relayDeviceId: String? = null,
) {
    val normalizedBaseUrl: String = normalizeBaseUrl(baseUrl)

    fun restPath(path: String): String {
        val normalizedPath = if (path.startsWith("/")) path else "/$path"
        return when (mode) {
            SupervisorConnectionMode.Local,
            SupervisorConnectionMode.Server,
            -> normalizedPath
            SupervisorConnectionMode.Relay -> {
                val deviceId = relayDeviceId?.trim().orEmpty()
                if (deviceId.isNotEmpty()) {
                    "/relay/devices/${urlEncodePathSegment(deviceId)}$normalizedPath"
                } else {
                    "/relay$normalizedPath"
                }
            }
        }
    }

    fun websocketUrl(): String {
        val path = when (mode) {
            SupervisorConnectionMode.Local,
            SupervisorConnectionMode.Server,
            -> "/ws"
            SupervisorConnectionMode.Relay -> {
                val deviceId = relayDeviceId?.trim().orEmpty()
                if (deviceId.isNotEmpty()) {
                    "/relay/devices/${urlEncodePathSegment(deviceId)}/ws"
                } else {
                    "/relay/ws"
                }
            }
        }
        val wsBase = normalizedBaseUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
        val token = authToken?.trim().orEmpty()
        return if (token.isEmpty()) {
            "$wsBase$path"
        } else {
            "$wsBase$path?token=${urlEncodeQueryValue(token)}"
        }
    }
}

data class AuthSession(
    val authenticated: Boolean,
    val username: String?,
    val expiresAt: String?,
    val mode: String,
    val authRequired: Boolean,
)

data class AuthLoginResult(
    val token: String?,
    val session: AuthSession,
)

data class RelaySession(
    val authenticated: Boolean,
    val user: RelayUser?,
    val registrationEnabled: Boolean,
)

data class RelayUser(
    val id: String,
    val email: String,
    val username: String,
    val role: String,
    val enabled: Boolean,
)

data class RelayLoginResult(
    val token: String,
    val session: RelaySession,
)

data class SupervisorHealth(
    val status: String,
    val timestamp: String? = null,
    val supervisorConnected: Boolean? = null,
)

data class SupervisorConnectionCheck(
    val config: SupervisorConnectionConfig,
    val authenticated: Boolean,
    val authRequired: Boolean,
    val sessionLabel: String,
    val healthLabel: String,
    val websocketUrl: String,
)

data class SupervisorWorkspaceSummary(
    val id: String,
    val label: String,
    val absPath: String,
    val isFavorite: Boolean,
    val lastOpenedAt: String?,
)

data class SupervisorThreadSummary(
    val id: String,
    val workspaceId: String,
    val title: String,
    val status: String,
    val model: String?,
    val updatedAt: String,
    val summaryText: String?,
)

data class SupervisorHomeSnapshot(
    val workspaces: List<SupervisorWorkspaceSummary>,
    val threads: List<SupervisorThreadSummary>,
) {
    val activeThreadCount: Int = threads.count { it.status == "running" }
}

sealed class SupervisorClientError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class InvalidUrl(message: String) : SupervisorClientError(message)
    class Authentication(message: String) : SupervisorClientError(message)
    class Http(val statusCode: Int, message: String, val responseBody: String?) : SupervisorClientError(message)
    class Network(message: String, cause: Throwable) : SupervisorClientError(message, cause)
    class Parse(message: String, cause: Throwable? = null) : SupervisorClientError(message, cause)
}

fun normalizeBaseUrl(input: String): String {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) {
        throw SupervisorClientError.InvalidUrl("Supervisor URL is required.")
    }
    val withScheme = if ("://" in trimmed) trimmed else "http://$trimmed"
    val withoutTrailing = withScheme.trimEnd('/')
    if (!withoutTrailing.startsWith("http://") && !withoutTrailing.startsWith("https://")) {
        throw SupervisorClientError.InvalidUrl("URL must use http or https.")
    }
    return withoutTrailing
}

private fun urlEncodePathSegment(value: String): String {
    return java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}

private fun urlEncodeQueryValue(value: String): String {
    return java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
}
