package com.remotecodex.android.api

import org.json.JSONObject
import java.net.URI

data class SupervisorPairingPayload(
    val mode: SupervisorConnectionMode,
    val baseUrl: String,
    val token: String? = null,
    val relayDeviceId: String? = null,
) {
    fun toConnectionConfig(): SupervisorConnectionConfig {
        return SupervisorConnectionConfig(
            mode = mode,
            baseUrl = baseUrl,
            authToken = token,
            relayDeviceId = relayDeviceId,
        )
    }
}

fun parseSupervisorPairingPayload(raw: String): SupervisorPairingPayload {
    val text = raw.trim()
    if (text.isEmpty()) {
        throw SupervisorClientError.Parse("Pairing payload is empty.")
    }
    return when {
        text.startsWith("{") -> parsePairingJson(text)
        text.startsWith("remote-codex://") -> parsePairingUri(text)
        else -> throw SupervisorClientError.Parse("Pairing payload must be JSON or remote-codex://connect URL.")
    }
}

private fun parsePairingJson(text: String): SupervisorPairingPayload {
    val json = try {
        JSONObject(text)
    } catch (error: Exception) {
        throw SupervisorClientError.Parse("Pairing JSON is invalid.", error)
    }
    return SupervisorPairingPayload(
        mode = SupervisorConnectionMode.fromStorageKey(json.optString("mode", "local")),
        baseUrl = json.optString("baseUrl").takeIf { it.isNotBlank() }
            ?: json.optString("url").takeIf { it.isNotBlank() }
            ?: throw SupervisorClientError.Parse("Pairing JSON is missing baseUrl."),
        token = json.optNullableString("token"),
        relayDeviceId = json.optNullableString("relayDeviceId")
            ?: json.optNullableString("deviceId"),
    )
}

private fun parsePairingUri(text: String): SupervisorPairingPayload {
    val uri = try {
        URI(text)
    } catch (error: Exception) {
        throw SupervisorClientError.Parse("Pairing URL is invalid.", error)
    }
    if (uri.host != "connect") {
        throw SupervisorClientError.Parse("Pairing URL must use remote-codex://connect.")
    }
    val params = uri.rawQuery
        ?.split("&")
        ?.filter { it.isNotBlank() }
        ?.associate { entry ->
            val parts = entry.split("=", limit = 2)
            val key = parts[0].urlDecode()
            val value = parts.getOrElse(1) { "" }.urlDecode()
            key to value
        }
        ?: emptyMap()
    return SupervisorPairingPayload(
        mode = SupervisorConnectionMode.fromStorageKey(params["mode"]),
        baseUrl = params["baseUrl"] ?: params["url"]
            ?: throw SupervisorClientError.Parse("Pairing URL is missing baseUrl."),
        token = params["token"]?.takeIf { it.isNotBlank() },
        relayDeviceId = params["relayDeviceId"]?.takeIf { it.isNotBlank() }
            ?: params["deviceId"]?.takeIf { it.isNotBlank() },
    )
}

private fun JSONObject.optNullableString(name: String): String? {
    return if (has(name) && !isNull(name)) optString(name).takeIf { it.isNotBlank() } else null
}

private fun String.urlDecode(): String {
    return java.net.URLDecoder.decode(this, Charsets.UTF_8.name())
}
