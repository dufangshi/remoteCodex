package com.remotecodex.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.settings.AppSettingsRepository
import com.remotecodex.android.settings.SavedAppRoute
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.screen.ConnectionSetupRoute
import com.remotecodex.android.ui.screen.SupervisorAccountPanel
import com.remotecodex.android.ui.screen.SupervisorConnectionSetupScreen
import com.remotecodex.android.ui.screen.SupervisorHomeScreen
import com.remotecodex.android.ui.screen.ThreadDetailScreen
import com.remotecodex.android.ui.screen.ThreadDetailPreviewScreen
import com.remotecodex.android.ui.screen.WorkspaceDetailScreen
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
            var connectionRoute by remember(supervisorConnection) {
                mutableStateOf(initialConnectionRoute(supervisorConnection, settingsRepository))
            }
            var homeSnapshot by remember { mutableStateOf<SupervisorHomeSnapshot?>(null) }
            var homeSnapshotLoading by remember { mutableStateOf(false) }
            var homeSnapshotError by remember { mutableStateOf<String?>(null) }
            var homeSnapshotRefreshNonce by remember { mutableIntStateOf(0) }
            var accountPanelOpen by remember { mutableStateOf(false) }
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
                Box {
                    when (val route = connectionRoute) {
                        ConnectionRoute.ModeSelect,
                        ConnectionRoute.ServerAuth,
                        ConnectionRoute.RelayAuth,
                        ConnectionRoute.RelayDevices,
                        -> {
                            SupervisorConnectionSetupScreen(
                                initialConfig = connection,
                                initialRoute = when (route) {
                                    ConnectionRoute.ModeSelect -> ConnectionSetupRoute.ModeSelect
                                    ConnectionRoute.ServerAuth -> ConnectionSetupRoute.ServerAuth
                                    ConnectionRoute.RelayAuth -> ConnectionSetupRoute.RelayAuth
                                    ConnectionRoute.RelayDevices -> ConnectionSetupRoute.RelayDevices
                                    is ConnectionRoute.Workspace -> ConnectionSetupRoute.ModeSelect
                                },
                                onConnectionReady = { config: SupervisorConnectionConfig, _ ->
                                    settingsRepository.writeSupervisorConnection(config)
                                    supervisorConnection = config
                                    connectionRoute = ConnectionRoute.Workspace(settingsRepository.readLastRoute(config).toConnectedRoute())
                                },
                                onConnectionStateSaved = { config ->
                                    settingsRepository.writeSupervisorConnection(config)
                                    supervisorConnection = config
                                    connectionRoute = initialConnectionRoute(config, settingsRepository)
                                },
                                onBack = {
                                    connectionRoute = when (route) {
                                        ConnectionRoute.RelayDevices -> {
                                            val selected = supervisorConnection?.relayDeviceId
                                            if (selected.isNullOrBlank()) ConnectionRoute.RelayAuth else ConnectionRoute.Workspace(
                                                settingsRepository.readLastRoute(supervisorConnection).toConnectedRoute(),
                                            )
                                        }
                                        ConnectionRoute.ServerAuth,
                                        ConnectionRoute.RelayAuth,
                                        -> ConnectionRoute.ModeSelect
                                        ConnectionRoute.ModeSelect -> ConnectionRoute.ModeSelect
                                        is ConnectionRoute.Workspace -> route
                                    }
                                },
                                onRelayDeviceSelectionCleared = {
                                    val current = supervisorConnection ?: return@SupervisorConnectionSetupScreen
                                    val next = current.copy(relayDeviceId = null)
                                    settingsRepository.writeSupervisorConnection(next)
                                    supervisorConnection = next
                                },
                            )
                        }
                        is ConnectionRoute.Workspace -> {
                            if (connection == null) {
                                connectionRoute = ConnectionRoute.ModeSelect
                            } else {
                                when (route.connectedRoute) {
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
                                            val nextRoute = threadId?.let(ConnectedRoute::ThreadDetail)
                                                ?: ConnectedRoute.ThreadPreview
                                            if (nextRoute is ConnectedRoute.ThreadDetail) {
                                                settingsRepository.writeLastRoute(connection, SavedAppRoute.ThreadDetail(nextRoute.threadId))
                                            }
                                            connectionRoute = ConnectionRoute.Workspace(nextRoute)
                                        },
                                        onOpenWorkspace = { workspaceId ->
                                            settingsRepository.writeLastRoute(connection, SavedAppRoute.WorkspaceDetail(workspaceId))
                                            connectionRoute = ConnectionRoute.Workspace(ConnectedRoute.WorkspaceDetail(workspaceId))
                                        },
                                        onRefreshHomeSnapshot = {
                                            homeSnapshotRefreshNonce += 1
                                        },
                                        onChangeConnection = {
                                            accountPanelOpen = true
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
                                            accountPanelOpen = true
                                        },
                                    )
                                    is ConnectedRoute.ThreadDetail -> ThreadDetailScreen(
                                        threadId = route.connectedRoute.threadId,
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
                                            accountPanelOpen = true
                                        },
                                        onOpenThread = { nextThreadId ->
                                            settingsRepository.writeLastRoute(connection, SavedAppRoute.ThreadDetail(nextThreadId))
                                            connectionRoute = ConnectionRoute.Workspace(ConnectedRoute.ThreadDetail(nextThreadId))
                                        },
                                        onBackToHome = {
                                            settingsRepository.writeLastRoute(connection, SavedAppRoute.Home)
                                            connectionRoute = ConnectionRoute.Workspace(ConnectedRoute.Home)
                                        },
                                        onThreadDeleted = {
                                            homeSnapshotRefreshNonce += 1
                                            settingsRepository.writeLastRoute(connection, SavedAppRoute.Home)
                                            connectionRoute = ConnectionRoute.Workspace(ConnectedRoute.Home)
                                        },
                                    )
                                    is ConnectedRoute.WorkspaceDetail -> WorkspaceDetailScreen(
                                        workspaceId = route.connectedRoute.workspaceId,
                                        supervisorConnection = connection,
                                        homeSnapshot = homeSnapshot,
                                        homeSnapshotLoading = homeSnapshotLoading,
                                        homeSnapshotError = homeSnapshotError,
                                        onBackToHome = {
                                            settingsRepository.writeLastRoute(connection, SavedAppRoute.Home)
                                            connectionRoute = ConnectionRoute.Workspace(ConnectedRoute.Home)
                                        },
                                        onOpenThread = { threadId ->
                                            settingsRepository.writeLastRoute(connection, SavedAppRoute.ThreadDetail(threadId))
                                            connectionRoute = ConnectionRoute.Workspace(ConnectedRoute.ThreadDetail(threadId))
                                        },
                                        onRefreshHomeSnapshot = {
                                            homeSnapshotRefreshNonce += 1
                                        },
                                    )
                                }
                            }
                        }
                    }
                    val activeConnection = supervisorConnection
                    if (accountPanelOpen && activeConnection != null) {
                        SupervisorAccountPanel(
                            config = activeConnection,
                            onClose = { accountPanelOpen = false },
                            onDisconnect = {
                                settingsRepository.clearSupervisorConnection()
                                homeSnapshot = null
                                homeSnapshotError = null
                                homeSnapshotLoading = false
                                supervisorConnection = null
                                connectionRoute = ConnectionRoute.ModeSelect
                            },
                            onManageDevices = {
                                connectionRoute = ConnectionRoute.RelayDevices
                            },
                            onChangeAccount = {
                                settingsRepository.clearAuthToken()
                                supervisorConnection = activeConnection.copy(authToken = null, relayDeviceId = null)
                                connectionRoute = ConnectionRoute.RelayAuth
                            },
                            onReauthenticate = {
                                connectionRoute = ConnectionRoute.ServerAuth
                            },
                            onChangeMode = {
                                connectionRoute = ConnectionRoute.ModeSelect
                            },
                        )
                    }
                }
            }
        }
    }
}

private sealed interface ConnectionRoute {
    data object ModeSelect : ConnectionRoute
    data object ServerAuth : ConnectionRoute
    data object RelayAuth : ConnectionRoute
    data object RelayDevices : ConnectionRoute
    data class Workspace(val connectedRoute: ConnectedRoute) : ConnectionRoute
}

private sealed interface ConnectedRoute {
    data object Home : ConnectedRoute
    data object ThreadPreview : ConnectedRoute
    data class ThreadDetail(val threadId: String) : ConnectedRoute
    data class WorkspaceDetail(val workspaceId: String) : ConnectedRoute
}

private fun SavedAppRoute.toConnectedRoute(): ConnectedRoute {
    return when (this) {
        SavedAppRoute.Home -> ConnectedRoute.Home
        is SavedAppRoute.WorkspaceDetail -> ConnectedRoute.WorkspaceDetail(workspaceId)
        is SavedAppRoute.ThreadDetail -> ConnectedRoute.ThreadDetail(threadId)
    }
}

private fun initialConnectionRoute(
    config: SupervisorConnectionConfig?,
    settingsRepository: AppSettingsRepository,
): ConnectionRoute {
    return when {
        config == null -> ConnectionRoute.ModeSelect
        config.mode == SupervisorConnectionMode.Server && config.authToken.isNullOrBlank() -> ConnectionRoute.ServerAuth
        config.mode == SupervisorConnectionMode.Relay && config.authToken.isNullOrBlank() -> ConnectionRoute.RelayAuth
        config.mode == SupervisorConnectionMode.Relay && config.relayDeviceId.isNullOrBlank() -> ConnectionRoute.RelayDevices
        else -> ConnectionRoute.Workspace(settingsRepository.readLastRoute(config).toConnectedRoute())
    }
}
