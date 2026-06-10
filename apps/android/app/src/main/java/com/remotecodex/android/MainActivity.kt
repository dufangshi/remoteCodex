package com.remotecodex.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.remotecodex.android.settings.AppSettingsRepository
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.screen.ThreadDetailPreviewScreen
import com.remotecodex.android.ui.theme.RemoteCodexTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val settingsRepository = AppSettingsRepository(applicationContext)
        setContent {
            val systemDark = isSystemInDarkTheme()
            var themeMode by remember {
                mutableStateOf(settingsRepository.readThemeMode())
            }
            val darkThemeActive = when (themeMode) {
                ThemeMode.System -> systemDark
                ThemeMode.Light -> false
                ThemeMode.Dark -> true
            }
            RemoteCodexTheme(dark = darkThemeActive) {
                ThreadDetailPreviewScreen(
                    themeMode = themeMode,
                    darkThemeActive = darkThemeActive,
                    onThemeModeSelected = { nextMode ->
                        themeMode = nextMode
                        settingsRepository.writeThemeMode(nextMode)
                    },
                )
            }
        }
    }
}
