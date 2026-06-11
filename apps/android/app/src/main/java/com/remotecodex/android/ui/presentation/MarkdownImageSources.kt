package com.remotecodex.android.ui.presentation

fun isSafeMarkdownImageSource(source: String): Boolean {
    val normalized = source.trim()
    if (normalized.isEmpty()) return false
    if (normalized.startsWith("http://", ignoreCase = true)) return false
    if (normalized.startsWith("https://", ignoreCase = true)) return false
    if (normalized.startsWith("data:", ignoreCase = true)) return false
    if (normalized.startsWith("file:", ignoreCase = true)) return false
    if (normalized.startsWith("/")) return false
    return !normalized.split('/').any { it == ".." }
}
