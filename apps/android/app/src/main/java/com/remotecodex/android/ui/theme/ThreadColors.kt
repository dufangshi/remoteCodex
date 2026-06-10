package com.remotecodex.android.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

data class ThreadColorTokens(
    val background: Color,
    val panel: Color,
    val workspace: Color,
    val surface: Color,
    val surfaceStrong: Color,
    val border: Color,
    val borderStrong: Color,
    val foreground: Color,
    val foregroundSoft: Color,
    val foregroundMuted: Color,
    val primary: Color,
    val primaryForeground: Color,
    val success: Color,
    val successSoft: Color,
    val warning: Color,
    val warningSoft: Color,
    val danger: Color,
    val dangerSoft: Color,
    val info: Color,
    val infoSoft: Color,
    val codeBackground: Color,
    val codeForeground: Color,
    val userBubble: Color,
    val userBubbleText: Color,
    val userBubbleBorder: Color,
)

val LightThreadColors = ThreadColorTokens(
    background = Color(0xFFF1F5F9),
    panel = Color(0xFFF8FAFC),
    workspace = Color(0xFFF3F6FB),
    surface = Color(0xFFEDF2F7),
    surfaceStrong = Color(0xFFE6EDF5),
    border = Color(0xFFCBD5E1),
    borderStrong = Color(0xFFAEBBCC),
    foreground = Color(0xFF0F172A),
    foregroundSoft = Color(0xFF334155),
    foregroundMuted = Color(0xFF64748B),
    primary = Color(0xFF020617),
    primaryForeground = Color(0xFFF8FAFC),
    success = Color(0xFF166534),
    successSoft = Color(0xFFDCFCE7),
    warning = Color(0xFF92400E),
    warningSoft = Color(0xFFFEF3C7),
    danger = Color(0xFFBE123C),
    dangerSoft = Color(0xFFFFE4E6),
    info = Color(0xFF075985),
    infoSoft = Color(0xFFE0F2FE),
    codeBackground = Color(0xFF111827),
    codeForeground = Color(0xFFE5E7EB),
    userBubble = Color(0xFFCFEFF7),
    userBubbleText = Color(0xFF0F172A),
    userBubbleBorder = Color(0xFFBAE6FD),
)

val DarkThreadColors = ThreadColorTokens(
    background = Color(0xFF101217),
    panel = Color(0xFF171A22),
    workspace = Color(0xFF151820),
    surface = Color(0xFF1D222C),
    surfaceStrong = Color(0xFF222733),
    border = Color(0xFF2A2F3A),
    borderStrong = Color(0xFF303642),
    foreground = Color(0xFFF1F5F9),
    foregroundSoft = Color(0xFFCBD5E1),
    foregroundMuted = Color(0xFF94A3B8),
    primary = Color(0xFFF1F5F9),
    primaryForeground = Color(0xFF11141A),
    success = Color(0xFF86EFAC),
    successSoft = Color(0xFF173322),
    warning = Color(0xFFFBBF24),
    warningSoft = Color(0xFF382A14),
    danger = Color(0xFFFB7185),
    dangerSoft = Color(0xFF3B1720),
    info = Color(0xFF7DD3FC),
    infoSoft = Color(0xFF122B3A),
    codeBackground = Color(0xFF0C1117),
    codeForeground = Color(0xFFD6DDE6),
    userBubble = Color(0xFF1E3A46),
    userBubbleText = Color(0xFFE6F7FB),
    userBubbleBorder = Color(0xFF2E5A6B),
)

val LocalThreadColors = staticCompositionLocalOf { LightThreadColors }

object ThreadColors {
    val Background: Color @Composable get() = LocalThreadColors.current.background
    val Panel: Color @Composable get() = LocalThreadColors.current.panel
    val Workspace: Color @Composable get() = LocalThreadColors.current.workspace
    val Surface: Color @Composable get() = LocalThreadColors.current.surface
    val SurfaceStrong: Color @Composable get() = LocalThreadColors.current.surfaceStrong
    val Border: Color @Composable get() = LocalThreadColors.current.border
    val BorderStrong: Color @Composable get() = LocalThreadColors.current.borderStrong
    val Foreground: Color @Composable get() = LocalThreadColors.current.foreground
    val ForegroundSoft: Color @Composable get() = LocalThreadColors.current.foregroundSoft
    val ForegroundMuted: Color @Composable get() = LocalThreadColors.current.foregroundMuted
    val Primary: Color @Composable get() = LocalThreadColors.current.primary
    val PrimaryForeground: Color @Composable get() = LocalThreadColors.current.primaryForeground
    val Success: Color @Composable get() = LocalThreadColors.current.success
    val SuccessSoft: Color @Composable get() = LocalThreadColors.current.successSoft
    val Warning: Color @Composable get() = LocalThreadColors.current.warning
    val WarningSoft: Color @Composable get() = LocalThreadColors.current.warningSoft
    val Danger: Color @Composable get() = LocalThreadColors.current.danger
    val DangerSoft: Color @Composable get() = LocalThreadColors.current.dangerSoft
    val Info: Color @Composable get() = LocalThreadColors.current.info
    val InfoSoft: Color @Composable get() = LocalThreadColors.current.infoSoft
    val CodeBackground: Color @Composable get() = LocalThreadColors.current.codeBackground
    val CodeForeground: Color @Composable get() = LocalThreadColors.current.codeForeground
    val UserBubble: Color @Composable get() = LocalThreadColors.current.userBubble
    val UserBubbleText: Color @Composable get() = LocalThreadColors.current.userBubbleText
    val UserBubbleBorder: Color @Composable get() = LocalThreadColors.current.userBubbleBorder
}
