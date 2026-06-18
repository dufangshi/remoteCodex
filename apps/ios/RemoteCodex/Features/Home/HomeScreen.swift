import SwiftUI

@MainActor
final class HomeViewModel: ObservableObject {
    @Published var snapshot: SupervisorHomeSnapshot?
    @Published var loading = false
    @Published var errorMessage: String?
    @Published var searchText = ""
    @Published var threadFilter = ThreadFilter.all
    @Published var threadSort = ThreadSort.updated
    @Published var workspaceDraftPath = ""
    @Published var workspaceDraftLabel = ""
    @Published var newThreadWorkspaceId = ""
    @Published var newThreadTitle = ""
    @Published var newThreadModel = "gpt-5.4"
    @Published var settings = HomeSettingsState()
    @Published var themeMode: ThemeMode

    let connection: SupervisorConnectionConfig
    private let environment: AppEnvironment

    init(environment: AppEnvironment, connection: SupervisorConnectionConfig) {
        self.environment = environment
        self.connection = connection
        themeMode = environment.settingsStore.readThemeMode()
    }

    var client: SupervisorAPIClient {
        environment.apiClientFactory(connection)
    }

    var filteredThreads: [SupervisorThreadSummary] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return (snapshot?.threads ?? [])
            .filter { thread in
                threadFilter.matches(thread)
            }
            .filter { thread in
                query.isEmpty ||
                    thread.title.lowercased().contains(query) ||
                    thread.id.lowercased().contains(query) ||
                    (thread.summaryText ?? "").lowercased().contains(query)
            }
            .sorted(by: threadSort.comparator)
    }

    var groupedThreads: [(String, [SupervisorThreadSummary])] {
        let threads = filteredThreads
        let groups: [(String, (SupervisorThreadSummary) -> Bool)] = [
            ("Running", { $0.status == "running" }),
            ("Attention", { $0.status == "waiting" || $0.status == "blocked" }),
            ("Failed", { $0.status == "failed" }),
            ("Completed", { $0.status == "completed" || $0.status == "done" }),
            ("Recent", { _ in true })
        ]
        var used = Set<String>()
        return groups.compactMap { title, predicate in
            let items = threads.filter { predicate($0) && !used.contains($0.id) }
            items.forEach { used.insert($0.id) }
            return items.isEmpty ? nil : (title, items)
        }
    }

    func refresh() async {
        await runBusy {
            snapshot = try await client.fetchHomeSnapshot()
            if newThreadWorkspaceId.isEmpty {
                newThreadWorkspaceId = snapshot?.workspaces.first?.id ?? ""
            }
        }
    }

    func createWorkspace() async {
        await runBusy {
            _ = try await client.createWorkspace(
                CreateSupervisorWorkspaceRequest(
                    absPath: workspaceDraftPath,
                    label: workspaceDraftLabel.trimmedNonEmpty
                )
            )
            workspaceDraftPath = ""
            workspaceDraftLabel = ""
            snapshot = try await client.fetchHomeSnapshot()
        }
    }

    func toggleFavorite(_ workspace: SupervisorWorkspaceSummary) async {
        await runBusy {
            _ = try await client.setWorkspaceFavorite(workspaceId: workspace.id, isFavorite: !workspace.isFavorite)
            snapshot = try await client.fetchHomeSnapshot()
        }
    }

    func openWorkspace(_ workspace: SupervisorWorkspaceSummary) async {
        await runBusy {
            _ = try await client.openWorkspace(workspaceId: workspace.id)
            snapshot = try await client.fetchHomeSnapshot()
        }
    }

    func deleteWorkspace(_ workspace: SupervisorWorkspaceSummary) async {
        await runBusy {
            _ = try await client.deleteWorkspace(workspaceId: workspace.id)
            snapshot = try await client.fetchHomeSnapshot()
        }
    }

    func renameWorkspace(_ workspace: SupervisorWorkspaceSummary, label: String) async {
        await runBusy {
            _ = try await client.updateWorkspace(
                workspaceId: workspace.id,
                request: UpdateSupervisorWorkspaceRequest(label: label)
            )
            snapshot = try await client.fetchHomeSnapshot()
        }
    }

    func startThread() async -> String? {
        var createdThreadId: String?
        await runBusy {
            let thread = try await client.startThread(
                StartSupervisorThreadRequest(
                    workspaceId: newThreadWorkspaceId,
                    title: newThreadTitle.trimmedNonEmpty,
                    provider: nil,
                    model: newThreadModel,
                    reasoningEffort: nil,
                    approvalMode: "yolo"
                )
            )
            createdThreadId = thread.id
            snapshot = try await client.fetchHomeSnapshot()
        }
        return createdThreadId
    }

    func loadSettings() async {
        settings.loading = true
        settings.errorMessage = nil
        do {
            settings.runtimeConfig = try await client.fetchRuntimeConfig()
            let workspaceSettings = try await client.fetchWorkspaceSettings()
            settings.workspaceSettings = workspaceSettings
            settings.devHomeDraft = workspaceSettings.devHome
            settings.defaultBackendDraft = workspaceSettings.defaultBackend
            settings.agentBackends = try await client.listAgentBackends()
            settings.plugins = try await client.listPlugins()
        } catch {
            settings.errorMessage = error.localizedDescription
        }
        settings.loading = false
    }

    func setPlugin(_ plugin: SupervisorPluginSummary, enabled: Bool) async {
        do {
            let updated = try await client.updatePlugin(pluginId: plugin.id, request: UpdateSupervisorPluginRequest(enabled: enabled))
            settings.plugins = settings.plugins.map { $0.id == updated.id ? updated : $0 }
        } catch {
            settings.errorMessage = error.localizedDescription
        }
    }

    func importPluginManifest() async {
        settings.importingPlugin = true
        settings.errorMessage = nil
        do {
            let plugin = try await client.importPlugin(
                ImportSupervisorPluginRequest(
                    manifestJson: settings.pluginManifestDraft,
                    enabled: settings.pluginImportEnabled
                )
            )
            settings.plugins.removeAll { $0.id == plugin.id }
            settings.plugins.append(plugin)
            settings.pluginManifestDraft = ""
            settings.pluginImportEnabled = true
        } catch {
            settings.errorMessage = error.localizedDescription
        }
        settings.importingPlugin = false
    }

    func saveWorkspaceSettings() async {
        settings.savingWorkspaceSettings = true
        settings.errorMessage = nil
        do {
            let updated = try await client.updateWorkspaceSettings(
                UpdateSupervisorWorkspaceSettingsRequest(
                    devHome: settings.devHomeDraft,
                    defaultBackend: settings.defaultBackendDraft.trimmedNonEmpty
                )
            )
            settings.workspaceSettings = updated
            settings.devHomeDraft = updated.devHome
            settings.defaultBackendDraft = updated.defaultBackend
        } catch {
            settings.errorMessage = error.localizedDescription
        }
        settings.savingWorkspaceSettings = false
    }

    func setTheme(_ mode: ThemeMode) {
        themeMode = mode
        environment.settingsStore.writeThemeMode(mode)
    }

    private func runBusy(_ operation: () async throws -> Void) async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            try await operation()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct HomeSettingsState {
    var loading = false
    var errorMessage: String?
    var runtimeConfig: SupervisorRuntimeConfig?
    var workspaceSettings: SupervisorWorkspaceSettings?
    var devHomeDraft = ""
    var defaultBackendDraft = ""
    var savingWorkspaceSettings = false
    var pluginManifestDraft = ""
    var pluginImportEnabled = true
    var importingPlugin = false
    var agentBackends: [SupervisorAgentBackend] = []
    var plugins: [SupervisorPluginSummary] = []
}

enum ThreadFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case running = "Running"
    case attention = "Attention"
    case failed = "Failed"
    case completed = "Completed"

    var id: String {
        rawValue
    }

    func matches(_ thread: SupervisorThreadSummary) -> Bool {
        switch self {
        case .all:
            true
        case .running:
            thread.status == "running"
        case .attention:
            thread.status == "waiting" || thread.status == "blocked"
        case .failed:
            thread.status == "failed"
        case .completed:
            thread.status == "completed" || thread.status == "done"
        }
    }
}

enum ThreadSort: String, CaseIterable, Identifiable {
    case updated = "Updated"
    case title = "Title"
    case status = "Status"

    var id: String {
        rawValue
    }

    func comparator(_ lhs: SupervisorThreadSummary, _ rhs: SupervisorThreadSummary) -> Bool {
        switch self {
        case .updated:
            lhs.updatedAt > rhs.updatedAt
        case .title:
            lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        case .status:
            lhs.status.localizedCaseInsensitiveCompare(rhs.status) == .orderedAscending
        }
    }
}

struct HomeScreen: View {
    @StateObject private var model: HomeViewModel
    let onOpenWorkspace: (String) -> Void
    let onOpenThread: (String) -> Void
    let onChangeConnection: () -> Void
    let onThemeModeSelected: (ThemeMode) -> Void
    @State private var showingCreateWorkspace = false
    @State private var showingNewThread = false
    @State private var showingSettings = false
    @State private var renameTarget: SupervisorWorkspaceSummary?
    @State private var renameDraft = ""

    init(
        environment: AppEnvironment,
        connection: SupervisorConnectionConfig,
        onOpenWorkspace: @escaping (String) -> Void,
        onOpenThread: @escaping (String) -> Void,
        onChangeConnection: @escaping () -> Void,
        onThemeModeSelected: @escaping (ThemeMode) -> Void
    ) {
        _model = StateObject(wrappedValue: HomeViewModel(environment: environment, connection: connection))
        self.onOpenWorkspace = onOpenWorkspace
        self.onOpenThread = onOpenThread
        self.onChangeConnection = onChangeConnection
        self.onThemeModeSelected = onThemeModeSelected
    }

    var body: some View {
        List {
            statusSection
            workspaceSection
            threadSection
        }
        .navigationTitle("Remote Codex")
        .searchable(text: $model.searchText, prompt: "Search threads")
        .refreshable { await model.refresh() }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("Settings") {
                    showingSettings = true
                }
                Button("Refresh") {
                    Task { await model.refresh() }
                }
            }
        }
        .task { await model.refresh() }
        .sheet(isPresented: $showingCreateWorkspace) {
            createWorkspaceSheet
        }
        .sheet(isPresented: $showingNewThread) {
            newThreadSheet
        }
        .sheet(isPresented: $showingSettings) {
            HomeSettingsView(model: model, onThemeModeSelected: onThemeModeSelected)
        }
        .sheet(item: $renameTarget) { workspace in
            renameWorkspaceSheet(workspace)
        }
    }

    private var statusSection: some View {
        Section("Supervisor") {
            LabeledContent("Mode", value: model.connection.mode.label)
            LabeledContent("URL", value: model.connection.normalizedBaseURL)
            LabeledContent("Workspaces", value: "\(model.snapshot?.workspaces.count ?? 0)")
            LabeledContent("Threads", value: "\(model.snapshot?.threads.count ?? 0)")
            if model.loading {
                ProgressView("Loading...")
            }
            if let error = model.errorMessage {
                Text(error).foregroundStyle(.red)
            }
            Button("Change Connection", role: .destructive, action: onChangeConnection)
        }
    }

    private var workspaceSection: some View {
        Section {
            if model.snapshot?.workspaces.isEmpty == true {
                ContentUnavailableView("No Workspaces", systemImage: "folder.badge.plus")
            }
            ForEach(model.snapshot?.workspaces ?? []) { workspace in
                WorkspaceRow(
                    workspace: workspace,
                    onOpen: {
                        Task { await model.openWorkspace(workspace) }
                        onOpenWorkspace(workspace.id)
                    },
                    onFavorite: { Task { await model.toggleFavorite(workspace) } },
                    onRename: {
                        renameTarget = workspace
                        renameDraft = workspace.label
                    },
                    onDelete: { Task { await model.deleteWorkspace(workspace) } }
                )
            }
        } header: {
            HStack {
                Text("Workspaces")
                Spacer()
                Button("Add") {
                    showingCreateWorkspace = true
                }
            }
        }
    }

    private var threadSection: some View {
        Section {
            Picker("Filter", selection: $model.threadFilter) {
                ForEach(ThreadFilter.allCases) { filter in
                    Text(filter.rawValue).tag(filter)
                }
            }
            Picker("Sort", selection: $model.threadSort) {
                ForEach(ThreadSort.allCases) { sort in
                    Text(sort.rawValue).tag(sort)
                }
            }
            ForEach(model.groupedThreads, id: \.0) { title, threads in
                Section(title) {
                    ForEach(threads) { thread in
                        Button {
                            onOpenThread(thread.id)
                        } label: {
                            ThreadRow(thread: thread)
                        }
                        .accessibilityIdentifier("thread-open-\(thread.id)")
                    }
                }
            }
        } header: {
            HStack {
                Text("Threads")
                Spacer()
                Button("New") {
                    model.newThreadWorkspaceId = model.snapshot?.workspaces.first?.id ?? ""
                    showingNewThread = true
                }
                .disabled(model.snapshot?.workspaces.isEmpty != false)
            }
        }
    }

    private var createWorkspaceSheet: some View {
        NavigationStack {
            Form {
                TextField("Absolute path", text: $model.workspaceDraftPath)
                    .textInputAutocapitalization(.never)
                TextField("Label", text: $model.workspaceDraftLabel)
            }
            .navigationTitle("New Workspace")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showingCreateWorkspace = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            await model.createWorkspace()
                            showingCreateWorkspace = false
                        }
                    }
                    .disabled(model.workspaceDraftPath.isEmpty)
                }
            }
        }
    }

    private var newThreadSheet: some View {
        NavigationStack {
            Form {
                Picker("Workspace", selection: $model.newThreadWorkspaceId) {
                    ForEach(model.snapshot?.workspaces ?? []) { workspace in
                        Text(workspace.label).tag(workspace.id)
                    }
                }
                TextField("Title", text: $model.newThreadTitle)
                TextField("Model", text: $model.newThreadModel)
                    .textInputAutocapitalization(.never)
            }
            .navigationTitle("New Thread")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showingNewThread = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Start") {
                        Task {
                            if let threadId = await model.startThread() {
                                showingNewThread = false
                                onOpenThread(threadId)
                            }
                        }
                    }
                    .disabled(model.newThreadWorkspaceId.isEmpty || model.newThreadModel.isEmpty)
                }
            }
        }
    }

    private func renameWorkspaceSheet(_ workspace: SupervisorWorkspaceSummary) -> some View {
        NavigationStack {
            Form {
                TextField("Label", text: $renameDraft)
            }
            .navigationTitle("Rename Workspace")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { renameTarget = nil }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            await model.renameWorkspace(workspace, label: renameDraft)
                            renameTarget = nil
                        }
                    }
                    .disabled(renameDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

private struct WorkspaceRow: View {
    let workspace: SupervisorWorkspaceSummary
    let onOpen: () -> Void
    let onFavorite: () -> Void
    let onRename: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Button(workspace.label, action: onOpen)
                    .font(.headline)
                    .accessibilityIdentifier("workspace-open-\(workspace.id)")
                Spacer()
                Button(workspace.isFavorite ? "Starred" : "Star", action: onFavorite)
            }
            Text(workspace.absPath)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            HStack {
                Button("Rename", action: onRename)
                Button("Delete", role: .destructive, action: onDelete)
            }
            .font(.caption)
        }
    }
}

private struct ThreadRow: View {
    let thread: SupervisorThreadSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(thread.title).font(.headline)
                Spacer()
                GraphBadge(text: thread.status, tone: thread.status == "failed" ? .destructive : .neutral)
            }
            Text(thread.summaryText ?? thread.id)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            HStack {
                Text(thread.provider)
                if let model = thread.model {
                    Text(model)
                }
                Text(thread.updatedAt)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
    }
}

private struct HomeSettingsView: View {
    @ObservedObject var model: HomeViewModel
    let onThemeModeSelected: (ThemeMode) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if model.settings.loading {
                    ProgressView("Loading settings...")
                }
                if let error = model.settings.errorMessage {
                    Text(error).foregroundStyle(.red)
                }
                Section("Appearance") {
                    Picker("Theme", selection: $model.themeMode) {
                        ForEach(ThemeMode.allCases, id: \.self) { mode in
                            Text(mode.rawValue.capitalized).tag(mode)
                        }
                    }
                    .onChange(of: model.themeMode) { _, mode in
                        model.setTheme(mode)
                        onThemeModeSelected(mode)
                    }
                }
                if let runtime = model.settings.runtimeConfig {
                    Section("Runtime") {
                        LabeledContent("App", value: runtime.appName)
                        LabeledContent("Version", value: runtime.appVersion)
                        LabeledContent("Mode", value: runtime.mode)
                        LabeledContent("Workspace root", value: runtime.workspaceRoot)
                    }
                }
                if let workspace = model.settings.workspaceSettings {
                    Section("Workspace Defaults") {
                        TextField("Dev home", text: $model.settings.devHomeDraft)
                            .textInputAutocapitalization(.never)
                        TextField("Default backend", text: $model.settings.defaultBackendDraft)
                            .textInputAutocapitalization(.never)
                        Button(model.settings.savingWorkspaceSettings ? "Saving..." : "Save workspace defaults") {
                            Task { await model.saveWorkspaceSettings() }
                        }
                        .disabled(model.settings.savingWorkspaceSettings || model.settings.devHomeDraft.isEmpty)
                        LabeledContent("Current root", value: workspace.workspaceRoot)
                    }
                }
                Section("Agent Runtimes") {
                    ForEach(model.settings.agentBackends) { backend in
                        LabeledContent(backend.displayName, value: backend.statusState)
                    }
                }
                Section("Plugins") {
                    TextEditor(text: $model.settings.pluginManifestDraft)
                        .frame(minHeight: 120)
                        .font(.footnote.monospaced())
                        .textInputAutocapitalization(.never)
                    Toggle("Enable on import", isOn: $model.settings.pluginImportEnabled)
                    Button(model.settings.importingPlugin ? "Importing..." : "Import plugin manifest") {
                        Task { await model.importPluginManifest() }
                    }
                    .disabled(
                        model.settings.importingPlugin ||
                            model.settings.pluginManifestDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    )
                    ForEach(model.settings.plugins) { plugin in
                        Toggle(plugin.name, isOn: Binding(
                            get: { plugin.enabled },
                            set: { enabled in
                                Task { await model.setPlugin(plugin, enabled: enabled) }
                            }
                        ))
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await model.loadSettings() }
        }
    }
}
