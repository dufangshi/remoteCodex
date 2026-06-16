import SwiftUI
import UIKit

struct ThreadTurnFrameHeader: View {
    let turn: TurnPresentation

    var body: some View {
        HStack(spacing: 8) {
            GraphBadge(text: "TURN \(turn.index)", tone: turn.status.badgeTone)
            VStack(alignment: .leading, spacing: 2) {
                Text(turn.statusLabel)
                    .font(.caption.weight(.semibold))
                Text(collapsedSummary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            if let tokenSummary = turn.tokenSummary {
                Text(tokenSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityLabel("Turn \(turn.index), \(turn.statusLabel)")
    }

    private var collapsedSummary: String {
        let messageLabel = turn.messages.count == 1 ? "1 message" : "\(turn.messages.count) messages"
        let historyLabel = turn.historyItems.isEmpty ? nil : "\(turn.historyItems.count) history"
        let reasoningLabel = turn.reasoningItems.isEmpty ? nil : "\(turn.reasoningItems.count) reasoning"
        let planLabel = turn.livePlan == nil ? nil : "live plan"
        return ([messageLabel] + [planLabel, reasoningLabel, historyLabel].compactMap(\.self)).joined(separator: " · ")
    }
}

struct ThreadTimelineUsageRow: View {
    let usage: TurnUsagePresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if usage.tokenSummary != nil || usage.tokenDetails != nil {
                usageLine(
                    badge: "TOKENS",
                    title: usage.tokenSummary ?? "Token usage",
                    detail: usage.tokenDetails
                )
            }
            if usage.contextSummary != nil || usage.contextDetails != nil {
                usageLine(
                    badge: "CTX",
                    title: usage.contextSummary ?? "Context usage",
                    detail: usage.contextDetails
                )
            }
        }
        .padding(.vertical, 4)
    }

    private func usageLine(badge: String, title: String, detail: String?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            GraphBadge(text: badge, tone: .neutral)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.semibold))
                if let detail {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

struct ThreadTimelineLivePlanRow: View {
    let plan: LivePlanPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                GraphBadge(text: plan.badgeLabel.uppercased(), tone: .warning)
                Text(plan.title)
                    .font(.caption.weight(.semibold))
                Spacer()
                Text("\(plan.steps.count) steps")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let explanation = plan.explanation {
                Text(explanation)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(plan.steps) { step in
                    ThreadTimelineLivePlanStepRow(step: step)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }
}

private struct ThreadTimelineLivePlanStepRow: View {
    let step: LivePlanStepPresentation

    var body: some View {
        HStack(spacing: 8) {
            Text("\(step.number)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.secondary)
                .frame(width: 24, height: 24)
                .background(.secondary.opacity(0.10), in: Circle())
            Text(step.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
            Spacer(minLength: 8)
            Label(step.statusState.label, systemImage: statusSystemImage)
                .labelStyle(.iconOnly)
                .font(.caption.weight(.semibold))
                .foregroundStyle(step.statusState.tone.color)
                .frame(width: 28, height: 28)
                .background(step.statusState.tone.color.opacity(0.12), in: Circle())
                .accessibilityLabel(step.statusState.accessibilityLabel)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var statusSystemImage: String {
        switch step.status {
        case .completed:
            "checkmark.circle"
        case .running:
            "ellipsis"
        case .failed:
            "xmark.circle"
        case .pending:
            "clock"
        case .unknown:
            "questionmark.circle"
        }
    }
}

struct ThreadTimelineNoteRow: View {
    let note: TimelineNotePresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                GraphBadge(text: note.kind.badgeLabel, tone: note.kind.badgeTone)
                Text(note.title)
                    .font(.caption.weight(.semibold))
                Spacer()
                if let statusLabel = note.statusLabel {
                    Text(statusLabel)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(Array(note.summaryLines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let timeLabel = note.timeLabel {
                Text(timeLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

private extension TimelineNoteKindPresentation {
    var badgeLabel: String {
        switch self {
        case .activity:
            "ACTIVITY"
        case .answered:
            "RESOLVED"
        }
    }

    var badgeTone: GraphBadgeTone {
        switch self {
        case .activity:
            .warning
        case .answered:
            .success
        }
    }
}

struct ThreadTimelineMessageRow: View {
    let message: TimelineMessagePresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                GraphBadge(text: message.author.label, tone: badgeTone)
                if let status = message.status {
                    Text(status.label)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("thread-message-status-\(message.id)")
                }
            }
            if let text = message.text.trimmedNonEmpty {
                if message.author == .user {
                    UserMessageSegmentsView(text: text)
                } else {
                    RichMessageContentView(text: text)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("thread-message-\(message.id)")
    }

    private var badgeTone: GraphBadgeTone {
        switch message.author {
        case .assistant:
            .success
        case .user:
            .neutral
        }
    }
}

struct ThreadTimelineReasoningRow: View {
    let item: ReasoningPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                GraphBadge(text: "REASON", tone: item.status?.badgeTone ?? .neutral)
                if let status = item.status {
                    Text(toolStatusLabel(status))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Text(item.text)
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
        .padding(.vertical, 4)
    }
}

struct ThreadTimelineHistoryRow: View {
    let item: HistoryItemPresentation
    var onOpenDetail: (() -> Void)?
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                GraphBadge(text: historyItemShortLabel(item.kind), tone: badgeTone)
                Text(item.title)
                    .font(.caption.weight(.semibold))
                Spacer()
                if let status = item.status {
                    Text(toolStatusLabel(status))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Text(item.summary)
                .font(.caption)
                .foregroundStyle(.secondary)
            if let meta = item.meta {
                Text(meta)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 10) {
                if let actionLabel = item.actionLabel, onOpenDetail != nil {
                    Button(actionLabel) {
                        onOpenDetail?()
                    }
                    .font(.caption)
                    .accessibilityIdentifier("thread-history-detail-\(item.id)")
                } else if onOpenDetail != nil {
                    Button("Inspect") {
                        onOpenDetail?()
                    }
                    .font(.caption)
                    .accessibilityIdentifier("thread-history-detail-\(item.id)")
                }
                Button(copied ? "Copied" : "Copy") {
                    UIPasteboard.general.string = item.copyText
                    copied = true
                }
                .font(.caption)
                .accessibilityIdentifier("thread-history-copy-\(item.id)")
                .disabled(item.copyText.isEmpty)
                if let callId = item.callId {
                    Text(callId)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .contain)
    }

    private var badgeTone: GraphBadgeTone {
        switch item.status {
        case .running:
            .warning
        case .failed:
            .destructive
        case .completed:
            .success
        case nil:
            .neutral
        }
    }
}

extension ThreadStatusPresentation {
    var label: String {
        switch self {
        case .running:
            "Running"
        case .complete:
            "Complete"
        case .failed:
            "Failed"
        case .waiting:
            "Waiting"
        }
    }

    var badgeTone: GraphBadgeTone {
        switch self {
        case .running:
            .warning
        case .complete:
            .success
        case .failed:
            .destructive
        case .waiting:
            .neutral
        }
    }
}

private extension TimelineToolStatusPresentation {
    var badgeTone: GraphBadgeTone {
        switch self {
        case .running:
            .warning
        case .completed:
            .success
        case .failed:
            .destructive
        }
    }
}

private extension TimelineAuthorPresentation {
    var label: String {
        switch self {
        case .user:
            "User"
        case .assistant:
            "Assistant"
        }
    }
}

private extension PlanStepStatusTonePresentation {
    var color: Color {
        switch self {
        case .success:
            .green
        case .running:
            .orange
        case .danger:
            .red
        case .pending:
            .blue
        case .unknown:
            .secondary
        }
    }
}
