package com.remotecodex.android.ui.components

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.remotecodex.android.ui.model.ComposerActiveView
import com.remotecodex.android.ui.model.ComposerPreview
import com.remotecodex.android.ui.model.ComposerPromptPreview
import com.remotecodex.android.ui.model.ComposerShellControlPreview
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
    fun mcpPanelWritesHttpPreviewServerAndReturnsToList() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("MCP").performClick()
        composeRule.onNodeWithContentDescription("Add MCP").performClick()
        composeRule.onNodeWithContentDescription("HTTP / Streamable HTTP").performClick()

        composeRule.onNodeWithContentDescription("Write HTTP MCP").performClick()

        composeRule.onNodeWithText("HTTP MCP written: openaiDeveloperDocs").assertExists()
        composeRule.onNodeWithText("openaiDeveloperDocs").assertExists()
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
    fun mcpPanelWritesRawBlockPreviewServerAndReturnsToList() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("MCP").performClick()
        composeRule.onNodeWithContentDescription("Add MCP").performClick()
        composeRule.onNodeWithContentDescription("stdio / raw block").performClick()

        composeRule.onNodeWithContentDescription("Write raw block").performClick()

        composeRule.onNodeWithText("Raw MCP block written: docs").assertExists()
        composeRule.onNodeWithText("docs").assertExists()
    }

    @Test
    fun skillsPanelCopiesInvocationNamePreviewState() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Skills").performClick()

        composeRule.onNodeWithText("OpenAI Docs").assertExists()
        composeRule.onNodeWithContentDescription("Copy \$openai-docs").performClick()

        composeRule.onNodeWithText("Copied \$openai-docs").assertExists()
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
    fun hooksPanelWritesPreviewHookAndReturnsToList() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Hooks").performClick()
        composeRule.onNodeWithContentDescription("Add Hook").performClick()

        composeRule.onNodeWithContentDescription("Write Hook").performClick()

        composeRule.onNodeWithText("Hook written: PreToolUse").assertExists()
        composeRule.onAllNodesWithText("PreToolUse · Bash").assertCountEquals(2)
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
    fun hooksPanelUpdatesPreviewHookAndReturnsToList() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Hooks").performClick()
        composeRule.onNodeWithContentDescription("Edit PreToolUse · Bash").performClick()

        composeRule.onNodeWithContentDescription("Update Hook").performClick()

        composeRule.onNodeWithText("Hook updated: PreToolUse").assertExists()
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

    @Test
    fun forkPanelStartsLatestForkPreviewAndClosesMenu() {
        setComposerContent(composer = ComposerPreview(busy = false))

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Fork").performClick()

        composeRule.onNodeWithText("Fork from latest").performClick()

        composeRule.onNodeWithText("Fork preview started from latest turn").assertExists()
        composeRule.onNodeWithText("/fork").assertDoesNotExist()
    }

    @Test
    fun forkTurnPickerStartsSelectedTurnForkPreviewAndClosesMenu() {
        setComposerContent(composer = ComposerPreview(busy = false))

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Fork").performClick()
        composeRule.onNodeWithText("Fork from selected turn").performClick()

        composeRule.onNodeWithText("Turn 12").performClick()

        composeRule.onNodeWithText("Fork preview started from Turn 12").assertExists()
        composeRule.onNodeWithText("/fork").assertDoesNotExist()
    }

    @Test
    fun planModeChipTogglesPreviewCollaborationMode() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Plan not pressed").performClick()

        composeRule.onNodeWithContentDescription("Plan pressed").assertExists()
        composeRule.onNodeWithContentDescription("Plan pressed").performClick()
        composeRule.onNodeWithContentDescription("Plan not pressed").assertExists()
    }

    @Test
    fun fastToolboxActionTogglesPreviewStateAndSettingsLock() {
        setComposerContent(composer = ComposerPreview(fastMode = false))

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithText("Off").assertExists()

        composeRule.onNodeWithContentDescription("Fast mode").performClick()

        composeRule.onNodeWithText("Fast mode preview on").assertExists()
        composeRule.onNodeWithText("On").assertExists()
        composeRule.onNode(
            SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription,
                "Fast mode is on. Turn it off from the slash toolbox to edit model.",
            ),
        ).assertExists()

        composeRule.onNodeWithContentDescription("Fast mode").performClick()

        composeRule.onNodeWithText("Fast mode preview off").assertExists()
        composeRule.onNodeWithText("Off").assertExists()
    }

    @Test
    fun settingsMenusUpdateModelAndEffortPreviewState() {
        setComposerContent(composer = ComposerPreview(fastMode = false))

        composeRule.onNodeWithContentDescription("gpt-5.4").performClick()
        composeRule.onNodeWithContentDescription("Model").assertExists()
        composeRule.onNodeWithText("gpt-5-codex").performClick()

        composeRule.onNodeWithContentDescription("gpt-5-codex").assertExists()
        composeRule.onNodeWithContentDescription("High").assertExists()

        composeRule.onNodeWithContentDescription("High").performClick()
        composeRule.onNodeWithContentDescription("Reasoning effort").assertExists()
        composeRule.onNodeWithText("Low").performClick()

        composeRule.onNodeWithContentDescription("Low").assertExists()
    }

    @Test
    fun compactToolboxActionStartsPreviewBusyStateAndClosesMenu() {
        setComposerContent(composer = ComposerPreview(busy = false, compactBusy = false))

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithText("Run").assertExists()

        composeRule.onNodeWithContentDescription("Compact thread").performClick()

        composeRule.onNodeWithText("Compact preview started").assertExists()
        composeRule.onNodeWithText("Slash toolbox").assertDoesNotExist()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithText("Busy").assertExists()
    }

    @Test
    fun chatPromptInputSendsLocalDraftPreviewState() {
        setComposerContent(
            composer = ComposerPreview(
                activeView = ComposerActiveView.Chat,
                busy = false,
                canInterrupt = false,
                prompt = ComposerPromptPreview(text = "", attachments = emptyList()),
            ),
        )

        composeRule.onNodeWithText("Nothing to send").assertExists()
        composeRule.onNodeWithContentDescription("Send Prompt").assertIsNotEnabled()
        composeRule.onNodeWithContentDescription("Prompt").performTextInput("Review the Android composer")
        composeRule.onNodeWithContentDescription("Send Prompt").assertIsEnabled()
        composeRule.onNodeWithContentDescription("Send Prompt").performClick()

        composeRule.onNodeWithText("Prompt preview sent: Review the Android composer").assertExists()
        composeRule.onNodeWithText("Nothing to send").assertExists()
        composeRule.onNodeWithText("Review the Android composer").assertDoesNotExist()
    }

    @Test
    fun chatPromptInputKeepsEmptyDraftSendDisabled() {
        setComposerContent(
            composer = ComposerPreview(
                activeView = ComposerActiveView.Chat,
                busy = false,
                canInterrupt = false,
                prompt = ComposerPromptPreview(text = "", attachments = emptyList()),
            ),
        )

        composeRule.onNodeWithContentDescription("Prompt").assertExists()
        composeRule.onNodeWithContentDescription("Send Prompt").assertIsNotEnabled()
        composeRule.onNodeWithText("Nothing to send").assertExists()
    }

    @Test
    fun viewToggleSwitchesBetweenChatAndShellPreviewSurfaces() {
        setComposerContent(composer = ComposerPreview(activeView = ComposerActiveView.Chat))

        composeRule.onNodeWithContentDescription("Open slash toolbox").assertExists()
        composeRule.onNodeWithText("Prompt").assertExists()
        composeRule.onAllNodesWithContentDescription("Switch to shell")[0].performClick()

        composeRule.onNodeWithText("Shell input").assertExists()
        composeRule.onNodeWithContentDescription("Open shell tools").assertExists()
        composeRule.onNodeWithContentDescription("Open slash toolbox").assertDoesNotExist()
        composeRule.onAllNodesWithContentDescription("Switch to chat")[0].performClick()

        composeRule.onNodeWithText("Prompt").assertExists()
        composeRule.onNodeWithContentDescription("Open slash toolbox").assertExists()
        composeRule.onNodeWithContentDescription("Open shell tools").assertDoesNotExist()
    }

    @Test
    fun shellPromptInputSendsLocalDraftPreviewState() {
        setComposerContent(
            composer = ComposerPreview(
                activeView = ComposerActiveView.Shell,
                busy = false,
                prompt = ComposerPromptPreview(text = "", attachments = emptyList()),
            ),
        )

        composeRule.onNodeWithText("Shell input").assertExists()
        composeRule.onNodeWithContentDescription("Prompt").performTextInput("pwd")
        composeRule.onNodeWithContentDescription("Send Shell Input").assertIsEnabled()
        composeRule.onNodeWithContentDescription("Send Shell Input").performClick()

        composeRule.onNodeWithText("Shell input preview sent: pwd").assertExists()
        composeRule.onNodeWithText("pwd").assertDoesNotExist()
    }

    @Test
    fun shellPromptInputKeepsUnavailableActionsDisabled() {
        setComposerContent(
            composer = ComposerPreview(
                activeView = ComposerActiveView.Shell,
                busy = true,
                canInterrupt = false,
            ),
        )

        composeRule.onNodeWithContentDescription("Send Shell Input").assertIsNotEnabled()
        composeRule.onNodeWithContentDescription("Send Ctrl-C").assertIsNotEnabled()
    }

    @Test
    fun jumpLatestButtonUpdatesFollowTailPreviewState() {
        setComposerContent(
            composer = ComposerPreview(
                activeView = ComposerActiveView.Chat,
                followTail = false,
            ),
        )

        composeRule.onNodeWithText("Paused").assertExists()
        composeRule.onNode(
            SemanticsMatcher.expectValue(
                SemanticsProperties.ContentDescription,
                listOf("Jump to latest"),
            ) and SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription,
                "Jump to the latest messages",
            ),
        ).performClick()

        composeRule.onNodeWithText("Following").assertExists()
        composeRule.onNode(
            SemanticsMatcher.expectValue(
                SemanticsProperties.ContentDescription,
                listOf("Jump to latest"),
            ) and SemanticsMatcher.expectValue(
                SemanticsProperties.StateDescription,
                "Latest turn is in view",
            ),
        ).assertExists()
    }

    @Test
    fun attachmentChipRemovalUpdatesDraftPreviewState() {
        setComposerContent(
            composer = ComposerPreview(
                prompt = ComposerPromptPreview(text = "", attachments = emptyList()),
            ),
        )

        composeRule.onNodeWithText("No files").assertExists()
        composeRule.onNodeWithContentDescription("Add attachment").performClick()
        composeRule.onNodeWithContentDescription("File").performClick()

        composeRule.onNodeWithText("1 file").assertExists()
        composeRule.onAllNodesWithText("android-client-notes.txt").assertCountEquals(2)
        composeRule.onNodeWithContentDescription("Remove attachment android-client-notes.txt").performClick()

        composeRule.onNodeWithText("Removed attachment: android-client-notes.txt").assertExists()
        composeRule.onNodeWithText("No files").assertExists()
        composeRule.onAllNodesWithText("android-client-notes.txt").assertCountEquals(0)
    }

    @Test
    fun shellToolsPanelActionsShowPreviewFeedback() {
        setComposerContent(
            composer = ComposerPreview(
                activeView = ComposerActiveView.Shell,
                busy = false,
            ),
        )

        composeRule.onNodeWithContentDescription("Open shell tools").performClick()
        composeRule.onNodeWithContentDescription("Shell tools").assertExists()

        composeRule.onNodeWithContentDescription("PASTE").performClick()
        composeRule.onNodeWithText("Shell paste preview").assertExists()

        composeRule.onNodeWithContentDescription("CTRL-C").performClick()
        composeRule.onNodeWithText("Sent Ctrl-C preview").assertExists()
    }

    @Test
    fun shellToolsPanelKeepsUnavailableControlsDisabled() {
        setComposerContent(
            composer = ComposerPreview(
                activeView = ComposerActiveView.Shell,
                busy = true,
                shellControl = ComposerShellControlPreview(
                    shellInputEnabled = false,
                    commandRunning = true,
                ),
            ),
        )

        composeRule.onNodeWithContentDescription("Open shell tools").performClick()
        composeRule.onNodeWithText("Shell tools").assertExists()

        listOf("CLEAR", "CTRL-C", "CTRL-D", "ESC", "TAB", "UP", "DOWN").forEach { label ->
            composeRule.onNode(
                SemanticsMatcher.expectValue(
                    SemanticsProperties.ContentDescription,
                    listOf(label),
                ) and SemanticsMatcher.expectValue(
                    SemanticsProperties.StateDescription,
                    "Disabled",
                ),
            ).assertExists()
        }

        composeRule.onNodeWithContentDescription("PASTE").performClick()
        composeRule.onNodeWithText("Shell paste preview").assertExists()
        composeRule.onNodeWithText("Shell clear preview").assertDoesNotExist()
        composeRule.onNodeWithText("Sent Ctrl-C preview").assertDoesNotExist()
    }

    @Test
    fun goalToolboxActionEntersAndCancelsGoalComposePreview() {
        setComposerContent()

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Goal").performClick()

        composeRule.onNodeWithText("Max tokens (k)").assertExists()
        composeRule.onNodeWithContentDescription("Goal token budget").assertTextEquals("12.5")
        composeRule.onNodeWithText("Describe the goal the backend should continue working toward.").assertExists()
        composeRule.onNodeWithText("Set goal").assertExists()
        composeRule.onNodeWithContentDescription("Submit goal").assertExists()
        composeRule.onNodeWithText("Slash toolbox").assertDoesNotExist()

        composeRule.onNodeWithContentDescription("Cancel").performClick()

        composeRule.onNodeWithContentDescription("Send Prompt").assertExists()
        composeRule.onNodeWithText("Max tokens (k)").assertDoesNotExist()
    }

    @Test
    fun goalSubmitRejectsEmptyPreviewObjective() {
        setComposerContent(
            composer = ComposerPreview(
                prompt = ComposerPromptPreview(text = "", attachments = emptyList()),
            ),
        )

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Goal").performClick()

        composeRule.onNodeWithContentDescription("Submit goal").performClick()

        composeRule.onNodeWithText("Goal objective cannot be empty.").assertExists()
        composeRule.onNodeWithContentDescription("Goal token budget").assertTextEquals("12.5")
    }

    @Test
    fun goalTokenBudgetInputUpdatesPreviewState() {
        setComposerContent(
            composer = ComposerPreview(
                prompt = ComposerPromptPreview(
                    text = "Keep composer goal budget editable",
                ),
            ),
        )

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Goal").performClick()

        composeRule.onNodeWithContentDescription("Goal token budget").performTextReplacement("32")
        composeRule.onNodeWithContentDescription("Goal token budget").assertTextEquals("32")
        composeRule.onNodeWithContentDescription("Submit goal").performClick()

        composeRule.onNodeWithText("Goal preview set: Keep composer goal budget editable").assertExists()
        composeRule.onNodeWithText("Goal token budget preview: 32k budget").assertExists()
    }

    @Test
    fun goalSubmitSetsPreviewGoalAndClearsDraft() {
        setComposerContent(
            composer = ComposerPreview(
                prompt = ComposerPromptPreview(
                    text = "Ship the native Android goal lifecycle",
                ),
            ),
        )

        composeRule.onNodeWithContentDescription("Open slash toolbox").performClick()
        composeRule.onNodeWithContentDescription("Goal").performClick()

        composeRule.onNodeWithContentDescription("Submit goal").performClick()

        composeRule.onNodeWithText("Goal preview set: Ship the native Android goal lifecycle").assertExists()
        composeRule.onNodeWithText("Ask the backend to inspect, modify, or explain code...").assertExists()
        composeRule.onNodeWithText("No files").assertExists()
        composeRule.onNodeWithText("Max tokens (k)").assertDoesNotExist()
    }

    private fun setComposerContent(composer: ComposerPreview = ComposerPreview()) {
        composeRule.setContent {
            RemoteCodexTheme(dark = true) {
                ThreadComposer(composer = composer)
            }
        }
    }
}
