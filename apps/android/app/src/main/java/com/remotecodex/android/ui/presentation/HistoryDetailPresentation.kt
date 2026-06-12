package com.remotecodex.android.ui.presentation

import com.remotecodex.android.api.SupervisorThreadHistoryItemDetail
import com.remotecodex.android.ui.model.DetailPreview
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

fun buildHistoryDetailPreview(
    item: SupervisorThreadHistoryItemDetail,
    fallback: DetailPreview,
): DetailPreview {
    val text = item.text.ifBlank { fallback.text }
    return DetailPreview(
        title = item.title.ifBlank { fallback.title },
        text = text,
        contentType = item.contentType?.takeIf { it.isNotBlank() }
            ?: inferHistoryDetailContentType(
                kind = item.kind,
                title = item.title,
                text = text,
                sourcePath = item.sourcePath ?: item.assetPath,
            ),
        sourcePath = item.sourcePath ?: item.assetPath ?: fallback.sourcePath,
    )
}

fun inferHistoryDetailContentType(
    kind: String,
    title: String,
    text: String,
    sourcePath: String? = null,
): String {
    val path = (sourcePath ?: title).lowercase()
    val trimmed = text.trim()
    return when {
        kind == "image" || path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".jpeg") ||
            path.endsWith(".webp") || path.endsWith(".gif") || path.endsWith(".svg") -> "image/reference"
        path.endsWith(".md") || path.endsWith(".markdown") -> "text/markdown"
        path.endsWith(".json") || trimmed.isValidJsonLiteral() -> "application/json"
        path.endsWith(".html") || path.endsWith(".htm") -> "text/html"
        hasLikelyMarkdownSyntax(trimmed) -> "text/markdown"
        else -> "text/plain"
    }
}

private fun String.isValidJsonLiteral(): Boolean {
    if (isEmpty()) return false
    if (!startsWith("{") && !startsWith("[")) return false
    return runCatching {
        when (JSONTokener(this).nextValue()) {
            is JSONObject,
            is JSONArray,
            -> true
            else -> false
        }
    }.getOrDefault(false)
}
