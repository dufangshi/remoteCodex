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
        onState: (SupervisorSocketState) -> Unit = {},
    ): Closeable {
        val requestBuilder = Request.Builder().url(config.websocketUrl())
        config.authToken?.takeIf { it.isNotBlank() }?.let { token ->
            requestBuilder.header("Authorization", "Bearer $token")
        }
        val listener = SupervisorEventSocketListener(
            onThreadEvent = onThreadEvent,
            onState = onState,
        )
        val socket = okHttpClient.newWebSocket(requestBuilder.build(), listener)
        return Closeable {
            socket.close(1000, "Android thread detail closed")
        }
    }
}

data class SupervisorThreadEvent(
    val type: String,
    val threadId: String,
    val timestamp: String?,
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
    )
}

private class SupervisorEventSocketListener(
    private val onThreadEvent: (SupervisorThreadEvent) -> Unit,
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
