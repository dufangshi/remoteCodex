package com.remotecodex.android.ui.presentation

data class GraphMoleculeViewerData(
    val format: String,
    val frames: List<String>,
    val exportContent: String,
)

data class MoleculeAtomPreview(
    val element: String,
    val x: Float,
    val y: Float,
    val z: Float,
)

fun normalizeMoleculeFormat(format: String?): String {
    val normalized = format?.trim()?.lowercase().orEmpty()
    return when {
        normalized.isBlank() -> "xyz"
        normalized == "extxyz" -> "xyz"
        else -> normalized
    }
}

fun splitXyzTrajectory(content: String): List<String> {
    if (content.isBlank()) return listOf(content)

    val lines = content
        .replace("\r\n", "\n")
        .replace('\r', '\n')
        .split('\n')

    val frames = mutableListOf<String>()
    var index = 0

    while (index < lines.size) {
        while (index < lines.size && lines[index].isBlank()) {
            index += 1
        }
        if (index >= lines.size) break

        val atomCount = lines[index].trim().toIntOrNull()
            ?: return listOf(content)
        val frameEnd = index + atomCount + 2
        if (atomCount < 0 || frameEnd > lines.size) {
            return listOf(content)
        }

        frames += lines.subList(index, frameEnd).joinToString("\n").trimEnd()
        index = frameEnd
    }

    return frames.ifEmpty { listOf(content) }
}

fun readGraphMoleculeViewerData(
    source: String,
    format: String?,
): GraphMoleculeViewerData {
    val normalizedFormat = normalizeMoleculeFormat(format)
    val frames = if (normalizedFormat == "xyz") {
        splitXyzTrajectory(source)
    } else {
        listOf(source)
    }

    return GraphMoleculeViewerData(
        format = normalizedFormat,
        frames = frames,
        exportContent = joinFramesForExport(frames),
    )
}

private fun joinFramesForExport(frames: List<String>): String {
    return frames.joinToString("\n") { it.trim() }.trimEnd() + "\n"
}

fun parseXyzAtoms(frame: String): List<MoleculeAtomPreview> {
    val lines = frame
        .replace("\r\n", "\n")
        .replace('\r', '\n')
        .split('\n')

    val firstDataLine = lines.indexOfFirst { it.isNotBlank() }
    if (firstDataLine == -1) return emptyList()

    val declaredCount = lines[firstDataLine].trim().toIntOrNull()
    val atomLines = if (declaredCount != null) {
        lines.drop(firstDataLine + 2).take(declaredCount)
    } else {
        lines.drop(firstDataLine)
    }

    return atomLines.mapNotNull { line ->
        val parts = line.trim().split(Regex("\\s+"))
        if (parts.size < 4) return@mapNotNull null

        val element = parts[0].takeIf { it.any(Char::isLetter) } ?: return@mapNotNull null
        val x = parts[1].toFloatOrNull() ?: return@mapNotNull null
        val y = parts[2].toFloatOrNull() ?: return@mapNotNull null
        val z = parts[3].toFloatOrNull() ?: return@mapNotNull null

        MoleculeAtomPreview(
            element = element.replaceFirstChar { it.uppercase() },
            x = x,
            y = y,
            z = z,
        )
    }
}
