import SwiftUI

struct RichMessageContentView: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                RichMessageBlockView(block: block)
            }
        }
        .textSelection(.enabled)
    }

    private var blocks: [RichMessageBlock] {
        let processed = preprocessGraphChatToolBlocks(text).processedContent
        return hasLikelyMarkdownSyntax(processed) ? parseRichMessageBlocks(processed) : parsePlainRichMessageBlocks(processed)
    }
}

private struct RichMessageBlockView: View {
    let block: RichMessageBlock

    var body: some View {
        switch block {
        case let .paragraph(value):
            InlineSegmentsView(segments: graphChatInlineSegments(value))
                .font(.callout)
        case let .heading(level, value):
            Text(value)
                .font(level <= 2 ? .headline : .subheadline.weight(.semibold))
        case let .bullet(text, checked, level):
            RichListItemView(marker: checked.map { $0 ? "[x]" : "[ ]" } ?? "•", text: text, level: level)
        case let .orderedItem(number, text, level):
            RichListItemView(marker: "\(number).", text: text, level: level)
        case let .quote(value):
            Text(value)
                .font(.callout)
                .foregroundStyle(.secondary)
                .padding(.leading, 10)
        case .horizontalRule:
            Divider()
        case let .math(expression):
            MathPresentationView(presentation: buildMathPresentation(expression))
        case let .html(source):
            Text(source)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
        case let .table(columns, rows):
            RichTableView(columns: columns, rows: rows)
        case let .code(language, code):
            if language == "tool-call" || language == "tool-merged" {
                ToolCallBlockView(state: buildGraphChatToolCallState(language: language, body: code))
            } else if isMoleculeCodeBlock(language: language, code: code) {
                MoleculePreviewBlockView(
                    data: readGraphMoleculeViewerData(source: "\(code.trimmingCharacters(in: .newlines))\n", format: language)
                )
            } else {
                RichCodeBlockView(language: language, code: code)
            }
        }
    }
}

private struct MoleculePreviewBlockView: View {
    let data: GraphMoleculeViewerData

    var body: some View {
        let model = buildMoleculeFallbackPreview(data: data)
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(model.format.uppercased()) molecule")
                        .font(.caption.weight(.semibold))
                    Text("Rendered from message source")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                GraphBadge(text: model.frameCount == 1 ? "1 frame" : "\(model.frameCount) frames", tone: .neutral)
                if firstFrameAtomCount > 0 {
                    GraphBadge(text: "\(firstFrameAtomCount) atoms", tone: .success)
                } else {
                    GraphBadge(text: "source only", tone: .warning)
                }
            }
            MoleculeSchematicView(data: data)
            if !model.sourcePreview.isEmpty {
                Text(model.sourcePreview)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
                    .padding(.top, 2)
            }
        }
        .padding(10)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.secondary.opacity(0.18), lineWidth: 1)
        }
    }

    private var firstFrameAtomCount: Int {
        data.frames.first.map(parseXyzAtoms)?.count ?? 0
    }
}

private struct MoleculeSchematicView: View {
    let data: GraphMoleculeViewerData

    var body: some View {
        GeometryReader { proxy in
            let scaled = buildMoleculeFallbackPreview(data: data, width: Double(proxy.size.width), height: Double(proxy.size.height))
            Canvas { context, _ in
                for bond in scaled.bonds {
                    guard scaled.atoms.indices.contains(bond.startIndex), scaled.atoms.indices.contains(bond.endIndex) else { continue }
                    var path = Path()
                    path.move(to: CGPoint(
                        x: scaled.atoms[bond.startIndex].positionX,
                        y: scaled.atoms[bond.startIndex].positionY
                    ))
                    path.addLine(to: CGPoint(
                        x: scaled.atoms[bond.endIndex].positionX,
                        y: scaled.atoms[bond.endIndex].positionY
                    ))
                    context.stroke(path, with: .color(.secondary.opacity(0.42)), lineWidth: 3.2)
                }
                for atom in scaled.atoms.sorted(by: { $0.depth < $1.depth }) {
                    let rect = CGRect(
                        x: atom.positionX - atom.radius,
                        y: atom.positionY - atom.radius,
                        width: atom.radius * 2,
                        height: atom.radius * 2
                    )
                    context.fill(Path(ellipseIn: rect), with: .color(moleculeElementColor(atom.element)))
                    context.stroke(Path(ellipseIn: rect), with: .color(.white.opacity(0.40)), lineWidth: 1)
                }
            }
        }
        .frame(height: 170)
        .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 8))
    }
}

private func moleculeElementColor(_ element: String) -> Color {
    switch element.uppercased() {
    case "H":
        Color(red: 0.90, green: 0.91, blue: 0.92)
    case "C":
        Color(red: 0.61, green: 0.64, blue: 0.69)
    case "N":
        Color(red: 0.38, green: 0.65, blue: 0.98)
    case "O":
        Color(red: 0.97, green: 0.44, blue: 0.44)
    case "S":
        Color(red: 0.98, green: 0.80, blue: 0.08)
    case "P":
        Color(red: 0.96, green: 0.62, blue: 0.04)
    case "F", "CL", "BR", "I":
        Color(red: 0.20, green: 0.83, blue: 0.60)
    default:
        Color(red: 0.65, green: 0.69, blue: 0.75)
    }
}

private struct ToolCallBlockView: View {
    let state: GraphChatToolCallState
    @State private var isExpanded: Bool

    init(state: GraphChatToolCallState) {
        self.state = state
        _isExpanded = State(initialValue: state.defaultExpanded)
    }

    var body: some View {
        DisclosureGroup(isExpanded: $isExpanded) {
            VStack(alignment: .leading, spacing: 6) {
                ToolEntriesView(entries: graphChatToolEntries(state.parameters), renderObjectAsBlock: false)
                if let result = state.result {
                    ToolEntriesView(entries: graphChatToolEntries(result, usage: .result), renderObjectAsBlock: true)
                }
            }
            .padding(.top, 4)
        } label: {
            HStack(spacing: 8) {
                GraphBadge(text: state.statusLabel, tone: badgeTone)
                Text(state.title)
                    .font(.caption.weight(.semibold))
                if let callId = state.callId {
                    Text(callId)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var badgeTone: GraphBadgeTone {
        switch state.tone {
        case .completed:
            .success
        case .failed:
            .destructive
        case .running:
            .warning
        }
    }
}

private struct ToolEntriesView: View {
    let entries: [GraphChatToolEntry]
    let renderObjectAsBlock: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(entries, id: \.key) { entry in
                let display = buildGraphChatToolEntryDisplayState(entry: entry, renderObjectAsBlock: renderObjectAsBlock)
                VStack(alignment: .leading, spacing: 2) {
                    Text(display.key)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(display.displayValue)
                        .font(.system(.caption, design: display.displayKind == .outputBlock ? .monospaced : .default))
                        .foregroundStyle(.primary)
                }
            }
        }
    }
}

private struct RichListItemView: View {
    let marker: String
    let text: String
    let level: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(marker)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            InlineSegmentsView(segments: graphChatInlineSegments(text))
                .font(.callout)
        }
        .padding(.leading, CGFloat(level) * 14)
    }
}

private struct RichTableView: View {
    let columns: [RichTableColumn]
    let rows: [[String]]

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(columns.map(\.header).joined(separator: " | "))
                .font(.caption.weight(.semibold))
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                Text(row.joined(separator: " | "))
                    .font(.caption.monospaced())
            }
        }
    }
}

private struct RichCodeBlockView: View {
    let language: String
    let code: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !language.isEmpty {
                Text(language)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            Text(code)
                .font(.system(.caption, design: .monospaced))
        }
    }
}

private struct InlineSegmentsView: View {
    let segments: [GraphChatInlineSegment]

    var body: some View {
        Text(attributedText)
    }

    private var attributedText: AttributedString {
        segments.reduce(into: AttributedString()) { result, segment in
            var piece = AttributedString(segment.displayText)
            switch segment {
            case .code:
                piece.inlinePresentationIntent = .code
            case .strong:
                piece.inlinePresentationIntent = .stronglyEmphasized
            case .emphasis:
                piece.inlinePresentationIntent = .emphasized
            case let .url(_, href):
                piece.link = URL(string: href)
            case .strikethrough:
                piece.strikethroughStyle = .single
            case .math:
                piece.inlinePresentationIntent = .code
            case .image:
                piece.inlinePresentationIntent = .stronglyEmphasized
            case .text:
                break
            }
            result += piece
        }
    }
}

private struct MathPresentationView: View {
    let presentation: MathPresentation

    var body: some View {
        Text(presentation.tokens.map(\.displayText).joined())
            .font(.system(.callout, design: .monospaced))
            .accessibilityLabel(presentation.copyText)
    }
}

struct UserMessageSegmentsView: View {
    let text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(parseUserMessageSegments(text).enumerated()), id: \.offset) { _, segment in
                switch segment {
                case let .text(value):
                    InlineSegmentsView(segments: graphChatInlineSegments(value))
                        .font(.callout)
                case .photo, .file:
                    if let attachment = buildUserMessageAttachmentState(segment) {
                        UserAttachmentTokenView(attachment: attachment)
                    }
                }
            }
        }
        .textSelection(.enabled)
    }
}

private struct UserAttachmentTokenView: View {
    let attachment: UserMessageAttachmentState

    var body: some View {
        HStack(spacing: 6) {
            GraphBadge(text: attachment.typeLabel, tone: attachment.kind == .photo ? .neutral : .warning)
            Text(attachment.fileName)
                .font(.caption)
                .lineLimit(1)
        }
        .accessibilityLabel(attachment.accessibilityLabel)
    }
}

private extension GraphChatInlineSegment {
    var displayText: String {
        switch self {
        case let .text(value), let .code(value), let .math(value), let .strong(value), let .emphasis(value), let .strikethrough(value):
            value
        case let .url(text, _):
            text
        case let .image(label, source):
            isSafeMarkdownImageSource(source) ? "[image: \(label)]" : "![\(label)](\(source))"
        }
    }
}

private extension MathToken {
    var displayText: String {
        switch self {
        case let .text(value):
            value
        case let .superscript(value):
            "^\(value)"
        case let .subscriptText(value):
            "_\(value)"
        }
    }
}
