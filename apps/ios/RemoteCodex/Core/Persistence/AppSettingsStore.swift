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

struct SavedSupervisorDevice: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var mode: SupervisorConnectionMode
    var baseURL: String
    var authTokenAccount: String?
    var relayDeviceId: String?
    var createdAt: String
    var updatedAt: String

    var normalizedBaseURL: String {
        normalizeBaseURL(baseURL)
    }

    var modeLabel: String {
        mode.label
    }
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

    func readSavedSupervisorDevices() -> [SavedSupervisorDevice] {
        let saved = decodedSavedSupervisorDevices()
        if !saved.isEmpty {
            return saved
        }
        guard let connection = readSupervisorConnection() else {
            return []
        }
        return [
            SavedSupervisorDevice(
                id: "legacy-\(connection.mode.storageKey)-\(connection.normalizedBaseURL)",
                name: defaultDeviceName(for: connection),
                mode: connection.mode,
                baseURL: connection.normalizedBaseURL,
                authTokenAccount: defaults.string(forKey: Keys.supervisorAuthTokenKey),
                relayDeviceId: nil,
                createdAt: nowString(),
                updatedAt: nowString()
            )
        ]
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
        _ = try upsertSavedSupervisorDevice(config: config)
    }

    @discardableResult
    func upsertSavedSupervisorDevice(
        config: SupervisorConnectionConfig,
        name: String? = nil
    ) throws -> SavedSupervisorDevice {
        var devices = decodedSavedSupervisorDevices()
        let matchRelayContainer = config.mode == .relay
        let matchIndex = devices.firstIndex { device in
            device.mode == config.mode &&
                device.normalizedBaseURL == config.normalizedBaseURL &&
                (matchRelayContainer || device.relayDeviceId == config.relayDeviceId)
        }
        let now = nowString()
        let id = matchIndex.map { devices[$0].id } ?? UUID().uuidString
        let tokenAccount = config.authToken?.trimmedNonEmpty == nil
            ? nil
            : "supervisor_device:\(id)"
        if let token = config.authToken?.trimmedNonEmpty, let tokenAccount {
            try tokenStore.writeToken(token, account: tokenAccount)
        }
        let saved = SavedSupervisorDevice(
            id: id,
            name: name?.trimmedNonEmpty
                ?? matchIndex.map { devices[$0].name }
                ?? defaultDeviceName(for: config),
            mode: config.mode,
            baseURL: config.normalizedBaseURL,
            authTokenAccount: tokenAccount ?? matchIndex.flatMap { devices[$0].authTokenAccount },
            relayDeviceId: matchRelayContainer ? nil : config.relayDeviceId,
            createdAt: matchIndex.map { devices[$0].createdAt } ?? now,
            updatedAt: now
        )
        if let matchIndex {
            devices[matchIndex] = saved
        } else {
            devices.insert(saved, at: 0)
        }
        writeSavedSupervisorDevices(devices)
        defaults.set(saved.id, forKey: Keys.activeSupervisorDeviceId)
        return saved
    }

    func supervisorConnection(for device: SavedSupervisorDevice, relayDeviceId: String? = nil) -> SupervisorConnectionConfig {
        let token = device.authTokenAccount.flatMap { try? tokenStore.readToken(account: $0) }
        return SupervisorConnectionConfig(
            mode: device.mode,
            baseURL: device.normalizedBaseURL,
            authToken: token?.trimmedNonEmpty,
            relayDeviceId: relayDeviceId ?? device.relayDeviceId
        )
    }

    func updateSavedSupervisorDevice(
        id: String,
        name: String,
        baseURL: String
    ) {
        var devices = decodedSavedSupervisorDevices()
        guard let index = devices.firstIndex(where: { $0.id == id }) else { return }
        devices[index].name = name.trimmedNonEmpty ?? devices[index].name
        devices[index].baseURL = normalizeBaseURL(baseURL)
        devices[index].updatedAt = nowString()
        writeSavedSupervisorDevices(devices)
    }

    func deleteSavedSupervisorDevice(id: String) {
        var devices = decodedSavedSupervisorDevices()
        guard let index = devices.firstIndex(where: { $0.id == id }) else { return }
        let removed = devices.remove(at: index)
        if let account = removed.authTokenAccount {
            try? tokenStore.deleteToken(account: account)
        }
        writeSavedSupervisorDevices(devices)
        if defaults.string(forKey: Keys.activeSupervisorDeviceId) == id {
            defaults.removeObject(forKey: Keys.activeSupervisorDeviceId)
            clearSupervisorConnection()
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

    private func decodedSavedSupervisorDevices() -> [SavedSupervisorDevice] {
        guard let data = defaults.data(forKey: Keys.savedSupervisorDevices),
              let devices = try? JSONDecoder().decode([SavedSupervisorDevice].self, from: data)
        else {
            return []
        }
        return devices
    }

    private func writeSavedSupervisorDevices(_ devices: [SavedSupervisorDevice]) {
        guard let data = try? JSONEncoder().encode(devices) else { return }
        defaults.set(data, forKey: Keys.savedSupervisorDevices)
    }

    private func defaultDeviceName(for config: SupervisorConnectionConfig) -> String {
        switch config.mode {
        case .local:
            "Local supervisor"
        case .server:
            "Server supervisor"
        case .relay:
            "Relay"
        }
    }

    private func nowString() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    private enum Keys {
        static let themeMode = "theme_mode"
        static let supervisorMode = "supervisor_mode"
        static let supervisorBaseURL = "supervisor_base_url"
        static let supervisorAuthTokenKey = "supervisor_auth_token_key"
        static let supervisorRelayDeviceId = "supervisor_relay_device_id"
        static let savedSupervisorDevices = "saved_supervisor_devices_v1"
        static let activeSupervisorDeviceId = "active_supervisor_device_id"
    }
}
