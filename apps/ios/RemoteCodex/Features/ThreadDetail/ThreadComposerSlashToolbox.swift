import SwiftUI

enum ComposerSlashCommandKind: String, CaseIterable {
    case fast
    case compact
    case goal
    case fork
    case mcp
    case hooks
    case export
}

struct ComposerSlashCommandItem: Identifiable, Equatable {
    var id: String {
        command
    }

    var kind: ComposerSlashCommandKind
    var command: String
    var label: String
    var status: String
    var description: String
    var enabled: Bool
}

func composerSlashCommandQuery(_ prompt: String) -> String? {
    let trimmedPrefix = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmedPrefix.hasPrefix("/") else { return nil }
    return String(trimmedPrefix.dropFirst())
}

func composerSlashCommandArgument(prompt: String, command: String) -> String? {
    guard let query = composerSlashCommandQuery(prompt) else { return nil }
    let commandName = command.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard query == commandName || query.hasPrefix("\(commandName) ") else { return nil }
    return String(query.dropFirst(commandName.count)).trimmedNonEmpty
}

func composerPromptClearingSlashCommand(_ prompt: String, command: String) -> String {
    guard composerSlashCommandArgument(prompt: prompt, command: command) != nil ||
        composerSlashCommandQuery(prompt) == command.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    else {
        return prompt
    }
    return ""
}

func buildComposerSlashCommandItems(
    query: String?,
    fastMode: Bool,
    hasForkTargets: Bool,
    busy: Bool
) -> [ComposerSlashCommandItem] {
    let normalizedQuery = query?.lowercased().split(separator: " ").first.map(String.init) ?? ""
    return ComposerSlashCommandKind.allCases.compactMap { kind in
        let item = composerSlashCommandItem(kind: kind, fastMode: fastMode, hasForkTargets: hasForkTargets, busy: busy)
        guard normalizedQuery.isEmpty ||
            item.command.dropFirst().lowercased().hasPrefix(normalizedQuery) ||
            item.label.lowercased().hasPrefix(normalizedQuery)
        else {
            return nil
        }
        return item
    }
}

private func composerSlashCommandItem(
    kind: ComposerSlashCommandKind,
    fastMode: Bool,
    hasForkTargets: Bool,
    busy: Bool
) -> ComposerSlashCommandItem {
    switch kind {
    case .fast:
        ComposerSlashCommandItem(
            kind: kind,
            command: "/fast",
            label: "Fast",
            status: fastMode ? "On" : "Off",
            description: "Toggle fast mode for this thread.",
            enabled: !busy
        )
    case .compact:
        ComposerSlashCommandItem(
            kind: kind,
            command: "/compact",
            label: "Compact",
            status: busy ? "Busy" : "Run",
            description: "Request context compaction.",
            enabled: !busy
        )
    case .goal:
        ComposerSlashCommandItem(
            kind: kind,
            command: "/goal",
            label: "Goal",
            status: "Set",
            description: "Use /goal <objective> to update the active goal.",
            enabled: !busy
        )
    case .fork:
        ComposerSlashCommandItem(
            kind: kind,
            command: "/fork",
            label: "Fork",
            status: hasForkTargets ? "Latest" : "Unavailable",
            description: "Fork from the latest turn.",
            enabled: !busy && hasForkTargets
        )
    case .mcp:
        ComposerSlashCommandItem(
            kind: kind,
            command: "/mcp",
            label: "MCP",
            status: "View",
            description: "Open MCP server information.",
            enabled: true
        )
    case .hooks:
        ComposerSlashCommandItem(
            kind: kind,
            command: "/hooks",
            label: "Hooks",
            status: "View",
            description: "Open hook information.",
            enabled: true
        )
    case .export:
        ComposerSlashCommandItem(
            kind: kind,
            command: "/export",
            label: "Export",
            status: "Open",
            description: "Open transcript export options.",
            enabled: true
        )
    }
}

struct ThreadComposerSlashToolbox: View {
    let items: [ComposerSlashCommandItem]
    let onSelect: (ComposerSlashCommandItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Slash toolbox")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                Text("Thread actions")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if items.isEmpty {
                Text("No matching commands.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(items) { item in
                    Button {
                        onSelect(item)
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(item.command)
                                .font(.caption.monospaced().weight(.semibold))
                                .frame(width: 68, alignment: .leading)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.label)
                                Text(item.description)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                            Spacer()
                            GraphBadge(text: item.status, tone: item.enabled ? .neutral : .destructive)
                        }
                    }
                    .buttonStyle(.bordered)
                    .disabled(!item.enabled)
                    .accessibilityIdentifier("thread-slash-\(item.kind.rawValue)")
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("thread-slash-toolbox")
    }
}
