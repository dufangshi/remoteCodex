import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class ThreadDetailViewModel: ObservableObject {
    @Published var detail: SupervisorThreadDetail?
    @Published var loading = false
    @Published var sending = false
    @Published var message: String?
    @Published var errorMessage: String?
    @Published var promptDraft = ""
    @Published var renameDraft = ""
    @Published var goalDraft = ""
    @Published var modelDraft = ""
    @Published var reasoningDraft = ""
    @Published var collaborationDraft = "default"
    @Published var sandboxDraft = ""
    @Published var fastModeDraft = false
    @Published var workspaceTree: SupervisorWorkspaceTreeNode?
    @Published var workspacePreview: SupervisorWorkspaceFilePreview?
    @Published var availableWorkspaces: [SupervisorWorkspaceSummary] = []
    @Published var modelOptions: [SupervisorModelOption] = []
    @Published var forkTurns: [SupervisorThreadForkTurnOption] = []
    @Published var exportTurns: SupervisorThreadExportTurns?
    @Published var skills: SupervisorThreadSkills?
    @Published var mcpServers: SupervisorThreadMcpServers?
    @Published var hooks: SupervisorThreadHooks?
    @Published var bundleWarnings: [String] = []
    @Published var promptAttachments: [PromptAttachmentUploadRequest] = []
    @Published var exportedFile: ThreadLocalFile?
    @Published var resolvingRequestId: String?
    @Published var exportFormat = "pdf"
    @Published var exportMode = "latest"
    @Published var exportProfile = "standard"
    @Published var includeTokenAndPrice = false
    @Published var includeCommandOutput = true
    @Published var includeAbsolutePaths = false
    @Published var selectedExportTurnIds: Set<String> = []
    @Published var historyDetailCache: [String: HistoryDetailPreview] = [:]
    @Published var loadingHistoryDetailId: String?
    @Published var socketState: SupervisorSocketState = .closed
    @Published var loadingEarlier = false
    @Published private(set) var eventCursor: String?

    let threadId: String
    let environment: AppEnvironment
    let connection: SupervisorConnectionConfig
    let eventReconnectDelayNanoseconds: (Int) -> UInt64
    private var projectionState: ThreadProjectionState?
    private var optimisticPrompt: OptimisticPromptTurn?
    var eventSocketClient: (any SupervisorThreadEventStreaming)?
    var eventStreamTask: Task<Void, Never>?
    var reconnectTask: Task<Void, Never>?
    var eventStreamGeneration = 0
    var reconnectAttempt = 0
    var screenWantsEventStream = false
    var sceneAllowsEventStream = true
    var refreshAfterNextSocketOpen = false

    init(
        environment: AppEnvironment,
        connection: SupervisorConnectionConfig,
        threadId: String,
        eventReconnectDelayNanoseconds: @escaping (Int) -> UInt64 = defaultSupervisorReconnectDelayNanoseconds
    ) {
        self.environment = environment
        self.connection = connection
        self.threadId = threadId
        self.eventReconnectDelayNanoseconds = eventReconnectDelayNanoseconds
    }

    private var client: SupervisorAPIClient {
        environment.apiClientFactory(connection)
    }

    var thread: SupervisorThreadSummary? {
        detail?.thread
    }

    var presentation: ThreadDetailPresentation? {
        detail.map {
            buildThreadDetailPresentation(
                $0,
                workspaceTree: workspaceTree,
                workspacePreview: workspacePreview,
                exportTurns: exportTurns,
                forkTurns: forkTurns,
                skills: skills,
                mcpServers: mcpServers,
                hooks: hooks,
                modelOptions: modelOptions
            )
        }
    }

    var turns: [SupervisorThreadTurn] {
        detail?.turns ?? []
    }

    var pendingRequests: [SupervisorThreadActionRequest] {
        detail?.pendingRequests ?? []
    }

    var canLoadEarlier: Bool {
        guard let detail, let total = detail.totalTurnCount else { return false }
        return total > detail.turns.count
    }

    func refresh() async {
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            let loaded = try await client.fetchThreadDetail(threadId: threadId, limit: 30)
            apply(detail: loaded)
            if let detail {
                await loadBundleResources(for: detail)
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func sendPrompt() async {
        guard let prompt = promptDraft.normalizedPromptText.trimmedNonEmpty else { return }
        sending = true
        errorMessage = nil
        message = nil
        let clientRequestId = UUID().uuidString
        optimisticPrompt = OptimisticPromptTurn(
            id: "ios-\(clientRequestId)",
            serverTurnId: nil,
            prompt: prompt,
            startedAt: ISO8601DateFormatter().string(from: Date()),
            model: modelDraft.trimmedNonEmpty ?? thread?.model
        )
        publishProjectedDetail()
        defer { sending = false }
        do {
            let acceptedThread: SupervisorThreadSummary = if promptAttachments.isEmpty {
                try await client.sendThreadPrompt(
                    threadId: threadId,
                    request: SendThreadPromptRequest(
                        prompt: prompt,
                        clientRequestId: clientRequestId,
                        model: modelDraft.trimmedNonEmpty,
                        reasoningEffort: reasoningDraft.trimmedNonEmpty,
                        collaborationMode: collaborationDraft.trimmedNonEmpty,
                        sandboxMode: sandboxDraft.trimmedNonEmpty
                    )
                )
            } else {
                try await client.sendThreadPromptUpload(
                    threadId: threadId,
                    request: SendThreadPromptUploadRequest(
                        prompt: prompt,
                        clientRequestId: clientRequestId,
                        model: modelDraft.trimmedNonEmpty,
                        reasoningEffort: reasoningDraft.trimmedNonEmpty,
                        collaborationMode: collaborationDraft.trimmedNonEmpty,
                        sandboxMode: sandboxDraft.trimmedNonEmpty,
                        attachments: promptAttachments
                    )
                )
            }
            optimisticPrompt = optimisticPrompt?.withAcceptedThread(acceptedThread)
            publishProjectedDetail()
            promptDraft = ""
            promptAttachments = []
            message = "Prompt sent"
            await refresh()
        } catch {
            optimisticPrompt = optimisticPrompt?.withFailure(error.localizedDescription)
            publishProjectedDetail()
            errorMessage = error.localizedDescription
        }
    }

    func loadEarlierHistory() async {
        guard let beforeTurnId = projectionState?.detail.turns.first?.id, !loadingEarlier else { return }
        loadingEarlier = true
        errorMessage = nil
        defer { loadingEarlier = false }
        do {
            let older = try await client.fetchThreadDetail(threadId: threadId, limit: 10, beforeTurnId: beforeTurnId)
            let nextState = (projectionState ?? ThreadProjectionState(detail: older)).prependingOlderHistory(older)
            projectionState = nextState
            eventCursor = nextState.lastEventCursor
            publishProjectedDetail()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func addPromptAttachment(from url: URL) async {
        let securityScoped = url.startAccessingSecurityScopedResource()
        defer {
            if securityScoped {
                url.stopAccessingSecurityScopedResource()
            }
        }
        do {
            let bytes = try Data(contentsOf: url)
            let filename = url.lastPathComponent.trimmedNonEmpty ?? "attachment"
            let placeholder = "[FILE \(promptAttachments.count + 1): \(filename)]"
            let contentType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                ?? "application/octet-stream"
            let attachment = PromptAttachmentUploadRequest(
                clientId: UUID().uuidString,
                kind: contentType.hasPrefix("image/") ? "image" : "file",
                originalName: filename,
                placeholder: placeholder,
                bytes: bytes,
                contentType: contentType
            )
            promptAttachments.append(attachment)
            promptDraft = appendAttachmentPlaceholder(placeholder, to: promptDraft)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func removePromptAttachment(_ attachment: PromptAttachmentUploadRequest) {
        promptAttachments.removeAll { $0.clientId == attachment.clientId }
        promptDraft = promptDraft.replacingOccurrences(of: attachment.placeholder, with: "")
    }

    func renameThread() async {
        guard let title = renameDraft.trimmedNonEmpty else { return }
        await runSummaryAction {
            detail?.thread = try await client.updateThread(
                threadId: threadId,
                request: UpdateThreadRequest(title: title)
            )
            message = "Renamed thread"
        }
    }

    func updateSettings() async {
        await runSummaryAction {
            detail?.thread = try await client.updateThreadSettings(
                threadId: threadId,
                request: UpdateThreadSettingsRequest(
                    model: modelDraft.trimmedNonEmpty,
                    reasoningEffort: reasoningDraft.trimmedNonEmpty,
                    fastMode: fastModeDraft,
                    collaborationMode: collaborationDraft.trimmedNonEmpty,
                    sandboxMode: sandboxDraft.trimmedNonEmpty
                )
            )
            message = "Updated settings"
        }
    }

    func resumeThread() async {
        await runDetailAction {
            try await client.resumeThread(
                threadId: threadId,
                request: ResumeThreadRequest(model: modelDraft.trimmedNonEmpty, sandboxMode: nil)
            )
        } successMessage: {
            "Resumed thread"
        }
    }

    func interruptThread() async {
        await runSummaryAction {
            detail?.thread = try await client.interruptThread(threadId: threadId)
            message = "Interrupt requested"
        }
    }

    func compactThread() async {
        await runSummaryAction {
            detail?.thread = try await client.compactThread(threadId: threadId)
            message = "Compact requested"
        }
    }

    func updateGoal() async {
        guard let objective = goalDraft.trimmedNonEmpty else { return }
        await runAction {
            let response = try await client.updateThreadGoal(
                threadId: threadId,
                request: UpdateThreadGoalRequest(objective: objective, status: nil, tokenBudget: nil)
            )
            detail?.goalObjective = response.goal?.objective
            detail?.goalStatus = response.goal?.status
            message = "Updated goal"
        }
    }

    func clearGoal() async {
        await runAction {
            _ = try await client.clearThreadGoal(threadId: threadId)
            detail?.goalObjective = nil
            detail?.goalStatus = nil
            goalDraft = ""
            message = "Cleared goal"
        }
    }

    func deleteThread() async -> Bool {
        var deleted = false
        await runAction {
            _ = try await client.deleteThread(threadId: threadId)
            deleted = true
        }
        return deleted
    }

    func respondToRequest(
        _ request: SupervisorThreadActionRequest,
        answers: [String: [String]]
    ) async {
        resolvingRequestId = request.id
        await runDetailAction {
            try await client.respondToThreadRequest(
                threadId: threadId,
                requestId: request.id,
                request: RespondThreadRequest(
                    answers: answers.mapValues { RespondThreadRequestAnswer(answers: $0) }
                )
            )
        } successMessage: {
            "Request response sent"
        }
        resolvingRequestId = nil
    }

    func forkLatestThread() async -> String? {
        await forkThread(request: ForkThreadRequest(mode: "latest", turnId: nil))
    }

    func forkThread(at turn: SupervisorThreadForkTurnOption) async -> String? {
        await forkThread(request: ForkThreadRequest(mode: "turn", turnId: turn.turnId))
    }

    func exportTranscript() async {
        await runAction {
            let download = try await client.downloadThreadTranscriptExport(
                threadId: threadId,
                request: ExportThreadRequest(
                    format: exportFormat,
                    mode: exportMode,
                    limit: nil,
                    turnIds: exportMode == "custom" ? selectedExportTurnIdsInOrder : [],
                    profile: exportProfile,
                    includeTokenAndPrice: includeTokenAndPrice,
                    includeCommandOutput: includeCommandOutput,
                    includeAbsolutePaths: includeAbsolutePaths
                )
            )
            exportedFile = try writeTemporaryFile(filename: download.filename, bytes: download.bytes)
            message = "Export ready"
        }
    }

    func historyDetailPreview(for item: HistoryItemPresentation) -> HistoryDetailPreview {
        if let cached = historyDetailCache[item.id] {
            return cached
        }
        return fallbackHistoryDetailPreview(for: item)
    }

    func loadHistoryDetail(for item: HistoryItemPresentation) async {
        guard historyDetailCache[item.id] == nil else { return }
        loadingHistoryDetailId = item.id
        defer { loadingHistoryDetailId = nil }
        do {
            let detail = try await client.fetchThreadHistoryItemDetail(threadId: threadId, itemId: item.id)
            historyDetailCache[item.id] = buildHistoryDetailPreview(
                kind: detail.kind,
                title: detail.title,
                text: detail.text,
                contentType: detail.contentType,
                sourcePath: detail.sourcePath,
                assetPath: detail.assetPath,
                fallback: fallbackHistoryDetailPreview(for: item)
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func apply(detail: SupervisorThreadDetail) {
        let nextState = projectionState?.reconcile(with: detail) ?? ThreadProjectionState(detail: detail)
        projectionState = nextState
        eventCursor = nextState.lastEventCursor
        if shouldClearOptimisticPrompt(detail: nextState.detail, optimistic: optimisticPrompt) {
            optimisticPrompt = nil
        }
        publishProjectedDetail()
        let applied = self.detail ?? nextState.detail
        renameDraft = applied.thread.title
        modelDraft = applied.thread.model ?? ""
        reasoningDraft = applied.thread.reasoningEffort ?? ""
        collaborationDraft = applied.thread.collaborationMode
        sandboxDraft = applied.thread.sandboxMode ?? ""
        fastModeDraft = applied.thread.fastMode
        goalDraft = applied.goalObjective ?? ""
    }

    func consume(event: SupervisorThreadEvent) async {
        guard let projectionState else { return }
        if event.type == "thread.turn.started", let turnId = event.payload.string("turnId") {
            optimisticPrompt = optimisticPrompt?.withStartedTurn(turnId)
        }
        let result = reduceThreadEvent(state: projectionState, event: event)
        self.projectionState = result.state
        eventCursor = result.state.lastEventCursor
        if shouldClearOptimisticPrompt(detail: result.detail, optimistic: optimisticPrompt) {
            optimisticPrompt = nil
        }
        publishProjectedDetail()
        if result.needsRefresh {
            await refresh()
        }
    }

    private func publishProjectedDetail() {
        guard let projectionState else { return }
        detail = applyOptimisticPromptProjection(
            detail: projectionState.detail,
            optimistic: optimisticPrompt
        )
    }

    private func forkThread(request: ForkThreadRequest) async -> String? {
        var forkedThreadId: String?
        await runAction {
            let result = try await client.forkThread(threadId: threadId, request: request)
            forkedThreadId = result.thread.thread.id
            message = "Forked thread"
        }
        return forkedThreadId
    }

    private func loadBundleResources(for detail: SupervisorThreadDetail) async {
        bundleWarnings = []
        await loadAvailableWorkspaces()
        do {
            modelOptions = try await client.listAgentModels(provider: detail.thread.provider)
        } catch {
            bundleWarnings.append("Model options: \(error.localizedDescription)")
        }
        do {
            workspaceTree = try await client.fetchWorkspaceTree(workspaceId: detail.workspace.id)
            if let path = workspaceTree?.firstFilePath {
                workspacePreview = try await client.fetchWorkspaceFilePreview(
                    workspaceId: detail.workspace.id,
                    path: path,
                    limit: 12000
                )
            }
        } catch {
            bundleWarnings.append("Workspace context: \(error.localizedDescription)")
        }
        do {
            forkTurns = try await client.fetchThreadForkTurns(threadId: threadId)
        } catch {
            bundleWarnings.append("Fork turns: \(error.localizedDescription)")
        }
        do {
            exportTurns = try await client.fetchThreadExportTurns(threadId: threadId)
            if selectedExportTurnIds.isEmpty {
                selectedExportTurnIds = Set(exportTurns?.turns.map(\.turnId) ?? [])
            }
        } catch {
            bundleWarnings.append("Export turns: \(error.localizedDescription)")
        }
        do {
            skills = try await client.fetchThreadSkills(threadId: threadId)
        } catch {
            bundleWarnings.append("Skills: \(error.localizedDescription)")
        }
        do {
            mcpServers = try await client.fetchThreadMcpServers(threadId: threadId)
        } catch {
            bundleWarnings.append("MCP servers: \(error.localizedDescription)")
        }
        do {
            hooks = try await client.fetchThreadHooks(threadId: threadId)
        } catch {
            bundleWarnings.append("Hooks: \(error.localizedDescription)")
        }
    }

    private func runSummaryAction(_ operation: () async throws -> Void) async {
        await runAction(operation)
    }

    private func runDetailAction(
        _ operation: () async throws -> SupervisorThreadDetail,
        successMessage: () -> String
    ) async {
        await runAction {
            try await apply(detail: operation())
            if let detail {
                await loadBundleResources(for: detail)
            }
            message = successMessage()
        }
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

    private func writeTemporaryFile(filename: String, bytes: Data) throws -> ThreadLocalFile {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("RemoteCodexThreadExports", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let safeName = sanitizeThreadFilename(filename)
        let url = directory.appendingPathComponent("\(UUID().uuidString)-\(safeName)")
        try bytes.write(to: url, options: [.atomic])
        return ThreadLocalFile(url: url, filename: safeName)
    }

    private func fallbackHistoryDetailPreview(for item: HistoryItemPresentation) -> HistoryDetailPreview {
        HistoryDetailPreview(
            title: item.title,
            text: item.summary,
            contentType: inferHistoryDetailContentType(
                kind: historyItemLabel(item.kind),
                title: item.title,
                text: item.summary,
                sourcePath: item.meta
            ),
            sourcePath: item.meta
        )
    }
}

struct ThreadLocalFile: Identifiable, Equatable {
    var id: String {
        url.absoluteString
    }

    var url: URL
    var filename: String
}

struct ThreadDetailScreen: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject var model: ThreadDetailViewModel
    let onClose: () -> Void
    let onOpenThread: (String) -> Void
    let onOpenWorkspace: (String) -> Void
    @State var confirmingDelete = false
    @State var showingAttachmentImporter = false
    @State var workspacePanelTab: ThreadWorkspacePanelTab = .workspace
    @State var selectedHistoryDetail: HistoryItemPresentation?
    @State var showingExportDialog = false
    @State var showingWorkspaceSwitcher = false
    @State var showingSlashToolbox = false
    @State var expandedTurnIds: Set<String> = []
    @FocusState var promptFocused: Bool

    init(
        environment: AppEnvironment,
        connection: SupervisorConnectionConfig,
        threadId: String,
        onClose: @escaping () -> Void,
        onOpenThread: @escaping (String) -> Void = { _ in },
        onOpenWorkspace: @escaping (String) -> Void = { _ in }
    ) {
        _model = StateObject(
            wrappedValue: ThreadDetailViewModel(
                environment: environment,
                connection: connection,
                threadId: threadId
            )
        )
        self.onClose = onClose
        self.onOpenThread = onOpenThread
        self.onOpenWorkspace = onOpenWorkspace
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                roomsSection
                statusSection
                pendingRequestsSection
                    .id("thread-pending-requests-anchor")
                composerSection
                contextSection
                timelineSection
                runtimeSection
                extensionsSection
                exportSection
                actionsSection
                Color.clear
                    .frame(height: 1)
                    .id("thread-latest-anchor")
            }
            .accessibilityIdentifier("thread-detail-screen")
            .navigationTitle(model.thread?.title ?? "Thread")
            .refreshable { await model.refresh() }
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button("Home", action: onClose)
                    if !model.pendingRequests.isEmpty {
                        Button("Requests") {
                            withAnimation {
                                proxy.scrollTo("thread-pending-requests-anchor", anchor: .top)
                            }
                        }
                        .accessibilityIdentifier("thread-show-pending-requests")
                    }
                    Button("Latest") {
                        withAnimation {
                            proxy.scrollTo("thread-latest-anchor", anchor: .bottom)
                        }
                    }
                    Menu("Actions") {
                        Button("Refresh") { Task { await model.refresh() } }
                        Button("Export") { showingExportDialog = true }
                        Button("Fork Latest") {
                            Task {
                                if let threadId = await model.forkLatestThread() {
                                    onOpenThread(threadId)
                                }
                            }
                        }
                        Button("New Chat") {
                            Task {
                                if let threadId = await model.startNewChatFromCurrentThread() {
                                    onOpenThread(threadId)
                                }
                            }
                        }
                        Button("Switch Workspace") { showingWorkspaceSwitcher = true }
                        Button("Settings") { workspacePanelTab = .guide }
                        Button("Delete", role: .destructive) {
                            confirmingDelete = true
                        }
                    }
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button(model.sending ? "Sending..." : "Send Prompt") {
                        promptFocused = false
                        Task { await model.sendPrompt() }
                    }
                    .accessibilityIdentifier("thread-keyboard-send-prompt")
                    .disabled(model.sending || model.promptDraft.trimmedNonEmpty == nil)
                }
            }
            .task { await model.refresh() }
            .task { model.startEventStream() }
            .onChange(of: model.presentation?.turns.map(\.id) ?? []) { _, turnIds in
                expandedTurnIds.formUnion(turnIds)
            }
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .active:
                    model.resumeRealtimeAfterForeground()
                case .background:
                    model.suspendRealtimeForBackground()
                case .inactive:
                    break
                @unknown default:
                    break
                }
            }
            .onDisappear { model.stopEventStream() }
            .fileImporter(
                isPresented: $showingAttachmentImporter,
                allowedContentTypes: [.item],
                allowsMultipleSelection: true
            ) { result in
                switch result {
                case let .success(urls):
                    for url in urls {
                        Task { await model.addPromptAttachment(from: url) }
                    }
                case let .failure(error):
                    model.errorMessage = error.localizedDescription
                }
            }
            .confirmationDialog(
                "Delete this thread?",
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete Thread", role: .destructive) {
                    Task {
                        if await model.deleteThread() {
                            onClose()
                        }
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
            .sheet(item: $selectedHistoryDetail) { item in
                ThreadHistoryDetailSheet(item: item, model: model)
            }
            .sheet(isPresented: $showingExportDialog) {
                ThreadExportDialog(model: model)
            }
            .sheet(isPresented: $showingWorkspaceSwitcher) {
                ThreadWorkspaceSwitcherSheet(model: model) { workspaceId in
                    onOpenWorkspace(workspaceId)
                }
            }
        }
    }

    private var roomsSection: some View {
        Section("Rooms") {
            ForEach(model.presentation?.rooms ?? []) { room in
                HStack(spacing: 10) {
                    GraphBadge(text: room.status.label, tone: room.status.badgeTone)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(room.title)
                            .font(.callout.weight(.semibold))
                        Text("\(room.workspaceLabel) · \(room.updatedLabel)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer()
                    if room.active {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .accessibilityLabel("Active room")
                    }
                }
            }
            Button {
                showingWorkspaceSwitcher = true
            } label: {
                Label("Switch Workspace", systemImage: "rectangle.2.swap")
            }
            .accessibilityIdentifier("thread-switch-workspace")
        }
    }

    private var statusSection: some View {
        Section("Thread") {
            if let presentation = model.presentation, let thread = model.thread {
                LabeledContent("Status", value: presentation.status.label)
                if let summary = thread.summaryText?.trimmedNonEmpty {
                    LabeledContent("Summary", value: summary)
                }
                LabeledContent("Workspace", value: presentation.workspace)
                LabeledContent("Runtime", value: presentation.runtime)
                LabeledContent("Usage", value: presentation.usage)
                LabeledContent("Items", value: presentation.itemSummary)
                LabeledContent("Updated", value: thread.updatedAt)
                LabeledContent("Events", value: model.socketState.label)
            }
            if let goal = model.presentation?.goal {
                LabeledContent("Goal", value: goal.objective)
                LabeledContent("Goal status", value: goal.statusLabel)
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

    private var pendingRequestsSection: some View {
        Section("Pending Requests") {
            if model.pendingRequests.isEmpty {
                Text("No pending requests.")
                    .foregroundStyle(.secondary)
            }
            ForEach(model.pendingRequests) { request in
                PendingThreadRequestRow(
                    request: request,
                    resolvingRequestId: model.resolvingRequestId,
                    onRespond: { answers in
                        Task { await model.respondToRequest(request, answers: answers) }
                    }
                )
            }
        }
    }

    private var timelineSection: some View {
        Section("Timeline") {
            let presentation = model.presentation
            if presentation?.canLoadEarlier == true {
                Button(model.loadingEarlier ? "Loading earlier..." : "Load Earlier") {
                    Task { await model.loadEarlierHistory() }
                }
                .disabled(model.loadingEarlier)
                .accessibilityIdentifier("thread-load-earlier")
            }
            if presentation?.turns.isEmpty ?? true {
                ContentUnavailableView("No Turns", systemImage: "text.bubble")
            }
            ForEach(presentation?.timelineNotes ?? []) { note in
                ThreadTimelineNoteRow(note: note)
            }
            ForEach(presentation?.turns ?? []) { turn in
                DisclosureGroup(isExpanded: turnExpansionBinding(turn.id)) {
                    VStack(alignment: .leading, spacing: 8) {
                        if let usage = turn.usage {
                            ThreadTimelineUsageRow(usage: usage)
                        }
                        ForEach(turn.messages) { message in
                            ThreadTimelineMessageRow(message: message)
                        }
                        if let livePlan = turn.livePlan {
                            ThreadTimelineLivePlanRow(plan: livePlan)
                        }
                        if !turn.reasoningItems.isEmpty {
                            DisclosureGroup("Reasoning") {
                                ForEach(turn.reasoningItems) { item in
                                    ThreadTimelineReasoningRow(item: item)
                                }
                            }
                        }
                        ForEach(turn.historyItems) { item in
                            ThreadTimelineHistoryRow(item: item) {
                                selectedHistoryDetail = item
                            }
                        }
                    }
                } label: {
                    ThreadTurnFrameHeader(turn: turn)
                }
            }
        }
    }

    private func turnExpansionBinding(_ turnId: String) -> Binding<Bool> {
        Binding {
            expandedTurnIds.contains(turnId)
        } set: { isExpanded in
            if isExpanded {
                expandedTurnIds.insert(turnId)
            } else {
                expandedTurnIds.remove(turnId)
            }
        }
    }

    private var contextSection: some View {
        ThreadWorkspacePanelSection(model: model, selectedTab: $workspacePanelTab)
    }

    private var exportSection: some View {
        Section("Export & Fork") {
            Button("Export Transcript") {
                showingExportDialog = true
            }
            .accessibilityIdentifier("thread-export-transcript")
            if let exportedFile = model.exportedFile {
                LabeledContent("Exported", value: exportedFile.filename)
                    .accessibilityLabel("Exported \(exportedFile.filename)")
                    .accessibilityIdentifier("thread-exported-file")
                ShareLink(item: exportedFile.url) {
                    Label("Share \(exportedFile.filename)", systemImage: "square.and.arrow.up")
                }
                .accessibilityIdentifier("thread-export-share-main")
            }
            Button("Fork Latest") {
                Task {
                    if let threadId = await model.forkLatestThread() {
                        onOpenThread(threadId)
                    }
                }
            }
            .accessibilityIdentifier("thread-fork-latest")
            ForEach(Array(model.forkTurns.prefix(3))) { turn in
                let preview = model.presentation?.forkTurns.first { $0.id == turn.id }
                Button("Fork turn \(preview?.number ?? turn.turnIndex)") {
                    Task {
                        if let threadId = await model.forkThread(at: turn) {
                            onOpenThread(threadId)
                        }
                    }
                }
                if let preview {
                    Text("\(preview.timeLabel) · \(preview.statusLabel)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var runtimeSection: some View {
        Section("Runtime") {
            if model.modelOptions.isEmpty {
                TextField("Model", text: $model.modelDraft)
                    .textInputAutocapitalization(.never)
            } else {
                Picker("Model", selection: $model.modelDraft) {
                    Text("Default").tag("")
                    ForEach(model.modelOptions.filter { !$0.hidden }) { option in
                        Text(option.displayName).tag(option.model)
                    }
                }
            }
            Picker("Reasoning", selection: $model.reasoningDraft) {
                Text("Default").tag("")
                ForEach(reasoningOptions, id: \.self) { effort in
                    Text(effort).tag(effort)
                }
            }
            Picker("Collaboration", selection: $model.collaborationDraft) {
                Text("Default").tag("default")
                Text("Plan").tag("plan")
                Text("Auto").tag("auto")
            }
            Picker("Sandbox", selection: $model.sandboxDraft) {
                Text("Default").tag("")
                Text("Read only").tag("read-only")
                Text("Workspace write").tag("workspace-write")
                Text("Danger full access").tag("danger-full-access")
            }
            Toggle("Fast mode", isOn: $model.fastModeDraft)
            Button("Update Settings") { Task { await model.updateSettings() } }
        }
    }

    private var extensionsSection: some View {
        Section("Extensions") {
            if let summary = model.presentation?.extensionSummary {
                LabeledContent("Skills", value: "\(summary.skillCount)")
                ForEach(summary.skillPreviews) { skill in
                    VStack(alignment: .leading) {
                        Text(skill.title)
                        Text(skill.subtitle ?? "")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                LabeledContent("MCP servers", value: "\(summary.mcpServerCount)")
                LabeledContent("MCP tools", value: "\(summary.mcpToolCount)")
                ForEach(summary.mcpPreviews) { server in
                    LabeledContent(server.title, value: server.subtitle ?? "")
                }
                LabeledContent("Hooks", value: "\(summary.hookCount)")
                ForEach(summary.hookPreviews) { hook in
                    LabeledContent(hook.title, value: hook.statusLabel ?? "")
                }
                let issueCount = summary.skillErrorCount + summary.hookWarningCount + summary.hookErrorCount
                if issueCount > 0 {
                    Text(
                        "\(summary.skillErrorCount) skill errors, " +
                            "\(summary.hookWarningCount) hook warnings, " +
                            "\(summary.hookErrorCount) hook errors"
                    )
                    .font(.caption)
                    .foregroundStyle(.orange)
                }
            }
        }
    }

    private var actionsSection: some View {
        Section("Actions") {
            TextField("Title", text: $model.renameDraft)
            Button("Rename") { Task { await model.renameThread() } }
                .disabled(model.renameDraft.trimmedNonEmpty == nil)
            TextField("Goal", text: $model.goalDraft, axis: .vertical)
            HStack {
                Button("Update Goal") { Task { await model.updateGoal() } }
                    .disabled(model.goalDraft.trimmedNonEmpty == nil)
                Button("Clear Goal") { Task { await model.clearGoal() } }
            }
            HStack {
                Button("Resume") { Task { await model.resumeThread() } }
                Button("Interrupt") { Task { await model.interruptThread() } }
                Button("Compact") { Task { await model.compactThread() } }
            }
            Button("Delete Thread", role: .destructive) {
                confirmingDelete = true
            }
        }
    }

    private var reasoningOptions: [String] {
        let selected = model.modelOptions.first { $0.model == model.modelDraft }
        let fromModel = selected?.supportedReasoningEfforts.map(\.reasoningEffort) ?? []
        return fromModel.isEmpty ? ["minimal", "low", "medium", "high"] : fromModel
    }
}

private extension SupervisorWorkspaceTreeNode {
    var firstFilePath: String? {
        if kind == "file" {
            return path
        }
        return children?.lazy.compactMap(\.firstFilePath).first
    }
}

private extension SupervisorSocketState {
    var label: String {
        switch self {
        case .connecting:
            "Connecting"
        case .open:
            "Live"
        case .closed:
            "Closed"
        case .failed:
            "Unavailable"
        }
    }
}

private extension String {
    var normalizedPromptText: String {
        String(unicodeScalars.map { scalar in
            if scalar.isDisallowedPromptControl {
                return " "
            }
            return String(scalar)
        }.joined())
    }
}

private extension UnicodeScalar {
    var isDisallowedPromptControl: Bool {
        CharacterSet.controlCharacters.contains(self) && value != 10 && value != 9
    }
}

private func appendAttachmentPlaceholder(_ placeholder: String, to prompt: String) -> String {
    guard let prompt = prompt.trimmedNonEmpty else {
        return placeholder
    }
    return "\(prompt)\n\(placeholder)"
}

private func sanitizeThreadFilename(_ value: String) -> String {
    let trimmed = value.trimmedNonEmpty ?? "thread-export"
    let invalidCharacters = CharacterSet(charactersIn: "/\\?%*|\"<>:")
        .union(.newlines)
        .union(.controlCharacters)
    let cleaned = trimmed
        .components(separatedBy: invalidCharacters)
        .joined(separator: "-")
        .trimmedNonEmpty ?? "thread-export"
    return String(cleaned.prefix(160))
}

private func defaultSupervisorReconnectDelayNanoseconds(attempt: Int) -> UInt64 {
    let seconds = [1, 2, 4, 8, 16, 30][min(max(attempt - 1, 0), 5)]
    return UInt64(seconds) * 1_000_000_000
}
