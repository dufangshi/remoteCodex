import Foundation

struct SupervisorHTTPRequest: Equatable {
    var url: URL
    var method: String
    var body: Data?
    var contentType: String?
    var bearerToken: String?
}

struct SupervisorHTTPResponse {
    var statusCode: Int
    var body: Data
    var headers: [String: String]
}

struct SupervisorMultipartPart: Equatable {
    var fieldName: String
    var filename: String
    var contentType: String
    var bytes: Data
}

protocol SupervisorHTTPTransport {
    func request(_ request: SupervisorHTTPRequest) async throws -> SupervisorHTTPResponse
}

enum SupervisorAPIError: Error, Equatable {
    case invalidURL(String)
    case http(statusCode: Int, message: String, body: String?)
    case parse(String)
}

final class SupervisorAPIClient: @unchecked Sendable {
    let config: SupervisorConnectionConfig
    private let transport: SupervisorHTTPTransport
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(config: SupervisorConnectionConfig, transport: SupervisorHTTPTransport) {
        self.config = config
        self.transport = transport
        decoder = JSONDecoder()
        encoder = JSONEncoder()
    }

    func fetchAuthSession() async throws -> AuthSession {
        switch config.mode {
        case .local, .server:
            return try await requestJSON(config.restPath("/api/auth/session"))
        case .relay:
            let relaySession: RelaySession = try await requestJSON("/relay/auth/session")
            return relaySession.toAuthSession()
        }
    }

    func login(username: String, password: String) async throws -> AuthLoginResult {
        try await requestJSON(
            config.restPath("/api/auth/login"),
            method: "POST",
            body: ["username": username, "password": password]
        )
    }

    func relayLogin(identifier: String, password: String) async throws -> RelayLoginResult {
        try await requestJSON(
            "/relay/auth/login",
            method: "POST",
            body: ["identifier": identifier, "password": password]
        )
    }

    func relayRegister(email: String, username: String, password: String) async throws -> RelayLoginResult {
        try await requestJSON(
            "/relay/auth/register",
            method: "POST",
            body: ["email": email, "username": username, "password": password]
        )
    }

    func fetchHealth() async throws -> SupervisorHealth {
        let path = switch config.mode {
        case .local, .server:
            "/healthz"
        case .relay:
            if let deviceId = config.relayDeviceId?.trimmedNonEmpty {
                "/relay/devices/\(deviceId.urlPathEncoded)/healthz"
            } else {
                "/healthz"
            }
        }
        return try await requestJSON(path)
    }

    func listWorkspaces() async throws -> [SupervisorWorkspaceSummary] {
        try await requestJSON(config.restPath("/api/workspaces"))
    }

    func listThreads() async throws -> [SupervisorThreadSummary] {
        try await requestJSON(config.restPath("/api/threads"))
    }

    func fetchHomeSnapshot() async throws -> SupervisorHomeSnapshot {
        let workspaces = try await listWorkspaces()
        let threads = try await listThreads()
        return SupervisorHomeSnapshot(workspaces: workspaces, threads: threads)
    }

    func createWorkspace(_ request: CreateSupervisorWorkspaceRequest) async throws -> SupervisorWorkspaceSummary {
        try await requestJSON(
            config.restPath("/api/workspaces"),
            method: "POST",
            body: request
        )
    }

    func updateWorkspace(
        workspaceId: String,
        request: UpdateSupervisorWorkspaceRequest
    ) async throws -> SupervisorWorkspaceSummary {
        try await requestJSON(
            config.restPath("/api/workspaces/\(workspaceId.urlPathEncoded)"),
            method: "PATCH",
            body: request
        )
    }

    func deleteWorkspace(workspaceId: String) async throws -> DeletedResource {
        try await requestJSON(
            config.restPath("/api/workspaces/\(workspaceId.urlPathEncoded)"),
            method: "DELETE"
        )
    }

    func setWorkspaceFavorite(workspaceId: String, isFavorite: Bool) async throws -> SupervisorWorkspaceSummary {
        try await requestJSON(
            config.restPath("/api/workspaces/\(workspaceId.urlPathEncoded)/favorite"),
            method: "POST",
            body: ["isFavorite": isFavorite]
        )
    }

    func openWorkspace(workspaceId: String) async throws -> SupervisorWorkspaceSummary {
        try await requestJSON(
            config.restPath("/api/workspaces/\(workspaceId.urlPathEncoded)/open"),
            method: "POST"
        )
    }

    func startThread(_ request: StartSupervisorThreadRequest) async throws -> SupervisorThreadSummary {
        try await requestJSON(
            config.restPath("/api/threads/start"),
            method: "POST",
            body: request
        )
    }

    func importThread(_ request: ImportSupervisorThreadRequest) async throws -> SupervisorThreadDetail {
        try await requestJSON(
            config.restPath("/api/threads/import"),
            method: "POST",
            body: request
        )
    }

    func fetchRuntimeConfig() async throws -> SupervisorRuntimeConfig {
        try await requestJSON(config.restPath("/api/config/runtime"))
    }

    func fetchWorkspaceSettings() async throws -> SupervisorWorkspaceSettings {
        try await requestJSON(config.restPath("/api/config/workspace-settings"))
    }

    func updateWorkspaceSettings(
        _ request: UpdateSupervisorWorkspaceSettingsRequest
    ) async throws -> SupervisorWorkspaceSettings {
        try await requestJSON(
            config.restPath("/api/config/workspace-settings"),
            method: "PATCH",
            body: request
        )
    }

    func listAgentBackends() async throws -> [SupervisorAgentBackend] {
        try await requestJSON(config.restPath("/api/agent-runtimes"))
    }

    func listAgentModels(provider: String) async throws -> [SupervisorModelOption] {
        try await requestJSON(config.restPath("/api/agent-runtimes/\(provider.urlPathEncoded)/models"))
    }

    func listPlugins() async throws -> [SupervisorPluginSummary] {
        try await requestJSON(config.restPath("/api/plugins"))
    }

    func importPlugin(_ request: ImportSupervisorPluginRequest) async throws -> SupervisorPluginSummary {
        try await requestJSON(
            config.restPath("/api/plugins/import"),
            method: "POST",
            body: request
        )
    }

    func updatePlugin(pluginId: String, request: UpdateSupervisorPluginRequest) async throws -> SupervisorPluginSummary {
        try await requestJSON(
            config.restPath("/api/plugins/\(pluginId.urlPathEncoded)"),
            method: "PATCH",
            body: request
        )
    }

    func fetchWorkspaceTree(workspaceId: String, path: String? = nil) async throws -> SupervisorWorkspaceTreeNode {
        let query = buildQuery(["path": path])
        return try await requestJSON(
            config.restPath("/api/workspaces/\(workspaceId.urlPathEncoded)/files/tree\(query)")
        )
    }

    func fetchWorkspaceFilePreview(
        workspaceId: String,
        path: String,
        offset: Int64? = nil,
        limit: Int? = nil
    ) async throws -> SupervisorWorkspaceFilePreview {
        let query = buildQuery([
            "path": path,
            "offset": offset.map(String.init),
            "limit": limit.map(String.init)
        ])
        return try await requestJSON(
            config.restPath("/api/workspaces/\(workspaceId.urlPathEncoded)/files/preview\(query)")
        )
    }

    func writeWorkspaceFile(workspaceId: String, path: String, content: String) async throws -> SupervisorWorkspaceFile {
        try await requestJSON(
            config.restPath("/api/workspaces/\(workspaceId.urlPathEncoded)/files"),
            method: "PUT",
            body: WriteWorkspaceFileRequest(path: path, content: content)
        )
    }

    func fetchWorkspaceRawFile(workspaceId: String, path: String) async throws -> SupervisorWorkspaceRawFile {
        let query = buildQuery(["path": path])
        let response = try await requestDownload(
            config.restPath("/api/workspaces/\(workspaceId.urlPathEncoded)/files/raw\(query)"),
            fallbackFilename: path.components(separatedBy: "/").last ?? "workspace-file"
        )
        return SupervisorWorkspaceRawFile(
            path: path,
            contentType: response.contentType,
            bytes: response.bytes
        )
    }

    func downloadWorkspaceFile(workspaceId: String, path: String) async throws -> SupervisorFileDownload {
        let query = buildQuery(["path": path])
        return try await requestDownload(
            config.restPath("/api/workspaces/\(workspaceId.urlPathEncoded)/files/download\(query)"),
            fallbackFilename: path.components(separatedBy: "/").last ?? "workspace-file"
        )
    }

    func uploadWorkspaceFile(
        workspaceId: String,
        request: UploadWorkspaceFileRequest
    ) async throws -> SupervisorWorkspaceUploadResult {
        try await requestMultipartJSON(
            config.restPath("/api/workspaces/\(workspaceId.urlPathEncoded)/files/upload"),
            parts: [
                SupervisorMultipartPart(
                    fieldName: "file",
                    filename: request.filename,
                    contentType: request.contentType,
                    bytes: request.bytes
                )
            ],
            fields: ["path": request.path]
                .compactMapValues { $0?.trimmedNonEmpty }
        )
    }

    func fetchRelayPortal() async throws -> RelayPortalSummary {
        try await requestJSON("/relay/portal")
    }

    func createRelayDevice(name: String) async throws -> RelayCreateDeviceResult {
        try await requestJSON(
            "/relay/devices",
            method: "POST",
            body: ["name": name]
        )
    }

    func deleteRelayDevice(deviceId: String) async throws -> DeletedResource {
        try await requestJSON(
            "/relay/devices/\(deviceId.urlPathEncoded)",
            method: "DELETE"
        )
    }

    func checkConnection() async throws -> SupervisorConnectionCheck {
        let session = try await fetchAuthSession()
        let health = try await fetchHealth()
        return SupervisorConnectionCheck(
            config: config,
            authenticated: session.authenticated,
            authRequired: session.authRequired,
            sessionLabel: sessionLabel(for: session),
            healthLabel: healthLabel(for: health),
            websocketURL: config.webSocketURL()
        )
    }

    func requestJSON<T: Decodable>(_ path: String, method: String = "GET", body: Encodable? = nil) async throws -> T {
        let response = try await request(path, method: method, body: body)
        do {
            return try decoder.decode(T.self, from: response.body.isEmpty ? Data("{}".utf8) : response.body)
        } catch {
            throw SupervisorAPIError.parse("Response was not valid JSON.")
        }
    }

    func requestArray<T: Decodable>(
        _ path: String,
        method: String = "GET",
        body: Encodable? = nil
    ) async throws -> [T] {
        try await requestJSON(path, method: method, body: body)
    }

    func requestMultipartJSON<T: Decodable>(
        _ path: String,
        method: String = "POST",
        parts: [SupervisorMultipartPart],
        fields: [String: String] = [:]
    ) async throws -> T {
        let boundary = "remoteCodexIOS\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        let response = try await requestRaw(
            path,
            method: method,
            body: buildMultipartBody(boundary: boundary, fields: fields, parts: parts),
            contentType: "multipart/form-data; boundary=\(boundary)"
        )
        do {
            return try decoder.decode(T.self, from: response.body.isEmpty ? Data("{}".utf8) : response.body)
        } catch {
            throw SupervisorAPIError.parse("Response was not valid JSON.")
        }
    }

    func requestDownload(_ path: String, fallbackFilename: String) async throws -> SupervisorFileDownload {
        let response = try await request(path)
        return SupervisorFileDownload(
            filename: response.filenameFromHeaders ?? fallbackFilename,
            contentType: response.headers["Content-Type"] ?? response.headers["content-type"],
            bytes: response.body
        )
    }

    private func request(
        _ path: String,
        method: String = "GET",
        body: Encodable? = nil
    ) async throws -> SupervisorHTTPResponse {
        let bodyData = try body.map { try encoder.encode(AnyEncodable($0)) }
        return try await requestRaw(
            path,
            method: method,
            body: bodyData,
            contentType: bodyData == nil ? nil : "application/json"
        )
    }

    private func requestRaw(
        _ path: String,
        method: String = "GET",
        body: Data? = nil,
        contentType: String? = nil
    ) async throws -> SupervisorHTTPResponse {
        guard let url = URL(string: config.normalizedBaseURL + path) else {
            throw SupervisorAPIError.invalidURL(config.normalizedBaseURL + path)
        }
        let response = try await transport.request(
            SupervisorHTTPRequest(
                url: url,
                method: method,
                body: body,
                contentType: contentType,
                bearerToken: config.authToken
            )
        )
        guard (200 ... 299).contains(response.statusCode) else {
            let bodyText = String(data: response.body, encoding: .utf8)
            throw SupervisorAPIError.http(
                statusCode: response.statusCode,
                message: parseErrorMessage(response.body) ?? "HTTP \(response.statusCode)",
                body: bodyText
            )
        }
        return response
    }
}

private func buildMultipartBody(
    boundary: String,
    fields: [String: String],
    parts: [SupervisorMultipartPart]
) -> Data {
    var body = Data()
    for (name, value) in fields.sorted(by: { $0.key < $1.key }) {
        body.appendMultipartLine("--\(boundary)")
        body.appendMultipartLine("Content-Disposition: form-data; name=\"\(name)\"")
        body.appendMultipartLine("")
        body.appendMultipartLine(value)
    }
    for part in parts {
        body.appendMultipartLine("--\(boundary)")
        body.appendMultipartLine(
            "Content-Disposition: form-data; name=\"\(part.fieldName)\"; filename=\"\(part.filename)\""
        )
        body.appendMultipartLine("Content-Type: \(part.contentType)")
        body.appendMultipartLine("")
        body.append(part.bytes)
        body.appendMultipartLine("")
    }
    body.appendMultipartLine("--\(boundary)--")
    return body
}

private extension Data {
    mutating func appendMultipartLine(_ value: String) {
        append(Data(value.utf8))
        append(Data("\r\n".utf8))
    }
}

private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(_ value: Encodable) {
        encodeClosure = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}

private func parseErrorMessage(_ data: Data) -> String? {
    guard
        let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
        return String(data: data, encoding: .utf8)?.trimmedNonEmpty
    }
    return (json["message"] as? String)?.trimmedNonEmpty
        ?? (json["error"] as? String)?.trimmedNonEmpty
}

func buildQuery(_ values: [String: String?]) -> String {
    let pairs = values.compactMap { key, value -> String? in
        guard let value = value?.trimmedNonEmpty else { return nil }
        return "\(key.urlQueryEncoded)=\(value.urlQueryEncoded)"
    }
    return pairs.isEmpty ? "" : "?\(pairs.joined(separator: "&"))"
}

private func sessionLabel(for session: AuthSession) -> String {
    if session.authenticated, session.authRequired {
        return "Authenticated as \(session.username ?? "admin")"
    }
    if session.authenticated {
        return "Trusted \(session.mode) session"
    }
    return "Login required"
}

private func healthLabel(for health: SupervisorHealth) -> String {
    if health.supervisorConnected == true {
        return "Relay connected"
    }
    if health.supervisorConnected == false {
        return "Relay waiting for supervisor"
    }
    return "Supervisor \(health.status)"
}

private extension SupervisorHTTPResponse {
    var filenameFromHeaders: String? {
        let value = headers["Content-Disposition"] ?? headers["content-disposition"]
        guard let value else { return nil }
        return value
            .components(separatedBy: ";")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { $0.lowercased().hasPrefix("filename=") }?
            .dropFirst("filename=".count)
            .trimmingCharacters(in: CharacterSet(charactersIn: "\""))
    }
}
