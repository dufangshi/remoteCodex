package com.remotecodex.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.settings.AppSettingsRepository
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.screen.SupervisorConnectionSetupScreen
import com.remotecodex.android.ui.screen.SupervisorHomeScreen
import com.remotecodex.android.ui.screen.ThreadDetailScreen
import com.remotecodex.android.ui.screen.ThreadDetailPreviewScreen
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

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
            var supervisorConnection by remember {
                mutableStateOf(settingsRepository.readSupervisorConnection())
            }
            var connectedRoute by remember { mutableStateOf<ConnectedRoute>(ConnectedRoute.Home) }
            var homeSnapshot by remember { mutableStateOf<SupervisorHomeSnapshot?>(null) }
            var homeSnapshotLoading by remember { mutableStateOf(false) }
            var homeSnapshotError by remember { mutableStateOf<String?>(null) }
            var homeSnapshotRefreshNonce by remember { mutableIntStateOf(0) }
            val darkThemeActive = when (themeMode) {
                ThemeMode.System -> systemDark
                ThemeMode.Light -> false
                ThemeMode.Dark -> true
            }
            LaunchedEffect(supervisorConnection, homeSnapshotRefreshNonce) {
                val connection = supervisorConnection ?: return@LaunchedEffect
                homeSnapshotLoading = true
                homeSnapshotError = null
                homeSnapshot = null
                val result = withContext(Dispatchers.IO) {
                    runCatching { SupervisorApiClient(connection).fetchHomeSnapshot() }
                }
                homeSnapshotLoading = false
                result
                    .onSuccess { homeSnapshot = it }
                    .onFailure { error -> homeSnapshotError = error.message ?: "Backend snapshot failed." }
            }
            RemoteCodexTheme(dark = darkThemeActive) {
                val connection = supervisorConnection
                if (connection == null) {
                    SupervisorConnectionSetupScreen(
                        initialConfig = null,
                        onConnectionReady = { config: SupervisorConnectionConfig, _ ->
                            settingsRepository.writeSupervisorConnection(config)
                            supervisorConnection = config
                            connectedRoute = ConnectedRoute.Home
                        },
                    )
                } else {
                    when (connectedRoute) {
                        ConnectedRoute.Home -> SupervisorHomeScreen(
                            supervisorConnection = connection,
                            homeSnapshot = homeSnapshot,
                            homeSnapshotLoading = homeSnapshotLoading,
                            homeSnapshotError = homeSnapshotError,
                            themeMode = themeMode,
                            darkThemeActive = darkThemeActive,
                            onThemeModeSelected = { nextMode ->
                                themeMode = nextMode
                                settingsRepository.writeThemeMode(nextMode)
                            },
                            onOpenThread = { threadId ->
                                connectedRoute = threadId?.let(ConnectedRoute::ThreadDetail)
                                    ?: ConnectedRoute.ThreadPreview
                            },
                            onRefreshHomeSnapshot = {
                                homeSnapshotRefreshNonce += 1
                            },
                            onChangeConnection = {
                                settingsRepository.clearSupervisorConnection()
                                homeSnapshot = null
                                homeSnapshotError = null
                                homeSnapshotLoading = false
                                connectedRoute = ConnectedRoute.Home
                                supervisorConnection = null
                            },
                        )
                        ConnectedRoute.ThreadPreview -> ThreadDetailPreviewScreen(
                            themeMode = themeMode,
                            darkThemeActive = darkThemeActive,
                            supervisorConnection = connection,
                            homeSnapshot = homeSnapshot,
                            homeSnapshotLoading = homeSnapshotLoading,
                            homeSnapshotError = homeSnapshotError,
                            onThemeModeSelected = { nextMode ->
                                themeMode = nextMode
                                settingsRepository.writeThemeMode(nextMode)
                            },
                            onChangeConnection = {
                                settingsRepository.clearSupervisorConnection()
                                homeSnapshot = null
                                homeSnapshotError = null
                                homeSnapshotLoading = false
                                connectedRoute = ConnectedRoute.Home
                                supervisorConnection = null
                            },
                        )
                        is ConnectedRoute.ThreadDetail -> ThreadDetailScreen(
                            threadId = (connectedRoute as ConnectedRoute.ThreadDetail).threadId,
                            themeMode = themeMode,
                            darkThemeActive = darkThemeActive,
                            supervisorConnection = connection,
                            homeSnapshot = homeSnapshot,
                            homeSnapshotLoading = homeSnapshotLoading,
                            homeSnapshotError = homeSnapshotError,
                            onThemeModeSelected = { nextMode ->
                                themeMode = nextMode
                                settingsRepository.writeThemeMode(nextMode)
                            },
                            onChangeConnection = {
                                settingsRepository.clearSupervisorConnection()
                                homeSnapshot = null
                                homeSnapshotError = null
                                homeSnapshotLoading = false
                                connectedRoute = ConnectedRoute.Home
                                supervisorConnection = null
                            },
                            onBackToHome = { connectedRoute = ConnectedRoute.Home },
                        )
                    }
                }
            }
        }
    }
}

private sealed interface ConnectedRoute {
    data object Home : ConnectedRoute
    data object ThreadPreview : ConnectedRoute
    data class ThreadDetail(val threadId: String) : ConnectedRoute
}
