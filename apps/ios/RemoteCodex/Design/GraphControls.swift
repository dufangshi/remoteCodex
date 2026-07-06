import SwiftUI

enum GraphBadgeTone {
    case neutral
    case success
    case warning
    case destructive

    var foreground: Color {
        switch self {
        case .neutral:
            RemoteCodexTheme.foregroundMuted
        case .success:
            RemoteCodexTheme.success
        case .warning:
            RemoteCodexTheme.warning
        case .destructive:
            RemoteCodexTheme.danger
        }
    }

    var background: Color {
        switch self {
        case .neutral:
            RemoteCodexTheme.surfaceStrong
        case .success:
            RemoteCodexTheme.successSoft
        case .warning:
            RemoteCodexTheme.warningSoft
        case .destructive:
            RemoteCodexTheme.dangerSoft
        }
    }
}

struct GraphBadge: View {
    let text: String
    let tone: GraphBadgeTone

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(tone.foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(tone.background, in: Capsule())
            .overlay {
                Capsule().stroke(tone.foreground.opacity(0.32), lineWidth: 1)
            }
    }
}

struct GraphSectionFooterButton: View {
    let title: String
    var systemImage: String?
    var role: ButtonRole?
    let action: () -> Void

    var body: some View {
        Button(role: role, action: action) {
            Label(title, systemImage: systemImage ?? "arrow.right")
        }
    }
}
