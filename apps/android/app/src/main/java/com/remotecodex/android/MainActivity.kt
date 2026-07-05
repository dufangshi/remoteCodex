package com.remotecodex.android

import android.os.Bundle
import androidx.activity.compose.BackHandler
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
import com.remotecodex.android.settings.SavedSupervisorDevice
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.screen.ConnectionSetupRoute
import com.remotecodex.android.ui.screen.SupervisorAccountPanel
import com.remotecodex.android.ui.screen.SupervisorConnectionSetupScreen
import com.remotecodex.android.ui.screen.SupervisorHomeScreen
import com.remotecodex.android.ui.screen.ThreadDetailPreviewScreen
import com.remotecodex.android.ui.screen.ThreadDetailScreen
import com.remotecodex.android.ui.screen.ThreadDetailWebViewScreen
import com.remotecodex.android.ui.screen.WorkspaceDetailScreen
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val settingsRepository = AppSettingsRepository(applicationContext)
        intent?.getStringExtra(E2EConnectionBaseUrlExtra)?.takeIf { it.isNotBlank() }?.let { baseUrl ->
            settingsRepository.writeSupervisorConnection(
                SupervisorConnectionConfig(
                    mode = SupervisorConnectionMode.Local,
                    baseUrl = baseUrl,
                ),
            )
        }
        val launchThreadWebFixture = intent?.getBooleanExtra(ThreadWebFixtureExtra, false) == true
        val threadWebFixtureBaseUrl = intent?.getStringExtra(ThreadWebFixtureBaseUrlExtra)
        val threadWebFixtureThreadId = intent?.getStringExtra(ThreadWebFixtureThreadIdExtra)
        val threadWebFixtureData =
            intent?.getBooleanExtra(ThreadWebFixtureDataExtra, threadWebFixtureThreadId.isNullOrBlank())
                ?: threadWebFixtureThreadId.isNullOrBlank()
        setContent {
            val systemDark = isSystemInDarkTheme()
            var themeMode by remember {
                mutableStateOf(settingsRepository.readThemeMode())
            }
            var supervisorConnection by remember {
                mutableStateOf(settingsRepository.readSupervisorConnection())
            }
            var savedSupervisorDevices by remember {
                mutableStateOf(
                    settingsRepository.readSavedSupervisorDevices().ifEmpty {
                        supervisorConnection?.let { listOf(SavedSupervisorDevice.fromConnection(it)) }.orEmpty()
                    },
                )
            }
            var connectionRoute by remember(supervisorConnection) {
                mutableStateOf(initialConnectionRoute(supervisorConnection, settingsRepository))
            }
            var homeSnapshot by remember { mutableStateOf<SupervisorHomeSnapshot?>(null) }
            var homeSnapshotLoading by remember { mutableStateOf(false) }
            var homeSnapshotError by remember { mutableStateOf<String?>(null) }
            var homeSnapshotRefreshNonce by remember { mutableIntStateOf(0) }
            var accountPanelOpen by remember { mutableStateOf(false) }
            var devicesReturnRoute by remember { mutableStateOf<ConnectedRoute?>(null) }
            fun openDevicesScreen() {
                devicesReturnRoute = (connectionRoute as? ConnectionRoute.Workspace)?.connectedRoute
                    ?: settingsRepository.readLastRoute(supervisorConnection).toConnectedRoute()
                accountPanelOpen = false
                connectionRoute = ConnectionRoute.ModeSelect
            }
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
                BackHandler(
                    enabled = !launchThreadWebFixture &&
                        (accountPanelOpen || shouldHandleBack(connectionRoute) || devicesReturnRoute != null),
                ) {
                    if (accountPanelOpen) {
                        accountPanelOpen = false
                        return@BackHandler
                    }
                    connectionRoute = when (val route = connectionRoute) {
                        ConnectionRoute.ModeSelect -> {
                            val returnRoute = devicesReturnRoute
                            devicesReturnRoute = null
                            if (returnRoute == null) route else ConnectionRoute.Workspace(returnRoute)
                        }
                        ConnectionRoute.ServerAuth,
                        ConnectionRoute.RelayAuth,
                        -> ConnectionRoute.ModeSelect
                        ConnectionRoute.RelayDevices -> {
                            val selected = supervisorConnection?.relayDeviceId
                            if (selected.isNullOrBlank()) {
                                ConnectionRoute.RelayAuth
                            } else {
                                ConnectionRoute.Workspace(settingsRepository.readLastRoute(supervisorConnection).toConnectedRoute())
                            }
                        }
                        is ConnectionRoute.Workspace -> when (route.connectedRoute) {
                            ConnectedRoute.Home -> route
                            ConnectedRoute.ThreadPreview,
                            is ConnectedRoute.WorkspaceDetail,
                            -> {
                                val connectionForRoute = supervisorConnection
                                if (connectionForRoute != null) {
                                    settingsRepository.writeLastRoute(connectionForRoute, SavedAppRoute.Home)
                                }
                                ConnectionRoute.Workspace(ConnectedRoute.Home)
                            }
                            is ConnectedRoute.ThreadDetail -> {
                                val connectionForRoute = supervisorConnection
                                val workspaceId = route.connectedRoute.workspaceId
                                if (connectionForRoute != null && !workspaceId.isNullOrBlank()) {
                                    settingsRepository.writeLastRoute(
                                        connectionForRoute,
                                        SavedAppRoute.WorkspaceDetail(workspaceId),
                                    )
                                    ConnectionRoute.Workspace(ConnectedRoute.WorkspaceDetail(workspaceId))
                                } else {
                                    if (connectionForRoute != null) {
                                        settingsRepository.writeLastRoute(connectionForRoute, SavedAppRoute.Home)
                                    }
                                    ConnectionRoute.Workspace(ConnectedRoute.Home)
                                }
                            }
                        }
                    }
                }
                if (launchThreadWebFixture) {
                    val fixtureConnection = supervisorConnection
                        ?.let { connection ->
                            if (threadWebFixtureBaseUrl.isNullOrBlank()) {
                                connection
                            } else {
                                connection.copy(baseUrl = threadWebFixtureBaseUrl)
                            }
                        }
                        ?: SupervisorConnectionConfig(
                            mode = SupervisorConnectionMode.Local,
                            baseUrl = threadWebFixtureBaseUrl ?: "http://10.0.2.2:8787",
                        )
                    ThreadDetailWebViewScreen(
                        connection = fixtureConnection,
                        threadId = threadWebFixtureThreadId,
                        themeMode = themeMode,
                        fixtureMode = threadWebFixtureData,
                        onOpenThread = {},
                        onOpenWorkspace = {},
                        onOpenDevices = {},
                        onFatalError = {},
                    )
                    return@RemoteCodexTheme
                }
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
                                savedDevices = savedSupervisorDevices,
                                activeDeviceId = savedSupervisorDevices.firstOrNull { device ->
                                    val current = connection
                                    current != null &&
                                        device.mode == current.mode &&
                                        device.normalizedBaseUrl == current.normalizedBaseUrl &&
                                        device.relayDeviceId.orEmpty() == current.relayDeviceId.orEmpty()
                                }?.id,
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
                                    devicesReturnRoute = null
                                    connectionRoute = ConnectionRoute.Workspace(settingsRepository.readLastRoute(config).toConnectedRoute())
                                },
                                onOpenRelaySharedThread = { config, share ->
                                    settingsRepository.writeSupervisorConnection(config)
                                    supervisorConnection = config
                                    devicesReturnRoute = null
                                    settingsRepository.writeLastRoute(
                                        config,
                                        SavedAppRoute.ThreadDetail(
                                            threadId = share.threadId,
                                            workspaceId = share.workspaceId,
                                        ),
                                    )
                                    connectionRoute = ConnectionRoute.Workspace(
                                        ConnectedRoute.ThreadDetail(
                                            threadId = share.threadId,
                                            workspaceId = share.workspaceId,
                                        ),
                                    )
                                },
                                onConnectionStateSaved = { config ->
                                    settingsRepository.writeSupervisorConnection(config)
                                    supervisorConnection = config
                                    connectionRoute = initialConnectionRoute(config, settingsRepository)
                                },
                                onSavedDeviceUpsert = { device ->
                                    settingsRepository.upsertSavedSupervisorDevice(device)
                                    savedSupervisorDevices = settingsRepository.readSavedSupervisorDevices()
                                },
                                onSavedDeviceDelete = { deviceId ->
                                    settingsRepository.deleteSavedSupervisorDevice(deviceId)
                                    savedSupervisorDevices = settingsRepository.readSavedSupervisorDevices()
                                    val current = supervisorConnection
                                    val deletedActive = current != null && savedSupervisorDevices.none { device ->
                                        device.mode == current.mode &&
                                            device.normalizedBaseUrl == current.normalizedBaseUrl &&
                                            device.relayDeviceId.orEmpty() == current.relayDeviceId.orEmpty()
                                    }
                                    if (deletedActive) {
                                        settingsRepository.clearSupervisorConnection()
                                        supervisorConnection = null
                                        homeSnapshot = null
                                        homeSnapshotError = null
                                        homeSnapshotLoading = false
                                    }
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
                                        ConnectionRoute.ModeSelect -> {
                                            val returnRoute = devicesReturnRoute
                                            devicesReturnRoute = null
                                            if (returnRoute == null) ConnectionRoute.ModeSelect else ConnectionRoute.Workspace(returnRoute)
                                        }
                                        is ConnectionRoute.Workspace -> route
                                    }
                                },
                                onRelayDeviceSelectionCleared = {
                                    val current = supervisorConnection ?: return@SupervisorConnectionSetupScreen
                                    val next = current.copy(relayDeviceId = null, relayThreadId = null)
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
                                            val nextRoute = threadId?.let { nextThreadId ->
                                                ConnectedRoute.ThreadDetail(
                                                    threadId = nextThreadId,
                                                    workspaceId = homeSnapshot?.threads
                                                        ?.firstOrNull { it.id == nextThreadId }
                                                        ?.workspaceId,
                                                )
                                            }
                                                ?: if (AndroidFeatureFlags.NativeThreadDetailFallbackEnabled) {
                                                    ConnectedRoute.ThreadPreview
                                                } else {
                                                    ConnectedRoute.Home
                                                }
                                            if (nextRoute is ConnectedRoute.ThreadDetail) {
                                                val scopedConnection = connection.scopedForRelayThread(nextRoute.threadId)
                                                if (scopedConnection != connection) {
                                                    settingsRepository.writeSupervisorConnection(scopedConnection)
                                                    supervisorConnection = scopedConnection
                                                }
                                                settingsRepository.writeLastRoute(
                                                    scopedConnection,
                                                    SavedAppRoute.ThreadDetail(
                                                        threadId = nextRoute.threadId,
                                                        workspaceId = nextRoute.workspaceId,
                                                    ),
                                                )
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
                                            openDevicesScreen()
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
                                            openDevicesScreen()
                                        },
                                    )
                                    is ConnectedRoute.ThreadDetail -> {
	                                        val returnToOwningWorkspace = {
	                                            val workspaceId = route.connectedRoute.workspaceId
	                                            homeSnapshotRefreshNonce += 1
	                                            if (workspaceId.isNullOrBlank()) {
	                                                settingsRepository.writeLastRoute(connection, SavedAppRoute.Home)
	                                                connectionRoute = ConnectionRoute.Workspace(ConnectedRoute.Home)
	                                            } else {
                                                settingsRepository.writeLastRoute(
                                                    connection,
                                                    SavedAppRoute.WorkspaceDetail(workspaceId),
                                                )
                                                connectionRoute = ConnectionRoute.Workspace(
                                                    ConnectedRoute.WorkspaceDetail(workspaceId),
                                                )
                                            }
                                        }
                                        val openThread = { nextThreadId: String ->
                                            val workspaceId = homeSnapshot?.threads
                                                ?.firstOrNull { it.id == nextThreadId }
                                                ?.workspaceId
                                                ?: route.connectedRoute.workspaceId
                                            val scopedConnection = connection.scopedForRelayThread(nextThreadId)
                                            if (scopedConnection != connection) {
                                                settingsRepository.writeSupervisorConnection(scopedConnection)
                                                supervisorConnection = scopedConnection
                                            }
                                            settingsRepository.writeLastRoute(
                                                scopedConnection,
                                                SavedAppRoute.ThreadDetail(
                                                    threadId = nextThreadId,
                                                    workspaceId = workspaceId,
                                                ),
                                            )
                                            connectionRoute = ConnectionRoute.Workspace(
                                                ConnectedRoute.ThreadDetail(
                                                    threadId = nextThreadId,
                                                    workspaceId = workspaceId,
                                                ),
                                            )
                                        }
                                        val openWorkspace = { workspaceId: String ->
                                            settingsRepository.writeLastRoute(connection, SavedAppRoute.WorkspaceDetail(workspaceId))
                                            connectionRoute = ConnectionRoute.Workspace(ConnectedRoute.WorkspaceDetail(workspaceId))
                                        }
                                        val handleNavigationTitle = { _: String, workspaceId: String? ->
                                            if (
                                                !workspaceId.isNullOrBlank() &&
                                                workspaceId != route.connectedRoute.workspaceId
                                            ) {
                                                settingsRepository.writeLastRoute(
                                                    connection,
                                                    SavedAppRoute.ThreadDetail(
                                                        threadId = route.connectedRoute.threadId,
                                                        workspaceId = workspaceId,
                                                    ),
                                                )
                                                connectionRoute = ConnectionRoute.Workspace(
                                                    ConnectedRoute.ThreadDetail(
                                                        threadId = route.connectedRoute.threadId,
                                                        workspaceId = workspaceId,
                                                    ),
                                                )
                                            }
                                        }
                                        if (AndroidFeatureFlags.NativeThreadDetailFallbackEnabled) {
                                            ThreadDetailScreen(
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
                                                    openDevicesScreen()
                                                },
                                                onOpenThread = openThread,
                                                onBackToHome = returnToOwningWorkspace,
                                                onThreadDeleted = returnToOwningWorkspace,
                                            )
                                        } else {
                                            ThreadDetailWebViewScreen(
                                                connection = connection,
                                                threadId = route.connectedRoute.threadId,
                                                themeMode = themeMode,
                                                fixtureMode = false,
                                                onOpenThread = openThread,
                                                onOpenWorkspace = openWorkspace,
                                                onOpenDevices = {
                                                    openDevicesScreen()
                                                },
                                                onCloseThread = returnToOwningWorkspace,
                                                onNavigationTitle = handleNavigationTitle,
                                                onThemeModeSelected = { nextMode ->
                                                    themeMode = nextMode
                                                    settingsRepository.writeThemeMode(nextMode)
                                                },
                                                onFatalError = {
                                                    homeSnapshotRefreshNonce += 1
                                                },
                                            )
                                        }
                                    }
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
                                        onOpenDevices = {
                                            openDevicesScreen()
                                        },
                                        onOpenThread = { threadId ->
                                            val scopedConnection = connection.scopedForRelayThread(threadId)
                                            if (scopedConnection != connection) {
                                                settingsRepository.writeSupervisorConnection(scopedConnection)
                                                supervisorConnection = scopedConnection
                                            }
                                            settingsRepository.writeLastRoute(
                                                scopedConnection,
                                                SavedAppRoute.ThreadDetail(
                                                    threadId = threadId,
                                                    workspaceId = route.connectedRoute.workspaceId,
                                                ),
                                            )
                                            connectionRoute = ConnectionRoute.Workspace(
                                                ConnectedRoute.ThreadDetail(
                                                    threadId = threadId,
                                                    workspaceId = route.connectedRoute.workspaceId,
                                                ),
                                            )
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
                                supervisorConnection = activeConnection.copy(
                                    authToken = null,
                                    relayDeviceId = null,
                                    relayThreadId = null,
                                )
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

private const val ThreadWebFixtureExtra = "remote_codex_thread_web_fixture"
private const val ThreadWebFixtureBaseUrlExtra = "remote_codex_thread_web_base_url"
private const val ThreadWebFixtureThreadIdExtra = "remote_codex_thread_web_thread_id"
private const val ThreadWebFixtureDataExtra = "remote_codex_thread_web_fixture_data"
private const val E2EConnectionBaseUrlExtra = "remote_codex_e2e_connection_base_url"

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
    data class ThreadDetail(val threadId: String, val workspaceId: String? = null) : ConnectedRoute
    data class WorkspaceDetail(val workspaceId: String) : ConnectedRoute
}

private fun SavedAppRoute.toConnectedRoute(): ConnectedRoute {
    return when (this) {
        SavedAppRoute.Home -> ConnectedRoute.Home
        is SavedAppRoute.WorkspaceDetail -> ConnectedRoute.WorkspaceDetail(workspaceId)
        is SavedAppRoute.ThreadDetail -> ConnectedRoute.ThreadDetail(threadId, workspaceId)
    }
}

private fun SupervisorConnectionConfig.scopedForRelayThread(threadId: String): SupervisorConnectionConfig {
    return if (
        mode == SupervisorConnectionMode.Relay &&
        !relayDeviceId.isNullOrBlank() &&
        !relayThreadId.isNullOrBlank()
    ) {
        copy(relayThreadId = threadId)
    } else {
        this
    }
}

private fun shouldHandleBack(route: ConnectionRoute): Boolean {
    return when (route) {
        ConnectionRoute.ModeSelect -> false
        ConnectionRoute.ServerAuth,
        ConnectionRoute.RelayAuth,
        ConnectionRoute.RelayDevices,
        -> true
        is ConnectionRoute.Workspace -> route.connectedRoute != ConnectedRoute.Home
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
