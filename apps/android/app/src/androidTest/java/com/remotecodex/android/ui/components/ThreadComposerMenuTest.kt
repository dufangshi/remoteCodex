package com.remotecodex.android.ui.components

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Ignore
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@Ignore("Legacy native composer is a debug-only fallback; production composer coverage lives in shared thread-ui/WebView E2E.")
class ThreadComposerMenuTest {
    private lateinit var device: UiDevice

    @Before
    fun launchApp() {
        device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val context = ApplicationProvider.getApplicationContext<Context>()
        val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            ?: error("Missing launch intent for ${context.packageName}")
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TASK)
        context.startActivity(intent)
        assertNotNull(
            "Remote Codex app did not launch",
            device.wait(Until.hasObject(By.pkg(context.packageName).depth(0)), 5_000),
        )
    }

    @Test
    fun modelMenuOpensWithContextAndOptions() {
        val modelButton = device.wait(Until.findObject(By.desc("gpt-5.4")), 5_000)
            ?: error("Model toolbar button was not visible")
        modelButton.click()

        assertNotNull(device.wait(Until.findObject(By.text("Model")), 2_000))
        assertNotNull(device.findObject(By.text("Runtime preference")))
        assertNotNull(device.findObject(By.text("Context window")))
        assertNotNull(device.findObject(By.text("85.2k left")))
        assertNotNull(device.findObject(By.text("85.2k left · 67% context left")))
        assertNotNull(device.findObject(By.text("gpt-5.5")))
        assertNotNull(device.findObject(By.text("gpt-5-codex")))
        assertNotNull(device.findObject(By.text("gpt-5")))
        assertNotNull(device.findObject(By.desc("gpt-5.4 selected")))
        assertNotNull(device.findObject(By.desc("gpt-5-codex available")))
    }

    @Test
    fun modelMenuSelectionUpdatesPreviewModelAndDefaultEffort() {
        val modelButton = device.wait(Until.findObject(By.desc("gpt-5.4")), 5_000)
            ?: error("Model toolbar button was not visible")
        modelButton.click()
        assertNotNull(device.wait(Until.findObject(By.desc("gpt-5-codex available")), 2_000))

        device.findObject(By.desc("gpt-5-codex available")).click()

        assertNotNull(device.wait(Until.findObject(By.desc("gpt-5-codex")), 2_000))
        assertNotNull(device.findObject(By.desc("High")))
        assertTrue(
            "Model menu should close after local preview selection",
            device.findObjects(By.text("Runtime preference")).isEmpty(),
        )

        device.findObject(By.desc("gpt-5-codex")).click()
        assertNotNull(device.wait(Until.findObject(By.desc("gpt-5-codex selected")), 2_000))
        assertNotNull(device.findObject(By.desc("gpt-5.4 available")))
    }

    @Test
    fun effortMenuOpensWithBudgetPreviewAndOptions() {
        val effortButton = device.wait(Until.findObject(By.desc("Medium")), 5_000)
            ?: error("Effort toolbar button was not visible")
        effortButton.click()

        assertNotNull(device.wait(Until.findObject(By.text("Reasoning effort")), 2_000))
        assertNotNull(device.findObject(By.text("Per-thread setting")))
        assertNotNull(device.findObject(By.text("Effort budget")))
        assertNotNull(device.findObject(By.text("Select reasoning effort")))
        assertNotNull(device.findObject(By.text("High")))
        assertNotNull(device.findObject(By.text("XHigh")))
        assertNotNull(device.findObject(By.desc("Medium selected")))
        assertNotNull(device.findObject(By.desc("High available")))
        assertNotNull(device.findObject(By.desc("XHigh available")))
    }

    @Test
    fun effortMenuSelectionUpdatesPreviewEffort() {
        val effortButton = device.wait(Until.findObject(By.desc("Medium")), 5_000)
            ?: error("Effort toolbar button was not visible")
        effortButton.click()
        assertNotNull(device.wait(Until.findObject(By.desc("Low available")), 2_000))

        device.findObject(By.desc("Low available")).click()

        assertNotNull(device.wait(Until.findObject(By.desc("Low")), 2_000))
        assertTrue(
            "Effort menu should close after local preview selection",
            device.findObjects(By.text("Per-thread setting")).isEmpty(),
        )

        device.findObject(By.desc("Low")).click()
        assertNotNull(device.wait(Until.findObject(By.desc("Low selected")), 2_000))
        assertNotNull(device.findObject(By.desc("Medium available")))
    }

    @Test
    fun attachmentMenuAddsPreviewPhotoAttachment() {
        val attachmentButton = device.wait(Until.findObject(By.desc("Add attachment")), 5_000)
            ?: error("Attachment toolbar button was not visible")
        attachmentButton.click()

        assertNotNull(device.wait(Until.findObject(By.text("Add attachment")), 2_000))
        assertNotNull(device.findObject(By.text("2 actions · 2 queued attachments")))

        device.findObject(By.text("Photo")).click()

        assertNotNull(device.wait(Until.findObject(By.text("3 files")), 2_000))
        assertNotNull(device.findObject(By.text("android-preview.png")))
        assertTrue(
            "Attachment menu should close after local preview photo insertion",
            device.findObjects(By.text("2 actions · 2 queued attachments")).isEmpty(),
        )
    }

    @Test
    fun attachmentMenuAddsPreviewFileAttachment() {
        val attachmentButton = device.wait(Until.findObject(By.desc("Add attachment")), 5_000)
            ?: error("Attachment toolbar button was not visible")
        attachmentButton.click()
        assertNotNull(device.wait(Until.findObject(By.text("File")), 2_000))

        device.findObject(By.text("File")).click()

        assertNotNull(device.wait(Until.findObject(By.text("3 files")), 2_000))
        assertNotNull(device.findObject(By.text("android-client-notes.txt")))
    }

    @Test
    fun slashToolboxOpensWithRootActionsAndStatuses() {
        val slashButton = device.wait(Until.findObject(By.desc("Open slash toolbox")), 5_000)
            ?: error("Slash toolbox button was not visible")
        slashButton.click()

        assertNotNull(device.wait(Until.findObject(By.text("Slash toolbox")), 2_000))
        assertNotNull(device.findObject(By.text("Thread actions")))
        assertNotNull(device.findObject(By.text("/fast")))
        assertNotNull(device.findObject(By.text("Off")))
        assertNotNull(device.findObject(By.desc("Fast mode")))
        assertNotNull(device.findObject(By.desc("Compact thread")))
        assertNotNull(device.findObject(By.text("/goal")))
        assertNotNull(device.findObject(By.text("Active")))
        assertNotNull(device.findObject(By.desc("Goal")))
        assertNotNull(device.findObject(By.text("/skills")))
        assertNotNull(device.findObject(By.desc("Skills")))
        assertTrue(
            "Default preview should render backend toolbox rows instead of the empty state",
            device.findObjects(By.text("No backend tools are available for this thread.")).isEmpty(),
        )
    }

    @Test
    fun slashToolboxRoutesToSkillsPanel() {
        val slashButton = device.wait(Until.findObject(By.desc("Open slash toolbox")), 5_000)
            ?: error("Slash toolbox button was not visible")
        slashButton.click()
        assertNotNull(device.wait(Until.findObject(By.text("/skills")), 2_000))

        device.findObject(By.desc("Skills")).click()

        assertNotNull(device.wait(Until.findObject(By.text("/skills")), 2_000))
        assertNotNull(device.findObject(By.text("Open")))
        assertNotNull(device.findObject(By.text("Inspect skills and copy invocation names.")))
        assertNotNull(device.findObject(By.text("Android Client Work")))
        assertNotNull(device.findObject(By.text("OpenAI Docs")))
        assertNotNull(device.findObject(By.text("Skill metadata incomplete")))
    }

    @Test
    fun slashToolboxRoutesToMcpPanel() {
        val slashButton = device.wait(Until.findObject(By.desc("Open slash toolbox")), 5_000)
            ?: error("Slash toolbox button was not visible")
        slashButton.click()
        assertNotNull(device.wait(Until.findObject(By.text("/mcp")), 2_000))

        device.findObject(By.desc("MCP")).click()

        assertNotNull(device.wait(Until.findObject(By.text("/mcp")), 2_000))
        assertNotNull(device.findObject(By.text("Add MCP")))
        assertNotNull(device.findObject(By.text("MCP config source · ~/.codex/config.toml")))
        assertNotNull(device.findObject(By.text("openaiDeveloperDocs")))
        assertNotNull(device.findObject(By.text("4 tools · 0 resources · 0 templates")))
        assertNotNull(device.findObject(By.text("Search docs · Fetch doc · OpenAPI spec · Endpoint list")))

        assertNotNull(device.findObject(By.desc("Add MCP")))
    }

    @Test
    fun slashToolboxRoutesToHooksPanel() {
        val slashButton = device.wait(Until.findObject(By.desc("Open slash toolbox")), 5_000)
            ?: error("Slash toolbox button was not visible")
        slashButton.click()
        assertNotNull(device.wait(Until.findObject(By.text("/hooks")), 2_000))

        device.findObject(By.desc("Hooks")).click()

        assertNotNull(device.wait(Until.findObject(By.text("/hooks")), 2_000))
        assertNotNull(device.findObject(By.text("Add Hook")))
        assertNotNull(device.findObject(By.text("Hook config sources · .codex/hooks.json")))
        assertNotNull(device.findObject(By.text("Project hook changed since last trust.")))
        assertNotNull(device.findObject(By.text("PreToolUse · Bash")))
        assertNotNull(device.findObject(By.text("Checking shell command")))
        assertNotNull(device.findObject(By.text("Trust")))
        assertNotNull(device.findObject(By.text("UserPromptSubmit")))
        assertNotNull(device.findObject(By.text("Trusted")))

        assertNotNull(device.findObject(By.desc("Add Hook")))
    }
}
