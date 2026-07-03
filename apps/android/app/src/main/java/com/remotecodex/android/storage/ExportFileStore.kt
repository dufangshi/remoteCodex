package com.remotecodex.android.storage

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import com.remotecodex.android.api.SupervisorFileDownload

data class SavedExportFile(
    val uri: Uri,
    val filename: String,
    val contentType: String,
    val sizeBytes: Int,
)

fun Context.saveExportToDownloads(download: SupervisorFileDownload): SavedExportFile {
    val contentType = download.contentType?.substringBefore(';')?.trim()?.takeIf { it.isNotBlank() }
        ?: download.filename.inferContentType()
    val filename = normalizeExportFilename(
        filename = download.filename,
        contentType = contentType,
    )
    val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, filename)
        put(MediaStore.Downloads.MIME_TYPE, contentType)
        put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Remote Codex")
        put(MediaStore.Downloads.IS_PENDING, 1)
    }
    val resolver = contentResolver
    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IllegalStateException("Could not create export file in Downloads.")
    try {
        resolver.openOutputStream(uri)?.use { stream ->
            stream.write(download.bytes)
        } ?: throw IllegalStateException("Could not write export file.")
        val readyValues = ContentValues().apply {
            put(MediaStore.Downloads.IS_PENDING, 0)
        }
        resolver.update(uri, readyValues, null, null)
    } catch (error: Throwable) {
        resolver.delete(uri, null, null)
        throw error
    }
    return SavedExportFile(
        uri = uri,
        filename = filename,
        contentType = contentType,
        sizeBytes = download.bytes.size,
    )
}

fun Context.shareSavedExport(file: SavedExportFile) {
    val sendIntent = Intent(Intent.ACTION_SEND).apply {
        type = file.contentType
        putExtra(Intent.EXTRA_STREAM, file.uri)
        putExtra(Intent.EXTRA_TITLE, file.filename)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    val chooser = Intent.createChooser(sendIntent, "Share Remote Codex file").apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    startActivity(chooser)
}

internal fun normalizeExportFilename(
    filename: String,
    contentType: String?,
): String {
    val cleaned = filename
        .substringAfterLast('/')
        .substringAfterLast('\\')
        .replace(Regex("""[\\/:*?"<>|]"""), "_")
        .replace(Regex("\\s+"), " ")
        .trim()
        .trim('.')
        .ifBlank { "remote-codex-transcript" }
        .take(120)
        .trim()
        .trim('.')
    return cleaned.withExportExtension(contentType)
}

private fun String.inferContentType(): String {
    return when (substringAfterLast('.', "").lowercase()) {
        "html", "htm" -> "text/html"
        "pdf" -> "application/pdf"
        else -> "application/octet-stream"
    }
}

private fun String.withExportExtension(contentType: String?): String {
    val lower = lowercase()
    if (lower.endsWith(".pdf") || lower.endsWith(".html") || lower.endsWith(".htm")) {
        return this
    }
    return when (contentType?.substringBefore(';')?.trim()?.lowercase()) {
        "text/html" -> "$this.html"
        "application/pdf" -> "$this.pdf"
        else -> this
    }
}
