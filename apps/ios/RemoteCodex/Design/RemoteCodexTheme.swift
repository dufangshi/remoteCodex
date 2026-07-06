import SwiftUI
import UIKit

enum RemoteCodexTheme {
    static let pageBackground = dynamicColor(light: 0xEEF2F7, dark: 0x101217)
    static let panelBackground = dynamicColor(light: 0xF8FAFC, dark: 0x171A22)
    static let workspaceBackground = dynamicColor(light: 0xF3F6FB, dark: 0x151820)
    static let surface = dynamicColor(light: 0xEDF2F7, dark: 0x1D222C)
    static let surfaceStrong = dynamicColor(light: 0xE6EDF5, dark: 0x222733)
    static let border = dynamicColor(light: 0xCBD5E1, dark: 0x2A2F3A)
    static let borderStrong = dynamicColor(light: 0xAEBBCC, dark: 0x303642)
    static let foreground = dynamicColor(light: 0x0F172A, dark: 0xF1F5F9)
    static let foregroundSoft = dynamicColor(light: 0x334155, dark: 0xCBD5E1)
    static let foregroundMuted = dynamicColor(light: 0x64748B, dark: 0x94A3B8)
    static let primary = dynamicColor(light: 0x1E293B, dark: 0xF1F5F9)
    static let primaryForeground = dynamicColor(light: 0xF8FAFC, dark: 0x11141A)
    static let success = dynamicColor(light: 0x166534, dark: 0x86EFAC)
    static let successSoft = dynamicColor(light: 0xDCFCE7, dark: 0x173322)
    static let warning = dynamicColor(light: 0x92400E, dark: 0xFBBF24)
    static let warningSoft = dynamicColor(light: 0xFEF3C7, dark: 0x382A14)
    static let danger = dynamicColor(light: 0xBE123C, dark: 0xFB7185)
    static let dangerSoft = dynamicColor(light: 0xFFE4E6, dark: 0x3B1720)
    static let info = dynamicColor(light: 0x075985, dark: 0x7DD3FC)
    static let infoSoft = dynamicColor(light: 0xE0F2FE, dark: 0x122B3A)
    static let codeBackground = dynamicColor(light: 0x111827, dark: 0x0C1117)
    static let codeForeground = dynamicColor(light: 0xE5E7EB, dark: 0xD6DDE6)
    static let accent = primary
    static let controlRadius: CGFloat = 8
    static let panelRadius: CGFloat = 10
    static let sheetRadius: CGFloat = 12

    private static func dynamicColor(light: UInt32, dark: UInt32) -> Color {
        Color(UIColor { traits in
            UIColor(
                hex: traits.userInterfaceStyle == .dark ? dark : light
            )
        })
    }
}

private extension UIColor {
    convenience init(hex: UInt32) {
        let red = CGFloat((hex >> 16) & 0xFF) / 255
        let green = CGFloat((hex >> 8) & 0xFF) / 255
        let blue = CGFloat(hex & 0xFF) / 255
        self.init(red: red, green: green, blue: blue, alpha: 1)
    }
}

extension View {
    func remoteCodexScreenSurface() -> some View {
        scrollContentBackground(.hidden)
            .background(RemoteCodexTheme.pageBackground)
            .tint(RemoteCodexTheme.accent)
    }

    func remoteCodexListRow() -> some View {
        listRowBackground(RemoteCodexTheme.panelBackground)
            .foregroundStyle(RemoteCodexTheme.foreground)
    }

    func remoteCodexErrorText() -> some View {
        foregroundStyle(RemoteCodexTheme.danger)
    }

    func remoteCodexStatusText() -> some View {
        foregroundStyle(RemoteCodexTheme.foregroundMuted)
    }

    func remoteCodexInsetPanel() -> some View {
        padding(10)
            .background(RemoteCodexTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: RemoteCodexTheme.panelRadius))
            .overlay {
                RoundedRectangle(cornerRadius: RemoteCodexTheme.panelRadius)
                    .stroke(RemoteCodexTheme.border, lineWidth: 1)
            }
    }
}

struct RemoteCodexPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(RemoteCodexTheme.primaryForeground)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(minHeight: 42)
            .background(
                configuration.isPressed
                    ? RemoteCodexTheme.primary.opacity(0.82)
                    : RemoteCodexTheme.primary,
                in: RoundedRectangle(cornerRadius: RemoteCodexTheme.controlRadius)
            )
            .overlay {
                RoundedRectangle(cornerRadius: RemoteCodexTheme.controlRadius)
                    .stroke(RemoteCodexTheme.borderStrong.opacity(0.35), lineWidth: 1)
            }
            .opacity(configuration.isPressed ? 0.92 : 1)
    }
}

struct RemoteCodexSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(RemoteCodexTheme.foregroundSoft)
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(minHeight: 40)
            .background(
                configuration.isPressed
                    ? RemoteCodexTheme.surfaceStrong.opacity(0.72)
                    : RemoteCodexTheme.surface,
                in: RoundedRectangle(cornerRadius: RemoteCodexTheme.controlRadius)
            )
            .overlay {
                RoundedRectangle(cornerRadius: RemoteCodexTheme.controlRadius)
                    .stroke(RemoteCodexTheme.border, lineWidth: 1)
            }
            .opacity(configuration.isPressed ? 0.9 : 1)
    }
}
