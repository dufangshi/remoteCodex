import Foundation

struct ToolBlockPreprocessResult: Equatable {
    var processedContent: String
    var resultMap: [String: ToolResultState]
}

struct ToolResultState: Equatable {
    var finalResult: String?
    var stdout: String
    var stderr: String
}

struct GraphChatToolBlockPreview: Equatable {
    var title: String
    var callId: String?
    var parameters: String
    var result: String?
}

enum GraphChatToolCallTone: Equatable {
    case running
    case completed
    case failed
}

struct GraphChatToolCallState: Equatable {
    var title: String
    var callId: String?
    var status: String
    var statusLabel: String
    var tone: GraphChatToolCallTone
    var parameters: String
    var result: String?
    var hasTextualOutput: Bool
    var defaultExpanded: Bool
    var stateKey: String
}

enum GraphChatToolValueKind: Equatable {
    case string
    case number
    case boolean
    case null
    case object
    case raw
}

struct GraphChatToolEntry: Equatable {
    var key: String
    var value: String
    var kind: GraphChatToolValueKind
}

enum GraphChatToolEntryDisplayKind: Equatable {
    case inline
    case outputBlock
}

enum GraphChatToolEntryValueTone: Equatable {
    case string
    case number
    case boolean
    case null
    case object
    case raw
}

enum GraphChatToolEntryUsage {
    case parameter
    case result
}

struct GraphChatToolEntryDisplayState: Equatable {
    var key: String
    var value: String
    var displayValue: String
    var copyValue: String
    var kind: GraphChatToolValueKind
    var displayKind: GraphChatToolEntryDisplayKind
    var tone: GraphChatToolEntryValueTone
}

func formatGraphChatToolParameterObject(_ entries: [(String, String)]) -> String {
    guard !entries.isEmpty else { return "{}" }
    var lines = ["{"]
    for (index, entry) in entries.enumerated() {
        let suffix = index < entries.count - 1 ? "," : ""
        lines.append("  \"\(entry.0)\": \(formatGraphChatToolParameterValue(entry.1))\(suffix)")
    }
    lines.append("}")
    return lines.joined(separator: "\n")
}

func preprocessGraphChatToolBlocks(_ content: String) -> ToolBlockPreprocessResult {
    var resultMap: [String: MutableToolResultState] = [:]
    let withoutResults = replaceFenceBlocks(in: content, language: "tool-result") { body in
        guard let callId = readToolJsonString(body, key: "call_id") else { return nil }
        var state = resultMap[callId] ?? MutableToolResultState()
        let resultBody = readToolJsonObjectBody(body, key: "result")
        let streamStatus = resultBody.flatMap { readToolJsonString($0, key: "status") }
        let chunk = resultBody.flatMap { readToolJsonString($0, key: "chunk") }
        if streamStatus == "stream", let chunk {
            if resultBody.flatMap({ readToolJsonString($0, key: "stream") }) == "stderr" {
                state.stderr += chunk
            } else {
                state.stdout += chunk
            }
        } else {
            state.finalResult = resultBody ?? readToolJsonString(body, key: "result")
        }
        resultMap[callId] = state
        return ""
    }

    let processed = replaceFenceBlocks(in: withoutResults, language: "tool-call") { body in
        let callId = readToolJsonString(body, key: "call_id")
        guard let tool = readToolJsonString(body, key: "tool"),
              let callId,
              let resultState = resultMap[callId]
        else {
            return nil
        }
        let args = readToolJsonObjectBody(body, key: "args") ?? readToolJsonString(body, key: "args") ?? "{}"
        let merged = [
            "tool: \(tool)",
            "call_id: \(callId)",
            "args:",
            args.trimmingCharacters(in: .whitespacesAndNewlines),
            "result:",
            resultState.toPublicState().displayResult()
        ].joined(separator: "\n").toolTrimmedRight
        return "```tool-merged\n\(merged)\n```"
    }

    return ToolBlockPreprocessResult(
        processedContent: processed,
        resultMap: resultMap.mapValues { $0.toPublicState() }
    )
}

func toolBlockStatus(language: String, body: String) -> String {
    if language == "tool-call" {
        return "pending"
    }
    if body.toolMatches(#"(?i)(status\s*[:=]\s*(failed|error|timed_out)|exit_code\s*[:=]\s*[1-9])"#) {
        return "failed"
    }
    if body.toolMatches(#"(?i)status\s*[:=]\s*(stream|pending|running)"#) {
        return "pending"
    }
    return "completed"
}

func parseGraphChatToolBlock(language: String, body: String) -> GraphChatToolBlockPreview {
    if language == "tool-call" {
        return GraphChatToolBlockPreview(
            title: readToolJsonString(body, key: "tool") ?? "Unknown",
            callId: readToolJsonString(body, key: "call_id"),
            parameters: readToolJsonObjectBody(body, key: "args") ?? readToolJsonString(body, key: "args") ?? "{}",
            result: nil
        )
    }

    let sections = readMergedToolSections(body)
    return GraphChatToolBlockPreview(
        title: sections["tool"]?.firstLine.trimmingCharacters(in: .whitespacesAndNewlines).trimmedNonEmpty ?? "Tool",
        callId: sections["call_id"]?.firstLine.trimmingCharacters(in: .whitespacesAndNewlines).trimmedNonEmpty,
        parameters: sections["args"]?.trimmingCharacters(in: .whitespacesAndNewlines).trimmedNonEmpty ?? "{}",
        result: sections["result"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    )
}

func buildGraphChatToolCallState(language: String, body: String) -> GraphChatToolCallState {
    let status = toolBlockStatus(language: language, body: body)
    let preview = parseGraphChatToolBlock(language: language, body: body)
    let hasTextualOutput = graphChatToolHasTextualOutput(preview.result)
    let tone: GraphChatToolCallTone = switch status {
    case "failed":
        .failed
    case "pending":
        .running
    default:
        .completed
    }
    return GraphChatToolCallState(
        title: preview.title,
        callId: preview.callId,
        status: status,
        statusLabel: tone.statusLabel,
        tone: tone,
        parameters: preview.parameters.trimmedNonEmpty ?? "{}",
        result: preview.result?.trimmedNonEmpty,
        hasTextualOutput: hasTextualOutput,
        defaultExpanded: status == "pending" || hasTextualOutput,
        stateKey: "tool:\(preview.title):\(preview.callId ?? ""):\(status):\(body.count)"
    )
}

func graphChatToolHasTextualOutput(_ result: String?) -> Bool {
    let normalized = result?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    guard !normalized.isEmpty, !isBlankJsonScalar(normalized) else { return false }
    let entries = graphChatToolEntries(normalized, usage: .result)
    guard !entries.isEmpty else { return false }
    return entries.contains { entry in
        ["stdout", "stderr", "result", "value"].contains(entry.key) && graphChatToolEntryHasTextualOutput(entry)
    }
}

func graphChatToolEntries(_ body: String, usage: GraphChatToolEntryUsage = .parameter) -> [GraphChatToolEntry] {
    let objectEntries = readFlatJsonObjectEntries(body)
    if !objectEntries.isEmpty || isJsonObjectLiteral(body) {
        return objectEntries
    }
    if isJsonArrayLiteral(body) || isJsonScalarLiteral(body) {
        if usage == .result, isBlankJsonScalar(body) {
            return []
        }
        return [
            GraphChatToolEntry(
                key: "value",
                value: body.trimmingCharacters(in: .whitespacesAndNewlines),
                kind: graphChatToolValueKind(key: "value", rawValue: body, fromJson: true)
            )
        ]
    }

    let colonEntries = body
        .components(separatedBy: .newlines)
        .compactMap { line -> GraphChatToolEntry? in
            guard let match = line.trimmingCharacters(in: .whitespacesAndNewlines)
                .toolFirstMatch(#"^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.+)$"#)
            else {
                return nil
            }
            return GraphChatToolEntry(
                key: match[1],
                value: match[2],
                kind: graphChatToolValueKind(key: match[1], rawValue: match[2], fromJson: false)
            )
        }
    if !colonEntries.isEmpty {
        return colonEntries
    }
    if usage == .result, body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return []
    }
    return body.trimmedNonEmpty.map { [GraphChatToolEntry(key: "value", value: $0, kind: .raw)] } ?? []
}

func buildGraphChatToolEntryDisplayState(
    entry: GraphChatToolEntry,
    renderObjectAsBlock: Bool
) -> GraphChatToolEntryDisplayState {
    let displayKind: GraphChatToolEntryDisplayKind = shouldRenderGraphChatToolEntryAsBlock(
        entry,
        renderObjectAsBlock: renderObjectAsBlock
    ) ? .outputBlock : .inline
    let displayValue: String = switch displayKind {
    case .outputBlock:
        entry.kind == .object ? prettyGraphChatToolJsonValue(entry.value) : (entry.value.isEmpty ? "(empty)" : entry.value)
    case .inline:
        graphChatToolEntryInlineDisplayValue(entry)
    }
    return GraphChatToolEntryDisplayState(
        key: entry.key,
        value: entry.value,
        displayValue: displayValue,
        copyValue: graphChatToolEntryCopyValue(entry: entry, displayKind: displayKind),
        kind: entry.kind,
        displayKind: displayKind,
        tone: entry.kind.displayTone
    )
}

func shouldRenderGraphChatToolEntryAsBlock(
    _ entry: GraphChatToolEntry,
    renderObjectAsBlock: Bool
) -> Bool {
    (entry.kind == .raw && (["stdout", "stderr", "result"].contains(entry.key) || entry.value.contains("\n"))) ||
        (renderObjectAsBlock && entry.kind == .object)
}

func graphChatToolEntryInlineDisplayValue(_ entry: GraphChatToolEntry) -> String {
    switch entry.kind {
    case .string:
        let value = entry.value.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.hasPrefix(#"""#) && value.hasSuffix(#"""#) ? value : #""\#(value)""#
    case .null:
        return "null"
    default:
        return entry.value.isEmpty ? "(empty)" : entry.value
    }
}

func graphChatToolEntryCopyValue(
    entry: GraphChatToolEntry,
    displayKind: GraphChatToolEntryDisplayKind
) -> String {
    switch (displayKind, entry.kind) {
    case (.outputBlock, .object):
        entry.value.trimmingCharacters(in: .whitespacesAndNewlines)
    case (.outputBlock, _):
        entry.value
    default:
        graphChatToolEntryInlineDisplayValue(entry)
    }
}

func prettyGraphChatToolJsonValue(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return trimmed }
    return prettyJsonPreservingOrder(trimmed)
}

private func formatGraphChatToolParameterValue(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    if isUnquotedToolParameterValue(trimmed) {
        return trimmed
    }
    return #""\#(escapeToolJsonString(trimmed))""#
}

private func isUnquotedToolParameterValue(_ value: String) -> Bool {
    value == "true" || value == "false" || value == "null" ||
        value.toolMatches(toolNumberPattern) ||
        (value.hasPrefix("{") && value.hasSuffix("}")) ||
        (value.hasPrefix("[") && value.hasSuffix("]"))
}

private func escapeToolJsonString(_ value: String) -> String {
    value
        .replacingOccurrences(of: #"\"#, with: #"\\"#)
        .replacingOccurrences(of: #"""#, with: #"\""#)
        .replacingOccurrences(of: "\n", with: #"\n"#)
}

private func graphChatToolEntryHasTextualOutput(_ entry: GraphChatToolEntry) -> Bool {
    switch entry.kind {
    case .string:
        !unquoteJsonStringLiteral(entry.value).isEmpty
    case .raw:
        !entry.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    case .number, .boolean, .null, .object:
        false
    }
}

private func unquoteJsonStringLiteral(_ value: String) -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.hasPrefix(#"""#), trimmed.hasSuffix(#"""#), trimmed.count >= 2 else { return trimmed }
    return String(trimmed.dropFirst().dropLast())
        .replacingOccurrences(of: #"\n"#, with: "\n")
        .replacingOccurrences(of: #"\""#, with: #"""#)
        .replacingOccurrences(of: #"\\"#, with: #"\"#)
}

private func isJsonObjectLiteral(_ body: String) -> Bool {
    let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.hasPrefix("{") && trimmed.hasSuffix("}")
}

private func isJsonArrayLiteral(_ body: String) -> Bool {
    let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.hasPrefix("[") && trimmed.hasSuffix("]")
}

private func isJsonScalarLiteral(_ body: String) -> Bool {
    let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
    return (trimmed.hasPrefix(#"""#) && trimmed.hasSuffix(#"""#)) ||
        trimmed == "true" ||
        trimmed == "false" ||
        trimmed == "null" ||
        trimmed.toolMatches(toolNumberPattern)
}

private func isBlankJsonScalar(_ body: String) -> Bool {
    let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed == "null" || trimmed == #""""#
}

private func readFlatJsonObjectEntries(_ body: String) -> [GraphChatToolEntry] {
    let trimmed = body.trimmingCharacters(in: .whitespacesAndNewlines)
    guard isJsonObjectLiteral(trimmed) else { return [] }
    let inner = String(trimmed.dropFirst().dropLast())
    return splitTopLevelJsonFields(inner).compactMap { field in
        let separator = topLevelColonIndex(field)
        guard separator > field.startIndex else { return nil }
        let rawKey = String(field[..<separator])
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: #"""#))
        let rawValue = String(field[field.index(after: separator)...]).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !rawKey.isEmpty else { return nil }
        return GraphChatToolEntry(
            key: rawKey,
            value: rawValue,
            kind: graphChatToolValueKind(key: rawKey, rawValue: rawValue, fromJson: true)
        )
    }
}

private func graphChatToolValueKind(key: String, rawValue: String, fromJson: Bool) -> GraphChatToolValueKind {
    let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    if !fromJson, ["stdout", "stderr", "result"].contains(key) {
        return .raw
    }
    if trimmed.hasPrefix(#"""#), trimmed.hasSuffix(#"""#) {
        return .string
    }
    if trimmed == "true" || trimmed == "false" {
        return .boolean
    }
    if trimmed == "null" {
        return .null
    }
    if trimmed.toolMatches(toolNumberPattern) {
        return .number
    }
    if (trimmed.hasPrefix("{") && trimmed.hasSuffix("}")) || (trimmed.hasPrefix("[") && trimmed.hasSuffix("]")) {
        return .object
    }
    return fromJson ? .raw : .string
}

private func splitTopLevelJsonFields(_ value: String) -> [String] {
    var fields: [String] = []
    var depth = 0
    var inString = false
    var escaped = false
    var start = value.startIndex

    var index = value.startIndex
    while index < value.endIndex {
        let character = value[index]
        if escaped {
            escaped = false
            index = value.index(after: index)
            continue
        }
        if character == "\\", inString {
            escaped = true
            index = value.index(after: index)
            continue
        }
        if character == #"""# {
            inString.toggle()
            index = value.index(after: index)
            continue
        }
        if !inString {
            if character == "{" || character == "[" {
                depth += 1
            } else if character == "}" || character == "]" {
                depth -= 1
            } else if character == ",", depth == 0 {
                fields.append(String(value[start ..< index]).trimmingCharacters(in: .whitespacesAndNewlines))
                start = value.index(after: index)
            }
        }
        index = value.index(after: index)
    }
    fields.append(String(value[start...]).trimmingCharacters(in: .whitespacesAndNewlines))
    return fields.filter { !$0.isEmpty }
}

private func topLevelColonIndex(_ value: String) -> String.Index {
    var inString = false
    var escaped = false
    var index = value.startIndex
    while index < value.endIndex {
        let character = value[index]
        if escaped {
            escaped = false
            index = value.index(after: index)
            continue
        }
        if character == "\\", inString {
            escaped = true
            index = value.index(after: index)
            continue
        }
        if character == #"""# {
            inString.toggle()
        } else if !inString, character == ":" {
            return index
        }
        index = value.index(after: index)
    }
    return value.startIndex
}

private func readMergedToolSections(_ body: String) -> [String: String] {
    var sections: [String: String] = [:]
    var currentKey: String?
    for rawLine in body.components(separatedBy: .newlines) {
        let trimmed = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
        if let match = trimmed.toolFirstMatch(#"^(tool|call_id|args|result):\s*(.*)$"#) {
            let key = match[1]
            currentKey = key
            let inlineValue = match[2].trimmingCharacters(in: .whitespacesAndNewlines)
            sections[key] = inlineValue.isEmpty ? "" : inlineValue
        } else if let currentKey {
            sections[currentKey] = [sections[currentKey], rawLine].compactMap(\.self).joined(separator: "\n")
        }
    }
    return sections.mapValues(\.toolTrimmedRight)
}

private func readToolJsonString(_ json: String, key: String) -> String? {
    let escapedKey = NSRegularExpression.escapedPattern(for: key)
    guard let match = json.toolFirstMatch(#""\#(escapedKey)"\s*:\s*"((?:\\.|[^"])*)""#) else { return nil }
    return match[1]
        .replacingOccurrences(of: #"\n"#, with: "\n")
        .replacingOccurrences(of: #"\""#, with: #"""#)
        .replacingOccurrences(of: #"\\"#, with: #"\"#)
}

private func readToolJsonObjectBody(_ json: String, key: String) -> String? {
    let escapedKey = NSRegularExpression.escapedPattern(for: key)
    guard let keyMatch = json.toolFirstMatch(#""\#(escapedKey)"\s*:"#),
          let start = json[keyMatch.range.upperBound...].firstIndex(of: "{")
    else {
        return nil
    }
    var depth = 0
    var inString = false
    var escaped = false
    var index = start
    while index < json.endIndex {
        let character = json[index]
        if escaped {
            escaped = false
            index = json.index(after: index)
            continue
        }
        if character == "\\", inString {
            escaped = true
            index = json.index(after: index)
            continue
        }
        if character == #"""# {
            inString.toggle()
        } else if !inString {
            if character == "{" {
                depth += 1
            } else if character == "}" {
                depth -= 1
                if depth == 0 {
                    return String(json[start ... index])
                }
            }
        }
        index = json.index(after: index)
    }
    return nil
}

private func replaceFenceBlocks(
    in content: String,
    language: String,
    replacement: (String) -> String?
) -> String {
    let pattern = #"```\#(language)\s*([\s\S]*?)\s*```"#
    var output = ""
    var cursor = content.startIndex
    for match in content.toolMatchesList(pattern) {
        output += content[cursor ..< match.range.lowerBound]
        output += replacement(match[1]) ?? match.value
        cursor = match.range.upperBound
    }
    output += content[cursor...]
    return output
}

// swiftlint:disable:next cyclomatic_complexity
private func prettyJsonPreservingOrder(_ value: String) -> String {
    var output = ""
    var indent = 0
    var inString = false
    var escaped = false

    func appendIndent() {
        output += String(repeating: "  ", count: max(indent, 0))
    }

    for character in value {
        if escaped {
            output.append(character)
            escaped = false
            continue
        }
        if character == "\\", inString {
            output.append(character)
            escaped = true
            continue
        }
        if character == #"""# {
            output.append(character)
            inString.toggle()
            continue
        }
        if inString {
            output.append(character)
            continue
        }
        switch character {
        case "{", "[":
            output.append(character)
            output.append("\n")
            indent += 1
            appendIndent()
        case "}", "]":
            if !output.hasSuffix("\n") {
                output.append("\n")
            }
            indent -= 1
            appendIndent()
            output.append(character)
        case ",":
            output.append(character)
            output.append("\n")
            appendIndent()
        case ":":
            output.append(": ")
        default:
            if !character.isWhitespace {
                output.append(character)
            }
        }
    }
    return output
}

private struct MutableToolResultState {
    var finalResult: String?
    var stdout = ""
    var stderr = ""

    func toPublicState() -> ToolResultState {
        ToolResultState(finalResult: finalResult, stdout: stdout, stderr: stderr)
    }
}

private extension ToolResultState {
    func displayResult() -> String {
        var lines: [String] = []
        if let finalResult = finalResult?.trimmedNonEmpty {
            lines.append(finalResult)
        }
        if let stdout = stdout.trimmedNonEmpty {
            lines.append("stdout:")
            lines.append(stdout)
        }
        if let stderr = stderr.trimmedNonEmpty {
            lines.append("stderr:")
            lines.append(stderr)
        }
        return lines.isEmpty ? "status: pending" : lines.joined(separator: "\n").toolTrimmedRight
    }
}

private extension GraphChatToolCallTone {
    var statusLabel: String {
        switch self {
        case .completed:
            "Completed"
        case .failed:
            "Failed"
        case .running:
            "Running"
        }
    }
}

private extension GraphChatToolValueKind {
    var displayTone: GraphChatToolEntryValueTone {
        switch self {
        case .string:
            .string
        case .number:
            .number
        case .boolean:
            .boolean
        case .null:
            .null
        case .object:
            .object
        case .raw:
            .raw
        }
    }
}

private let toolNumberPattern = #"-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?"#

private struct ToolRegexMatch {
    var value: String
    var range: Range<String.Index>
    var groups: [String]

    subscript(index: Int) -> String {
        groups[index - 1]
    }
}

private extension String {
    var toolTrimmedRight: String {
        replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
    }

    var firstLine: String {
        components(separatedBy: .newlines).first ?? ""
    }

    func toolMatches(_ pattern: String, options: NSRegularExpression.Options = []) -> Bool {
        toolFirstMatch(pattern, options: options) != nil
    }

    func toolFirstMatch(_ pattern: String, options: NSRegularExpression.Options = []) -> ToolRegexMatch? {
        toolMatchesList(pattern, options: options).first
    }

    func toolMatchesList(_ pattern: String, options: NSRegularExpression.Options = []) -> [ToolRegexMatch] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
        let nsRange = NSRange(startIndex ..< endIndex, in: self)
        return regex.matches(in: self, range: nsRange).compactMap { result in
            guard let range = Range(result.range, in: self) else { return nil }
            let groups = (1 ..< result.numberOfRanges).map { index in
                guard let groupRange = Range(result.range(at: index), in: self) else { return "" }
                return String(self[groupRange])
            }
            return ToolRegexMatch(value: String(self[range]), range: range, groups: groups)
        }
    }
}
