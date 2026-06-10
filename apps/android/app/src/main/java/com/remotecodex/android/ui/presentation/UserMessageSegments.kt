package com.remotecodex.android.ui.presentation

sealed interface UserMessageSegment {
    data class Text(val text: String) : UserMessageSegment
    data class Photo(val path: String) : UserMessageSegment
    data class File(val path: String) : UserMessageSegment
}

fun parseUserMessageSegments(text: String): List<UserMessageSegment> {
    if (text.isEmpty()) return emptyList()

    val matcher = Regex("\\[(PHOTO|FILE)\\s+([^\\]]+)]")
    val segments = mutableListOf<UserMessageSegment>()
    var cursor = 0
    for (match in matcher.findAll(text)) {
        val start = match.range.first
        if (start > cursor) {
            segments += UserMessageSegment.Text(text.substring(cursor, start))
        }
        val kind = match.groupValues.getOrNull(1).orEmpty()
        val path = match.groupValues.getOrNull(2).orEmpty().trim()
        if (path.isBlank()) {
            segments += UserMessageSegment.Text(match.value)
        } else if (kind == "PHOTO") {
            segments += UserMessageSegment.Photo(path)
        } else {
            segments += UserMessageSegment.File(path)
        }
        cursor = match.range.last + 1
    }
    if (cursor < text.length) {
        segments += UserMessageSegment.Text(text.substring(cursor))
    }
    return segments
}

fun basenameFromAssetPath(value: String): String {
    val normalized = value.replace(Regex("[/\\\\]+$"), "").trim()
    if (normalized.isBlank()) return ""
    return normalized.split(Regex("[/\\\\]+")).filter { it.isNotBlank() }.lastOrNull() ?: normalized
}
