package com.remotecodex.android.ui.screen

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.remotecodex.android.AndroidFeatureFlags
import com.remotecodex.android.api.ExportThreadRequest
import com.remotecodex.android.api.ForkThreadRequest
import com.remotecodex.android.api.RespondThreadRequest
import com.remotecodex.android.api.RespondThreadRequestAnswer
import com.remotecodex.android.api.SendThreadPromptRequest
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorEventSocketClient
import com.remotecodex.android.api.SupervisorHomeSnapshot
import com.remotecodex.android.api.SupervisorShellEvent
import com.remotecodex.android.api.SupervisorSocketConnection
import com.remotecodex.android.api.SupervisorThreadDetail
import com.remotecodex.android.api.SupervisorWorkspaceTreeNode
import com.remotecodex.android.api.TrustThreadHookRequest
import com.remotecodex.android.api.UntrustThreadHookRequest
import com.remotecodex.android.api.UpdateThreadGoalRequest
import com.remotecodex.android.api.UpdateThreadRequest
import com.remotecodex.android.api.UpdateThreadSettingsRequest
import com.remotecodex.android.api.UploadWorkspaceFileRequest
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.storage.saveExportToDownloads
import com.remotecodex.android.storage.shareSavedExport
import com.remotecodex.android.ui.components.GraphButton
import com.remotecodex.android.ui.components.GraphButtonSize
import com.remotecodex.android.ui.components.GraphButtonVariant
import com.remotecodex.android.ui.components.LongTextDialog
import com.remotecodex.android.ui.components.PendingPromptAttachmentKind
import com.remotecodex.android.ui.components.PendingPromptAttachmentUpload
import com.remotecodex.android.ui.model.DetailImagePreview
import com.remotecodex.android.ui.model.DetailPreview
import com.remotecodex.android.ui.model.DetailRequest
import com.remotecodex.android.ui.model.PendingRequestPreview
import com.remotecodex.android.ui.model.ShellPreview
import com.remotecodex.android.ui.model.ThreadDetailPreview
import com.remotecodex.android.ui.presentation.buildThreadDetailPreviewFromSupervisor
import com.remotecodex.android.ui.presentation.ComposerAttachmentActionKind
import com.remotecodex.android.ui.sample.ThreadPreviewSample
import com.remotecodex.android.ui.theme.ThreadColors
import com.remotecodex.android.thread.ThreadProjectionState
import com.remotecodex.android.thread.reconcileWithDetail
import com.remotecodex.android.thread.reduceThreadEvent
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
    var threadProjectionState by remember(threadId) { mutableStateOf<ThreadProjectionState?>(null) }
    var loading by remember(threadId) { mutableStateOf(true) }
    var error by remember(threadId) { mutableStateOf<String?>(null) }
    var refreshNonce by remember(threadId) { mutableIntStateOf(0) }
    var submittingPrompt by remember(threadId) { mutableStateOf(false) }
    var pendingPrompt by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingPromptRequest by remember(threadId) { mutableStateOf<SendThreadPromptRequest?>(null) }
    var pendingPromptAttachmentKind by remember(threadId) { mutableStateOf<ComposerAttachmentActionKind?>(null) }
    var pendingPromptAttachment by remember(threadId) { mutableStateOf<PendingPromptAttachmentUpload?>(null) }
    var pendingInterrupt by remember(threadId) { mutableStateOf(false) }
    var pendingSettingsUpdate by remember(threadId) { mutableStateOf<UpdateThreadSettingsRequest?>(null) }
    var pendingGoalUpdate by remember(threadId) { mutableStateOf<UpdateThreadGoalRequest?>(null) }
    var pendingCompact by remember(threadId) { mutableStateOf(false) }
    var pendingForkRequest by remember(threadId) { mutableStateOf<ForkThreadRequest?>(null) }
    var pendingExportRequest by remember(threadId) { mutableStateOf<ExportThreadRequest?>(null) }
    var pendingTrustHook by remember(threadId) { mutableStateOf<TrustThreadHookRequest?>(null) }
    var pendingUntrustHook by remember(threadId) { mutableStateOf<UntrustThreadHookRequest?>(null) }
    var pendingCreateShell by remember(threadId) { mutableStateOf(false) }
    var pendingTerminateShellId by remember(threadId) { mutableStateOf<String?>(null) }
    var selectedWorkspaceFilePath by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingWorkspaceFilePath by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingWorkspaceLoadMore by remember(threadId) { mutableStateOf(false) }
    var pendingWorkspaceDownloadPath by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingWorkspaceRawOpenPath by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingWorkspaceRawCopyPath by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingWorkspaceUploadNote by remember(threadId) { mutableStateOf(false) }
    var pendingWorkspaceUploadFile by remember(threadId) { mutableStateOf<UploadWorkspaceFileRequest?>(null) }
    var workspaceActionMessage by remember(threadId) { mutableStateOf<String?>(null) }
    var pendingLoadEarlier by remember(threadId) { mutableStateOf(false) }
    var loadingEarlier by remember(threadId) { mutableStateOf(false) }
    var resolvingRequestId by remember(threadId) { mutableStateOf<String?>(null) }
    var openDetail by remember(threadId) { mutableStateOf<DetailPreview?>(null) }
    var pendingDetailRequest by remember(threadId) { mutableStateOf<DetailRequest?>(null) }
    var detailCache by remember(threadId) {
        mutableStateOf<Map<String, DetailPreview>>(emptyMap())
    }
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
    val clipboardManager = LocalClipboardManager.current
    val context = androidx.compose.ui.platform.LocalContext.current
    val workspaceUploadPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri == null) {
            workspaceActionMessage = "Upload cancelled"
            return@rememberLauncherForActivityResult
        }
        val request = runCatching { context.readUploadRequest(uri) }
        request
            .onSuccess { pendingWorkspaceUploadFile = it }
            .onFailure { throwable -> error = throwable.message ?: "Could not read selected file." }
    }
    val promptAttachmentPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        val kind = pendingPromptAttachmentKind
        pendingPromptAttachmentKind = null
        if (uri == null || kind == null) {
            return@rememberLauncherForActivityResult
        }
        val request = runCatching { context.readPromptAttachment(uri, kind) }
        request
            .onSuccess { pendingPromptAttachment = it }
            .onFailure { throwable -> error = throwable.message ?: "Could not read selected attachment." }
    }

    LaunchedEffect(threadId, refreshNonce) {
        loading = detail == null
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.fetchThreadDetailBundle(
                    threadId = threadId,
                    selectedWorkspaceFilePath = selectedWorkspaceFilePath,
                )
            }
        }
        loading = false
        result
            .onSuccess { bundle ->
                val reconciledState = threadProjectionState?.reconcileWithDetail(bundle.dto)
                    ?: ThreadProjectionState(detail = bundle.dto)
                threadProjectionState = reconciledState
                detail = mergeThreadEventPreview(
                    current = bundle.preview,
                    next = buildThreadDetailPreviewFromSupervisor(reconciledState.detail),
                )
                selectedWorkspaceFilePath = bundle.preview.workspacePreview.selectedFile.path.takeIf { it.isNotBlank() }
                    ?: selectedWorkspaceFilePath
            }
            .onFailure { throwable -> error = throwable.message ?: "Thread detail failed." }
    }

    LaunchedEffect(threadId, eventSocketClient) {
        val connection = eventSocketClient.connect(
            onThreadEvent = { event ->
                if (event.threadId == threadId) {
                    val currentProjection = threadProjectionState
                    val currentPreview = detail
                    if (currentProjection == null || currentPreview == null) {
                        refreshNonce += 1
                    } else {
                        val reduced = reduceThreadEvent(currentProjection, event)
                        threadProjectionState = reduced.state
                        detail = mergeThreadEventPreview(
                            current = currentPreview,
                            next = buildThreadDetailPreviewFromSupervisor(reduced.detail),
                        )
                        if (reduced.needsRefresh) {
                            refreshNonce += 1
                        }
                    }
                }
            },
            onShellEvent = { event ->
                if (AndroidFeatureFlags.ShellEnabled) {
                    detail = detail?.withShellEvent(event)
                }
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

    LaunchedEffect(pendingPromptRequest) {
        val promptRequest = pendingPromptRequest ?: return@LaunchedEffect
        submittingPrompt = true
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.sendThreadPrompt(
                    threadId = threadId,
                    request = promptRequest,
                )
            }
        }
        submittingPrompt = false
        pendingPromptRequest = null
        result
            .onSuccess {
                pendingPromptAttachment = null
                refreshNonce += 1
                delay(900)
                refreshNonce += 1
            }
            .onFailure { throwable -> error = throwable.message ?: "Prompt send failed." }
    }

    LaunchedEffect(pendingDetailRequest) {
        val request = pendingDetailRequest ?: return@LaunchedEffect
        openDetail = request.fallback
        when (request) {
            is DetailRequest.Local -> {
                pendingDetailRequest = null
            }
            is DetailRequest.HistoryItem -> {
                val cached = detailCache[request.itemId]
                if (cached != null) {
                    pendingDetailRequest = null
                    openDetail = cached
                } else {
                    val result = withContext(Dispatchers.IO) {
                        runCatching {
                            client.fetchThreadHistoryItemDetail(
                                threadId = threadId,
                                itemId = request.itemId,
                            )
                        }
                    }
                    pendingDetailRequest = null
                    result
                        .onSuccess { item ->
                            val detailPreview = DetailPreview(
                                title = item.title.ifBlank { request.fallback.title },
                                text = item.text.ifBlank { request.fallback.text },
                            )
                            detailCache = detailCache + (request.itemId to detailPreview)
                            openDetail = detailPreview
                        }
                        .onFailure { throwable ->
                            openDetail = request.fallback.copy(
                                text = request.fallback.text + "\n\nDetail load failed: " + (throwable.message ?: "Unknown error."),
                            )
                        }
                }
            }
            is DetailRequest.ImageAsset -> {
                val result = withContext(Dispatchers.IO) {
                    runCatching {
                        client.fetchThreadImageAsset(
                            threadId = threadId,
                            path = request.path,
                        )
                    }
                }
                pendingDetailRequest = null
                result
                    .onSuccess { image ->
                        openDetail = DetailPreview(
                            title = image.filename.ifBlank { request.fallback.title },
                            text = request.path,
                            image = DetailImagePreview(
                                path = request.path,
                                contentType = image.contentType,
                                bytes = image.bytes,
                                filename = image.filename,
                            ),
                        )
                    }
                    .onFailure { throwable ->
                        openDetail = request.fallback.copy(
                            text = request.fallback.text + "\n\nImage load failed: " + (throwable.message ?: "Unknown error."),
                        )
                    }
            }
        }
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
                threadProjectionState = null
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
                threadProjectionState = null
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

    LaunchedEffect(pendingExportRequest) {
        val exportRequest = pendingExportRequest ?: return@LaunchedEffect
        threadActionBusy = true
        threadActionError = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val download = client.downloadThreadTranscriptExport(threadId, exportRequest)
                context.saveExportToDownloads(download)
            }
        }
        threadActionBusy = false
        pendingExportRequest = null
        result
            .onSuccess { savedFile ->
                threadActionError = "Export saved: ${savedFile.filename} (${savedFile.sizeBytes} bytes)"
                runCatching { context.shareSavedExport(savedFile) }
            }
            .onFailure { throwable -> threadActionError = throwable.message ?: "Export failed." }
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
        if (!AndroidFeatureFlags.ShellEnabled) {
            pendingCreateShell = false
            error = "Shell access is disabled on Android."
            return@LaunchedEffect
        }
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.createThreadShell(threadId = threadId)
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
        if (!AndroidFeatureFlags.ShellEnabled) {
            pendingTerminateShellId = null
            error = "Shell access is disabled on Android."
            return@LaunchedEffect
        }
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

    LaunchedEffect(pendingWorkspaceDownloadPath) {
        val path = pendingWorkspaceDownloadPath ?: return@LaunchedEffect
        error = null
        workspaceActionMessage = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val threadDetail = client.fetchThreadDetail(threadId, limit = 1)
                client.downloadWorkspaceFile(threadDetail.workspace.id, path)
            }
        }
        pendingWorkspaceDownloadPath = null
        result
            .onSuccess { download ->
                workspaceActionMessage = "Downloaded ${download.filename} (${download.bytes.size} bytes)"
            }
            .onFailure { throwable -> error = throwable.message ?: "Workspace download failed." }
    }

    LaunchedEffect(pendingWorkspaceRawOpenPath) {
        val path = pendingWorkspaceRawOpenPath ?: return@LaunchedEffect
        error = null
        workspaceActionMessage = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val threadDetail = client.fetchThreadDetail(threadId, limit = 1)
                val raw = client.fetchWorkspaceRawFile(threadDetail.workspace.id, path)
                client.fetchThreadDetailPreview(
                    threadId = threadId,
                    selectedWorkspaceFilePath = path,
                    overrideWorkspaceContent = raw.text,
                    overrideWorkspaceNextOffset = raw.bytes.size.toLong(),
                    overrideWorkspaceTruncated = false,
                )
            }
        }
        pendingWorkspaceRawOpenPath = null
        result
            .onSuccess { preview ->
                detail = preview
                selectedWorkspaceFilePath = path
                workspaceActionMessage = "Opened raw ${path.substringAfterLast('/')}"
            }
            .onFailure { throwable -> error = throwable.message ?: "Workspace raw file failed." }
    }

    LaunchedEffect(pendingWorkspaceRawCopyPath) {
        val path = pendingWorkspaceRawCopyPath ?: return@LaunchedEffect
        error = null
        workspaceActionMessage = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val threadDetail = client.fetchThreadDetail(threadId, limit = 1)
                client.fetchWorkspaceRawFile(threadDetail.workspace.id, path)
            }
        }
        pendingWorkspaceRawCopyPath = null
        result
            .onSuccess { raw ->
                clipboardManager.setText(AnnotatedString(raw.text))
                workspaceActionMessage = "Copied ${path.substringAfterLast('/')} (${raw.bytes.size} bytes)"
            }
            .onFailure { throwable -> error = throwable.message ?: "Workspace raw copy failed." }
    }

    LaunchedEffect(pendingWorkspaceUploadNote) {
        if (!pendingWorkspaceUploadNote) return@LaunchedEffect
        error = null
        workspaceActionMessage = null
        val filename = "android-upload-${System.currentTimeMillis()}.txt"
        val note = buildString {
            appendLine("Remote Codex Android upload smoke")
            appendLine("Thread: $threadId")
            selectedWorkspaceFilePath?.takeIf { it.isNotBlank() }?.let { path ->
                appendLine("Selected file: $path")
            }
        }
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val threadDetail = client.fetchThreadDetail(threadId, limit = 1)
                val upload = client.uploadWorkspaceFile(
                    workspaceId = threadDetail.workspace.id,
                    request = UploadWorkspaceFileRequest(
                        filename = filename,
                        bytes = note.toByteArray(Charsets.UTF_8),
                        contentType = "text/plain",
                    ),
                )
                val uploadedPath = upload.file?.path ?: upload.paths.firstOrNull()
                val preview = client.fetchThreadDetailPreview(
                    threadId = threadId,
                    selectedWorkspaceFilePath = uploadedPath ?: selectedWorkspaceFilePath,
                )
                upload to preview
            }
        }
        pendingWorkspaceUploadNote = false
        result
            .onSuccess { (upload, preview) ->
                detail = preview
                selectedWorkspaceFilePath = upload.file?.path ?: preview.workspacePreview.selectedFile.path
                workspaceActionMessage = upload.file?.let { file ->
                    "Uploaded ${file.name} (${file.size} bytes)"
                } ?: "Uploaded ${upload.archiveName ?: "workspace file"}"
            }
            .onFailure { throwable -> error = throwable.message ?: "Workspace upload failed." }
    }

    LaunchedEffect(pendingWorkspaceUploadFile) {
        val uploadRequest = pendingWorkspaceUploadFile ?: return@LaunchedEffect
        error = null
        workspaceActionMessage = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                val threadDetail = client.fetchThreadDetail(threadId, limit = 1)
                val upload = client.uploadWorkspaceFile(
                    workspaceId = threadDetail.workspace.id,
                    request = uploadRequest,
                )
                val uploadedPath = upload.file?.path ?: upload.paths.firstOrNull()
                val preview = client.fetchThreadDetailPreview(
                    threadId = threadId,
                    selectedWorkspaceFilePath = uploadedPath ?: selectedWorkspaceFilePath,
                )
                upload to preview
            }
        }
        pendingWorkspaceUploadFile = null
        result
            .onSuccess { (upload, preview) ->
                detail = preview
                selectedWorkspaceFilePath = upload.file?.path ?: preview.workspacePreview.selectedFile.path
                workspaceActionMessage = upload.file?.let { file ->
                    "Uploaded ${file.name} (${file.size} bytes)"
                } ?: "Uploaded ${upload.archiveName ?: uploadRequest.filename}"
            }
            .onFailure { throwable -> error = throwable.message ?: "Workspace upload failed." }
    }

    LaunchedEffect(pendingLoadEarlier) {
        if (!pendingLoadEarlier) return@LaunchedEffect
        val currentState = threadProjectionState
        val beforeTurnId = currentState?.detail?.turns?.firstOrNull()?.id
        if (currentState == null || beforeTurnId.isNullOrBlank()) {
            pendingLoadEarlier = false
            return@LaunchedEffect
        }
        loadingEarlier = true
        error = null
        val result = withContext(Dispatchers.IO) {
            runCatching {
                client.fetchThreadDetail(threadId, limit = 10, beforeTurnId = beforeTurnId)
            }
        }
        pendingLoadEarlier = false
        loadingEarlier = false
        result
            .onSuccess { page ->
                val merged = mergeEarlierThreadDetail(currentState.detail, page)
                val reconciledState = currentState.reconcileWithDetail(merged)
                threadProjectionState = reconciledState
                detail = detail?.let { currentPreview ->
                    mergeThreadEventPreview(
                        current = currentPreview,
                        next = buildThreadDetailPreviewFromSupervisor(reconciledState.detail),
                    )
                } ?: buildThreadDetailPreviewFromSupervisor(merged)
            }
            .onFailure { throwable -> error = throwable.message ?: "Earlier history failed." }
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
                threadProjectionState = threadProjectionState?.reconcileWithDetail(dto)
                    ?: ThreadProjectionState(detail = dto)
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

    val currentDetail = detail?.let { preview ->
        val withWorkspaceMessage = workspaceActionMessage?.let { message ->
            preview.copy(workspacePreview = preview.workspacePreview.copy(statusMessage = message))
        } ?: preview
        withWorkspaceMessage.copy(
            timelineAuxiliary = withWorkspaceMessage.timelineAuxiliary.copy(
                loadingEarlier = loadingEarlier,
            ),
        )
    }
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
            onSubmitPromptRequest = { request -> pendingPromptRequest = request },
            onPickPromptAttachment = { kind ->
                pendingPromptAttachmentKind = kind
                promptAttachmentPicker.launch(
                    when (kind) {
                        ComposerAttachmentActionKind.Photo -> arrayOf("image/*")
                        ComposerAttachmentActionKind.File -> arrayOf("*/*")
                    },
                )
            },
            pendingPromptAttachment = pendingPromptAttachment,
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
            onExportThread = { exportRequest ->
                pendingExportRequest = exportRequest
            },
            onTrustHook = { key, currentHash ->
                pendingTrustHook = TrustThreadHookRequest(key = key, currentHash = currentHash)
            },
            onUntrustHook = { key ->
                pendingUntrustHook = UntrustThreadHookRequest(key = key)
            },
            onOpenDetail = { request ->
                pendingDetailRequest = request
            },
            onCreateShell = if (AndroidFeatureFlags.ShellEnabled) {
                { pendingCreateShell = true }
            } else {
                null
            },
            onTerminateShell = if (AndroidFeatureFlags.ShellEnabled) {
                { shellId -> pendingTerminateShellId = shellId }
            } else {
                null
            },
            onSendShellInput = if (AndroidFeatureFlags.ShellEnabled) sendActiveShellInput else null,
            onSendShellControl = if (AndroidFeatureFlags.ShellEnabled) sendActiveShellInput else null,
            onClearShell = if (AndroidFeatureFlags.ShellEnabled) clearActiveShell else null,
            onSelectWorkspaceFile = { path ->
                pendingWorkspaceFilePath = path
            },
            onLoadMoreWorkspacePreview = {
                pendingWorkspaceLoadMore = true
            },
            onDownloadWorkspaceFile = { path ->
                pendingWorkspaceDownloadPath = path
            },
            onOpenWorkspaceRawFile = { path ->
                pendingWorkspaceRawOpenPath = path
            },
            onCopyWorkspaceRawFile = { path ->
                pendingWorkspaceRawCopyPath = path
            },
            onUploadWorkspaceNote = {
                workspaceUploadPicker.launch(arrayOf("*/*"))
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
            onLoadEarlier = {
                if (!loadingEarlier) {
                    pendingLoadEarlier = true
                }
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
        openDetail?.let { detailPreview ->
            LongTextDialog(
                detail = detailPreview,
                onClose = {
                    openDetail = null
                    pendingDetailRequest = null
                },
            )
        }
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

private data class ThreadDetailBundle(
    val dto: SupervisorThreadDetail,
    val preview: ThreadDetailPreview,
)

private fun SupervisorApiClient.fetchThreadDetailPreview(
    threadId: String,
    selectedWorkspaceFilePath: String? = null,
    overrideWorkspaceContent: String? = null,
    overrideWorkspaceNextOffset: Long? = null,
    overrideWorkspaceTruncated: Boolean? = null,
    includeShell: Boolean = AndroidFeatureFlags.ShellEnabled,
): ThreadDetailPreview {
    return fetchThreadDetailBundle(
        threadId = threadId,
        selectedWorkspaceFilePath = selectedWorkspaceFilePath,
        overrideWorkspaceContent = overrideWorkspaceContent,
        overrideWorkspaceNextOffset = overrideWorkspaceNextOffset,
        overrideWorkspaceTruncated = overrideWorkspaceTruncated,
        includeShell = includeShell,
    ).preview
}

private fun SupervisorApiClient.fetchThreadDetailBundle(
    threadId: String,
    selectedWorkspaceFilePath: String? = null,
    overrideWorkspaceContent: String? = null,
    overrideWorkspaceNextOffset: Long? = null,
    overrideWorkspaceTruncated: Boolean? = null,
    includeShell: Boolean = AndroidFeatureFlags.ShellEnabled,
): ThreadDetailBundle {
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
    val shellState = if (includeShell) {
        runCatching { fetchThreadShellState(threadId) }.getOrNull()
    } else {
        null
    }
    val exportTurnsResult = runCatching { fetchThreadExportTurns(threadId) }
    val forkTurnsResult = runCatching { fetchThreadForkTurns(threadId) }
    val skillsResult = runCatching { fetchThreadSkills(threadId) }
    val mcpServersResult = runCatching { fetchThreadMcpServers(threadId) }
    val hooksResult = runCatching { fetchThreadHooks(threadId) }
    val preview = buildThreadDetailPreviewFromSupervisor(
        detail = detail,
        workspaceTree = tree,
        workspaceFilePreview = filePreview,
        shellState = shellState,
        exportTurns = exportTurnsResult.getOrNull(),
        forkTurns = forkTurnsResult.getOrNull(),
        forkTurnsError = forkTurnsResult.exceptionOrNull()?.message,
        skills = skillsResult.getOrNull(),
        skillsError = skillsResult.exceptionOrNull()?.message,
        mcpServers = mcpServersResult.getOrNull(),
        mcpServersError = mcpServersResult.exceptionOrNull()?.message,
        hooks = hooksResult.getOrNull(),
        hooksError = hooksResult.exceptionOrNull()?.message,
    )
    return ThreadDetailBundle(dto = detail, preview = preview)
}

private fun mergeThreadEventPreview(
    current: ThreadDetailPreview,
    next: ThreadDetailPreview,
): ThreadDetailPreview {
    return next.copy(
        exportTurns = current.exportTurns,
        workspacePreview = current.workspacePreview,
        shellPreview = current.shellPreview,
        composer = next.composer.copy(
            activeView = current.composer.activeView,
            followTail = current.composer.followTail,
            prompt = current.composer.prompt,
            modelOptions = current.composer.modelOptions,
            reasoningEffortOptions = current.composer.reasoningEffortOptions,
            shellControl = current.composer.shellControl,
            forkTurnOptions = current.composer.forkTurnOptions,
            goalComposeMode = current.composer.goalComposeMode,
            slashPanelView = current.composer.slashPanelView,
            toolboxItems = current.composer.toolboxItems,
            skillsPanel = current.composer.skillsPanel,
            mcpPanel = current.composer.mcpPanel,
            hooksPanel = current.composer.hooksPanel,
        ),
    )
}

private fun mergeEarlierThreadDetail(
    current: SupervisorThreadDetail,
    earlier: SupervisorThreadDetail,
): SupervisorThreadDetail {
    val existingIds = current.turns.map { it.id }.toSet()
    val mergedTurns = earlier.turns.filterNot { it.id in existingIds } + current.turns
    return current.copy(
        turns = mergedTurns,
        turnCount = mergedTurns.size,
        totalTurnCount = maxOf(current.totalTurnCount, earlier.totalTurnCount, mergedTurns.size),
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

private fun Context.readUploadRequest(uri: Uri): UploadWorkspaceFileRequest {
    val bytes = contentResolver.openInputStream(uri)?.use { stream ->
        stream.readBytes()
    } ?: throw IllegalStateException("Could not open selected file.")
    val filename = queryDisplayName(uri)
        ?: uri.lastPathSegment?.substringAfterLast('/')
        ?: "android-upload"
    val contentType = contentResolver.getType(uri) ?: "application/octet-stream"
    return UploadWorkspaceFileRequest(
        filename = filename,
        bytes = bytes,
        contentType = contentType,
    )
}

private fun Context.readPromptAttachment(
    uri: Uri,
    kind: ComposerAttachmentActionKind,
): PendingPromptAttachmentUpload {
    val bytes = contentResolver.openInputStream(uri)?.use { stream ->
        stream.readBytes()
    } ?: throw IllegalStateException("Could not open selected attachment.")
    val filename = queryDisplayName(uri)
        ?: uri.lastPathSegment?.substringAfterLast('/')
        ?: kind.defaultPromptAttachmentName()
    val contentType = contentResolver.getType(uri) ?: filename.inferPromptAttachmentContentType(kind)
    return PendingPromptAttachmentUpload(
        clientId = "android-${System.currentTimeMillis()}-${filename.hashCode().toString().replace("-", "m")}",
        kind = when (kind) {
            ComposerAttachmentActionKind.Photo -> PendingPromptAttachmentKind.Photo
            ComposerAttachmentActionKind.File -> PendingPromptAttachmentKind.File
        },
        originalName = filename,
        placeholder = "",
        bytes = bytes,
        contentType = contentType,
    )
}

private fun ComposerAttachmentActionKind.defaultPromptAttachmentName(): String {
    return when (this) {
        ComposerAttachmentActionKind.Photo -> "android-photo.jpg"
        ComposerAttachmentActionKind.File -> "android-file"
    }
}

private fun String.inferPromptAttachmentContentType(kind: ComposerAttachmentActionKind): String {
    return when {
        kind == ComposerAttachmentActionKind.Photo -> "image/*"
        substringAfterLast('.', "").equals("txt", ignoreCase = true) -> "text/plain"
        substringAfterLast('.', "").equals("md", ignoreCase = true) -> "text/markdown"
        else -> "application/octet-stream"
    }
}

private fun Context.queryDisplayName(uri: Uri): String? {
    return contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) {
            null
        } else {
            val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index < 0) null else cursor.getString(index)
        }
    }?.takeIf { it.isNotBlank() }
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
