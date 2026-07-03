package com.remotecodex.android.settings

import android.content.Context
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

sealed interface SavedAppRoute {
    data object Home : SavedAppRoute
    data class WorkspaceDetail(val workspaceId: String) : SavedAppRoute
    data class ThreadDetail(val threadId: String, val workspaceId: String? = null) : SavedAppRoute
}

data class SavedSupervisorDevice(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val mode: SupervisorConnectionMode,
    val baseUrl: String,
    val username: String? = null,
    val password: String? = null,
    val authToken: String? = null,
    val relayDeviceId: String? = null,
) {
    val normalizedBaseUrl: String = SupervisorConnectionConfig(
        mode = mode,
        baseUrl = baseUrl,
        authToken = authToken,
        relayDeviceId = relayDeviceId,
    ).normalizedBaseUrl

    fun toConnectionConfig(): SupervisorConnectionConfig {
        return SupervisorConnectionConfig(
            mode = mode,
            baseUrl = baseUrl,
            authToken = authToken?.takeIf { it.isNotBlank() },
            relayDeviceId = relayDeviceId?.takeIf { it.isNotBlank() },
        )
    }

    companion object {
        fun fromConnection(config: SupervisorConnectionConfig, name: String? = null): SavedSupervisorDevice {
            return SavedSupervisorDevice(
                name = name?.takeIf { it.isNotBlank() } ?: defaultDeviceName(config),
                mode = config.mode,
                baseUrl = config.normalizedBaseUrl,
                authToken = config.authToken,
                relayDeviceId = config.relayDeviceId,
            )
        }

        fun defaultDeviceName(config: SupervisorConnectionConfig): String {
            return when (config.mode) {
                SupervisorConnectionMode.Local -> "Local"
                SupervisorConnectionMode.Server -> "Server"
                SupervisorConnectionMode.Relay -> "Relay"
            }
        }
    }
}

class AppSettingsRepository(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun readThemeMode(): ThemeMode {
        return ThemeMode.fromStorageKey(preferences.getString(THEME_MODE_KEY, null))
    }

    fun writeThemeMode(themeMode: ThemeMode) {
        preferences.edit().putString(THEME_MODE_KEY, themeMode.storageKey).apply()
    }

    fun readSupervisorConnection(): SupervisorConnectionConfig? {
        val baseUrl = preferences.getString(SUPERVISOR_BASE_URL_KEY, null)?.takeIf { it.isNotBlank() }
            ?: return null
        return SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.fromStorageKey(preferences.getString(SUPERVISOR_MODE_KEY, null)),
            baseUrl = baseUrl,
            authToken = preferences.getString(SUPERVISOR_AUTH_TOKEN_KEY, null)?.takeIf { it.isNotBlank() },
            relayDeviceId = preferences.getString(SUPERVISOR_RELAY_DEVICE_ID_KEY, null)?.takeIf { it.isNotBlank() },
        )
    }

    fun writeSupervisorConnection(config: SupervisorConnectionConfig) {
        preferences.edit()
            .putString(SUPERVISOR_MODE_KEY, config.mode.storageKey)
            .putString(SUPERVISOR_BASE_URL_KEY, config.normalizedBaseUrl)
            .putString(SUPERVISOR_AUTH_TOKEN_KEY, config.authToken)
            .putString(SUPERVISOR_RELAY_DEVICE_ID_KEY, config.relayDeviceId)
            .apply()
    }

    fun clearSupervisorConnection() {
        preferences.edit()
            .remove(SUPERVISOR_MODE_KEY)
            .remove(SUPERVISOR_BASE_URL_KEY)
            .remove(SUPERVISOR_AUTH_TOKEN_KEY)
            .remove(SUPERVISOR_RELAY_DEVICE_ID_KEY)
            .apply()
    }

    fun clearRelayDeviceSelection() {
        preferences.edit()
            .remove(SUPERVISOR_RELAY_DEVICE_ID_KEY)
            .apply()
    }

    fun clearAuthToken() {
        preferences.edit()
            .remove(SUPERVISOR_AUTH_TOKEN_KEY)
            .remove(SUPERVISOR_RELAY_DEVICE_ID_KEY)
            .apply()
    }

    fun readSavedSupervisorDevices(): List<SavedSupervisorDevice> {
        val raw = preferences.getString(SAVED_SUPERVISOR_DEVICES_KEY, null)?.takeIf { it.isNotBlank() }
            ?: return emptyList()
        return runCatching {
            val array = JSONArray(raw)
            List(array.length()) { index ->
                array.getJSONObject(index).toSavedSupervisorDevice()
            }
                .filter { it.name.isNotBlank() && it.baseUrl.isNotBlank() }
                .distinctBy { it.id }
        }.getOrDefault(emptyList())
    }

    fun writeSavedSupervisorDevices(devices: List<SavedSupervisorDevice>) {
        val array = JSONArray()
        devices.forEach { device ->
            array.put(device.toJson())
        }
        preferences.edit()
            .putString(SAVED_SUPERVISOR_DEVICES_KEY, array.toString())
            .apply()
    }

    fun upsertSavedSupervisorDevice(device: SavedSupervisorDevice) {
        val current = readSavedSupervisorDevices()
        val next = current
            .filterNot { it.id == device.id }
            .plus(device)
        writeSavedSupervisorDevices(next)
    }

    fun deleteSavedSupervisorDevice(deviceId: String) {
        writeSavedSupervisorDevices(readSavedSupervisorDevices().filterNot { it.id == deviceId })
    }

    fun readLastRoute(config: SupervisorConnectionConfig?): SavedAppRoute {
        if (config == null) return SavedAppRoute.Home
        val key = lastRouteKey(config)
        val type = preferences.getString("$key:type", null)
        return when (type) {
            "thread" -> preferences.getString("$key:thread_id", null)
                ?.takeIf { it.isNotBlank() }
                ?.let { threadId ->
                    SavedAppRoute.ThreadDetail(
                        threadId = threadId,
                        workspaceId = preferences.getString("$key:workspace_id", null)
                            ?.takeIf { it.isNotBlank() },
                    )
                }
                ?: SavedAppRoute.Home
            "workspace" -> preferences.getString("$key:workspace_id", null)
                ?.takeIf { it.isNotBlank() }
                ?.let(SavedAppRoute::WorkspaceDetail)
                ?: SavedAppRoute.Home
            else -> SavedAppRoute.Home
        }
    }

    fun writeLastRoute(config: SupervisorConnectionConfig, route: SavedAppRoute) {
        val key = lastRouteKey(config)
        val editor = preferences.edit()
        when (route) {
            SavedAppRoute.Home -> {
                editor.putString("$key:type", "home")
                    .remove("$key:workspace_id")
                    .remove("$key:thread_id")
            }
            is SavedAppRoute.WorkspaceDetail -> {
                editor.putString("$key:type", "workspace")
                    .putString("$key:workspace_id", route.workspaceId)
                    .remove("$key:thread_id")
            }
            is SavedAppRoute.ThreadDetail -> {
                editor.putString("$key:type", "thread")
                    .putString("$key:thread_id", route.threadId)
                if (route.workspaceId.isNullOrBlank()) {
                    editor.remove("$key:workspace_id")
                } else {
                    editor.putString("$key:workspace_id", route.workspaceId)
                }
            }
        }
        editor.apply()
    }

    private fun lastRouteKey(config: SupervisorConnectionConfig): String {
        return "last_route:${config.mode.storageKey}:${config.normalizedBaseUrl}:${config.relayDeviceId.orEmpty()}"
    }

    private companion object {
        const val PREFERENCES_NAME = "remote_codex_preferences"
        const val THEME_MODE_KEY = "theme_mode"
        const val SUPERVISOR_MODE_KEY = "supervisor_mode"
        const val SUPERVISOR_BASE_URL_KEY = "supervisor_base_url"
        const val SUPERVISOR_AUTH_TOKEN_KEY = "supervisor_auth_token"
        const val SUPERVISOR_RELAY_DEVICE_ID_KEY = "supervisor_relay_device_id"
        const val SAVED_SUPERVISOR_DEVICES_KEY = "saved_supervisor_devices"
    }
}

private fun SavedSupervisorDevice.toJson(): JSONObject {
    return JSONObject()
        .put("id", id)
        .put("name", name)
        .put("mode", mode.storageKey)
        .put("baseUrl", normalizedBaseUrl)
        .put("username", username.orEmpty())
        .put("password", password.orEmpty())
        .put("authToken", authToken.orEmpty())
        .put("relayDeviceId", relayDeviceId.orEmpty())
}

private fun JSONObject.toSavedSupervisorDevice(): SavedSupervisorDevice {
    return SavedSupervisorDevice(
        id = optString("id").takeIf { it.isNotBlank() } ?: UUID.randomUUID().toString(),
        name = optString("name").takeIf { it.isNotBlank() } ?: "Device",
        mode = SupervisorConnectionMode.fromStorageKey(optString("mode")),
        baseUrl = optString("baseUrl").takeIf { it.isNotBlank() } ?: "",
        username = optString("username").takeIf { it.isNotBlank() },
        password = optString("password").takeIf { it.isNotBlank() },
        authToken = optString("authToken").takeIf { it.isNotBlank() },
        relayDeviceId = optString("relayDeviceId").takeIf { it.isNotBlank() },
    )
}
