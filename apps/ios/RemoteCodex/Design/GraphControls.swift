import SwiftUI

enum GraphBadgeTone {
    case neutral
    case success
    case warning
    case destructive

    var foreground: Color {
        switch self {
        case .neutral:
            .secondary
        case .success:
            .green
        case .warning:
            .orange
        case .destructive:
            .red
        }
    }

    var background: Color {
        foreground.opacity(0.12)
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
