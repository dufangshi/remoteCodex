import SwiftUI

struct RootView: View {
    let environment: AppEnvironment
    @State private var route: AppRoute
    @State private var connection: SupervisorConnectionConfig?
    @State private var themeMode: ThemeMode

    init(environment: AppEnvironment) {
        self.environment = environment
        let savedConnection = environment.settingsStore.readSupervisorConnection()
        let readyConnection = Self.readyConnection(savedConnection)
        let savedRoute = environment.settingsStore.readLastRoute(for: readyConnection)
        _connection = State(initialValue: readyConnection)
        _route = State(initialValue: readyConnection == nil ? .connection : savedRoute.appRoute)
        _themeMode = State(initialValue: environment.settingsStore.readThemeMode())
    }

    var body: some View {
        NavigationStack {
            switch route {
            case .connection:
                ConnectionScreen(environment: environment) { config in
                    connection = config
                    route = .home
                }
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
                        onChangeConnection: returnToConnectionSetup,
                        onThemeModeSelected: { mode in
                            themeMode = mode
                        }
                    )
                } else {
                    ConnectionScreen(environment: environment) { config in
                        connection = config
                        route = .home
                    }
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
                        onChangeConnection: returnToConnectionSetup,
                        onBack: {
                            environment.settingsStore.writeLastRoute(.home, for: connection)
                            route = .home
                        }
                    )
                } else {
                    PlaceholderScreen(title: "Workspace", subtitle: workspaceId)
                }
            case let .threadDetail(threadId):
                if let connection {
                    ThreadDetailWebViewScreen(
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
                        onChangeConnection: returnToConnectionSetup,
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
    }

    private func returnToConnectionSetup() {
        guard let connection else {
            route = .connection
            return
        }
        if connection.mode == .relay {
            environment.settingsStore.clearRelayDeviceSelection()
        }
        self.connection = nil
        route = .connection
    }

    private static func readyConnection(_ connection: SupervisorConnectionConfig?) -> SupervisorConnectionConfig? {
        guard let connection else { return nil }
        if connection.mode == .relay, connection.relayDeviceId?.trimmedNonEmpty == nil {
            return nil
        }
        return connection
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
        Menu {
            content()
        } label: {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 44, height: 44)
                .background(.regularMaterial, in: Circle())
                .shadow(color: .black.opacity(0.16), radius: 10, x: 0, y: 6)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(accessibilityIdentifier)
        .padding(.top, appliesFloatingPadding ? 8 : 0)
        .padding(.trailing, appliesFloatingPadding ? 12 : 0)
    }
}

private struct PlaceholderScreen: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(spacing: 12) {
            Text(title).font(.title.bold())
            Text(subtitle).foregroundStyle(.secondary)
        }
        .padding()
    }
}
