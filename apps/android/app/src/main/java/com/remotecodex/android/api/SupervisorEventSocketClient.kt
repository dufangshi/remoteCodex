package com.remotecodex.android.api

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.Closeable
import java.time.Instant

class SupervisorEventSocketClient(
    private val config: SupervisorConnectionConfig,
    private val okHttpClient: OkHttpClient = sharedEventSocketOkHttpClient,
) {
    fun threadEvents(
        onState: (SupervisorSocketState) -> Unit = {},
    ): Flow<SupervisorThreadEvent> = callbackFlow {
        val socket = connect(
            onThreadEvent = { event -> trySend(event) },
            onState = onState,
        )
        awaitClose { socket.close() }
    }

    fun connect(
        onThreadEvent: (SupervisorThreadEvent) -> Unit,
        onShellEvent: (SupervisorShellEvent) -> Unit = {},
        onState: (SupervisorSocketState) -> Unit = {},
    ): SupervisorSocketConnection {
        val requestBuilder = Request.Builder().url(config.websocketUrl())
        config.authToken?.takeIf { it.isNotBlank() }?.let { token ->
            requestBuilder.header("Authorization", "Bearer $token")
        }
        val listener = SupervisorEventSocketListener(
            onThreadEvent = onThreadEvent,
            onShellEvent = onShellEvent,
            onState = onState,
        )
        val socket = okHttpClient.newWebSocket(requestBuilder.build(), listener)
        return SupervisorSocketConnection(socket)
    }
}

class SupervisorSocketConnection internal constructor(
    private val socket: WebSocket,
) : Closeable {
    fun attachShell(shellId: String, cols: Int = 120, rows: Int = 32) {
        send(
            JSONObject()
                .put("type", "shell.attach")
                .put("shellId", shellId)
                .put("cols", cols)
                .put("rows", rows),
        )
    }

    fun sendShellInput(shellId: String, viewerId: String, data: String) {
        send(
            JSONObject()
                .put("type", "shell.input")
                .put("shellId", shellId)
                .put("viewerId", viewerId)
                .put("data", data),
        )
    }

    fun resizeShell(shellId: String, viewerId: String, cols: Int, rows: Int) {
        send(
            JSONObject()
                .put("type", "shell.resize")
                .put("shellId", shellId)
                .put("viewerId", viewerId)
                .put("cols", cols)
                .put("rows", rows),
        )
    }

    fun clearShell(shellId: String, viewerId: String) {
        send(
            JSONObject()
                .put("type", "shell.clear")
                .put("shellId", shellId)
                .put("viewerId", viewerId),
        )
    }

    private fun send(message: JSONObject) {
        message.put("timestamp", Instant.now().toString())
        socket.send(message.toString())
    }

    override fun close() {
            socket.close(1000, "Android thread detail closed")
    }
}

data class SupervisorThreadEvent(
    val type: String,
    val threadId: String,
    val timestamp: String?,
    val payload: JSONObject,
    val eventId: String? = null,
    val cursor: String? = null,
    val sequence: Long? = null,
)

data class SupervisorShellEvent(
    val type: String,
    val shellId: String,
    val threadId: String?,
    val timestamp: String?,
    val viewerId: String?,
    val data: String?,
    val replace: Boolean,
    val isCommandRunning: Boolean?,
    val message: String?,
)

enum class SupervisorSocketState {
    Connecting,
    Open,
    Closed,
    Failed,
}

internal fun parseSupervisorThreadEvent(rawMessage: String): SupervisorThreadEvent? {
    val json = runCatching { JSONObject(rawMessage) }.getOrNull() ?: return null
    val type = json.optString("type").takeIf { it.startsWith("thread.") } ?: return null
    val threadId = json.optString("threadId").takeIf { it.isNotBlank() } ?: return null
    val payload = json.optJSONObject("payload") ?: return null
    if (payload.length() == 0) {
        return null
    }
    return SupervisorThreadEvent(
        type = type,
        threadId = threadId,
        timestamp = json.optNullableString("timestamp"),
        payload = payload,
        eventId = json.optNullableString("eventId")
            ?: json.optNullableString("id"),
        cursor = json.optNullableString("cursor"),
        sequence = json.optNullableLong("sequence"),
    )
}

internal fun parseSupervisorShellEvent(rawMessage: String): SupervisorShellEvent? {
    val json = runCatching { JSONObject(rawMessage) }.getOrNull() ?: return null
    val type = json.optString("type").takeIf { it.startsWith("shell.") } ?: return null
    val shellId = json.optString("shellId").takeIf { it.isNotBlank() } ?: return null
    val payload = json.optJSONObject("payload") ?: return null
    if (payload.length() == 0) {
        return null
    }
    return SupervisorShellEvent(
        type = type,
        shellId = shellId,
        threadId = payload.optNullableString("threadId"),
        timestamp = json.optNullableString("timestamp"),
        viewerId = payload.optNullableString("viewerId"),
        data = payload.optNullableString("data"),
        replace = payload.optBoolean("replace", false),
        isCommandRunning = if (payload.has("isCommandRunning") && !payload.isNull("isCommandRunning")) {
            payload.optBoolean("isCommandRunning")
        } else {
            null
        },
        message = payload.optNullableString("message"),
    )
}

private class SupervisorEventSocketListener(
    private val onThreadEvent: (SupervisorThreadEvent) -> Unit,
    private val onShellEvent: (SupervisorShellEvent) -> Unit,
    private val onState: (SupervisorSocketState) -> Unit,
) : WebSocketListener() {
    init {
        onState(SupervisorSocketState.Connecting)
    }

    override fun onOpen(webSocket: WebSocket, response: Response) {
        onState(SupervisorSocketState.Open)
    }

    override fun onMessage(webSocket: WebSocket, text: String) {
        parseSupervisorThreadEvent(text)?.let(onThreadEvent)
        parseSupervisorShellEvent(text)?.let(onShellEvent)
    }

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
        onState(SupervisorSocketState.Closed)
        webSocket.close(code, reason)
    }

    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
        onState(SupervisorSocketState.Closed)
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
        onState(SupervisorSocketState.Failed)
    }
}

private val sharedEventSocketOkHttpClient = OkHttpClient.Builder().build()

private fun JSONObject.optNullableString(name: String): String? {
    return if (has(name) && !isNull(name)) optString(name) else null
}

private fun JSONObject.optNullableLong(name: String): Long? {
    return if (has(name) && !isNull(name)) optLong(name) else null
}
