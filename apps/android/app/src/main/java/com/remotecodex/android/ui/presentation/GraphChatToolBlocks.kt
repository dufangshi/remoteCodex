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
