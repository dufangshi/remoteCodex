package com.remotecodex.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.api.AuthLoginResult
import com.remotecodex.android.api.RelayAccessGrantSummary
import com.remotecodex.android.api.RelayCreateDeviceResult
import com.remotecodex.android.api.RelayDeviceSummary
import com.remotecodex.android.api.RelayPortalSummary
import com.remotecodex.android.api.RelaySessionShareAccessSummary
import com.remotecodex.android.api.RelaySessionShareSummary
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorClientError
import com.remotecodex.android.api.SupervisorConnectionCheck
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.settings.SavedSupervisorDevice
import com.remotecodex.android.ui.components.GraphActionIcon
import com.remotecodex.android.ui.components.GraphBadge
import com.remotecodex.android.ui.components.GraphBadgeVariant
import com.remotecodex.android.ui.components.GraphButton
import com.remotecodex.android.ui.components.GraphButtonSize
import com.remotecodex.android.ui.components.GraphButtonVariant
import com.remotecodex.android.ui.components.GraphDialogActionTone
import com.remotecodex.android.ui.components.GraphDialogFooter
import com.remotecodex.android.ui.components.GraphDialogFrame
import com.remotecodex.android.ui.components.GraphDialogOverlay
import com.remotecodex.android.ui.components.GraphFloatingIconButton
import com.remotecodex.android.ui.components.GraphIconButton
import com.remotecodex.android.ui.components.GraphSelectionGlyph
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun SupervisorConnectionSetupScreen(
    initialConfig: SupervisorConnectionConfig?,
    savedDevices: List<SavedSupervisorDevice> = emptyList(),
    activeDeviceId: String? = null,
    initialRoute: ConnectionSetupRoute = ConnectionSetupRoute.ModeSelect,
    onConnectionReady: (SupervisorConnectionConfig, SupervisorConnectionCheck, ConnectionSetupRoute) -> Unit,
    onOpenRelaySharedThread: (SupervisorConnectionConfig, RelaySessionShareSummary) -> Unit = { _, _ -> },
    onConnectionStateSaved: (SupervisorConnectionConfig) -> Unit = {},
    onSavedDeviceUpsert: (SavedSupervisorDevice) -> Unit = {},
    onSavedDeviceDelete: (String) -> Unit = {},
    onBack: () -> Unit = {},
    onRelayDeviceSelectionCleared: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var mode by remember(initialConfig) { mutableStateOf(initialConfig?.mode ?: SupervisorConnectionMode.Local) }
    var baseUrl by remember(initialConfig) {
        mutableStateOf(initialConfig?.normalizedBaseUrl ?: initialUrlForMode(mode))
    }
    var route by remember(initialRoute, initialConfig) { mutableStateOf(initialRoute) }
    var email by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var relayDeviceId by remember(initialConfig) { mutableStateOf(initialConfig?.relayDeviceId.orEmpty()) }
    var authToken by remember(initialConfig) { mutableStateOf(initialConfig?.authToken.orEmpty()) }
    var relayPortal by remember { mutableStateOf<RelayPortalSummary?>(null) }
    var createdDevice by remember { mutableStateOf<RelayCreateDeviceResult?>(null) }
    var newDeviceName by remember { mutableStateOf("Android workstation") }
    var revokeDeviceTarget by remember { mutableStateOf<RelayDeviceSummary?>(null) }
    var editShareTarget by remember { mutableStateOf<RelaySessionShareSummary?>(null) }
    var revokeShareTarget by remember { mutableStateOf<RelaySessionShareSummary?>(null) }
    var relayDeviceCardTarget by remember { mutableStateOf<SavedSupervisorDevice?>(null) }
    var createRelayDeviceDialogOpen by remember { mutableStateOf(false) }
    var relayRegisterDialogOpen by remember { mutableStateOf(false) }
    var deviceEditorTarget by remember { mutableStateOf<SavedSupervisorDevice?>(null) }
    var deviceEditorOpen by remember { mutableStateOf(false) }
    var deleteDeviceTarget by remember { mutableStateOf<SavedSupervisorDevice?>(null) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var relayPortalRefreshing by remember { mutableStateOf(false) }
    var expandedShareId by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    fun buildBaseConfig(token: String? = authToken) = SupervisorConnectionConfig(
        mode = mode,
        baseUrl = baseUrl,
        authToken = token?.takeIf { it.isNotBlank() },
        relayDeviceId = relayDeviceId.takeIf { it.isNotBlank() },
        relayThreadId = null,
    )

    fun loadRelayPortal(token: String = authToken, silent: Boolean = false) {
        if (token.isBlank()) {
            errorMessage = "Log in to the relay before loading devices."
            statusMessage = null
            return
        }
        if (silent && (busy || relayPortalRefreshing)) {
            return
        }
        if (silent) {
            relayPortalRefreshing = true
        } else {
            busy = true
            errorMessage = null
            statusMessage = null
        }
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    SupervisorApiClient(buildBaseConfig(token)).fetchRelayPortal()
                }
            }
            if (silent) {
                relayPortalRefreshing = false
            } else {
                busy = false
            }
            result
                .onSuccess { portal ->
                    relayPortal = portal
                    if (!silent || statusMessage != null) {
                        statusMessage = if (!relayPortalHasAnySelectableDevice(portal)) {
                            "Relay login succeeded. Register a device to connect a backend."
                        } else {
                            relayPortalStatusMessage(portal, relayDeviceId)
                        }
                    }
                }
                .onFailure { error ->
                    if (!silent || relayPortal == null) {
                        errorMessage = userFacingConnectionError(error)
                    }
                }
        }
    }

    fun connectCurrent() {
        busy = true
        errorMessage = null
        statusMessage = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    connectAndCheck(
                        baseConfig = buildBaseConfig(),
                        mode = mode,
                        username = username,
                        password = password,
                    )
                }
            }
            busy = false
            result
                .onSuccess { (config, check) ->
                    statusMessage = "${check.sessionLabel}. ${check.healthLabel}."
                    onConnectionReady(config, check, route)
                }
                .onFailure { error ->
                    errorMessage = userFacingConnectionError(error)
                }
        }
    }

    fun openSharedSession(share: RelaySessionShareSummary) {
        if (authToken.isBlank()) {
            errorMessage = "Log in to the relay before opening shared sessions."
            statusMessage = null
            return
        }
        val config = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Relay,
            baseUrl = baseUrl,
            authToken = authToken,
            relayDeviceId = share.deviceId,
            relayThreadId = share.threadId,
        )
        relayDeviceId = share.deviceId
        onConnectionStateSaved(config)
        onOpenRelaySharedThread(config, share)
    }

    fun openSharedGrant(grant: RelayAccessGrantSummary) {
        if (authToken.isBlank()) {
            errorMessage = "Log in to the relay before opening shared devices."
            statusMessage = null
            return
        }
        val config = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Relay,
            baseUrl = baseUrl,
            authToken = authToken,
            relayDeviceId = grant.deviceId,
            relayThreadId = grant.threadId,
        )
        relayDeviceId = grant.deviceId
        onConnectionStateSaved(config)
        if (grant.threadId != null) {
            onOpenRelaySharedThread(
                config,
                grant.toThreadShareSummary(targetUsername = username.ifBlank { "user" }),
            )
            return
        }
        onConnectionReady(
            config,
            SupervisorConnectionCheck(
                config = config,
                authenticated = true,
                authRequired = true,
                sessionLabel = "Shared device",
                healthLabel = "Relay shared access",
                websocketUrl = config.websocketUrl(),
            ),
            route,
        )
    }

    fun copyRelayDeviceSetup(device: RelayDeviceSummary) {
        val token = device.token?.takeIf { it.isNotBlank() }
        if (token == null) {
            errorMessage = "This device token is not available. Create a new device token to copy setup."
            statusMessage = null
            return
        }
        clipboard.setText(AnnotatedString(relaySupervisorCommand(baseUrl, token)))
        errorMessage = null
        statusMessage = "Copied setup command for ${device.name}."
    }

    fun connectSavedDevice(device: SavedSupervisorDevice) {
        busy = true
        errorMessage = null
        statusMessage = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    connectAndCheck(
                        baseConfig = device.toConnectionConfig(),
                        mode = device.mode,
                        username = device.username.orEmpty(),
                        password = device.password.orEmpty(),
                    )
                }
            }
            busy = false
            result
                .onSuccess { (config, check) ->
                    onSavedDeviceUpsert(
                        device.copy(
                            baseUrl = config.normalizedBaseUrl,
                            authToken = config.authToken,
                            relayDeviceId = config.relayDeviceId,
                        ),
                    )
                    statusMessage = "${check.sessionLabel}. ${check.healthLabel}."
                    onConnectionReady(config, check, route)
                }
                .onFailure { error ->
                    errorMessage = userFacingConnectionError(error)
                }
        }
    }

    fun openSavedRelayDevices(device: SavedSupervisorDevice) {
        relayDeviceCardTarget = device
        mode = SupervisorConnectionMode.Relay
        baseUrl = device.normalizedBaseUrl
        username = device.username.orEmpty()
        password = device.password.orEmpty()
        authToken = device.authToken.orEmpty()
        relayDeviceId = device.relayDeviceId.orEmpty()
        relayPortal = null
        createdDevice = null
        errorMessage = null
        statusMessage = null
        if (!device.authToken.isNullOrBlank()) {
            route = ConnectionSetupRoute.RelayDevices
            return
        }
        if (device.username.isNullOrBlank() || device.password.isNullOrBlank()) {
            route = ConnectionSetupRoute.RelayAuth
            return
        }
        busy = true
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val baseConfig = device.toConnectionConfig().copy(
                        authToken = null,
                        relayDeviceId = null,
                        relayThreadId = null,
                    )
                    val token = SupervisorApiClient(baseConfig).relayLogin(device.username, device.password).token
                    val portal = SupervisorApiClient(baseConfig.copy(authToken = token)).fetchRelayPortal()
                    token to portal
                }
            }
            busy = false
            result
                .onSuccess { (token, portal) ->
                    authToken = token
                    relayPortal = portal
                    relayDeviceId = relayDeviceId.takeIf { current -> relayPortalHasSelectableDevice(portal, current) }.orEmpty()
                    onSavedDeviceUpsert(
                        device.copy(
                            authToken = token,
                            relayDeviceId = relayDeviceId.takeIf { it.isNotBlank() },
                            relayThreadId = null,
                        ),
                    )
                    route = ConnectionSetupRoute.RelayDevices
                    statusMessage = relayPortalStatusMessage(portal, relayDeviceId)
                }
                .onFailure { error ->
                    errorMessage = userFacingConnectionError(error)
                    route = ConnectionSetupRoute.RelayAuth
                }
        }
    }

    fun connectRelayDeviceSelection(deviceIdOverride: String? = null) {
        val token = authToken
        val targetDeviceId = deviceIdOverride ?: relayDeviceId
        if (token.isBlank()) {
            errorMessage = "Log in to the relay before connecting a device."
            statusMessage = null
            route = ConnectionSetupRoute.RelayAuth
            return
        }
        if (targetDeviceId.isBlank()) {
            errorMessage = "Choose a relay backend device first."
            statusMessage = null
            return
        }
        relayPortal?.devices?.firstOrNull { it.id == targetDeviceId }?.let { device ->
            if (!device.connected) {
                errorMessage = "Relay backend is offline. Start its relay supervisor or choose an online device."
                statusMessage = null
                return
            }
        }
        relayDeviceId = targetDeviceId
        busy = true
        errorMessage = null
        statusMessage = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val config = SupervisorConnectionConfig(
                        mode = SupervisorConnectionMode.Relay,
                        baseUrl = baseUrl,
                        authToken = token,
                        relayDeviceId = targetDeviceId,
                        relayThreadId = null,
                    )
                    connectAndCheck(
                        baseConfig = config,
                        mode = SupervisorConnectionMode.Relay,
                        username = username,
                        password = password,
                    )
                }
            }
            busy = false
            result
                .onSuccess { (config, check) ->
                    relayDeviceCardTarget?.let { device ->
                        onSavedDeviceUpsert(
                            device.copy(
                                baseUrl = config.normalizedBaseUrl,
                                username = username.takeIf { it.isNotBlank() } ?: device.username,
                                password = password.takeIf { it.isNotBlank() } ?: device.password,
                                authToken = config.authToken,
                                relayDeviceId = config.relayDeviceId,
                                relayThreadId = null,
                            ),
                        )
                    }
                    statusMessage = "${check.sessionLabel}. ${check.healthLabel}."
                    onConnectionReady(config, check, route)
                }
                .onFailure { error ->
                    errorMessage = userFacingConnectionError(error)
                }
        }
    }

    fun relayLoginOrRegister(register: Boolean) {
        busy = true
        errorMessage = null
        statusMessage = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val baseConfig = buildBaseConfig(token = null).copy(
                        mode = SupervisorConnectionMode.Relay,
                        relayDeviceId = null,
                    )
                    val token = if (register) {
                        SupervisorApiClient(baseConfig).relayRegister(email, username, password).token
                    } else {
                        SupervisorApiClient(baseConfig).relayLogin(username, password).token
                    }
                    val portal = SupervisorApiClient(baseConfig.copy(authToken = token)).fetchRelayPortal()
                    token to portal
                }
            }
            busy = false
            result
                .onSuccess { (token, portal) ->
                    authToken = token
                    relayPortal = portal
                    relayDeviceId = relayDeviceId.takeIf { current -> relayPortalHasSelectableDevice(portal, current) }.orEmpty()
                    onConnectionStateSaved(
                        SupervisorConnectionConfig(
                            mode = SupervisorConnectionMode.Relay,
                            baseUrl = baseUrl,
                            authToken = token,
                            relayDeviceId = relayDeviceId.takeIf { it.isNotBlank() },
                            relayThreadId = null,
                        ),
                    )
                    route = ConnectionSetupRoute.RelayDevices
                    relayRegisterDialogOpen = false
                    statusMessage = if (!relayPortalHasAnySelectableDevice(portal)) {
                        "Relay account ready. Register a backend device."
                    } else {
                        relayPortalStatusMessage(portal, relayDeviceId)
                    }
                }
                .onFailure { error ->
                    errorMessage = userFacingConnectionError(error)
                }
        }
    }

    fun validateRelayEndpointThenContinue() {
        busy = true
        errorMessage = null
        statusMessage = "Checking relay URL..."
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    SupervisorApiClient(
                        buildBaseConfig(token = null).copy(
                            mode = SupervisorConnectionMode.Relay,
                            authToken = null,
                            relayDeviceId = null,
                        ),
                    ).fetchHealth()
                }
            }
            busy = false
            result
                .onSuccess {
                    statusMessage = null
                    route = ConnectionSetupRoute.RelayAuth
                }
                .onFailure { error ->
                    statusMessage = null
                    errorMessage = userFacingConnectionError(error)
                }
        }
    }

    LaunchedEffect(route, authToken) {
        if (route != ConnectionSetupRoute.RelayDevices || authToken.isBlank()) {
            return@LaunchedEffect
        }

        if (relayPortal == null && !busy) {
            loadRelayPortal(authToken)
        }
        while (true) {
            delay(3_000)
            loadRelayPortal(authToken, silent = true)
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ThreadColors.Background)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(16.dp),
    ) {
        Column(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    text = when (route) {
                        ConnectionSetupRoute.ModeSelect -> "Connection"
                        ConnectionSetupRoute.RelayDevices -> "Relay portal"
                        ConnectionSetupRoute.ServerAuth,
                        ConnectionSetupRoute.RelayAuth,
                        -> "Remote Codex"
                    },
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                )
                when (route) {
                    ConnectionSetupRoute.ModeSelect -> {
                        GraphFloatingIconButton(
                            icon = GraphActionIcon.Add,
                            enabled = !busy,
                            emphasized = true,
                            contentDescription = "Add device",
                            onClick = {
                                deviceEditorTarget = null
                                deviceEditorOpen = true
                            },
                        )
                    }
                    ConnectionSetupRoute.RelayDevices -> {
                        GraphFloatingIconButton(
                            icon = GraphActionIcon.Add,
                            enabled = !busy && authToken.isNotBlank(),
                            emphasized = true,
                            contentDescription = "Create relay device",
                            onClick = {
                                createRelayDeviceDialogOpen = true
                            },
                        )
                    }
                    ConnectionSetupRoute.ServerAuth,
                    ConnectionSetupRoute.RelayAuth,
                    -> Unit
                }
            }
            Text(
                text = when (route) {
                    ConnectionSetupRoute.ModeSelect -> "Select a saved connection or add a new Local, Server, or Relay endpoint."
                    ConnectionSetupRoute.ServerAuth -> "Sign in to a direct supervisor server."
                    ConnectionSetupRoute.RelayAuth -> "Sign in or create a relay account."
                    ConnectionSetupRoute.RelayDevices -> "Connect backend devices and manage shared threads."
                },
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
            )

            when (route) {
                ConnectionSetupRoute.ModeSelect -> {
                    ConnectionPanel(title = "Connections", detail = "Cards are stored on this Android device and can be opened, edited, or deleted independently.") {
                        if (savedDevices.isEmpty()) {
                            Text(
                                text = "No saved connections yet. Tap + to add Local, Server, or Relay.",
                                color = ThreadColors.ForegroundMuted,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        } else {
                            savedDevices.forEach { device ->
                                SavedDeviceCard(
                                    device = device,
                                    active = device.id == activeDeviceId,
                                    busy = busy,
                                    onConnect = {
                                        if (device.mode == SupervisorConnectionMode.Relay) {
                                            openSavedRelayDevices(device)
                                        } else {
                                            connectSavedDevice(device)
                                        }
                                    },
                                    onEdit = {
                                        deviceEditorTarget = device
                                        deviceEditorOpen = true
                                    },
                                    onDelete = { deleteDeviceTarget = device },
                                )
                            }
                        }
                    }
                }
                ConnectionSetupRoute.ServerAuth -> {
                    ConnectionPanel(title = "Server login", detail = "Use supervisor admin credentials.") {
                        ConnectionTextField(
                            label = "URL",
                            value = baseUrl,
                            onValueChange = { baseUrl = it },
                            contentDescription = "Server URL",
                            keyboardType = KeyboardType.Uri,
                        )
                        ConnectionTextField(
                            label = "Username",
                            value = username,
                            onValueChange = { username = it },
                            contentDescription = "Server username",
                        )
                        ConnectionTextField(
                            label = "Password",
                            value = password,
                            onValueChange = { password = it },
                            contentDescription = "Server password",
                            password = true,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            GraphButton(
                                label = "Back",
                                enabled = !busy,
                                variant = GraphButtonVariant.Outline,
                                size = GraphButtonSize.Default,
                                contentDescription = "Back to mode selection",
                                onClick = { route = ConnectionSetupRoute.ModeSelect },
                            )
                            GraphButton(
                                label = if (busy) "Signing in..." else "Sign in",
                                enabled = !busy,
                                variant = GraphButtonVariant.Default,
                                size = GraphButtonSize.Default,
                                contentDescription = "Sign in to server",
                                onClick = { connectCurrent() },
                            )
                        }
                    }
                }
                ConnectionSetupRoute.RelayAuth -> {
                    ConnectionPanel(title = "Relay account", detail = "Use an existing relay account or register a new one.") {
                        ConnectionTextField(
                            label = "Relay URL",
                            value = baseUrl,
                            onValueChange = { baseUrl = it },
                            contentDescription = "Relay URL",
                            keyboardType = KeyboardType.Uri,
                        )
                        ConnectionTextField(
                            label = "Identifier",
                            value = username,
                            onValueChange = { username = it },
                            contentDescription = "Relay identifier",
                        )
                        ConnectionTextField(
                            label = "Password",
                            value = password,
                            onValueChange = { password = it },
                            contentDescription = "Relay password",
                            password = true,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            GraphButton(
                                label = "Back",
                                enabled = !busy,
                                variant = GraphButtonVariant.Outline,
                                size = GraphButtonSize.Default,
                                contentDescription = "Back to mode selection",
                                onClick = { route = ConnectionSetupRoute.ModeSelect },
                            )
                            GraphButton(
                                label = if (busy) "Signing in..." else "Sign in",
                                enabled = !busy,
                                variant = GraphButtonVariant.Default,
                                size = GraphButtonSize.Default,
                                contentDescription = "Authenticate relay account",
                                onClick = { relayLoginOrRegister(false) },
                            )
                            GraphButton(
                                label = "Register",
                                icon = GraphActionIcon.Add,
                                enabled = !busy,
                                variant = GraphButtonVariant.Outline,
                                size = GraphButtonSize.Default,
                                contentDescription = "Register relay account",
                                onClick = {
                                    relayRegisterDialogOpen = true
                                },
                            )
                        }
                    }
                }
                ConnectionSetupRoute.RelayDevices -> {
                    RelayDevicesPanel(
                        devices = relayPortal?.devices.orEmpty(),
                        sharedWithMe = relayPortal?.sharedWithMe.orEmpty(),
                        sharedDevicesWithMe = relayPortal?.sharedDevicesWithMe.orEmpty(),
                        sharedByMe = relayPortal?.sharedByMe.orEmpty(),
                        grantsByMe = relayPortal?.grantsByMe.orEmpty(),
                        expandedShareId = expandedShareId,
                        selectedDeviceId = relayDeviceId,
                        createdDevice = createdDevice,
                        relayBaseUrl = baseUrl,
                        busy = busy,
                        onConnectDevice = { deviceId -> connectRelayDeviceSelection(deviceId) },
                        onCopySetup = { device -> copyRelayDeviceSetup(device) },
                        onOpenSharedSession = { share -> openSharedSession(share) },
                        onOpenSharedGrant = { grant -> openSharedGrant(grant) },
                        onToggleShareAccess = { share ->
                            expandedShareId = if (expandedShareId == share.id) null else share.id
                        },
                        onEditShare = { share -> editShareTarget = share },
                        onRevokeShare = { share -> revokeShareTarget = share },
                        onRevokeDevice = { revokeDeviceTarget = it },
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GraphButton(
                            label = "Back",
                            enabled = !busy,
                            variant = GraphButtonVariant.Outline,
                            size = GraphButtonSize.Default,
                            contentDescription = "Back to relay account",
                            onClick = {
                                if (
                                    initialRoute == ConnectionSetupRoute.RelayDevices
                                ) {
                                    onBack()
                                } else {
                                    route = ConnectionSetupRoute.RelayAuth
                                }
                            },
                        )
                    }
                }
            }

            statusMessage?.let { message ->
                ConnectionStatus(message = message, error = false)
            }
            errorMessage?.let { message ->
                ConnectionStatus(message = message, error = true)
            }
        }

        revokeDeviceTarget?.let { target ->
            RevokeRelayDeviceDialog(
                device = target,
                busy = busy,
                onClose = {
                    if (!busy) {
                        revokeDeviceTarget = null
                    }
                },
                onConfirm = {
                    val token = authToken
                    if (token.isBlank()) {
                        errorMessage = "Log in to the relay before revoking a device."
                        statusMessage = null
                        revokeDeviceTarget = null
                        return@RevokeRelayDeviceDialog
                    }
                    busy = true
                    errorMessage = null
                    statusMessage = null
                    scope.launch {
                        val result = withContext(Dispatchers.IO) {
                            runCatching {
                                val client = SupervisorApiClient(buildBaseConfig(token))
                                val revokedId = client.deleteRelayDevice(target.id)
                                val portal = client.fetchRelayPortal()
                                revokedId to portal
                            }
                        }
                        busy = false
                        result
                            .onSuccess { (revokedId, portal) ->
                                revokeDeviceTarget = null
                                relayPortal = portal
                                val revokedSelectedDevice = relayDeviceId == revokedId
                                relayDeviceId = relayDeviceId.takeIf { it != revokedId && relayPortalHasSelectableDevice(portal, it) }.orEmpty()
                                if (revokedSelectedDevice) {
                                    onRelayDeviceSelectionCleared()
                                }
                                if (createdDevice?.device?.id == revokedId) {
                                    createdDevice = null
                                }
                                statusMessage = if (!relayPortalHasAnySelectableDevice(portal)) {
                                    "Device revoked. Register another backend device to connect."
                                } else {
                                    "Device revoked. ${relayPortalStatusMessage(portal, relayDeviceId)}"
                                }
                            }
                            .onFailure { error ->
                                errorMessage = userFacingConnectionError(error)
                            }
                    }
                },
            )
        }

        editShareTarget?.let { target ->
            RelaySharePermissionsDialog(
                share = target,
                busy = busy,
                onClose = {
                    if (!busy) {
                        editShareTarget = null
                    }
                },
                onSave = { label, threadAccess, workspaceAccess ->
                    val token = authToken
                    if (token.isBlank()) {
                        errorMessage = "Log in to the relay before managing shared threads."
                        statusMessage = null
                        editShareTarget = null
                        return@RelaySharePermissionsDialog
                    }
                    busy = true
                    errorMessage = null
                    statusMessage = null
                    scope.launch {
                        val result = withContext(Dispatchers.IO) {
                            runCatching {
                                val client = SupervisorApiClient(buildBaseConfig(token))
                                client.updateRelayShare(
                                    shareId = target.id,
                                    label = label,
                                    threadAccess = threadAccess,
                                    workspaceAccess = if (target.workspaceId == null) "none" else workspaceAccess,
                                    workspaceId = target.workspaceId,
                                    expiresAt = target.expiresAt,
                                )
                                client.fetchRelayPortal()
                            }
                        }
                        busy = false
                        result
                            .onSuccess { portal ->
                                editShareTarget = null
                                relayPortal = portal
                                statusMessage = "Shared thread permissions updated."
                            }
                            .onFailure { error ->
                                errorMessage = userFacingConnectionError(error)
                            }
                    }
                },
            )
        }

        revokeShareTarget?.let { target ->
            RevokeRelayShareDialog(
                share = target,
                busy = busy,
                onClose = {
                    if (!busy) {
                        revokeShareTarget = null
                    }
                },
                onConfirm = {
                    val token = authToken
                    if (token.isBlank()) {
                        errorMessage = "Log in to the relay before managing shared threads."
                        statusMessage = null
                        revokeShareTarget = null
                        return@RevokeRelayShareDialog
                    }
                    busy = true
                    errorMessage = null
                    statusMessage = null
                    scope.launch {
                        val result = withContext(Dispatchers.IO) {
                            runCatching {
                                val client = SupervisorApiClient(buildBaseConfig(token))
                                client.revokeRelayShare(target.id)
                                client.fetchRelayPortal()
                            }
                        }
                        busy = false
                        result
                            .onSuccess { portal ->
                                revokeShareTarget = null
                                expandedShareId = expandedShareId.takeIf { it != target.id }
                                relayPortal = portal
                                statusMessage = "Shared thread access removed."
                            }
                            .onFailure { error ->
                                errorMessage = userFacingConnectionError(error)
                            }
                    }
                },
            )
        }

        if (deviceEditorOpen) {
            SavedDeviceEditorDialog(
                initialDevice = deviceEditorTarget,
                busy = busy,
                onClose = {
                    if (!busy) {
                        deviceEditorOpen = false
                        deviceEditorTarget = null
                    }
                },
                onSave = { device ->
                    onSavedDeviceUpsert(device)
                    deviceEditorOpen = false
                    deviceEditorTarget = null
                    statusMessage = "Saved ${device.name}."
                    errorMessage = null
                },
            )
        }

        deleteDeviceTarget?.let { target ->
            DeleteSavedDeviceDialog(
                device = target,
                onClose = { deleteDeviceTarget = null },
                onConfirm = {
                    onSavedDeviceDelete(target.id)
                    deleteDeviceTarget = null
                    statusMessage = "Deleted ${target.name}."
                    errorMessage = null
                },
            )
        }

        if (createRelayDeviceDialogOpen) {
            CreateRelayDeviceDialog(
                name = newDeviceName,
                busy = busy,
                onNameChange = { newDeviceName = it },
                onClose = {
                    if (!busy) {
                        createRelayDeviceDialogOpen = false
                    }
                },
                onCreate = {
                    val token = authToken
                    if (token.isBlank()) {
                        errorMessage = "Log in to the relay before creating a device."
                        statusMessage = null
                        route = ConnectionSetupRoute.RelayAuth
                        createRelayDeviceDialogOpen = false
                        return@CreateRelayDeviceDialog
                    }
                    busy = true
                    errorMessage = null
                    statusMessage = null
                    scope.launch {
                        val result = withContext(Dispatchers.IO) {
                            runCatching {
                                val client = SupervisorApiClient(buildBaseConfig(token))
                                val created = client.createRelayDevice(newDeviceName)
                                val portal = client.fetchRelayPortal()
                                created to portal
                            }
                        }
                        busy = false
                        result
                            .onSuccess { (created, portal) ->
                                createRelayDeviceDialogOpen = false
                                createdDevice = created
                                relayPortal = portal
                                relayDeviceId = created.device.id
                                relayDeviceCardTarget?.let { device ->
                                    onSavedDeviceUpsert(
                                        device.copy(
                                            authToken = token,
                                            relayDeviceId = created.device.id,
                                        ),
                                    )
                                }
                                statusMessage = "Device registered. Use the one-time token on the backend."
                            }
                            .onFailure { error ->
                                errorMessage = userFacingConnectionError(error)
                            }
                    }
                },
            )
        }
        if (relayRegisterDialogOpen) {
            RelayRegisterDialog(
                baseUrl = baseUrl,
                email = email,
                username = username,
                password = password,
                busy = busy,
                onBaseUrlChange = { baseUrl = it },
                onEmailChange = { email = it },
                onUsernameChange = { username = it },
                onPasswordChange = { password = it },
                onClose = {
                    if (!busy) {
                        relayRegisterDialogOpen = false
                    }
                },
                onRegister = { relayLoginOrRegister(true) },
            )
        }
    }
}

@Composable
private fun SavedDeviceCard(
    device: SavedSupervisorDevice,
    active: Boolean,
    busy: Boolean,
    onConnect: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(if (active) ThreadColors.SuccessSoft else ThreadColors.SurfaceStrong)
            .border(1.dp, if (active) ThreadColors.Success else ThreadColors.Border, RoundedCornerShape(14.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = device.name,
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = device.normalizedBaseUrl,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            GraphBadge(
                label = when (device.mode) {
                    SupervisorConnectionMode.Local -> "Local / Intranet"
                    SupervisorConnectionMode.Server -> "Server"
                    SupervisorConnectionMode.Relay -> "Relay"
                },
                variant = if (active) GraphBadgeVariant.Outline else GraphBadgeVariant.Secondary,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            GraphButton(
                label = if (device.mode == SupervisorConnectionMode.Relay) {
                    "Relay portal"
                } else {
                    "Connect"
                },
                enabled = !busy,
                variant = GraphButtonVariant.Default,
                size = GraphButtonSize.Small,
                contentDescription = if (device.mode == SupervisorConnectionMode.Relay) {
                    "Open relay portal ${device.name}"
                } else {
                    "Connect device ${device.name}"
                },
                onClick = onConnect,
            )
            GraphButton(
                label = "Edit",
                enabled = !busy,
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Small,
                contentDescription = "Edit device ${device.name}",
                onClick = onEdit,
            )
            GraphIconButton(
                icon = GraphActionIcon.Delete,
                contentDescription = "Delete device ${device.name}",
                variant = GraphButtonVariant.Destructive,
                size = GraphButtonSize.Small,
                onClick = onDelete,
            )
        }
    }
}

@Composable
private fun SavedDeviceEditorDialog(
    initialDevice: SavedSupervisorDevice?,
    busy: Boolean,
    onClose: () -> Unit,
    onSave: (SavedSupervisorDevice) -> Unit,
) {
    var name by remember(initialDevice) {
        mutableStateOf(initialDevice?.name ?: "")
    }
    var mode by remember(initialDevice) {
        mutableStateOf(initialDevice?.mode ?: SupervisorConnectionMode.Local)
    }
    var baseUrl by remember(initialDevice, mode) {
        mutableStateOf(initialDevice?.normalizedBaseUrl ?: defaultUrlForMode(mode))
    }
    var username by remember(initialDevice) {
        mutableStateOf(initialDevice?.username.orEmpty())
    }
    var password by remember(initialDevice) {
        mutableStateOf(initialDevice?.password.orEmpty())
    }
    val normalizedName = name.trim().ifBlank {
        when (mode) {
            SupervisorConnectionMode.Local -> "Local"
            SupervisorConnectionMode.Server -> "Server"
            SupervisorConnectionMode.Relay -> "Relay"
        }
    }
    val normalizedBaseUrl = sanitizeEndpointInput(baseUrl)
    val canSave = normalizedBaseUrl.isNotBlank() && isValidHttpEndpoint(normalizedBaseUrl)
    GraphDialogOverlay(onDismiss = onClose) {
        GraphDialogFrame(
            title = if (initialDevice == null) "Add Device" else "Edit Device",
            subtitle = "Save a Local, Server, or Relay connection card on this Android device.",
            onClose = onClose,
            footer = {
                GraphDialogFooter(
                    primaryLabel = "Save",
                    primaryTone = GraphDialogActionTone.Success,
                    primaryEnabled = !busy && canSave,
                    onCancel = onClose,
                    onPrimary = {
                        onSave(
                            SavedSupervisorDevice(
                                id = initialDevice?.id ?: java.util.UUID.randomUUID().toString(),
                                name = normalizedName,
                                mode = mode,
                                baseUrl = normalizedBaseUrl,
                                username = username.trim().takeIf { it.isNotBlank() },
                                password = password.takeIf { it.isNotBlank() },
                                authToken = initialDevice?.authToken,
                                relayDeviceId = initialDevice?.relayDeviceId,
                            ),
                        )
                    },
                )
            },
        ) {
            ConnectionTextField(
                label = "Name",
                value = name,
                onValueChange = { name = it },
                contentDescription = "Device name",
                placeholder = normalizedName,
            )
            Text(
                text = "Mode",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
            SupervisorConnectionMode.entries.forEach { option ->
                ConnectionModeRow(
                    mode = option,
                    selected = option == mode,
                    onClick = {
                        mode = option
                        if (initialDevice == null) {
                            baseUrl = defaultUrlForMode(option)
                        }
                    },
                )
            }
            ConnectionTextField(
                label = "URL",
                value = baseUrl,
                onValueChange = { baseUrl = it },
                contentDescription = "Device URL",
                keyboardType = KeyboardType.Uri,
                placeholder = defaultUrlForMode(mode),
            )
            if (normalizedBaseUrl.isNotBlank() && !isValidHttpEndpoint(normalizedBaseUrl)) {
                Text(
                    text = "Enter a valid http(s) endpoint.",
                    color = ThreadColors.Danger,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
            if (mode == SupervisorConnectionMode.Server || mode == SupervisorConnectionMode.Relay) {
                ConnectionTextField(
                    label = if (mode == SupervisorConnectionMode.Relay) "Identifier" else "Username",
                    value = username,
                    onValueChange = { username = it },
                    contentDescription = "Device username",
                )
                ConnectionTextField(
                    label = "Password",
                    value = password,
                    onValueChange = { password = it },
                    contentDescription = "Device password",
                    password = true,
                )
            }
        }
    }
}

@Composable
private fun DeleteSavedDeviceDialog(
    device: SavedSupervisorDevice,
    onClose: () -> Unit,
    onConfirm: () -> Unit,
) {
    GraphDialogOverlay(onDismiss = onClose) {
        GraphDialogFrame(
            title = "Delete Device",
            subtitle = "Remove this saved connection card from Android.",
            onClose = onClose,
            footer = {
                GraphDialogFooter(
                    primaryLabel = "Delete",
                    primaryTone = GraphDialogActionTone.Danger,
                    onCancel = onClose,
                    onPrimary = onConfirm,
                )
            },
        ) {
            Text(
                text = device.name,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "This only removes the saved Android card. It does not delete workspaces or threads on the supervisor.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
            ConnectionSettingText(label = "URL", value = device.normalizedBaseUrl)
        }
    }
}

@Composable
fun SupervisorAccountPanel(
    config: SupervisorConnectionConfig,
    onClose: () -> Unit,
    onDisconnect: () -> Unit,
    onManageDevices: () -> Unit,
    onChangeAccount: () -> Unit,
    onReauthenticate: () -> Unit,
    onChangeMode: () -> Unit,
    modifier: Modifier = Modifier,
) {
    GraphDialogOverlay(onDismiss = onClose, modifier = modifier) {
        GraphDialogFrame(
            title = "Supervisor account",
            subtitle = "${config.mode.label} / ${config.normalizedBaseUrl}",
            onClose = onClose,
            footer = {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    GraphButton(
                        label = "Devices",
                        variant = GraphButtonVariant.Outline,
                        size = GraphButtonSize.Small,
                        contentDescription = "Open devices",
                        onClick = {
                            onClose()
                            onChangeMode()
                        },
                    )
                    Spacer(modifier = Modifier.weight(1f))
                    GraphButton(
                        label = "Disconnect",
                        variant = GraphButtonVariant.Destructive,
                        size = GraphButtonSize.Small,
                        contentDescription = "Disconnect supervisor",
                        onClick = {
                            onClose()
                            onDisconnect()
                        },
                    )
                }
            },
        ) {
            ConnectionSettingText(label = "URL", value = config.normalizedBaseUrl)
            when (config.mode) {
                SupervisorConnectionMode.Relay -> {
                    ConnectionSettingText(
                        label = "Device",
                        value = config.relayDeviceId?.takeIf { it.isNotBlank() } ?: "No device selected",
                    )
                    GraphButton(
                        label = "Manage devices",
                        enabled = !config.authToken.isNullOrBlank(),
                        variant = GraphButtonVariant.Secondary,
                        size = GraphButtonSize.Default,
                        contentDescription = "Manage relay devices",
                        onClick = {
                            onClose()
                            onManageDevices()
                        },
                    )
                    GraphButton(
                        label = "Change account",
                        variant = GraphButtonVariant.Outline,
                        size = GraphButtonSize.Default,
                        contentDescription = "Change relay account",
                        onClick = {
                            onClose()
                            onChangeAccount()
                        },
                    )
                }
                SupervisorConnectionMode.Server -> {
                    GraphButton(
                        label = "Re-authenticate",
                        variant = GraphButtonVariant.Secondary,
                        size = GraphButtonSize.Default,
                        contentDescription = "Re-authenticate server",
                        onClick = {
                            onClose()
                            onReauthenticate()
                        },
                    )
                }
                SupervisorConnectionMode.Local -> {
                    Text(
                        text = "Local supervisor access does not require an account token.",
                        color = ThreadColors.ForegroundMuted,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}

enum class ConnectionSetupRoute {
    ModeSelect,
    ServerAuth,
    RelayAuth,
    RelayDevices,
}

private fun connectAndCheck(
    baseConfig: SupervisorConnectionConfig,
    mode: SupervisorConnectionMode,
    username: String,
    password: String,
): Pair<SupervisorConnectionConfig, SupervisorConnectionCheck> {
    val authenticatedConfig = when (mode) {
        SupervisorConnectionMode.Local -> baseConfig
        SupervisorConnectionMode.Server -> {
            if (!baseConfig.authToken.isNullOrBlank()) {
                baseConfig
            } else {
                val login = SupervisorApiClient(baseConfig).login(username, password)
                baseConfig.copy(authToken = login.tokenFromSession())
            }
        }
        SupervisorConnectionMode.Relay -> {
            if (!baseConfig.authToken.isNullOrBlank()) {
                baseConfig
            } else {
                val login = SupervisorApiClient(baseConfig).relayLogin(username, password)
                baseConfig.copy(authToken = login.token)
            }
        }
    }
    val check = SupervisorApiClient(authenticatedConfig).checkConnection()
    if (mode != SupervisorConnectionMode.Local && !check.authenticated) {
        throw SupervisorClientError.Authentication("Login failed or token is not valid for this endpoint.")
    }
    return authenticatedConfig to check
}

private fun AuthLoginResult.tokenFromSession(): String? {
    return token
}

@Composable
private fun CreateRelayDeviceDialog(
    name: String,
    busy: Boolean,
    onNameChange: (String) -> Unit,
    onClose: () -> Unit,
    onCreate: () -> Unit,
) {
    GraphDialogOverlay(onDismiss = onClose) {
        GraphDialogFrame(
            title = "Create Device",
            subtitle = "Create a relay backend token for a private supervisor.",
            onClose = onClose,
            footer = {
                GraphDialogFooter(
                    primaryLabel = if (busy) "Creating..." else "Create",
                    primaryTone = GraphDialogActionTone.Success,
                    primaryEnabled = !busy && name.isNotBlank(),
                    onCancel = onClose,
                    onPrimary = onCreate,
                )
            },
        ) {
            ConnectionTextField(
                label = "Device name",
                value = name,
                onValueChange = onNameChange,
                contentDescription = "New relay device name",
                placeholder = "Android workstation",
            )
            Text(
                text = "After creation, copy the one-time token command to the backend machine.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun RelayRegisterDialog(
    baseUrl: String,
    email: String,
    username: String,
    password: String,
    busy: Boolean,
    onBaseUrlChange: (String) -> Unit,
    onEmailChange: (String) -> Unit,
    onUsernameChange: (String) -> Unit,
    onPasswordChange: (String) -> Unit,
    onClose: () -> Unit,
    onRegister: () -> Unit,
) {
    GraphDialogOverlay(onDismiss = onClose) {
        GraphDialogFrame(
            title = "Register Relay",
            subtitle = "Create a relay account for syncing backend devices.",
            onClose = onClose,
            footer = {
                GraphDialogFooter(
                    primaryLabel = if (busy) "Creating..." else "Create account",
                    primaryTone = GraphDialogActionTone.Success,
                    primaryEnabled = !busy && baseUrl.isNotBlank() && email.isNotBlank() && username.isNotBlank() && password.isNotBlank(),
                    onCancel = onClose,
                    onPrimary = onRegister,
                )
            },
        ) {
            ConnectionTextField(
                label = "Relay URL",
                value = baseUrl,
                onValueChange = onBaseUrlChange,
                contentDescription = "Relay registration URL",
                keyboardType = KeyboardType.Uri,
            )
            ConnectionTextField(
                label = "Email",
                value = email,
                onValueChange = onEmailChange,
                contentDescription = "Relay registration email",
                keyboardType = KeyboardType.Email,
            )
            ConnectionTextField(
                label = "Username",
                value = username,
                onValueChange = onUsernameChange,
                contentDescription = "Relay registration username",
            )
            ConnectionTextField(
                label = "Password",
                value = password,
                onValueChange = onPasswordChange,
                contentDescription = "Relay registration password",
                password = true,
            )
        }
    }
}

@Composable
private fun RelayDevicesPanel(
    devices: List<RelayDeviceSummary>,
    sharedWithMe: List<RelaySessionShareSummary>,
    sharedDevicesWithMe: List<RelayAccessGrantSummary>,
    sharedByMe: List<RelaySessionShareSummary>,
    grantsByMe: List<RelayAccessGrantSummary>,
    expandedShareId: String?,
    selectedDeviceId: String,
    createdDevice: RelayCreateDeviceResult?,
    relayBaseUrl: String,
    busy: Boolean,
    onConnectDevice: (String) -> Unit,
    onCopySetup: (RelayDeviceSummary) -> Unit,
    onOpenSharedSession: (RelaySessionShareSummary) -> Unit,
    onOpenSharedGrant: (RelayAccessGrantSummary) -> Unit,
    onToggleShareAccess: (RelaySessionShareSummary) -> Unit,
    onEditShare: (RelaySessionShareSummary) -> Unit,
    onRevokeShare: (RelaySessionShareSummary) -> Unit,
    onRevokeDevice: (RelayDeviceSummary) -> Unit,
) {
    ConnectionPanel(
        title = "Relay portal",
        detail = "Backend devices and shared threads under this relay account.",
    ) {
        if (devices.isEmpty()) {
            Text(
                text = "No relay devices loaded for this account.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodySmall,
            )
        } else {
            devices.forEach { device ->
                RelayDeviceRow(
                    device = device,
                    selected = device.id == selectedDeviceId,
                    onConnect = { onConnectDevice(device.id) },
                    onCopySetup = { onCopySetup(device) },
                    onRevoke = { onRevokeDevice(device) },
                    busy = busy,
                )
            }
        }

        createdDevice?.let { result ->
            RelayDeviceTokenNotice(result = result, relayBaseUrl = relayBaseUrl)
        }

        Text(
            text = "Shared with me",
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = "Shared devices",
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        if (sharedDevicesWithMe.isEmpty()) {
            Text(
                text = "No shared devices for this relay account yet.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodySmall,
            )
        } else {
            sharedDevicesWithMe.forEach { grant ->
                RelaySharedGrantRow(
                    grant = grant,
                    busy = busy,
                    mode = RelayShareRowMode.Incoming,
                    onOpen = { onOpenSharedGrant(grant) },
                )
            }
        }

        Text(
            text = "Shared threads",
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        if (sharedWithMe.isEmpty()) {
            Text(
                text = "No shared threads for this relay account yet.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodySmall,
            )
        } else {
            sharedWithMe.forEach { share ->
                RelaySharedSessionRow(
                    share = share,
                    busy = busy,
                    mode = RelayShareRowMode.Incoming,
                    onOpen = { onOpenSharedSession(share) },
                    onToggleAccess = {},
                )
            }
        }

        Text(
            text = "Shared by me",
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.SemiBold,
        )
        if (sharedByMe.isEmpty() && grantsByMe.isEmpty()) {
            Text(
                text = "No shared access from this relay account yet.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodySmall,
            )
        } else {
            grantsByMe.forEach { grant ->
                RelaySharedGrantRow(
                    grant = grant,
                    busy = busy,
                    mode = RelayShareRowMode.Outgoing,
                    onOpen = { onOpenSharedGrant(grant) },
                )
            }
            sharedByMe.forEach { share ->
                RelaySharedSessionRow(
                    share = share,
                    busy = busy,
                    expanded = expandedShareId == share.id,
                    mode = RelayShareRowMode.Outgoing,
                    onOpen = { onOpenSharedSession(share) },
                    onToggleAccess = { onToggleShareAccess(share) },
                    onEdit = { onEditShare(share) },
                    onRevoke = { onRevokeShare(share) },
                )
            }
        }
    }
}

@Composable
private fun RelayDeviceRow(
    device: RelayDeviceSummary,
    selected: Boolean,
    busy: Boolean,
    onConnect: () -> Unit,
    onCopySetup: () -> Unit,
    onRevoke: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) ThreadColors.InfoSoft else ThreadColors.SurfaceStrong)
            .border(1.dp, if (selected) ThreadColors.Info.copy(alpha = 0.42f) else ThreadColors.Border, RoundedCornerShape(12.dp))
            .clickable(enabled = !busy && device.connected, onClick = onConnect)
            .padding(10.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = device.name,
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                GraphBadge(
                    label = if (device.connected) "Online" else "Offline",
                    variant = if (device.connected) GraphBadgeVariant.Outline else GraphBadgeVariant.Secondary,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                GraphButton(
                    label = "Copy setup",
                    enabled = !busy && !device.token.isNullOrBlank(),
                    variant = GraphButtonVariant.Outline,
                    size = GraphButtonSize.Small,
                    icon = GraphActionIcon.Copy,
                    contentDescription = "Copy setup command for relay device ${device.name}",
                    onClick = onCopySetup,
                )
                GraphButton(
                    label = if (busy && selected) "Connecting..." else "Connect",
                    enabled = !busy && device.connected,
                    variant = GraphButtonVariant.Default,
                    size = GraphButtonSize.Small,
                    contentDescription = "Connect relay device ${device.name}",
                    onClick = onConnect,
                )
                GraphButton(
                    label = "Revoke",
                    enabled = !busy,
                    variant = GraphButtonVariant.Destructive,
                    size = GraphButtonSize.Small,
                    icon = GraphActionIcon.Delete,
                    contentDescription = "Revoke relay device ${device.name}",
                    onClick = onRevoke,
                )
            }
            Text(
                text = deviceStatusLine(device),
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun RelaySharedSessionRow(
    share: RelaySessionShareSummary,
    busy: Boolean,
    mode: RelayShareRowMode,
    expanded: Boolean = false,
    onOpen: () -> Unit,
    onToggleAccess: () -> Unit,
    onEdit: () -> Unit = {},
    onRevoke: () -> Unit = {},
) {
    val shareTitle = shareTitle(share)
    val workspaceLabel = share.workspaceLabel?.takeIf { it.isNotBlank() } ?: "Workspace unavailable"
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = shareTitle,
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (mode == RelayShareRowMode.Incoming) {
                    GraphButton(
                        label = "Open",
                        enabled = !busy,
                        variant = GraphButtonVariant.Default,
                        size = GraphButtonSize.Small,
                        icon = GraphActionIcon.Open,
                        contentDescription = "Open shared thread $shareTitle",
                        onClick = onOpen,
                    )
                }
            }
            Text(
                text = "Workspace: $workspaceLabel",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "Thread: $shareTitle",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = if (mode == RelayShareRowMode.Incoming) "From ${share.ownerUsername}" else "To ${share.targetUsername}",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "Device: ${share.deviceName}",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (mode == RelayShareRowMode.Outgoing) {
                Text(
                    text = shareAccessSummary(share),
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                GraphBadge(
                    label = if (share.threadAccess == "read") "View only" else "Collaborator",
                    variant = if (share.threadAccess == "read") GraphBadgeVariant.Secondary else GraphBadgeVariant.Outline,
                )
                GraphBadge(
                    label = workspaceAccessLabel(share.workspaceAccess),
                    variant = GraphBadgeVariant.Secondary,
                )
            }
            if (mode == RelayShareRowMode.Outgoing) {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    GraphButton(
                        label = "Open",
                        enabled = !busy,
                        variant = GraphButtonVariant.Default,
                        size = GraphButtonSize.Small,
                        icon = GraphActionIcon.Open,
                        contentDescription = "Open shared thread $shareTitle",
                        onClick = onOpen,
                    )
                    GraphButton(
                        label = "Permissions",
                        enabled = !busy,
                        variant = GraphButtonVariant.Outline,
                        size = GraphButtonSize.Small,
                        contentDescription = "Edit permissions for $shareTitle",
                        onClick = onEdit,
                    )
                    GraphButton(
                        label = "Access",
                        enabled = !busy,
                        variant = GraphButtonVariant.Outline,
                        size = GraphButtonSize.Small,
                        contentDescription = "Show access history for $shareTitle",
                        onClick = onToggleAccess,
                    )
                    GraphButton(
                        label = "Revoke",
                        enabled = !busy,
                        variant = GraphButtonVariant.Destructive,
                        size = GraphButtonSize.Small,
                        contentDescription = "Revoke shared thread $shareTitle",
                        onClick = onRevoke,
                    )
                }
            }
            if (mode == RelayShareRowMode.Outgoing && expanded) {
                ShareAccessHistory(events = share.accessEvents)
            }
        }
    }
}

private enum class RelayShareRowMode {
    Incoming,
    Outgoing,
}

private fun shareTitle(share: RelaySessionShareSummary): String {
    val threadTitle = share.threadTitle?.trim()?.takeIf { it.isNotBlank() }
    val label = share.label?.trim()?.takeIf { it.isNotBlank() }
    return threadTitle?.takeUnless { label != null && it == label }
        ?: "Thread unavailable"
}

@Composable
private fun RelaySharedGrantRow(
    grant: RelayAccessGrantSummary,
    busy: Boolean,
    mode: RelayShareRowMode,
    onOpen: () -> Unit,
) {
    val title = grantTitle(grant)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = title,
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                GraphButton(
                    label = "Open",
                    enabled = !busy,
                    variant = GraphButtonVariant.Default,
                    size = GraphButtonSize.Small,
                    icon = GraphActionIcon.Open,
                    contentDescription = "Open shared access $title",
                    onClick = onOpen,
                )
            }
            Text(
                text = if (mode == RelayShareRowMode.Incoming) "From ${grant.ownerUsername}" else "To ${grant.targetUsername}",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "Device: ${grant.deviceName}",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            grant.workspaceLabel?.takeIf { it.isNotBlank() }?.let { workspace ->
                Text(
                    text = "Workspace: $workspace",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                GraphBadge(
                    label = grantScopeLabel(grant.scope),
                    variant = GraphBadgeVariant.Outline,
                )
                GraphBadge(
                    label = if (grant.threadAccess == "read") "View only" else "Collaborator",
                    variant = if (grant.threadAccess == "read") GraphBadgeVariant.Secondary else GraphBadgeVariant.Outline,
                )
                GraphBadge(
                    label = workspaceAccessLabel(grant.workspaceAccess),
                    variant = GraphBadgeVariant.Secondary,
                )
            }
        }
    }
}

private fun grantTitle(grant: RelayAccessGrantSummary): String {
    val label = grant.label?.trim()?.takeIf { it.isNotBlank() }
    return label
        ?: grant.threadTitle?.trim()?.takeIf { it.isNotBlank() }
        ?: grant.workspaceLabel?.trim()?.takeIf { it.isNotBlank() }
        ?: grant.deviceName.trim().takeIf { it.isNotBlank() }
        ?: "Shared device"
}

private fun grantScopeLabel(scope: String): String {
    return when (scope) {
        "device" -> "Device"
        "workspace" -> "Workspace"
        else -> "Thread"
    }
}

private fun RelayAccessGrantSummary.toThreadShareSummary(targetUsername: String): RelaySessionShareSummary {
    return RelaySessionShareSummary(
        id = id,
        ownerUserId = ownerUserId,
        ownerUsername = ownerUsername,
        targetUsername = this.targetUsername.ifBlank { targetUsername },
        targetUserId = targetUserId,
        deviceId = deviceId,
        deviceName = deviceName,
        threadId = threadId.orEmpty(),
        threadTitle = threadTitle,
        workspaceId = workspaceId,
        workspaceLabel = workspaceLabel,
        label = label,
        threadAccess = threadAccess,
        workspaceAccess = workspaceAccess,
        createdAt = createdAt,
        revokedAt = revokedAt,
        expiresAt = expiresAt,
        lastAccessedAt = lastAccessedAt,
        lastAccessedByUsername = lastAccessedByUsername,
        accessEvents = accessEvents,
    )
}

@Composable
private fun ShareAccessHistory(events: List<RelaySessionShareAccessSummary>) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(10.dp))
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (events.isEmpty()) {
            Text(
                text = "This shared thread has not been accessed yet.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        } else {
            events.forEach { event ->
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = accessEventKindLabel(event.kind),
                            color = ThreadColors.Foreground,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold,
                        )
                        Text(
                            text = event.username,
                            color = ThreadColors.ForegroundMuted,
                            style = MaterialTheme.typography.labelSmall,
                        )
                    }
                    Text(
                        text = shortRelayTimestamp(event.accessedAt),
                        color = ThreadColors.ForegroundMuted,
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}

private fun accessEventKindLabel(kind: String?): String {
    return when (kind) {
        "open_device" -> "Opened device"
        "open_thread" -> "Opened thread"
        "create_thread" -> "Created thread"
        "send_prompt" -> "Sent prompt"
        "read_workspace_file" -> "Read workspace"
        "write_workspace_file" -> "Wrote workspace"
        else -> "Access"
    }
}

@Composable
private fun RevokeRelayDeviceDialog(
    device: RelayDeviceSummary,
    busy: Boolean,
    onClose: () -> Unit,
    onConfirm: () -> Unit,
) {
    GraphDialogOverlay(onDismiss = onClose) {
        GraphDialogFrame(
            title = "Revoke device",
            subtitle = "Remove this backend device from the relay account.",
            onClose = onClose,
            footer = {
                GraphDialogFooter(
                    primaryLabel = if (busy) "Revoking..." else "Revoke",
                    primaryTone = GraphDialogActionTone.Danger,
                    primaryEnabled = !busy,
                    onCancel = onClose,
                    onPrimary = onConfirm,
                )
            },
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = device.name,
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = "The relay token for this backend stops working, existing shares for the device are removed, and Android will select another available backend if one exists.",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                )
                Text(
                    text = deviceStatusLine(device),
                    color = ThreadColors.ForegroundSoft,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}

@Composable
private fun RelaySharePermissionsDialog(
    share: RelaySessionShareSummary,
    busy: Boolean,
    onClose: () -> Unit,
    onSave: (String?, String, String) -> Unit,
) {
    var label by remember(share.id) { mutableStateOf(share.label.orEmpty()) }
    var threadAccess by remember(share.id) { mutableStateOf(share.threadAccess) }
    var workspaceAccess by remember(share.id) { mutableStateOf(share.workspaceAccess) }
    val workspaceLocked = share.workspaceId == null
    GraphDialogOverlay(onDismiss = onClose) {
        GraphDialogFrame(
            title = "Shared thread permissions",
            subtitle = "Manage ${share.targetUsername}'s access to this thread.",
            onClose = onClose,
            footer = {
                GraphDialogFooter(
                    primaryLabel = if (busy) "Saving..." else "Save",
                    primaryTone = GraphDialogActionTone.Success,
                    primaryEnabled = !busy,
                    onCancel = onClose,
                    onPrimary = {
                        onSave(
                            label.trim().takeIf { it.isNotBlank() },
                            threadAccess,
                            if (workspaceLocked) "none" else workspaceAccess,
                        )
                    },
                )
            },
        ) {
            ConnectionTextField(
                label = "Label",
                value = label,
                onValueChange = { label = it },
                contentDescription = "Shared thread label",
                placeholder = "Optional shared thread label",
            )
            ConnectionSettingText(label = "Thread", value = shareTitle(share))
            ConnectionSettingText(label = "Device", value = share.deviceName)
            Text(
                text = "Thread access",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
            RelayShareOptionRow(
                title = "View only",
                detail = "Can read the transcript but cannot send prompts.",
                selected = threadAccess == "read",
                onClick = { threadAccess = "read" },
            )
            RelayShareOptionRow(
                title = "Collaborator",
                detail = "Can send prompts and continue the shared thread.",
                selected = threadAccess == "control",
                onClick = { threadAccess = "control" },
            )
            Text(
                text = "Workspace access",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.SemiBold,
            )
            RelayShareOptionRow(
                title = "No workspace",
                detail = "Workspace panel is not available.",
                selected = workspaceLocked || workspaceAccess == "none",
                enabled = !workspaceLocked,
                onClick = { workspaceAccess = "none" },
            )
            RelayShareOptionRow(
                title = "Workspace read",
                detail = "Can browse and download workspace files.",
                selected = workspaceAccess == "read" && !workspaceLocked,
                enabled = !workspaceLocked,
                onClick = { workspaceAccess = "read" },
            )
            RelayShareOptionRow(
                title = "Workspace write",
                detail = "Can edit files and use writable workspace actions.",
                selected = workspaceAccess == "write" && !workspaceLocked,
                enabled = !workspaceLocked,
                onClick = { workspaceAccess = "write" },
            )
            if (workspaceLocked) {
                Text(
                    text = "This share was created without a workspace scope.",
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                )
            }
        }
    }
}

@Composable
private fun RelayShareOptionRow(
    title: String,
    detail: String,
    selected: Boolean,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) ThreadColors.InfoSoft else ThreadColors.SurfaceStrong)
            .border(1.dp, if (selected) ThreadColors.Info.copy(alpha = 0.42f) else ThreadColors.Border, RoundedCornerShape(10.dp))
            .clickable(enabled = enabled, onClick = onClick)
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        GraphSelectionGlyph(selected = selected)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = title,
                color = if (enabled) ThreadColors.Foreground else ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = detail,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun RevokeRelayShareDialog(
    share: RelaySessionShareSummary,
    busy: Boolean,
    onClose: () -> Unit,
    onConfirm: () -> Unit,
) {
    val title = shareTitle(share)
    GraphDialogOverlay(onDismiss = onClose) {
        GraphDialogFrame(
            title = "Revoke shared thread",
            subtitle = "Remove ${share.targetUsername}'s access to this thread.",
            onClose = onClose,
            footer = {
                GraphDialogFooter(
                    primaryLabel = if (busy) "Revoking..." else "Revoke",
                    primaryTone = GraphDialogActionTone.Danger,
                    primaryEnabled = !busy,
                    onCancel = onClose,
                    onPrimary = onConfirm,
                )
            },
        ) {
            Text(
                text = title,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            ConnectionSettingText(label = "Thread", value = shareTitle(share))
            ConnectionSettingText(label = "Device", value = share.deviceName)
            Text(
                text = "The recipient will lose transcript and workspace access granted by this share.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
            )
        }
    }
}

@Composable
private fun RelayDeviceTokenNotice(result: RelayCreateDeviceResult, relayBaseUrl: String) {
    val clipboard = LocalClipboardManager.current
    val command = relaySupervisorCommand(relayBaseUrl, result.token)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.WarningSoft)
            .border(1.dp, ThreadColors.Warning, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "One-time token for ${result.device.name}",
            color = ThreadColors.Warning,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = result.token,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .semantics { contentDescription = "Copy relay supervisor command from token" }
                .clickable { clipboard.setText(AnnotatedString(command)) }
                .padding(6.dp),
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
        )
        Text(
            text = command,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(8.dp))
                .background(ThreadColors.CodeBackground)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(8.dp))
                .padding(8.dp),
            color = ThreadColors.CodeForeground,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GraphButton(
                label = "Copy command",
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Small,
                contentDescription = "Copy relay supervisor command",
                onClick = { clipboard.setText(AnnotatedString(command)) },
            )
        }
    }
}

@Composable
private fun ConnectionPanel(
    title: String,
    detail: String,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(16.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = title,
                modifier = Modifier.weight(1f),
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
        }
        Text(
            text = detail,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
        )
        content()
    }
}

@Composable
private fun UnderlinedConnectionAction(
    label: String,
    contentDescription: String,
    onClick: () -> Unit,
) {
    Text(
        text = label,
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .semantics { this.contentDescription = contentDescription }
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 8.dp),
        color = ThreadColors.Primary,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
        textDecoration = TextDecoration.Underline,
        maxLines = 1,
    )
}

@Composable
private fun ConnectionModeRow(
    mode: SupervisorConnectionMode,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) ThreadColors.WarningSoft else ThreadColors.SurfaceStrong)
            .border(1.dp, if (selected) ThreadColors.Warning else ThreadColors.Border, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .semantics { contentDescription = "Connection mode ${mode.label}" }
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        GraphSelectionGlyph(selected = selected)
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                text = mode.label,
                color = if (selected) ThreadColors.Warning else ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = mode.detail,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ConnectionSettingText(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Text(
            text = label,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = value,
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ConnectionTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    contentDescription: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
    minLines: Int = 1,
    placeholder: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = Modifier
            .fillMaxWidth()
            .semantics { this.contentDescription = contentDescription },
        label = { Text(label) },
        minLines = minLines,
        maxLines = if (minLines > 1) 4 else 1,
        singleLine = minLines <= 1,
        placeholder = placeholder?.let { text -> { Text(text) } },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        textStyle = MaterialTheme.typography.bodySmall.copy(color = ThreadColors.Foreground),
        colors = OutlinedTextFieldDefaults.colors(
            focusedTextColor = ThreadColors.Foreground,
            unfocusedTextColor = ThreadColors.Foreground,
            focusedContainerColor = ThreadColors.SurfaceStrong,
            unfocusedContainerColor = ThreadColors.SurfaceStrong,
            cursorColor = ThreadColors.Primary,
            focusedBorderColor = ThreadColors.Primary.copy(alpha = 0.58f),
            unfocusedBorderColor = ThreadColors.Border,
            focusedLabelColor = ThreadColors.ForegroundSoft,
            unfocusedLabelColor = ThreadColors.ForegroundMuted,
        ),
    )
}

private fun initialUrlForMode(mode: SupervisorConnectionMode): String {
    return if (mode == SupervisorConnectionMode.Relay) "" else defaultUrlForMode(mode)
}

@Composable
private fun ConnectionStatus(message: String, error: Boolean) {
    Text(
        text = message,
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (error) ThreadColors.DangerSoft else ThreadColors.SuccessSoft)
            .border(1.dp, if (error) ThreadColors.Danger else ThreadColors.Success, RoundedCornerShape(12.dp))
            .padding(10.dp),
        color = if (error) ThreadColors.Danger else ThreadColors.Success,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.SemiBold,
    )
}

private fun deviceStatusLine(device: RelayDeviceSummary): String {
    val lastSeen = shortRelayTimestamp(device.lastHeartbeatAt ?: device.connectedAt)
    return if (device.connected) {
        "Last heartbeat: $lastSeen"
    } else {
        "Last online: $lastSeen"
    }
}

private fun relayPortalHasSelectableDevice(portal: RelayPortalSummary, deviceId: String): Boolean {
    if (deviceId.isBlank()) {
        return false
    }
    return portal.devices.any { it.id == deviceId } ||
        portal.sharedDevicesWithMe.any { it.deviceId == deviceId }
}

private fun relayPortalHasAnySelectableDevice(portal: RelayPortalSummary): Boolean {
    return portal.devices.isNotEmpty() || portal.sharedDevicesWithMe.isNotEmpty()
}

private fun relayPortalStatusMessage(portal: RelayPortalSummary, selectedDeviceId: String): String {
    val ownedDevices = portal.devices
    val sharedDevices = portal.sharedDevicesWithMe
    val selectableCount = ownedDevices.size + sharedDevices.size
    val onlineCount = ownedDevices.count { it.connected }
    val selected = ownedDevices.firstOrNull { it.id == selectedDeviceId }
    val selectedShared = sharedDevices.firstOrNull { it.deviceId == selectedDeviceId }
    val selectedStatus = when {
        selected == null -> "Choose any online backend to connect."
        selected.connected -> "Last connected backend is online."
        else -> "Last connected backend is offline."
    }
    val selectedMessage = if (selectedShared != null && selected == null) {
        "Last selected backend is shared by ${selectedShared.ownerUsername}."
    } else {
        selectedStatus
    }
    return "Loaded $selectableCount device${if (selectableCount == 1) "" else "s"}; $onlineCount owned online. $selectedMessage"
}

private fun workspaceAccessLabel(access: String): String {
    return when (access) {
        "write" -> "Workspace write"
        "read" -> "Workspace read"
        else -> "No workspace"
    }
}

private fun shareAccessSummary(share: RelaySessionShareSummary): String {
    val accessedAt = share.lastAccessedAt
    return if (accessedAt.isNullOrBlank()) {
        "Not accessed yet"
    } else {
        "Last access: ${share.lastAccessedByUsername ?: "unknown"} at ${shortRelayTimestamp(accessedAt)}"
    }
}

private fun shortRelayTimestamp(value: String?): String {
    if (value.isNullOrBlank()) {
        return "never"
    }
    return runCatching {
        DateTimeFormatter.ofPattern("MMM d, HH:mm")
            .format(Instant.parse(value).atZone(ZoneId.systemDefault()))
    }.getOrElse {
        value
            .replace("T", " ")
            .replace(Regex("\\.\\d{3}Z$"), " UTC")
            .replace(Regex("Z$"), " UTC")
            .take(17)
    }
}

private fun relaySupervisorCommand(relayBaseUrl: String, token: String): String {
    val relayWsUrl = normalizeRelayWebsocketUrl(relayBaseUrl)
    return listOf(
        "REMOTE_CODEX_RELAY_SERVER_URL=${shellQuote(relayWsUrl)} \\",
        "REMOTE_CODEX_RELAY_AGENT_TOKEN=${shellQuote(token)} \\",
        "REMOTE_CODEX_RELAY_SUPERVISOR_PORT=45679 \\",
        "remote-codex relay-supervisor",
    ).joinToString("\n")
}

private fun shellQuote(value: String): String {
    if (value.matches(Regex("^[A-Za-z0-9_./:=@%+-]+$"))) {
        return value
    }
    return "'${value.replace("'", "'\"'\"'")}'"
}

private fun normalizeRelayWebsocketUrl(relayBaseUrl: String): String {
    val normalized = relayBaseUrl.trim().trimEnd('/')
    return when {
        normalized.startsWith("https://") -> normalized.replaceFirst("https://", "wss://")
        normalized.startsWith("http://") -> normalized.replaceFirst("http://", "ws://")
        normalized.startsWith("wss://") || normalized.startsWith("ws://") -> normalized
        else -> "wss://$normalized"
    }
}

private fun defaultUrlForMode(mode: SupervisorConnectionMode): String {
    return when (mode) {
        SupervisorConnectionMode.Local -> "http://10.0.2.2:8787"
        SupervisorConnectionMode.Server -> "http://10.0.2.2:8787"
        SupervisorConnectionMode.Relay -> "https://relay.example.com"
    }
}

private fun sanitizeEndpointInput(value: String): String {
    return value
        .lineSequence()
        .firstOrNull()
        .orEmpty()
        .trim()
}

private fun isValidHttpEndpoint(value: String): Boolean {
    val uri = runCatching { java.net.URI(value) }.getOrNull() ?: return false
    val scheme = uri.scheme?.lowercase() ?: return false
    if (scheme != "http" && scheme != "https") {
        return false
    }
    return !uri.host.isNullOrBlank()
}

private fun userFacingConnectionError(error: Throwable): String {
    return when (error) {
        is SupervisorClientError.Http -> error.message ?: "Supervisor returned HTTP ${error.statusCode}."
        is SupervisorClientError.InvalidUrl,
        is SupervisorClientError.Authentication,
        is SupervisorClientError.Network,
        is SupervisorClientError.Parse,
        -> error.message ?: "Connection failed."
        else -> error.message ?: "Connection failed."
    }
}
