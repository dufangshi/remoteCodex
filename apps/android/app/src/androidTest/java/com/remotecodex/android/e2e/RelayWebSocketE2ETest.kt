package com.remotecodex.android.e2e

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class RelayWebSocketE2ETest {
    @Test
    fun relayDeviceWebSocketReturnsSupervisorPong() {
        val args = InstrumentationRegistry.getArguments()
        val relayBaseUrl = args.getString(ARG_RELAY_BASE_URL).orEmpty()
        val username = args.getString(ARG_RELAY_USERNAME).orEmpty()
        val password = args.getString(ARG_RELAY_PASSWORD).orEmpty()
        val deviceId = args.getString(ARG_RELAY_DEVICE_ID).orEmpty()

        assumeTrue(
            "Pass -e $ARG_RELAY_BASE_URL, -e $ARG_RELAY_USERNAME, -e $ARG_RELAY_PASSWORD, and -e $ARG_RELAY_DEVICE_ID to run the live relay websocket E2E test.",
            relayBaseUrl.isNotBlank() &&
                username.isNotBlank() &&
                password.isNotBlank() &&
                deviceId.isNotBlank(),
        )

        val anonymousClient = SupervisorApiClient(
            SupervisorConnectionConfig(
                mode = SupervisorConnectionMode.Relay,
                baseUrl = relayBaseUrl,
            ),
        )
        val login = anonymousClient.relayLogin(username, password)
        assertTrue(login.session.authenticated)

        val relayConfig = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Relay,
            baseUrl = relayBaseUrl,
            authToken = login.token,
            relayDeviceId = deviceId,
        )
        val portal = SupervisorApiClient(relayConfig).fetchRelayPortal()
        val device = portal.devices.singleOrNull { it.id == deviceId }
        assertTrue("Expected relay device $deviceId to be online", device?.connected == true)

        val opened = CountDownLatch(1)
        val pong = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>()
        val pongPayload = AtomicReference<JSONObject?>()
        val okHttpClient = OkHttpClient.Builder().build()
        val request = Request.Builder()
            .url(relayConfig.websocketUrl())
            .header("Authorization", "Bearer ${login.token}")
            .build()
        val socket = okHttpClient.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    opened.countDown()
                    webSocket.send(
                        JSONObject()
                            .put("type", "supervisor.ping")
                            .put("timestamp", "2026-06-11T00:00:00.000Z")
                            .toString(),
                    )
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val json = runCatching { JSONObject(text) }.getOrNull() ?: return
                    if (json.optString("type") == "supervisor.pong") {
                        pongPayload.set(json)
                        pong.countDown()
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    failure.set(t)
                    pong.countDown()
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = Unit
            },
        )

        try {
            assertTrue("Relay websocket did not open", opened.await(10, TimeUnit.SECONDS))
            assertTrue(
                "Timed out waiting for supervisor.pong. failure=${failure.get()?.message}",
                pong.await(30, TimeUnit.SECONDS),
            )
            failure.get()?.let { throw it }
            assertEquals("supervisor.pong", pongPayload.get()?.optString("type"))
        } finally {
            socket.close(1000, "Relay websocket E2E finished")
            okHttpClient.dispatcher.executorService.shutdown()
        }
    }

    companion object {
        const val ARG_RELAY_BASE_URL = "relayBaseUrl"
        const val ARG_RELAY_USERNAME = "relayUsername"
        const val ARG_RELAY_PASSWORD = "relayPassword"
        const val ARG_RELAY_DEVICE_ID = "relayDeviceId"
    }
}
