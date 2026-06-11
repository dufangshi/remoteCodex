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
import com.remotecodex.android.api.ForkThreadRequest
import com.remotecodex.android.api.RespondThreadRequest
import com.remotecodex.android.api.RespondThreadRequestAnswer
import com.remotecodex.android.api.CreateSupervisorShellRequest
import com.remotecodex.android.api.SendThreadPromptRequest
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorEventSocketClient
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.SupervisorShellEvent
import com.remotecodex.android.api.SupervisorSocketConnection
import com.remotecodex.android.api.SupervisorWorkspaceTreeNode
import com.remotecodex.android.api.TrustThreadHookRequest
import com.remotecodex.android.api.UntrustThreadHookRequest
import com.remotecodex.android.api.UpdateThreadGoalRequest
import com.remotecodex.android.api.UpdateThreadRequest
import com.remotecodex.android.api.UpdateThreadSettingsRequest
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.ui.components.GraphButton
import com.remotecodex.android.ui.components.GraphButtonSize
import com.remotecodex.android.ui.components.GraphButtonVariant
import com.remotecodex.android.ui.model.PendingRequestPreview
import com.remotecodex.android.ui.model.ShellPreview
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
    onOpenThread: (String) -> Unit,
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
    var pendingGoalUpdate by remember(threadId) { mutableStateOf<UpdateThreadGoalRequest?>(null) }
    var pendingCompact by remember(threadId) { mutableStateOf(false) }
    var pendingForkRequest by remember(threadId) { mutableStateOf<ForkThreadRequest?>(null) }
    var pendingTrustHook by remember(threadId) { mutableStateOf<TrustThreadHookRequest?>(null) }
    var pendingUntrustHook by remember(threadId) { mutableStateOf<UntrustThreadHookRequest?>(null) }
    var pendingCreateShell by remember(threadId) { mutableStateOf(false) }
    var pendingTerminateShellId by remember(threadId) { mutableStateOf<String?>(null) }
    var selectedWorkspaceFilePath by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingWorkspaceFilePath by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingWorkspaceLoadMore by remember(threadId) { mutableStateOf(false) }
    var resolvingRequestId by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingRenameTitle by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingDelete by remember(threadId) { mutableStateOf(false) }
    var threadActionBusy by remember(threadId) { mutableStateOf(false) }
    var threadActionError by remember(threadId) { mutableStateOf<String?>(null) }
    var socketConnection by remember(threadId, supervisorConnection) {
        mutableStateOf<SupervisorSocketConnection?>(null)
    }
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
            runCatching {
                client.fetchThreadDetailPreview(
                    threadId = threadId,
                    selectedWorkspaceFilePath = selectedWorkspaceFilePath,
                )
            }
        }
        loading = false
        result
            .onSuccess { preview ->
                detail = preview
                selectedWorkspaceFilePath = preview.workspacePreview.selectedFile.path.takeIf { it.isNotBlank() }
                    ?: selectedWorkspaceFilePath
            }
            .onFailure { throwable -> error = throwable.message ?: "Thread detail failed." }
    }

    LaunchedEffect(threadId, eventSocketClient) {
        val connection = eventSocketClient.connect(
            onThreadEvent = { event ->
                if (event.threadId == threadId) {
                    refreshNonce += 1
                }
            },
            onShellEvent = { event ->
                detail = detail?.withShellEvent(event)
            },
        )
        socketConnection = connection
        try {
            kotlinx.coroutines.awaitCancellation()
        } finally {
            socketConnection = null
            connection.close()
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
                client.fetchThreadDetailPreview(threadId, selectedWorkspaceFilePath = selectedWorkspaceFilePath)
            }
        }
        submittingPrompt = false
        pendingInterrupt = false
        result
            .onSuccess { preview ->
                detail = preview
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
                client.fetchThreadDetailPreview(threadId, selectedWorkspaceFilePath = selectedWorkspaceFilePath)
            }
        }
        pendingSettingsUpdate = null
        result
            .onSuccess { preview ->
                detail = preview
                refreshNonce += 1
            }
            .onFailure { throwable -> error = throwable.message ?: "Settings update failed." }
    }

    LaunchedEffect(pendingGoalUpdate) {
        val goal = pendingGoalUpdate ?: return@LaunchedEffect
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.updateThreadGoal(threadId, goal)
                client.fetchThreadDetailPreview(threadId, selectedWorkspaceFilePath = selectedWorkspaceFilePath)
            }
        }
        pendingGoalUpdate = null
        result
            .onSuccess { preview ->
                detail = preview
                refreshNonce += 1
            }
            .onFailure { throwable -> error = throwable.message ?: "Goal update failed." }
    }

    LaunchedEffect(pendingCompact) {
        if (!pendingCompact) return@LaunchedEffect
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.compactThread(threadId)
                client.fetchThreadDetailPreview(threadId, selectedWorkspaceFilePath = selectedWorkspaceFilePath)
            }
        }
        pendingCompact = false
        result
            .onSuccess { preview ->
                detail = preview
                refreshNonce += 1
            }
            .onFailure { throwable -> error = throwable.message ?: "Compact failed." }
    }

    LaunchedEffect(pendingForkRequest) {
        val forkRequest = pendingForkRequest ?: return@LaunchedEffect
        threadActionBusy = true
        threadActionError = null
        val result = withContext(Dispatchers.IO) {
            runCatching { client.forkThread(threadId, forkRequest) }
        }
        threadActionBusy = false
        pendingForkRequest = null
        result
            .onSuccess { forkResult ->
                onOpenThread(forkResult.thread.thread.id)
            }
            .onFailure { throwable -> threadActionError = throwable.message ?: "Fork failed." }
    }

    LaunchedEffect(pendingTrustHook) {
        val request = pendingTrustHook ?: return@LaunchedEffect
        threadActionBusy = true
        threadActionError = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.trustThreadHook(threadId, request)
                client.fetchThreadDetailPreview(threadId, selectedWorkspaceFilePath = selectedWorkspaceFilePath)
            }
        }
        threadActionBusy = false
        pendingTrustHook = null
        result
            .onSuccess { preview ->
                detail = preview
                refreshNonce += 1
            }
            .onFailure { throwable -> threadActionError = throwable.message ?: "Trust hook failed." }
    }

    LaunchedEffect(pendingUntrustHook) {
        val request = pendingUntrustHook ?: return@LaunchedEffect
        threadActionBusy = true
        threadActionError = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.untrustThreadHook(threadId, request)
                client.fetchThreadDetailPreview(threadId, selectedWorkspaceFilePath = selectedWorkspaceFilePath)
            }
        }
        threadActionBusy = false
        pendingUntrustHook = null
        result
            .onSuccess { preview ->
                detail = preview
                refreshNonce += 1
            }
            .onFailure { throwable -> threadActionError = throwable.message ?: "Untrust hook failed." }
    }

    LaunchedEffect(pendingCreateShell) {
        if (!pendingCreateShell) return@LaunchedEffect
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.createThreadShell(
                    threadId = threadId,
                    request = CreateSupervisorShellRequest(cols = 120, rows = 32, label = "Android shell"),
                )
                client.fetchThreadDetailPreview(threadId, selectedWorkspaceFilePath = selectedWorkspaceFilePath)
            }
        }
        pendingCreateShell = false
        result
            .onSuccess { preview ->
                detail = preview
                refreshNonce += 1
            }
            .onFailure { throwable -> error = throwable.message ?: "Shell create failed." }
    }

    LaunchedEffect(pendingTerminateShellId) {
        val shellId = pendingTerminateShellId ?: return@LaunchedEffect
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.terminateShell(shellId)
                client.fetchThreadDetailPreview(threadId, selectedWorkspaceFilePath = selectedWorkspaceFilePath)
            }
        }
        pendingTerminateShellId = null
        result
            .onSuccess { preview ->
                detail = preview
                refreshNonce += 1
            }
            .onFailure { throwable -> error = throwable.message ?: "Shell terminate failed." }
    }

    LaunchedEffect(pendingWorkspaceFilePath) {
        val path = pendingWorkspaceFilePath ?: return@LaunchedEffect
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.fetchThreadDetailPreview(
                    threadId = threadId,
                    selectedWorkspaceFilePath = path,
                )
            }
        }
        pendingWorkspaceFilePath = null
        result
            .onSuccess { preview ->
                detail = preview
                selectedWorkspaceFilePath = preview.workspacePreview.selectedFile.path.takeIf { it.isNotBlank() }
                    ?: path
            }
            .onFailure { throwable -> error = throwable.message ?: "Workspace preview failed." }
    }

    LaunchedEffect(pendingWorkspaceLoadMore) {
        if (!pendingWorkspaceLoadMore) return@LaunchedEffect
        val currentFile = detail?.workspacePreview?.selectedFile
        val path = currentFile?.path?.takeIf { it.isNotBlank() }
        val nextOffset = currentFile?.nextOffset
        if (path == null || nextOffset == null || !currentFile.truncated) {
            pendingWorkspaceLoadMore = false
            return@LaunchedEffect
        }
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val threadDetail = client.fetchThreadDetail(threadId, limit = 1)
                val next = client.fetchWorkspaceFilePreview(
                    workspaceId = threadDetail.workspace.id,
                    path = path,
                    offset = nextOffset,
                    limit = 50_000,
                )
                client.fetchThreadDetailPreview(
                    threadId = threadId,
                    selectedWorkspaceFilePath = path,
                    overrideWorkspaceContent = currentFile.content + next.content,
                    overrideWorkspaceNextOffset = next.nextOffset,
                    overrideWorkspaceTruncated = next.truncated,
                )
            }
        }
        pendingWorkspaceLoadMore = false
        result
            .onSuccess { preview ->
                detail = preview
                selectedWorkspaceFilePath = path
            }
            .onFailure { throwable -> error = throwable.message ?: "Workspace preview load more failed." }
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
            .onSuccess { dto ->
                detail = buildThreadDetailPreviewFromSupervisor(dto)
            }
            .onFailure { throwable -> error = throwable.message ?: "Request response failed." }
    }

    LaunchedEffect(pendingRenameTitle) {
        val title = pendingRenameTitle ?: return@LaunchedEffect
        threadActionBusy = true
        threadActionError = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.updateThread(threadId, UpdateThreadRequest(title = title))
                client.fetchThreadDetailPreview(threadId, selectedWorkspaceFilePath = selectedWorkspaceFilePath)
            }
        }
        threadActionBusy = false
        pendingRenameTitle = null
        result
            .onSuccess { preview ->
                detail = preview
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

    val sendActiveShellInput: (String) -> Unit = { data ->
        detail?.shellPreview?.let { shell ->
            val shellId = shell.activeProcessId
            val viewerId = shell.viewerId
            val connection = socketConnection
            if (viewerId.isNullOrBlank()) {
                connection?.attachShell(shellId)
            } else {
                connection?.sendShellInput(shellId, viewerId, data)
            }
        }
    }
    val clearActiveShell: () -> Unit = {
        detail?.shellPreview?.let { shell ->
            val shellId = shell.activeProcessId
            val viewerId = shell.viewerId
            val connection = socketConnection
            if (viewerId.isNullOrBlank()) {
                connection?.attachShell(shellId)
            } else {
                connection?.clearShell(shellId, viewerId)
            }
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
            onUpdateThreadGoal = { goal ->
                pendingGoalUpdate = goal
            },
            onCompactThread = {
                pendingCompact = true
            },
            onForkLatest = {
                pendingForkRequest = ForkThreadRequest(mode = "latest")
            },
            onForkTurn = { turnId ->
                pendingForkRequest = ForkThreadRequest(mode = "turn", turnId = turnId)
            },
            onTrustHook = { key, currentHash ->
                pendingTrustHook = TrustThreadHookRequest(key = key, currentHash = currentHash)
            },
            onUntrustHook = { key ->
                pendingUntrustHook = UntrustThreadHookRequest(key = key)
            },
            onCreateShell = {
                pendingCreateShell = true
            },
            onTerminateShell = { shellId ->
                pendingTerminateShellId = shellId
            },
            onSendShellInput = sendActiveShellInput,
            onSendShellControl = sendActiveShellInput,
            onClearShell = clearActiveShell,
            onSelectWorkspaceFile = { path ->
                pendingWorkspaceFilePath = path
            },
            onLoadMoreWorkspacePreview = {
                pendingWorkspaceLoadMore = true
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

private fun SupervisorApiClient.fetchThreadDetailPreview(
    threadId: String,
    selectedWorkspaceFilePath: String? = null,
    overrideWorkspaceContent: String? = null,
    overrideWorkspaceNextOffset: Long? = null,
    overrideWorkspaceTruncated: Boolean? = null,
): ThreadDetailPreview {
    val detail = fetchThreadDetail(threadId, limit = 30)
    val tree = runCatching { fetchWorkspaceTree(detail.workspace.id) }.getOrNull()
    val previewPath = selectedWorkspaceFilePath?.takeIf { it.isNotBlank() } ?: tree?.firstFilePath()
    val filePreview = previewPath?.let { path ->
        runCatching {
            fetchWorkspaceFilePreview(
                workspaceId = detail.workspace.id,
                path = path,
                limit = 50_000,
            )
        }.getOrNull()
    }?.let { preview ->
        if (overrideWorkspaceContent == null) {
            preview
        } else {
            preview.copy(
                content = overrideWorkspaceContent,
                nextOffset = overrideWorkspaceNextOffset ?: preview.nextOffset,
                truncated = overrideWorkspaceTruncated ?: preview.truncated,
            )
        }
    }
    val shellState = runCatching { fetchThreadShellState(threadId) }.getOrNull()
    val forkTurnsResult = runCatching { fetchThreadForkTurns(threadId) }
    val skillsResult = runCatching { fetchThreadSkills(threadId) }
    val mcpServersResult = runCatching { fetchThreadMcpServers(threadId) }
    val hooksResult = runCatching { fetchThreadHooks(threadId) }
    return buildThreadDetailPreviewFromSupervisor(
        detail = detail,
        workspaceTree = tree,
        workspaceFilePreview = filePreview,
        shellState = shellState,
        forkTurns = forkTurnsResult.getOrNull(),
        forkTurnsError = forkTurnsResult.exceptionOrNull()?.message,
        skills = skillsResult.getOrNull(),
        skillsError = skillsResult.exceptionOrNull()?.message,
        mcpServers = mcpServersResult.getOrNull(),
        mcpServersError = mcpServersResult.exceptionOrNull()?.message,
        hooks = hooksResult.getOrNull(),
        hooksError = hooksResult.exceptionOrNull()?.message,
    )
}

private fun SupervisorWorkspaceTreeNode.firstFilePath(): String? {
    if (kind == "file") {
        return path
    }
    return children.firstNotNullOfOrNull { child -> child.firstFilePath() }
}

private fun ThreadDetailPreview.withShellEvent(event: SupervisorShellEvent): ThreadDetailPreview {
    val shell = shellPreview
    if (event.shellId != shell.activeProcessId) {
        return this
    }
    val nextShell = when (event.type) {
        "shell.connected" -> shell.copy(
            viewerId = event.viewerId ?: shell.viewerId,
            connectionLabel = "WS attached",
            inputEnabled = true,
        )
        "shell.status" -> shell.copy(
            status = event.message ?: event.type.removePrefix("shell."),
            connectionLabel = "WS status",
            inputEnabled = event.viewerId != null || shell.viewerId != null || shell.inputEnabled,
        )
        "shell.output" -> {
            val output = event.data.orEmpty()
            val nextLines = if (event.replace) {
                output.lines()
            } else {
                (shell.lines + output.lines()).takeLast(300)
            }.filter { it.isNotEmpty() }
            shell.copy(
                lines = nextLines.ifEmpty { shell.lines },
                commandRunning = event.isCommandRunning ?: shell.commandRunning,
                connectionLabel = "WS streaming",
                inputEnabled = true,
            )
        }
        "shell.error" -> shell.copy(
            lines = (shell.lines + "Shell error: ${event.message ?: "unknown"}").takeLast(300),
            connectionLabel = "WS error",
        )
        "shell.detached",
        "shell.exited",
        -> shell.copy(
            status = event.type.removePrefix("shell.").replaceFirstChar { it.uppercase() },
            connectionLabel = "WS ${event.type.removePrefix("shell.")}",
            inputEnabled = false,
            commandRunning = false,
        )
        else -> shell
    }
    return copy(shellPreview = nextShell)
}

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
