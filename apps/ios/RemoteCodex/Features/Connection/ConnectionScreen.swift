import SwiftUI
import UIKit

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
    private let onReady: (SupervisorConnectionConfig, ConnectionSetupRoute) -> Void
    private let onOpenRelaySharedThread: (SupervisorConnectionConfig, RelaySessionShareSummary) -> Void

    init(
        environment: AppEnvironment,
        initialRoute: ConnectionSetupRoute? = nil,
        onReady: @escaping (SupervisorConnectionConfig, ConnectionSetupRoute) -> Void,
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
        if let initialRoute {
            route = initialRoute
        } else if saved?.mode == .relay, !savedAuthToken.isEmpty, savedRelayDeviceId.isEmpty {
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
            onReady(config, route)
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
            onReady(config, route)
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

    func updateRelayShare(
        _ share: RelaySessionShareSummary,
        label: String?,
        threadAccess: String,
        workspaceAccess: String
    ) async {
        await runBusy {
            let config = SupervisorConnectionConfig(mode: .relay, baseURL: baseURL, authToken: authToken)
            _ = try await environment.apiClientFactory(config).updateRelayShare(
                shareId: share.id,
                label: label,
                threadAccess: threadAccess,
                workspaceAccess: share.workspaceId == nil ? "none" : workspaceAccess,
                workspaceId: share.workspaceId,
                expiresAt: share.expiresAt
            )
            relayPortal = try await environment.apiClientFactory(config).fetchRelayPortal()
            lastRelayRefreshAt = Date()
        }
    }

    func revokeRelayShare(_ share: RelaySessionShareSummary) async {
        await runBusy {
            let config = SupervisorConnectionConfig(mode: .relay, baseURL: baseURL, authToken: authToken)
            _ = try await environment.apiClientFactory(config).revokeRelayShare(shareId: share.id)
            relayPortal = try await environment.apiClientFactory(config).fetchRelayPortal()
            lastRelayRefreshAt = Date()
        }
    }

    func copyRelayDeviceSetup(_ device: RelayDeviceSummary) {
        guard let token = device.token?.trimmedNonEmpty else {
            errorMessage = "This device token is not available. Create a new device token to copy setup."
            statusMessage = nil
            return
        }
        UIPasteboard.general.string = relaySupervisorCommand(relayBaseURL: baseURL, token: token)
        errorMessage = nil
        statusMessage = "Copied setup command for \(device.name)."
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
            onReady(config, route)
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
            onReady(config, route)
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
                onReady(config, route)
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
    let environment: AppEnvironment
    let onThemeModeSelected: (ThemeMode) -> Void
    @State private var offlineDevice: RelayDeviceSummary?
    @State private var revokeDevice: RelayDeviceSummary?
    @State private var editingShare: RelaySessionShareSummary?
    @State private var revokeShare: RelaySessionShareSummary?
    @State private var deleteDevice: SavedSupervisorDevice?
    @State private var expandedShareId: String?
    @State private var showingAddDevice = false
    @State private var showingCreateRelayDevice = false
    @State private var showingSettings = false
    @State private var showingAccounts = false
    private let onBack: (() -> Void)?

    init(
        environment: AppEnvironment,
        initialRoute: ConnectionSetupRoute? = nil,
        onReady: @escaping (SupervisorConnectionConfig, ConnectionSetupRoute) -> Void,
        onOpenRelaySharedThread: @escaping (SupervisorConnectionConfig, RelaySessionShareSummary) -> Void = { _, _ in },
        onThemeModeSelected: @escaping (ThemeMode) -> Void = { _ in },
        onBack: (() -> Void)? = nil
    ) {
        self.environment = environment
        self.onThemeModeSelected = onThemeModeSelected
        self.onBack = onBack
        _model = StateObject(
            wrappedValue: ConnectionViewModel(
                environment: environment,
                initialRoute: initialRoute,
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
        .navigationBarTitleDisplayMode(.inline)
        .remoteCodexScreenSurface()
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
                connectionMenu
            }
        }
        .sheet(isPresented: $showingSettings) {
            AppSettingsSheet(
                environment: environment,
                connection: relayAccountConnection,
                onThemeModeSelected: onThemeModeSelected
            )
        }
        .sheet(isPresented: $showingAccounts) {
            RelayAccountSettingsSheet(
                environment: environment,
                connection: relayAccountConnection
            )
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
        .sheet(item: $editingShare) { share in
            RelaySharePermissionsSheet(
                busy: model.busy,
                share: share,
                onCancel: { editingShare = nil },
                onSave: { label, threadAccess, workspaceAccess in
                    Task {
                        await model.updateRelayShare(
                            share,
                            label: label,
                            threadAccess: threadAccess,
                            workspaceAccess: workspaceAccess
                        )
                        editingShare = nil
                    }
                }
            )
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
        .alert("Revoke Shared Thread?", isPresented: revokeShareAlertPresented) {
            Button("Cancel", role: .cancel) {
                revokeShare = nil
            }
            Button("Revoke", role: .destructive) {
                guard let share = revokeShare else { return }
                Task {
                    await model.revokeRelayShare(share)
                    revokeShare = nil
                }
            }
        } message: {
            Text("Remove access to \(revokeShare.map(shareTitle) ?? "this thread").")
        }
    }

    private var navigationTitle: String {
        switch model.route {
        case .modeSelect:
            "Connection"
        case .relayDevices:
            "Relay Portal"
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

    private var connectionMenu: some View {
        FloatingActionMenu(accessibilityIdentifier: "connection-action-menu", appliesFloatingPadding: false) {
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

    private var relayAccountConnection: SupervisorConnectionConfig {
        SupervisorConnectionConfig(
            mode: .relay,
            baseURL: model.baseURL,
            authToken: model.authToken,
            relayDeviceId: model.relayDeviceId
        )
    }

    private func showAddAction() {
        if model.route == .relayDevices {
            model.createdDevice = nil
            model.errorMessage = nil
            showingCreateRelayDevice = true
        } else {
            model.beginAddingDevice()
            showingAddDevice = true
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

    private var revokeShareAlertPresented: Binding<Bool> {
        Binding(
            get: { revokeShare != nil },
            set: { presented in
                if !presented {
                    revokeShare = nil
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
                Text(message).remoteCodexStatusText()
            }
            if let error = model.errorMessage {
                Text(error).remoteCodexErrorText()
            }
        }
        .remoteCodexListRow()
    }

    private var savedDevicesSection: some View {
        Section {
            if model.savedDevices.isEmpty {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Cards are stored on this iOS device and can be connected, edited, or deleted independently.")
                        .font(.caption)
                        .remoteCodexStatusText()
                    Divider()
                    VStack(spacing: 10) {
                        Image(systemName: "rectangle.stack.badge.plus")
                            .font(.system(size: 38, weight: .semibold))
                            .foregroundStyle(RemoteCodexTheme.foregroundMuted)
                        Text("No Connections")
                            .font(.headline)
                            .foregroundStyle(RemoteCodexTheme.foreground)
                        Text("No saved connections yet. Tap + to add Local, Server, or Relay.")
                            .font(.subheadline)
                            .multilineTextAlignment(.center)
                            .remoteCodexStatusText()
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 18)
                }
            } else {
                Text("Cards are stored on this iOS device and can be connected, edited, or deleted independently.")
                    .font(.caption)
                    .remoteCodexStatusText()
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
                .contentShape(Rectangle())
                .onTapGesture {
                    Task { await model.connectSavedDevice(device) }
                }
            }
        } header: {
            HStack {
                Text("Connections")
                Spacer()
                BareAddButton(accessibilityLabel: "Add device", action: showAddAction)
            }
        }
        .remoteCodexListRow()
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
        .remoteCodexListRow()
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
        .remoteCodexListRow()
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
        .remoteCodexListRow()
    }

    @ViewBuilder
    private var relayDeviceSection: some View {
        Section {
            if model.busy {
                ProgressView("Working...")
            }
            if let message = model.statusMessage {
                Text(message).remoteCodexStatusText()
            }
            if let error = model.errorMessage {
                Text(error).remoteCodexErrorText()
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
                    onCopySetup: {
                        model.copyRelayDeviceSetup(device)
                    },
                    onRevoke: { revokeDevice = device }
                )
                .contentShape(Rectangle())
                .onTapGesture {
                    if device.online {
                        Task { await model.connectRelayDevice(device) }
                    } else {
                        offlineDevice = device
                    }
                }
            }
        } header: {
            HStack {
                Text("Relay Devices")
                Spacer()
                BareAddButton(accessibilityLabel: "Create relay device", action: showAddAction)
            }
        }
        .remoteCodexListRow()
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
        .remoteCodexListRow()
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
                        onOpen: { model.openSharedSession(share) },
                        onEdit: { editingShare = share },
                        onRevoke: { revokeShare = share },
                        onToggleAccess: {
                            expandedShareId = expandedShareId == share.id ? nil : share.id
                        }
                    )
                }
            }
        }
        .remoteCodexListRow()
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
            .remoteCodexScreenSurface()
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
                    Text(error).remoteCodexErrorText()
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
            .remoteCodexScreenSurface()
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
            .remoteCodexScreenSurface()
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
                        .remoteCodexStatusText()
                }
                Spacer()
                GraphBadge(text: device.modeLabel, tone: .neutral)
            }
            HStack {
                if device.mode != .relay {
                    Button("Connect", action: onConnect)
                }
                Button("Edit", action: onEdit)
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
    let onCopySetup: () -> Void
    let onRevoke: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(device.name).font(.headline)
                Spacer()
                GraphBadge(text: device.online ? "Online" : "Offline", tone: device.online ? .success : .warning)
            }
            Text(relayDeviceStatusLine(device))
                .font(.caption)
                .remoteCodexStatusText()
            HStack {
                Button("Copy Setup", action: onCopySetup)
                    .disabled(device.token?.trimmedNonEmpty == nil)
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
    var onEdit: () -> Void = {}
    var onRevoke: () -> Void = {}
    var onToggleAccess: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 12) {
                Text(shareTitle(share))
                    .font(.headline)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if mode == .incoming {
                    Button("Open", action: onOpen)
                        .buttonStyle(RemoteCodexPrimaryButtonStyle())
                        .fixedSize(horizontal: true, vertical: false)
                } else {
                    HStack(spacing: 8) {
                        Button("Open", action: onOpen)
                            .buttonStyle(RemoteCodexPrimaryButtonStyle())
                            .fixedSize(horizontal: true, vertical: false)
                        Menu {
                            Button("Permissions", action: onEdit)
                            Button("Access history", action: onToggleAccess)
                            Button("Revoke", role: .destructive, action: onRevoke)
                        } label: {
                            Text("Manage")
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                        }
                        .buttonStyle(RemoteCodexSecondaryButtonStyle())
                        .fixedSize(horizontal: true, vertical: false)
                    }
                    .fixedSize(horizontal: true, vertical: false)
                }
            }
            VStack(alignment: .leading, spacing: 3) {
                Text("Workspace: \(share.workspaceLabel?.trimmedNonEmpty ?? "Workspace unavailable")")
                Text("Thread: \(shareTitle(share))")
                Text(mode == .incoming ? "From \(share.ownerUsername)" : "To \(share.targetUsername)")
                Text("Device: \(share.deviceName)")
            }
                .font(.caption)
                .remoteCodexStatusText()
                .lineLimit(1)
            if mode == .outgoing {
                Text(shareAccessSummary(share))
                    .font(.caption)
                    .remoteCodexStatusText()
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

private struct RelaySharePermissionsSheet: View {
    let busy: Bool
    let share: RelaySessionShareSummary
    let onCancel: () -> Void
    let onSave: (String?, String, String) -> Void
    @State private var label: String
    @State private var threadAccess: String
    @State private var workspaceAccess: String

    init(
        busy: Bool,
        share: RelaySessionShareSummary,
        onCancel: @escaping () -> Void,
        onSave: @escaping (String?, String, String) -> Void
    ) {
        self.busy = busy
        self.share = share
        self.onCancel = onCancel
        self.onSave = onSave
        _label = State(initialValue: share.label ?? "")
        _threadAccess = State(initialValue: share.threadAccess)
        _workspaceAccess = State(initialValue: share.workspaceAccess)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("To \(share.targetUsername)")
                    Text("Thread: \(shareTitle(share))")
                    Text("Device: \(share.deviceName)")
                }
                Section("Label") {
                    TextField("Thread label", text: $label)
                }
                Section("Thread access") {
                    Picker("Thread access", selection: $threadAccess) {
                        Text("View only").tag("read")
                        Text("Collaborator").tag("control")
                    }
                    .pickerStyle(.segmented)
                }
                Section("Workspace access") {
                    Picker("Workspace access", selection: $workspaceAccess) {
                        Text("None").tag("none")
                        Text("Read").tag("read")
                        Text("Write").tag("write")
                    }
                        .disabled(share.workspaceId == nil)
                        if share.workspaceId == nil {
                            Text("This share was created without a workspace scope.")
                                .font(.caption)
                                .remoteCodexStatusText()
                        }
                    }
            }
            .navigationTitle("Permissions")
            .remoteCodexScreenSurface()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                        .disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(label.trimmedNonEmpty, threadAccess, share.workspaceId == nil ? "none" : workspaceAccess)
                    }
                    .disabled(busy)
                }
            }
        }
    }
}

private enum RelayShareRowMode {
    case incoming
    case outgoing
}

private func shareTitle(_ share: RelaySessionShareSummary) -> String {
    guard let threadTitle = share.threadTitle?.trimmedNonEmpty else {
        return "Thread unavailable"
    }
    if let label = share.label?.trimmedNonEmpty, label == threadTitle {
        return "Thread unavailable"
    }
    return threadTitle
}

private func relayDeviceStatusLine(_ device: RelayDeviceSummary) -> String {
    let timestamp = device.lastHeartbeatAt ?? device.lastSeenAt ?? device.createdAt
    if device.online {
        return "Last heartbeat: \(formatRelayTimestamp(timestamp))"
    }
    return "Last online: \(formatRelayTimestamp(timestamp))"
}

private func formatRelayTimestamp(_ value: String?) -> String {
    guard let value = value?.trimmedNonEmpty else { return "never" }
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    let date = fractional.date(from: value) ?? plain.date(from: value)
    guard let date else {
        return value
            .replacingOccurrences(of: "T", with: " ")
            .replacingOccurrences(of: "Z", with: " UTC")
    }
    return date.formatted(date: .abbreviated, time: .shortened)
}

private func relaySupervisorCommand(relayBaseURL: String, token: String) -> String {
    [
        "REMOTE_CODEX_RELAY_SERVER_URL=\(shellQuote(normalizedRelayWebSocketURL(relayBaseURL))) \\",
        "REMOTE_CODEX_RELAY_AGENT_TOKEN=\(shellQuote(token)) \\",
        "REMOTE_CODEX_RELAY_SUPERVISOR_PORT=45679 \\",
        "remote-codex relay-supervisor"
    ].joined(separator: "\n")
}

private func normalizedRelayWebSocketURL(_ baseURL: String) -> String {
    let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("wss://") || trimmed.hasPrefix("ws://") {
        return trimmed
    }
    if trimmed.hasPrefix("https://") {
        return "wss://" + String(trimmed.dropFirst("https://".count))
    }
    if trimmed.hasPrefix("http://") {
        return "ws://" + String(trimmed.dropFirst("http://".count))
    }
    return "wss://\(trimmed)"
}

private func shellQuote(_ value: String) -> String {
    if value.range(of: #"^[A-Za-z0-9_./:=@%+-]+$"#, options: .regularExpression) != nil {
        return value
    }
    return "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
}

private struct ShareAccessHistory: View {
    let events: [RelaySessionShareAccessSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if events.isEmpty {
                Text("This shared thread has not been accessed yet.")
                    .font(.caption)
                    .remoteCodexStatusText()
            } else {
                ForEach(events) { event in
                    HStack {
                        Text(event.username)
                            .font(.caption.weight(.semibold))
                        Spacer()
                        Text(shortRelayTimestamp(event.accessedAt))
                            .font(.caption)
                            .remoteCodexStatusText()
                    }
                }
            }
        }
        .padding(8)
        .background(RemoteCodexTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: RemoteCodexTheme.panelRadius))
        .overlay {
            RoundedRectangle(cornerRadius: RemoteCodexTheme.panelRadius)
                .stroke(RemoteCodexTheme.border, lineWidth: 1)
        }
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
