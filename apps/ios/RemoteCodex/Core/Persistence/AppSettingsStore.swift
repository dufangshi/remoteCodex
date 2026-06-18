import Foundation

enum ThemeMode: String, Codable, CaseIterable {
    case system
    case light
    case dark

    static func fromStorageKey(_ value: String?) -> ThemeMode {
        guard let value, let mode = ThemeMode(rawValue: value) else {
            return .system
        }
        return mode
    }
}

enum SavedAppRoute: Equatable {
    case home
    case workspaceDetail(String)
    case threadDetail(String)
}

final class AppSettingsStore {
    private let defaults: UserDefaults
    private let tokenStore: TokenStore

    init(defaults: UserDefaults, tokenStore: TokenStore) {
        self.defaults = defaults
        self.tokenStore = tokenStore
    }

    func readThemeMode() -> ThemeMode {
        ThemeMode.fromStorageKey(defaults.string(forKey: Keys.themeMode))
    }

    func writeThemeMode(_ mode: ThemeMode) {
        defaults.set(mode.rawValue, forKey: Keys.themeMode)
    }

    func readSupervisorConnection() -> SupervisorConnectionConfig? {
        guard let baseURL = defaults.string(forKey: Keys.supervisorBaseURL)?.trimmedNonEmpty else {
            return nil
        }
        let mode = SupervisorConnectionMode.fromStorageKey(defaults.string(forKey: Keys.supervisorMode))
        let tokenKey = defaults.string(forKey: Keys.supervisorAuthTokenKey)
        let token = tokenKey.flatMap { try? tokenStore.readToken(account: $0) }
        return SupervisorConnectionConfig(
            mode: mode,
            baseURL: baseURL,
            authToken: token?.trimmedNonEmpty,
            relayDeviceId: defaults.string(forKey: Keys.supervisorRelayDeviceId)?.trimmedNonEmpty
        )
    }

    func writeSupervisorConnection(_ config: SupervisorConnectionConfig) throws {
        defaults.set(config.mode.storageKey, forKey: Keys.supervisorMode)
        defaults.set(config.normalizedBaseURL, forKey: Keys.supervisorBaseURL)
        defaults.set(config.relayDeviceId, forKey: Keys.supervisorRelayDeviceId)

        let account = tokenAccount(for: config)
        if let authToken = config.authToken?.trimmedNonEmpty {
            try tokenStore.writeToken(authToken, account: account)
            defaults.set(account, forKey: Keys.supervisorAuthTokenKey)
        } else {
            try? tokenStore.deleteToken(account: account)
            defaults.removeObject(forKey: Keys.supervisorAuthTokenKey)
        }
    }

    func clearSupervisorConnection() {
        if let account = defaults.string(forKey: Keys.supervisorAuthTokenKey) {
            try? tokenStore.deleteToken(account: account)
        }
        defaults.removeObject(forKey: Keys.supervisorMode)
        defaults.removeObject(forKey: Keys.supervisorBaseURL)
        defaults.removeObject(forKey: Keys.supervisorAuthTokenKey)
        defaults.removeObject(forKey: Keys.supervisorRelayDeviceId)
    }

    func clearRelayDeviceSelection() {
        defaults.removeObject(forKey: Keys.supervisorRelayDeviceId)
    }

    func clearAuthToken() {
        if let account = defaults.string(forKey: Keys.supervisorAuthTokenKey) {
            try? tokenStore.deleteToken(account: account)
        }
        defaults.removeObject(forKey: Keys.supervisorAuthTokenKey)
        defaults.removeObject(forKey: Keys.supervisorRelayDeviceId)
    }

    func readLastRoute(for config: SupervisorConnectionConfig?) -> SavedAppRoute {
        guard let config else { return .home }
        let key = lastRouteKey(config)
        switch defaults.string(forKey: "\(key):type") {
        case "thread":
            guard let id = defaults.string(forKey: "\(key):thread_id")?.trimmedNonEmpty else { return .home }
            return .threadDetail(id)
        case "workspace":
            guard let id = defaults.string(forKey: "\(key):workspace_id")?.trimmedNonEmpty else { return .home }
            return .workspaceDetail(id)
        default:
            return .home
        }
    }

    func writeLastRoute(_ route: SavedAppRoute, for config: SupervisorConnectionConfig) {
        let key = lastRouteKey(config)
        switch route {
        case .home:
            defaults.set("home", forKey: "\(key):type")
            defaults.removeObject(forKey: "\(key):workspace_id")
            defaults.removeObject(forKey: "\(key):thread_id")
        case let .workspaceDetail(workspaceId):
            defaults.set("workspace", forKey: "\(key):type")
            defaults.set(workspaceId, forKey: "\(key):workspace_id")
            defaults.removeObject(forKey: "\(key):thread_id")
        case let .threadDetail(threadId):
            defaults.set("thread", forKey: "\(key):type")
            defaults.set(threadId, forKey: "\(key):thread_id")
        }
    }

    private func tokenAccount(for config: SupervisorConnectionConfig) -> String {
        "supervisor:\(config.mode.storageKey):\(config.normalizedBaseURL)"
    }

    private func lastRouteKey(_ config: SupervisorConnectionConfig) -> String {
        "last_route:\(config.mode.storageKey):\(config.normalizedBaseURL):\(config.relayDeviceId ?? "")"
    }

    private enum Keys {
        static let themeMode = "theme_mode"
        static let supervisorMode = "supervisor_mode"
        static let supervisorBaseURL = "supervisor_base_url"
        static let supervisorAuthTokenKey = "supervisor_auth_token_key"
        static let supervisorRelayDeviceId = "supervisor_relay_device_id"
    }
}
