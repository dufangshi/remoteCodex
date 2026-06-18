package com.remotecodex.android.settings

import android.content.Context
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode

sealed interface SavedAppRoute {
    data object Home : SavedAppRoute
    data class WorkspaceDetail(val workspaceId: String) : SavedAppRoute
    data class ThreadDetail(val threadId: String) : SavedAppRoute
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

    fun readLastRoute(config: SupervisorConnectionConfig?): SavedAppRoute {
        if (config == null) return SavedAppRoute.Home
        val key = lastRouteKey(config)
        val type = preferences.getString("$key:type", null)
        return when (type) {
            "thread" -> preferences.getString("$key:thread_id", null)
                ?.takeIf { it.isNotBlank() }
                ?.let(SavedAppRoute::ThreadDetail)
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
    }
}
