package com.remotecodex.android.settings

enum class ThemeMode(
    val storageKey: String,
    val label: String,
) {
    System("system", "System"),
    Light("light", "Light"),
    Dark("dark", "Dark");

    fun next(): ThemeMode {
        return when (this) {
            System -> Light
            Light -> Dark
            Dark -> System
        }
    }

    companion object {
        fun fromStorageKey(value: String?): ThemeMode {
            return entries.firstOrNull { it.storageKey == value } ?: System
        }
    }
}
