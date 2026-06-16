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
    @Published var statusMessage: String?
    @Published var errorMessage: String?
    @Published var busy = false
    @Published var lastRelayRefreshAt: Date?

    private let environment: AppEnvironment
    private let onReady: (SupervisorConnectionConfig) -> Void

    init(environment: AppEnvironment, onReady: @escaping (SupervisorConnectionConfig) -> Void) {
        self.environment = environment
        self.onReady = onReady
        let saved = environment.settingsStore.readSupervisorConnection()
        mode = saved?.mode ?? .local
        baseURL = saved?.normalizedBaseURL ?? "http://127.0.0.1:8787"
        route = .modeSelect
        relayDeviceId = saved?.relayDeviceId ?? ""
        authToken = saved?.authToken ?? ""
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

    func connectDirect() async {
        await runBusy {
            let config = SupervisorConnectionConfig(mode: mode, baseURL: baseURL)
            let client = environment.apiClientFactory(config)
            let check = try await client.checkConnection()
            if check.authRequired, !check.authenticated {
                route = .serverAuth
                statusMessage = "Login required."
                return
            }
            try environment.settingsStore.writeSupervisorConnection(config)
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
            route = .relayDevices
            await loadRelayPortal()
        }
    }

    func loadRelayPortal() async {
        guard !authToken.isEmpty else {
            errorMessage = "Log in to the relay before loading devices."
            return
        }
        await runBusy {
            let config = SupervisorConnectionConfig(mode: .relay, baseURL: baseURL, authToken: authToken)
            relayPortal = try await environment.apiClientFactory(config).fetchRelayPortal()
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
            relayDeviceId = device.id
            statusMessage = "Device saved. Workspaces will load when the backend connects."
            onReady(config)
        }
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

    init(environment: AppEnvironment, onReady: @escaping (SupervisorConnectionConfig) -> Void) {
        _model = StateObject(wrappedValue: ConnectionViewModel(environment: environment, onReady: onReady))
    }

    var body: some View {
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
                relayDeviceSection
            }
        }
        .navigationTitle("Remote Codex")
        .toolbar {
            if model.route != .modeSelect {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Back") {
                        model.route = .modeSelect
                    }
                }
            }
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
        .task(id: model.route) {
            guard model.route == .relayDevices else { return }
            while model.route == .relayDevices {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled, !model.busy else { continue }
                await model.loadRelayPortal()
            }
        }
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

    private var modeSection: some View {
        Section("Connect") {
            Picker("Mode", selection: $model.mode) {
                ForEach(SupervisorConnectionMode.allCases) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            TextField("URL", text: $model.baseURL)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
            Button("Next") {
                model.continueFromModeSelect()
            }
            .disabled(model.busy)
        }
    }

    private var serverAuthSection: some View {
        Section("Server Login") {
            TextField("Username", text: $model.username)
                .textInputAutocapitalization(.never)
            SecureField("Password", text: $model.password)
            Button("Sign in") {
                Task { await model.signInServer() }
            }
            .disabled(model.busy || model.username.isEmpty || model.password.isEmpty)
        }
    }

    private var relayAuthSection: some View {
        Section("Relay Account") {
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
            Button(model.relayAuthMode.rawValue) {
                Task { await model.relayLoginOrRegister() }
            }
            .disabled(model.busy || model.username.isEmpty || model.password.isEmpty)
        }
    }

    private var relayDeviceSection: some View {
        Group {
            Section("Relay Devices") {
                Button("Refresh") {
                    Task { await model.loadRelayPortal() }
                }
                if let refreshedAt = model.lastRelayRefreshAt {
                    Text("Last refreshed \(refreshedAt.formatted(date: .omitted, time: .standard))")
                        .font(.caption)
                        .foregroundStyle(.secondary)
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
                        onRevoke: { Task { await model.revokeRelayDevice(device) } }
                    )
                }
            }
            Section("Create Device") {
                TextField("Device name", text: $model.newDeviceName)
                Button("Create device") {
                    Task { await model.createRelayDevice() }
                }
                .disabled(model.busy || model.newDeviceName.isEmpty)
                if let created = model.createdDevice {
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

private extension SupervisorConnectionConfig {
    func withAuthToken(_ token: String?) -> SupervisorConnectionConfig {
        SupervisorConnectionConfig(mode: mode, baseURL: baseURL, authToken: token, relayDeviceId: relayDeviceId)
    }
}
