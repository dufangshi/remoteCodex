package com.remotecodex.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.api.AuthLoginResult
import com.remotecodex.android.api.RelayLoginResult
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorClientError
import com.remotecodex.android.api.SupervisorConnectionCheck
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.api.parseSupervisorPairingPayload
import com.remotecodex.android.ui.components.GraphBadge
import com.remotecodex.android.ui.components.GraphBadgeVariant
import com.remotecodex.android.ui.components.GraphButton
import com.remotecodex.android.ui.components.GraphButtonSize
import com.remotecodex.android.ui.components.GraphButtonVariant
import com.remotecodex.android.ui.components.GraphSelectionGlyph
import com.remotecodex.android.ui.theme.ThreadColors
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SupervisorConnectionSetupScreen(
    initialConfig: SupervisorConnectionConfig?,
    onConnectionReady: (SupervisorConnectionConfig, SupervisorConnectionCheck) -> Unit,
    modifier: Modifier = Modifier,
) {
    var mode by remember(initialConfig) { mutableStateOf(initialConfig?.mode ?: SupervisorConnectionMode.Local) }
    var baseUrl by remember(initialConfig) { mutableStateOf(initialConfig?.normalizedBaseUrl ?: defaultUrlForMode(mode)) }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var relayDeviceId by remember(initialConfig) { mutableStateOf(initialConfig?.relayDeviceId.orEmpty()) }
    var authToken by remember(initialConfig) { mutableStateOf(initialConfig?.authToken.orEmpty()) }
    var pairingPayload by remember { mutableStateOf("") }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    fun buildBaseConfig(token: String? = authToken) = SupervisorConnectionConfig(
        mode = mode,
        baseUrl = baseUrl,
        authToken = token?.takeIf { it.isNotBlank() },
        relayDeviceId = relayDeviceId.takeIf { it.isNotBlank() },
    )

    fun importPairingPayload(rawPayload: String) {
        try {
            val parsed = parseSupervisorPairingPayload(rawPayload)
            val config = parsed.toConnectionConfig()
            mode = config.mode
            baseUrl = config.normalizedBaseUrl
            relayDeviceId = config.relayDeviceId.orEmpty()
            authToken = config.authToken.orEmpty()
            pairingPayload = rawPayload
            statusMessage = "Pairing payload imported."
            errorMessage = null
        } catch (error: SupervisorClientError) {
            errorMessage = error.message
            statusMessage = null
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
                text = "Choose how this Android client reaches the supervisor. You can change this later in Settings.",
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
            )

            ConnectionPanel(title = "Mode", detail = mode.detail) {
                SupervisorConnectionMode.entries.forEach { option ->
                    ConnectionModeRow(
                        mode = option,
                        selected = option == mode,
                        onClick = {
                            mode = option
                            if (baseUrl.isBlank() || baseUrl == defaultUrlForMode(SupervisorConnectionMode.Local)) {
                                baseUrl = defaultUrlForMode(option)
                            }
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
                )
                if (mode == SupervisorConnectionMode.Relay) {
                    ConnectionTextField(
                        label = "Relay device id",
                        value = relayDeviceId,
                        onValueChange = { relayDeviceId = it },
                        contentDescription = "Relay device id",
                    )
                }
            }

            if (mode != SupervisorConnectionMode.Local) {
                ConnectionPanel(
                    title = if (mode == SupervisorConnectionMode.Relay) "Relay login" else "Supervisor login",
                    detail = if (mode == SupervisorConnectionMode.Relay) "Use relay username or email." else "Use supervisor admin credentials.",
                ) {
                    ConnectionTextField(
                        label = if (mode == SupervisorConnectionMode.Relay) "Identifier" else "Username",
                        value = username,
                        onValueChange = { username = it },
                        contentDescription = "Login identifier",
                    )
                    ConnectionTextField(
                        label = "Password",
                        value = password,
                        onValueChange = { password = it },
                        contentDescription = "Login password",
                        password = true,
                    )
                }
            }

            ConnectionPanel(title = "Pairing", detail = "Paste a QR payload to prefill mode, URL, token, and relay device id.") {
                ConnectionTextField(
                    label = "Pairing payload",
                    value = pairingPayload,
                    onValueChange = { pairingPayload = it },
                    contentDescription = "Pairing payload",
                    minLines = 2,
                )
                GraphButton(
                    label = "Import payload",
                    enabled = pairingPayload.isNotBlank() && !busy,
                    variant = GraphButtonVariant.Secondary,
                    size = GraphButtonSize.Default,
                    contentDescription = "Import pairing payload",
                    onClick = {
                        importPairingPayload(pairingPayload)
                    },
                )
                GraphButton(
                    label = "Scan QR",
                    enabled = !busy,
                    variant = GraphButtonVariant.Outline,
                    size = GraphButtonSize.Default,
                    contentDescription = "Scan pairing QR code",
                    onClick = {
                        busy = true
                        errorMessage = null
                        statusMessage = "Opening QR scanner..."
                        GmsBarcodeScanning.getClient(context)
                            .startScan()
                            .addOnSuccessListener { barcode ->
                                busy = false
                                val rawValue = barcode.rawValue.orEmpty()
                                if (rawValue.isBlank()) {
                                    errorMessage = "QR code did not contain a pairing payload."
                                    statusMessage = null
                                } else {
                                    importPairingPayload(rawValue)
                                }
                            }
                            .addOnCanceledListener {
                                busy = false
                                statusMessage = null
                            }
                            .addOnFailureListener { error ->
                                busy = false
                                statusMessage = null
                                errorMessage = error.message ?: "QR scanner failed."
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

            GraphButton(
                label = if (busy) "Connecting..." else "Connect",
                enabled = !busy,
                variant = GraphButtonVariant.Default,
                size = GraphButtonSize.Large,
                contentDescription = "Connect supervisor",
                modifier = Modifier.fillMaxWidth(),
                onClick = {
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
                },
            )
        }
    }
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
            GraphBadge(label = "Setup", variant = GraphBadgeVariant.Outline)
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
private fun ConnectionTextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    contentDescription: String,
    keyboardType: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
    minLines: Int = 1,
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
