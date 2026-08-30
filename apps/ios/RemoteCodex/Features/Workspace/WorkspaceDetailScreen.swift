import QuickLook
import SwiftUI
import UIKit
import UniformTypeIdentifiers

@MainActor
final class WorkspaceDetailViewModel: ObservableObject {
    @Published var workspace: SupervisorWorkspaceSummary?
    @Published var threads: [SupervisorThreadSummary] = []
    @Published var tree: SupervisorWorkspaceTreeNode?
    @Published var selectedPath: String?
    @Published var expandedDirectoryPaths = Set<String>()
    @Published var preview: SupervisorWorkspaceFilePreview?
    @Published var editableContent = ""
    @Published var loading = false
    @Published var fileLoading = false
    @Published var message: String?
    @Published var errorMessage: String?
    @Published var downloadedFile: WorkspaceLocalFile?
    @Published var previewFile: WorkspaceLocalFile?
    @Published var newThreadTitle = ""
    @Published var newThreadProvider = ""
    @Published var newThreadAgentId = ""
    @Published var newThreadModel = ""
    @Published var newThreadReasoningEffort: String?
    @Published var newThreadBackends: [SupervisorAgentBackend] = []
    @Published var newThreadAgents: [SupervisorModelOption] = []
    @Published var newThreadModels: [SupervisorModelOption] = []
    @Published var newThreadOptionsLoading = false
    @Published var newThreadRuntimeBusyProvider: String?
    @Published var newThreadBusyAgentId: String?
    @Published var newThreadOptionsError: String?
    @Published var relayAccess: RelayEffectiveAccessSummary?
    @Published var relayAccessLoading = false
    @Published var relayAccessError: String?

    let workspaceId: String
    let environment: AppEnvironment
    let connection: SupervisorConnectionConfig

    init(environment: AppEnvironment, connection: SupervisorConnectionConfig, workspaceId: String) {
        self.environment = environment
        self.connection = connection
        self.workspaceId = workspaceId
    }

    private var client: SupervisorAPIClient {
        environment.apiClientFactory(connection)
    }

    var flatNodes: [WorkspaceFlatNode] {
        tree?.flattened() ?? []
    }

    var visibleNewThreadModels: [SupervisorModelOption] {
        let visible = newThreadModels.filter { !$0.hidden }
        return visible.isEmpty ? newThreadModels : visible
    }

    var visibleNewThreadAgents: [SupervisorModelOption] {
        let visible = newThreadAgents.filter { !$0.hidden }
        return visible.isEmpty ? newThreadAgents : visible
    }

    var selectedNewThreadModel: SupervisorModelOption? {
        visibleNewThreadModels.first { $0.model == newThreadModel }
    }

    var canStartNewThread: Bool {
        canCreateThreadForRelay &&
            !newThreadProvider.isEmpty &&
            !newThreadModel.isEmpty &&
            !loading &&
            !newThreadOptionsLoading &&
            newThreadBackends.first(where: { $0.provider == newThreadProvider })?.canStartSession == true &&
            (newThreadProvider != "acp" || visibleNewThreadAgents.first {
                $0.model == newThreadAgentId
            }?.acpAgent?.availability == "ready")
    }

    var canCreateThreadForRelay: Bool {
        guard connection.mode == .relay else { return true }
        guard !relayAccessLoading, relayAccessError == nil else { return false }
        guard let relayAccess else { return false }
        guard relayAccess.kind == "shared" else { return true }
        return relayAccess.canCreateThreads && relayAccess.threadAccess == "control"
    }

    var relayCreateThreadBlockedMessage: String? {
        guard connection.mode == .relay else { return nil }
        if relayAccessLoading {
            return "Checking relay permission for new threads..."
        }
        if let relayAccessError {
            return relayAccessError
        }
        guard let relayAccess else {
            return "Checking relay permission for new threads..."
        }
        guard relayAccess.kind == "shared" else { return nil }
        return relayAccess.canCreateThreads && relayAccess.threadAccess == "control"
            ? nil
            : "This shared device does not allow creating new threads."
    }

    func refresh() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            let snapshot = try await client.fetchHomeSnapshot()
            guard let workspace = snapshot.workspaces.first(where: { $0.id == workspaceId }) else {
                self.workspace = nil
                threads = []
                tree = nil
                selectedPath = nil
                preview = nil
                editableContent = ""
                errorMessage = "Workspace is no longer available. Return to Workspaces and refresh."
                return
            }
            self.workspace = workspace
            threads = snapshot.threads
                .filter { $0.workspaceId == workspaceId }
                .sorted { $0.updatedAt > $1.updatedAt }
            tree = try await client.fetchWorkspaceTree(workspaceId: workspaceId)
            if selectedPath == nil {
                selectedPath = flatNodes.first { $0.kind == "file" }?.path
            }
            if let selectedPath {
                try await loadPreview(path: selectedPath)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggleFavorite() async {
        guard let workspace else { return }
        await runAction {
            self.workspace = try await client.setWorkspaceFavorite(
                workspaceId: workspace.id,
                isFavorite: !workspace.isFavorite
            )
        }
    }

    func openWorkspace() async {
        await runAction {
            workspace = try await client.openWorkspace(workspaceId: workspaceId)
        }
    }

    func startThread() async -> String? {
        await loadRelayAccessIfNeeded()
        guard canCreateThreadForRelay else {
            newThreadOptionsError = relayCreateThreadBlockedMessage ?? "Shared device does not allow new threads."
            return nil
        }
        guard canStartNewThread else {
            newThreadOptionsError = "Install this runtime before creating a thread."
            return nil
        }
        var threadId: String?
        await runAction {
            let thread = try await client.startThread(
                StartSupervisorThreadRequest(
                    workspaceId: workspaceId,
                    title: newThreadTitle.trimmedNonEmpty,
                    provider: newThreadProvider.trimmedNonEmpty,
                    agentId: newThreadProvider == "acp" ? newThreadAgentId.trimmedNonEmpty : nil,
                    model: newThreadModel,
                    reasoningEffort: newThreadReasoningEffort,
                    approvalMode: "yolo"
                )
            )
            threadId = thread.id
        }
        return threadId
    }

    func loadNewThreadOptionsIfNeeded() async {
        await loadRelayAccessIfNeeded()
        guard canCreateThreadForRelay else {
            newThreadOptionsError = relayCreateThreadBlockedMessage
            return
        }
        guard newThreadBackends.isEmpty || visibleNewThreadModels.isEmpty else { return }
        await loadNewThreadOptions()
    }

    func loadRelayAccessIfNeeded(force: Bool = false) async {
        guard connection.mode == .relay, let deviceId = connection.relayDeviceId?.trimmedNonEmpty else {
            relayAccess = nil
            relayAccessError = nil
            relayAccessLoading = false
            return
        }
        if !force, relayAccess != nil || relayAccessLoading {
            return
        }
        relayAccessLoading = true
        relayAccessError = nil
        defer { relayAccessLoading = false }
        do {
            relayAccess = try await client.fetchRelayAccess(
                deviceId: deviceId,
                workspaceId: workspaceId
            )
        } catch {
            relayAccess = nil
            relayAccessError = error.localizedDescription
        }
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
                try await loadNewThreadProvider(provider)
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
            newThreadAgents = []
            newThreadAgentId = ""
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
            try await loadNewThreadProvider(provider)
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

    func selectNewThreadAgent(_ agentId: String) async {
        guard newThreadProvider == "acp" else { return }
        guard visibleNewThreadAgents.first(where: { $0.model == agentId })?.acpAgent?.availability == "ready" else {
            return
        }
        newThreadAgentId = agentId
        newThreadOptionsLoading = true
        newThreadOptionsError = nil
        defer { newThreadOptionsLoading = false }
        do {
            try await loadNewThreadModels(provider: "acp", agentId: agentId)
        } catch {
            newThreadOptionsError = error.localizedDescription
        }
    }

    func installNewThreadAgentAdapter(_ agent: SupervisorModelOption) async {
        newThreadBusyAgentId = agent.id
        newThreadOptionsError = nil
        defer { newThreadBusyAgentId = nil }
        do {
            _ = try await client.installOrUpdateAgentBackend(
                provider: "acp",
                action: "install",
                modelId: agent.id
            )
            try await loadNewThreadProvider("acp")
        } catch {
            newThreadOptionsError = error.localizedDescription
        }
    }

    func selectNewThreadModel(_ model: String) {
        newThreadModel = model
        let option = visibleNewThreadModels.first { $0.model == model }
        let efforts = option?.supportedReasoningEfforts.map(\.reasoningEffort) ?? []
        if let current = newThreadReasoningEffort, efforts.contains(current) {
            return
        }
        newThreadReasoningEffort = option?.defaultReasoningEffort ?? efforts.first
    }

    private func selectableBackends(from backends: [SupervisorAgentBackend]) -> [SupervisorAgentBackend] {
        let selectable = backends.filter(\.canStartSession)
        return selectable.isEmpty ? [] : selectable
    }

    private func loadNewThreadProvider(_ provider: String) async throws {
        if provider == "acp" {
            newThreadAgents = try await client.listAgentAgents(provider: provider)
            let candidates = visibleNewThreadAgents.filter { $0.acpAgent?.availability == "ready" }
            newThreadAgentId = candidates.first { $0.model == newThreadAgentId }?.model
                ?? candidates.first { $0.isDefault }?.model
                ?? candidates.first?.model
                ?? ""
            guard !newThreadAgentId.isEmpty else {
                newThreadModels = []
                newThreadModel = ""
                newThreadReasoningEffort = nil
                newThreadOptionsError = "No ready ACP agents are available."
                return
            }
        } else {
            newThreadAgents = []
            newThreadAgentId = ""
        }
        try await loadNewThreadModels(
            provider: provider,
            agentId: provider == "acp" ? newThreadAgentId : nil
        )
    }

    private func loadNewThreadModels(provider: String, agentId: String? = nil) async throws {
        let models = try await client.listAgentModels(
            provider: provider,
            agentId: agentId,
            cwd: workspace?.absPath
        )
        newThreadModels = models
        let selectableModels = models.filter { !$0.hidden }
        let candidates = selectableModels.isEmpty ? models : selectableModels
        guard !candidates.isEmpty else {
            newThreadModel = ""
            newThreadOptionsError = "No models are available for this provider."
            newThreadReasoningEffort = nil
            return
        }
        let nextModel = candidates.first { $0.model == newThreadModel }
            ?? candidates.first { $0.isDefault }
            ?? candidates[0]
        selectNewThreadModel(nextModel.model)
    }

    func selectFile(_ path: String) async {
        do {
            try await loadPreview(path: path)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func selectNode(_ node: WorkspaceFlatNode) async {
        if node.kind == "directory" {
            await toggleDirectory(node.path)
        } else {
            await selectFile(node.path)
        }
    }

    func toggleDirectory(_ path: String) async {
        if expandedDirectoryPaths.contains(path) {
            expandedDirectoryPaths.remove(path)
            return
        }
        do {
            let subtree = try await client.fetchWorkspaceTree(workspaceId: workspaceId, path: path)
            if let tree {
                self.tree = replacingSubtree(in: tree, path: path, replacement: subtree)
            }
            expandedDirectoryPaths.insert(path)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func loadMorePreview() async {
        guard let preview, preview.truncated else { return }
        fileLoading = true
        defer { fileLoading = false }
        do {
            let next = try await client.fetchWorkspaceFilePreview(
                workspaceId: workspaceId,
                path: preview.path,
                offset: preview.nextOffset,
                limit: 50000
            )
            let merged = SupervisorWorkspaceFilePreview(
                path: preview.path,
                name: preview.name,
                content: preview.content + next.content,
                language: preview.language,
                size: next.size,
                truncated: next.truncated,
                nextOffset: next.nextOffset
            )
            self.preview = merged
            editableContent = merged.content
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func saveCurrentFile() async {
        guard let preview else { return }
        await runAction {
            _ = try await client.writeWorkspaceFile(
                workspaceId: workspaceId,
                path: preview.path,
                content: editableContent
            )
            message = "Saved \(preview.name)"
            try await loadPreview(path: preview.path)
        }
    }

    func copyRawFile() async {
        guard let selectedPath else { return }
        await runAction {
            let raw = try await client.fetchWorkspaceRawFile(workspaceId: workspaceId, path: selectedPath)
            guard let text = raw.text else {
                throw WorkspaceDetailError.nonTextFile
            }
            UIPasteboard.general.string = text
            message = "Copied \(raw.path) raw text"
        }
    }

    func openRawFile() async {
        guard let selectedPath else { return }
        await runAction {
            let raw = try await client.fetchWorkspaceRawFile(workspaceId: workspaceId, path: selectedPath)
            previewFile = try writeTemporaryFile(
                filename: raw.path.components(separatedBy: "/").last ?? "workspace-file",
                bytes: raw.bytes
            )
            message = "Opened \(raw.path)"
        }
    }

    func downloadCurrentFile() async {
        guard let selectedPath else { return }
        await runAction {
            let download = try await client.downloadWorkspaceFile(workspaceId: workspaceId, path: selectedPath)
            downloadedFile = try writeTemporaryFile(filename: download.filename, bytes: download.bytes)
            message = "Downloaded \(downloadedFile?.filename ?? download.filename)"
        }
    }

    func uploadFile(from url: URL) async {
        let securityScoped = url.startAccessingSecurityScopedResource()
        defer {
            if securityScoped {
                url.stopAccessingSecurityScopedResource()
            }
        }
        do {
            let bytes = try Data(contentsOf: url)
            let contentType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                ?? "application/octet-stream"
            await uploadFile(
                filename: url.lastPathComponent,
                bytes: bytes,
                contentType: contentType
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func uploadFile(filename: String, bytes: Data, contentType: String) async {
        await runAction {
            let result = try await client.uploadWorkspaceFile(
                workspaceId: workspaceId,
                request: UploadWorkspaceFileRequest(
                    filename: filename,
                    contentType: contentType,
                    bytes: bytes,
                    path: nil
                )
            )
            message = "Uploaded \(result.file?.path ?? result.path ?? result.name ?? filename)"
            tree = try await client.fetchWorkspaceTree(workspaceId: workspaceId)
            if let uploadedPath = result.file?.path ?? result.path {
                try await loadPreview(path: uploadedPath)
            }
        }
    }

    private func loadPreview(path: String) async throws {
        fileLoading = true
        defer { fileLoading = false }
        selectedPath = path
        let loaded = try await client.fetchWorkspaceFilePreview(workspaceId: workspaceId, path: path, limit: 50000)
        preview = loaded
        editableContent = loaded.content
    }

    private func replacingSubtree(
        in node: SupervisorWorkspaceTreeNode,
        path: String,
        replacement: SupervisorWorkspaceTreeNode
    ) -> SupervisorWorkspaceTreeNode {
        if node.path == path {
            return replacement
        }
        var updated = node
        updated.children = node.children?.map {
            replacingSubtree(in: $0, path: path, replacement: replacement)
        }
        return updated
    }

    private func runAction(_ operation: () async throws -> Void) async {
        loading = true
        errorMessage = nil
        message = nil
        defer { loading = false }
        do {
            try await operation()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func writeTemporaryFile(filename: String, bytes: Data) throws -> WorkspaceLocalFile {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("RemoteCodexWorkspaceFiles", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let safeName = sanitizeWorkspaceFilename(filename)
        let url = directory.appendingPathComponent("\(UUID().uuidString)-\(safeName)")
        try bytes.write(to: url, options: [.atomic])
        return WorkspaceLocalFile(url: url, filename: safeName)
    }
}

struct WorkspaceLocalFile: Identifiable, Equatable {
    var id: String {
        url.absoluteString
    }

    var url: URL
    var filename: String
}

enum WorkspaceDetailError: LocalizedError {
    case nonTextFile

    var errorDescription: String? {
        switch self {
        case .nonTextFile:
            "Raw copy only supports UTF-8 text files."
        }
    }
}

struct WorkspaceFlatNode: Identifiable, Equatable {
    var id: String {
        path.isEmpty ? name : path
    }

    var name: String
    var path: String
    var kind: String
    var depth: Int
}

private extension SupervisorWorkspaceTreeNode {
    func flattened(depth: Int = 0) -> [WorkspaceFlatNode] {
        let current = WorkspaceFlatNode(name: name, path: path, kind: kind, depth: depth)
        let children = (children ?? []).flatMap { $0.flattened(depth: depth + 1) }
        return [current] + children
    }
}

struct WorkspaceDetailScreen: View {
    @StateObject private var model: WorkspaceDetailViewModel
    let environment: AppEnvironment
    let connection: SupervisorConnectionConfig
    let onOpenThread: (String) -> Void
    let onChangeConnection: () -> Void
    let onBack: () -> Void
    let onThemeModeSelected: (ThemeMode) -> Void
    @State private var showingNewThread = false
    @State private var showingSettings = false
    @State private var showingAccounts = false
    @State private var showingFileImporter = false

    init(
        environment: AppEnvironment,
        connection: SupervisorConnectionConfig,
        workspaceId: String,
        onOpenThread: @escaping (String) -> Void,
        onChangeConnection: @escaping () -> Void,
        onBack: @escaping () -> Void,
        onThemeModeSelected: @escaping (ThemeMode) -> Void = { _ in }
    ) {
        self.environment = environment
        self.connection = connection
        _model = StateObject(
            wrappedValue: WorkspaceDetailViewModel(
                environment: environment,
                connection: connection,
                workspaceId: workspaceId
            )
        )
        self.onOpenThread = onOpenThread
        self.onChangeConnection = onChangeConnection
        self.onBack = onBack
        self.onThemeModeSelected = onThemeModeSelected
    }

    var body: some View {
        List {
            workspaceSection
            threadsSection
            filesSection
            previewSection
        }
        .navigationTitle(model.workspace?.label ?? "Workspace")
        .navigationBarTitleDisplayMode(.inline)
        .remoteCodexScreenSurface()
        .refreshable { await model.refresh() }
        .edgeSwipeBack(action: onBack)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                workspaceMenu
            }
        }
        .task { await model.refresh() }
        .sheet(isPresented: $showingNewThread) {
            newThreadSheet
        }
        .sheet(isPresented: $showingSettings) {
            AppSettingsSheet(
                environment: environment,
                connection: connection,
                onThemeModeSelected: onThemeModeSelected
            )
        }
        .sheet(isPresented: $showingAccounts) {
            RelayAccountSettingsSheet(
                environment: environment,
                connection: connection,
                onLogout: onChangeConnection
            )
        }
        .sheet(item: $model.previewFile) { file in
            QuickLookPreview(url: file.url)
        }
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: [.data],
            allowsMultipleSelection: false
        ) { result in
            guard case let .success(urls) = result, let url = urls.first else { return }
            Task { await model.uploadFile(from: url) }
        }
    }

    private var workspaceMenu: some View {
        FloatingActionMenu(
            accessibilityIdentifier: "workspace-action-menu",
            appliesFloatingPadding: false
        ) {
            Button {
                showingSettings = true
            } label: {
                Label("Settings", systemImage: "gearshape")
            }
            Button {
                showingAccounts = true
            } label: {
                Label("Accounts", systemImage: "person.crop.circle")
            }
        }
    }

    private var workspaceSection: some View {
        Section("Workspace") {
            if let workspace = model.workspace {
                LabeledContent("Path", value: workspace.absPath)
            }
            if model.loading {
                ProgressView("Loading...")
            }
            if let message = model.message {
                Text(message)
                    .remoteCodexStatusText()
                    .accessibilityIdentifier("workspace-file-message")
            }
            if let error = model.errorMessage {
                Text(error).remoteCodexErrorText()
            }
        }
        .remoteCodexListRow()
    }

    private var threadsSection: some View {
        Section {
            if model.threads.isEmpty {
                ContentUnavailableView("No Threads", systemImage: "text.bubble")
            }
            ForEach(model.threads) { thread in
                Button {
                    onOpenThread(thread.id)
                } label: {
                    VStack(alignment: .leading) {
                        Text(thread.title)
                        Text(thread.status).font(.caption).remoteCodexStatusText()
                    }
                }
                .accessibilityIdentifier("thread-open-\(thread.id)")
            }
        } header: {
            HStack {
                Text("Threads")
                Spacer()
                BareAddButton(accessibilityLabel: "New thread") {
                    showingNewThread = true
                }
            }
        }
        .remoteCodexListRow()
    }

    private var filesSection: some View {
        Section {
            if model.flatNodes.filter({ !$0.path.isEmpty }).isEmpty {
                ContentUnavailableView("No Files", systemImage: "folder")
            }
            ForEach(model.flatNodes.filter { !$0.path.isEmpty }) { node in
                Button {
                    Task { await model.selectNode(node) }
                } label: {
                    HStack(spacing: 8) {
                        Color.clear.frame(width: CGFloat(max(0, node.depth - 1)) * 14, height: 1)
                        Image(systemName: node.kind == "directory" ? "folder" : "doc.text")
                        Text(node.name)
                            .foregroundStyle(RemoteCodexTheme.foreground)
                        Spacer()
                        if node.kind == "directory" {
                            Image(
                                systemName: model.expandedDirectoryPaths.contains(node.path)
                                    ? "chevron.down"
                                    : "chevron.right"
                            )
                        }
                    }
                }
                .accessibilityIdentifier("workspace-file-row-\(workspaceFileIdentifierToken(node.path))")
            }
        } header: {
            HStack {
                Text("Files")
                Spacer()
                Button {
                    showingFileImporter = true
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Upload file")
                .accessibilityIdentifier("workspace-file-upload")
            }
        }
        .remoteCodexListRow()
    }

    @ViewBuilder
    private var previewSection: some View {
        if let preview = model.preview {
            Section("Preview") {
                Text(preview.path)
                    .font(.caption.monospaced())
                    .remoteCodexStatusText()
                    .accessibilityIdentifier("workspace-file-preview-path")
                if preview.truncated {
                    Button("Load more") {
                        Task { await model.loadMorePreview() }
                    }
                    .accessibilityIdentifier("workspace-file-load-more")
                }
                HStack {
                    Button("Copy raw") { Task { await model.copyRawFile() } }
                        .accessibilityIdentifier("workspace-file-copy-raw")
                    Button("Open") { Task { await model.openRawFile() } }
                        .accessibilityIdentifier("workspace-file-open")
                    Button("Download") { Task { await model.downloadCurrentFile() } }
                        .accessibilityIdentifier("workspace-file-download")
                }
                .buttonStyle(.borderless)
                if let message = model.message {
                    Text(message)
                        .remoteCodexStatusText()
                        .accessibilityIdentifier("workspace-file-preview-message")
                }
                TextEditor(text: $model.editableContent)
                    .frame(minHeight: 140)
                    .font(.caption.monospaced())
                Button("Save changes") { Task { await model.saveCurrentFile() } }
                    .accessibilityIdentifier("workspace-file-save")
            }
            .remoteCodexListRow()
        }
    }

    private var newThreadSheet: some View {
        NavigationStack {
            Form {
                TextField("Title", text: $model.newThreadTitle)
                    .accessibilityIdentifier("new-thread-title")
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
                                .accessibilityIdentifier("new-thread-provider-\(backend.provider)")
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
                                    .accessibilityIdentifier("new-thread-provider-action-\(backend.provider)")
                                }
                                if backend.provider == model.newThreadProvider {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    }
                }
                if model.newThreadProvider == "acp" {
                    Section("Agent") {
                        ForEach(model.visibleNewThreadAgents) { agent in
                            let ready = agent.acpAgent?.availability == "ready"
                            HStack {
                                Button {
                                    Task { await model.selectNewThreadAgent(agent.model) }
                                } label: {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(agent.displayName)
                                            .foregroundStyle(ready ? RemoteCodexTheme.foreground : RemoteCodexTheme.foregroundMuted)
                                        Text(agent.acpAgent?.statusMessage ?? "Agent is unavailable.")
                                            .font(.caption2)
                                            .remoteCodexStatusText()
                                    }
                                }
                                .disabled(!ready || model.newThreadBusyAgentId != nil)
                                Spacer()
                                if agent.acpAgent?.availability == "adapter_missing",
                                   agent.acpAgent?.installCommand != nil
                                {
                                    Button("Install") {
                                        Task { await model.installNewThreadAgentAdapter(agent) }
                                    }
                                    .disabled(model.newThreadBusyAgentId != nil || agent.acpAgent?.busy == true)
                                    .buttonStyle(RemoteCodexSecondaryButtonStyle())
                                }
                                if agent.model == model.newThreadAgentId {
                                    Image(systemName: "checkmark")
                                }
                            }
                            .accessibilityIdentifier("new-thread-agent-\(workspaceFileIdentifierToken(agent.model))")
                        }
                    }
                }
                Section("Model") {
                    if model.newThreadOptionsLoading, model.visibleNewThreadModels.isEmpty {
                        ProgressView()
                    } else {
                        ForEach(model.visibleNewThreadModels) { option in
                            Button {
                                model.selectNewThreadModel(option.model)
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
                            .accessibilityIdentifier("new-thread-model-\(workspaceFileIdentifierToken(option.model))")
                        }
                    }
                }
                if let selectedModel = model.selectedNewThreadModel,
                   !selectedModel.supportedReasoningEfforts.isEmpty
                {
                    Section("Reasoning") {
                        ForEach(selectedModel.supportedReasoningEfforts, id: \.reasoningEffort) { effort in
                            Button {
                                model.newThreadReasoningEffort = effort.reasoningEffort
                            } label: {
                                HStack {
                                    Text(effort.reasoningEffort)
                                    Spacer()
                                    if effort.reasoningEffort == model.newThreadReasoningEffort {
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
                    .accessibilityIdentifier("new-thread-start")
                }
            }
        }
    }
}

private struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context _: Context) {
        controller.reloadData()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(url: url)
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL

        init(url: URL) {
            self.url = url
        }

        func numberOfPreviewItems(in _: QLPreviewController) -> Int {
            1
        }

        func previewController(
            _: QLPreviewController,
            previewItemAt _: Int
        ) -> QLPreviewItem {
            url as NSURL
        }
    }
}

private func sanitizeWorkspaceFilename(_ value: String) -> String {
    let trimmed = value.trimmedNonEmpty ?? "workspace-file"
    let invalidCharacters = CharacterSet(charactersIn: "/\\?%*|\"<>:")
        .union(.newlines)
        .union(.controlCharacters)
    let cleaned = trimmed
        .components(separatedBy: invalidCharacters)
        .joined(separator: "-")
        .trimmedNonEmpty ?? "workspace-file"
    return String(cleaned.prefix(160))
}

private func workspaceFileIdentifierToken(_ value: String) -> String {
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
    let token = String(value.unicodeScalars.map { scalar in
        allowed.contains(scalar) ? Character(scalar) : "-"
    }).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
    return token.isEmpty ? "file" : token
}
