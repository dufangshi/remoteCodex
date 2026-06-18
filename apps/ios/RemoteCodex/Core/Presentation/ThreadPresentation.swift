import Foundation

let largeMessagePreviewCharacters = 4000

enum RichMessageBlock: Equatable {
    case paragraph(String)
    case heading(level: Int, text: String)
    case bullet(text: String, checked: Bool? = nil, level: Int = 0)
    case orderedItem(number: Int, text: String, level: Int = 0)
    case quote(String)
    case horizontalRule
    case math(String)
    case html(String)
    case table(columns: [RichTableColumn], rows: [[String]])
    case code(language: String, code: String)
}

struct RichTableColumn: Equatable {
    var header: String
    var alignment: RichTableAlignment = .left
}

enum RichTableAlignment: Equatable {
    case left
    case center
    case right
}

enum GraphChatPlainTextSegment: Equatable {
    case text(String)
    case url(text: String, href: String)
}

enum GraphChatInlineSegment: Equatable {
    case text(String)
    case url(text: String, href: String)
    case image(label: String, source: String)
    case code(String)
    case math(String)
    case strong(String)
    case emphasis(String)
    case strikethrough(String)
}

enum MathToken: Equatable {
    case text(String)
    case superscript(String)
    case subscriptText(String)
}

struct MathPresentation: Equatable {
    var tokens: [MathToken]
    var copyText: String
}

enum UserMessageSegment: Equatable {
    case text(String)
    case photo(String)
    case file(String)
}

enum UserMessageAttachmentKind: Equatable {
    case photo
    case file
}

struct UserMessageAttachmentState: Equatable {
    var kind: UserMessageAttachmentKind
    var path: String
    var fileName: String
    var typeLabel: String
    var fallbackLabel: String
    var accessibilityLabel: String
}

struct HistoryDetailPreview: Equatable {
    var title: String
    var text: String
    var contentType: String
    var sourcePath: String?
}

func parsePlainRichMessageBlocks(_ content: String) -> [RichMessageBlock] {
    let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
    let rawBlocks = RegexPatterns.blankLine.map { trimmed.components(separatedBy: $0) } ?? [trimmed]
    return rawBlocks
        .compactMap { block in
            let value = block.trimmingCharacters(in: .whitespacesAndNewlines)
            return value.isEmpty ? nil : .paragraph(value)
        }
}

// swiftlint:disable:next cyclomatic_complexity function_body_length
func parseRichMessageBlocks(_ content: String) -> [RichMessageBlock] {
    let lines = content.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: .newlines)
    var blocks: [RichMessageBlock] = []
    var paragraph: [String] = []
    var codeLanguage: String?
    var codeFenceMarker: String?
    var codeLines: [String] = []
    var index = 0

    func flushParagraph() {
        let value = paragraph.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty {
            blocks.append(.paragraph(value))
        }
        paragraph.removeAll()
    }

    while index < lines.count {
        let line = lines[index]
        let trimmedEnd = line.trimmedRight
        if let language = codeLanguage {
            if isClosingCodeFence(trimmedEnd.trimmingCharacters(in: .whitespacesAndNewlines), marker: codeFenceMarker ?? "") {
                blocks.append(.code(language: language, code: codeLines.map { "\($0)\n" }.joined()))
                codeLanguage = nil
                codeFenceMarker = nil
                codeLines.removeAll()
            } else {
                codeLines.append(line)
            }
            index += 1
            continue
        }

        if let math = readDelimitedMathBlock(lines: lines, startIndex: index, opening: "$$", closing: "$$") {
            flushParagraph()
            blocks.append(.math(math.expression))
            index = math.nextIndex
            continue
        }
        if let math = readDelimitedMathBlock(lines: lines, startIndex: index, opening: "\\[", closing: "\\]") {
            flushParagraph()
            blocks.append(.math(math.expression))
            index = math.nextIndex
            continue
        }
        if let fence = readCodeFenceOpening(trimmedEnd.trimmingCharacters(in: .whitespacesAndNewlines)) {
            flushParagraph()
            codeFenceMarker = fence.marker
            codeLanguage = fence.language
            index += 1
            continue
        }
        if trimmedEnd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            flushParagraph()
            index += 1
            continue
        }
        if let table = readSimpleMarkdownTable(lines: lines, startIndex: index) {
            flushParagraph()
            blocks.append(.table(columns: table.columns, rows: table.rows))
            index = table.nextIndex
            continue
        }
        if let setext = readSetextHeading(lines: lines, startIndex: index) {
            flushParagraph()
            blocks.append(.heading(level: setext.level, text: setext.text))
            index = setext.nextIndex
            continue
        }
        if let match = trimmedEnd.trimmingCharacters(in: .whitespacesAndNewlines).firstMatch(#"^(#{1,6})\s+(.+)$"#) {
            flushParagraph()
            blocks.append(.heading(level: match[1].count, text: match[2]))
            index += 1
            continue
        }
        if trimmedEnd.trimmingCharacters(in: .whitespacesAndNewlines).matches(#"^(?:[-*_]\s*){3,}$"#) {
            flushParagraph()
            blocks.append(.horizontalRule)
            index += 1
            continue
        }
        if let quote = readQuoteBlock(lines: lines, startIndex: index) {
            flushParagraph()
            blocks.append(.quote(quote.text))
            index = quote.nextIndex
            continue
        }
        if let html = readHtmlBlock(lines: lines, startIndex: index) {
            flushParagraph()
            blocks.append(.html(html.source))
            index = html.nextIndex
            continue
        }
        if let task = trimmedEnd.trimmingCharacters(in: .whitespacesAndNewlines).firstMatch(#"^[-*+]\s+\[([ xX])]\s+(.+)$"#) {
            flushParagraph()
            let item = readListItem(lines: lines, startIndex: index, initialText: task[2])
            blocks.append(.bullet(text: item.text, checked: task[1].lowercased() == "x", level: listIndentLevel(line)))
            index = item.nextIndex
            continue
        }
        if let bullet = trimmedEnd.trimmingCharacters(in: .whitespacesAndNewlines).firstMatch(#"^[-*+]\s+(.+)$"#) {
            flushParagraph()
            let item = readListItem(lines: lines, startIndex: index, initialText: bullet[1])
            blocks.append(.bullet(text: item.text, level: listIndentLevel(line)))
            index = item.nextIndex
            continue
        }
        if let ordered = trimmedEnd.trimmingCharacters(in: .whitespacesAndNewlines).firstMatch(#"^(\d{1,9})[.)]\s+(.+)$"#) {
            flushParagraph()
            let item = readListItem(lines: lines, startIndex: index, initialText: ordered[2])
            blocks.append(.orderedItem(number: Int(ordered[1]) ?? 1, text: item.text, level: listIndentLevel(line)))
            index = item.nextIndex
            continue
        }
        paragraph.append(trimmedEnd)
        index += 1
    }

    if let language = codeLanguage {
        blocks.append(.code(language: language, code: codeLines.map { "\($0)\n" }.joined()))
    }
    flushParagraph()
    return blocks
}

func hasLikelyMarkdownSyntax(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return false }
    let blockPatterns = [
        #"(?m)^(?: {0,3})#{1,6}\s+\S"#,
        #"(?m)^(?: {0,3})>{1,}\s*\S"#,
        #"(?m)^(?: {0,3})(?:[-+*]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?\S"#,
        #"(?m)^(?: {0,3})(?:```|~~~)"#,
        #"(?m)^(?: {0,3})(?:[-*_]\s*){3,}$"#
    ]
    let hasBlockSyntax = blockPatterns.contains { trimmed.containsRegex($0) }
    let tablePattern = #"(?m)^(?:\|?[^|\n]+\|[^|\n]+(?:\|[^|\n]+)*\|?\s*\n\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$)"#
    if hasBlockSyntax || trimmed.containsRegex(tablePattern) {
        return true
    }
    guard trimmed.containsRegex(#"[`\[\]*_~!$]"#) else { return false }
    return trimmed.containsRegex(#"!?\[[^\]\n]+]\([^)]+\)"#) ||
        trimmed.containsRegex(#"`[^`\n]+`"#) ||
        trimmed.containsRegex(#"(?s)(^|\n)\s*(?:\$\$.*?\$\$|\\\[.*?\\])\s*($|\n)"#) ||
        trimmed.containsRegex(#"(?:\\\([^\n]+?\\\)|\$(?!\s)[^$\n]+?(?<!\s)\$)"#) ||
        trimmed.containsRegex(#"(?:\*\*[^*\n]+\*\*|__[^_\n]+__)"#) ||
        trimmed.containsRegex(#"(^|[^\w])(?:\*[^*\n]+\*|_[^_\n]+_)(?=[^\w]|$)"#) ||
        trimmed.containsRegex(#"~~[^~\n]+~~"#)
}

func graphChatPlainTextSegments(_ text: String) -> [GraphChatPlainTextSegment] {
    guard !text.isEmpty else { return [] }
    let pattern = #"(!?)\[([^\]\n]+)]\(([^)\s]+)\)"#
    var segments: [GraphChatPlainTextSegment] = []
    var cursor = text.startIndex
    for match in text.matches(pattern) {
        if match.range.lowerBound > cursor {
            segments.append(contentsOf: plainUrlSegments(String(text[cursor ..< match.range.lowerBound])))
        }
        if match.groups[0].isEmpty, !match.groups[1].isEmpty, !match.groups[2].isEmpty {
            segments.append(.url(text: match.groups[1], href: normalizeGraphChatHref(match.groups[2])))
        } else {
            segments.append(.text(match.value))
        }
        cursor = match.range.upperBound
    }
    if cursor < text.endIndex {
        segments.append(contentsOf: plainUrlSegments(String(text[cursor...])))
    }
    return segments
}

func graphChatInlineSegments(_ text: String) -> [GraphChatInlineSegment] {
    guard !text.isEmpty else { return [] }
    let pattern = #"!\[([^\]\n]+)]\(([^)\s]+)\)"#
    var segments: [GraphChatInlineSegment] = []
    var cursor = text.startIndex
    for match in text.matches(pattern) {
        if match.range.lowerBound > cursor {
            segments.append(contentsOf: nonImageInlineSegments(String(text[cursor ..< match.range.lowerBound])))
        }
        if !match.groups[0].isEmpty, !match.groups[1].isEmpty {
            segments.append(.image(label: match.groups[0], source: match.groups[1]))
        } else {
            segments.append(.text(match.value))
        }
        cursor = match.range.upperBound
    }
    if cursor < text.endIndex {
        segments.append(contentsOf: nonImageInlineSegments(String(text[cursor...])))
    }
    return segments
}

func graphChatMessagePreviewText(_ text: String, expanded: Bool, streaming: Bool = false) -> String {
    if streaming || expanded || text.count <= largeMessagePreviewCharacters {
        return text
    }
    return "\(String(text.prefix(largeMessagePreviewCharacters)).trimmedRight)\n\n..."
}

func shouldShowGraphChatMessageExpansion(_ text: String, streaming: Bool = false) -> Bool {
    !streaming && text.count > largeMessagePreviewCharacters
}

func graphChatShowMoreLabel(charCount: Int) -> String {
    let formatter = NumberFormatter()
    formatter.numberStyle = .decimal
    formatter.locale = Locale(identifier: "en_US")
    return "Show more (\(formatter.string(from: NSNumber(value: charCount)) ?? "\(charCount)") chars)"
}

func normalizeGraphChatHref(_ value: String) -> String {
    value.lowercased().hasPrefix("www.") ? "https://\(value)" : value
}

func isSafeMarkdownImageSource(_ source: String) -> Bool {
    let normalized = source.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return false }
    let lower = normalized.lowercased()
    if lower.hasPrefix("http://") || lower.hasPrefix("https://") || lower.hasPrefix("data:") || lower.hasPrefix("file:") {
        return false
    }
    if normalized.hasPrefix("/") {
        return false
    }
    return !normalized.split(separator: "/").contains("..")
}

func parseUserMessageSegments(_ text: String) -> [UserMessageSegment] {
    guard !text.isEmpty else { return [] }
    var segments: [UserMessageSegment] = []
    var cursor = text.startIndex
    for match in text.matches(#"\[(PHOTO|FILE)\s+([^\]]+)]"#) {
        if match.range.lowerBound > cursor {
            segments.append(.text(String(text[cursor ..< match.range.lowerBound])))
        }
        let path = match.groups[1].trimmingCharacters(in: .whitespacesAndNewlines)
        if path.isEmpty {
            segments.append(.text(match.value))
        } else if match.groups[0] == "PHOTO" {
            segments.append(.photo(path))
        } else {
            segments.append(.file(path))
        }
        cursor = match.range.upperBound
    }
    if cursor < text.endIndex {
        segments.append(.text(String(text[cursor...])))
    }
    return segments
}

func basenameFromAssetPath(_ value: String) -> String {
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: #"[\\/]+$"#, with: "", options: .regularExpression)
    guard !normalized.isEmpty else { return "" }
    return normalized.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? normalized
}

func buildUserMessageAttachmentState(_ segment: UserMessageSegment) -> UserMessageAttachmentState? {
    let kind: UserMessageAttachmentKind
    let path: String
    switch segment {
    case let .photo(value):
        kind = .photo
        path = value
    case let .file(value):
        kind = .file
        path = value
    case .text:
        return nil
    }
    let fallbackLabel = kind == .photo ? "Attached image" : "Attached file"
    let typeLabel = kind == .photo ? "PHOTO" : "FILE"
    let fileName = basenameFromAssetPath(path).trimmedNonEmpty ?? fallbackLabel
    let accessibilityType = kind == .photo ? "image attachment" : "file attachment"
    return UserMessageAttachmentState(
        kind: kind,
        path: path,
        fileName: fileName,
        typeLabel: typeLabel,
        fallbackLabel: fallbackLabel,
        accessibilityLabel: "\(accessibilityType): \(fileName)"
    )
}

func buildMathPresentation(_ expression: String) -> MathPresentation {
    let normalized = normalizeMathExpression(expression)
    return MathPresentation(
        tokens: tokenizeMathExpression(normalized),
        copyText: expression.trimmingCharacters(in: .whitespacesAndNewlines)
    )
}

func inferHistoryDetailContentType(kind: String, title: String, text: String, sourcePath: String? = nil) -> String {
    let path = (sourcePath ?? title).lowercased()
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if kind == "image" || [".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"].contains(where: path.hasSuffix) {
        return "image/reference"
    }
    if path.hasSuffix(".md") || path.hasSuffix(".markdown") {
        return "text/markdown"
    }
    if path.hasSuffix(".json") || trimmed.isValidJSONContainer {
        return "application/json"
    }
    if path.hasSuffix(".html") || path.hasSuffix(".htm") {
        return "text/html"
    }
    if hasLikelyMarkdownSyntax(trimmed) {
        return "text/markdown"
    }
    return "text/plain"
}

// swiftlint:disable:next function_parameter_count
func buildHistoryDetailPreview(
    kind: String,
    title: String,
    text: String,
    contentType: String?,
    sourcePath: String?,
    assetPath: String?,
    fallback: HistoryDetailPreview
) -> HistoryDetailPreview {
    let body = text.trimmedNonEmpty ?? fallback.text
    let previewTitle = title.trimmedNonEmpty ?? fallback.title
    let previewSource = sourcePath ?? assetPath ?? fallback.sourcePath
    return HistoryDetailPreview(
        title: previewTitle,
        text: body,
        contentType: contentType?.trimmedNonEmpty ?? inferHistoryDetailContentType(
            kind: kind,
            title: title,
            text: body,
            sourcePath: previewSource
        ),
        sourcePath: previewSource
    )
}

private func nonImageInlineSegments(_ text: String) -> [GraphChatInlineSegment] {
    graphChatPlainTextSegments(text).flatMap { segment -> [GraphChatInlineSegment] in
        switch segment {
        case let .text(value):
            inlineStyleSegments(value)
        case let .url(text, href):
            [.url(text: text, href: href)]
        }
    }
}

private func inlineStyleSegments(_ text: String) -> [GraphChatInlineSegment] {
    guard !text.isEmpty else { return [] }
    var segments: [GraphChatInlineSegment] = []
    var cursor = text.startIndex
    while cursor < text.endIndex {
        guard let match = nextInlineStyleMatch(text, from: cursor) else { break }
        if match.range.lowerBound > cursor {
            segments.append(.text(String(text[cursor ..< match.range.lowerBound])))
        }
        segments.append(styledInlineSegment(match.value))
        cursor = match.range.upperBound
    }
    if cursor < text.endIndex {
        segments.append(.text(String(text[cursor...])))
    }
    return segments
}

private func nextInlineStyleMatch(_ text: String, from start: String.Index) -> RegexMatch? {
    let codeMatch = nextInlineCodeSpan(text, from: start)
    let patternMatch = [
        #"\\\([^\n]+?\\\)"#,
        #"\$(?!\s)[^$\n]+?(?<!\s)\$"#,
        #"~~[^~\n]+~~"#,
        #"\*\*[^*\n]+\*\*"#,
        #"__[^_\n]+__"#,
        #"(?<!\w)\*[^*\n]+\*(?!\w)"#,
        #"(?<!\w)_[^_\n]+_(?!\w)"#
    ]
    .compactMap { text.firstMatch($0, from: start) }
    .sorted(by: compareRegexMatches)
    .first
    return [codeMatch, patternMatch].compactMap(\.self).sorted(by: compareRegexMatches).first
}

private func nextInlineCodeSpan(_ text: String, from start: String.Index) -> RegexMatch? {
    var searchStart = start
    while let opening = text[searchStart...].firstIndex(of: "`") {
        let delimiterLength = repeatedCharacterCount(text, at: opening, character: "`")
        let bodyStart = text.index(opening, offsetBy: delimiterLength)
        if let closing = findClosingBacktickDelimiter(text, from: bodyStart, delimiterLength: delimiterLength) {
            let end = text.index(closing, offsetBy: delimiterLength)
            return RegexMatch(value: String(text[opening ..< end]), range: opening ..< end, groups: [])
        }
        searchStart = text.index(opening, offsetBy: delimiterLength)
    }
    return nil
}

private func findClosingBacktickDelimiter(_ text: String, from start: String.Index, delimiterLength: Int) -> String.Index? {
    var searchStart = start
    while let candidate = text[searchStart...].firstIndex(of: "`") {
        let runLength = repeatedCharacterCount(text, at: candidate, character: "`")
        if runLength == delimiterLength {
            return candidate
        }
        searchStart = text.index(candidate, offsetBy: runLength)
    }
    return nil
}

private func styledInlineSegment(_ raw: String) -> GraphChatInlineSegment {
    if raw.hasPrefix(#"\("#), raw.hasSuffix(#"\)"#) {
        return .math(String(raw.dropFirst(2).dropLast(2)))
    }
    if raw.hasPrefix("$"), raw.hasSuffix("$") {
        return .math(String(raw.dropFirst().dropLast()))
    }
    if raw.hasPrefix("`"), raw.hasSuffix("`") {
        let delimiterLength = raw.prefix(while: { $0 == "`" }).count
        return .code(String(raw.dropFirst(delimiterLength).dropLast(delimiterLength)))
    }
    if raw.hasPrefix("~~"), raw.hasSuffix("~~") {
        return .strikethrough(String(raw.dropFirst(2).dropLast(2)))
    }
    if (raw.hasPrefix("**") && raw.hasSuffix("**")) || (raw.hasPrefix("__") && raw.hasSuffix("__")) {
        return .strong(String(raw.dropFirst(2).dropLast(2)))
    }
    if (raw.hasPrefix("*") && raw.hasSuffix("*")) || (raw.hasPrefix("_") && raw.hasSuffix("_")) {
        return .emphasis(String(raw.dropFirst().dropLast()))
    }
    return .text(raw)
}

private func plainUrlSegments(_ text: String) -> [GraphChatPlainTextSegment] {
    guard !text.isEmpty else { return [] }
    var segments: [GraphChatPlainTextSegment] = []
    var cursor = text.startIndex
    for match in text.matches(#"\b(?:https?://|www\.)[^\s<>"'`]+"#, options: [.caseInsensitive]) {
        let trailing = match.value.firstMatch(#"[),.;:!?]+$"#)?.value ?? ""
        let urlText = trailing.isEmpty ? match.value : String(match.value.dropLast(trailing.count))
        guard !urlText.isEmpty else { continue }
        if match.range.lowerBound > cursor {
            segments.append(.text(String(text[cursor ..< match.range.lowerBound])))
        }
        segments.append(.url(text: urlText, href: normalizeGraphChatHref(urlText)))
        if !trailing.isEmpty {
            segments.append(.text(trailing))
        }
        cursor = match.range.upperBound
    }
    if cursor < text.endIndex {
        segments.append(.text(String(text[cursor...])))
    }
    return segments
}

private struct CodeFenceOpening {
    var marker: String
    var language: String
}

private struct ListItemReadResult {
    var text: String
    var nextIndex: Int
}

private struct TableReadResult {
    var columns: [RichTableColumn]
    var rows: [[String]]
    var nextIndex: Int
}

private struct SetextHeadingReadResult {
    var level: Int
    var text: String
    var nextIndex: Int
}

private struct HtmlReadResult {
    var source: String
    var nextIndex: Int
}

private struct MathReadResult {
    var expression: String
    var nextIndex: Int
}

private func listIndentLevel(_ line: String) -> Int {
    min(max(line.prefix(while: { $0 == " " }).count / 2, 0), 4)
}

private func isClosingCodeFence(_ trimmed: String, marker: String) -> Bool {
    guard let fence = marker.first, !marker.isEmpty, trimmed.count >= marker.count else { return false }
    return trimmed.allSatisfy { $0 == fence }
}

private func readCodeFenceOpening(_ trimmed: String) -> CodeFenceOpening? {
    guard let match = trimmed.firstMatch(#"^(`{3,}|~{3,})(.*)$"#) else { return nil }
    let info = match[2].trimmingCharacters(in: .whitespacesAndNewlines)
    let language = info.components(separatedBy: .whitespaces).first ?? ""
    return CodeFenceOpening(
        marker: match[1],
        language: language.matches(#"^[A-Za-z0-9_-]+$"#) ? language : ""
    )
}

private func readListItem(lines: [String], startIndex: Int, initialText: String) -> ListItemReadResult {
    let continuationIndent = listContentColumn(lines[startIndex])
    var parts = [initialText.trimmedRight]
    var index = startIndex + 1
    while index < lines.count {
        let line = lines[index]
        let trimmedEnd = line.trimmedRight
        let compact = trimmedEnd.trimmingCharacters(in: .whitespacesAndNewlines)
        if compact.isEmpty || isListItemLine(compact) {
            break
        }
        let leadingSpaces = line.prefix(while: { $0 == " " }).count
        if leadingSpaces < continuationIndent {
            break
        }
        let continuation = String(line.dropFirst(min(continuationIndent, line.count))).trimmedRight
        if !continuation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            parts.append(continuation)
        }
        index += 1
    }
    return ListItemReadResult(text: parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines), nextIndex: index)
}

private func listContentColumn(_ line: String) -> Int {
    line.firstMatch(#"^\s*(?:[-*+]\s+(?:\[[ xX]]\s+)?|\d{1,9}[.)]\s+)"#)?.value.count ?? line.prefix(while: { $0 == " " }).count + 2
}

private func isListItemLine(_ trimmed: String) -> Bool {
    trimmed.containsRegex(#"^[-*+]\s+(?:\[[ xX]]\s+)?\S"#) ||
        trimmed.containsRegex(#"^\d{1,9}[.)]\s+\S"#)
}

private func readSetextHeading(lines: [String], startIndex: Int) -> SetextHeadingReadResult? {
    guard startIndex + 1 < lines.count else { return nil }
    let text = lines[startIndex].trimmingCharacters(in: .whitespacesAndNewlines)
    let invalidHeading = text.isEmpty || text.hasPrefix("#") || text.hasPrefix(">") ||
        isListItemLine(text) || readCodeFenceOpening(text) != nil || text.contains("|")
    guard !invalidHeading else {
        return nil
    }
    let marker = lines[startIndex + 1].trimmingCharacters(in: .whitespacesAndNewlines)
    let level: Int
    if marker.matches(#"=+"#) {
        level = 1
    } else if marker.matches(#"-+"#) {
        level = 2
    } else {
        return nil
    }
    return SetextHeadingReadResult(level: level, text: text, nextIndex: startIndex + 2)
}

private func readQuoteBlock(lines: [String], startIndex: Int) -> (text: String, nextIndex: Int)? {
    let firstLine = lines[startIndex].trimmedRight.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let first = firstLine.firstMatch(#"^>\s?(.*)$"#) else { return nil }
    var quoteLines = [first[1]]
    var index = startIndex + 1
    while index < lines.count {
        let compact = lines[index].trimmedRight.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let next = compact.firstMatch(#"^>\s?(.*)$"#) else { break }
        quoteLines.append(next[1])
        index += 1
    }
    return (quoteLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines), index)
}

private func readHtmlBlock(lines: [String], startIndex: Int) -> HtmlReadResult? {
    let first = lines[startIndex].trimmingCharacters(in: .whitespacesAndNewlines)
    guard looksLikeHtmlBlockStart(first) else { return nil }
    var htmlLines = [lines[startIndex].trimmedRight]
    var index = startIndex + 1
    while index < lines.count {
        let line = lines[index]
        if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            break
        }
        let trimmed = line.trimmedRight
        let compact = trimmed.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextBlockStarts = readCodeFenceOpening(compact) != nil ||
            readSimpleMarkdownTable(lines: lines, startIndex: index) != nil ||
            compact.matches(#"^(#{1,6})\s+.+$"#) ||
            isListItemLine(compact)
        if nextBlockStarts {
            break
        }
        htmlLines.append(trimmed)
        index += 1
    }
    return HtmlReadResult(source: htmlLines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines), nextIndex: index)
}

private func looksLikeHtmlBlockStart(_ trimmed: String) -> Bool {
    trimmed.hasPrefix("<!--") || trimmed.hasPrefix("<![CDATA[") || trimmed.hasPrefix("<?") ||
        trimmed.matches(#"^</?[A-Za-z][A-Za-z0-9-]*(?:\s+[^>]*)?>\s*$"#) ||
        trimmed.matches(#"^<([A-Za-z][A-Za-z0-9-]*)(?:\s+[^>]*)?>.*</\1>\s*$"#)
}

private func readDelimitedMathBlock(
    lines: [String],
    startIndex: Int,
    opening: String,
    closing: String
) -> MathReadResult? {
    let startLine = lines[startIndex].trimmingCharacters(in: .whitespacesAndNewlines)
    guard startLine.hasPrefix(opening) else { return nil }
    let firstBody = String(startLine.dropFirst(opening.count))
    if firstBody.hasSuffix(closing), firstBody.count >= closing.count {
        return MathReadResult(
            expression: String(firstBody.dropLast(closing.count)).trimmingCharacters(in: .whitespacesAndNewlines),
            nextIndex: startIndex + 1
        )
    }
    var body: [String] = []
    if !firstBody.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        body.append(firstBody)
    }
    var index = startIndex + 1
    while index < lines.count {
        let line = lines[index]
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasSuffix(closing) {
            let beforeClosing = line.components(separatedBy: closing).dropLast().joined(separator: closing).trimmedRight
            if !beforeClosing.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                body.append(beforeClosing)
            }
            return MathReadResult(
                expression: body.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines),
                nextIndex: index + 1
            )
        }
        body.append(line)
        index += 1
    }
    return MathReadResult(
        expression: body.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines),
        nextIndex: lines.count
    )
}

private func readSimpleMarkdownTable(lines: [String], startIndex: Int) -> TableReadResult? {
    guard startIndex + 1 < lines.count,
          let header = parseTableRow(lines[startIndex]),
          let alignments = parseTableSeparator(lines[startIndex + 1]),
          header.count >= 2,
          alignments.count >= 2
    else {
        return nil
    }
    let columns = header.enumerated().map { index, title in
        RichTableColumn(header: title, alignment: alignments.indices.contains(index) ? alignments[index] : .left)
    }
    var rows: [[String]] = []
    var index = startIndex + 2
    while index < lines.count {
        guard let row = parseTableRow(lines[index]), !row.isEmpty else { break }
        rows.append(normalizeTableRow(row, columnCount: columns.count))
        index += 1
    }
    return TableReadResult(columns: columns, rows: rows, nextIndex: index)
}

private func normalizeTableRow(_ row: [String], columnCount: Int) -> [String] {
    if row.count == columnCount {
        return row
    }
    if row.count > columnCount {
        return Array(row.prefix(columnCount))
    }
    return row + Array(repeating: "", count: columnCount - row.count)
}

private func parseTableRow(_ line: String) -> [String]? {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.contains("|") else { return nil }
    let body = trimmed.trimmingCharacters(in: CharacterSet(charactersIn: "|"))
    var cells: [String] = []
    var current = ""
    var index = body.startIndex
    while index < body.endIndex {
        let character = body[index]
        if character == "\\", body.index(after: index) < body.endIndex, body[body.index(after: index)] == "|" {
            current.append("|")
            index = body.index(index, offsetBy: 2)
            continue
        }
        if character == "|" {
            cells.append(current.trimmingCharacters(in: .whitespacesAndNewlines))
            current = ""
        } else {
            current.append(character)
        }
        index = body.index(after: index)
    }
    cells.append(current.trimmingCharacters(in: .whitespacesAndNewlines))
    return cells
}

private func parseTableSeparator(_ line: String) -> [RichTableAlignment]? {
    guard let cells = parseTableRow(line), cells.allSatisfy({ $0.matches(#":?-{3,}:?"#) }) else { return nil }
    return cells.map { cell in
        if cell.hasPrefix(":"), cell.hasSuffix(":") {
            return .center
        }
        if cell.hasSuffix(":") {
            return .right
        }
        return .left
    }
}

private func normalizeMathExpression(_ expression: String) -> String {
    var text = expression.trimmingCharacters(in: .whitespacesAndNewlines)
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
    text = replaceLatexCommandWithTwoGroups(text, command: #"\frac"#) { numerator, denominator in
        "(\(numerator))/(\(denominator))"
    }
    text = replaceLatexCommandWithOneGroup(text, command: #"\sqrt"#) { value in
        "sqrt(\(value))"
    }
    for (source, replacement) in latexSymbolReplacements {
        text = text.replacingOccurrences(of: source, with: replacement)
    }
    return text
}

private struct BracedGroup {
    var value: String
    var nextIndex: String.Index
}

private func replaceLatexCommandWithTwoGroups(_ text: String, command: String, replacement: (String, String) -> String) -> String {
    var output = ""
    var index = text.startIndex
    while let commandRange = text.range(of: command, range: index ..< text.endIndex) {
        output += text[index ..< commandRange.lowerBound]
        let first = readBracedGroup(text, startIndex: commandRange.upperBound)
        let second = first.flatMap { readBracedGroup(text, startIndex: $0.nextIndex) }
        if let first, let second {
            output += replacement(first.value, second.value)
            index = second.nextIndex
        } else {
            output += command
            index = commandRange.upperBound
        }
    }
    output += text[index...]
    return output
}

private func replaceLatexCommandWithOneGroup(_ text: String, command: String, replacement: (String) -> String) -> String {
    var output = ""
    var index = text.startIndex
    while let commandRange = text.range(of: command, range: index ..< text.endIndex) {
        output += text[index ..< commandRange.lowerBound]
        if let group = readBracedGroup(text, startIndex: commandRange.upperBound) {
            output += replacement(group.value)
            index = group.nextIndex
        } else {
            output += command
            index = commandRange.upperBound
        }
    }
    output += text[index...]
    return output
}

private func readBracedGroup(_ text: String, startIndex: String.Index) -> BracedGroup? {
    var index = startIndex
    while index < text.endIndex, text[index].isWhitespace {
        index = text.index(after: index)
    }
    guard index < text.endIndex, text[index] == "{" else { return nil }
    var depth = 0
    var value = ""
    while index < text.endIndex {
        let character = text[index]
        if character == "{" {
            if depth > 0 { value.append(character) }
            depth += 1
        } else if character == "}" {
            depth -= 1
            if depth == 0 {
                return BracedGroup(value: value, nextIndex: text.index(after: index))
            }
            value.append(character)
        } else {
            value.append(character)
        }
        index = text.index(after: index)
    }
    return nil
}

private func tokenizeMathExpression(_ expression: String) -> [MathToken] {
    guard !expression.isEmpty else { return [] }
    var tokens: [MathToken] = []
    var text = ""
    var index = expression.startIndex
    func flushText() {
        if !text.isEmpty {
            tokens.append(.text(text))
            text = ""
        }
    }
    while index < expression.endIndex {
        let character = expression[index]
        if character == "^" || character == "_", let script = readScriptValue(expression, startIndex: expression.index(after: index)) {
            flushText()
            tokens.append(character == "^" ? .superscript(script.value) : .subscriptText(script.value))
            index = script.nextIndex
            continue
        }
        text.append(character)
        index = expression.index(after: index)
    }
    flushText()
    return tokens.mergeAdjacentTextTokens()
}

private func readScriptValue(_ text: String, startIndex: String.Index) -> BracedGroup? {
    guard startIndex < text.endIndex else { return nil }
    if let braced = readBracedGroup(text, startIndex: startIndex) {
        return braced
    }
    guard !text[startIndex].isWhitespace else { return nil }
    return BracedGroup(value: String(text[startIndex]), nextIndex: text.index(after: startIndex))
}

private extension [MathToken] {
    func mergeAdjacentTextTokens() -> [MathToken] {
        var output: [MathToken] = []
        for token in self {
            if case let .text(previous) = output.last, case let .text(current) = token {
                output[output.count - 1] = .text(previous + current)
            } else {
                output.append(token)
            }
        }
        return output
    }
}

private let latexSymbolReplacements: [(String, String)] = [
    (#"\alpha"#, "alpha"),
    (#"\beta"#, "beta"),
    (#"\gamma"#, "gamma"),
    (#"\delta"#, "delta"),
    (#"\epsilon"#, "epsilon"),
    (#"\theta"#, "theta"),
    (#"\lambda"#, "lambda"),
    (#"\mu"#, "mu"),
    (#"\pi"#, "pi"),
    (#"\sigma"#, "sigma"),
    (#"\phi"#, "phi"),
    (#"\omega"#, "omega"),
    (#"\infty"#, "infinity"),
    (#"\sum"#, "sum"),
    (#"\int"#, "integral"),
    (#"\leq"#, "<="),
    (#"\geq"#, ">="),
    (#"\neq"#, "!="),
    (#"\times"#, "x"),
    (#"\cdot"#, "*"),
    (#"\rightarrow"#, "->"),
    (#"\left"#, ""),
    (#"\right"#, "")
]

private func repeatedCharacterCount(_ text: String, at index: String.Index, character: Character) -> Int {
    var cursor = index
    var count = 0
    while cursor < text.endIndex, text[cursor] == character {
        count += 1
        cursor = text.index(after: cursor)
    }
    return count
}

private enum RegexPatterns {
    static let blankLine = try? NSRegularExpression(pattern: #"\n{2,}"#)
}

private struct RegexMatch {
    var value: String
    var range: Range<String.Index>
    var groups: [String]

    subscript(index: Int) -> String {
        groups[index - 1]
    }
}

private func compareRegexMatches(_ lhs: RegexMatch, _ rhs: RegexMatch) -> Bool {
    lhs.range.lowerBound == rhs.range.lowerBound ? lhs.range.upperBound < rhs.range.upperBound : lhs.range.lowerBound < rhs.range.lowerBound
}

private extension String {
    var trimmedRight: String {
        replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
    }

    var isValidJSONContainer: Bool {
        guard let first = trimmingCharacters(in: .whitespacesAndNewlines).first, first == "{" || first == "[" else {
            return false
        }
        guard let data = data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data)
        else {
            return false
        }
        return value is [String: Any] || value is [Any]
    }

    func matches(_ pattern: String, options: NSRegularExpression.Options = []) -> Bool {
        firstMatch(pattern, options: options) != nil
    }

    func containsRegex(_ pattern: String, options: NSRegularExpression.Options = []) -> Bool {
        firstMatch(pattern, options: options) != nil
    }

    func firstMatch(_ pattern: String, from start: String.Index? = nil, options: NSRegularExpression.Options = []) -> RegexMatch? {
        matches(pattern, from: start, options: options).first
    }

    func matches(_ pattern: String, from start: String.Index? = nil, options: NSRegularExpression.Options = []) -> [RegexMatch] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return [] }
        let searchRange = (start ?? startIndex) ..< endIndex
        let nsRange = NSRange(searchRange, in: self)
        return regex.matches(in: self, range: nsRange).compactMap { result in
            guard let range = Range(result.range, in: self) else { return nil }
            let groups = (1 ..< result.numberOfRanges).map { index in
                guard let groupRange = Range(result.range(at: index), in: self) else { return "" }
                return String(self[groupRange])
            }
            return RegexMatch(value: String(self[range]), range: range, groups: groups)
        }
    }
}

private extension StringProtocol {
    func components(separatedBy regex: NSRegularExpression) -> [String] {
        let string = String(self)
        var parts: [String] = []
        var cursor = string.startIndex
        for match in regex.matches(in: string, range: NSRange(string.startIndex ..< string.endIndex, in: string)) {
            guard let range = Range(match.range, in: string) else { continue }
            parts.append(String(string[cursor ..< range.lowerBound]))
            cursor = range.upperBound
        }
        parts.append(String(string[cursor...]))
        return parts
    }
}
