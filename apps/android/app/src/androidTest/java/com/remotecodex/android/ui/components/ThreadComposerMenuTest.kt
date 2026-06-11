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
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
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
        assertNotNull(device.findObject(By.text("gpt-5-codex")))
        assertNotNull(device.findObject(By.desc("gpt-5.4 selected")))
        assertNotNull(device.findObject(By.desc("gpt-5-codex available")))
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
        assertNotNull(device.findObject(By.desc("Medium selected")))
        assertNotNull(device.findObject(By.desc("High available")))
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
}
