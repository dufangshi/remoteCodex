import Foundation
import WebKit

final class ThreadDetailWebBridge: NSObject, ObservableObject, WKScriptMessageHandler {
    @Published var navigationTitle = "Thread"
    @Published var errorMessage: String?
    @Published var webReadyTitle: String?
    @Published var debugMessage: String?
    @Published var optimisticPromptMessage: String?
    @Published var sharedFile: ThreadDetailWebSharedFile?
    @Published var attachmentPickerRequest: ThreadDetailWebAttachmentPickerRequest?
    @Published var attachmentPickerResult: ThreadDetailWebAttachmentPickerResult?
    @Published var workspaceId: String?

    var onClose: () -> Void = {}
    var onOpenThread: (String) -> Void = { _ in }
    var onOpenWorkspace: (String) -> Void = { _ in }
    var onThemeModeChanged: (ThemeMode) -> Void = { _ in }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "remoteCodex" else { return }
        guard let decoded = decodeBridgeMessage(message.body) else {
            DispatchQueue.main.async { [weak self] in
                self?.errorMessage = "Received an unreadable WebView message."
            }
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.handle(decoded)
        }
    }

    private func handle(_ message: ThreadDetailWebBridgeMessage) {
        switch message.type {
        case "closeThread":
            onClose()
        case "openThread":
            if let threadId = message.threadId?.trimmedNonEmpty {
                onOpenThread(threadId)
            }
        case "openWorkspace":
            if let workspaceId = message.workspaceId?.trimmedNonEmpty {
                onOpenWorkspace(workspaceId)
            }
        case "setNavigationTitle":
            if let title = message.title?.trimmedNonEmpty {
                navigationTitle = title
            }
            rememberWorkspaceId(message.workspaceId)
        case "threadWebReady":
            if let title = message.title?.trimmedNonEmpty {
                navigationTitle = title
                webReadyTitle = title
            } else {
                webReadyTitle = "Thread"
            }
            rememberWorkspaceId(message.workspaceId)
        case "setThemeMode":
            if let rawTheme = message.theme?.trimmedNonEmpty,
               let mode = ThemeMode(rawValue: rawTheme)
            {
                onThemeModeChanged(mode)
            }
        case "threadWebDebug":
            recordDebugMessage(message.message)
        case "threadWebOptimisticPrompt":
            optimisticPromptMessage = message.message?.trimmedNonEmpty
        case "pickAttachments":
            if let requestId = message.requestId?.trimmedNonEmpty,
               let kind = ThreadDetailWebAttachmentKind(rawValue: message.kind ?? "")
            {
                attachmentPickerRequest = ThreadDetailWebAttachmentPickerRequest(
                    requestId: requestId,
                    kind: kind
                )
            }
        case "shareDownloadedFile":
            do {
                sharedFile = try writeSharedFile(message)
                recordDebugMessage("share:\(sharedFile?.filename ?? "file")")
            } catch {
                errorMessage = error.localizedDescription
            }
        case "reportFatalError":
            errorMessage = message.message?.trimmedNonEmpty ?? "Thread WebView reported an error."
        default:
            break
        }
    }

    func recordDebugMessage(_ message: String?) {
        #if DEBUG
        debugMessage = message?.trimmedNonEmpty
        #endif
    }

    private func rememberWorkspaceId(_ value: String?) {
        guard let value = value?.trimmedNonEmpty else { return }
        workspaceId = value
    }

    func decodeBridgeMessage(_ body: Any) -> ThreadDetailWebBridgeMessage? {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body, options: [])
        else {
            return nil
        }
        return try? JSONDecoder().decode(ThreadDetailWebBridgeMessage.self, from: data)
    }

    private func writeSharedFile(_ message: ThreadDetailWebBridgeMessage) throws -> ThreadDetailWebSharedFile {
        guard let filename = message.filename?.trimmedNonEmpty,
              let base64 = message.base64?.trimmedNonEmpty,
              let bytes = Data(base64Encoded: base64)
        else {
            throw ThreadDetailWebBridgeError.invalidDownloadedFile
        }

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("RemoteCodexThreadWebExports", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let safeName = sanitizeThreadWebFilename(filename)
        let url = directory.appendingPathComponent("\(UUID().uuidString)-\(safeName)")
        try bytes.write(to: url, options: [.atomic])
        return ThreadDetailWebSharedFile(
            url: url,
            filename: safeName,
            contentType: message.contentType?.trimmedNonEmpty ?? "application/octet-stream"
        )
    }
}

struct ThreadDetailWebBridgeMessage: Codable, Equatable {
    var type: String
    var threadId: String?
    var workspaceId: String?
    var title: String?
    var message: String?
    var filename: String?
    var contentType: String?
    var base64: String?
    var requestId: String?
    var kind: String?
    var theme: String?
}

struct ThreadDetailWebSharedFile: Identifiable, Equatable {
    var id: String {
        url.absoluteString
    }

    var url: URL
    var filename: String
    var contentType: String
}

enum ThreadDetailWebBridgeError: LocalizedError {
    case invalidDownloadedFile

    var errorDescription: String? {
        switch self {
        case .invalidDownloadedFile:
            "Thread WebView sent an invalid downloaded file."
        }
    }
}

enum ThreadDetailWebAttachmentKind: String, Codable, Equatable {
    case photo
    case file
}

struct ThreadDetailWebAttachmentPickerRequest: Equatable {
    var requestId: String
    var kind: ThreadDetailWebAttachmentKind
}

struct ThreadDetailWebAttachmentFile: Codable, Equatable {
    var filename: String
    var contentType: String?
    var base64: String
}

struct ThreadDetailWebAttachmentPickerResult: Codable, Equatable, Identifiable {
    var id = UUID()
    var requestId: String
    var kind: ThreadDetailWebAttachmentKind
    var cancelled: Bool?
    var error: String?
    var files: [ThreadDetailWebAttachmentFile]?
}

private func sanitizeThreadWebFilename(_ filename: String) -> String {
    let trimmed = filename.trimmedNonEmpty ?? "thread-export"
    let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_. "))
    let scalars = trimmed.unicodeScalars.map { scalar in
        allowed.contains(scalar) ? Character(scalar) : "-"
    }
    let sanitized = String(scalars).trimmingCharacters(in: .whitespacesAndNewlines)
    return sanitized.trimmedNonEmpty ?? "thread-export"
}
