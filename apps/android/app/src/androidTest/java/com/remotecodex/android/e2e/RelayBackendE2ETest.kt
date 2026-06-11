package com.remotecodex.android.e2e

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.remotecodex.android.api.CreateSupervisorWorkspaceRequest
import com.remotecodex.android.api.SendThreadPromptRequest
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorClientError
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.api.StartSupervisorThreadRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class RelayBackendE2ETest {
    @Test
    fun androidClientCanPairOpenWorkspaceStartSessionAndReceiveCodexReply() {
        val args = InstrumentationRegistry.getArguments()
        val relayBaseUrl = args.getString(ARG_RELAY_BASE_URL).orEmpty()
        val username = args.getString(ARG_RELAY_USERNAME).orEmpty()
        val password = args.getString(ARG_RELAY_PASSWORD).orEmpty()
        val deviceId = args.getString(ARG_RELAY_DEVICE_ID).orEmpty()
        val workspacePath = args.getString(ARG_WORKSPACE_PATH).orEmpty()
        val model = args.getString(ARG_MODEL).orEmpty().ifBlank { "gpt-5" }
        val expectedReply = args.getString(ARG_EXPECTED_REPLY).orEmpty()
            .ifBlank { "android relay e2e ok" }

        assumeTrue(
            "Pass -e $ARG_RELAY_BASE_URL, -e $ARG_RELAY_USERNAME, -e $ARG_RELAY_PASSWORD, -e $ARG_RELAY_DEVICE_ID, and -e $ARG_WORKSPACE_PATH to run the live relay E2E test.",
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
        assertEquals(username, login.session.user?.username)

        val relayConfig = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Relay,
            baseUrl = relayBaseUrl,
            authToken = login.token,
            relayDeviceId = deviceId,
        )
        val relayClient = SupervisorApiClient(relayConfig)

        val portal = relayClient.fetchRelayPortal()
        val device = portal.devices.singleOrNull { it.id == deviceId }
        assertNotNull("Expected relay portal to list device $deviceId", device)
        assertTrue("Expected relay device to be online before reading backend APIs", device!!.connected)
        assertNotNull("Expected connected device to expose a heartbeat timestamp", device.lastHeartbeatAt ?: device.connectedAt)

        val check = relayClient.checkConnection()
        assertTrue(check.authenticated)
        assertEquals("Relay connected", check.healthLabel)
        assertTrue(check.websocketUrl.contains("/relay/devices/$deviceId/ws"))
        assertTrue(check.websocketUrl.contains("token="))

        val workspace = relayClient.createWorkspaceOrFindExisting(
            CreateSupervisorWorkspaceRequest(
                absPath = workspacePath,
                label = "Android relay E2E",
            ),
        )
        assertEquals(workspacePath, workspace.absPath)

        val thread = relayClient.startThread(
            StartSupervisorThreadRequest(
                workspaceId = workspace.id,
                title = "Android relay E2E",
                model = model,
                approvalMode = "yolo",
            ),
        )
        assertEquals(workspace.id, thread.workspaceId)
        assertNotEquals("", thread.id)

        relayClient.sendThreadPrompt(
            thread.id,
            SendThreadPromptRequest(
                prompt = "Reply with exactly: $expectedReply",
            ),
        )

        val reply = waitForAgentReply(
            client = relayClient,
            threadId = thread.id,
            expectedReply = expectedReply,
        )
        assertEquals(expectedReply, reply.trim())
    }

    companion object {
        const val ARG_RELAY_BASE_URL = "relayBaseUrl"
        const val ARG_RELAY_USERNAME = "relayUsername"
        const val ARG_RELAY_PASSWORD = "relayPassword"
        const val ARG_RELAY_DEVICE_ID = "relayDeviceId"
        const val ARG_WORKSPACE_PATH = "workspacePath"
        const val ARG_MODEL = "model"
        const val ARG_EXPECTED_REPLY = "expectedReply"
        const val REPLY_TIMEOUT_MS = 180_000L
        const val REPLY_POLL_MS = 2_000L
    }
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

private fun waitForAgentReply(
    client: SupervisorApiClient,
    threadId: String,
    expectedReply: String,
): String {
    val deadline = System.currentTimeMillis() + RelayBackendE2ETest.REPLY_TIMEOUT_MS
    var lastStatus = "unknown"
    var lastReply: String? = null
    while (System.currentTimeMillis() < deadline) {
        val detail = client.fetchThreadDetail(threadId, limit = 20)
        lastStatus = detail.thread.status
        lastReply = detail.latestAgentMessage
        if (lastReply?.trim() == expectedReply) {
            return lastReply
        }
        Thread.sleep(RelayBackendE2ETest.REPLY_POLL_MS)
    }
    throw AssertionError(
        "Timed out waiting for Codex reply '$expectedReply'. Last status=$lastStatus, lastReply=${lastReply ?: "<none>"}",
    )
}
