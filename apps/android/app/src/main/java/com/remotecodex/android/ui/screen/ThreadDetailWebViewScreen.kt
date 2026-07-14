package com.remotecodex.android.ui.screen

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.webkit.WebViewAssetLoader
import com.remotecodex.android.api.SupervisorFileDownload
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.settings.ThemeMode
import com.remotecodex.android.storage.saveExportToDownloads
import com.remotecodex.android.storage.shareSavedExport
import com.remotecodex.android.ui.components.GraphButton
import com.remotecodex.android.ui.components.GraphButtonSize
import com.remotecodex.android.ui.components.GraphButtonVariant
import com.remotecodex.android.ui.theme.ThreadColors
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.util.Locale
import kotlin.math.max

private const val ThreadWebHost = "appassets.androidplatform.net"
private const val ThreadWebPrefix = "/assets/thread-ui/"
private const val ThreadWebIndexUrl = "https://$ThreadWebHost${ThreadWebPrefix}index.html"
private const val ThreadWebLogTag = "RemoteCodexThreadWeb"

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun ThreadDetailWebViewScreen(
    connection: SupervisorConnectionConfig,
    threadId: String?,
    themeMode: ThemeMode,
    fixtureMode: Boolean,
    onOpenThread: (String) -> Unit,
    onOpenWorkspace: (String) -> Unit,
    onOpenDevices: () -> Unit,
    onCloseThread: () -> Unit = {},
    onNavigationTitle: (title: String, workspaceId: String?) -> Unit = { _, _ -> },
    onThemeModeSelected: (ThemeMode) -> Unit = {},
    onFatalError: (String) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var hostedWebView by remember { mutableStateOf<WebView?>(null) }
    var fileChooserCallback by remember { mutableStateOf<ValueCallback<Array<Uri>>?>(null) }
    var nativeFilePickRequestId by remember { mutableStateOf<String?>(null) }
    val coroutineScope = rememberCoroutineScope()
    val context = LocalContext.current
    val density = LocalDensity.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val httpClient = remember { OkHttpClient() }
    val fallbackStatusTopCssPx = remember(context, density) {
        context.androidSystemDimensionCssPx("status_bar_height", density)
    }
    val fallbackNavigationBottomCssPx = remember(context, density) {
        context.androidSystemDimensionCssPx("navigation_bar_height", density)
    }
    val navigationBottomCssPx = max(
        with(density) {
            WindowInsets.navigationBars.getBottom(this).toDp().value
        },
        fallbackNavigationBottomCssPx,
    )
    val imeBottomCssPx = with(density) {
        WindowInsets.ime.getBottom(this).toDp().value
    }
    val statusTopCssPx = max(
        with(density) {
            WindowInsets.statusBars.getTop(this).toDp().value
        },
        fallbackStatusTopCssPx,
    )
    val threadWebInsets = ThreadWebInsets(
        topCssPx = statusTopCssPx,
        bottomCssPx = max(navigationBottomCssPx, 0f),
        imeCssPx = max(imeBottomCssPx - navigationBottomCssPx, 0f),
    )
    val fileChooserLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val callback = fileChooserCallback
        fileChooserCallback = null
        if (callback == null) {
            return@rememberLauncherForActivityResult
        }
        val uris = WebChromeClient.FileChooserParams.parseResult(
            result.resultCode,
            result.data,
        )
        callback.onReceiveValue(
            if (result.resultCode == Activity.RESULT_OK) {
                uris ?: emptyArray()
            } else {
                null
            },
        )
    }
    val nativeFilePickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val requestId = nativeFilePickRequestId
        nativeFilePickRequestId = null
        if (requestId == null) {
            return@rememberLauncherForActivityResult
        }
        coroutineScope.launch {
            val responseJson = withContext(Dispatchers.IO) {
                buildNativeFilePickResponse(context, requestId, result)
            }
            hostedWebView?.post {
                hostedWebView?.evaluateJavascript(
                    "window.remoteCodexAndroidHost && window.remoteCodexAndroidHost.receiveNativeFilePickResult && window.remoteCodexAndroidHost.receiveNativeFilePickResult($responseJson);",
                    null,
                )
            }
        }
    }
	    val bootstrap = remember(connection, threadId, themeMode, fixtureMode) {
	        AndroidThreadWebBootstrap(
	            baseUrl = connection.normalizedBaseUrl,
	            mode = connection.mode.storageKey,
	            authToken = connection.authToken,
            relayDeviceId = connection.relayDeviceId,
            threadId = threadId,
            theme = themeMode.storageKey,
	            fixture = fixtureMode,
	        )
	    }
	    val webViewRouteKey = remember(connection, threadId, fixtureMode) {
	        listOf(
	            connection.mode.storageKey,
	            connection.normalizedBaseUrl,
	            connection.authToken.orEmpty(),
	            connection.relayDeviceId.orEmpty(),
	            threadId.orEmpty(),
	            fixtureMode.toString(),
	        ).joinToString("|")
	    }
	    LaunchedEffect(webViewRouteKey) {
	        errorMessage = null
	    }

	    Box(
	        modifier = modifier
	            .fillMaxSize()
	            .background(ThreadColors.Background),
	    ) {
	        key(webViewRouteKey) {
	            AndroidView(
	                modifier = Modifier.fillMaxSize(),
	                factory = { context ->
	                    val assetLoader = WebViewAssetLoader.Builder()
	                        .setDomain(ThreadWebHost)
	                        .addPathHandler(
	                            ThreadWebPrefix,
	                            ThreadWebPathHandler(context, bootstrap),
	                        )
	                        .build()
	                    val webView = WebView(context)
	                    webView.apply {
	                        WebView.setWebContentsDebuggingEnabled(true)
	                        settings.javaScriptEnabled = true
	                        settings.domStorageEnabled = true
	                        settings.databaseEnabled = true
	                        settings.cacheMode = WebSettings.LOAD_NO_CACHE
	                        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
	                        settings.allowFileAccess = false
	                        settings.allowContentAccess = true
	                        addJavascriptInterface(
	                            AndroidThreadWebBridge(
	                                onMessage = { Log.d(ThreadWebLogTag, it) },
	                                onOpenThread = onOpenThread,
	                                onOpenWorkspace = onOpenWorkspace,
	                                onOpenDevices = onOpenDevices,
	                                onCloseThread = onCloseThread,
	                                onNavigationTitle = onNavigationTitle,
	                                onShareDownloadedFile = { download ->
	                                    coroutineScope.launch {
	                                        val result = withContext(Dispatchers.IO) {
	                                            runCatching {
	                                                val bytes = Base64.decode(download.base64, Base64.DEFAULT)
	                                                val saved = context.saveExportToDownloads(
	                                                    SupervisorFileDownload(
	                                                        filename = download.filename,
	                                                        contentType = download.contentType,
	                                                        bytes = bytes,
	                                                    ),
	                                                )
	                                                saved
	                                            }
	                                        }
	                                        result
	                                            .onSuccess { saved ->
	                                                Log.d(
	                                                    ThreadWebLogTag,
	                                                    "shared download ${saved.filename} (${saved.sizeBytes} bytes)",
	                                                )
	                                                runCatching { context.shareSavedExport(saved) }
	                                                    .onFailure { shareError ->
	                                                        Log.w(
	                                                            ThreadWebLogTag,
	                                                            "download saved but share failed: ${shareError.message}",
	                                                        )
	                                                    }
	                                            }
	                                            .onFailure { caught ->
	                                                val message = caught.message ?: "Download sharing failed."
	                                                Log.w(ThreadWebLogTag, message, caught)
	                                                errorMessage = message
	                                                onFatalError(message)
	                                            }
	                                    }
	                                },
	                                onCopyText = { label, text ->
	                                    val clipboard = context.getSystemService(ClipboardManager::class.java)
	                                    clipboard?.setPrimaryClip(ClipData.newPlainText(label, text))
	                                    Log.d(ThreadWebLogTag, "copied text: $label")
	                                },
	                                onThemeMode = { theme ->
	                                    Log.d(ThreadWebLogTag, "theme requested: $theme")
	                                    onThemeModeSelected(ThemeMode.fromStorageKey(theme))
	                                },
	                                onNativeHttpRequest = { requestJson ->
	                                    Log.d(ThreadWebLogTag, "native HTTP requested")
	                                    coroutineScope.launch {
	                                        val responseJson = performNativeHttpRequest(
	                                            httpClient = httpClient,
	                                            requestJson = requestJson,
	                                        )
	                                        webView.post {
	                                            webView.evaluateJavascript(
	                                                "window.remoteCodexAndroidHost && window.remoteCodexAndroidHost.receiveNativeHttpResponse && window.remoteCodexAndroidHost.receiveNativeHttpResponse($responseJson);",
	                                                null,
	                                            )
	                                        }
	                                    }
	                                },
	                                onNativeFilePickRequest = { requestId ->
	                                    nativeFilePickRequestId = requestId
	                                    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
	                                        addCategory(Intent.CATEGORY_OPENABLE)
	                                        type = "*/*"
	                                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
	                                    }
	                                    runCatching { nativeFilePickerLauncher.launch(intent) }
	                                        .onFailure { caught ->
	                                            nativeFilePickRequestId = null
	                                            Log.w(
	                                                ThreadWebLogTag,
	                                                "Could not open native file picker: ${caught.message}",
	                                                caught,
	                                            )
	                                            val responseJson = JSONObject()
	                                                .put("requestId", requestId)
	                                                .put("error", caught.message ?: "Could not open file picker.")
	                                                .toString()
	                                            webView.post {
	                                                webView.evaluateJavascript(
	                                                    "window.remoteCodexAndroidHost && window.remoteCodexAndroidHost.receiveNativeFilePickResult && window.remoteCodexAndroidHost.receiveNativeFilePickResult($responseJson);",
	                                                    null,
	                                                )
	                                            }
	                                        }
	                                },
	                                onFatalError = {
	                                    errorMessage = it
	                                    onFatalError(it)
	                                },
	                            ),
	                            "remoteCodexAndroid",
	                        )
	                        webViewClient = object : WebViewClient() {
	                            override fun shouldInterceptRequest(
	                                view: WebView,
	                                request: WebResourceRequest,
	                            ): WebResourceResponse? {
	                                return assetLoader.shouldInterceptRequest(request.url)
	                            }
	
	                            @Deprecated("Deprecated in Android SDK")
	                            override fun shouldInterceptRequest(
	                                view: WebView,
	                                url: String,
	                            ): WebResourceResponse? {
	                                return assetLoader.shouldInterceptRequest(android.net.Uri.parse(url))
	                            }
	
	                            override fun onReceivedError(
	                                view: WebView,
	                                request: WebResourceRequest,
	                                error: android.webkit.WebResourceError,
	                            ) {
	                                Log.w(
	                                    ThreadWebLogTag,
	                                    "WebView resource error ${request.url}: ${error.description}",
	                                )
	                                if (request.isForMainFrame) {
	                                    errorMessage = error.description?.toString() ?: "Thread WebView failed."
	                                }
	                            }
	
	                            override fun onReceivedHttpError(
	                                view: WebView,
	                                request: WebResourceRequest,
	                                errorResponse: WebResourceResponse,
	                            ) {
	                                Log.w(
	                                    ThreadWebLogTag,
	                                    "WebView HTTP ${errorResponse.statusCode} for ${request.url}",
	                                )
	                            }
	
	                            override fun onPageFinished(view: WebView, url: String) {
	                                Log.d(ThreadWebLogTag, "WebView page loaded: $url")
                                    view.setThreadWebInsets(threadWebInsets)
	                            }
	                        }
	                        webChromeClient = object : WebChromeClient() {
	                            override fun onShowFileChooser(
	                                webView: WebView,
	                                filePathCallback: ValueCallback<Array<Uri>>,
	                                fileChooserParams: FileChooserParams,
	                            ): Boolean {
	                                fileChooserCallback?.onReceiveValue(null)
	                                fileChooserCallback = filePathCallback
	                                return runCatching {
	                                    fileChooserLauncher.launch(fileChooserParams.createIntent())
	                                    true
	                                }.getOrElse { caught ->
	                                    Log.w(ThreadWebLogTag, "Could not open file chooser: ${caught.message}", caught)
	                                    fileChooserCallback = null
	                                    filePathCallback.onReceiveValue(null)
	                                    false
	                                }
	                            }
	
	                            override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
	                                val level = consoleMessage.messageLevel()
	                                val message = consoleMessage.message()
	                                val source = consoleMessage.sourceId()
	                                val line = consoleMessage.lineNumber()
	                                if (level == ConsoleMessage.MessageLevel.ERROR) {
	                                    Log.e(ThreadWebLogTag, "console: $message ($source:$line)")
	                                } else {
	                                    Log.d(ThreadWebLogTag, "console: $message ($source:$line)")
	                                }
	                                return true
	                            }
	                        }
	                        hostedWebView = this
	                        loadUrl(ThreadWebIndexUrl)
	                    }
	                },
	                update = { webView ->
	                    webView.setThreadWebTheme(themeMode)
                        webView.setThreadWebInsets(threadWebInsets)
	                },
	                onRelease = { webView ->
	                    if (hostedWebView === webView) {
	                        hostedWebView = null
	                    }
	                    webView.setThreadWebSceneActive(false)
	                    webView.onPause()
	                    webView.stopLoading()
	                    webView.removeJavascriptInterface("remoteCodexAndroid")
	                    webView.destroy()
	                },
	            )
	        }

        val currentError = errorMessage
        if (currentError != null) {
            ThreadWebFatalOverlay(
                message = currentError,
                onRetry = {
                    errorMessage = null
                    hostedWebView?.apply {
                        stopLoading()
                        loadUrl(ThreadWebIndexUrl)
                    }
                },
                onReturnToWorkspace = onCloseThread,
                modifier = Modifier
                    .align(Alignment.Center)
                    .padding(24.dp),
            )
        }
    }

    DisposableEffect(lifecycleOwner, hostedWebView) {
        val webView = hostedWebView
        if (webView == null) {
            return@DisposableEffect onDispose { }
        }
        val observer = LifecycleEventObserver { _, event ->
            val active = when (event) {
                Lifecycle.Event.ON_RESUME -> true
                Lifecycle.Event.ON_PAUSE,
                Lifecycle.Event.ON_STOP,
                -> false
                else -> return@LifecycleEventObserver
            }
            if (active) {
                webView.onResume()
            } else {
                webView.onPause()
            }
            webView.setThreadWebSceneActive(active)
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            webView.setThreadWebSceneActive(false)
            webView.onPause()
        }
    }
}

private data class ThreadWebInsets(
    val topCssPx: Float,
    val bottomCssPx: Float,
    val imeCssPx: Float,
)

private fun Context.androidSystemDimensionCssPx(name: String, density: Density): Float {
    val resourceId = resources.getIdentifier(name, "dimen", "android")
    if (resourceId == 0) {
        return 0f
    }
    return with(density) {
        resources.getDimensionPixelSize(resourceId).toDp().value
    }
}

private fun Float.toCssPx(): String {
    if (this <= 0f) {
        return "0px"
    }
    return "${String.format(Locale.US, "%.1f", this)}px"
}

private fun WebView.setThreadWebInsets(insets: ThreadWebInsets) {
    evaluateJavascript(
        """
        (function() {
          var root = document.documentElement;
          root.style.setProperty('--android-safe-area-top', '${insets.topCssPx.toCssPx()}');
          root.style.setProperty('--android-safe-area-bottom', '${insets.bottomCssPx.toCssPx()}');
          root.style.setProperty('--android-ime-bottom', '${insets.imeCssPx.toCssPx()}');
          window.dispatchEvent(new Event('remote-codex-android-insets'));
        })();
        """.trimIndent(),
        null,
    )
}

private fun WebView.setThreadWebTheme(themeMode: ThemeMode) {
    evaluateJavascript(
        """
        window.remoteCodexAndroidTheme && window.remoteCodexAndroidTheme(${JSONObject.quote(themeMode.storageKey)});
        window.remoteCodexAndroidHost && window.remoteCodexAndroidHost.setTheme && window.remoteCodexAndroidHost.setTheme(${JSONObject.quote(themeMode.storageKey)});
        """.trimIndent(),
        null,
    )
}

private fun WebView.setThreadWebSceneActive(active: Boolean) {
    val script = if (active) {
        "window.remoteCodexAndroidHost && window.remoteCodexAndroidHost.resumeSceneActive && window.remoteCodexAndroidHost.resumeSceneActive();"
    } else {
        "window.remoteCodexAndroidHost && window.remoteCodexAndroidHost.setSceneActive && window.remoteCodexAndroidHost.setSceneActive(false);"
    }
    evaluateJavascript(
        script,
        null,
    )
}

internal sealed interface NativeHttpBridgeRequestParseResult {
    val requestId: String

    data class Valid(
        override val requestId: String,
        val url: String,
        val method: String,
        val headers: Map<String, String>,
        val bodyText: String?,
        val bodyBytes: ByteArray?,
    ) : NativeHttpBridgeRequestParseResult {
        override fun equals(other: Any?): Boolean {
            if (this === other) return true
            if (other !is Valid) return false
            val bodyBytesEqual = bodyBytes?.contentEquals(other.bodyBytes) ?: (other.bodyBytes == null)
            return requestId == other.requestId &&
                url == other.url &&
                method == other.method &&
                headers == other.headers &&
                bodyText == other.bodyText &&
                bodyBytesEqual
        }

        override fun hashCode(): Int {
            var result = requestId.hashCode()
            result = 31 * result + url.hashCode()
            result = 31 * result + method.hashCode()
            result = 31 * result + headers.hashCode()
            result = 31 * result + (bodyText?.hashCode() ?: 0)
            result = 31 * result + (bodyBytes?.contentHashCode() ?: 0)
            return result
        }
    }

    data class Invalid(
        override val requestId: String,
    ) : NativeHttpBridgeRequestParseResult
}

internal fun parseNativeHttpBridgeRequest(requestJson: String): NativeHttpBridgeRequestParseResult {
    val requestEnvelope = runCatching { JSONObject(requestJson) }.getOrNull()
    val requestId = requestEnvelope?.optString("requestId").orEmpty()
    if (requestEnvelope == null || requestId.isBlank()) {
        return NativeHttpBridgeRequestParseResult.Invalid(requestId)
    }
    val headersJson = requestEnvelope.optJSONObject("headers")
    val headers = buildMap {
        headersJson?.keys()?.forEach { key ->
            put(key, headersJson.optString(key))
        }
    }
    val bodyText = requestEnvelope.optString("body", "")
        .takeIf { !requestEnvelope.isNull("body") && it.isNotEmpty() }
    val bodyBytes = requestEnvelope.optString("bodyBase64", "")
        .takeIf { !requestEnvelope.isNull("bodyBase64") && it.isNotEmpty() }
        ?.let { encoded -> java.util.Base64.getDecoder().decode(encoded) }
    return NativeHttpBridgeRequestParseResult.Valid(
        requestId = requestId,
        url = requestEnvelope.getString("url"),
        method = requestEnvelope.optString("method", "GET").uppercase(),
        headers = headers,
        bodyText = bodyText,
        bodyBytes = bodyBytes,
    )
}

internal fun nativeHttpBridgeResponseJson(
    requestId: String,
    ok: Boolean,
    statusCode: Int,
    headers: Map<String, String> = emptyMap(),
    bodyBytes: ByteArray = ByteArray(0),
    error: String? = null,
): String {
    val responseHeaders = JSONObject()
    headers.forEach { (key, value) ->
        responseHeaders.put(key.lowercase(), value)
    }
    return JSONObject()
        .put("requestId", requestId)
        .put("ok", ok)
        .put("statusCode", statusCode)
        .put("headers", responseHeaders)
        .put("body", bodyBytes.toString(Charsets.UTF_8))
        .put("bodyBase64", java.util.Base64.getEncoder().encodeToString(bodyBytes))
        .put("error", error ?: JSONObject.NULL)
        .toString()
}

internal fun invalidNativeHttpBridgeResponseJson(requestId: String): String {
    return JSONObject()
        .put("requestId", requestId)
        .put("ok", false)
        .put("statusCode", 0)
        .put("error", "Invalid native HTTP request.")
        .toString()
}

@Composable
private fun ThreadWebFatalOverlay(
    message: String,
    onRetry: () -> Unit,
    onReturnToWorkspace: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(ThreadColors.Surface)
            .border(1.dp, ThreadColors.Border, RoundedCornerShape(18.dp))
            .padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = "Thread UI failed",
                color = ThreadColors.Foreground,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )
            Text(
                text = message,
                color = ThreadColors.ForegroundMuted,
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 5,
                overflow = TextOverflow.Ellipsis,
            )
        }
        androidx.compose.foundation.layout.Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            GraphButton(
                label = "Retry",
                variant = GraphButtonVariant.Default,
                size = GraphButtonSize.Default,
                contentDescription = "Retry thread WebView",
                onClick = onRetry,
            )
            GraphButton(
                label = "Workspace",
                variant = GraphButtonVariant.Secondary,
                size = GraphButtonSize.Default,
                contentDescription = "Return to workspace",
                onClick = onReturnToWorkspace,
            )
        }
    }
}

private suspend fun performNativeHttpRequest(
    httpClient: OkHttpClient,
    requestJson: String,
): String {
    val parsedRequest = runCatching { parseNativeHttpBridgeRequest(requestJson) }
        .getOrElse { caught ->
            val requestId = runCatching { JSONObject(requestJson).optString("requestId") }.getOrDefault("")
            return JSONObject()
                .put("requestId", requestId)
                .put("ok", false)
                .put("statusCode", 0)
                .put("error", caught.message ?: "Native HTTP request failed.")
                .toString()
        }
    val request = when (val parsed = parsedRequest) {
        is NativeHttpBridgeRequestParseResult.Invalid -> {
            return invalidNativeHttpBridgeResponseJson(parsed.requestId)
        }
        is NativeHttpBridgeRequestParseResult.Valid -> parsed
    }

    return withContext(Dispatchers.IO) {
        runCatching {
            val url = request.url
            val method = request.method
            Log.d(ThreadWebLogTag, "native HTTP $method $url")
            val builder = Request.Builder().url(url)
            request.headers.forEach { (key, value) ->
                builder.header(key, value)
            }
            val contentType = request.headers.entries
                .firstOrNull { it.key.equals("content-type", ignoreCase = true) }
                ?.value
                ?.takeIf { it.isNotBlank() }
                ?.toMediaTypeOrNull()
            val body = request.bodyBytes?.toRequestBody(contentType) ?: request.bodyText?.toRequestBody(contentType)
            when (method) {
                "GET" -> builder.get()
                "DELETE" -> if (body == null) builder.delete() else builder.delete(body)
                "POST", "PATCH", "PUT" -> builder.method(
                    method,
                    body ?: ByteArray(0).toRequestBody(contentType),
                )
                else -> builder.method(method, body)
            }
            httpClient.newCall(builder.build()).execute().use { response ->
                val responseBytes = response.body?.bytes() ?: ByteArray(0)
                Log.d(ThreadWebLogTag, "native HTTP ${response.code} $method $url")
                nativeHttpBridgeResponseJson(
                    requestId = request.requestId,
                    ok = response.isSuccessful,
                    statusCode = response.code,
                    headers = response.headers.associate { pair -> pair.first to pair.second },
                    bodyBytes = responseBytes,
                    error = if (response.isSuccessful) null else response.message,
                )
            }
        }.getOrElse { caught ->
            JSONObject()
                .put("requestId", request.requestId)
                .put("ok", false)
                .put("statusCode", 0)
                .put("error", caught.message ?: "Native HTTP request failed.")
                .toString()
        }
    }
}

private fun buildNativeFilePickResponse(
    context: Context,
    requestId: String,
    result: androidx.activity.result.ActivityResult,
): String {
    if (result.resultCode != Activity.RESULT_OK) {
        return JSONObject()
            .put("requestId", requestId)
            .put("cancelled", true)
            .toString()
    }
    val uri = result.data?.data
    if (uri == null) {
        return JSONObject()
            .put("requestId", requestId)
            .put("cancelled", true)
            .toString()
    }

    return runCatching {
        val flags = result.data?.flags ?: 0
        val takeFlags = flags and
            (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        if (takeFlags != 0) {
            runCatching { context.contentResolver.takePersistableUriPermission(uri, takeFlags) }
        }
        val filename = displayNameForUri(context, uri) ?: uri.lastPathSegment ?: "workspace-upload"
        val contentType = context.contentResolver.getType(uri) ?: "application/octet-stream"
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: ByteArray(0)
        JSONObject()
            .put("requestId", requestId)
            .put(
                "file",
                JSONObject()
                    .put("filename", filename)
                    .put("contentType", contentType)
                    .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP)),
            )
            .toString()
    }.getOrElse { caught ->
        JSONObject()
            .put("requestId", requestId)
            .put("error", caught.message ?: "Could not read selected file.")
            .toString()
    }
}

private fun displayNameForUri(context: Context, uri: Uri): String? {
    return context.contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME),
        null,
        null,
        null,
    )?.use { cursor ->
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0 && cursor.moveToFirst()) {
            cursor.getString(index)
        } else {
            null
        }
    }
}

private data class AndroidThreadWebBootstrap(
    val baseUrl: String,
    val mode: String,
    val authToken: String?,
    val relayDeviceId: String?,
    val threadId: String?,
    val theme: String,
    val fixture: Boolean,
) {
    fun toJson(): String {
        return JSONObject()
            .put("baseUrl", baseUrl)
            .put("mode", mode)
            .put("authToken", authToken)
            .put("relayDeviceId", relayDeviceId)
            .put("threadId", threadId)
            .put("theme", theme)
            .put("fixture", fixture)
            .toString()
    }
}

private class ThreadWebPathHandler(
    private val context: Context,
    private val bootstrap: AndroidThreadWebBootstrap,
) : WebViewAssetLoader.PathHandler {
    override fun handle(path: String): WebResourceResponse? {
        val assetPath = "thread-ui/${path.trimStart('/')}"
        return runCatching {
            val bytes = if (assetPath == "thread-ui/index.html") {
                injectBootstrap(context.assets.open(assetPath), bootstrap)
            } else {
                context.assets.open(assetPath).readBytes()
            }
            WebResourceResponse(
                mimeTypeFor(assetPath),
                "UTF-8",
                ByteArrayInputStream(bytes),
            )
        }.getOrNull()
    }

    private fun injectBootstrap(input: InputStream, bootstrap: AndroidThreadWebBootstrap): ByteArray {
        val html = input.bufferedReader().use { it.readText() }
        val script = """
            <script>
            window.__REMOTE_CODEX_ANDROID_BOOTSTRAP__ = ${bootstrap.toJson()};
            window.remoteCodexAndroidTheme = function(theme) {
              var effective = theme === 'light' ? 'light' : theme === 'dark' ? 'dark' : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
              document.documentElement.dataset.themeMode = theme || 'system';
              document.documentElement.dataset.themeEffective = effective;
            };
            </script>
        """.trimIndent()
        return html.replace("</head>", "$script</head>").toByteArray(Charsets.UTF_8)
    }

    private fun mimeTypeFor(path: String): String {
        return when {
            path.endsWith(".html") -> "text/html"
            path.endsWith(".js") -> "application/javascript"
            path.endsWith(".css") -> "text/css"
            path.endsWith(".json") -> "application/json"
            path.endsWith(".svg") -> "image/svg+xml"
            path.endsWith(".png") -> "image/png"
            path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
            path.endsWith(".wasm") -> "application/wasm"
            else -> "application/octet-stream"
        }
    }
}

private class AndroidThreadWebBridge(
    private val onMessage: (String) -> Unit,
    private val onOpenThread: (String) -> Unit,
    private val onOpenWorkspace: (String) -> Unit,
    private val onOpenDevices: () -> Unit,
    private val onCloseThread: () -> Unit,
    private val onNavigationTitle: (String, String?) -> Unit,
    private val onShareDownloadedFile: (AndroidDownloadedFileMessage) -> Unit,
    private val onCopyText: (String, String) -> Unit,
    private val onThemeMode: (String) -> Unit,
    private val onNativeHttpRequest: (String) -> Unit,
    private val onNativeFilePickRequest: (String) -> Unit,
    private val onFatalError: (String) -> Unit,
) {
    @JavascriptInterface
    fun postMessage(message: String) {
        val json = runCatching { JSONObject(message) }.getOrNull()
        when (json?.optString("type")) {
            "threadWebReady" -> onMessage("thread-web-ready:${json.optString("title")}")
            "threadWebDebug" -> onMessage(json.optString("message"))
            "openThread" -> json.optString("threadId").takeIf { it.isNotBlank() }?.let(onOpenThread)
            "openWorkspace" -> json.optString("workspaceId").takeIf { it.isNotBlank() }?.let(onOpenWorkspace)
            "openDevices" -> onOpenDevices()
            "closeThread" -> onCloseThread()
            "shareDownloadedFile" -> {
                val filename = json.optString("filename").takeIf { it.isNotBlank() }
                    ?: "workspace-download"
                val contentType = json.optString("contentType").takeIf { it.isNotBlank() }
                    ?: "application/octet-stream"
                val base64 = json.optString("base64").takeIf { it.isNotBlank() }
                    ?: return
                onShareDownloadedFile(
                    AndroidDownloadedFileMessage(
                        filename = filename,
                        contentType = contentType,
                        base64 = base64,
                    ),
                )
            }
            "copyText" -> {
                val text = json.optString("text").takeIf { it.isNotBlank() } ?: return
                val label = json.optString("label").takeIf { it.isNotBlank() }
                    ?: "Remote Codex"
                onCopyText(label, text)
            }
            "setNavigationTitle" -> {
                val title = json.optString("title")
                val workspaceId = json.optString("workspaceId").takeIf { it.isNotBlank() }
                onMessage("navigation:$title:${workspaceId.orEmpty()}")
                onNavigationTitle(title, workspaceId)
            }
            "setThemeMode" -> json.optString("theme").takeIf { it.isNotBlank() }?.let(onThemeMode)
            "reportFatalError" -> onFatalError(json.optString("message", "Thread WebView failed."))
            else -> onMessage(message)
        }
    }

    @JavascriptInterface
    fun requestJson(message: String) {
        onNativeHttpRequest(message)
    }

    @JavascriptInterface
    fun pickFile(message: String) {
        val json = runCatching { JSONObject(message) }.getOrNull()
        val requestId = json?.optString("requestId").orEmpty()
        if (requestId.isNotBlank()) {
            onNativeFilePickRequest(requestId)
        }
    }
}

private data class AndroidDownloadedFileMessage(
    val filename: String,
    val contentType: String,
    val base64: String,
)
