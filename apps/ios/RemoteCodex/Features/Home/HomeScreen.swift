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
    @Published var newThreadProvider = ""
    @Published var newThreadModel = ""
    @Published var newThreadBackends: [SupervisorAgentBackend] = []
    @Published var newThreadModels: [SupervisorModelOption] = []
    @Published var newThreadOptionsLoading = false
    @Published var newThreadRuntimeBusyProvider: String?
    @Published var newThreadOptionsError: String?
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

    var visibleWorkspaces: [SupervisorWorkspaceSummary] {
        (snapshot?.workspaces ?? [])
            .sorted {
                if $0.isFavorite != $1.isFavorite {
                    return $0.isFavorite && !$1.isFavorite
                }
                let lhs = $0.label.isEmpty ? $0.absPath : $0.label
                let rhs = $1.label.isEmpty ? $1.absPath : $1.label
                return lhs.localizedCaseInsensitiveCompare(rhs) == .orderedAscending
            }
    }

    var visibleNewThreadModels: [SupervisorModelOption] {
        let visible = newThreadModels.filter { !$0.hidden }
        return visible.isEmpty ? newThreadModels : visible
    }

    var canStartNewThread: Bool {
        !newThreadWorkspaceId.isEmpty &&
            !newThreadProvider.isEmpty &&
            !newThreadModel.isEmpty &&
            !loading &&
            !newThreadOptionsLoading &&
            newThreadBackends.first(where: { $0.provider == newThreadProvider })?.canStartSession == true
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
            _ = try await client.deleteWorkspace(workspace: workspace)
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
        guard canStartNewThread else {
            newThreadOptionsError = "Install this runtime before creating a thread."
            return nil
        }
        var createdThreadId: String?
        await runBusy {
            let thread = try await client.startThread(
                StartSupervisorThreadRequest(
                    workspaceId: newThreadWorkspaceId,
                    title: newThreadTitle.trimmedNonEmpty,
                    provider: newThreadProvider.trimmedNonEmpty,
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

    func loadNewThreadOptionsIfNeeded() async {
        guard newThreadBackends.isEmpty || visibleNewThreadModels.isEmpty else { return }
        await loadNewThreadOptions()
    }

    func loadNewThreadOptions() async {
        newThreadOptionsLoading = true
        newThreadOptionsError = nil
        defer { newThreadOptionsLoading = false }
        do {
            let backends = try await client.listAgentBackends()
            newThreadBackends = backends
            guard !backends.isEmpty else {
                newThreadProvider = ""
                newThreadModels = []
                newThreadModel = ""
                newThreadOptionsError = "No agent providers are configured."
                return
            }
            let selectable = selectableBackends(from: backends)
            let provider = selectable.first { $0.provider == newThreadProvider }?.provider
                ?? selectable.first { $0.isDefault }?.provider
                ?? selectable.first?.provider
                ?? backends[0].provider
            newThreadProvider = provider
            if selectable.contains(where: { $0.provider == provider }) {
                try await loadNewThreadModels(provider: provider)
            } else {
                newThreadModels = []
                newThreadModel = ""
                newThreadOptionsError = "Install this runtime before creating a thread."
            }
        } catch {
            newThreadOptionsError = error.localizedDescription
        }
    }

    func selectNewThreadProvider(_ provider: String) async {
        guard provider != newThreadProvider else { return }
        guard newThreadBackends.first(where: { $0.provider == provider })?.canStartSession == true else {
            newThreadProvider = provider
            newThreadModels = []
            newThreadModel = ""
            newThreadOptionsError = "Install this runtime before creating a thread."
            return
        }
        newThreadProvider = provider
        newThreadModels = []
        newThreadModel = ""
        newThreadOptionsError = nil
        newThreadOptionsLoading = true
        defer { newThreadOptionsLoading = false }
        do {
            try await loadNewThreadModels(provider: provider)
        } catch {
            newThreadOptionsError = error.localizedDescription
        }
    }

    func installOrUpdateNewThreadBackend(_ backend: SupervisorAgentBackend) async {
        let action = backend.installed ? "update" : "install"
        newThreadRuntimeBusyProvider = backend.provider
        newThreadOptionsError = nil
        defer { newThreadRuntimeBusyProvider = nil }
        do {
            _ = try await client.installOrUpdateAgentBackend(provider: backend.provider, action: action)
            newThreadProvider = backend.provider
            await loadNewThreadOptions()
        } catch {
            newThreadOptionsError = error.localizedDescription
            do {
                newThreadBackends = try await client.listAgentBackends()
            } catch {
                // Keep the install/update error visible.
            }
        }
    }

    private func selectableBackends(from backends: [SupervisorAgentBackend]) -> [SupervisorAgentBackend] {
        let selectable = backends.filter(\.canStartSession)
        return selectable.isEmpty ? [] : selectable
    }

    private func loadNewThreadModels(provider: String) async throws {
        let models = try await client.listAgentModels(provider: provider)
        newThreadModels = models
        let selectableModels = models.filter { !$0.hidden }
        let candidates = selectableModels.isEmpty ? models : selectableModels
        guard !candidates.isEmpty else {
            newThreadModel = ""
            newThreadOptionsError = "No models are available for this provider."
            return
        }
        newThreadModel = candidates.first { $0.model == newThreadModel }?.model
            ?? candidates.first { $0.isDefault }?.model
            ?? candidates[0].model
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
    let onBack: () -> Void
    let onThemeModeSelected: (ThemeMode) -> Void
    @State private var showingCreateWorkspace = false
    @State private var showingNewThread = false
    @State private var showingSettings = false
    @State private var renameTarget: SupervisorWorkspaceSummary?
    @State private var renameDraft = ""
    @State private var deleteTarget: SupervisorWorkspaceSummary?

    init(
        environment: AppEnvironment,
        connection: SupervisorConnectionConfig,
        onOpenWorkspace: @escaping (String) -> Void,
        onOpenThread: @escaping (String) -> Void,
        onChangeConnection: @escaping () -> Void,
        onBack: @escaping () -> Void,
        onThemeModeSelected: @escaping (ThemeMode) -> Void
    ) {
        _model = StateObject(wrappedValue: HomeViewModel(environment: environment, connection: connection))
        self.onOpenWorkspace = onOpenWorkspace
        self.onOpenThread = onOpenThread
        self.onChangeConnection = onChangeConnection
        self.onBack = onBack
        self.onThemeModeSelected = onThemeModeSelected
    }

    var body: some View {
        List {
            workspaceSection
        }
        .navigationTitle("Remote Codex")
        .remoteCodexScreenSurface()
        .refreshable { await model.refresh() }
        .edgeSwipeBack(action: onBack)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                homeMenu
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
        .alert("Delete Workspace?", isPresented: deleteConfirmationPresented) {
            Button("Cancel", role: .cancel) {
                deleteTarget = nil
            }
            Button("Delete", role: .destructive) {
                guard let workspace = deleteTarget else { return }
                Task {
                    await model.deleteWorkspace(workspace)
                    deleteTarget = nil
                }
            }
        } message: {
            Text(deleteTarget?.label ?? "This workspace")
        }
    }

    private var homeMenu: some View {
        FloatingActionMenu(
            accessibilityIdentifier: "home-action-menu",
            appliesFloatingPadding: false
        ) {
            Button {
                showingSettings = true
            } label: {
                Label("Settings", systemImage: "gearshape")
            }
            Button {
                Task { await model.refresh() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            Divider()
            Button(action: onChangeConnection) {
                Label("Devices", systemImage: "iphone")
                    .foregroundStyle(RemoteCodexTheme.foreground)
            }
            .tint(RemoteCodexTheme.foreground)
        }
    }

    private var deleteConfirmationPresented: Binding<Bool> {
        Binding(
            get: { deleteTarget != nil },
            set: { isPresented in
                if !isPresented {
                    deleteTarget = nil
                }
            }
        )
    }

    private var workspaceSection: some View {
        Section {
            if model.loading {
                ProgressView("Loading...")
            }
            if let error = model.errorMessage {
                Text(error).remoteCodexErrorText()
            }
            if model.snapshot?.workspaces.isEmpty == true {
                ContentUnavailableView("No Workspaces", systemImage: "folder.badge.plus")
            }
            ForEach(model.visibleWorkspaces) { workspace in
                WorkspaceRow(
                    workspace: workspace,
                    onOpen: {
                        Task { await model.openWorkspace(workspace) }
                        onOpenWorkspace(workspace.id)
                    },
                    onPin: { Task { await model.toggleFavorite(workspace) } },
                    onRename: {
                        renameTarget = workspace
                        renameDraft = workspace.label
                    },
                    onDelete: { deleteTarget = workspace }
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
        .remoteCodexListRow()
    }

    private var createWorkspaceSheet: some View {
        NavigationStack {
            Form {
                TextField("Absolute path", text: $model.workspaceDraftPath)
                    .textInputAutocapitalization(.never)
                TextField("Label", text: $model.workspaceDraftLabel)
            }
            .navigationTitle("New Workspace")
            .remoteCodexScreenSurface()
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
                Section("Provider") {
                    if model.newThreadBackends.isEmpty, model.newThreadOptionsLoading {
                        ProgressView()
                    } else {
                        ForEach(model.newThreadBackends) { backend in
                            HStack {
                                Button {
                                    Task {
                                        await model.selectNewThreadProvider(backend.provider)
                                    }
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(backend.displayName)
                                            .foregroundStyle(backend.canStartSession ? RemoteCodexTheme.foreground : RemoteCodexTheme.foregroundMuted)
                                        Text(backend.provider)
                                            .font(.caption)
                                            .remoteCodexStatusText()
                                        if !backend.canStartSession {
                                            Text(backend.lastError ?? "Runtime is not available.")
                                                .font(.caption2)
                                                .remoteCodexErrorText()
                                        } else if let version = backend.installedVersion {
                                            Text(version)
                                                .font(.caption2)
                                                .remoteCodexStatusText()
                                        }
                                    }
                                }
                                .disabled(!backend.canStartSession || model.newThreadRuntimeBusyProvider != nil)
                                Spacer()
                                if let action = backend.runtimeActionLabel {
                                    Button {
                                        Task {
                                            await model.installOrUpdateNewThreadBackend(backend)
                                        }
                                    } label: {
                                        if model.newThreadRuntimeBusyProvider == backend.provider || backend.busy {
                                            ProgressView()
                                        } else {
                                            Label(action, systemImage: backend.installed ? "arrow.clockwise" : "arrow.down.circle")
                                        }
                                    }
                                    .disabled(model.newThreadRuntimeBusyProvider != nil || backend.busy)
                                    .buttonStyle(RemoteCodexSecondaryButtonStyle())
                                }
                                if backend.provider == model.newThreadProvider {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                }
                Section("Model") {
                    if model.newThreadOptionsLoading, model.visibleNewThreadModels.isEmpty {
                        ProgressView()
                    } else {
                        ForEach(model.visibleNewThreadModels) { option in
                            Button {
                                model.newThreadModel = option.model
                            } label: {
                                HStack(alignment: .top) {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(option.displayName)
                                            .foregroundStyle(RemoteCodexTheme.foreground)
                                        Text(option.model)
                                            .font(.caption)
                                            .remoteCodexStatusText()
                                    }
                                    Spacer()
                                    if option.model == model.newThreadModel {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    }
                }
                if let error = model.newThreadOptionsError {
                    Section {
                        Text(error)
                            .remoteCodexErrorText()
                    }
                    .remoteCodexListRow()
                }
            }
            .navigationTitle("New Thread")
            .remoteCodexScreenSurface()
            .task {
                await model.loadNewThreadOptionsIfNeeded()
            }
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
                    .disabled(!model.canStartNewThread)
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
            .remoteCodexScreenSurface()
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
    let onPin: () -> Void
    let onRename: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Button(workspace.label, action: onOpen)
                    .font(.headline)
                    .accessibilityIdentifier("workspace-open-\(workspace.id)")
                Spacer()
                if workspace.isFavorite {
                    Image(systemName: "pin.fill")
                        .foregroundStyle(RemoteCodexTheme.foregroundMuted)
                        .accessibilityLabel("Pinned")
                }
            }
            .buttonStyle(.borderless)
            Text(workspace.absPath)
                .font(.caption.monospaced())
                .remoteCodexStatusText()
            HStack {
                Button(workspace.isFavorite ? "Unpin" : "Pin", action: onPin)
                Button("Rename", action: onRename)
                Button("Delete", role: .destructive, action: onDelete)
            }
            .font(.caption)
            .buttonStyle(.borderless)
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
                .remoteCodexStatusText()
                .lineLimit(2)
            HStack {
                Text(thread.provider)
                if let model = thread.model {
                    Text(model)
                }
                Text(thread.updatedAt)
            }
            .font(.caption2)
            .remoteCodexStatusText()
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
                    Text(error).remoteCodexErrorText()
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
            .remoteCodexScreenSurface()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await model.loadSettings() }
        }
    }
}
