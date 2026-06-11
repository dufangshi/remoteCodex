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
class PendingRequestCardTest {
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
    fun planDecisionRendersWithoutFooterSubmit() {
        assertNotNull(device.wait(Until.findObject(By.text("Plan")), 5_000))
        assertNotNull(device.findObject(By.text("Plan decision")))
        assertNotNull(device.findObject(By.text("Start the next Android component parity pass?")))
        assertNotNull(device.findObject(By.text("Implement")))
        assertNotNull(device.findObject(By.text("Discuss")))
        assertTrue(
            "Plan decision should not render an empty command block",
            device.findObjects(By.text("Requested action")).isEmpty(),
        )
        assertTrue(
            "Plan decision description should stay hidden like the Web card",
            device.findObjects(
                By.text("Codex prepared a focused plan for the next Android alignment pass."),
            ).isEmpty(),
        )
    }

    @Test
    fun freeFormQuestionRendersAndKeepsSubmitDisabledUntilTextIsProvided() {
        assertNotNull(device.wait(Until.findObject(By.text("Follow-up")), 5_000))
        assertNotNull(device.findObject(By.text("Enter an answer")))

        device.findObject(By.desc("Approve once, recommended")).clickCenter()
        assertNotNull(
            device.wait(Until.findObject(By.desc("Approve once, recommended, selected")), 2_000),
        )

        val followUpInput = device.findObject(By.clazz("android.widget.EditText"))
        assertNotNull(followUpInput)
        assertTrue(followUpInput.isEnabled)
    }
}

private fun androidx.test.uiautomator.UiObject2.clickCenter() {
    val bounds = visibleBounds
    UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).click(
        bounds.centerX(),
        bounds.centerY(),
    )
}
