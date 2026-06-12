package com.remotecodex.android.ui.presentation

sealed interface UserMessageSegment {
    data class Text(val text: String) : UserMessageSegment
    data class Photo(val path: String) : UserMessageSegment
    data class File(val path: String) : UserMessageSegment
}

enum class UserMessageAttachmentKind {
    Photo,
    File,
}

data class UserMessageAttachmentState(
    val kind: UserMessageAttachmentKind,
    val path: String,
    val fileName: String,
    val typeLabel: String,
    val fallbackLabel: String,
    val accessibilityLabel: String,
)

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

fun buildUserMessageAttachmentState(segment: UserMessageSegment.Photo): UserMessageAttachmentState {
    return buildUserMessageAttachmentState(
        kind = UserMessageAttachmentKind.Photo,
        path = segment.path,
    )
}

fun buildUserMessageAttachmentState(segment: UserMessageSegment.File): UserMessageAttachmentState {
    return buildUserMessageAttachmentState(
        kind = UserMessageAttachmentKind.File,
        path = segment.path,
    )
}

private fun buildUserMessageAttachmentState(
    kind: UserMessageAttachmentKind,
    path: String,
): UserMessageAttachmentState {
    val fallbackLabel = when (kind) {
        UserMessageAttachmentKind.Photo -> "Attached image"
        UserMessageAttachmentKind.File -> "Attached file"
    }
    val typeLabel = when (kind) {
        UserMessageAttachmentKind.Photo -> "PHOTO"
        UserMessageAttachmentKind.File -> "FILE"
    }
    val fileName = basenameFromAssetPath(path).ifBlank { fallbackLabel }
    val accessibilityType = when (kind) {
        UserMessageAttachmentKind.Photo -> "image attachment"
        UserMessageAttachmentKind.File -> "file attachment"
    }
    return UserMessageAttachmentState(
        kind = kind,
        path = path,
        fileName = fileName,
        typeLabel = typeLabel,
        fallbackLabel = fallbackLabel,
        accessibilityLabel = "$accessibilityType: $fileName",
    )
}
