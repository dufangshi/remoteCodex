package com.remotecodex.android.ui.components

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.remotecodex.android.ui.model.ComposerPreview
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ThreadComposerStateTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun mcpPanelNavigatesThroughAddAndHttpPreviewModes() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("MCP").performClick()

        composeRule.onNodeWithText("openaiDeveloperDocs").assertExists()

        composeRule.onNodeWithContentDescription("Add MCP").performClick()

        composeRule.onNodeWithText("HTTP / Streamable HTTP").assertExists()
        composeRule.onNodeWithText("stdio / raw block").assertExists()

        composeRule.onNodeWithContentDescription("HTTP / Streamable HTTP").performClick()

        composeRule.onNodeWithText("HTTP MCP").assertExists()
        composeRule.onNodeWithText("MCP name").assertExists()
        composeRule.onNodeWithText("URL").assertExists()
        composeRule.onNodeWithText("Write HTTP MCP").assertExists()

        composeRule.onNodeWithContentDescription("Back").performClick()

        composeRule.onNodeWithText("HTTP / Streamable HTTP").assertExists()
    }

    @Test
    fun mcpPanelNavigatesThroughRawBlockPreviewMode() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("MCP").performClick()
        composeRule.onNodeWithContentDescription("Add MCP").performClick()

        composeRule.onNodeWithContentDescription("stdio / raw block").performClick()

        composeRule.onAllNodesWithText("MCP block for provider config")[0].assertExists()
        composeRule.onNodeWithText("[mcp_servers.docs]\ncommand = \"npx\"\nargs = [\"-y\", \"@modelcontextprotocol/server-filesystem\"]").assertExists()
        composeRule.onNodeWithText("Write raw block").assertExists()

        composeRule.onNodeWithContentDescription("Back").performClick()

        composeRule.onNodeWithText("stdio / raw block").assertExists()
    }

    @Test
    fun hooksPanelNavigatesThroughAddPreviewMode() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Hooks").performClick()

        composeRule.onNodeWithText("PreToolUse · Bash").assertExists()

        composeRule.onNodeWithContentDescription("Add Hook").performClick()

        composeRule.onNodeWithText("Scope").assertExists()
        composeRule.onNodeWithText("Project").assertExists()
        composeRule.onNodeWithText("Event").assertExists()
        composeRule.onNodeWithText("PreToolUse").assertExists()
        composeRule.onNodeWithText("Matcher").assertExists()
        composeRule.onNodeWithText("Write Hook").assertExists()

        composeRule.onNodeWithContentDescription("Back").performClick()

        composeRule.onNodeWithText("PreToolUse · Bash").assertExists()
    }

    @Test
    fun hooksPanelNavigatesThroughEditPreviewMode() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Hooks").performClick()

        composeRule.onNodeWithText("PreToolUse · Bash").assertExists()

        composeRule.onNodeWithContentDescription("Edit PreToolUse · Bash").performClick()

        composeRule.onNodeWithText("Editing").assertExists()
        composeRule.onNodeWithText("Editing PreToolUse in project hooks.json").assertExists()
        composeRule.onNodeWithText("Scope").assertExists()
        composeRule.onNodeWithText("Project").assertExists()
        composeRule.onNodeWithText("Event").assertExists()
        composeRule.onNodeWithText("PreToolUse").assertExists()
        composeRule.onNodeWithText("Matcher").assertExists()
        composeRule.onNodeWithText("Bash").assertExists()
        composeRule.onNodeWithText("Command").assertExists()
        composeRule.onNodeWithText("scripts/check-command.sh").assertExists()
        composeRule.onNodeWithText("Update Hook").assertExists()

        composeRule.onNodeWithContentDescription("Back").performClick()

        composeRule.onNodeWithText("PreToolUse · Bash").assertExists()
    }

    @Test
    fun hooksPanelUpdatesLocalTrustPreviewState() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Hooks").performClick()

        composeRule.onNodeWithText("Modified").assertExists()
        composeRule.onNodeWithContentDescription("Trust PreToolUse · Bash").performClick()

        composeRule.onNodeWithText("Hook trusted: PreToolUse · Bash").assertExists()
        composeRule.onAllNodesWithText("Trusted").assertCountEquals(2)
        composeRule.onNodeWithContentDescription("Untrust PreToolUse · Bash").performClick()

        composeRule.onNodeWithText("Hook marked for review: PreToolUse · Bash").assertExists()
        composeRule.onNodeWithText("Review").assertExists()
        composeRule.onAllNodesWithText("Trusted").assertCountEquals(1)
    }

    @Test
    fun forkPanelNavigatesToTurnPickerWhenThreadIsIdle() {
        setComposerContent(composer = ComposerPreview(busy = false))

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Fork").performClick()

        composeRule.onNodeWithText("Fork from selected turn").performClick()

        composeRule.onNodeWithText("Turn 12").assertExists()
        composeRule.onNodeWithText("Turn 11").assertExists()
        composeRule.onNodeWithText("Turn 10").assertExists()
    }

    private fun setComposerContent(composer: ComposerPreview = ComposerPreview()) {
        composeRule.setContent {
            RemoteCodexTheme(dark = true) {
                ThreadComposer(composer = composer)
            }
        }
    }
}
