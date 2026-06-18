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
    @Published var newThreadModel = "gpt-5.4"

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

    func refresh() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            let snapshot = try await client.fetchHomeSnapshot()
            workspace = snapshot.workspaces.first { $0.id == workspaceId }
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
                    provider: nil,
                    model: newThreadModel,
                    reasoningEffort: nil,
                    approvalMode: "yolo"
                )
            )
            threadId = thread.id
        }
        return threadId
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
    @State private var showingNewThread = false
    @State private var showingUploadImporter = false

    init(
        environment: AppEnvironment,
        connection: SupervisorConnectionConfig,
        workspaceId: String,
        onOpenThread: @escaping (String) -> Void
    ) {
        _model = StateObject(
            wrappedValue: WorkspaceDetailViewModel(
                environment: environment,
                connection: connection,
                workspaceId: workspaceId
            )
        )
        self.onOpenThread = onOpenThread
    }

    var body: some View {
        List {
            workspaceSection
            threadsSection
            filesSection
            previewSection
        }
        .navigationTitle(model.workspace?.label ?? "Workspace")
        .refreshable { await model.refresh() }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("New Thread") { showingNewThread = true }
                Button("Upload") { showingUploadImporter = true }
                    .accessibilityIdentifier("workspace-file-upload")
                Button("Refresh") { Task { await model.refresh() } }
            }
        }
        .task { await model.refresh() }
        .sheet(isPresented: $showingNewThread) {
            newThreadSheet
        }
        .sheet(item: $model.previewFile) { file in
            QuickLookPreview(url: file.url)
        }
        .fileImporter(
            isPresented: $showingUploadImporter,
            allowedContentTypes: [.item],
            allowsMultipleSelection: false
        ) { result in
            switch result {
            case let .success(urls):
                guard let url = urls.first else { return }
                Task { await model.uploadFile(from: url) }
            case let .failure(error):
                model.errorMessage = error.localizedDescription
            }
        }
    }

    private var workspaceSection: some View {
        Section("Workspace") {
            if let workspace = model.workspace {
                LabeledContent("Path", value: workspace.absPath)
                LabeledContent("Favorite", value: workspace.isFavorite ? "Yes" : "No")
                HStack {
                    Button("Open") { Task { await model.openWorkspace() } }
                    Button(workspace.isFavorite ? "Unstar" : "Star") { Task { await model.toggleFavorite() } }
                }
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
        Section("Threads") {
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
            }
        }
    }

    private var filesSection: some View {
        Section("Files") {
            if model.flatNodes.isEmpty {
                ContentUnavailableView("No Files", systemImage: "folder")
            }
            ForEach(model.flatNodes) { node in
                Button {
                    if node.kind == "file" {
                        Task { await model.selectFile(node.path) }
                    }
                } label: {
                    HStack {
                        Text(String(repeating: "  ", count: node.depth) + (node.kind == "file" ? "doc " : "folder ") + node.name)
                            .font(node.kind == "file" ? .body : .body.weight(.semibold))
                        if model.selectedPath == node.path {
                            Spacer()
                            GraphBadge(text: "Selected", tone: .success)
                        }
                    }
                }
                .disabled(node.kind != "file")
                .accessibilityIdentifier("workspace-file-row-\(workspaceFileIdentifierToken(node.path))")
            }
        }
    }

    private var previewSection: some View {
        Section("Preview") {
            if model.fileLoading {
                ProgressView("Loading file...")
            }
            if let preview = model.preview {
                LabeledContent("File", value: preview.path)
                LabeledContent("Language", value: preview.language)
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Button("Save") { Task { await model.saveCurrentFile() } }
                            .accessibilityIdentifier("workspace-file-save")
                        Button("Copy raw") { Task { await model.copyRawFile() } }
                            .accessibilityIdentifier("workspace-file-copy-raw")
                        Button("Open") { Task { await model.openRawFile() } }
                            .accessibilityIdentifier("workspace-file-open")
                    }
                    HStack {
                        Button("Download") { Task { await model.downloadCurrentFile() } }
                            .accessibilityIdentifier("workspace-file-download")
                        if preview.truncated {
                            Button("Load more") { Task { await model.loadMorePreview() } }
                                .accessibilityIdentifier("workspace-file-load-more")
                        }
                    }
                }
                .buttonStyle(.bordered)
                if let message = model.message {
                    Text(message)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("workspace-file-message")
                }
                TextEditor(text: $model.editableContent)
                    .font(.system(.footnote, design: .monospaced))
                    .frame(minHeight: 240)
                if let downloadedFile = model.downloadedFile {
                    LabeledContent("Downloaded", value: downloadedFile.filename)
                    ShareLink(item: downloadedFile.url) {
                        Label("Share downloaded file", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        model.previewFile = downloadedFile
                    } label: {
                        Label("Open downloaded file", systemImage: "doc.text.magnifyingglass")
                    }
                }
            } else {
                Text("Select a file to preview.")
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var newThreadSheet: some View {
        NavigationStack {
            Form {
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
                    .disabled(model.newThreadModel.isEmpty)
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
