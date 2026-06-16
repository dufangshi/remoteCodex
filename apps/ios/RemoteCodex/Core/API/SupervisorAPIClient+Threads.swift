import Foundation

extension SupervisorAPIClient {
    func fetchThreadDetail(
        threadId: String,
        limit: Int? = nil,
        beforeTurnId: String? = nil
    ) async throws -> SupervisorThreadDetail {
        let query = buildQuery([
            "limit": limit.map(String.init),
            "beforeTurnId": beforeTurnId
        ])
        return try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)\(query)")
        )
    }

    func sendThreadPrompt(threadId: String, request: SendThreadPromptRequest) async throws -> SupervisorThreadSummary {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/prompt"),
            method: "POST",
            body: request
        )
    }

    func sendThreadPromptUpload(
        threadId: String,
        request: SendThreadPromptUploadRequest
    ) async throws -> SupervisorThreadSummary {
        var fields = [
            "prompt": request.prompt,
            "clientRequestId": request.clientRequestId,
            "model": request.model,
            "reasoningEffort": request.reasoningEffort,
            "collaborationMode": request.collaborationMode,
            "sandboxMode": request.sandboxMode,
            "attachmentManifest": request.attachmentManifestJSON
        ].compactMapValues { $0?.trimmedNonEmpty }
        if request.attachments.isEmpty {
            fields.removeValue(forKey: "attachmentManifest")
        }
        return try await requestMultipartJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/prompt"),
            parts: request.attachments.map { attachment in
                SupervisorMultipartPart(
                    fieldName: "attachments",
                    filename: attachment.originalName,
                    contentType: attachment.contentType,
                    bytes: attachment.bytes
                )
            },
            fields: fields
        )
    }

    func resumeThread(
        threadId: String,
        request: ResumeThreadRequest = ResumeThreadRequest(model: nil, sandboxMode: nil)
    ) async throws -> SupervisorThreadDetail {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/resume"),
            method: "POST",
            body: request
        )
    }

    func updateThread(threadId: String, request: UpdateThreadRequest) async throws -> SupervisorThreadSummary {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)"),
            method: "PATCH",
            body: request
        )
    }

    func deleteThread(threadId: String) async throws -> SupervisorThreadSummary {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)"),
            method: "DELETE"
        )
    }

    func updateThreadSettings(
        threadId: String,
        request: UpdateThreadSettingsRequest
    ) async throws -> SupervisorThreadSummary {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/settings"),
            method: "PATCH",
            body: request
        )
    }

    func interruptThread(threadId: String, turnId: String? = nil) async throws -> SupervisorThreadSummary {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/interrupt"),
            method: "POST",
            body: InterruptThreadRequest(turnId: turnId)
        )
    }

    func compactThread(threadId: String) async throws -> SupervisorThreadSummary {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/compact"),
            method: "POST"
        )
    }

    func fetchThreadGoal(threadId: String) async throws -> ThreadGoalResponse {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/goal")
        )
    }

    func updateThreadGoal(threadId: String, request: UpdateThreadGoalRequest) async throws -> ThreadGoalResponse {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/goal"),
            method: "PATCH",
            body: request
        )
    }

    func clearThreadGoal(threadId: String) async throws -> ClearThreadGoalResponse {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/goal"),
            method: "DELETE"
        )
    }

    func fetchThreadForkTurns(threadId: String) async throws -> [SupervisorThreadForkTurnOption] {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/fork-turns")
        )
    }

    func forkThread(threadId: String, request: ForkThreadRequest) async throws -> SupervisorThreadForkResult {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/fork"),
            method: "POST",
            body: request
        )
    }

    func fetchThreadExportTurns(threadId: String) async throws -> SupervisorThreadExportTurns {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/export-turns")
        )
    }

    func fetchThreadHistoryItemDetail(threadId: String, itemId: String) async throws -> SupervisorThreadHistoryItemDetail {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/items/\(itemId.urlPathEncoded)/detail")
        )
    }

    func fetchThreadImageAsset(threadId: String, path: String) async throws -> SupervisorFileDownload {
        let query = buildQuery(["path": path])
        return try await requestDownload(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/assets/image\(query)"),
            fallbackFilename: path.components(separatedBy: "/").last?.trimmedNonEmpty ?? "thread-image"
        )
    }

    func downloadThreadTranscriptExport(threadId: String, request: ExportThreadRequest) async throws -> SupervisorFileDownload {
        let query = buildQuery([
            "format": request.format,
            "mode": request.mode,
            "limit": request.limit.map(String.init),
            "turnIds": request.turnIds.isEmpty ? nil : request.turnIds.joined(separator: ","),
            "profile": request.profile,
            "includeTokenAndPrice": String(request.includeTokenAndPrice),
            "includeCommandOutput": request.includeCommandOutput.map(String.init),
            "includeAbsolutePaths": request.includeAbsolutePaths.map(String.init)
        ])
        return try await requestDownload(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/exports/pdf\(query)"),
            fallbackFilename: request.format == "html" ? "remote-codex-transcript.html" : "remote-codex-transcript.pdf"
        )
    }

    func fetchThreadSkills(threadId: String) async throws -> SupervisorThreadSkills {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/skills")
        )
    }

    func fetchThreadMcpServers(threadId: String) async throws -> SupervisorThreadMcpServers {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/mcp-servers")
        )
    }

    func fetchThreadHooks(threadId: String) async throws -> SupervisorThreadHooks {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/hooks")
        )
    }

    func trustThreadHook(threadId: String, request: TrustThreadHookRequest) async throws -> SupervisorThreadHooks {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/hooks/trust"),
            method: "POST",
            body: request
        )
    }

    func untrustThreadHook(threadId: String, request: UntrustThreadHookRequest) async throws -> SupervisorThreadHooks {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/hooks/untrust"),
            method: "POST",
            body: request
        )
    }

    func respondToThreadRequest(
        threadId: String,
        requestId: String,
        request: RespondThreadRequest
    ) async throws -> SupervisorThreadDetail {
        try await requestJSON(
            config.restPath("/api/threads/\(threadId.urlPathEncoded)/requests/\(requestId.urlPathEncoded)/respond"),
            method: "POST",
            body: request
        )
    }
}

private extension SendThreadPromptUploadRequest {
    var attachmentManifestJSON: String? {
        guard !attachments.isEmpty else { return nil }
        let manifest = attachments.map { attachment in
            [
                "clientId": attachment.clientId,
                "kind": attachment.kind,
                "originalName": attachment.originalName,
                "placeholder": attachment.placeholder
            ]
        }
        guard
            let data = try? JSONSerialization.data(withJSONObject: manifest, options: []),
            let json = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        return json
    }
}
