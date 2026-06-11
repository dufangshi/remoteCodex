package com.remotecodex.android.ui.presentation

data class ToolBlockPreprocessResult(
    val processedContent: String,
    val resultMap: Map<String, ToolResultState>,
)

data class ToolResultState(
    val finalResult: String?,
    val stdout: String,
    val stderr: String,
)

data class GraphChatToolBlockPreview(
    val title: String,
    val callId: String?,
    val parameters: String,
    val result: String?,
)

enum class GraphChatToolCallTone {
    Running,
    Completed,
    Failed,
}

data class GraphChatToolCallState(
    val title: String,
    val callId: String?,
    val status: String,
    val statusLabel: String,
    val tone: GraphChatToolCallTone,
    val parameters: String,
    val result: String?,
    val hasTextualOutput: Boolean,
    val defaultExpanded: Boolean,
    val stateKey: String,
)

enum class GraphChatToolValueKind {
    String,
    Number,
    Boolean,
    Null,
    Object,
    Raw,
}

data class GraphChatToolEntry(
    val key: String,
    val value: String,
    val kind: GraphChatToolValueKind,
)

enum class GraphChatToolEntryDisplayKind {
    Inline,
    OutputBlock,
}

enum class GraphChatToolEntryValueTone {
    String,
    Number,
    Boolean,
    Null,
    Object,
    Raw,
}

data class GraphChatToolEntryDisplayState(
    val key: String,
    val value: String,
    val displayValue: String,
    val kind: GraphChatToolValueKind,
    val displayKind: GraphChatToolEntryDisplayKind,
    val tone: GraphChatToolEntryValueTone,
)

fun formatGraphChatToolParameterObject(entries: List<Pair<String, String>>): String {
    if (entries.isEmpty()) return "{}"
    return buildString {
        appendLine("{")
        entries.forEachIndexed { index, entry ->
            append("  \"")
            append(entry.first)
            append("\": ")
            append(formatGraphChatToolParameterValue(entry.second))
            if (index < entries.lastIndex) {
                append(",")
            }
            appendLine()
        }
        append("}")
    }
}

fun preprocessGraphChatToolBlocks(content: String): ToolBlockPreprocessResult {
    val resultMap = linkedMapOf<String, MutableToolResultState>()
    val resultRegex = Regex("```tool-result\\s*([\\s\\S]*?)\\s*```")
    val withoutResults = resultRegex.replace(content) { match ->
        val json = match.groupValues.getOrNull(1).orEmpty()
        val callId = readJsonString(json, "call_id") ?: return@replace match.value
        val state = resultMap.getOrPut(callId) { MutableToolResultState() }
        val resultBody = readJsonObjectBody(json, "result")
        val streamStatus = resultBody?.let { readJsonString(it, "status") }
        val chunk = resultBody?.let { readJsonString(it, "chunk") }
        if (streamStatus == "stream" && chunk != null) {
            if (readJsonString(resultBody, "stream") == "stderr") {
                state.stderr += chunk
            } else {
                state.stdout += chunk
            }
        } else {
            state.finalResult = resultBody ?: readJsonString(json, "result")
        }
        ""
    }

    val callRegex = Regex("```tool-call\\s*([\\s\\S]*?)\\s*```")
    val processed = callRegex.replace(withoutResults) { match ->
        val json = match.groupValues.getOrNull(1).orEmpty()
        val callId = readJsonString(json, "call_id")
        val tool = readJsonString(json, "tool") ?: return@replace match.value
        val args = readJsonObjectBody(json, "args") ?: readJsonString(json, "args") ?: "{}"
        val resultState = callId?.let { resultMap[it] } ?: return@replace match.value
        val merged = buildString {
            appendLine("tool: $tool")
            appendLine("call_id: $callId")
            appendLine("args:")
            appendLine(args.trim())
            appendLine("result:")
            appendLine(resultState.toPublicState().displayResult())
        }.trimEnd()
        "```tool-merged\n$merged\n```"
    }

    return ToolBlockPreprocessResult(
        processedContent = processed,
        resultMap = resultMap.mapValues { it.value.toPublicState() },
    )
}

private fun formatGraphChatToolParameterValue(value: String): String {
    val trimmed = value.trim()
    if (trimmed == "true" ||
        trimmed == "false" ||
        trimmed == "null" ||
        Regex("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?").matches(trimmed) ||
        ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]")))
    ) {
        return trimmed
    }
    return "\"" + trimmed
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n") + "\""
}

fun toolBlockStatus(language: String, body: String): String {
    if (language == "tool-call") {
        return "pending"
    }
    if (Regex("(?i)(status\\s*[:=]\\s*(failed|error|timed_out)|exit_code\\s*[:=]\\s*[1-9])")
            .containsMatchIn(body)
    ) {
        return "failed"
    }
    if (Regex("(?i)status\\s*[:=]\\s*(stream|pending|running)").containsMatchIn(body)) {
        return "pending"
    }
    return "completed"
}

fun parseGraphChatToolBlock(language: String, body: String): GraphChatToolBlockPreview {
    if (language == "tool-call") {
        return GraphChatToolBlockPreview(
            title = readJsonString(body, "tool") ?: "Unknown",
            callId = readJsonString(body, "call_id"),
            parameters = readJsonObjectBody(body, "args") ?: readJsonString(body, "args") ?: "{}",
            result = null,
        )
    }

    val sections = readMergedToolSections(body)
    return GraphChatToolBlockPreview(
        title = sections["tool"]?.lineSequence()?.firstOrNull()?.trim()?.ifBlank { null } ?: "Tool",
        callId = sections["call_id"]?.lineSequence()?.firstOrNull()?.trim()?.ifBlank { null },
        parameters = sections["args"]?.trim().orEmpty().ifBlank { "{}" },
        result = sections["result"]?.trim(),
    )
}

fun buildGraphChatToolCallState(
    language: String,
    body: String,
): GraphChatToolCallState {
    val status = toolBlockStatus(language, body)
    val preview = parseGraphChatToolBlock(language, body)
    val hasTextualOutput = graphChatToolHasTextualOutput(preview.result)
    val tone = when (status) {
        "failed" -> GraphChatToolCallTone.Failed
        "pending" -> GraphChatToolCallTone.Running
        else -> GraphChatToolCallTone.Completed
    }
    return GraphChatToolCallState(
        title = preview.title,
        callId = preview.callId,
        status = status,
        statusLabel = when (tone) {
            GraphChatToolCallTone.Completed -> "Completed"
            GraphChatToolCallTone.Failed -> "Failed"
            GraphChatToolCallTone.Running -> "Running"
        },
        tone = tone,
        parameters = preview.parameters.ifBlank { "{}" },
        result = preview.result?.takeIf { it.isNotBlank() },
        hasTextualOutput = hasTextualOutput,
        defaultExpanded = status == "pending" || hasTextualOutput,
        stateKey = "tool:${preview.title}:${preview.callId.orEmpty()}:$status:${body.length}",
    )
}

fun graphChatToolHasTextualOutput(result: String?): Boolean {
    val normalized = result?.trim().orEmpty()
    if (normalized.isEmpty()) {
        return false
    }
    val entries = graphChatToolEntries(normalized)
    if (entries.isEmpty()) {
        return false
    }
    return entries.any { entry ->
        entry.key in setOf("stdout", "stderr", "result", "value") &&
            entry.value.isNotBlank()
    }
}

fun graphChatToolEntries(body: String): List<GraphChatToolEntry> {
    val objectEntries = readFlatJsonObjectEntries(body)
    if (objectEntries.isNotEmpty() || isJsonObjectLiteral(body)) {
        return objectEntries
    }
    if (isJsonArrayLiteral(body)) {
        return listOf(
            GraphChatToolEntry(
                key = "value",
                value = body.trim(),
                kind = GraphChatToolValueKind.Object,
            ),
        )
    }

    val colonEntries = body
        .lineSequence()
        .mapNotNull { line ->
            val match = Regex("^([A-Za-z_][A-Za-z0-9_-]*)\\s*:\\s*(.+)$").matchEntire(line.trim())
            match?.let {
                GraphChatToolEntry(
                    key = it.groupValues[1],
                    value = it.groupValues[2],
                    kind = graphChatToolValueKind(
                        key = it.groupValues[1],
                        rawValue = it.groupValues[2],
                        fromJson = false,
                    ),
                )
            }
        }
        .toList()
    if (colonEntries.isNotEmpty()) {
        return colonEntries
    }

    return body.takeIf { it.isNotBlank() }?.let {
        listOf(GraphChatToolEntry(key = "value", value = it.trim(), kind = GraphChatToolValueKind.Raw))
    }.orEmpty()
}

fun buildGraphChatToolEntryDisplayState(
    entry: GraphChatToolEntry,
    renderObjectAsBlock: Boolean,
): GraphChatToolEntryDisplayState {
    val displayKind = if (shouldRenderGraphChatToolEntryAsBlock(entry, renderObjectAsBlock)) {
        GraphChatToolEntryDisplayKind.OutputBlock
    } else {
        GraphChatToolEntryDisplayKind.Inline
    }
    return GraphChatToolEntryDisplayState(
        key = entry.key,
        value = entry.value,
        displayValue = when (displayKind) {
            GraphChatToolEntryDisplayKind.OutputBlock -> {
                if (entry.kind == GraphChatToolValueKind.Object) {
                    prettyGraphChatToolJsonValue(entry.value)
                } else {
                    entry.value.ifBlank { "(empty)" }
                }
            }
            GraphChatToolEntryDisplayKind.Inline -> graphChatToolEntryInlineDisplayValue(entry)
        },
        kind = entry.kind,
        displayKind = displayKind,
        tone = entry.kind.toDisplayTone(),
    )
}

fun shouldRenderGraphChatToolEntryAsBlock(
    entry: GraphChatToolEntry,
    renderObjectAsBlock: Boolean,
): Boolean {
    return (
        entry.kind == GraphChatToolValueKind.Raw &&
            (entry.key in setOf("stdout", "stderr", "result") || entry.value.contains('\n'))
        ) ||
        (renderObjectAsBlock && entry.kind == GraphChatToolValueKind.Object)
}

fun graphChatToolEntryInlineDisplayValue(entry: GraphChatToolEntry): String {
    return when (entry.kind) {
        GraphChatToolValueKind.String -> {
            val value = entry.value.trim()
            if (value.startsWith("\"") && value.endsWith("\"")) value else "\"$value\""
        }
        GraphChatToolValueKind.Null -> "null"
        else -> entry.value.ifBlank { "(empty)" }
    }
}

private fun GraphChatToolValueKind.toDisplayTone(): GraphChatToolEntryValueTone {
    return when (this) {
        GraphChatToolValueKind.String -> GraphChatToolEntryValueTone.String
        GraphChatToolValueKind.Number -> GraphChatToolEntryValueTone.Number
        GraphChatToolValueKind.Boolean -> GraphChatToolEntryValueTone.Boolean
        GraphChatToolValueKind.Null -> GraphChatToolEntryValueTone.Null
        GraphChatToolValueKind.Object -> GraphChatToolEntryValueTone.Object
        GraphChatToolValueKind.Raw -> GraphChatToolEntryValueTone.Raw
    }
}

fun prettyGraphChatToolJsonValue(value: String): String {
    val trimmed = value.trim()
    if (trimmed.isEmpty()) return trimmed
    val output = StringBuilder()
    var indent = 0
    var inString = false
    var escaped = false

    fun appendIndent() {
        repeat(indent.coerceAtLeast(0)) {
            output.append("  ")
        }
    }

    trimmed.forEach { char ->
        if (escaped) {
            output.append(char)
            escaped = false
            return@forEach
        }
        if (char == '\\' && inString) {
            output.append(char)
            escaped = true
            return@forEach
        }
        if (char == '"') {
            output.append(char)
            inString = !inString
            return@forEach
        }
        if (inString) {
            output.append(char)
            return@forEach
        }
        when (char) {
            '{', '[' -> {
                output.append(char)
                output.append('\n')
                indent += 1
                appendIndent()
            }
            '}', ']' -> {
                output.append('\n')
                indent -= 1
                appendIndent()
                output.append(char)
            }
            ',' -> {
                output.append(char)
                output.append('\n')
                appendIndent()
            }
            ':' -> output.append(": ")
            else -> if (!char.isWhitespace()) {
                output.append(char)
            }
        }
    }

    return output.toString()
}

private fun isJsonObjectLiteral(body: String): Boolean {
    val trimmed = body.trim()
    return trimmed.startsWith("{") && trimmed.endsWith("}")
}

private fun isJsonArrayLiteral(body: String): Boolean {
    val trimmed = body.trim()
    return trimmed.startsWith("[") && trimmed.endsWith("]")
}

private fun readFlatJsonObjectEntries(body: String): List<GraphChatToolEntry> {
    val trimmed = body.trim()
    if (!isJsonObjectLiteral(trimmed)) {
        return emptyList()
    }

    val inner = trimmed.removePrefix("{").removeSuffix("}")
    return splitTopLevelJsonFields(inner).mapNotNull { field ->
        val separator = topLevelColonIndex(field)
        if (separator <= 0) return@mapNotNull null
        val rawKey = field.substring(0, separator).trim().trim('"')
        val rawValue = field.substring(separator + 1).trim()
        if (rawKey.isBlank()) {
            null
        } else {
            GraphChatToolEntry(
                key = rawKey,
                value = rawValue,
                kind = graphChatToolValueKind(key = rawKey, rawValue = rawValue, fromJson = true),
            )
        }
    }
}

private fun graphChatToolValueKind(
    key: String,
    rawValue: String,
    fromJson: Boolean,
): GraphChatToolValueKind {
    val trimmed = rawValue.trim()
    if (!fromJson && key in setOf("stdout", "stderr", "result")) {
        return GraphChatToolValueKind.Raw
    }
    if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
        return GraphChatToolValueKind.String
    }
    if (trimmed == "true" || trimmed == "false") {
        return GraphChatToolValueKind.Boolean
    }
    if (trimmed == "null") {
        return GraphChatToolValueKind.Null
    }
    if (Regex("-?(0|[1-9][0-9]*)(\\.[0-9]+)?([eE][+-]?[0-9]+)?").matches(trimmed)) {
        return GraphChatToolValueKind.Number
    }
    if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
        return GraphChatToolValueKind.Object
    }
    return if (fromJson) GraphChatToolValueKind.Raw else GraphChatToolValueKind.String
}

private fun splitTopLevelJsonFields(value: String): List<String> {
    val fields = mutableListOf<String>()
    var depth = 0
    var inString = false
    var escaped = false
    var start = 0

    value.forEachIndexed { index, char ->
        if (escaped) {
            escaped = false
            return@forEachIndexed
        }
        if (char == '\\' && inString) {
            escaped = true
            return@forEachIndexed
        }
        if (char == '"') {
            inString = !inString
            return@forEachIndexed
        }
        if (inString) {
            return@forEachIndexed
        }
        when (char) {
            '{', '[' -> depth += 1
            '}', ']' -> depth -= 1
            ',' -> if (depth == 0) {
                fields += value.substring(start, index).trim()
                start = index + 1
            }
        }
    }
    fields += value.substring(start).trim()
    return fields.filter { it.isNotBlank() }
}

private fun topLevelColonIndex(value: String): Int {
    var inString = false
    var escaped = false
    value.forEachIndexed { index, char ->
        if (escaped) {
            escaped = false
            return@forEachIndexed
        }
        if (char == '\\' && inString) {
            escaped = true
            return@forEachIndexed
        }
        if (char == '"') {
            inString = !inString
            return@forEachIndexed
        }
        if (!inString && char == ':') {
            return index
        }
    }
    return -1
}

private fun readMergedToolSections(body: String): Map<String, String> {
    val sections = linkedMapOf<String, StringBuilder>()
    var currentKey: String? = null

    body.lineSequence().forEach { rawLine ->
        val trimmed = rawLine.trim()
        val keyMatch = Regex("^(tool|call_id|args|result):\\s*(.*)$").matchEntire(trimmed)
        if (keyMatch != null) {
            val key = keyMatch.groupValues[1]
            currentKey = key
            sections.getOrPut(key) { StringBuilder() }
            val inlineValue = keyMatch.groupValues[2].trim()
            if (inlineValue.isNotEmpty()) {
                sections.getValue(key).appendLine(inlineValue)
            }
        } else {
            currentKey?.let { sections.getValue(it).appendLine(rawLine) }
        }
    }

    return sections.mapValues { it.value.toString().trimEnd() }
}

private data class MutableToolResultState(
    var finalResult: String? = null,
    var stdout: String = "",
    var stderr: String = "",
) {
    fun toPublicState(): ToolResultState {
        return ToolResultState(
            finalResult = finalResult,
            stdout = stdout,
            stderr = stderr,
        )
    }
}

private fun ToolResultState.displayResult(): String {
    return buildString {
        finalResult?.takeIf { it.isNotBlank() }?.let { appendLine(it.trim()) }
        stdout.takeIf { it.isNotBlank() }?.let {
            appendLine("stdout:")
            appendLine(it.trimEnd())
        }
        stderr.takeIf { it.isNotBlank() }?.let {
            appendLine("stderr:")
            appendLine(it.trimEnd())
        }
        if (isEmpty()) {
            append("status: pending")
        }
    }.trimEnd()
}

private fun readJsonString(json: String, key: String): String? {
    val pattern = Regex("\"${Regex.escape(key)}\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"")
    return pattern.find(json)?.groupValues?.getOrNull(1)?.replace("\\n", "\n")?.replace("\\\"", "\"")
}

private fun readJsonObjectBody(json: String, key: String): String? {
    val keyMatch = Regex("\"${Regex.escape(key)}\"\\s*:").find(json) ?: return null
    val start = json.indexOf('{', keyMatch.range.last + 1)
    if (start < 0) {
        return null
    }
    var depth = 0
    var inString = false
    var escaped = false
    for (index in start until json.length) {
        val char = json[index]
        if (escaped) {
            escaped = false
            continue
        }
        if (char == '\\' && inString) {
            escaped = true
            continue
        }
        if (char == '"') {
            inString = !inString
            continue
        }
        if (inString) {
            continue
        }
        if (char == '{') {
            depth += 1
        }
        if (char == '}') {
            depth -= 1
            if (depth == 0) {
                return json.substring(start, index + 1)
            }
        }
    }
    return null
}
