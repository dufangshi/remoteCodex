package com.remotecodex.android.ui.presentation

sealed interface MathToken {
    data class Text(val text: String) : MathToken
    data class Superscript(val text: String) : MathToken
    data class Subscript(val text: String) : MathToken
}

data class MathPresentation(
    val tokens: List<MathToken>,
    val copyText: String,
)

fun buildMathPresentation(expression: String): MathPresentation {
    val normalized = normalizeMathExpression(expression)
    return MathPresentation(
        tokens = tokenizeMathExpression(normalized),
        copyText = expression.trim(),
    )
}

private fun normalizeMathExpression(expression: String): String {
    var text = expression
        .trim()
        .replace(Regex("\\s+"), " ")
        .replaceLatexFractions()
        .replaceLatexSquareRoots()

    latexSymbolReplacements.forEach { (source, replacement) ->
        text = text.replace(source, replacement)
    }
    return text
}

private fun String.replaceLatexFractions(): String {
    return replaceLatexCommandWithTwoGroups("\\frac") { numerator, denominator ->
        "($numerator)/($denominator)"
    }
}

private fun String.replaceLatexSquareRoots(): String {
    return replaceLatexCommandWithOneGroup("\\sqrt") { value ->
        "sqrt($value)"
    }
}

private fun String.replaceLatexCommandWithTwoGroups(
    command: String,
    replacement: (String, String) -> String,
): String {
    val output = StringBuilder()
    var index = 0
    while (index < length) {
        val commandIndex = indexOf(command, index)
        if (commandIndex < 0) {
            output.append(substring(index))
            break
        }
        output.append(substring(index, commandIndex))
        val first = readBracedGroup(commandIndex + command.length)
        val second = first?.let { readBracedGroup(it.nextIndex) }
        if (first != null && second != null) {
            output.append(replacement(first.value, second.value))
            index = second.nextIndex
        } else {
            output.append(command)
            index = commandIndex + command.length
        }
    }
    return output.toString()
}

private fun String.replaceLatexCommandWithOneGroup(
    command: String,
    replacement: (String) -> String,
): String {
    val output = StringBuilder()
    var index = 0
    while (index < length) {
        val commandIndex = indexOf(command, index)
        if (commandIndex < 0) {
            output.append(substring(index))
            break
        }
        output.append(substring(index, commandIndex))
        val group = readBracedGroup(commandIndex + command.length)
        if (group != null) {
            output.append(replacement(group.value))
            index = group.nextIndex
        } else {
            output.append(command)
            index = commandIndex + command.length
        }
    }
    return output.toString()
}

private data class BracedGroup(
    val value: String,
    val nextIndex: Int,
)

private fun String.readBracedGroup(startIndex: Int): BracedGroup? {
    var index = startIndex
    while (index < length && this[index].isWhitespace()) {
        index += 1
    }
    if (index >= length || this[index] != '{') return null

    var depth = 0
    val value = StringBuilder()
    while (index < length) {
        val char = this[index]
        when {
            char == '{' -> {
                if (depth > 0) value.append(char)
                depth += 1
            }
            char == '}' -> {
                depth -= 1
                if (depth == 0) {
                    return BracedGroup(
                        value = value.toString(),
                        nextIndex = index + 1,
                    )
                }
                value.append(char)
            }
            else -> value.append(char)
        }
        index += 1
    }
    return null
}

private fun tokenizeMathExpression(expression: String): List<MathToken> {
    if (expression.isEmpty()) return emptyList()
    val tokens = mutableListOf<MathToken>()
    val text = StringBuilder()
    var index = 0

    fun flushText() {
        if (text.isNotEmpty()) {
            tokens += MathToken.Text(text.toString())
            text.clear()
        }
    }

    while (index < expression.length) {
        val char = expression[index]
        if (char == '^' || char == '_') {
            val script = expression.readScriptValue(index + 1)
            if (script != null) {
                flushText()
                tokens += if (char == '^') {
                    MathToken.Superscript(script.value)
                } else {
                    MathToken.Subscript(script.value)
                }
                index = script.nextIndex
                continue
            }
        }
        text.append(char)
        index += 1
    }

    flushText()
    return tokens.mergeAdjacentTextTokens()
}

private fun String.readScriptValue(startIndex: Int): BracedGroup? {
    if (startIndex >= length) return null
    val braced = readBracedGroup(startIndex)
    if (braced != null) return braced
    val char = this[startIndex]
    if (char.isWhitespace()) return null
    return BracedGroup(
        value = char.toString(),
        nextIndex = startIndex + 1,
    )
}

private fun List<MathToken>.mergeAdjacentTextTokens(): List<MathToken> {
    val output = mutableListOf<MathToken>()
    forEach { token ->
        val last = output.lastOrNull()
        if (last is MathToken.Text && token is MathToken.Text) {
            output[output.lastIndex] = MathToken.Text(last.text + token.text)
        } else {
            output += token
        }
    }
    return output
}

private val latexSymbolReplacements = linkedMapOf(
    "\\alpha" to "alpha",
    "\\beta" to "beta",
    "\\gamma" to "gamma",
    "\\delta" to "delta",
    "\\epsilon" to "epsilon",
    "\\theta" to "theta",
    "\\lambda" to "lambda",
    "\\mu" to "mu",
    "\\pi" to "pi",
    "\\sigma" to "sigma",
    "\\phi" to "phi",
    "\\omega" to "omega",
    "\\infty" to "infinity",
    "\\sum" to "sum",
    "\\int" to "integral",
    "\\leq" to "<=",
    "\\geq" to ">=",
    "\\neq" to "!=",
    "\\times" to "x",
    "\\cdot" to "*",
    "\\rightarrow" to "->",
    "\\left" to "",
    "\\right" to "",
)
