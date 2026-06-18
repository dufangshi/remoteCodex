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
import com.remotecodex.android.api.RelayCreateDeviceResult
import com.remotecodex.android.api.RelayDeviceSummary
import com.remotecodex.android.api.RelayPortalSummary
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorClientError
import com.remotecodex.android.api.SupervisorConnectionCheck
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
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
import com.remotecodex.android.ui.components.GraphSelectionGlyph
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SupervisorConnectionSetupScreen(
    initialConfig: SupervisorConnectionConfig?,
    initialRoute: ConnectionSetupRoute = ConnectionSetupRoute.ModeSelect,
    onConnectionReady: (SupervisorConnectionConfig, SupervisorConnectionCheck) -> Unit,
    onConnectionStateSaved: (SupervisorConnectionConfig) -> Unit = {},
    onBack: () -> Unit = {},
    onRelayDeviceSelectionCleared: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var mode by remember(initialConfig) { mutableStateOf(initialConfig?.mode ?: SupervisorConnectionMode.Local) }
    var baseUrl by remember(initialConfig) {
        mutableStateOf(initialConfig?.normalizedBaseUrl ?: initialUrlForMode(mode))
    }
    var route by remember(initialRoute, initialConfig) { mutableStateOf(initialRoute) }
    var authMode by remember { mutableStateOf(RelayAuthMode.SignIn) }
    var email by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var relayDeviceId by remember(initialConfig) { mutableStateOf(initialConfig?.relayDeviceId.orEmpty()) }
    var authToken by remember(initialConfig) { mutableStateOf(initialConfig?.authToken.orEmpty()) }
    var relayPortal by remember { mutableStateOf<RelayPortalSummary?>(null) }
    var createdDevice by remember { mutableStateOf<RelayCreateDeviceResult?>(null) }
    var newDeviceName by remember { mutableStateOf("Android workstation") }
    var revokeDeviceTarget by remember { mutableStateOf<RelayDeviceSummary?>(null) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun buildBaseConfig(token: String? = authToken) = SupervisorConnectionConfig(
        mode = mode,
        baseUrl = baseUrl,
        authToken = token?.takeIf { it.isNotBlank() },
        relayDeviceId = relayDeviceId.takeIf { it.isNotBlank() },
    )

    fun loadRelayPortal(token: String = authToken) {
        if (token.isBlank()) {
            errorMessage = "Log in to the relay before loading devices."
            statusMessage = null
            return
        }
        busy = true
        errorMessage = null
        statusMessage = null
        scope.launch {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    SupervisorApiClient(buildBaseConfig(token)).fetchRelayPortal()
                }
            }
            busy = false
            result
                .onSuccess { portal ->
                    relayPortal = portal
                    statusMessage = if (portal.devices.isEmpty()) {
                        "Relay login succeeded. Register a device to connect a backend."
                    } else {
                        relayPortalStatusMessage(portal.devices, relayDeviceId)
                    }
                }
                .onFailure { error ->
                    errorMessage = userFacingConnectionError(error)
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
                    onConnectionReady(config, check)
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
                    relayDeviceId = relayDeviceId.takeIf { current -> portal.devices.any { it.id == current } }.orEmpty()
                    onConnectionStateSaved(
                        SupervisorConnectionConfig(
                            mode = SupervisorConnectionMode.Relay,
                            baseUrl = baseUrl,
                            authToken = token,
                            relayDeviceId = relayDeviceId.takeIf { it.isNotBlank() },
                        ),
                    )
                    route = ConnectionSetupRoute.RelayDevices
                    statusMessage = if (portal.devices.isEmpty()) {
                        "Relay account ready. Register a backend device."
                    } else {
                        relayPortalStatusMessage(portal.devices, relayDeviceId)
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

    androidx.compose.runtime.LaunchedEffect(route, authToken) {
        if (route == ConnectionSetupRoute.RelayDevices && authToken.isNotBlank() && relayPortal == null && !busy) {
            loadRelayPortal(authToken)
        }
    }

    androidx.compose.runtime.LaunchedEffect(route, authToken) {
        if (route != ConnectionSetupRoute.RelayDevices || authToken.isBlank()) {
            return@LaunchedEffect
        }
        while (true) {
            delay(5_000)
            if (!busy) {
                loadRelayPortal(authToken)
            }
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
                .align(Alignment.Center)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                text = "Connect Remote Codex",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = when (route) {
                    ConnectionSetupRoute.ModeSelect -> "Choose how this Android client reaches the supervisor."
                    ConnectionSetupRoute.ServerAuth -> "Sign in to a direct supervisor server."
                    ConnectionSetupRoute.RelayAuth -> "Sign in or create a relay account."
                    ConnectionSetupRoute.RelayDevices -> "Select, create, or revoke relay backend devices."
                },
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
            )

            when (route) {
                ConnectionSetupRoute.ModeSelect -> {
                    ConnectionPanel(title = "Mode", detail = mode.detail) {
                        SupervisorConnectionMode.entries.forEach { option ->
                            ConnectionModeRow(
                                mode = option,
                                selected = option == mode,
                                onClick = {
                                    mode = option
                                    baseUrl = initialUrlForMode(option)
                                    relayPortal = null
                                    createdDevice = null
                                    errorMessage = null
                                    statusMessage = null
                                },
                            )
                        }
                    }
                    ConnectionPanel(title = "Endpoint", detail = "Use http(s) for direct modes and relay server URL for relay mode.") {
                        ConnectionTextField(
                            label = "URL",
                            value = baseUrl,
                            onValueChange = { baseUrl = it },
                            contentDescription = "Supervisor URL",
                            keyboardType = KeyboardType.Uri,
                            placeholder = if (mode == SupervisorConnectionMode.Relay) null else defaultUrlForMode(mode),
                        )
                    }
                    GraphButton(
                        label = "Next",
                        enabled = !busy,
                        variant = GraphButtonVariant.Default,
                        size = GraphButtonSize.Large,
                        contentDescription = "Continue connection setup",
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            route = when (mode) {
                                SupervisorConnectionMode.Local -> {
                                    connectCurrent()
                                    ConnectionSetupRoute.ModeSelect
                                }
                                SupervisorConnectionMode.Server -> ConnectionSetupRoute.ServerAuth
                                SupervisorConnectionMode.Relay -> {
                                    validateRelayEndpointThenContinue()
                                    ConnectionSetupRoute.ModeSelect
                                }
                            }
                        },
                    )
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
                        if (authMode == RelayAuthMode.Register) {
                            ConnectionTextField(
                                label = "Email",
                                value = email,
                                onValueChange = { email = it },
                                contentDescription = "Relay registration email",
                                keyboardType = KeyboardType.Email,
                            )
                        }
                        ConnectionTextField(
                            label = if (authMode == RelayAuthMode.Register) "Username" else "Identifier",
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
                                label = if (busy) "Working..." else if (authMode == RelayAuthMode.Register) "Create account" else "Sign in",
                                enabled = !busy,
                                variant = GraphButtonVariant.Default,
                                size = GraphButtonSize.Default,
                                contentDescription = "Authenticate relay account",
                                onClick = { relayLoginOrRegister(authMode == RelayAuthMode.Register) },
                            )
                            Spacer(modifier = Modifier.weight(1f))
                            UnderlinedConnectionAction(
                                label = if (authMode == RelayAuthMode.Register) "Sign in" else "Register",
                                contentDescription = if (authMode == RelayAuthMode.Register) {
                                    "Use relay sign in"
                                } else {
                                    "Use relay registration"
                                },
                                onClick = {
                                    authMode = if (authMode == RelayAuthMode.Register) {
                                        RelayAuthMode.SignIn
                                    } else {
                                        RelayAuthMode.Register
                                    }
                                },
                            )
                        }
                    }
                }
                ConnectionSetupRoute.RelayDevices -> {
                    RelayDevicesPanel(
                        devices = relayPortal?.devices.orEmpty(),
                        selectedDeviceId = relayDeviceId,
                        createdDevice = createdDevice,
                        relayBaseUrl = baseUrl,
                        newDeviceName = newDeviceName,
                        busy = busy,
                        onSelectDevice = { relayDeviceId = it },
                        onNewDeviceNameChange = { newDeviceName = it },
                        onRefresh = { loadRelayPortal() },
                        onRevokeDevice = { revokeDeviceTarget = it },
                        onCreateDevice = {
                            val token = authToken
                            if (token.isBlank()) {
                                errorMessage = "Log in to the relay before creating a device."
                                statusMessage = null
                                route = ConnectionSetupRoute.RelayAuth
                                return@RelayDevicesPanel
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
                                        createdDevice = created
                                        relayPortal = portal
                                        relayDeviceId = created.device.id
                                        statusMessage = "Device registered. Use the one-time token on the backend."
                                    }
                                    .onFailure { error ->
                                        errorMessage = userFacingConnectionError(error)
                                    }
                            }
                        },
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
                        GraphButton(
                            label = if (busy) "Connecting..." else "Connect",
                            enabled = !busy && relayDeviceId.isNotBlank(),
                            variant = GraphButtonVariant.Default,
                            size = GraphButtonSize.Default,
                            contentDescription = "Connect selected relay device",
                            onClick = { connectCurrent() },
                        )
                    }
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
                                    relayDeviceId = relayDeviceId.takeIf { it != revokedId && portal.devices.any { device -> device.id == it } }.orEmpty()
                                    if (revokedSelectedDevice) {
                                        onRelayDeviceSelectionCleared()
                                    }
                                    if (createdDevice?.device?.id == revokedId) {
                                        createdDevice = null
                                    }
                                    statusMessage = if (portal.devices.isEmpty()) {
                                        "Device revoked. Register another backend device to connect."
                                    } else {
                                        "Device revoked. ${relayPortalStatusMessage(portal.devices, relayDeviceId)}"
                                    }
                                }
                                .onFailure { error ->
                                    errorMessage = userFacingConnectionError(error)
                                }
                        }
                    },
                )
            }

            statusMessage?.let { message ->
                ConnectionStatus(message = message, error = false)
            }
            errorMessage?.let { message ->
                ConnectionStatus(message = message, error = true)
            }
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
                        label = "Change mode",
                        variant = GraphButtonVariant.Outline,
                        size = GraphButtonSize.Small,
                        contentDescription = "Change connection mode",
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

private enum class RelayAuthMode {
    SignIn,
    Register,
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
private fun RelayDevicesPanel(
    devices: List<RelayDeviceSummary>,
    selectedDeviceId: String,
    createdDevice: RelayCreateDeviceResult?,
    relayBaseUrl: String,
    newDeviceName: String,
    busy: Boolean,
    onSelectDevice: (String) -> Unit,
    onNewDeviceNameChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onRevokeDevice: (RelayDeviceSummary) -> Unit,
    onCreateDevice: () -> Unit,
) {
    ConnectionPanel(
        title = "Device management",
        detail = "Create a backend device, copy the one-time token to the private machine, then select the connected device.",
    ) {
        if (devices.isEmpty()) {
            Text(
                text = "No devices loaded for this relay account.",
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodySmall,
            )
        } else {
            devices.forEach { device ->
                RelayDeviceRow(
                    device = device,
                    selected = device.id == selectedDeviceId,
                    onClick = { onSelectDevice(device.id) },
                    onRevoke = { onRevokeDevice(device) },
                    busy = busy,
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GraphButton(
                label = "Refresh",
                enabled = !busy,
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Small,
                contentDescription = "Refresh relay devices",
                onClick = onRefresh,
            )
        }

        ConnectionTextField(
            label = "New device name",
            value = newDeviceName,
            onValueChange = onNewDeviceNameChange,
            contentDescription = "New relay device name",
        )
        GraphButton(
            label = if (busy) "Creating..." else "Create device",
            enabled = !busy && newDeviceName.isNotBlank(),
            variant = GraphButtonVariant.Secondary,
            size = GraphButtonSize.Default,
            contentDescription = "Create relay device",
            onClick = onCreateDevice,
        )

        createdDevice?.let { result ->
            RelayDeviceTokenNotice(result = result, relayBaseUrl = relayBaseUrl)
        }
    }
}

@Composable
private fun RelayDeviceRow(
    device: RelayDeviceSummary,
    selected: Boolean,
    busy: Boolean,
    onClick: () -> Unit,
    onRevoke: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (selected) ThreadColors.SuccessSoft else ThreadColors.SurfaceStrong)
            .border(1.dp, if (selected) ThreadColors.Success else ThreadColors.Border, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .semantics { contentDescription = "Select relay device ${device.name}" }
            .padding(10.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(9.dp),
    ) {
        GraphSelectionGlyph(selected = selected)
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
                GraphBadge(
                    label = if (selected) "Selected" else "Backend",
                    variant = if (selected) GraphBadgeVariant.Outline else GraphBadgeVariant.Secondary,
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
                text = device.tokenPreview.ifBlank { device.id },
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                fontFamily = FontFamily.Monospace,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
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
    val lastSeen = device.lastHeartbeatAt ?: device.connectedAt ?: "never"
    return if (device.connected) {
        "Connected. Last heartbeat: $lastSeen"
    } else {
        "Last online: $lastSeen"
    }
}

private fun relayPortalStatusMessage(devices: List<RelayDeviceSummary>, selectedDeviceId: String): String {
    val onlineCount = devices.count { it.connected }
    val selected = devices.firstOrNull { it.id == selectedDeviceId }
    val selectedStatus = when {
        selected == null -> "Select a backend device."
        selected.connected -> "Selected backend is online."
        else -> "Selected backend is offline."
    }
    return "Loaded ${devices.size} device${if (devices.size == 1) "" else "s"}; $onlineCount online. $selectedStatus"
}

private fun relaySupervisorCommand(relayBaseUrl: String, token: String): String {
    val relayWsUrl = normalizeRelayWebsocketUrl(relayBaseUrl)
    return "REMOTE_CODEX_RELAY_SERVER_URL=$relayWsUrl REMOTE_CODEX_RELAY_AGENT_TOKEN=$token remote-codex relay-supervisor"
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
        SupervisorConnectionMode.Server -> "https://remote-codex.example.com"
        SupervisorConnectionMode.Relay -> "https://relay.example.com"
    }
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
