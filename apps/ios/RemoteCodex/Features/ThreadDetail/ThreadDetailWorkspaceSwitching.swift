import SwiftUI

@MainActor
extension ThreadDetailViewModel {
    func loadAvailableWorkspaces() async {
        do {
            availableWorkspaces = try await environment.apiClientFactory(connection).listWorkspaces()
        } catch {
            bundleWarnings.append("Workspaces: \(error.localizedDescription)")
        }
    }
}

struct ThreadWorkspaceSwitcherSheet: View {
    @ObservedObject var model: ThreadDetailViewModel
    let onSelect: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if model.availableWorkspaces.isEmpty {
                    ContentUnavailableView("No Workspaces", systemImage: "folder")
                }
                ForEach(model.availableWorkspaces) { workspace in
                    Button {
                        dismiss()
                        onSelect(workspace.id)
                    } label: {
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(workspace.label)
                                    .font(.callout.weight(.semibold))
                                Text(workspace.absPath)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            Spacer()
                            if workspace.id == model.detail?.workspace.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                                    .accessibilityLabel("Current workspace")
                            }
                        }
                    }
                    .accessibilityIdentifier("thread-workspace-switch-\(workspace.id)")
                }
            }
            .navigationTitle("Workspaces")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Refresh") {
                        Task { await model.loadAvailableWorkspaces() }
                    }
                }
            }
        }
    }
}
