import SwiftUI

struct RootView: View {
    let environment: AppEnvironment
    @State private var route: AppRoute
    @State private var connection: SupervisorConnectionConfig?
    @State private var connectionInitialRoute: ConnectionSetupRoute?
    @State private var homeBackConnectionRoute: ConnectionSetupRoute?
    @State private var themeMode: ThemeMode

    init(environment: AppEnvironment) {
        self.environment = environment
        let savedConnection = environment.settingsStore.readSupervisorConnection()
        let readyConnection = Self.readyConnection(savedConnection)
        let savedRoute = environment.settingsStore.readLastRoute(for: readyConnection)
        let initialHomeBackRoute = Self.initialHomeBackRoute(for: readyConnection)
        _connection = State(initialValue: readyConnection)
        _route = State(initialValue: readyConnection == nil ? .connection : savedRoute.appRoute)
        _homeBackConnectionRoute = State(initialValue: initialHomeBackRoute)
        _connectionInitialRoute = State(initialValue: initialHomeBackRoute)
        _themeMode = State(initialValue: environment.settingsStore.readThemeMode())
    }

    var body: some View {
        NavigationStack {
            switch route {
            case .connection:
                ConnectionScreen(
                    environment: environment,
                    initialRoute: connectionInitialRoute,
                    onReady: { config, sourceRoute in
                        connection = config
                        connectionInitialRoute = sourceRoute == .relayDevices ? .relayDevices : .modeSelect
                        homeBackConnectionRoute = connectionInitialRoute
                        route = .home
                    },
                    onOpenRelaySharedThread: openRelaySharedThread,
                    onThemeModeSelected: { mode in
                        themeMode = mode
                    }
                )
            case .home:
                if let connection {
                    HomeScreen(
                        environment: environment,
                        connection: connection,
                        onOpenWorkspace: { workspaceId in
                            environment.settingsStore.writeLastRoute(.workspaceDetail(workspaceId), for: connection)
                            route = .workspaceDetail(workspaceId)
                        },
                        onOpenThread: { threadId in
                            environment.settingsStore.writeLastRoute(.threadDetail(threadId), for: connection)
                            route = .threadDetail(threadId)
                        },
                        onChangeConnection: { returnToConnectionSetup(initialRoute: .modeSelect) },
                        onBack: returnFromWorkspaceHome,
                        onThemeModeSelected: { mode in
                            themeMode = mode
                        }
                    )
                } else {
                    ConnectionScreen(
                        environment: environment,
                        initialRoute: connectionInitialRoute,
                        onReady: { config, sourceRoute in
                            connection = config
                            connectionInitialRoute = sourceRoute == .relayDevices ? .relayDevices : .modeSelect
                            homeBackConnectionRoute = connectionInitialRoute
                            route = .home
                        },
                        onOpenRelaySharedThread: openRelaySharedThread,
                        onThemeModeSelected: { mode in
                            themeMode = mode
                        }
                    )
                }
            case let .workspaceDetail(workspaceId):
                if let connection {
                    WorkspaceDetailScreen(
                        environment: environment,
                        connection: connection,
                        workspaceId: workspaceId,
                        onOpenThread: { threadId in
                            environment.settingsStore.writeLastRoute(.threadDetail(threadId), for: connection)
                            route = .threadDetail(threadId)
                        },
                        onChangeConnection: { returnToConnectionSetup(initialRoute: .modeSelect) },
                        onBack: {
                            environment.settingsStore.writeLastRoute(.home, for: connection)
                            route = .home
                        },
                        onThemeModeSelected: { mode in
                            themeMode = mode
                        }
                    )
                } else {
                    PlaceholderScreen(title: "Workspace", subtitle: workspaceId)
                }
            case let .threadDetail(threadId):
                if let connection {
                    ThreadDetailWebViewScreen(
                        environment: environment,
                        connection: connection,
                        threadId: threadId,
                        themeMode: themeMode,
                        fixtureMode: useThreadWebViewFixture,
                        uiTestInitialSettings: threadWebViewUITestInitialSettings,
                        uiTestAutoResolvePendingRequests: threadWebViewUITestAutoResolvePendingRequests,
                        uiTestClickPendingRequestControls: threadWebViewUITestClickPendingRequestControls,
                        uiTestClickVisibleSettingsControls: threadWebViewUITestClickVisibleSettingsControls,
                        uiTestForkMode: threadWebViewUITestForkMode,
                        uiTestAutoExportTranscript: threadWebViewUITestAutoExportTranscript,
                        uiTestAutoExportTranscriptFormat: threadWebViewUITestAutoExportTranscriptFormat,
                        uiTestClickVisibleExportControls: threadWebViewUITestClickVisibleExportControls,
                        uiTestClickVisibleShareControls: threadWebViewUITestClickVisibleShareControls,
                        uiTestFocusWorkspacePath: threadWebViewUITestFocusWorkspacePath,
                        uiTestAutoLoadMoreWorkspacePreview: threadWebViewUITestAutoLoadMoreWorkspacePreview,
                        uiTestAutoWorkspaceFileActions: threadWebViewUITestAutoWorkspaceFileActions,
                        uiTestClickVisibleWorkspaceControls: threadWebViewUITestClickVisibleWorkspaceControls,
                        uiTestAutoLoadHistoryDetail: threadWebViewUITestAutoLoadHistoryDetail,
                        uiTestClickVisibleHistoryDetails: threadWebViewUITestClickVisibleHistoryDetails,
                        uiTestAutoLoadOlderHistory: threadWebViewUITestAutoLoadOlderHistory,
                        uiTestAutoVerifyImageAsset: threadWebViewUITestAutoVerifyImageAsset,
                        uiTestAutoVerifyTimelineContent: threadWebViewUITestAutoVerifyTimelineContent,
                        uiTestAutoVerifySlashToolbox: threadWebViewUITestAutoVerifySlashToolbox,
                        uiTestDisableRefreshFallback: threadWebViewUITestDisableRefreshFallback,
                        uiTestAutoRenameTitle: threadWebViewUITestAutoRenameTitle,
                        uiTestAutoDeleteThread: threadWebViewUITestAutoDeleteThread,
                        uiTestAutoAttachmentPickerResult: threadWebViewUITestAutoAttachmentPickerResult,
                        onClose: {
                            environment.settingsStore.writeLastRoute(.home, for: connection)
                            route = .home
                        },
                        onOpenThread: { nextThreadId in
                            environment.settingsStore.writeLastRoute(.threadDetail(nextThreadId), for: connection)
                            route = .threadDetail(nextThreadId)
                        },
                        onOpenWorkspace: { workspaceId in
                            environment.settingsStore.writeLastRoute(.workspaceDetail(workspaceId), for: connection)
                            route = .workspaceDetail(workspaceId)
                        },
                        onChangeConnection: { returnToConnectionSetup(initialRoute: .modeSelect) },
                        onThemeModeSelected: { mode in
                            themeMode = mode
                            environment.settingsStore.writeThemeMode(mode)
                        },
                        onBack: { workspaceId in
                            if let workspaceId = workspaceId?.trimmedNonEmpty {
                                environment.settingsStore.writeLastRoute(.workspaceDetail(workspaceId), for: connection)
                                route = .workspaceDetail(workspaceId)
                            } else {
                                environment.settingsStore.writeLastRoute(.home, for: connection)
                                route = .home
                            }
                        }
                    )
                } else {
                    PlaceholderScreen(title: "Thread", subtitle: threadId)
                }
            }
        }
        .preferredColorScheme(themeMode.colorScheme)
        .tint(RemoteCodexTheme.accent)
        .background(RemoteCodexTheme.pageBackground)
    }

    private func returnToConnectionSetup(initialRoute: ConnectionSetupRoute) {
        connectionInitialRoute = initialRoute
        route = .connection
    }

    private func returnFromWorkspaceHome() {
        connectionInitialRoute = homeBackConnectionRoute ?? .modeSelect
        route = .connection
    }

    private func openRelaySharedThread(config: SupervisorConnectionConfig, share: RelaySessionShareSummary) {
        connection = config
        connectionInitialRoute = .relayDevices
        homeBackConnectionRoute = .relayDevices
        environment.settingsStore.writeLastRoute(.threadDetail(share.threadId), for: config)
        route = .threadDetail(share.threadId)
    }

    private static func readyConnection(_ connection: SupervisorConnectionConfig?) -> SupervisorConnectionConfig? {
        guard let connection else { return nil }
        if connection.mode == .relay, connection.relayDeviceId?.trimmedNonEmpty == nil {
            return nil
        }
        return connection
    }

    private static func initialHomeBackRoute(for connection: SupervisorConnectionConfig?) -> ConnectionSetupRoute? {
        guard connection?.mode == .relay, connection?.relayDeviceId?.trimmedNonEmpty != nil else {
            return nil
        }
        return .relayDevices
    }

    private var useThreadWebViewFixture: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-fixture")
    }

    private var threadWebViewUITestInitialSettings: ThreadDetailWebInitialSettings? {
        let environment = ProcessInfo.processInfo.environment
        let shouldUseHighReasoning = ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-reasoning-high")
            || environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_REASONING"] == "high"
        return shouldUseHighReasoning
            ? ThreadDetailWebInitialSettings(reasoningEffort: "high")
            : nil
    }

    private var threadWebViewUITestAutoResolvePendingRequests: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-resolve-pending")
    }

    private var threadWebViewUITestClickPendingRequestControls: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-click-pending-controls")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_CLICK_PENDING_CONTROLS"] == "1"
    }

    private var threadWebViewUITestClickVisibleSettingsControls: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-click-visible-settings")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_CLICK_VISIBLE_SETTINGS"] == "1"
    }

    private var threadWebViewUITestForkMode: String? {
        let processInfo = ProcessInfo.processInfo
        if processInfo.arguments.contains("--ui-test-ios-thread-webview-fork-selected")
            || processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_FORK_MODE"] == "selected"
        {
            return "selected"
        }
        if processInfo.arguments.contains("--ui-test-ios-thread-webview-fork-latest")
            || processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_FORK_MODE"] == "latest"
        {
            return "latest"
        }
        return nil
    }

    private var threadWebViewUITestAutoExportTranscript: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-export")
            || threadWebViewUITestAutoExportTranscriptFormat != nil
    }

    private var threadWebViewUITestAutoExportTranscriptFormat: String? {
        let processInfo = ProcessInfo.processInfo
        let shouldExportHTML = processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-export-html")
            || processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_EXPORT_FORMAT"] == "html"
        return shouldExportHTML ? "html" : nil
    }

    private var threadWebViewUITestClickVisibleExportControls: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-click-visible-export")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_CLICK_VISIBLE_EXPORT"] == "1"
    }

    private var threadWebViewUITestClickVisibleShareControls: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-click-visible-share")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_CLICK_VISIBLE_SHARE"] == "1"
    }

    private var threadWebViewUITestFocusWorkspacePath: String? {
        ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_WORKSPACE_FOCUS_PATH"]?.trimmedNonEmpty
    }

    private var threadWebViewUITestAutoLoadMoreWorkspacePreview: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-load-more-workspace-preview")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_LOAD_MORE_WORKSPACE_PREVIEW"] == "1"
    }

    private var threadWebViewUITestAutoWorkspaceFileActions: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-workspace-file-actions")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_WORKSPACE_FILE_ACTIONS"] == "1"
    }

    private var threadWebViewUITestClickVisibleWorkspaceControls: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-click-visible-workspace-controls")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_CLICK_VISIBLE_WORKSPACE_CONTROLS"] == "1"
    }

    private var threadWebViewUITestAutoLoadHistoryDetail: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-history-detail")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_HISTORY_DETAIL"] == "1"
    }

    private var threadWebViewUITestClickVisibleHistoryDetails: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-click-visible-history-details")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_CLICK_VISIBLE_HISTORY_DETAILS"] == "1"
    }

    private var threadWebViewUITestAutoLoadOlderHistory: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-load-older-history")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_LOAD_OLDER_HISTORY"] == "1"
    }

    private var threadWebViewUITestAutoVerifyImageAsset: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-image-asset")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_IMAGE_ASSET"] == "1"
    }

    private var threadWebViewUITestAutoVerifyTimelineContent: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-verify-timeline")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_VERIFY_TIMELINE"] == "1"
    }

    private var threadWebViewUITestAutoVerifySlashToolbox: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-verify-slash-toolbox")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_VERIFY_SLASH_TOOLBOX"] == "1"
    }

    private var threadWebViewUITestDisableRefreshFallback: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-disable-refresh-fallback")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_DISABLE_REFRESH_FALLBACK"] == "1"
    }

    private var threadWebViewUITestAutoRenameTitle: String? {
        ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_RENAME_TITLE"]?.trimmedNonEmpty
    }

    private var threadWebViewUITestAutoDeleteThread: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-delete-thread")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_DELETE_THREAD"] == "1"
    }

    private var threadWebViewUITestAutoAttachmentPickerResult: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-test-ios-thread-webview-auto-attachment-picker")
            || ProcessInfo.processInfo.environment["REMOTE_CODEX_IOS_E2E_WEBVIEW_AUTO_ATTACHMENT_PICKER"] == "1"
    }
}

extension View {
    func edgeSwipeBack(action: @escaping () -> Void) -> some View {
        simultaneousGesture(
            DragGesture(minimumDistance: 28, coordinateSpace: .local)
                .onEnded { value in
                    guard value.startLocation.x <= 32 else { return }
                    guard value.translation.width >= 80 else { return }
                    guard abs(value.translation.height) <= 80 else { return }
                    action()
                }
        )
        .accessibilityAction(.escape, action)
    }
}

private extension SavedAppRoute {
    var appRoute: AppRoute {
        switch self {
        case .home:
            .home
        case let .workspaceDetail(workspaceId):
            .workspaceDetail(workspaceId)
        case let .threadDetail(threadId):
            .threadDetail(threadId)
        }
    }
}

private extension ThemeMode {
    var colorScheme: ColorScheme? {
        switch self {
        case .system:
            nil
        case .light:
            .light
        case .dark:
            .dark
        }
    }
}

struct FloatingActionMenu<Content: View>: View {
    let accessibilityIdentifier: String
    let appliesFloatingPadding: Bool
    @ViewBuilder var content: () -> Content
    @State private var isPresented = false

    init(
        accessibilityIdentifier: String = "floating-action-menu",
        appliesFloatingPadding: Bool = true,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.accessibilityIdentifier = accessibilityIdentifier
        self.appliesFloatingPadding = appliesFloatingPadding
        self.content = content
    }

    var body: some View {
        VerticalEllipsisMenuIcon()
            .onTapGesture {
                isPresented = true
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Menu")
            .accessibilityAddTraits(.isButton)
        .background(Color.clear)
        .accessibilityIdentifier(accessibilityIdentifier)
        .padding(.top, appliesFloatingPadding ? 8 : 0)
        .padding(.trailing, appliesFloatingPadding ? 12 : 0)
        .confirmationDialog("", isPresented: $isPresented, titleVisibility: .hidden) {
            content()
        }
    }
}

struct BareIconButton: View {
    let systemImage: String
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 24, weight: .semibold))
            .foregroundStyle(RemoteCodexTheme.foreground)
            .frame(width: 44, height: 44)
            .contentShape(Rectangle())
            .onTapGesture(perform: action)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityAddTraits(.isButton)
    }
}

struct BareAddButton: View {
    let accessibilityLabel: String
    let action: () -> Void

    var body: some View {
        BareIconButton(
            systemImage: "plus",
            accessibilityLabel: accessibilityLabel,
            action: action
        )
    }
}

private struct VerticalEllipsisMenuIcon: View {
    var body: some View {
        VStack(spacing: 4) {
            ForEach(0..<3, id: \.self) { _ in
                Circle()
                    .fill(RemoteCodexTheme.foreground)
                    .frame(width: 5, height: 5)
            }
        }
        .frame(width: 44, height: 44)
        .background(Color.clear)
        .contentShape(Rectangle())
    }
}

struct AppSettingsSheet: View {
    let onThemeModeSelected: (ThemeMode) -> Void
    @Environment(\.dismiss) private var dismiss
    @StateObject private var model: HomeViewModel
    @State private var themeMode: ThemeMode
    private let canLoadSupervisorSettings: Bool

    init(
        environment: AppEnvironment,
        connection: SupervisorConnectionConfig?,
        onThemeModeSelected: @escaping (ThemeMode) -> Void
    ) {
        self.onThemeModeSelected = onThemeModeSelected
        let settingsConnection = connection ?? SupervisorConnectionConfig(mode: .local, baseURL: "http://127.0.0.1:8787")
        _model = StateObject(wrappedValue: HomeViewModel(environment: environment, connection: settingsConnection))
        _themeMode = State(initialValue: environment.settingsStore.readThemeMode())
        canLoadSupervisorSettings = connection != nil &&
            !(settingsConnection.mode == .relay && settingsConnection.relayDeviceId?.trimmedNonEmpty == nil)
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Appearance") {
                    Picker("Theme", selection: $themeMode) {
                        ForEach(ThemeMode.allCases, id: \.self) { mode in
                            Text(mode.rawValue.capitalized).tag(mode)
                        }
                    }
                    .onChange(of: themeMode) { _, mode in
                        model.setTheme(mode)
                        onThemeModeSelected(mode)
                    }
                }
                if canLoadSupervisorSettings {
                    if model.settings.loading {
                        ProgressView("Loading settings...")
                    }
                    if let error = model.settings.errorMessage {
                        Text(error).remoteCodexErrorText()
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
                        if model.settings.agentBackends.isEmpty && !model.settings.loading {
                            Text("No runtime data loaded.")
                                .remoteCodexStatusText()
                        }
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
                            .tint(RemoteCodexTheme.accent)
                        Button(model.settings.importingPlugin ? "Importing..." : "Import plugin manifest") {
                            Task { await model.importPluginManifest() }
                        }
                        .disabled(
                            model.settings.importingPlugin ||
                                model.settings.pluginManifestDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        )
                        if let pluginError = model.settings.pluginErrorMessage {
                            Text(pluginError)
                                .remoteCodexErrorText()
                        }
                        ForEach(model.settings.plugins) { plugin in
                            Toggle(plugin.name, isOn: Binding(
                                get: { plugin.enabled },
                                set: { enabled in
                                    Task { await model.setPlugin(plugin, enabled: enabled) }
                                }
                            ))
                            .tint(RemoteCodexTheme.accent)
                        }
                    }
                } else {
                    Section("Supervisor Settings") {
                        ContentUnavailableView(
                            "Connect a device first",
                            systemImage: "iphone.and.arrow.forward",
                            description: Text("Runtime, workspace, and plugin settings are available after a supervisor device is selected.")
                        )
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
            .task {
                if canLoadSupervisorSettings {
                    await model.loadSettings()
                }
            }
        }
    }
}

struct RelayAccountSettingsSheet: View {
    let environment: AppEnvironment
    let connection: SupervisorConnectionConfig
    @Environment(\.dismiss) private var dismiss
    @State private var session: RelaySession?
    @State private var username = ""
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var loading = false
    @State private var savingProfile = false
    @State private var savingPassword = false
    @State private var message: String?
    @State private var errorMessage: String?

    private var client: SupervisorAPIClient {
        environment.apiClientFactory(connection)
    }

    var body: some View {
        NavigationStack {
            List {
                if connection.mode != .relay {
                    Section {
                        ContentUnavailableView(
                            "Relay Account Unavailable",
                            systemImage: "person.crop.circle.badge.exclamationmark",
                            description: Text("Account settings are available for relay connections.")
                        )
                    }
                } else {
                    if loading {
                        ProgressView("Loading account...")
                    }
                    if let errorMessage {
                        Text(errorMessage).remoteCodexErrorText()
                    }
                    if let message {
                        Text(message)
                            .foregroundStyle(RemoteCodexTheme.success)
                    }
                    if let user = session?.user {
                        Section("Profile") {
                            LabeledContent("Email", value: user.email)
                            TextField("Username", text: $username)
                                .textInputAutocapitalization(.never)
                            Button(savingProfile ? "Saving..." : "Save username") {
                                Task { await saveProfile() }
                            }
                            .disabled(savingProfile || username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        }
                        Section("Password") {
                            SecureField("Current password", text: $currentPassword)
                            SecureField("New password", text: $newPassword)
                            SecureField("Confirm password", text: $confirmPassword)
                            Button(savingPassword ? "Saving..." : "Change password") {
                                Task { await savePassword() }
                            }
                            .disabled(
                                savingPassword ||
                                    currentPassword.isEmpty ||
                                    newPassword.count < 8 ||
                                    confirmPassword.isEmpty
                            )
                        }
                    } else if !loading {
                        ContentUnavailableView(
                            "Relay Login Required",
                            systemImage: "person.crop.circle.badge.questionmark",
                            description: Text("Sign in to a relay account before managing account settings.")
                        )
                    }
                }
            }
            .navigationTitle("Accounts")
            .remoteCodexScreenSurface()
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        guard connection.mode == .relay else { return }
        loading = true
        errorMessage = nil
        defer { loading = false }
        do {
            let nextSession = try await client.fetchRelaySession()
            session = nextSession
            username = nextSession.user?.username ?? ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func saveProfile() async {
        savingProfile = true
        message = nil
        errorMessage = nil
        defer { savingProfile = false }
        do {
            let user = try await client.updateRelayAccount(username: username)
            session = RelaySession(
                authenticated: true,
                user: user,
                registrationEnabled: session?.registrationEnabled ?? true
            )
            username = user.username
            message = "Account updated."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func savePassword() async {
        guard newPassword == confirmPassword else {
            errorMessage = "New passwords do not match."
            return
        }
        savingPassword = true
        message = nil
        errorMessage = nil
        defer { savingPassword = false }
        do {
            _ = try await client.updateRelayPassword(
                currentPassword: currentPassword,
                newPassword: newPassword
            )
            currentPassword = ""
            newPassword = ""
            confirmPassword = ""
            message = "Password changed."
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct PlaceholderScreen: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 12) {
            Text(title).font(.title.bold())
            Text(subtitle).remoteCodexStatusText()
        }
        .padding()
    }
}
