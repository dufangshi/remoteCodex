package com.remotecodex.android.e2e

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.remotecodex.android.MainActivity
import com.remotecodex.android.api.SupervisorConnectionConfig
import com.remotecodex.android.api.SupervisorConnectionMode
import com.remotecodex.android.settings.AppSettingsRepository
import com.remotecodex.android.settings.SavedAppRoute
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MobileProviderSettingsE2ETest {
    @Test
    fun localThreadWebViewLoadsProviderManagementSettings() {
        val args = InstrumentationRegistry.getArguments()
        val threadId = args.getString(ARG_THREAD_ID).orEmpty()
        assertTrue("Pass -e $ARG_THREAD_ID with a real local Codex thread.", threadId.isNotBlank())

        val config = SupervisorConnectionConfig(
            mode = SupervisorConnectionMode.Local,
            baseUrl = args.getString(ARG_LOCAL_BASE_URL).orEmpty().ifBlank { "http://10.0.2.2:8797" },
        )
        AppSettingsRepository(InstrumentationRegistry.getInstrumentation().targetContext).apply {
            writeSupervisorConnection(config)
            writeLastRoute(config, SavedAppRoute.ThreadDetail(threadId))
        }

        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForJavaScript(scenario, 20_000) {
                "Boolean(document.querySelector('button[aria-label=\"Open settings\"]'))"
            }
            assertTrue(
                evaluateJavaScript(
                    scenario,
                    "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === 'Open settings'); button?.click(); return Boolean(button); })()",
                ).contains("true"),
            )
            waitForJavaScript(scenario, 10_000) {
                "[...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === 'Global')"
            }
            assertTrue(
                evaluateJavaScript(
                    scenario,
                    "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Global'); button?.click(); return Boolean(button); })()",
                ).contains("true"),
            )
            waitForJavaScript(scenario, 15_000) {
                "['Runtime controls','Host configuration','Config archives','config.toml'].every((text) => document.body.innerText.includes(text))"
            }
        }
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
        const val ARG_LOCAL_BASE_URL = "localBaseUrl"
        const val ARG_THREAD_ID = "threadId"
    }
}
