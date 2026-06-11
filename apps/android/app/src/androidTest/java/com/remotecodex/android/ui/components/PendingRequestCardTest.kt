package com.remotecodex.android.ui.components

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.remotecodex.android.ui.model.PendingRequestKindPreview
import com.remotecodex.android.ui.model.PendingRequestOptionPreview
import com.remotecodex.android.ui.model.PendingRequestPreview
import com.remotecodex.android.ui.model.PendingRequestQuestionPreview
import com.remotecodex.android.ui.theme.RemoteCodexTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PendingRequestCardTest {
    @get:Rule
    val composeRule = createComposeRule()

    @Test
    fun freeFormQuestionSubmitsEnteredAnswer() {
        var submitted: Map<String, List<String>>? = null
        val request = PendingRequestPreview(
            id = "request-1",
            title = "Follow-up",
            description = "Answer required",
            command = "",
            riskLabel = "Input required",
            kind = PendingRequestKindPreview.RequestUserInput,
            questions = listOf(
                PendingRequestQuestionPreview(
                    id = "question-1",
                    header = "Follow-up",
                    question = "What should Codex do next?",
                ),
            ),
        )

        setPendingRequestContent(
            request = request,
            onSubmit = { _, answers -> submitted = answers },
        )

        composeRule.onNodeWithText("Answer Required").assertExists()
        composeRule.onNodeWithText("Enter an answer").performTextInput("Run tests")
        composeRule.onNodeWithContentDescription("Submit Answer Required")
            .assertIsEnabled()
            .performClick()

        assertEquals(mapOf("question-1" to listOf("Run tests")), submitted)
    }

    @Test
    fun optionQuestionSubmitsSelectedOptionAndCustomOtherAnswer() {
        var submitted: Map<String, List<String>>? = null
        val request = PendingRequestPreview(
            id = "request-2",
            title = "Pick modes",
            description = "Choose modes",
            command = "",
            riskLabel = "Input required",
            kind = PendingRequestKindPreview.RequestUserInput,
            questions = listOf(
                PendingRequestQuestionPreview(
                    id = "question-2",
                    header = "Modes",
                    question = "Which modes?",
                    multiSelect = true,
                    allowOther = true,
                    options = listOf(
                        PendingRequestOptionPreview("Implement", "Start coding"),
                    ),
                ),
            ),
        )

        setPendingRequestContent(
            request = request,
            onSubmit = { _, answers -> submitted = answers },
        )

        composeRule.onNodeWithContentDescription("Implement").performClick()
        composeRule.onNodeWithContentDescription("Not from above").performClick()
        composeRule.onNodeWithContentDescription("Modes custom answer").performTextInput("Document")
        composeRule.onNodeWithContentDescription("Submit Answer Required").performClick()

        assertEquals(mapOf("question-2" to listOf("Implement", "Document")), submitted)
    }

    @Test
    fun denyActionReportsRequest() {
        var deniedRequestId: String? = null
        val request = PendingRequestPreview(
            id = "request-3",
            title = "Permission required",
            description = "Allow command",
            command = "rm -rf build/tmp",
            riskLabel = "Permission required",
            kind = PendingRequestKindPreview.Approval,
        )

        setPendingRequestContent(
            request = request,
            onDeny = { deniedRequestId = it.id },
        )

        composeRule.onNodeWithContentDescription("Deny Permission required").performClick()

        assertEquals("request-3", deniedRequestId)
    }

    private fun setPendingRequestContent(
        request: PendingRequestPreview,
        onDeny: (PendingRequestPreview) -> Unit = {},
        onSubmit: (PendingRequestPreview, Map<String, List<String>>) -> Unit = { _, _ -> },
    ) {
        composeRule.setContent {
            RemoteCodexTheme(dark = false) {
                PendingRequestCard(
                    request = request,
                    onDeny = onDeny,
                    onSubmit = onSubmit,
                )
            }
        }
    }
}
