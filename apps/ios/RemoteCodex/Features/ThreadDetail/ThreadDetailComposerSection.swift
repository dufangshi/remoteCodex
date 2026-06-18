import SwiftUI

extension ThreadDetailScreen {
    var composerSection: some View {
        Section("Composer") {
            if let context = model.presentation?.context {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(context.label)
                            .font(.caption.weight(.semibold))
                        Spacer()
                        if let tokensLabel = context.tokensLabel {
                            Text(tokensLabel)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let percent = context.percent {
                        ProgressView(value: min(max(percent, 0), 100), total: 100)
                            .accessibilityLabel("Context \(context.label)")
                    }
                }
            }
            Text("Prompt")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("thread-composer-section")
            TextEditor(text: $model.promptDraft)
                .frame(minHeight: 110)
                .font(.body)
                .focused($promptFocused)
                .accessibilityIdentifier("thread-prompt-editor")
            let slashQuery = composerSlashCommandQuery(model.promptDraft)
            if showingSlashToolbox || slashQuery != nil {
                ThreadComposerSlashToolbox(
                    items: buildComposerSlashCommandItems(
                        query: slashQuery,
                        fastMode: model.fastModeDraft,
                        hasForkTargets: !model.forkTurns.isEmpty,
                        busy: model.loading || model.sending
                    ),
                    onSelect: handleSlashCommand
                )
            }
            if !model.promptAttachments.isEmpty {
                ForEach(model.promptAttachments, id: \.clientId) { attachment in
                    HStack {
                        GraphBadge(text: attachment.kind, tone: .neutral)
                        Text(attachment.originalName)
                            .lineLimit(1)
                        Spacer()
                        Button("Remove") {
                            model.removePromptAttachment(attachment)
                        }
                    }
                }
            }
            Toggle("Fast mode", isOn: $model.fastModeDraft)
            Toggle("Plan mode", isOn: Binding(
                get: { model.collaborationDraft == "plan" },
                set: { model.collaborationDraft = $0 ? "plan" : "default" }
            ))
            HStack {
                Button {
                    showingSlashToolbox.toggle()
                } label: {
                    Label("Slash", systemImage: "textformat")
                }
                .accessibilityIdentifier("thread-slash-toggle")
                Button("Attach") {
                    showingAttachmentImporter = true
                }
                .accessibilityIdentifier("thread-attach-file")
                Menu("More") {
                    Button("Update Settings") { Task { await model.updateSettings() } }
                    Button("Compact") { Task { await model.compactThread() } }
                    Button("Update Goal") { Task { await model.updateGoal() } }
                    Button("Export") { showingExportDialog = true }
                }
                Spacer()
                if model.presentation?.status == .running {
                    Button("Stop", role: .destructive) {
                        Task { await model.interruptThread() }
                    }
                }
                Button {
                    promptFocused = false
                    Task { await model.sendPrompt() }
                } label: {
                    Text(model.sending ? "Sending..." : "Send Prompt")
                }
                .accessibilityIdentifier("thread-send-prompt")
                .disabled(model.sending || model.promptDraft.trimmedNonEmpty == nil)
            }
        }
    }

    func handleSlashCommand(_ item: ComposerSlashCommandItem) {
        showingSlashToolbox = false
        let argument = composerSlashCommandArgument(prompt: model.promptDraft, command: item.command)
        model.promptDraft = composerPromptClearingSlashCommand(model.promptDraft, command: item.command)
        switch item.kind {
        case .fast:
            model.fastModeDraft.toggle()
            Task { await model.updateSettings() }
        case .compact:
            Task { await model.compactThread() }
        case .goal:
            guard let argument else {
                model.message = "Type /goal followed by an objective."
                return
            }
            model.goalDraft = argument
            Task { await model.updateGoal() }
        case .fork:
            Task {
                if let threadId = await model.forkLatestThread() {
                    onOpenThread(threadId)
                }
            }
        case .mcp, .hooks:
            workspacePanelTab = .extensions
        case .export:
            showingExportDialog = true
        }
    }
}
