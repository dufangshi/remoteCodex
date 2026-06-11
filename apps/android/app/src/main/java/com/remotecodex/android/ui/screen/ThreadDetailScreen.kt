package com.remotecodex.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.remotecodex.android.api.RespondThreadRequest
import com.remotecodex.android.api.RespondThreadRequestAnswer
import com.remotecodex.android.api.SendThreadPromptRequest
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorEventSocketClient
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.UpdateThreadRequest
import com.remotecodex.android.api.UpdateThreadSettingsRequest
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.components.GraphButton
import com.remotecodex.android.ui.components.GraphButtonSize
import com.remotecodex.android.ui.components.GraphButtonVariant
import com.remotecodex.android.ui.model.PendingRequestPreview
import com.remotecodex.android.ui.model.ThreadDetailPreview
import com.remotecodex.android.ui.presentation.buildThreadDetailPreviewFromSupervisor
import com.remotecodex.android.ui.sample.ThreadPreviewSample
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

@Composable
fun ThreadDetailScreen(
    threadId: String,
    themeMode: ThemeMode,
    darkThemeActive: Boolean,
    supervisorConnection: SupervisorConnectionConfig,
    homeSnapshot: SupervisorHomeSnapshot?,
    homeSnapshotLoading: Boolean,
    homeSnapshotError: String?,
    onThemeModeSelected: (ThemeMode) -> Unit,
    onChangeConnection: () -> Unit,
    onBackToHome: () -> Unit,
) {
    var detail by remember(threadId) { mutableStateOf<ThreadDetailPreview?>(null) }
    var loading by remember(threadId) { mutableStateOf(true) }
    var error by remember(threadId) { mutableStateOf<String?>(null) }
    var refreshNonce by remember(threadId) { mutableIntStateOf(0) }
    var submittingPrompt by remember(threadId) { mutableStateOf(false) }
    var pendingPrompt by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingInterrupt by remember(threadId) { mutableStateOf(false) }
    var pendingSettingsUpdate by remember(threadId) { mutableStateOf<UpdateThreadSettingsRequest?>(null) }
    var resolvingRequestId by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingRenameTitle by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingDelete by remember(threadId) { mutableStateOf(false) }
    var threadActionBusy by remember(threadId) { mutableStateOf(false) }
    var threadActionError by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingRequestResponse by remember(threadId) {
        mutableStateOf<PendingRequestResponse?>(null)
    }
    val client = remember(supervisorConnection) { SupervisorApiClient(supervisorConnection) }
    val eventSocketClient = remember(supervisorConnection) {
        SupervisorEventSocketClient(supervisorConnection)
    }

    LaunchedEffect(threadId, refreshNonce) {
        loading = detail == null
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching { client.fetchThreadDetail(threadId, limit = 30) }
        }
        loading = false
        result
            .onSuccess { dto -> detail = buildThreadDetailPreviewFromSupervisor(dto) }
            .onFailure { throwable -> error = throwable.message ?: "Thread detail failed." }
    }

    LaunchedEffect(threadId, eventSocketClient) {
        eventSocketClient.threadEvents().collect { event ->
            if (event.threadId == threadId) {
                refreshNonce += 1
            }
        }
    }

    LaunchedEffect(pendingPrompt) {
        val prompt = pendingPrompt ?: return@LaunchedEffect
        submittingPrompt = true
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.sendThreadPrompt(
                    threadId = threadId,
                    request = SendThreadPromptRequest(prompt = prompt),
                )
            }
        }
        submittingPrompt = false
        pendingPrompt = null
        result
            .onSuccess {
                refreshNonce += 1
                delay(900)
                refreshNonce += 1
            }
            .onFailure { throwable -> error = throwable.message ?: "Prompt send failed." }
    }

    LaunchedEffect(pendingInterrupt) {
        if (!pendingInterrupt) return@LaunchedEffect
        submittingPrompt = true
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.interruptThread(threadId)
                client.fetchThreadDetail(threadId, limit = 30)
            }
        }
        submittingPrompt = false
        pendingInterrupt = false
        result
            .onSuccess { dto ->
                detail = buildThreadDetailPreviewFromSupervisor(dto)
                refreshNonce += 1
            }
            .onFailure { throwable -> error = throwable.message ?: "Interrupt failed." }
    }

    LaunchedEffect(pendingSettingsUpdate) {
        val settings = pendingSettingsUpdate ?: return@LaunchedEffect
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.updateThreadSettings(threadId, settings)
                client.fetchThreadDetail(threadId, limit = 30)
            }
        }
        pendingSettingsUpdate = null
        result
            .onSuccess { dto ->
                detail = buildThreadDetailPreviewFromSupervisor(dto)
                refreshNonce += 1
            }
            .onFailure { throwable -> error = throwable.message ?: "Settings update failed." }
    }

    LaunchedEffect(pendingRequestResponse) {
        val response = pendingRequestResponse ?: return@LaunchedEffect
        resolvingRequestId = response.request.id
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.respondToThreadRequest(
                    threadId = threadId,
                    requestId = response.request.id,
                    request = RespondThreadRequest(
                        answers = response.answers.mapValues { (_, answers) ->
                            RespondThreadRequestAnswer(answers = answers)
                        },
                    ),
                )
            }
        }
        resolvingRequestId = null
        pendingRequestResponse = null
        result
            .onSuccess { dto -> detail = buildThreadDetailPreviewFromSupervisor(dto) }
            .onFailure { throwable -> error = throwable.message ?: "Request response failed." }
    }

    LaunchedEffect(pendingRenameTitle) {
        val title = pendingRenameTitle ?: return@LaunchedEffect
        threadActionBusy = true
        threadActionError = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.updateThread(threadId, UpdateThreadRequest(title = title))
                client.fetchThreadDetail(threadId, limit = 30)
            }
        }
        threadActionBusy = false
        pendingRenameTitle = null
        result
            .onSuccess { dto ->
                detail = buildThreadDetailPreviewFromSupervisor(dto)
                refreshNonce += 1
            }
            .onFailure { throwable ->
                threadActionError = throwable.message ?: "Rename failed."
            }
    }

    LaunchedEffect(pendingDelete) {
        if (!pendingDelete) return@LaunchedEffect
        threadActionBusy = true
        threadActionError = null
        val result = withContext(Dispatchers.IO) {
            runCatching { client.deleteThread(threadId) }
        }
        threadActionBusy = false
        pendingDelete = false
        result
            .onSuccess { onBackToHome() }
            .onFailure { throwable ->
                threadActionError = throwable.message ?: "Delete failed."
            }
    }

    val currentDetail = detail
    if (currentDetail != null) {
        ThreadDetailSurface(
            appShell = ThreadPreviewSample.appShell,
            initialDetail = currentDetail,
            themeMode = themeMode,
            darkThemeActive = darkThemeActive,
            supervisorConnection = supervisorConnection,
            homeSnapshot = homeSnapshot,
            homeSnapshotLoading = homeSnapshotLoading,
            homeSnapshotError = error ?: homeSnapshotError,
            onThemeModeSelected = onThemeModeSelected,
            onChangeConnection = onChangeConnection,
            onSubmitPrompt = { prompt -> pendingPrompt = prompt },
            onInterruptThread = {
                if (!submittingPrompt) {
                    pendingInterrupt = true
                }
            },
            onUpdateThreadSettings = { settings ->
                pendingSettingsUpdate = settings
            },
            onDenyPendingRequest = { request ->
                pendingRequestResponse = PendingRequestResponse(
                    request = request,
                    answers = request.questions.associate { question ->
                        (question.id ?: question.header) to emptyList()
                    },
                )
            },
            onSubmitPendingRequest = { request, answers ->
                pendingRequestResponse = PendingRequestResponse(request = request, answers = answers)
            },
            onRenameThread = { title ->
                if (!threadActionBusy) {
                    pendingRenameTitle = title
                }
            },
            onDeleteThread = {
                if (!threadActionBusy) {
                    pendingDelete = true
                }
            },
            submittingPrompt = submittingPrompt,
            threadActionBusy = threadActionBusy,
            threadActionError = threadActionError,
        )
        return
    }

    ThreadDetailLoadingState(
        threadId = threadId,
        loading = loading,
        error = error,
        onRetry = { refreshNonce += 1 },
        onBackToHome = onBackToHome,
    )
}

private data class PendingRequestResponse(
    val request: PendingRequestPreview,
    val answers: Map<String, List<String>>,
)

@Composable
private fun ThreadDetailLoadingState(
    threadId: String,
    loading: Boolean,
    error: String?,
    onRetry: () -> Unit,
    onBackToHome: () -> Unit,
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(ThreadColors.Background)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(18.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(
                text = if (loading) "Loading thread" else "Thread unavailable",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = error ?: "Fetching $threadId from the supervisor.",
                color = ThreadColors.ForegroundSoft,
                style = MaterialTheme.typography.bodyMedium,
            )
            GraphButton(
                label = "Retry",
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Small,
                contentDescription = "Retry thread detail",
                onClick = onRetry,
            )
            GraphButton(
                label = "Home",
                variant = GraphButtonVariant.Outline,
                size = GraphButtonSize.Small,
                contentDescription = "Back to home",
                onClick = onBackToHome,
            )
        }
    }
}
