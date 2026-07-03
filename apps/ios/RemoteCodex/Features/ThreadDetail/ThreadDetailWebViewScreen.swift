import SwiftUI
import UniformTypeIdentifiers
import WebKit

struct ThreadDetailWebViewScreen: View {
    let connection: SupervisorConnectionConfig
    let threadId: String
    let themeMode: ThemeMode
    let fixtureMode: Bool
    let uiTestInitialSettings: ThreadDetailWebInitialSettings?
    let uiTestAutoResolvePendingRequests: Bool
    let uiTestClickPendingRequestControls: Bool
    let uiTestClickVisibleSettingsControls: Bool
    let uiTestForkMode: String?
    let uiTestAutoExportTranscript: Bool
    let uiTestAutoExportTranscriptFormat: String?
    let uiTestClickVisibleExportControls: Bool
    let uiTestFocusWorkspacePath: String?
    let uiTestAutoLoadMoreWorkspacePreview: Bool
    let uiTestAutoWorkspaceFileActions: Bool
    let uiTestClickVisibleWorkspaceControls: Bool
    let uiTestAutoLoadHistoryDetail: Bool
    let uiTestClickVisibleHistoryDetails: Bool
    let uiTestAutoLoadOlderHistory: Bool
    let uiTestAutoVerifyImageAsset: Bool
    let uiTestAutoVerifyTimelineContent: Bool
    let uiTestDisableRefreshFallback: Bool
    let uiTestAutoRenameTitle: String?
    let uiTestAutoDeleteThread: Bool
    let uiTestAutoAttachmentPickerResult: Bool
    let onClose: () -> Void
    let onOpenThread: (String) -> Void
    let onOpenWorkspace: (String) -> Void
    let onChangeConnection: () -> Void
    let onThemeModeSelected: (ThemeMode) -> Void
    let onBack: (String?) -> Void

    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var bridge = ThreadDetailWebBridge()
    @State private var attachmentPickerResult: ThreadDetailWebAttachmentPickerResult?

    var body: some View {
        Group {
            if let indexURL = Bundle.main.url(
                forResource: "index",
                withExtension: "html",
                subdirectory: "WebThreadDist"
            ) {
                ThreadDetailWebView(
                    indexURL: indexURL,
                    bootstrap: ThreadDetailWebBootstrap(
                        baseUrl: connection.normalizedBaseURL,
                        mode: connection.mode.rawValue,
                        authToken: connection.authToken,
                        relayDeviceId: connection.relayDeviceId,
                        threadId: fixtureMode ? nil : threadId,
                        theme: themeMode.rawValue,
                        fixture: fixtureMode,
                        uiTestInitialSettings: uiTestInitialSettings,
                        uiTestAutoResolvePendingRequests: uiTestAutoResolvePendingRequests,
                        uiTestClickPendingRequestControls: uiTestClickPendingRequestControls,
                        uiTestClickVisibleSettingsControls: uiTestClickVisibleSettingsControls,
                        uiTestForkMode: uiTestForkMode,
                        uiTestAutoExportTranscript: uiTestAutoExportTranscript,
                        uiTestAutoExportTranscriptFormat: uiTestAutoExportTranscriptFormat,
                        uiTestClickVisibleExportControls: uiTestClickVisibleExportControls,
                        uiTestFocusWorkspacePath: uiTestFocusWorkspacePath,
                        uiTestAutoLoadMoreWorkspacePreview: uiTestAutoLoadMoreWorkspacePreview,
                        uiTestAutoWorkspaceFileActions: uiTestAutoWorkspaceFileActions,
                        uiTestClickVisibleWorkspaceControls: uiTestClickVisibleWorkspaceControls,
                        uiTestAutoLoadHistoryDetail: uiTestAutoLoadHistoryDetail,
                        uiTestClickVisibleHistoryDetails: uiTestClickVisibleHistoryDetails,
                        uiTestAutoLoadOlderHistory: uiTestAutoLoadOlderHistory,
                        uiTestAutoVerifyImageAsset: uiTestAutoVerifyImageAsset,
                        uiTestAutoVerifyTimelineContent: uiTestAutoVerifyTimelineContent,
                        uiTestDisableRefreshFallback: uiTestDisableRefreshFallback,
                        uiTestAutoRenameTitle: uiTestAutoRenameTitle,
                        uiTestAutoDeleteThread: uiTestAutoDeleteThread
                    ),
                    sceneActive: scenePhase == .active,
                    attachmentPickerResult: attachmentPickerResult,
                    bridge: bridge
                )
                .ignoresSafeArea(.container, edges: [.top, .bottom])
                .accessibilityIdentifier("thread-webview-screen")
                .accessibilityElement(children: .contain)
            } else {
                ContentUnavailableView(
                    "Thread WebView bundle missing",
                    systemImage: "exclamationmark.triangle",
                    description: Text("Build the iOS Thread Web bundle before opening this route.")
                )
                .accessibilityIdentifier("thread-webview-missing-bundle")
            }
        }
        .navigationBarBackButtonHidden(true)
        .toolbar(.hidden, for: .navigationBar)
        .edgeSwipeBack(action: returnToWorkspaceLevel)
        .overlay(alignment: .topTrailing) {
            threadMenu
        }
        .overlay(alignment: .bottom) {
            if let error = bridge.errorMessage {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .padding(12)
                    .frame(maxWidth: .infinity)
                    .background(.regularMaterial)
                    .accessibilityIdentifier("thread-webview-error")
            }
        }
        .overlay(alignment: .topLeading) {
            if let title = bridge.webReadyTitle {
                Text("Thread WebView ready: \(title)")
                    .frame(width: 1, height: 1)
                    .opacity(0.01)
                    .accessibilityIdentifier("thread-webview-ready")
            }
        }
        #if DEBUG
            .overlay(alignment: .topTrailing) {
                if let debugMessage = bridge.debugMessage {
                    Text(debugMessage)
                        .frame(width: 1, height: 1)
                        .opacity(0.01)
                        .accessibilityIdentifier("thread-webview-debug")
                }
            }
            .overlay(alignment: .top) {
                if let optimisticPromptMessage = bridge.optimisticPromptMessage {
                    Text(optimisticPromptMessage)
                        .frame(width: 1, height: 1)
                        .opacity(0.01)
                        .accessibilityIdentifier("thread-webview-optimistic-prompt")
                }
            }
        #endif
        .overlay(alignment: .center) {
            if uiTestInitialSettings != nil {
                Text("uiTestInitialSettings:swift")
                    .frame(width: 1, height: 1)
                    .opacity(0.01)
                    .accessibilityIdentifier("thread-webview-swift-settings")
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if let sharedFile = bridge.sharedFile {
                ShareLink(item: sharedFile.url) {
                    Label("Share \(sharedFile.filename)", systemImage: "square.and.arrow.up")
                }
                .padding(12)
                .accessibilityIdentifier("thread-webview-share-export")
            }
        }
        .fileImporter(
            isPresented: attachmentPickerPresented,
            allowedContentTypes: attachmentPickerContentTypes,
            allowsMultipleSelection: true,
            onCompletion: handleAttachmentPickerCompletion
        )
        .onAppear {
            bridge.onClose = onClose
            bridge.onOpenThread = onOpenThread
            bridge.onOpenWorkspace = onOpenWorkspace
            bridge.onThemeModeChanged = onThemeModeSelected
        }
        .onChange(of: bridge.attachmentPickerRequest) { _, request in
            guard uiTestAutoAttachmentPickerResult, let request else { return }
            bridge.attachmentPickerRequest = nil
            bridge.recordDebugMessage("native-picker:auto-request:\(request.kind.rawValue):\(request.requestId)")
            DispatchQueue.main.async {
                attachmentPickerResult = ThreadDetailWebAttachmentPickerResult(
                    requestId: request.requestId,
                    kind: request.kind,
                    files: [
                        ThreadDetailWebAttachmentFile(
                            filename: request.kind == .photo
                                ? "ios-native-picker-photo.png"
                                : "ios-webview-visible-upload.txt",
                            contentType: request.kind == .photo
                                ? "image/png"
                                : "text/plain",
                            base64: Data("IOS_WORKSPACE_VISIBLE_UPLOAD_MARKER\n".utf8)
                                .base64EncodedString()
                        )
                    ]
                )
                bridge.recordDebugMessage("native-picker:auto-result:\(request.kind.rawValue):\(request.requestId)")
            }
        }
    }

    private var attachmentPickerPresented: Binding<Bool> {
        Binding(
            get: { bridge.attachmentPickerRequest != nil && !uiTestAutoAttachmentPickerResult },
            set: { _ in }
        )
    }

    private var threadMenu: some View {
        FloatingActionMenu(accessibilityIdentifier: "thread-webview-menu") {
            Button(action: returnToWorkspaceLevel) {
                Label("Workspace", systemImage: "folder")
            }
            Button(action: onClose) {
                Label("Home", systemImage: "house")
            }
            Divider()
            Button(action: onChangeConnection) {
                Label("Devices", systemImage: "iphone")
            }
        }
    }

    private func returnToWorkspaceLevel() {
        onBack(bridge.workspaceId?.trimmedNonEmpty)
    }

    private var attachmentPickerContentTypes: [UTType] {
        switch bridge.attachmentPickerRequest?.kind {
        case .photo:
            [.image]
        case .file, nil:
            [.item]
        }
    }

    private func handleAttachmentPickerCompletion(_ result: Result<[URL], Error>) {
        guard let request = bridge.attachmentPickerRequest else { return }
        bridge.attachmentPickerRequest = nil

        switch result {
        case let .success(urls):
            do {
                attachmentPickerResult = ThreadDetailWebAttachmentPickerResult(
                    requestId: request.requestId,
                    kind: request.kind,
                    files: try urls.map(readAttachmentFile)
                )
            } catch {
                attachmentPickerResult = ThreadDetailWebAttachmentPickerResult(
                    requestId: request.requestId,
                    kind: request.kind,
                    error: error.localizedDescription
                )
            }
        case let .failure(error):
            let nsError = error as NSError
            let cancelled = nsError.domain == NSCocoaErrorDomain && nsError.code == NSUserCancelledError
            attachmentPickerResult = ThreadDetailWebAttachmentPickerResult(
                requestId: request.requestId,
                kind: request.kind,
                cancelled: cancelled ? true : nil,
                error: cancelled ? nil : error.localizedDescription
            )
        }
    }

    private func readAttachmentFile(_ url: URL) throws -> ThreadDetailWebAttachmentFile {
        let didStartAccessing = url.startAccessingSecurityScopedResource()
        defer {
            if didStartAccessing {
                url.stopAccessingSecurityScopedResource()
            }
        }

        let data = try Data(contentsOf: url)
        return ThreadDetailWebAttachmentFile(
            filename: url.lastPathComponent,
            contentType: UTType(filenameExtension: url.pathExtension)?.preferredMIMEType,
            base64: data.base64EncodedString()
        )
    }
}

private struct ThreadDetailWebView: UIViewRepresentable {
    let indexURL: URL
    let bootstrap: ThreadDetailWebBootstrap
    let sceneActive: Bool
    let attachmentPickerResult: ThreadDetailWebAttachmentPickerResult?
    let bridge: ThreadDetailWebBridge

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        configuration.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        let userContentController = WKUserContentController()
        userContentController.add(bridge, name: "remoteCodex")
        let bootstrapScript = bootstrap.javaScriptAssignment()
        context.coordinator.bootstrapScript = bootstrapScript
        userContentController.addUserScript(
            WKUserScript(
                source: bootstrapScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.userContentController = userContentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.accessibilityIdentifier = "thread-webview"
        context.coordinator.bootstrap = bootstrap
        context.coordinator.attach(webView)
        webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.sendSceneActive(sceneActive, to: webView)
        context.coordinator.sendAttachmentPickerResult(
            attachmentPickerResult,
            to: webView
        )
        context.coordinator.sendTheme(bootstrap.theme, to: webView)

        guard context.coordinator.requiresReload(for: bootstrap) else {
            context.coordinator.bootstrap = bootstrap
            return
        }

        let bootstrapScript = bootstrap.javaScriptAssignment()
        context.coordinator.bootstrap = bootstrap
        context.coordinator.bootstrapScript = bootstrapScript
        let userContentController = webView.configuration.userContentController
        userContentController.removeAllUserScripts()
        userContentController.addUserScript(
            WKUserScript(
                source: bootstrapScript,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        webView.loadFileURL(indexURL, allowingReadAccessTo: indexURL.deletingLastPathComponent())
    }

    final class Coordinator {
        var bootstrap: ThreadDetailWebBootstrap?
        var bootstrapScript: String?

        private weak var webView: WKWebView?
        private var lastSceneActive: Bool?
        private var lastTheme: String?
        private var lastAttachmentPickerResultId: UUID?
        private var notificationObservers: [NSObjectProtocol] = []

        deinit {
            for observer in notificationObservers {
                NotificationCenter.default.removeObserver(observer)
            }
        }

        func attach(_ webView: WKWebView) {
            self.webView = webView
            guard notificationObservers.isEmpty else { return }

            let center = NotificationCenter.default
            notificationObservers.append(
                center.addObserver(
                    forName: UIScene.willDeactivateNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    self?.sendSceneActive(false, force: true)
                }
            )
            notificationObservers.append(
                center.addObserver(
                    forName: UIScene.didEnterBackgroundNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    self?.sendSceneActive(false, force: true)
                }
            )
            notificationObservers.append(
                center.addObserver(
                    forName: UIScene.didActivateNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    self?.resumeSceneActiveAfterForeground()
                }
            )
            notificationObservers.append(
                center.addObserver(
                    forName: UIApplication.willResignActiveNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    self?.sendSceneActive(false, force: true)
                }
            )
            notificationObservers.append(
                center.addObserver(
                    forName: UIApplication.didEnterBackgroundNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    self?.sendSceneActive(false, force: true)
                }
            )
            notificationObservers.append(
                center.addObserver(
                    forName: UIApplication.didBecomeActiveNotification,
                    object: nil,
                    queue: .main
                ) { [weak self] _ in
                    self?.resumeSceneActiveAfterForeground()
                }
            )
        }

        func sendSceneActive(_ active: Bool, to webView: WKWebView) {
            if active, lastSceneActive == false {
                resumeSceneActiveAfterForeground(to: webView)
                return
            }
            sendSceneActive(active, to: webView, force: false)
        }

        private func sendSceneActive(_ active: Bool, force: Bool) {
            guard let webView else { return }
            sendSceneActive(active, to: webView, force: force)
        }

        private func sendSceneActive(_ active: Bool, to webView: WKWebView, force: Bool) {
            guard force || lastSceneActive != active else { return }
            lastSceneActive = active
            let value = active ? "true" : "false"
            webView.evaluateJavaScript("window.remoteCodexIOS?.setSceneActive?.(\(value));")
        }

        private func resumeSceneActiveAfterForeground() {
            guard let webView else { return }
            resumeSceneActiveAfterForeground(to: webView)
        }

        private func resumeSceneActiveAfterForeground(to webView: WKWebView) {
            guard lastSceneActive == false else {
                sendSceneActive(true, to: webView, force: true)
                return
            }
            lastSceneActive = true
            webView.evaluateJavaScript(
                """
                if (window.remoteCodexIOS?.resumeSceneActive) {
                  window.remoteCodexIOS.resumeSceneActive();
                } else {
                  window.remoteCodexIOS?.setSceneActive?.(true);
                }
                """
            )
        }

        func sendAttachmentPickerResult(
            _ result: ThreadDetailWebAttachmentPickerResult?,
            to webView: WKWebView
        ) {
            guard let result, lastAttachmentPickerResultId != result.id else { return }
            lastAttachmentPickerResultId = result.id
            guard let json = result.javaScriptObjectLiteral else { return }
            webView.evaluateJavaScript("window.remoteCodexIOS?.attachmentPickerResult?.(\(json));")
        }

        func requiresReload(for nextBootstrap: ThreadDetailWebBootstrap) -> Bool {
            guard var currentBootstrap = bootstrap else { return true }
            var comparableBootstrap = nextBootstrap
            currentBootstrap.theme = comparableBootstrap.theme
            return currentBootstrap != comparableBootstrap
        }

        func sendTheme(_ theme: String, to webView: WKWebView) {
            guard lastTheme != theme else { return }
            lastTheme = theme
            guard let data = try? JSONEncoder().encode(theme),
                  let literal = String(data: data, encoding: .utf8)
            else {
                return
            }
            webView.evaluateJavaScript("window.remoteCodexIOS?.setTheme?.(\(literal));")
        }
    }

}

private extension ThreadDetailWebAttachmentPickerResult {
    var javaScriptObjectLiteral: String? {
        guard let data = try? JSONEncoder().encode(self),
              var json = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        json = json
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
        return json
    }
}

struct ThreadDetailWebBootstrap: Codable, Equatable {
    var baseUrl: String
    var mode: String
    var authToken: String?
    var relayDeviceId: String?
    var threadId: String?
    var theme: String
    var fixture: Bool
    var uiTestInitialSettings: ThreadDetailWebInitialSettings?
    var uiTestAutoResolvePendingRequests: Bool
    var uiTestClickPendingRequestControls: Bool
    var uiTestClickVisibleSettingsControls: Bool
    var uiTestForkMode: String?
    var uiTestAutoExportTranscript: Bool
    var uiTestAutoExportTranscriptFormat: String?
    var uiTestClickVisibleExportControls: Bool
    var uiTestFocusWorkspacePath: String?
    var uiTestAutoLoadMoreWorkspacePreview: Bool
    var uiTestAutoWorkspaceFileActions: Bool
    var uiTestClickVisibleWorkspaceControls: Bool
    var uiTestAutoLoadHistoryDetail: Bool
    var uiTestClickVisibleHistoryDetails: Bool
    var uiTestAutoLoadOlderHistory: Bool
    var uiTestAutoVerifyImageAsset: Bool
    var uiTestAutoVerifyTimelineContent: Bool
    var uiTestDisableRefreshFallback: Bool
    var uiTestAutoRenameTitle: String?
    var uiTestAutoDeleteThread: Bool

    func javaScriptAssignment() -> String {
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(self),
              let json = String(data: data, encoding: .utf8)
        else {
            return "window.__REMOTE_CODEX_IOS_BOOTSTRAP__ = { fixture: true };"
        }
        return "window.__REMOTE_CODEX_IOS_BOOTSTRAP__ = \(json);"
    }
}

struct ThreadDetailWebInitialSettings: Codable, Equatable {
    var model: String?
    var reasoningEffort: String?
    var fastMode: Bool?
    var collaborationMode: String?
    var sandboxMode: String?
}
