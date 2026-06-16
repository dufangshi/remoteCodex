import Foundation

@MainActor
extension ThreadDetailViewModel {
    func startNewChatFromCurrentThread() async -> String? {
        guard let thread, let detail else { return nil }
        loading = true
        errorMessage = nil
        message = nil
        defer { loading = false }
        do {
            let client = environment.apiClientFactory(connection)
            let newThread = try await client.startThread(
                StartSupervisorThreadRequest(
                    workspaceId: thread.workspaceId,
                    title: nil,
                    provider: thread.provider,
                    model: modelDraft.trimmedNonEmpty ?? thread.model ?? "gpt-5",
                    reasoningEffort: reasoningDraft.trimmedNonEmpty ?? thread.reasoningEffort,
                    approvalMode: "yolo"
                )
            )
            message = "Started new chat in \(detail.workspace.label)"
            return newThread.id
        } catch {
            errorMessage = error.localizedDescription
            return nil
        }
    }
}
