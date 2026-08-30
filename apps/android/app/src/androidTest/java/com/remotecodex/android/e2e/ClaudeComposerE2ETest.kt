package com.remotecodex.android.e2e

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.remotecodex.android.MainActivity
import com.remotecodex.android.api.StartSupervisorThreadRequest
import com.remotecodex.android.api.SupervisorApiClient
import com.remotecodex.android.api.SupervisorClientError
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.settings.AppSettingsRepository
import com.remotecodex.android.settings.SavedAppRoute
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ClaudeComposerE2ETest {
    @Test
    fun realClaudePromptSubmittedFromWebViewCompletes() {
        val args = InstrumentationRegistry.getArguments()
        val baseUrl = args.getString(ARG_LOCAL_BASE_URL).orEmpty()
            .ifBlank { "http://10.0.2.2:8800" }
        val workspacePath = args.getString(ARG_WORKSPACE_PATH).orEmpty()
            .ifBlank { "/Users/mac/dev/remoteCodex-mobile-parity" }
        val config = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Local,
            baseUrl = baseUrl,
        )
        val client = SupervisorApiClient(config)
        val workspace = client.createWorkspaceOrFindExisting(
            com.remotecodex.android.api.CreateSupervisorWorkspaceRequest(
                absPath = workspacePath,
                label = "Android Claude E2E",
            ),
        )
        val thread = client.startThread(
            StartSupervisorThreadRequest(
                workspaceId = workspace.id,
                title = "Android Claude E2E ${UUID.randomUUID().toString().take(8)}",
                provider = "claude",
                model = "haiku",
                approvalMode = "yolo",
            ),
        )
        AppSettingsRepository(InstrumentationRegistry.getInstrumentation().targetContext).apply {
            writeSupervisorConnection(config)
            writeLastRoute(config, SavedAppRoute.ThreadDetail(thread.id, workspace.id))
        }

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForJavaScript(scenario, 20_000) {
                "Boolean(document.querySelector('[role=\"textbox\"][aria-label=\"Prompt\"]'))"
            }
            val submitted = evaluateJavaScript(
                scenario,
                """
                (() => {
                  const input = document.querySelector('[role="textbox"][aria-label="Prompt"]');
                  const send = document.querySelector('button[aria-label="Send Prompt"]');
                  if (!input || !send) return false;
                  const prompt = 'Reply with exactly: $SENTINEL';
                  input.textContent = prompt;
                  input.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertText',
                    data: prompt,
                  }));
                  return true;
                })()
                """.trimIndent(),
            )
            assertTrue("Claude prompt was not entered into the WebView composer.", submitted.contains("true"))
            waitForJavaScript(scenario, 10_000) {
                "!document.querySelector('button[aria-label=\"Send Prompt\"]')?.disabled"
            }
            assertTrue(
                evaluateJavaScript(
                    scenario,
                    "(() => { const button = document.querySelector('button[aria-label=\"Send Prompt\"]'); button?.click(); return Boolean(button); })()",
                ).contains("true"),
            )

            val reply = waitForAgentReply(client, thread.id)
            assertEquals(SENTINEL, reply.trim())
            waitForThreadIdle(client, thread.id)
            waitForJavaScript(scenario, 20_000) {
                "document.body.innerText.includes('$SENTINEL')"
            }
        }
    }

    private fun waitForAgentReply(
        client: SupervisorApiClient,
        threadId: String,
    ): String {
        val deadline = System.currentTimeMillis() + 120_000
        var lastReply = ""
        while (System.currentTimeMillis() < deadline) {
            val detail = client.fetchThreadDetail(threadId, limit = 30)
            lastReply = detail.latestAgentMessage.orEmpty()
            if (lastReply.trim() == SENTINEL) return lastReply
            Thread.sleep(500)
        }
        throw AssertionError("Timed out waiting for $SENTINEL. Last reply=$lastReply")
    }

    private fun waitForThreadIdle(
        client: SupervisorApiClient,
        threadId: String,
    ) {
        val deadline = System.currentTimeMillis() + 30_000
        var lastStatus = "unknown"
        while (System.currentTimeMillis() < deadline) {
            lastStatus = client.fetchThreadDetail(threadId, limit = 30).thread.status
            if (lastStatus == "idle") return
            Thread.sleep(250)
        }
        throw AssertionError("Timed out waiting for thread idle. Last status=$lastStatus")
    }

    private fun waitForJavaScript(
        scenario: ActivityScenario<MainActivity>,
        timeoutMillis: Long,
        script: () -> String,
    ) {
        val deadline = System.currentTimeMillis() + timeoutMillis
        var lastResult = ""
        while (System.currentTimeMillis() < deadline) {
            lastResult = evaluateJavaScript(scenario, script())
            if (lastResult.contains("true")) return
            Thread.sleep(200)
        }
        throw AssertionError("Timed out waiting for WebView condition. Last result=$lastResult")
    }

    private fun evaluateJavaScript(
        scenario: ActivityScenario<MainActivity>,
        script: String,
    ): String {
        val completed = CountDownLatch(1)
        val result = AtomicReference("")
        scenario.onActivity { activity ->
            val webView = findWebView(activity.window.decorView)
            if (webView == null) {
                completed.countDown()
            } else {
                webView.evaluateJavascript(script) { value ->
                    result.set(value.orEmpty())
                    completed.countDown()
                }
            }
        }
        assertTrue("WebView JavaScript did not complete.", completed.await(5, TimeUnit.SECONDS))
        return result.get()
    }

    private fun findWebView(view: View): WebView? {
        if (view is WebView) return view
        if (view !is ViewGroup) return null
        for (index in 0 until view.childCount) {
            findWebView(view.getChildAt(index))?.let { return it }
        }
        return null
    }

    companion object {
        const val ARG_LOCAL_BASE_URL = "realLocalBaseUrl"
        const val ARG_WORKSPACE_PATH = "workspacePath"
        const val SENTINEL = "ANDROID_CLAUDE_FINAL_OK"
    }
}

private fun SupervisorApiClient.createWorkspaceOrFindExisting(
    request: com.remotecodex.android.api.CreateSupervisorWorkspaceRequest,
): SupervisorWorkspaceSummary {
    return try {
        createWorkspace(request)
    } catch (error: SupervisorClientError.Http) {
        if (error.statusCode != 409) throw error
        listWorkspaces().singleOrNull { workspace -> workspace.absPath == request.absPath }
            ?: throw error
    }
}
