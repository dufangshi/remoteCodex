import Foundation

struct AuthSession: Codable, Equatable {
    var authenticated: Bool
    var username: String?
    var expiresAt: String?
    var mode: String
    var authRequired: Bool
}

struct AuthLoginResult: Codable, Equatable {
    var token: String?
    var session: AuthSession
}

struct RelaySession: Codable, Equatable {
    var authenticated: Bool
    var user: RelayUser?
    var registrationEnabled: Bool

    func toAuthSession() -> AuthSession {
        AuthSession(
            authenticated: authenticated,
            username: user?.username,
            expiresAt: nil,
            mode: "relay",
            authRequired: true
        )
    }
}

struct RelayUser: Codable, Equatable {
    var id: String
    var email: String
    var username: String
    var role: String
    var enabled: Bool
}

struct RelayLoginResult: Codable, Equatable {
    var token: String
    var session: RelaySession
}

struct SupervisorHealth: Codable, Equatable {
    var status: String
    var timestamp: String?
    var supervisorConnected: Bool?
}

struct SupervisorConnectionCheck: Equatable {
    var config: SupervisorConnectionConfig
    var authenticated: Bool
    var authRequired: Bool
    var sessionMode: String
    var sessionLabel: String
    var healthLabel: String
    var websocketURL: String
}

struct SupervisorWorkspaceSummary: Codable, Equatable, Identifiable {
    var id: String
    var label: String
    var absPath: String
    var isFavorite: Bool
    var lastOpenedAt: String?
}

struct SupervisorThreadSummary: Codable, Equatable, Identifiable {
    var id: String
    var workspaceId: String
    var provider: String
    var title: String
    var status: String
    var model: String?
    var reasoningEffort: String?
    var fastMode: Bool
    var collaborationMode: String
    var sandboxMode: String?
    var updatedAt: String
    var summaryText: String?
    var isLoaded: Bool?
}

struct SupervisorHomeSnapshot: Equatable {
    var workspaces: [SupervisorWorkspaceSummary]
    var threads: [SupervisorThreadSummary]

    var activeThreadCount: Int {
        threads.count(where: { $0.status == "running" })
    }
}

struct CreateSupervisorWorkspaceRequest: Codable, Equatable {
    var absPath: String
    var label: String?
}

struct UpdateSupervisorWorkspaceRequest: Codable, Equatable {
    var label: String
}

struct DeleteSupervisorWorkspaceRequest: Codable, Equatable {
    var confirmWorkspaceId: String
    var confirmLabel: String
}

struct DeletedResource: Codable, Equatable {
    var id: String
}

struct StartSupervisorThreadRequest: Codable, Equatable {
    var workspaceId: String
    var title: String?
    var provider: String?
    var model: String
    var reasoningEffort: String?
    var approvalMode: String
}

struct ImportSupervisorThreadRequest: Codable, Equatable {
    var sessionId: String
    var provider: String?
}

struct SendThreadPromptRequest: Codable, Equatable {
    var prompt: String
    var clientRequestId: String?
    var model: String?
    var reasoningEffort: String?
    var collaborationMode: String?
    var sandboxMode: String?
}

struct PromptAttachmentUploadRequest: Equatable {
    var clientId: String
    var kind: String
    var originalName: String
    var placeholder: String
    var bytes: Data
    var contentType: String
}

struct SendThreadPromptUploadRequest: Equatable {
    var prompt: String
    var clientRequestId: String?
    var model: String?
    var reasoningEffort: String?
    var collaborationMode: String?
    var sandboxMode: String?
    var attachments: [PromptAttachmentUploadRequest]
}

struct ResumeThreadRequest: Codable, Equatable {
    var model: String?
    var sandboxMode: String?
}

struct UpdateThreadRequest: Codable, Equatable {
    var title: String
}

struct UpdateThreadSettingsRequest: Codable, Equatable {
    var model: String?
    var reasoningEffort: String?
    var fastMode: Bool?
    var collaborationMode: String?
    var sandboxMode: String?
}

struct InterruptThreadRequest: Codable, Equatable {
    var turnId: String?
}

struct UpdateThreadGoalRequest: Codable, Equatable {
    var objective: String?
    var status: String?
    var tokenBudget: Int?
}

struct ForkThreadRequest: Codable, Equatable {
    var mode: String
    var turnId: String?
}

struct RespondThreadRequestAnswer: Codable, Equatable {
    var answers: [String]
}

struct RespondThreadRequest: Codable, Equatable {
    var answers: [String: RespondThreadRequestAnswer]
}

struct ExportThreadRequest: Equatable {
    var format: String
    var mode: String
    var limit: Int?
    var turnIds: [String]
    var profile: String
    var includeTokenAndPrice: Bool
    var includeCommandOutput: Bool?
    var includeAbsolutePaths: Bool?
}

struct ThreadGoalResponse: Codable, Equatable {
    var goal: SupervisorThreadGoal?
}

struct ClearThreadGoalResponse: Codable, Equatable {
    var cleared: Bool
    var goalHistory: [SupervisorThreadGoal]?
}

struct SupervisorThreadGoal: Codable, Equatable, Identifiable {
    var id: String {
        localGoalId ?? "\(threadId):\(createdAt)"
    }

    var threadId: String
    var localGoalId: String?
    var objective: String
    var status: String
    var tokenBudget: Int?
    var tokensUsed: Int
    var timeUsedSeconds: Int
    var createdAt: String
    var updatedAt: String
    var completedAt: String?
}

struct SupervisorThreadForkTurnOption: Codable, Equatable, Identifiable {
    var id: String {
        turnId
    }

    var turnId: String
    var turnIndex: Int
    var startedAt: String?
    var status: String
}

struct SupervisorThreadForkResult: Codable, Equatable {
    var thread: SupervisorThreadDetail
    var sourceThreadId: String
    var sourceTurnId: String?
    var sourceTurnIndex: Int?
}

struct SupervisorThreadExportTurns: Codable, Equatable {
    var turns: [SupervisorThreadExportTurnOption]
    var totalTurnCount: Int
}

struct SupervisorThreadExportTurnOption: Codable, Equatable, Identifiable {
    var id: String {
        turnId
    }

    var turnId: String
    var turnIndex: Int?
    var turnNumber: Int?
    var startedAt: String?
    var status: String
    var userPromptPreview: String
}

struct SupervisorThreadSkills: Codable, Equatable {
    var cwd: String
    var skills: [SupervisorAgentSkill]
    var errors: [SupervisorAgentSkillError]
}

struct SupervisorAgentSkill: Codable, Equatable, Identifiable {
    var id: String {
        "\(scope):\(name):\(path)"
    }

    var name: String
    var description: String
    var shortDescription: String?
    var interfaceShortDescription: String?
    var path: String
    var scope: String
    var enabled: Bool

    enum CodingKeys: String, CodingKey {
        case name
        case description
        case shortDescription
        case interface
        case path
        case scope
        case enabled
    }

    enum InterfaceCodingKeys: String, CodingKey {
        case shortDescription
    }

    init(
        name: String,
        description: String,
        shortDescription: String?,
        interfaceShortDescription: String?,
        path: String,
        scope: String,
        enabled: Bool
    ) {
        self.name = name
        self.description = description
        self.shortDescription = shortDescription
        self.interfaceShortDescription = interfaceShortDescription
        self.path = path
        self.scope = scope
        self.enabled = enabled
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        description = try container.decode(String.self, forKey: .description)
        shortDescription = try container.decodeIfPresent(String.self, forKey: .shortDescription)
        path = try container.decode(String.self, forKey: .path)
        scope = try container.decode(String.self, forKey: .scope)
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        let interface = try? container.nestedContainer(keyedBy: InterfaceCodingKeys.self, forKey: .interface)
        interfaceShortDescription = try interface?.decodeIfPresent(String.self, forKey: .shortDescription)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(name, forKey: .name)
        try container.encode(description, forKey: .description)
        try container.encodeIfPresent(shortDescription, forKey: .shortDescription)
        try container.encode(path, forKey: .path)
        try container.encode(scope, forKey: .scope)
        try container.encode(enabled, forKey: .enabled)
        if interfaceShortDescription != nil {
            var interface = container.nestedContainer(keyedBy: InterfaceCodingKeys.self, forKey: .interface)
            try interface.encodeIfPresent(interfaceShortDescription, forKey: .shortDescription)
        }
    }
}

struct SupervisorAgentSkillError: Codable, Equatable, Identifiable {
    var id: String {
        "\(path):\(message)"
    }

    var path: String
    var message: String
}

struct SupervisorThreadMcpServers: Codable, Equatable {
    var servers: [SupervisorAgentMcpServer]
}

struct SupervisorAgentMcpServer: Codable, Equatable, Identifiable {
    var id: String {
        name
    }

    var name: String
    var authStatus: String
    var tools: [SupervisorAgentMcpTool]
    var resourceCount: Int
    var resourceTemplateCount: Int
}

struct SupervisorAgentMcpTool: Codable, Equatable, Identifiable {
    var id: String {
        name
    }

    var name: String
    var title: String?
    var description: String?
}

struct SupervisorThreadHooks: Codable, Equatable {
    var cwd: String
    var hooks: [SupervisorAgentHook]
    var warnings: [String]
    var errors: [SupervisorAgentHookError]
    var globalHooksPath: String
    var projectHooksPath: String
}

struct SupervisorAgentHook: Codable, Equatable, Identifiable {
    var id: String {
        key
    }

    var key: String
    var eventName: String
    var handlerType: String
    var matcher: String?
    var command: String?
    var timeoutSec: Int
    var statusMessage: String?
    var sourcePath: String
    var source: String
    var pluginId: String?
    var displayOrder: Int
    var enabled: Bool
    var isManaged: Bool
    var currentHash: String?
    var trustStatus: String
}

struct SupervisorAgentHookError: Codable, Equatable, Identifiable {
    var id: String {
        "\(path):\(message)"
    }

    var path: String
    var message: String
}

struct TrustThreadHookRequest: Codable, Equatable {
    var key: String
    var currentHash: String
}

struct UntrustThreadHookRequest: Codable, Equatable {
    var key: String
}

struct UpdateSupervisorWorkspaceSettingsRequest: Codable, Equatable {
    var devHome: String
    var defaultBackend: String?
}

struct SupervisorRuntimeConfig: Codable, Equatable {
    var appName: String
    var appVersion: String
    var mode: String
    var host: String
    var port: Int
    var workspaceRoot: String
    var environment: String
}

struct SupervisorWorkspaceSettings: Codable, Equatable {
    var workspaceRoot: String
    var devHome: String
    var defaultBackend: String
}

struct SupervisorAgentBackend: Codable, Equatable, Identifiable {
    var id: String {
        provider
    }

    var provider: String
    var displayName: String
    var description: String
    var enabled: Bool
    var isDefault: Bool
    var statusState: String
    var statusDetail: String?
    var installed: Bool
    var installedVersion: String?
    var latestVersion: String?
    var installAvailable: Bool
    var updateAvailable: Bool
    var busy: Bool
    var lastError: String?
    var configArchives: Bool
    var buildRestart: Bool

    enum CodingKeys: String, CodingKey {
        case provider
        case displayName
        case description
        case enabled
        case isDefault
        case status
        case statusState
        case statusDetail
        case installation
        case installed
        case installedVersion
        case latestVersion
        case installAvailable
        case updateAvailable
        case busy
        case lastError
        case managementSchema
        case configArchives
        case buildRestart
    }

    enum StatusCodingKeys: String, CodingKey {
        case state
        case detail
        case message
    }

    enum InstallationCodingKeys: String, CodingKey {
        case installed
        case installedVersion
        case latestVersion
        case installCommand
        case updateCommand
        case busy
        case lastError
    }

    enum ManagementSchemaCodingKeys: String, CodingKey {
        case configArchives
        case buildRestart
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        provider = try container.decode(String.self, forKey: .provider)
        displayName = try container.decode(String.self, forKey: .displayName)
        description = try container.decode(String.self, forKey: .description)
        enabled = try container.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        isDefault = try container.decodeIfPresent(Bool.self, forKey: .isDefault) ?? false

        if let status = try? container.nestedContainer(keyedBy: StatusCodingKeys.self, forKey: .status) {
            statusState = try status.decodeIfPresent(String.self, forKey: .state) ?? "unknown"
            statusDetail = try status.decodeIfPresent(String.self, forKey: .detail)
                ?? status.decodeIfPresent(String.self, forKey: .message)
        } else {
            statusState = try container.decodeIfPresent(String.self, forKey: .statusState) ?? "unknown"
            statusDetail = try container.decodeIfPresent(String.self, forKey: .statusDetail)
        }

        if let installation = try? container.nestedContainer(keyedBy: InstallationCodingKeys.self, forKey: .installation) {
            installed = try installation.decodeIfPresent(Bool.self, forKey: .installed) ?? false
            installedVersion = try installation.decodeIfPresent(String.self, forKey: .installedVersion)
            latestVersion = try installation.decodeIfPresent(String.self, forKey: .latestVersion)
            installAvailable = try installation.decodeIfPresent(String.self, forKey: .installCommand) != nil
            updateAvailable = try installation.decodeIfPresent(String.self, forKey: .updateCommand) != nil
            busy = try installation.decodeIfPresent(Bool.self, forKey: .busy) ?? false
            lastError = try installation.decodeIfPresent(String.self, forKey: .lastError)
        } else {
            installed = try container.decodeIfPresent(Bool.self, forKey: .installed) ?? false
            installedVersion = try container.decodeIfPresent(String.self, forKey: .installedVersion)
            latestVersion = try container.decodeIfPresent(String.self, forKey: .latestVersion)
            installAvailable = try container.decodeIfPresent(Bool.self, forKey: .installAvailable) ?? false
            updateAvailable = try container.decodeIfPresent(Bool.self, forKey: .updateAvailable) ?? false
            busy = try container.decodeIfPresent(Bool.self, forKey: .busy) ?? false
            lastError = try container.decodeIfPresent(String.self, forKey: .lastError)
        }

        if let managementSchema = try? container.nestedContainer(keyedBy: ManagementSchemaCodingKeys.self, forKey: .managementSchema) {
            configArchives = try managementSchema.decodeIfPresent(Bool.self, forKey: .configArchives) ?? false
            buildRestart = try managementSchema.decodeIfPresent(Bool.self, forKey: .buildRestart) ?? false
        } else {
            configArchives = try container.decodeIfPresent(Bool.self, forKey: .configArchives) ?? false
            buildRestart = try container.decodeIfPresent(Bool.self, forKey: .buildRestart) ?? false
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(provider, forKey: .provider)
        try container.encode(displayName, forKey: .displayName)
        try container.encode(description, forKey: .description)
        try container.encode(enabled, forKey: .enabled)
        try container.encode(isDefault, forKey: .isDefault)
        try container.encode(statusState, forKey: .statusState)
        try container.encodeIfPresent(statusDetail, forKey: .statusDetail)
        try container.encode(installed, forKey: .installed)
        try container.encodeIfPresent(installedVersion, forKey: .installedVersion)
        try container.encodeIfPresent(latestVersion, forKey: .latestVersion)
        try container.encode(installAvailable, forKey: .installAvailable)
        try container.encode(updateAvailable, forKey: .updateAvailable)
        try container.encode(busy, forKey: .busy)
        try container.encodeIfPresent(lastError, forKey: .lastError)
        try container.encode(configArchives, forKey: .configArchives)
        try container.encode(buildRestart, forKey: .buildRestart)
    }
}

extension SupervisorAgentBackend {
    var canStartSession: Bool {
        enabled
    }

    var runtimeActionLabel: String? {
        if installed, updateAvailable { return "Update" }
        if !installed, installAvailable { return "Install" }
        return nil
    }
}

struct SupervisorModelOption: Codable, Equatable, Identifiable {
    var id: String
    var model: String
    var displayName: String
    var description: String
    var isDefault: Bool
    var hidden: Bool
    var supportedReasoningEfforts: [SupervisorReasoningEffortOption]
    var defaultReasoningEffort: String?
}

struct SupervisorReasoningEffortOption: Codable, Equatable {
    var reasoningEffort: String
    var description: String?
}

struct RelayPortalSummary: Codable, Equatable {
    var session: RelaySession?
    var devices: [RelayDeviceSummary]
    var sharedWithMe: [RelaySessionShareSummary]
    var sharedByMe: [RelaySessionShareSummary]

    enum CodingKeys: String, CodingKey {
        case session
        case devices
        case sharedWithMe
        case sharedByMe
    }

    init(
        session: RelaySession? = nil,
        devices: [RelayDeviceSummary],
        sharedWithMe: [RelaySessionShareSummary] = [],
        sharedByMe: [RelaySessionShareSummary] = []
    ) {
        self.session = session
        self.devices = devices
        self.sharedWithMe = sharedWithMe
        self.sharedByMe = sharedByMe
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        session = try container.decodeIfPresent(RelaySession.self, forKey: .session)
        devices = try container.decodeIfPresent([RelayDeviceSummary].self, forKey: .devices) ?? []
        sharedWithMe = try container.decodeIfPresent([RelaySessionShareSummary].self, forKey: .sharedWithMe) ?? []
        sharedByMe = try container.decodeIfPresent([RelaySessionShareSummary].self, forKey: .sharedByMe) ?? []
    }
}

struct RelaySessionShareSummary: Codable, Equatable, Identifiable {
    var id: String
    var ownerUserId: String
    var ownerUsername: String
    var targetUsername: String
    var targetUserId: String
    var deviceId: String
    var deviceName: String
    var threadId: String
    var threadTitle: String?
    var workspaceId: String?
    var workspaceLabel: String?
    var label: String?
    var threadAccess: String
    var workspaceAccess: String
    var createdAt: String
    var revokedAt: String?
    var expiresAt: String?
    var lastAccessedAt: String?
    var lastAccessedByUsername: String?
    var accessEvents: [RelaySessionShareAccessSummary]

    enum CodingKeys: String, CodingKey {
        case id
        case ownerUserId
        case ownerUsername
        case targetUsername
        case targetUserId
        case deviceId
        case deviceName
        case threadId
        case threadTitle
        case workspaceId
        case workspaceLabel
        case label
        case threadAccess
        case workspaceAccess
        case createdAt
        case revokedAt
        case expiresAt
        case lastAccessedAt
        case lastAccessedByUsername
        case accessEvents
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        ownerUserId = try container.decodeIfPresent(String.self, forKey: .ownerUserId) ?? ""
        ownerUsername = try container.decodeIfPresent(String.self, forKey: .ownerUsername) ?? "unknown"
        targetUsername = try container.decodeIfPresent(String.self, forKey: .targetUsername) ?? "unknown"
        targetUserId = try container.decodeIfPresent(String.self, forKey: .targetUserId) ?? ""
        deviceId = try container.decode(String.self, forKey: .deviceId)
        deviceName = try container.decodeIfPresent(String.self, forKey: .deviceName) ?? "Remote Codex device"
        threadId = try container.decode(String.self, forKey: .threadId)
        threadTitle = try container.decodeIfPresent(String.self, forKey: .threadTitle)
        workspaceId = try container.decodeIfPresent(String.self, forKey: .workspaceId)
        workspaceLabel = try container.decodeIfPresent(String.self, forKey: .workspaceLabel)
        label = try container.decodeIfPresent(String.self, forKey: .label)
        threadAccess = try container.decodeIfPresent(String.self, forKey: .threadAccess) ?? "read"
        workspaceAccess = try container.decodeIfPresent(String.self, forKey: .workspaceAccess) ?? "none"
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        revokedAt = try container.decodeIfPresent(String.self, forKey: .revokedAt)
        expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)
        lastAccessedAt = try container.decodeIfPresent(String.self, forKey: .lastAccessedAt)
        lastAccessedByUsername = try container.decodeIfPresent(String.self, forKey: .lastAccessedByUsername)
        accessEvents = try container.decodeIfPresent([RelaySessionShareAccessSummary].self, forKey: .accessEvents) ?? []
    }
}

struct RelaySessionShareAccessSummary: Codable, Equatable, Identifiable {
    var id: String
    var shareId: String
    var userId: String
    var username: String
    var accessedAt: String
}

struct RelayDeviceSummary: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var online: Bool
    var token: String?
    var tokenPreview: String?
    var createdAt: String?
    var connectedAt: String?
    var lastHeartbeatAt: String?
    var lastSeenAt: String?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case online
        case connected
        case token
        case tokenPreview
        case createdAt
        case connectedAt
        case lastHeartbeatAt
        case lastSeenAt
    }

    init(
        id: String,
        name: String,
        online: Bool,
        token: String? = nil,
        tokenPreview: String? = nil,
        createdAt: String? = nil,
        connectedAt: String? = nil,
        lastHeartbeatAt: String? = nil,
        lastSeenAt: String? = nil
    ) {
        self.id = id
        self.name = name
        self.online = online
        self.token = token
        self.tokenPreview = tokenPreview
        self.createdAt = createdAt
        self.connectedAt = connectedAt
        self.lastHeartbeatAt = lastHeartbeatAt
        self.lastSeenAt = lastSeenAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        online = try container.decodeIfPresent(Bool.self, forKey: .online)
            ?? container.decodeIfPresent(Bool.self, forKey: .connected)
            ?? false
        token = try container.decodeIfPresent(String.self, forKey: .token)
        tokenPreview = try container.decodeIfPresent(String.self, forKey: .tokenPreview)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        connectedAt = try container.decodeIfPresent(String.self, forKey: .connectedAt)
        lastHeartbeatAt = try container.decodeIfPresent(String.self, forKey: .lastHeartbeatAt)
        lastSeenAt = try container.decodeIfPresent(String.self, forKey: .lastSeenAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(online, forKey: .online)
        try container.encodeIfPresent(token, forKey: .token)
        try container.encodeIfPresent(tokenPreview, forKey: .tokenPreview)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(connectedAt, forKey: .connectedAt)
        try container.encodeIfPresent(lastHeartbeatAt, forKey: .lastHeartbeatAt)
        try container.encodeIfPresent(lastSeenAt, forKey: .lastSeenAt)
    }
}

struct RelayCreateDeviceResult: Codable, Equatable {
    var device: RelayDeviceSummary
    var token: String
    var command: String?
}

struct SupervisorPluginSummary: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var version: String?
    var description: String?
    var remoteCodex: String?
    var enabled: Bool
    var source: String?
    var capabilities: SupervisorPluginCapabilities?
}

struct SupervisorPluginCapabilities: Codable, Equatable {
    var artifactTypes: [SupervisorPluginArtifactType]?
    var timelineRenderers: [String]?
    var threadPanels: [SupervisorPluginThreadPanel]?
    var modelHints: [SupervisorPluginModelHint]?
    var mcpServers: [SupervisorPluginMcpServer]?
    var frontend: SupervisorPluginFrontend?
    var backend: SupervisorPluginBackend?
}

struct SupervisorPluginArtifactType: Codable, Equatable {
    var type: String
    var title: String
    var fileExtensions: [String]?
}

struct SupervisorPluginThreadPanel: Codable, Equatable {
    var id: String
    var label: String
    var kind: String?
    var artifactTypes: [String]
}

struct SupervisorPluginModelHint: Codable, Equatable {
    var id: String
    var text: String
}

struct SupervisorPluginMcpServer: Codable, Equatable {
    var id: String
    var name: String
    var command: String
    var args: [String]?
    var env: [String: String]?
}

struct SupervisorPluginFrontend: Codable, Equatable {
    var entry: String?
    var style: String?
}

struct SupervisorPluginBackend: Codable, Equatable {
    var entry: String?
}

struct ImportSupervisorPluginRequest: Codable, Equatable {
    var manifestJson: String
    var enabled: Bool
}

struct UpdateSupervisorPluginRequest: Codable, Equatable {
    var enabled: Bool
}

struct SupervisorWorkspaceTreeNode: Codable, Equatable {
    var name: String
    var path: String
    var kind: String
    var size: Int64?
    var children: [SupervisorWorkspaceTreeNode]?
}

struct SupervisorWorkspaceFilePreview: Codable, Equatable {
    var path: String
    var name: String
    var content: String
    var language: String
    var size: Int64
    var truncated: Bool
    var nextOffset: Int64
}

struct SupervisorWorkspaceFile: Codable, Equatable {
    var path: String
    var name: String
    var kind: String
    var size: Int64
}

struct WriteWorkspaceFileRequest: Codable, Equatable {
    var path: String
    var content: String
}

struct UploadWorkspaceFileRequest: Equatable {
    var filename: String
    var contentType: String
    var bytes: Data
    var path: String?
}

struct SupervisorWorkspaceUploadResult: Codable, Equatable {
    var kind: String?
    var file: SupervisorWorkspaceFile?
    var path: String?
    var name: String?
    var size: Int64?
}

struct SupervisorWorkspaceRawFile: Equatable {
    var path: String
    var contentType: String?
    var bytes: Data

    var text: String? {
        String(data: bytes, encoding: .utf8)
    }
}

struct SupervisorFileDownload: Equatable {
    var filename: String
    var contentType: String?
    var bytes: Data
}

struct SupervisorThreadDetail: Codable, Equatable {
    var thread: SupervisorThreadSummary
    var workspace: SupervisorWorkspaceSummary
    var turns: [SupervisorThreadTurn]
    var pendingRequests: [SupervisorThreadActionRequest]?
    var answeredRequestNotes: [SupervisorThreadAnsweredRequestNote]?
    var activityNotes: [SupervisorThreadActivityNote]?
    var turnCount: Int?
    var totalTurnCount: Int?
    var liveItemCount: Int?
    var contextUsage: SupervisorThreadContextUsage?
    var goalStatus: String?
    var goalObjective: String?
    var livePlan: SupervisorThreadLivePlan?
}

extension SupervisorThreadDetail {
    init(
        thread: SupervisorThreadSummary,
        workspace: SupervisorWorkspaceSummary,
        turns: [SupervisorThreadTurn],
        pendingRequests: [SupervisorThreadActionRequest]?,
        answeredRequestNotes: [SupervisorThreadAnsweredRequestNote]?,
        turnCount: Int?,
        totalTurnCount: Int?,
        liveItemCount: Int?,
        contextUsage: SupervisorThreadContextUsage?,
        goalStatus: String?,
        goalObjective: String?
    ) {
        self.init(
            thread: thread,
            workspace: workspace,
            turns: turns,
            pendingRequests: pendingRequests,
            answeredRequestNotes: answeredRequestNotes,
            activityNotes: nil,
            turnCount: turnCount,
            totalTurnCount: totalTurnCount,
            liveItemCount: liveItemCount,
            contextUsage: contextUsage,
            goalStatus: goalStatus,
            goalObjective: goalObjective,
            livePlan: nil
        )
    }
}

struct SupervisorThreadTurn: Codable, Equatable, Identifiable {
    var id: String
    var startedAt: String?
    var status: String
    var error: String?
    var model: String?
    var tokenUsage: SupervisorThreadTurnTokenUsage?
    var items: [SupervisorThreadTurnItem]
}

struct SupervisorThreadTurnItem: Codable, Equatable, Identifiable {
    var id: String
    var kind: String
    var text: String?
    var status: String?
    var sequence: Int?
    var callId: String?
    var toolName: String?
    var payload: [String: JSONValue]?
}

struct SupervisorThreadHistoryItemDetail: Codable, Equatable, Identifiable {
    var id: String
    var kind: String
    var title: String
    var text: String
    var contentType: String?
    var sourcePath: String?
    var assetPath: String?
}

struct SupervisorThreadTurnTokenUsage: Codable, Equatable {
    var inputTokens: Int?
    var outputTokens: Int?
    var totalTokens: Int?
}

struct SupervisorThreadContextUsage: Codable, Equatable {
    var availability: String?
    var remainingPercent: Int?
    var tokensInContextWindow: Int?
    var modelContextWindow: Int?
    var updatedAt: String?
    var usedTokens: Int?
    var maxTokens: Int?
    var percent: Double?
}

struct SupervisorThreadLivePlan: Codable, Equatable {
    var turnId: String
    var explanation: String?
    var plan: [SupervisorThreadLivePlanStep]
    var updatedAt: String?
}

struct SupervisorThreadLivePlanStep: Codable, Equatable {
    var step: String
    var status: String
}

struct SupervisorThreadActionRequest: Codable, Equatable, Identifiable {
    var id: String
    var kind: String
    var status: String?
    var title: String?
    var description: String?
    var createdAt: String?
    var questions: [SupervisorThreadActionQuestion]?
    var turnId: String?
    var itemId: String?
    var payload: [String: JSONValue]?
}

struct SupervisorThreadAnsweredRequestNote: Codable, Equatable, Identifiable {
    var id: String
    var requestId: String?
    var title: String?
    var summaryLines: [String]?
    var turnId: String?
    var itemId: String?
    var createdAt: String?
    var summary: String?
}

struct SupervisorThreadActivityNote: Codable, Equatable, Identifiable {
    var id: String
    var kind: String
    var createdAt: String
    var text: String?
    var anchorTurnId: String?
    var linkedThreadId: String?
    var linkedThreadTitle: String?
    var turnIndex: Int?
}

struct SupervisorThreadActionQuestion: Codable, Equatable, Identifiable {
    var id: String
    var header: String
    var question: String
    var multiSelect: Bool
    var isOther: Bool
    var options: [SupervisorThreadActionQuestionOption]
}

struct SupervisorThreadActionQuestionOption: Codable, Equatable, Identifiable {
    var id: String {
        label
    }

    var label: String
    var description: String
}
