import Foundation

enum SupervisorConnectionMode: String, CaseIterable, Codable, Identifiable {
    case local
    case server
    case relay

    var id: String {
        rawValue
    }

    var storageKey: String {
        rawValue
    }

    var label: String {
        switch self {
        case .local:
            "Intranet"
        case .server:
            "Server"
        case .relay:
            "Relay"
        }
    }

    static func fromStorageKey(_ value: String?) -> SupervisorConnectionMode {
        guard let value, let mode = SupervisorConnectionMode(rawValue: value) else {
            return .local
        }
        return mode
    }
}

struct SupervisorConnectionConfig: Codable, Equatable {
    var mode: SupervisorConnectionMode
    var baseURL: String
    var authToken: String?
    var relayDeviceId: String?

    var normalizedBaseURL: String {
        normalizeBaseURL(baseURL)
    }

    func restPath(_ path: String) -> String {
        let normalizedPath = path.hasPrefix("/") ? path : "/\(path)"
        switch mode {
        case .local, .server:
            return normalizedPath
        case .relay:
            let deviceId = relayDeviceId?.trimmedNonEmpty
            if let deviceId {
                return "/relay/devices/\(deviceId.urlPathEncoded)\(normalizedPath)"
            }
            return "/relay\(normalizedPath)"
        }
    }

    func webSocketURL() -> String {
        let path = switch mode {
        case .local, .server:
            "/ws"
        case .relay:
            if let deviceId = relayDeviceId?.trimmedNonEmpty {
                "/relay/devices/\(deviceId.urlPathEncoded)/ws"
            } else {
                "/relay/ws"
            }
        }

        let wsBase = normalizedBaseURL
            .replacingOccurrences(of: "https://", with: "wss://", options: [.anchored])
            .replacingOccurrences(of: "http://", with: "ws://", options: [.anchored])
        guard let token = authToken?.trimmedNonEmpty else {
            return "\(wsBase)\(path)"
        }
        let queryName = mode == .relay ? "relaySession" : "token"
        return "\(wsBase)\(path)?\(queryName)=\(token.urlQueryEncoded)"
    }
}

func normalizeBaseURL(_ value: String) -> String {
    var trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    while trimmed.hasSuffix("/") {
        trimmed.removeLast()
    }
    if trimmed.isEmpty {
        return "http://127.0.0.1:8787"
    }
    if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
        return trimmed
    }
    return "http://\(trimmed)"
}

extension String {
    var trimmedNonEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var urlPathEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathSegmentAllowed) ?? self
    }

    var urlQueryEncoded: String {
        addingPercentEncoding(withAllowedCharacters: .urlQueryValueAllowed) ?? self
    }
}

private extension CharacterSet {
    static let urlPathSegmentAllowed: CharacterSet = {
        var set = CharacterSet.urlPathAllowed
        set.remove(charactersIn: "/?#[]@!$&'()*+,;=")
        return set
    }()

    static let urlQueryValueAllowed: CharacterSet = {
        var set = CharacterSet.urlQueryAllowed
        set.remove(charactersIn: ":/?#[]@!$&'()*+,;=")
        return set
    }()
}
