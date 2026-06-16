import SwiftUI

struct ThreadHistoryDetailSheet: View {
    let item: HistoryItemPresentation
    @ObservedObject var model: ThreadDetailViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let preview = model.historyDetailPreview(for: item)
        NavigationStack {
            List {
                Section("Summary") {
                    LabeledContent("Type", value: historyItemLabel(item.kind))
                    LabeledContent("Title", value: preview.title)
                    if let status = item.status {
                        LabeledContent("Status", value: toolResultStatusLabel(status))
                    }
                    LabeledContent("Content type", value: preview.contentType)
                    if let sourcePath = preview.sourcePath {
                        LabeledContent("Source", value: sourcePath)
                    }
                    if model.loadingHistoryDetailId == item.id {
                        ProgressView("Loading detail...")
                    }
                }
                Section("Content") {
                    if preview.contentType == "text/markdown" {
                        RichMessageContentView(text: preview.text)
                    } else {
                        Text(preview.text)
                            .font(.system(.body, design: .monospaced))
                            .textSelection(.enabled)
                    }
                    if let callId = item.callId {
                        LabeledContent("Call ID", value: callId)
                    }
                    if let toolName = item.toolName {
                        LabeledContent("Tool", value: toolName)
                    }
                }
            }
            .navigationTitle("Detail")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                await model.loadHistoryDetail(for: item)
            }
        }
    }
}

struct ThreadExportDialog: View {
    @ObservedObject var model: ThreadDetailViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Format") {
                    Picker("Format", selection: $model.exportFormat) {
                        Text("PDF").tag("pdf")
                        Text("HTML").tag("html")
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("thread-export-format-picker")
                    Picker("Mode", selection: $model.exportMode) {
                        Text("Latest").tag("latest")
                        Text("Custom").tag("custom")
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("thread-export-mode-picker")
                    Toggle("Token and price", isOn: $model.includeTokenAndPrice)
                        .accessibilityIdentifier("thread-export-token-price-toggle")
                    Toggle("Command output", isOn: $model.includeCommandOutput)
                        .accessibilityIdentifier("thread-export-command-output-toggle")
                    Toggle("Absolute paths", isOn: $model.includeAbsolutePaths)
                        .accessibilityIdentifier("thread-export-absolute-paths-toggle")
                }
                if model.exportMode == "custom" {
                    Section("Turns") {
                        let turns = model.presentation?.exportTurns ?? []
                        if turns.isEmpty {
                            Text("No export turns loaded.")
                                .foregroundStyle(.secondary)
                        } else {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(exportSelectionSummary(total: turns.count))
                                    .font(.caption)
                                    .foregroundStyle(model.selectedExportTurnCount == 0 ? .orange : .secondary)
                                HStack {
                                    Button("Select All") {
                                        model.selectAllExportTurns()
                                    }
                                    .accessibilityIdentifier("thread-export-select-all")
                                    .disabled(model.loading || model.selectedExportTurnCount == turns.count)
                                    Button("Clear") {
                                        model.clearSelectedExportTurns()
                                    }
                                    .accessibilityIdentifier("thread-export-clear")
                                    .disabled(model.loading || model.selectedExportTurnCount == 0)
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        ForEach(turns) { turn in
                            Button {
                                toggleTurn(turn.id)
                            } label: {
                                HStack {
                                    Image(systemName: model.selectedExportTurnIds.contains(turn.id) ? "checkmark.circle.fill" : "circle")
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Turn \(turn.number)")
                                        Text("\(turn.timeLabel) · \(turn.promptPreview)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(2)
                                    }
                                }
                            }
                            .accessibilityIdentifier("thread-export-turn-\(turn.id)")
                        }
                    }
                }
                if let error = model.errorMessage {
                    Section("Export Error") {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.orange)
                        if model.exportedFile != nil {
                            Text("The previous export is still available to share.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Section {
                    Button(model.loading ? "Exporting..." : "Export \(model.exportFormat.uppercased())") {
                        Task {
                            await model.exportTranscript()
                            if model.errorMessage == nil {
                                dismiss()
                            }
                        }
                    }
                    .accessibilityIdentifier("thread-export-submit")
                    .disabled(!canExport)
                    if let exportedFile = model.exportedFile {
                        ShareLink(item: exportedFile.url) {
                            Label("Share \(exportedFile.filename)", systemImage: "square.and.arrow.up")
                        }
                        .accessibilityIdentifier("thread-export-share")
                    }
                }
            }
            .navigationTitle("Export")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private var canExport: Bool {
        !model.loading && (model.exportMode != "custom" || model.selectedExportTurnCount > 0)
    }

    private func exportSelectionSummary(total: Int) -> String {
        if model.selectedExportTurnCount == 0 {
            return "Select at least one turn to export."
        }
        return "Selected \(model.selectedExportTurnCount) of \(total) turns."
    }

    private func toggleTurn(_ id: String) {
        if model.selectedExportTurnIds.contains(id) {
            model.selectedExportTurnIds.remove(id)
        } else {
            model.selectedExportTurnIds.insert(id)
        }
    }
}
