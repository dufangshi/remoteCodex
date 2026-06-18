package com.remotecodex.android.e2e

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.remotecodex.android.api.CreateSupervisorWorkspaceRequest
import com.remotecodex.android.api.SendThreadPromptRequest
import com.remotecodex.android.api.StartSupervisorThreadRequest
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorClientError
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.api.SupervisorEventSocketClient
import com.remotecodex.android.api.SupervisorSocketState
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.thread.ThreadProjectionState
import com.remotecodex.android.thread.reconcileWithDetail
import com.remotecodex.android.thread.reduceThreadEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class RelayStreamingProjectionE2ETest {
    @Test
    fun relayStreamingProjectionSurvivesStaleRestRefreshesUntilCodexReplyCompletes() {
        val args = InstrumentationRegistry.getArguments()
        val relayBaseUrl = args.getString(ARG_RELAY_BASE_URL).orEmpty()
        val username = args.getString(ARG_RELAY_USERNAME).orEmpty()
        val password = args.getString(ARG_RELAY_PASSWORD).orEmpty()
        val deviceId = args.getString(ARG_RELAY_DEVICE_ID).orEmpty()
        val workspacePath = args.getString(ARG_WORKSPACE_PATH).orEmpty()
        val model = args.getString(ARG_MODEL).orEmpty().ifBlank { "gpt-5" }
        val marker = args.getString(ARG_EXPECTED_MARKER).orEmpty().ifBlank { "ANDROID_STREAM_STABLE_OK" }

        assumeTrue(
            "Pass relayBaseUrl, relayUsername, relayPassword, relayDeviceId, and workspacePath to run live relay streaming E2E.",
            relayBaseUrl.isNotBlank() &&
                username.isNotBlank() &&
                password.isNotBlank() &&
                deviceId.isNotBlank() &&
                workspacePath.isNotBlank(),
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
        val relayClient = SupervisorApiClient(relayConfig)
        val device = relayClient.fetchRelayPortal().devices.singleOrNull { it.id == deviceId }
        assertTrue("Expected relay device $deviceId to be online", device?.connected == true)

        val workspace = relayClient.createWorkspaceOrFindExisting(
            CreateSupervisorWorkspaceRequest(
                absPath = workspacePath,
                label = "Android relay streaming E2E",
            ),
        )
        val thread = relayClient.startThread(
            StartSupervisorThreadRequest(
                workspaceId = workspace.id,
                title = "Android relay streaming E2E",
                model = model,
                approvalMode = "yolo",
            ),
        )
        assertNotEquals("", thread.id)

        val projection = AtomicReference(ThreadProjectionState(relayClient.fetchThreadDetail(thread.id, limit = 30)))
        val socketOpen = CountDownLatch(1)
        val sawDelta = CountDownLatch(1)
        val completed = CountDownLatch(1)
        val failure = AtomicReference<Throwable?>()
        val deltaCount = AtomicInteger(0)
        val erasedAfterDelta = AtomicBoolean(false)

        val socket = SupervisorEventSocketClient(relayConfig).connect(
            onThreadEvent = { event ->
                if (event.threadId != thread.id) {
                    return@connect
                }
                try {
                    val reduced = reduceThreadEvent(projection.get(), event)
                    projection.set(reduced.state)
                    if (event.type == "thread.output.delta") {
                        deltaCount.incrementAndGet()
                        sawDelta.countDown()
                    }
                    if (event.type == "thread.turn.completed" || event.type == "thread.turn.failed") {
                        completed.countDown()
                    }

                    if (deltaCount.get() > 0) {
                        val beforeRefreshText = projection.get().latestAgentText()
                        val refreshed = relayClient.fetchThreadDetail(thread.id, limit = 30)
                        projection.set(projection.get().reconcileWithDetail(refreshed))
                        val afterRefreshText = projection.get().latestAgentText()
                        if (beforeRefreshText.isNotBlank() && afterRefreshText.isBlank()) {
                            erasedAfterDelta.set(true)
                        }
                    }
                } catch (throwable: Throwable) {
                    failure.set(throwable)
                    sawDelta.countDown()
                    completed.countDown()
                }
            },
            onState = { state ->
                if (state == SupervisorSocketState.Open) {
                    socketOpen.countDown()
                }
            },
        )

        try {
            assertTrue("Relay websocket did not open", socketOpen.await(15, TimeUnit.SECONDS))
            relayClient.sendThreadPrompt(
                thread.id,
                SendThreadPromptRequest(
                    prompt = "请做一个多步检查：先查看当前 workspace 的文件结构，再总结用途，最后用三条 bullet 回复，并包含短语 $marker。",
                ),
            )
            assertTrue("No thread.output.delta arrived through relay", sawDelta.await(90, TimeUnit.SECONDS))
            failure.get()?.let { throw it }
            assertTrue("Streaming projection was erased by a REST refresh", !erasedAfterDelta.get())
            assertTrue("Thread did not complete after streaming started", completed.await(180, TimeUnit.SECONDS))
            failure.get()?.let { throw it }

            val finalDetail = relayClient.fetchThreadDetail(thread.id, limit = 30)
            projection.set(projection.get().reconcileWithDetail(finalDetail))
            val finalText = projection.get().latestAgentText()
            assertTrue("Expected final reply to contain $marker, got: $finalText", finalText.contains(marker))
            assertTrue("Expected at least one streamed delta", deltaCount.get() > 0)
            assertEquals(false, erasedAfterDelta.get())
        } finally {
            socket.close()
        }
    }

    companion object {
        const val ARG_RELAY_BASE_URL = "relayBaseUrl"
        const val ARG_RELAY_USERNAME = "relayUsername"
        const val ARG_RELAY_PASSWORD = "relayPassword"
        const val ARG_RELAY_DEVICE_ID = "relayDeviceId"
        const val ARG_WORKSPACE_PATH = "workspacePath"
        const val ARG_MODEL = "model"
        const val ARG_EXPECTED_MARKER = "expectedMarker"
    }
}

private fun ThreadProjectionState.latestAgentText(): String {
    return detail.turns
        .asReversed()
        .flatMap { turn -> turn.items.asReversed() }
        .firstOrNull { item -> item.kind == "agentMessage" && item.text.isNotBlank() }
        ?.text
        .orEmpty()
}

private fun SupervisorApiClient.createWorkspaceOrFindExisting(
    request: CreateSupervisorWorkspaceRequest,
): SupervisorWorkspaceSummary {
    return try {
        createWorkspace(request)
    } catch (error: SupervisorClientError.Http) {
        if (error.statusCode != 409) {
            throw error
        }
        listWorkspaces().singleOrNull { workspace -> workspace.absPath == request.absPath }
            ?: throw error
    }
}
