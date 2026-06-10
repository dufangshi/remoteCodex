package com.remotecodex.android.settings

import android.content.Context

class AppSettingsRepository(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun readThemeMode(): ThemeMode {
        return ThemeMode.fromStorageKey(preferences.getString(THEME_MODE_KEY, null))
    }

    fun writeThemeMode(themeMode: ThemeMode) {
        preferences.edit().putString(THEME_MODE_KEY, themeMode.storageKey).apply()
    }

    private companion object {
        const val PREFERENCES_NAME = "remote_codex_preferences"
        const val THEME_MODE_KEY = "theme_mode"
    }
}
