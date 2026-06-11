package com.remotecodex.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.SupervisorPluginSummary
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.model.AppShellNavigationItemPreview
import com.remotecodex.android.ui.model.AppShellPreview
import com.remotecodex.android.ui.model.PluginPreview
import com.remotecodex.android.ui.model.RendererPreview
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.launch

@Composable
fun AppShellNavigationPanel(
    appShell: AppShellPreview,
    onOpenSettings: () -> Unit,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxHeight()
            .widthIn(max = 360.dp)
            .background(ThreadColors.Panel)
            .border(1.dp, ThreadColors.Border)
            .padding(horizontal = 12.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                text = appShell.productName.take(1),
                modifier = Modifier
                    .clip(CircleShape)
                    .background(ThreadColors.Primary)
                    .padding(horizontal = 13.dp, vertical = 9.dp),
                color = ThreadColors.PrimaryForeground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = appShell.productName,
                    color = ThreadColors.Foreground,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    text = appShell.connectionLabel,
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            GraphIconButton(
                icon = GraphActionIcon.Cancel,
                contentDescription = "Close navigation",
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Default,
                onClick = onClose,
            )
        }

        ConnectionSummary(appShell = appShell)

        LazyColumn(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(appShell.navigationItems, key = { it.label }) { item ->
                NavigationItemRow(item = item)
            }
        }

        Text(
            text = "Settings",
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(11.dp))
                .background(ThreadColors.SurfaceStrong)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(11.dp))
                .clickable(onClick = onOpenSettings)
                .padding(horizontal = 14.dp, vertical = 12.dp),
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
    }
}

@Composable
fun AppShellSettingsPanel(
    appShell: AppShellPreview,
    themeMode: ThemeMode,
    darkThemeActive: Boolean,
    supervisorConnection: SupervisorConnectionConfig,
    homeSnapshot: SupervisorHomeSnapshot?,
    homeSnapshotLoading: Boolean,
    homeSnapshotError: String?,
    onThemeModeSelected: (ThemeMode) -> Unit,
    onChangeConnection: () -> Unit,
    onImportPluginManifest: (suspend (String) -> SupervisorPluginSummary)? = null,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ThreadColors.Primary.copy(alpha = 0.70f))
            .padding(14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            modifier = Modifier
                .matchParentSize()
                .clickable(onClick = onClose),
        )
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = 720.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(ThreadColors.Panel)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(24.dp)),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(ThreadColors.Surface.copy(alpha = 0.58f))
                    .padding(14.dp),
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Settings",
                        color = ThreadColors.ForegroundMuted,
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Text(
                        text = "App shell",
                        color = ThreadColors.Foreground,
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        text = "${appShell.supervisorLabel} / ${appShell.connectionLabel}",
                        color = ThreadColors.ForegroundSoft,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                GraphIconButton(
                    icon = GraphActionIcon.Cancel,
                    contentDescription = "Close settings",
                    variant = GraphButtonVariant.Outline,
                    size = GraphButtonSize.Default,
                    onClick = onClose,
                )
            }

            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                SettingsSection(title = "Appearance", detail = "Active: ${if (darkThemeActive) "dark" else "light"}") {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ThemeMode.entries.forEach { mode ->
                            ThemeChoice(
                                mode = mode,
                                selected = themeMode == mode,
                                onClick = { onThemeModeSelected(mode) },
                                modifier = Modifier.weight(1f),
                            )
                        }
                    }
                }

                SettingsSection(title = "Backend", detail = "Default runtime target") {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(ThreadColors.SurfaceStrong)
                            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            text = appShell.defaultBackend,
                            modifier = Modifier
                                .clip(RoundedCornerShape(999.dp))
                                .background(ThreadColors.Primary)
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                            color = ThreadColors.PrimaryForeground,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.SemiBold,
                            maxLines = 1,
                        )
                        Text(
                            text = "Used as the default backend for new native thread sessions in this preview.",
                            color = ThreadColors.ForegroundSoft,
                            style = MaterialTheme.typography.bodySmall,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }

                SettingsSection(title = "Connection", detail = supervisorConnection.mode.label) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(ThreadColors.SurfaceStrong)
                            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        ConnectionSettingLine(label = "URL", value = supervisorConnection.normalizedBaseUrl)
                        supervisorConnection.relayDeviceId?.let { deviceId ->
                            ConnectionSettingLine(label = "Device", value = deviceId)
                        }
                        ConnectionSettingLine(label = "WebSocket", value = supervisorConnection.websocketUrl())
                        BackendSnapshotSummary(
                            snapshot = homeSnapshot,
                            loading = homeSnapshotLoading,
                            error = homeSnapshotError,
                        )
                        GraphButton(
                            label = "Change connection",
                            variant = GraphButtonVariant.Secondary,
                            size = GraphButtonSize.Default,
                            contentDescription = "Change supervisor connection",
                            onClick = onChangeConnection,
                        )
                    }
                }

                SettingsSection(title = "Plugins", detail = "Thread UI capabilities") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        appShell.plugins.forEach { plugin ->
                            PluginSettingsRow(plugin = plugin)
                        }
                    }
                }

                SettingsSection(title = "Renderers", detail = "Native and fallback surfaces") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        appShell.renderers.forEach { renderer ->
                            RendererSettingsRow(renderer = renderer)
                        }
                    }
                }

                ImportPluginSettingsSection(onImportPluginManifest = onImportPluginManifest)
            }
        }
    }
}

@Composable
private fun ImportPluginSettingsSection(
    onImportPluginManifest: (suspend (String) -> SupervisorPluginSummary)?,
) {
    var draft by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutineScope = rememberCoroutineScope()
    SettingsSection(title = "Import plugin", detail = "Manifest registration") {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(ThreadColors.CodeBackground)
                .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OutlinedTextField(
                value = draft,
                onValueChange = {
                    draft = it
                    message = null
                    error = null
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("plugin-manifest-input")
                    .semantics { contentDescription = "Plugin manifest input" },
                label = { Text("Plugin manifest JSON") },
                placeholder = { Text("""{"id":"example-plugin", ...}""") },
                minLines = 3,
                maxLines = 5,
                textStyle = MaterialTheme.typography.bodySmall.copy(
                    color = ThreadColors.CodeForeground,
                    fontFamily = FontFamily.Monospace,
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = ThreadColors.CodeForeground,
                    unfocusedTextColor = ThreadColors.CodeForeground,
                    focusedContainerColor = ThreadColors.CodeBackground,
                    unfocusedContainerColor = ThreadColors.CodeBackground,
                    focusedBorderColor = ThreadColors.Primary.copy(alpha = 0.58f),
                    unfocusedBorderColor = ThreadColors.Border,
                    cursorColor = ThreadColors.Primary,
                    focusedLabelColor = ThreadColors.ForegroundSoft,
                    unfocusedLabelColor = ThreadColors.ForegroundMuted,
                    focusedPlaceholderColor = ThreadColors.ForegroundMuted,
                    unfocusedPlaceholderColor = ThreadColors.ForegroundMuted,
                ),
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    text = "Registers manifest-declared artifact types. Native renderer code still requires a trusted built-in module.",
                    modifier = Modifier.weight(1f),
                    color = ThreadColors.ForegroundMuted,
                    style = MaterialTheme.typography.labelSmall,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                GraphButton(
                    label = if (busy) "Importing..." else "Import",
                    enabled = draft.isNotBlank() && !busy,
                    variant = GraphButtonVariant.Secondary,
                    size = GraphButtonSize.Default,
                    contentDescription = "Import plugin",
                    onClick = {
                        val trimmed = draft.trim()
                        if (trimmed.isEmpty()) {
                            return@GraphButton
                        }
                        error = null
                        message = null
                        val looksValid = trimmed.startsWith("{") ||
                            trimmed.startsWith("[")
                        if (!looksValid) {
                            error = "Use a plugin.json payload."
                            return@GraphButton
                        }
                        val importAction = onImportPluginManifest
                        if (importAction == null) {
                            draft = ""
                            message = "Plugin manifest validated in preview mode."
                            return@GraphButton
                        }
                        busy = true
                        coroutineScope.launch {
                            runCatching { importAction(trimmed) }
                                .onSuccess { plugin ->
                                    draft = ""
                                    message = "Imported ${plugin.name.ifBlank { plugin.id }}."
                                }
                                .onFailure { throwable ->
                                    error = throwable.message ?: "Plugin import failed."
                                }
                            busy = false
                        }
                    },
                )
            }
            error?.let { text ->
                Text(
                    text = text,
                    color = ThreadColors.Danger,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                )
            }
            message?.let { text ->
                Text(
                    text = text,
                    color = ThreadColors.Success,
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.SemiBold,
                )
            }
        }
    }
}

@Composable
private fun BackendSnapshotSummary(
    snapshot: SupervisorHomeSnapshot?,
    loading: Boolean,
    error: String?,
) {
    val label = when {
        loading -> "Loading backend snapshot..."
        error != null -> "Backend snapshot failed"
        snapshot != null -> "${snapshot.workspaces.size} workspaces / ${snapshot.threads.size} threads / ${snapshot.activeThreadCount} running"
        else -> "Backend snapshot not loaded"
    }
    val detail = error ?: snapshot?.threads?.firstOrNull()?.title ?: "Workspace and thread lists are read from the supervisor API."
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(if (error == null) ThreadColors.Surface else ThreadColors.DangerSoft)
            .border(1.dp, if (error == null) ThreadColors.Border else ThreadColors.Danger, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            text = label,
            color = if (error == null) ThreadColors.Foreground else ThreadColors.Danger,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
        )
        Text(
            text = detail,
            color = if (error == null) ThreadColors.ForegroundMuted else ThreadColors.Danger,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ConnectionSettingLine(
    label: String,
    value: String,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = label,
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.widthIn(min = 76.dp),
        )
        Text(
            text = value,
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelSmall,
            fontFamily = FontFamily.Monospace,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun ConnectionSummary(appShell: AppShellPreview) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            text = appShell.supervisorLabel,
            color = ThreadColors.Foreground,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            text = "Default backend: ${appShell.defaultBackend}",
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun NavigationItemRow(item: AppShellNavigationItemPreview) {
    val background = if (item.active) ThreadColors.SurfaceStrong else ThreadColors.Surface
    val border = if (item.active) ThreadColors.BorderStrong else ThreadColors.Border
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .border(1.dp, border, RoundedCornerShape(12.dp))
            .padding(11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = item.label.take(1),
            modifier = Modifier
                .size(32.dp)
                .clip(CircleShape)
                .background(ThreadColors.Panel)
                .padding(horizontal = 11.dp, vertical = 7.dp),
            color = ThreadColors.ForegroundSoft,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = item.label,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = item.detail,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (item.active) {
            GraphBadge(
                label = "Active",
                variant = GraphBadgeVariant.Outline,
            )
        }
    }
}

@Composable
private fun SettingsSection(
    title: String,
    detail: String,
    content: @Composable () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(14.dp))
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
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = detail,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        content()
    }
}

@Composable
private fun ThemeChoice(
    mode: ThemeMode,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val background = if (selected) ThreadColors.WarningSoft else ThreadColors.SurfaceStrong
    val foreground = if (selected) ThreadColors.Warning else ThreadColors.ForegroundSoft
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(background)
            .border(1.dp, if (selected) ThreadColors.Warning else ThreadColors.Border, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 9.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            ThemeModeGlyph(
                mode = mode,
                color = foreground,
                modifier = Modifier.size(15.dp),
            )
            Text(
                text = mode.label,
                modifier = Modifier.weight(1f),
                color = foreground,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (selected) {
                GraphBadge(
                    label = "Active",
                    variant = GraphBadgeVariant.Outline,
                )
            }
        }
        Text(
            text = themeModeDetail(mode),
            color = ThreadColors.ForegroundMuted,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun ThemeModeGlyph(
    mode: ThemeMode,
    color: Color,
    modifier: Modifier = Modifier,
) {
    val cutoutColor = ThreadColors.SurfaceStrong

    Canvas(modifier = modifier) {
        val strokeWidth = 1.45.dp.toPx()
        val stroke = Stroke(width = strokeWidth, cap = StrokeCap.Round)
        val w = size.width
        val h = size.height
        fun line(x1: Float, y1: Float, x2: Float, y2: Float) {
            drawLine(
                color = color,
                start = Offset(w * x1, h * y1),
                end = Offset(w * x2, h * y2),
                strokeWidth = strokeWidth,
                cap = StrokeCap.Round,
            )
        }

        when (mode) {
            ThemeMode.System -> {
                line(0.18f, 0.28f, 0.82f, 0.28f)
                line(0.82f, 0.28f, 0.82f, 0.68f)
                line(0.82f, 0.68f, 0.18f, 0.68f)
                line(0.18f, 0.68f, 0.18f, 0.28f)
                line(0.38f, 0.82f, 0.62f, 0.82f)
                line(0.50f, 0.68f, 0.50f, 0.82f)
            }
            ThemeMode.Light -> {
                drawCircle(
                    color = color,
                    radius = w * 0.18f,
                    center = Offset(w * 0.50f, h * 0.50f),
                    style = stroke,
                )
                line(0.50f, 0.08f, 0.50f, 0.20f)
                line(0.50f, 0.80f, 0.50f, 0.92f)
                line(0.08f, 0.50f, 0.20f, 0.50f)
                line(0.80f, 0.50f, 0.92f, 0.50f)
                line(0.20f, 0.20f, 0.28f, 0.28f)
                line(0.72f, 0.72f, 0.80f, 0.80f)
                line(0.80f, 0.20f, 0.72f, 0.28f)
                line(0.28f, 0.72f, 0.20f, 0.80f)
            }
            ThemeMode.Dark -> {
                drawCircle(
                    color = color,
                    radius = w * 0.30f,
                    center = Offset(w * 0.48f, h * 0.46f),
                    style = stroke,
                )
                drawCircle(
                    color = cutoutColor,
                    radius = w * 0.26f,
                    center = Offset(w * 0.62f, h * 0.34f),
                )
            }
        }
    }
}

@Composable
private fun PluginSettingsRow(plugin: PluginPreview) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(11.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = plugin.name,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = plugin.description,
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = plugin.capabilities,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.labelSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            GraphBadge(
                label = plugin.source,
                modifier = Modifier.widthIn(max = 132.dp),
                variant = if (plugin.source.contains("Imported", ignoreCase = true)) {
                    GraphBadgeVariant.Secondary
                } else {
                    GraphBadgeVariant.Outline
                },
            )
            ToggleDot(enabled = plugin.enabled)
        }
    }
}

@Composable
private fun RendererSettingsRow(renderer: RendererPreview) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ThreadColors.SurfaceStrong)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(12.dp))
            .padding(11.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        GraphBadge(
            label = renderer.status,
            variant = GraphBadgeVariant.Outline,
        )
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                text = renderer.name,
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.SemiBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = renderer.description,
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodySmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun ToggleDot(enabled: Boolean) {
    GraphSelectionGlyph(
        selected = enabled,
        tone = GraphSelectionTone.Success,
        contentDescription = if (enabled) "Plugin enabled" else "Plugin disabled",
    )
}

private fun themeModeDetail(mode: ThemeMode): String {
    return when (mode) {
        ThemeMode.System -> "OS"
        ThemeMode.Light -> "Light"
        ThemeMode.Dark -> "Dark"
    }
}
