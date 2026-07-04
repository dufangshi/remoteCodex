import SwiftUI

enum ConnectionSetupRoute: Equatable {
    case modeSelect
    case serverAuth
    case relayAuth
    case relayDevices
}

@MainActor
final class ConnectionViewModel: ObservableObject {
    @Published var mode: SupervisorConnectionMode
    @Published var baseURL: String
    @Published var route: ConnectionSetupRoute
    @Published var username = ""
    @Published var email = ""
    @Published var password = ""
    @Published var relayAuthMode = RelayAuthMode.signIn
    @Published var relayPortal: RelayPortalSummary?
    @Published var createdDevice: RelayCreateDeviceResult?
    @Published var newDeviceName = "iOS workstation"
    @Published var relayDeviceId = ""
    @Published var authToken = ""
    @Published var deviceName = ""
    @Published var savedDevices: [SavedSupervisorDevice] = []
    @Published var editingDevice: SavedSupervisorDevice?
    @Published var editName = ""
    @Published var editBaseURL = ""
    @Published var statusMessage: String?
    @Published var errorMessage: String?
    @Published var busy = false
    @Published var lastRelayRefreshAt: Date?

    private let environment: AppEnvironment
    private let onReady: (SupervisorConnectionConfig) -> Void
    private let onOpenRelaySharedThread: (SupervisorConnectionConfig, RelaySessionShareSummary) -> Void

    init(
        environment: AppEnvironment,
        onReady: @escaping (SupervisorConnectionConfig) -> Void,
        onOpenRelaySharedThread: @escaping (SupervisorConnectionConfig, RelaySessionShareSummary) -> Void
    ) {
        self.environment = environment
        self.onReady = onReady
        self.onOpenRelaySharedThread = onOpenRelaySharedThread
        let saved = environment.settingsStore.readSupervisorConnection()
        mode = saved?.mode ?? .local
        baseURL = saved?.normalizedBaseURL ?? "http://127.0.0.1:8787"
        let savedRelayDeviceId = saved?.relayDeviceId ?? ""
        let savedAuthToken = saved?.authToken ?? ""
        relayDeviceId = savedRelayDeviceId
        authToken = savedAuthToken
        savedDevices = environment.settingsStore.readSavedSupervisorDevices()
        if saved?.mode == .relay, !savedAuthToken.isEmpty, savedRelayDeviceId.isEmpty {
            route = .relayDevices
        } else {
            route = .modeSelect
        }
    }

    func beginAddingDevice() {
        route = .modeSelect
        deviceName = ""
        username = ""
        email = ""
        password = ""
        authToken = ""
        relayDeviceId = ""
        createdDevice = nil
        statusMessage = nil
        errorMessage = nil
    }

    func continueFromModeSelect() {
        errorMessage = nil
        statusMessage = nil
        switch mode {
        case .local:
            Task { await connectDirect() }
        case .server:
            route = .serverAuth
        case .relay:
            route = authToken.isEmpty ? .relayAuth : .relayDevices
            if !authToken.isEmpty {
                Task { await loadRelayPortal() }
            }
        }
    }

    func connectDirect(savedDeviceName: String? = nil) async {
        await runBusy {
            let config = SupervisorConnectionConfig(mode: mode, baseURL: baseURL)
            let client = environment.apiClientFactory(config)
            let check = try await client.checkConnection()
            if check.sessionMode != mode.rawValue {
                errorMessage = "This URL is running \(check.sessionMode) mode. Choose \(check.sessionMode.capitalized) or use a \(mode.label) supervisor URL."
                return
            }
            if check.authRequired, !check.authenticated {
                if mode == .server {
                    route = .serverAuth
                    statusMessage = "Login required."
                } else {
                    errorMessage = "\(mode.label) should not require login. Check that the URL points to a local-mode supervisor."
                }
                return
            }
            try environment.settingsStore.writeSupervisorConnection(config)
            try environment.settingsStore.upsertSavedSupervisorDevice(
                config: config,
                name: savedDeviceName ?? deviceName
            )
            refreshSavedDevices()
            statusMessage = "\(check.sessionLabel). \(check.healthLabel)."
            onReady(config)
        }
    }

    func signInServer() async {
        await runBusy {
            let baseConfig = SupervisorConnectionConfig(mode: .server, baseURL: baseURL)
            let login = try await environment.apiClientFactory(baseConfig).login(username: username, password: password)
            let config = baseConfig.withAuthToken(login.token)
            _ = try await environment.apiClientFactory(config).checkConnection()
            try environment.settingsStore.writeSupervisorConnection(config)
            try environment.settingsStore.upsertSavedSupervisorDevice(
                config: config,
                name: deviceName
            )
            refreshSavedDevices()
            onReady(config)
        }
    }

    func relayLoginOrRegister() async {
        await runBusy {
            let baseConfig = SupervisorConnectionConfig(mode: .relay, baseURL: baseURL)
            let client = environment.apiClientFactory(baseConfig)
            let result = switch relayAuthMode {
            case .signIn:
                try await client.relayLogin(identifier: username, password: password)
            case .register:
                try await client.relayRegister(email: email, username: username, password: password)
            }
            authToken = result.token
            let saved = baseConfig.withAuthToken(result.token)
            try environment.settingsStore.writeSupervisorConnection(saved)
            try environment.settingsStore.upsertSavedSupervisorDevice(
                config: saved,
                name: deviceName
            )
            refreshSavedDevices()
            route = .relayDevices
            await loadRelayPortal()
        }
    }

    private func fetchRelayPortalSummary() async throws -> RelayPortalSummary {
        let config = SupervisorConnectionConfig(mode: .relay, baseURL: baseURL, authToken: authToken)
        return try await environment.apiClientFactory(config).fetchRelayPortal()
    }

    func loadRelayPortal(silent: Bool = false) async {
        guard !authToken.isEmpty else {
            errorMessage = "Log in to the relay before loading devices."
            return
        }
        if silent {
            guard !busy else { return }
            do {
                relayPortal = try await fetchRelayPortalSummary()
                lastRelayRefreshAt = Date()
                if errorMessage != nil, relayPortal != nil {
                    errorMessage = nil
                }
            } catch {
                if relayPortal == nil {
                    errorMessage = error.localizedDescription
                }
            }
            return
        }
        await runBusy {
            relayPortal = try await fetchRelayPortalSummary()
            lastRelayRefreshAt = Date()
            statusMessage = relayPortal?.devices.isEmpty == true ? "Create a backend device to connect." : nil
        }
    }

    func createRelayDevice() async {
        await runBusy {
            let config = SupervisorConnectionConfig(mode: .relay, baseURL: baseURL, authToken: authToken)
            createdDevice = try await environment.apiClientFactory(config).createRelayDevice(name: newDeviceName)
            relayPortal = try await environment.apiClientFactory(config).fetchRelayPortal()
            lastRelayRefreshAt = Date()
        }
    }

    func revokeRelayDevice(_ device: RelayDeviceSummary) async {
        await runBusy {
            let config = SupervisorConnectionConfig(mode: .relay, baseURL: baseURL, authToken: authToken)
            _ = try await environment.apiClientFactory(config).deleteRelayDevice(deviceId: device.id)
            if relayDeviceId == device.id {
                relayDeviceId = ""
                environment.settingsStore.clearRelayDeviceSelection()
            }
            relayPortal = try await environment.apiClientFactory(config).fetchRelayPortal()
            lastRelayRefreshAt = Date()
        }
    }

    func connectRelayDevice(_ device: RelayDeviceSummary) async {
        await runBusy {
            let config = SupervisorConnectionConfig(
                mode: .relay,
                baseURL: baseURL,
                authToken: authToken,
                relayDeviceId: device.id
            )
            _ = try await environment.apiClientFactory(config).checkConnection()
            try environment.settingsStore.writeSupervisorConnection(config)
            try environment.settingsStore.upsertSavedSupervisorDevice(config: config)
            refreshSavedDevices()
            onReady(config)
        }
    }

    func saveRelayDeviceWithoutHealthCheck(_ device: RelayDeviceSummary) async {
        await runBusy {
            let config = SupervisorConnectionConfig(
                mode: .relay,
                baseURL: baseURL,
                authToken: authToken,
                relayDeviceId: device.id
            )
            try environment.settingsStore.writeSupervisorConnection(config)
            try environment.settingsStore.upsertSavedSupervisorDevice(config: config)
            refreshSavedDevices()
            relayDeviceId = device.id
            statusMessage = "Device saved. Workspaces will load when the backend connects."
            onReady(config)
        }
    }

    func openSharedSession(_ share: RelaySessionShareSummary) {
        let config = SupervisorConnectionConfig(
            mode: .relay,
            baseURL: baseURL,
            authToken: authToken,
            relayDeviceId: share.deviceId
        )
        do {
            try environment.settingsStore.writeSupervisorConnection(config)
            onOpenRelaySharedThread(config, share)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func connectSavedDevice(_ device: SavedSupervisorDevice) async {
        switch device.mode {
        case .local:
            mode = .local
            baseURL = device.normalizedBaseURL
            await connectDirect(savedDeviceName: device.name)
        case .server:
            let config = environment.settingsStore.supervisorConnection(for: device)
            mode = .server
            baseURL = config.normalizedBaseURL
            authToken = config.authToken ?? ""
            guard config.authToken?.trimmedNonEmpty != nil else {
                route = .serverAuth
                return
            }
            await runBusy {
                _ = try await environment.apiClientFactory(config).checkConnection()
                try environment.settingsStore.writeSupervisorConnection(config)
                try environment.settingsStore.upsertSavedSupervisorDevice(config: config, name: device.name)
                refreshSavedDevices()
                onReady(config)
            }
        case .relay:
            let config = environment.settingsStore.supervisorConnection(for: device)
            mode = .relay
            baseURL = config.normalizedBaseURL
            authToken = config.authToken ?? ""
            relayDeviceId = ""
            route = config.authToken?.trimmedNonEmpty == nil ? .relayAuth : .relayDevices
            if route == .relayDevices {
                await loadRelayPortal()
            }
        }
    }

    func editSavedDevice(_ device: SavedSupervisorDevice) {
        editingDevice = device
        editName = device.name
        editBaseURL = device.normalizedBaseURL
    }

    func saveEditedDevice() {
        guard let editingDevice else { return }
        environment.settingsStore.updateSavedSupervisorDevice(
            id: editingDevice.id,
            name: editName,
            baseURL: editBaseURL
        )
        self.editingDevice = nil
        refreshSavedDevices()
    }

    func deleteSavedDevice(_ device: SavedSupervisorDevice) {
        environment.settingsStore.deleteSavedSupervisorDevice(id: device.id)
        refreshSavedDevices()
    }

    func refreshSavedDevices() {
        savedDevices = environment.settingsStore.readSavedSupervisorDevices()
    }

    private func runBusy(_ operation: () async throws -> Void) async {
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            try await operation()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

enum RelayAuthMode: String, CaseIterable, Identifiable {
    case signIn = "Sign in"
    case register = "Register"

    var id: String {
        rawValue
    }
}

struct ConnectionScreen: View {
    @StateObject private var model: ConnectionViewModel
    @State private var offlineDevice: RelayDeviceSummary?
    @State private var revokeDevice: RelayDeviceSummary?
    @State private var deleteDevice: SavedSupervisorDevice?
    @State private var expandedShareId: String?
    @State private var showingAddDevice = false
    @State private var showingCreateRelayDevice = false
    private let onBack: (() -> Void)?

    init(
        environment: AppEnvironment,
        onReady: @escaping (SupervisorConnectionConfig) -> Void,
        onOpenRelaySharedThread: @escaping (SupervisorConnectionConfig, RelaySessionShareSummary) -> Void = { _, _ in },
        onBack: (() -> Void)? = nil
    ) {
        self.onBack = onBack
        _model = StateObject(
            wrappedValue: ConnectionViewModel(
                environment: environment,
                onReady: onReady,
                onOpenRelaySharedThread: onOpenRelaySharedThread
            )
        )
    }

    var body: some View {
        Form {
            if model.route == .relayDevices {
                relayDeviceSection
            } else {
                statusSection
                savedDevicesSection
            }
        }
        .navigationTitle(navigationTitle)
        .edgeSwipeBack(action: handleBackGesture)
        .task(id: model.route) {
            guard model.route == .relayDevices else { return }
            if model.relayPortal == nil {
                await model.loadRelayPortal()
            }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                guard !Task.isCancelled, model.route == .relayDevices else { return }
                await model.loadRelayPortal(silent: true)
            }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    if model.route == .relayDevices {
                        model.createdDevice = nil
                        model.errorMessage = nil
                        showingCreateRelayDevice = true
                    } else {
                        model.beginAddingDevice()
                        showingAddDevice = true
                    }
                } label: {
                    Image(systemName: "plus")
                }
                .accessibilityLabel(model.route == .relayDevices ? "Create relay device" : "Add device")
            }
        }
        .sheet(isPresented: $showingAddDevice, onDismiss: {
            if model.route != .relayDevices {
                model.route = .modeSelect
            }
        }) {
            addDeviceSheet
        }
        .sheet(isPresented: $showingCreateRelayDevice) {
            createRelayDeviceSheet
        }
        .sheet(item: $model.editingDevice) { _ in
            editDeviceSheet
        }
        .onChange(of: model.route) { _, route in
            if route == .relayDevices {
                showingAddDevice = false
            }
        }
        .alert("Delete Device?", isPresented: deleteDeviceAlertPresented) {
            Button("Cancel", role: .cancel) {
                deleteDevice = nil
            }
            Button("Delete", role: .destructive) {
                if let deleteDevice {
                    model.deleteSavedDevice(deleteDevice)
                }
                deleteDevice = nil
            }
        } message: {
            Text(deleteDevice?.name ?? "This device")
        }
        .alert("Device is offline", isPresented: offlineDeviceAlertPresented) {
            Button("Cancel", role: .cancel) {}
            Button("Save anyway") {
                if let offlineDevice {
                    Task { await model.saveRelayDeviceWithoutHealthCheck(offlineDevice) }
                }
            }
        } message: {
            Text("Workspaces will not load until the private backend connects to the relay.")
        }
        .alert("Revoke Device?", isPresented: revokeDeviceAlertPresented) {
            Button("Cancel", role: .cancel) {
                revokeDevice = nil
            }
            Button("Revoke", role: .destructive) {
                guard let device = revokeDevice else { return }
                Task {
                    await model.revokeRelayDevice(device)
                    revokeDevice = nil
                }
            }
        } message: {
            Text(revokeDevice?.name ?? "This device")
        }
    }

    private var navigationTitle: String {
        switch model.route {
        case .modeSelect:
            "Connection"
        case .relayDevices:
            "Relay Devices"
        case .relayAuth:
            "Relay Account"
        case .serverAuth:
            "Server Login"
        }
    }

    private func handleBackGesture() {
        if model.route != .modeSelect {
            model.route = .modeSelect
        } else {
            onBack?()
        }
    }

    private var deleteDeviceAlertPresented: Binding<Bool> {
        Binding(
            get: { deleteDevice != nil },
            set: { presented in
                if !presented {
                    deleteDevice = nil
                }
            }
        )
    }

    private var offlineDeviceAlertPresented: Binding<Bool> {
        Binding(
            get: { offlineDevice != nil },
            set: { presented in
                if !presented {
                    offlineDevice = nil
                }
            }
        )
    }

    private var revokeDeviceAlertPresented: Binding<Bool> {
        Binding(
            get: { revokeDevice != nil },
            set: { presented in
                if !presented {
                    revokeDevice = nil
                }
            }
        )
    }

    private var statusSection: some View {
        Section {
            if model.busy {
                ProgressView("Working...")
            }
            if let message = model.statusMessage {
                Text(message).foregroundStyle(.secondary)
            }
            if let error = model.errorMessage {
                Text(error).foregroundStyle(.red)
            }
        }
    }

    private var savedDevicesSection: some View {
        Section("Connections") {
            if model.savedDevices.isEmpty {
                ContentUnavailableView("No Connections", systemImage: "rectangle.stack.badge.plus")
            }
            ForEach(model.savedDevices) { device in
                SavedDeviceRow(
                    device: device,
                    onConnect: {
                        Task { await model.connectSavedDevice(device) }
                    },
                    onEdit: {
                        model.editSavedDevice(device)
                    },
                    onDelete: {
                        deleteDevice = device
                    }
                )
            }
        }
    }

    private var modeSection: some View {
        Section("Add Device") {
            if model.mode == .local {
                TextField("Name", text: $model.deviceName)
            }
            Picker("Mode", selection: $model.mode) {
                ForEach(SupervisorConnectionMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            TextField("URL", text: $model.baseURL)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
            Button("Continue") {
                model.continueFromModeSelect()
            }
            .disabled(model.busy)
        }
    }

    private var serverAuthSection: some View {
        Section("Server Device") {
            TextField("Name", text: $model.deviceName)
            TextField("Username", text: $model.username)
                .textInputAutocapitalization(.never)
            SecureField("Password", text: $model.password)
            Button("Add Server") {
                Task { await model.signInServer() }
            }
            .disabled(model.busy || model.username.isEmpty || model.password.isEmpty)
        }
    }

    private var relayAuthSection: some View {
        Section("Relay Device Group") {
            TextField("Name", text: $model.deviceName)
            Picker("Action", selection: $model.relayAuthMode) {
                ForEach(RelayAuthMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            if model.relayAuthMode == .register {
                TextField("Email", text: $model.email)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
            }
            TextField("Identifier / Username", text: $model.username)
                .textInputAutocapitalization(.never)
            SecureField("Password", text: $model.password)
            Button(model.relayAuthMode == .signIn ? "Add Relay" : "Register Relay") {
                Task { await model.relayLoginOrRegister() }
            }
            .disabled(model.busy || model.username.isEmpty || model.password.isEmpty)
        }
    }

    @ViewBuilder
    private var relayDeviceSection: some View {
        Section("Relay Devices") {
            if let refreshedAt = model.lastRelayRefreshAt {
                HStack {
                    Spacer()
                    Text("Updated \(refreshedAt.formatted(date: .omitted, time: .standard))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if model.busy {
                ProgressView("Working...")
            }
            if let message = model.statusMessage {
                Text(message).foregroundStyle(.secondary)
            }
            if let error = model.errorMessage {
                Text(error).foregroundStyle(.red)
            }
            if model.relayPortal?.devices.isEmpty == true {
                ContentUnavailableView("No Devices", systemImage: "antenna.radiowaves.left.and.right")
            }
            ForEach(model.relayPortal?.devices ?? []) { device in
                RelayDeviceRow(
                    device: device,
                    selected: model.relayDeviceId == device.id,
                    onConnect: {
                        if device.online {
                            Task { await model.connectRelayDevice(device) }
                        } else {
                            offlineDevice = device
                        }
                    },
                    onRevoke: { revokeDevice = device }
                )
            }
        }
        Section("Shared with me") {
            let sharedSessions = model.relayPortal?.sharedWithMe ?? []
            if model.relayPortal == nil {
                ProgressView("Loading shared sessions...")
            } else if sharedSessions.isEmpty {
                ContentUnavailableView("No Shared Threads", systemImage: "person.2.slash")
            } else {
                ForEach(sharedSessions) { share in
                    RelaySharedSessionRow(
                        share: share,
                        mode: .incoming,
                        onOpen: { model.openSharedSession(share) }
                    )
                }
            }
        }
        Section("Shared by me") {
            let sharedSessions = model.relayPortal?.sharedByMe ?? []
            if model.relayPortal == nil {
                ProgressView("Loading shared sessions...")
            } else if sharedSessions.isEmpty {
                ContentUnavailableView("No Shared Threads", systemImage: "person.2")
            } else {
                ForEach(sharedSessions) { share in
                    RelaySharedSessionRow(
                        share: share,
                        mode: .outgoing,
                        expanded: expandedShareId == share.id,
                        onOpen: {},
                        onToggleAccess: {
                            expandedShareId = expandedShareId == share.id ? nil : share.id
                        }
                    )
                }
            }
        }
    }

    private var addDeviceSheet: some View {
        NavigationStack {
            Form {
                statusSection
                switch model.route {
                case .modeSelect:
                    modeSection
                case .serverAuth:
                    serverAuthSection
                case .relayAuth:
                    relayAuthSection
                case .relayDevices:
                    EmptyView()
                }
            }
            .navigationTitle("Add Device")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showingAddDevice = false
                        if model.route != .relayDevices {
                            model.route = .modeSelect
                        }
                    }
                }
            }
        }
    }

    private var createRelayDeviceSheet: some View {
        NavigationStack {
            Form {
                TextField("Device name", text: $model.newDeviceName)
                Button("Create") {
                    Task { await model.createRelayDevice() }
                }
                .disabled(model.busy || model.newDeviceName.isEmpty)
                if model.busy {
                    ProgressView("Working...")
                }
                if let error = model.errorMessage {
                    Text(error).foregroundStyle(.red)
                }
                if let created = model.createdDevice {
                    Section("Setup") {
                        Text("Token: \(created.token)")
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                        if let command = created.command {
                            Text(command)
                                .font(.footnote.monospaced())
                                .textSelection(.enabled)
                        }
                    }
                }
            }
            .navigationTitle("Create Device")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        showingCreateRelayDevice = false
                    }
                }
            }
        }
    }

    private var editDeviceSheet: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $model.editName)
                TextField("URL", text: $model.editBaseURL)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
            }
            .navigationTitle("Edit Device")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        model.editingDevice = nil
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        model.saveEditedDevice()
                    }
                    .disabled(model.editName.trimmedNonEmpty == nil || model.editBaseURL.trimmedNonEmpty == nil)
                }
            }
        }
    }
}

private struct SavedDeviceRow: View {
    let device: SavedSupervisorDevice
    let onConnect: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(device.name)
                        .font(.headline)
                    Text(device.normalizedBaseURL)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                Spacer()
                GraphBadge(text: device.modeLabel, tone: .neutral)
            }
            HStack {
                Button(device.mode == .relay ? "Open Devices" : "Connect", action: onConnect)
                Button(action: onEdit) {
                    Label("Edit", systemImage: "pencil")
                }
                Button("Delete", role: .destructive, action: onDelete)
            }
            .buttonStyle(.borderless)
        }
        .padding(.vertical, 4)
    }
}

private struct RelayDeviceRow: View {
    let device: RelayDeviceSummary
    let selected: Bool
    let onConnect: () -> Void
    let onRevoke: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(device.name).font(.headline)
                Spacer()
                GraphBadge(text: device.online ? "Online" : "Offline", tone: device.online ? .success : .warning)
            }
            Text(device.id).font(.caption.monospaced()).foregroundStyle(.secondary)
            HStack {
                Button(selected ? "Connected" : "Connect", action: onConnect)
                    .disabled(selected)
                Button("Revoke", role: .destructive, action: onRevoke)
            }
            .buttonStyle(.borderless)
        }
    }
}

private struct RelaySharedSessionRow: View {
    let share: RelaySessionShareSummary
    let mode: RelayShareRowMode
    var expanded = false
    let onOpen: () -> Void
    var onToggleAccess: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(share.label?.trimmedNonEmpty ?? share.threadId)
                    .font(.headline)
                    .lineLimit(1)
                Spacer()
                if mode == .incoming {
                    Button("Open", action: onOpen)
                        .buttonStyle(.borderedProminent)
                } else {
                    Button("Access", action: onToggleAccess)
                        .buttonStyle(.bordered)
                }
            }
            Text(mode == .incoming ? "\(share.ownerUsername) / \(share.deviceName)" : "To \(share.targetUsername) / \(share.deviceName)")
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            if mode == .outgoing {
                Text(shareAccessSummary(share))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack {
                GraphBadge(
                    text: share.threadAccess == "read" ? "View only" : "Collaborator",
                    tone: share.threadAccess == "read" ? .warning : .success
                )
                GraphBadge(text: workspaceAccessLabel(share.workspaceAccess), tone: .neutral)
            }
            if mode == .outgoing, expanded {
                ShareAccessHistory(events: share.accessEvents)
            }
        }
        .padding(.vertical, 4)
    }
}

private enum RelayShareRowMode {
    case incoming
    case outgoing
}

private struct ShareAccessHistory: View {
    let events: [RelaySessionShareAccessSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if events.isEmpty {
                Text("This shared thread has not been accessed yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(events) { event in
                    HStack {
                        Text(event.username)
                            .font(.caption.weight(.semibold))
                        Spacer()
                        Text(shortRelayTimestamp(event.accessedAt))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(8)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

private func shareAccessSummary(_ share: RelaySessionShareSummary) -> String {
    guard let accessedAt = share.lastAccessedAt?.trimmedNonEmpty else {
        return "Not accessed yet"
    }
    return "Last access: \(share.lastAccessedByUsername ?? "unknown") at \(shortRelayTimestamp(accessedAt))"
}

private func shortRelayTimestamp(_ value: String) -> String {
    value
        .replacingOccurrences(of: "T", with: " ")
        .replacingOccurrences(of: #"\.\d{3}Z$"#, with: " UTC", options: .regularExpression)
        .replacingOccurrences(of: #"Z$"#, with: " UTC", options: .regularExpression)
}

private func workspaceAccessLabel(_ access: String) -> String {
    switch access {
    case "write":
        "Workspace write"
    case "read":
        "Workspace read"
    default:
        "No workspace"
    }
}

private extension SupervisorConnectionConfig {
    func withAuthToken(_ token: String?) -> SupervisorConnectionConfig {
        SupervisorConnectionConfig(mode: mode, baseURL: baseURL, authToken: token, relayDeviceId: relayDeviceId)
    }
}
