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
    @Published var newThreadModel = ""
    @Published var newThreadBackends: [SupervisorAgentBackend] = []
    @Published var newThreadModels: [SupervisorModelOption] = []
    @Published var newThreadOptionsLoading = false
    @Published var newThreadRuntimeBusyProvider: String?
    @Published var newThreadOptionsError: String?

    let workspaceId: String
    private let environment: AppEnvironment
    private let connection: SupervisorConnectionConfig

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

    var canStartNewThread: Bool {
        !newThreadProvider.isEmpty &&
            !newThreadModel.isEmpty &&
            !loading &&
            !newThreadOptionsLoading &&
            newThreadBackends.first(where: { $0.provider == newThreadProvider })?.canStartSession == true
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
        var threadId: String?
        await runAction {
            let thread = try await client.startThread(
                StartSupervisorThreadRequest(
                    workspaceId: workspaceId,
                    title: newThreadTitle.trimmedNonEmpty,
                    provider: newThreadProvider.trimmedNonEmpty,
                    model: newThreadModel,
                    reasoningEffort: nil,
                    approvalMode: "yolo"
                )
            )
            threadId = thread.id
        }
        return threadId
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

    func selectFile(_ path: String) async {
        do {
            try await loadPreview(path: path)
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
    let onOpenThread: (String) -> Void
    let onChangeConnection: () -> Void
    let onBack: () -> Void
    @State private var showingNewThread = false

    init(
        environment: AppEnvironment,
        connection: SupervisorConnectionConfig,
        workspaceId: String,
        onOpenThread: @escaping (String) -> Void,
        onChangeConnection: @escaping () -> Void,
        onBack: @escaping () -> Void
    ) {
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
    }

    var body: some View {
        List {
            workspaceSection
            threadsSection
        }
        .navigationTitle(model.workspace?.label ?? "Workspace")
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
        .sheet(item: $model.previewFile) { file in
            QuickLookPreview(url: file.url)
        }
    }

    private var workspaceMenu: some View {
        FloatingActionMenu(
            accessibilityIdentifier: "workspace-action-menu",
            appliesFloatingPadding: false
        ) {
            Button(action: onBack) {
                Label("Workspaces", systemImage: "folder")
            }
            Button {
                Task { await model.refresh() }
            } label: {
                Label("Refresh", systemImage: "arrow.clockwise")
            }
            Divider()
            Button(role: .destructive, action: onChangeConnection) {
                Label("Devices", systemImage: "iphone")
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
                Text(message).foregroundStyle(.secondary)
            }
            if let error = model.errorMessage {
                Text(error).foregroundStyle(.red)
            }
        }
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
                        Text(thread.status).font(.caption).foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("thread-open-\(thread.id)")
            }
        } header: {
            HStack {
                Text("Threads")
                Spacer()
                Button("New") {
                    showingNewThread = true
                }
            }
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
                                            .foregroundStyle(backend.canStartSession ? .primary : .secondary)
                                        Text(backend.provider)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        if !backend.canStartSession {
                                            Text(backend.lastError ?? "Runtime is not available.")
                                                .font(.caption2)
                                                .foregroundStyle(.red)
                                        } else if let version = backend.installedVersion {
                                            Text(version)
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
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
                                    .buttonStyle(.bordered)
                                    .accessibilityIdentifier("new-thread-provider-action-\(backend.provider)")
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
                                            .foregroundStyle(.primary)
                                        Text(option.model)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
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
                if let error = model.newThreadOptionsError {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("New Thread")
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
