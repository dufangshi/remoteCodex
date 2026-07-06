package com.remotecodex.android.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private fun remoteCodexColorScheme(colors: ThreadColorTokens, dark: Boolean): ColorScheme {
    return if (dark) {
        darkColorScheme(
            primary = colors.primary,
            onPrimary = colors.primaryForeground,
            secondary = colors.surfaceStrong,
            onSecondary = colors.foreground,
            background = colors.background,
            onBackground = colors.foreground,
            surface = colors.panel,
            onSurface = colors.foreground,
            surfaceVariant = colors.workspace,
            onSurfaceVariant = colors.foregroundSoft,
            outline = colors.border,
            error = colors.danger,
            onError = colors.primaryForeground,
        )
    } else {
        lightColorScheme(
            primary = colors.primary,
            onPrimary = colors.primaryForeground,
            secondary = colors.surfaceStrong,
            onSecondary = colors.foreground,
            background = colors.background,
            onBackground = colors.foreground,
            surface = colors.panel,
            onSurface = colors.foreground,
            surfaceVariant = colors.workspace,
            onSurfaceVariant = colors.foregroundSoft,
            outline = colors.border,
            error = colors.danger,
            onError = colors.primaryForeground,
        )
    }
}

private val RemoteCodexTypography = Typography(
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
        lineHeight = 26.sp,
        letterSpacing = 0.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 15.sp,
        lineHeight = 22.sp,
        letterSpacing = 0.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Normal,
        fontSize = 13.sp,
        lineHeight = 19.sp,
        letterSpacing = 0.sp,
    ),
    labelMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 14.sp,
        letterSpacing = 0.sp,
    ),
)

private val RemoteCodexShapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(5.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(7.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(12.dp),
)

@Composable
fun RemoteCodexTheme(
    dark: Boolean = false,
    content: @Composable () -> Unit,
) {
    val threadColors = if (dark) DarkThreadColors else LightThreadColors
    CompositionLocalProvider(LocalThreadColors provides threadColors) {
        MaterialTheme(
            colorScheme = remoteCodexColorScheme(threadColors, dark),
            typography = RemoteCodexTypography,
            shapes = RemoteCodexShapes,
            content = content,
        )
    }
}
