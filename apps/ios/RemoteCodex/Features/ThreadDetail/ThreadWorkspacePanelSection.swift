import SwiftUI

enum ThreadWorkspacePanelTab: String, CaseIterable, Identifiable {
    case workspace
    case toolUsage
    case guide
    case graph
    case extensions

    var id: String {
        rawValue
    }

    var label: String {
        switch self {
        case .workspace:
            "Workspace"
        case .toolUsage:
            "Tool Usage"
        case .guide:
            "Guide"
        case .graph:
            "Graph"
        case .extensions:
            "Extensions"
        }
    }
}

struct ThreadWorkspacePanelSection: View {
    @ObservedObject var model: ThreadDetailViewModel
    @Binding var selectedTab: ThreadWorkspacePanelTab

    var body: some View {
        Section("Workspace Panel") {
            Picker("Panel", selection: $selectedTab) {
                ForEach(ThreadWorkspacePanelTab.allCases) { tab in
                    Text(tab.label).tag(tab)
                }
            }
            .pickerStyle(.segmented)

            switch selectedTab {
            case .workspace:
                workspaceView
            case .toolUsage:
                toolUsageView
            case .guide:
                guideView
            case .graph:
                graphView
            case .extensions:
                extensionsView
            }
        }
    }

    private var workspaceView: some View {
        Group {
            let context = model.presentation?.workspaceContext
            if let rootName = context?.rootName {
                LabeledContent("Root", value: rootName)
            }
            if let path = context?.previewPath, let content = context?.previewText {
                LabeledContent("Preview", value: path)
                Text(content)
                    .font(.system(.caption, design: .monospaced))
                    .lineLimit(8)
                    .textSelection(.enabled)
                if context?.previewTruncated == true {
                    Text("Preview truncated")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Text("No workspace file preview loaded.")
                    .foregroundStyle(.secondary)
            }
            ForEach(model.bundleWarnings, id: \.self) { warning in
                Text(warning)
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
    }

    private var toolUsageView: some View {
        Group {
            LabeledContent("Export turns", value: "\(model.presentation?.exportTurns.count ?? 0)")
            LabeledContent("Fork turns", value: "\(model.presentation?.forkTurns.count ?? 0)")
            LabeledContent("Timeline history", value: "\(timelineHistoryCount)")
            LabeledContent("Transcript items", value: model.presentation?.itemSummary ?? "0 transcript items")
        }
    }

    private var guideView: some View {
        Group {
            LabeledContent("Runtime", value: model.presentation?.runtime ?? "codex")
            LabeledContent("Reasoning", value: model.reasoningDraft.trimmedNonEmpty ?? "Default")
            LabeledContent("Collaboration", value: model.collaborationDraft)
            LabeledContent("Sandbox", value: model.sandboxDraft.trimmedNonEmpty ?? "Default")
        }
    }

    private var graphView: some View {
        Group {
            LabeledContent("Workspace", value: model.presentation?.workspace ?? "Workspace")
            LabeledContent("Branch", value: model.presentation?.branch ?? "-")
            LabeledContent("Turns", value: "\(model.presentation?.turns.count ?? 0)")
            LabeledContent("Pending requests", value: "\(model.presentation?.pendingRequestCount ?? 0)")
        }
    }

    private var extensionsView: some View {
        Group {
            if let summary = model.presentation?.extensionSummary {
                LabeledContent("Skills", value: "\(summary.skillCount)")
                LabeledContent("MCP servers", value: "\(summary.mcpServerCount)")
                LabeledContent("MCP tools", value: "\(summary.mcpToolCount)")
                LabeledContent("Hooks", value: "\(summary.hookCount)")
            } else {
                Text("Extensions have not loaded yet.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var timelineHistoryCount: Int {
        model.presentation?.turns.reduce(0) { $0 + $1.historyItems.count } ?? 0
    }
}
