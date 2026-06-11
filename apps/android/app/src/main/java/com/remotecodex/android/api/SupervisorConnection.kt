package com.remotecodex.android.api

enum class SupervisorConnectionMode(
    val storageKey: String,
    val label: String,
    val detail: String,
) {
    Local(
        storageKey = "local",
        label = "Intranet",
        detail = "Direct supervisor on localhost, LAN, or VPN. No login is normally required.",
    ),
    Server(
        storageKey = "server",
        label = "Server",
        detail = "Direct supervisor with admin login and bearer-token protected REST and WebSocket.",
    ),
    Relay(
        storageKey = "relay",
        label = "Relay",
        detail = "Public relay server forwarding to a private supervisor through an outbound tunnel.",
    );

    companion object {
        fun fromStorageKey(value: String?): SupervisorConnectionMode {
            return entries.firstOrNull { it.storageKey == value } ?: Local
        }
    }
}

data class SupervisorConnectionConfig(
    val mode: SupervisorConnectionMode,
    val baseUrl: String,
    val authToken: String? = null,
    val relayDeviceId: String? = null,
) {
    val normalizedBaseUrl: String = normalizeBaseUrl(baseUrl)

    fun restPath(path: String): String {
        val normalizedPath = if (path.startsWith("/")) path else "/$path"
        return when (mode) {
            SupervisorConnectionMode.Local,
            SupervisorConnectionMode.Server,
            -> normalizedPath
            SupervisorConnectionMode.Relay -> {
                val deviceId = relayDeviceId?.trim().orEmpty()
                if (deviceId.isNotEmpty()) {
                    "/relay/devices/${urlEncodePathSegment(deviceId)}$normalizedPath"
                } else {
                    "/relay$normalizedPath"
                }
            }
        }
    }

    fun websocketUrl(): String {
        val path = when (mode) {
            SupervisorConnectionMode.Local,
            SupervisorConnectionMode.Server,
            -> "/ws"
            SupervisorConnectionMode.Relay -> {
                val deviceId = relayDeviceId?.trim().orEmpty()
                if (deviceId.isNotEmpty()) {
                    "/relay/devices/${urlEncodePathSegment(deviceId)}/ws"
                } else {
                    "/relay/ws"
                }
            }
        }
        val wsBase = normalizedBaseUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
        val token = authToken?.trim().orEmpty()
        return if (token.isEmpty()) {
            "$wsBase$path"
        } else {
            "$wsBase$path?token=${urlEncodeQueryValue(token)}"
        }
    }
}

data class AuthSession(
    val authenticated: Boolean,
    val username: String?,
    val expiresAt: String?,
    val mode: String,
    val authRequired: Boolean,
)

data class AuthLoginResult(
    val token: String?,
    val session: AuthSession,
)

data class RelaySession(
    val authenticated: Boolean,
    val user: RelayUser?,
    val registrationEnabled: Boolean,
)

data class RelayUser(
    val id: String,
    val email: String,
    val username: String,
    val role: String,
    val enabled: Boolean,
)

data class RelayLoginResult(
    val token: String,
    val session: RelaySession,
)

data class SupervisorHealth(
    val status: String,
    val timestamp: String? = null,
    val supervisorConnected: Boolean? = null,
)

data class SupervisorConnectionCheck(
    val config: SupervisorConnectionConfig,
    val authenticated: Boolean,
    val authRequired: Boolean,
    val sessionLabel: String,
    val healthLabel: String,
    val websocketUrl: String,
)

data class SupervisorWorkspaceSummary(
    val id: String,
    val label: String,
    val absPath: String,
    val isFavorite: Boolean,
    val lastOpenedAt: String?,
)

data class SupervisorThreadSummary(
    val id: String,
    val workspaceId: String,
    val title: String,
    val status: String,
    val model: String?,
    val reasoningEffort: String?,
    val fastMode: Boolean,
    val collaborationMode: String,
    val sandboxMode: String?,
    val updatedAt: String,
    val summaryText: String?,
)

data class SupervisorHomeSnapshot(
    val workspaces: List<SupervisorWorkspaceSummary>,
    val threads: List<SupervisorThreadSummary>,
) {
    val activeThreadCount: Int = threads.count { it.status == "running" }
}

data class SupervisorWorkspaceTreeNode(
    val name: String,
    val path: String,
    val kind: String,
    val size: Long?,
    val children: List<SupervisorWorkspaceTreeNode> = emptyList(),
)

data class SupervisorWorkspaceFilePreview(
    val path: String,
    val name: String,
    val content: String,
    val language: String,
    val size: Long,
    val truncated: Boolean,
    val nextOffset: Long,
)

data class SupervisorShellSession(
    val id: String,
    val threadId: String,
    val workspaceId: String,
    val label: String?,
    val tmuxSessionName: String,
    val backend: String,
    val cwd: String,
    val status: String,
    val attachedViewerId: String?,
    val createdAt: String,
    val updatedAt: String,
    val lastActivityAt: String?,
)

data class SupervisorThreadShellState(
    val threadId: String,
    val workspaceId: String,
    val workspacePathStatus: String,
    val state: String,
    val shell: SupervisorShellSession?,
    val shells: List<SupervisorShellSession>,
    val activeShellId: String?,
)

data class CreateSupervisorShellRequest(
    val cols: Int? = null,
    val rows: Int? = null,
    val label: String? = null,
)

data class CreateSupervisorWorkspaceRequest(
    val absPath: String,
    val label: String? = null,
)

data class UpdateSupervisorWorkspaceRequest(
    val label: String,
)

data class StartSupervisorThreadRequest(
    val workspaceId: String,
    val title: String? = null,
    val model: String,
    val approvalMode: String = "yolo",
    val provider: String? = null,
)

data class SupervisorThreadTurnItem(
    val id: String,
    val kind: String,
    val text: String,
    val previewText: String? = null,
    val detailText: String? = null,
    val hasDeferredDetail: Boolean = false,
    val status: String? = null,
    val assetPath: String? = null,
    val changedFiles: Int? = null,
    val addedLines: Int? = null,
    val removedLines: Int? = null,
    val hookEventLabel: String? = null,
    val hookStatusMessage: String? = null,
    val hookOutput: String? = null,
    val artifactType: String? = null,
    val artifactTitle: String? = null,
    val artifactSummary: String? = null,
    val artifactHasRenderer: Boolean = true,
)

data class SupervisorThreadHistoryItemDetail(
    val id: String,
    val kind: String,
    val title: String,
    val text: String,
)

data class SupervisorTokenBreakdown(
    val inputTokens: Int,
    val cachedInputTokens: Int,
    val outputTokens: Int,
    val reasoningOutputTokens: Int,
)

data class SupervisorThreadTurnTokenUsage(
    val total: SupervisorTokenBreakdown,
    val last: SupervisorTokenBreakdown,
    val modelContextWindow: Int?,
)

data class SupervisorThreadTurn(
    val id: String,
    val startedAt: String?,
    val status: String,
    val error: String?,
    val model: String?,
    val tokenUsage: SupervisorThreadTurnTokenUsage?,
    val items: List<SupervisorThreadTurnItem>,
)

data class SupervisorThreadActionQuestionOption(
    val label: String,
    val description: String,
)

data class SupervisorThreadActionQuestion(
    val id: String,
    val header: String,
    val question: String,
    val multiSelect: Boolean,
    val isOther: Boolean,
    val options: List<SupervisorThreadActionQuestionOption>,
)

data class SupervisorThreadActionRequest(
    val id: String,
    val kind: String,
    val title: String,
    val description: String?,
    val createdAt: String,
    val questions: List<SupervisorThreadActionQuestion>,
)

data class SupervisorThreadAnsweredRequestNote(
    val id: String,
    val title: String,
    val summaryLines: List<String>,
    val createdAt: String,
)

data class SupervisorThreadDetail(
    val thread: SupervisorThreadSummary,
    val workspace: SupervisorWorkspaceSummary,
    val turns: List<SupervisorThreadTurn>,
    val turnCount: Int,
    val pendingRequests: List<SupervisorThreadActionRequest>,
    val answeredRequestNotes: List<SupervisorThreadAnsweredRequestNote>,
    val liveItemCount: Int,
    val goalStatus: String?,
    val goalObjective: String?,
) {
    val latestAgentMessage: String? = turns
        .asReversed()
        .asSequence()
        .flatMap { turn -> turn.items.asReversed().asSequence() }
        .firstOrNull { item -> item.kind == "agentMessage" && item.text.isNotBlank() }
        ?.text
}

data class SupervisorThreadForkTurnOption(
    val turnId: String,
    val turnIndex: Int,
    val startedAt: String?,
    val status: String,
)

data class ForkThreadRequest(
    val mode: String,
    val turnId: String? = null,
)

data class SupervisorThreadForkResult(
    val thread: SupervisorThreadDetail,
    val sourceThreadId: String,
    val sourceTurnId: String?,
    val sourceTurnIndex: Int?,
)

data class SupervisorThreadExportTurns(
    val turns: List<SupervisorThreadExportTurnOption>,
    val totalTurnCount: Int,
)

data class SupervisorThreadExportTurnOption(
    val turnId: String,
    val turnIndex: Int,
    val startedAt: String?,
    val status: String,
    val userPromptPreview: String,
)

data class ExportThreadRequest(
    val format: String = "pdf",
    val mode: String,
    val limit: Int? = null,
    val turnIds: List<String> = emptyList(),
    val profile: String = "review",
    val includeTokenAndPrice: Boolean = true,
    val includeCommandOutput: Boolean? = null,
    val includeAbsolutePaths: Boolean? = null,
)

data class SupervisorFileDownload(
    val filename: String,
    val contentType: String?,
    val bytes: ByteArray,
)

data class SupervisorWorkspaceRawFile(
    val path: String,
    val contentType: String?,
    val bytes: ByteArray,
) {
    val text: String
        get() = bytes.toString(Charsets.UTF_8)
}

data class UploadWorkspaceFileRequest(
    val filename: String,
    val bytes: ByteArray,
    val contentType: String = "text/plain",
)

data class SupervisorWorkspaceUploadResult(
    val kind: String,
    val file: SupervisorWorkspaceUploadedFile?,
    val archiveName: String?,
    val extractedCount: Int?,
    val paths: List<String>,
)

data class SupervisorWorkspaceUploadedFile(
    val path: String,
    val name: String,
    val size: Long,
)

data class SupervisorThreadSkills(
    val cwd: String,
    val skills: List<SupervisorAgentSkill>,
    val errors: List<SupervisorAgentSkillError>,
)

data class SupervisorAgentSkill(
    val name: String,
    val description: String,
    val shortDescription: String?,
    val interfaceShortDescription: String?,
    val path: String,
    val scope: String,
    val enabled: Boolean,
)

data class SupervisorAgentSkillError(
    val path: String,
    val message: String,
)

data class SupervisorThreadMcpServers(
    val servers: List<SupervisorAgentMcpServer>,
)

data class SupervisorAgentMcpServer(
    val name: String,
    val authStatus: String,
    val tools: List<SupervisorAgentMcpTool>,
    val resourceCount: Int,
    val resourceTemplateCount: Int,
)

data class SupervisorAgentMcpTool(
    val name: String,
    val title: String?,
    val description: String?,
)

data class SupervisorThreadHooks(
    val cwd: String,
    val hooks: List<SupervisorAgentHook>,
    val warnings: List<String>,
    val errors: List<SupervisorAgentHookError>,
    val globalHooksPath: String,
    val projectHooksPath: String,
)

data class SupervisorAgentHook(
    val key: String,
    val eventName: String,
    val handlerType: String,
    val matcher: String?,
    val command: String?,
    val timeoutSec: Int,
    val statusMessage: String?,
    val sourcePath: String,
    val source: String,
    val pluginId: String?,
    val displayOrder: Int,
    val enabled: Boolean,
    val isManaged: Boolean,
    val currentHash: String?,
    val trustStatus: String,
)

data class SupervisorAgentHookError(
    val path: String,
    val message: String,
)

data class TrustThreadHookRequest(
    val key: String,
    val currentHash: String,
)

data class UntrustThreadHookRequest(
    val key: String,
)

data class SendThreadPromptRequest(
    val prompt: String,
    val clientRequestId: String? = null,
    val model: String? = null,
    val attachments: List<PromptAttachmentUploadRequest> = emptyList(),
)

data class PromptAttachmentUploadRequest(
    val clientId: String,
    val kind: String,
    val originalName: String,
    val placeholder: String,
    val bytes: ByteArray,
    val contentType: String = "application/octet-stream",
)

data class UpdateThreadRequest(
    val title: String,
)

data class UpdateThreadSettingsRequest(
    val model: String? = null,
    val reasoningEffort: String? = null,
    val fastMode: Boolean? = null,
    val collaborationMode: String? = null,
    val sandboxMode: String? = null,
)

data class UpdateThreadGoalRequest(
    val objective: String? = null,
    val status: String? = null,
    val tokenBudget: Int? = null,
)

data class RespondThreadRequestAnswer(
    val answers: List<String>,
)

data class RespondThreadRequest(
    val answers: Map<String, RespondThreadRequestAnswer>,
)

data class RelayDeviceSummary(
    val id: String,
    val name: String,
    val tokenPreview: String,
    val connected: Boolean,
    val connectedAt: String?,
    val lastHeartbeatAt: String?,
    val createdAt: String,
)

data class RelayPortalSummary(
    val devices: List<RelayDeviceSummary>,
)

data class RelayCreateDeviceResult(
    val device: RelayDeviceSummary,
    val token: String,
)

sealed class SupervisorClientError(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class InvalidUrl(message: String) : SupervisorClientError(message)
    class Authentication(message: String) : SupervisorClientError(message)
    class Http(val statusCode: Int, message: String, val responseBody: String?) : SupervisorClientError(message)
    class Network(message: String, cause: Throwable) : SupervisorClientError(message, cause)
    class Parse(message: String, cause: Throwable? = null) : SupervisorClientError(message, cause)
}

fun normalizeBaseUrl(input: String): String {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) {
        throw SupervisorClientError.InvalidUrl("Supervisor URL is required.")
    }
    val withScheme = if ("://" in trimmed) trimmed else "http://$trimmed"
    val withoutTrailing = withScheme.trimEnd('/')
    if (!withoutTrailing.startsWith("http://") && !withoutTrailing.startsWith("https://")) {
        throw SupervisorClientError.InvalidUrl("URL must use http or https.")
    }
    return withoutTrailing
}

private fun urlEncodePathSegment(value: String): String {
    return java.net.URLEncoder.encode(value, Charsets.UTF_8.name()).replace("+", "%20")
}

private fun urlEncodeQueryValue(value: String): String {
    return java.net.URLEncoder.encode(value, Charsets.UTF_8.name())
}
