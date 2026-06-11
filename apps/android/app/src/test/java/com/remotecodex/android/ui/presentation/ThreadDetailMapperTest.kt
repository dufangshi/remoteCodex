package com.remotecodex.android.ui.presentation

import com.remotecodex.android.api.SupervisorThreadDetail
import com.remotecodex.android.api.SupervisorThreadActionQuestion
import com.remotecodex.android.api.SupervisorThreadActionQuestionOption
import com.remotecodex.android.api.SupervisorThreadActionRequest
import com.remotecodex.android.api.SupervisorThreadAnsweredRequestNote
import com.remotecodex.android.api.SupervisorThreadContextUsage
import com.remotecodex.android.api.SupervisorAgentHook
import com.remotecodex.android.api.SupervisorAgentMcpServer
import com.remotecodex.android.api.SupervisorAgentMcpTool
import com.remotecodex.android.api.SupervisorAgentSkill
import com.remotecodex.android.api.SupervisorAgentSkillError
import com.remotecodex.android.api.SupervisorThreadExportTurnOption
import com.remotecodex.android.api.SupervisorThreadExportTurns
import com.remotecodex.android.api.SupervisorThreadHooks
import com.remotecodex.android.api.SupervisorThreadForkTurnOption
import com.remotecodex.android.api.SupervisorThreadMcpServers
import com.remotecodex.android.api.SupervisorThreadSkills
import com.remotecodex.android.api.SupervisorThreadSummary
import com.remotecodex.android.api.SupervisorThreadTurn
import com.remotecodex.android.api.SupervisorThreadTurnItem
import com.remotecodex.android.api.SupervisorThreadTurnTokenUsage
import com.remotecodex.android.api.SupervisorTokenBreakdown
import com.remotecodex.android.api.SupervisorWorkspaceSummary
import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.MessageAuthor
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.model.ToolStatus
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreadDetailMapperTest {
    @Test
    fun mapsSupervisorDetailIntoNativeThreadPreview() {
        val preview = buildThreadDetailPreviewFromSupervisor(
            detail = SupervisorThreadDetail(
                thread = SupervisorThreadSummary(
                    id = "thread-1",
                    workspaceId = "workspace-1",
                    title = "Android API",
                    status = "running",
                    model = "gpt-5",
                    reasoningEffort = "high",
                    fastMode = true,
                    collaborationMode = "plan",
                    sandboxMode = "danger-full-access",
                    updatedAt = "2026-06-11T18:59:00Z",
                    summaryText = "Wire real detail",
                ),
                workspace = SupervisorWorkspaceSummary(
                    id = "workspace-1",
                    label = "remoteCodex-main",
                    absPath = "/home/u/dev/remoteCodex-main",
                    isFavorite = true,
                    lastOpenedAt = null,
                ),
                turns = listOf(
                    SupervisorThreadTurn(
                        id = "turn-1",
                        startedAt = "2026-06-11T18:58:00Z",
                        status = "completed",
                        error = null,
                        model = "gpt-5",
                        tokenUsage = SupervisorThreadTurnTokenUsage(
                            total = SupervisorTokenBreakdown(
                                inputTokens = 1_200,
                                cachedInputTokens = 300,
                                outputTokens = 456,
                                reasoningOutputTokens = 44,
                            ),
                            last = SupervisorTokenBreakdown(
                                inputTokens = 1_200,
                                cachedInputTokens = 300,
                                outputTokens = 456,
                                reasoningOutputTokens = 44,
                            ),
                            modelContextWindow = 128_000,
                        ),
                        items = listOf(
                            SupervisorThreadTurnItem("item-1", "userMessage", "Continue"),
                            SupervisorThreadTurnItem(
                                id = "item-3",
                                kind = "commandExecution",
                                text = "pnpm test",
                                previewText = "pnpm test",
                                detailText = null,
                                hasDeferredDetail = true,
                                status = "completed",
                            ),
                            SupervisorThreadTurnItem(
                                id = "item-4",
                                kind = "image",
                                text = "Screenshot",
                                previewText = "Android screen",
                                status = "completed",
                                assetPath = "apps/android/output/screen.png",
                            ),
                            SupervisorThreadTurnItem("item-2", "agentMessage", "Done"),
                        ),
                    ),
                ),
                turnCount = 1,
                totalTurnCount = 3,
                pendingRequests = listOf(
                    SupervisorThreadActionRequest(
                        id = "request-1",
                        kind = "requestUserInput",
                        title = "Pick a branch",
                        description = "Choose where to continue.",
                        createdAt = "2026-06-11T18:59:30Z",
                        turnId = "turn-1",
                        itemId = "item-3",
                        questions = listOf(
                            SupervisorThreadActionQuestion(
                                id = "question-1",
                                header = "Branch",
                                question = "Which branch?",
                                multiSelect = false,
                                isOther = true,
                                options = listOf(
                                    SupervisorThreadActionQuestionOption(
                                        label = "main",
                                        description = "Use main branch",
                                    ),
                                ),
                            ),
                        ),
                    ),
                ),
                answeredRequestNotes = listOf(
                    SupervisorThreadAnsweredRequestNote(
                        id = "answered-1",
                        title = "Branch selected",
                        summaryLines = listOf("main"),
                        createdAt = "2026-06-11T18:59:40Z",
                        turnId = "turn-1",
                    ),
                ),
                liveItemCount = 2,
                goalStatus = "active",
                goalObjective = "Ship Android client",
                contextUsage = SupervisorThreadContextUsage(
                    availability = "available",
                    remainingPercent = 38,
                    tokensInContextWindow = 160_000,
                    modelContextWindow = 258_400,
                    updatedAt = "2026-06-11T18:59:50Z",
                ),
            ),
            forkTurns = listOf(
                SupervisorThreadForkTurnOption(
                    turnId = "turn-1",
                    turnIndex = 1,
                    startedAt = "2026-06-11T18:58:00Z",
                    status = "completed",
                ),
            ),
            exportTurns = SupervisorThreadExportTurns(
                turns = listOf(
                    SupervisorThreadExportTurnOption(
                        turnId = "turn-1",
                        turnIndex = 1,
                        startedAt = "2026-06-11T18:58:00Z",
                        status = "completed",
                        userPromptPreview = "Continue",
                    ),
                ),
                totalTurnCount = 1,
            ),
            skills = SupervisorThreadSkills(
                cwd = "/repo",
                skills = listOf(
                    SupervisorAgentSkill(
                        name = "android-client",
                        description = "Android client work",
                        shortDescription = "Android work",
                        interfaceShortDescription = "Native Android",
                        path = "/repo/.codex/skills/android-client/SKILL.md",
                        scope = "repo",
                        enabled = true,
                    ),
                ),
                errors = listOf(SupervisorAgentSkillError(path = "/bad/SKILL.md", message = "Bad skill")),
            ),
            mcpServers = SupervisorThreadMcpServers(
                servers = listOf(
                    SupervisorAgentMcpServer(
                        name = "docs",
                        authStatus = "unsupported",
                        tools = listOf(SupervisorAgentMcpTool(name = "search_docs", title = "Search docs", description = null)),
                        resourceCount = 1,
                        resourceTemplateCount = 2,
                    ),
                ),
            ),
            hooks = SupervisorThreadHooks(
                cwd = "/repo",
                hooks = listOf(
                    SupervisorAgentHook(
                        key = "hook-1",
                        eventName = "preToolUse",
                        handlerType = "command",
                        matcher = "Bash",
                        command = "scripts/check.sh",
                        timeoutSec = 30,
                        statusMessage = "Checking",
                        sourcePath = "/repo/.codex/hooks.json",
                        source = "project",
                        pluginId = null,
                        displayOrder = 1,
                        enabled = true,
                        isManaged = false,
                        currentHash = "hash-1",
                        trustStatus = "modified",
                    ),
                ),
                warnings = listOf("Review hook"),
                errors = emptyList(),
                globalHooksPath = "/home/u/.codex/hooks.json",
                projectHooksPath = "/repo/.codex/hooks.json",
            ),
            now = Instant.parse("2026-06-11T19:00:00Z"),
        )

        assertEquals("Android API", preview.title)
        assertEquals("remoteCodex-main", preview.workspace)
        assertEquals("codex / gpt-5", preview.runtime)
        assertEquals("in 1.5k / out 500", preview.usage)
        assertEquals("6 transcript items", preview.items)
        assertEquals(ThreadStatus.Running, preview.rooms.single().status)
        assertEquals("1m", preview.rooms.single().updatedLabel)
        assertTrue(preview.timelineAuxiliary.canLoadEarlier)
        assertEquals("Goal", preview.timelineAuxiliary.activityNotes.single().title)
        assertEquals("Pick a branch", preview.pendingRequests.single().title)
        assertEquals("turn-1", preview.pendingRequests.single().turnId)
        assertEquals("item-3", preview.pendingRequests.single().itemId)
        assertEquals("question-1", preview.pendingRequests.single().questions.single().id)
        assertEquals("main", preview.pendingRequests.single().questions.single().options.single().label)
        assertEquals("Branch selected", preview.timelineAuxiliary.answeredRequestNotes.single().title)
        assertEquals("turn-1", preview.timelineAuxiliary.answeredRequestNotes.single().turnId)
        assertEquals("Ship Android client", preview.composer.goalPanel.currentGoal?.objective)
        assertEquals("Message Android API...", preview.composer.prompt.placeholder)
        assertEquals(160_000, preview.composer.context.tokensInContextWindow)
        assertEquals(258_400, preview.composer.context.modelContextWindow)
        assertEquals(38, preview.composer.context.remainingPercent)
        assertEquals("high", preview.composer.reasoningEffort)
        assertTrue(preview.composer.fastMode)
        assertTrue(preview.composer.planModeActive)
        assertEquals("danger-full-access", preview.composer.workspaceModeLabel)
        assertEquals("turn-1", preview.composer.forkTurnOptions.turns.single().turnId)
        assertEquals(1, preview.composer.forkTurnOptions.turns.single().turnIndex)
        assertEquals("completed", preview.composer.forkTurnOptions.turns.single().status)
        assertEquals("turn-1", preview.exportTurns.single().id)
        assertEquals(1, preview.exportTurns.single().number)
        assertEquals("Continue", preview.exportTurns.single().promptPreview)
        assertEquals("android-client", preview.composer.skillsPanel.skills.single().name)
        assertEquals("Native Android", preview.composer.skillsPanel.skills.single().interfaceShortDescription)
        assertEquals("Bad skill", preview.composer.skillsPanel.errors.single().message)
        assertEquals("docs", preview.composer.mcpPanel.servers.single().name)
        assertEquals("Search docs", preview.composer.mcpPanel.servers.single().tools.single().title)
        assertEquals("hook-1", preview.composer.hooksPanel.hooks.single().key)
        assertEquals("hash-1", preview.composer.hooksPanel.hooks.single().currentHash)
        assertEquals("Review hook", preview.composer.hooksPanel.warnings.single())

        val turn = preview.turns.single()
        assertEquals("complete", turn.statusLabel)
        assertEquals("in 1.5k / out 500", turn.tokenSummary)
        assertEquals(2, turn.messages.size)
        assertEquals(MessageAuthor.User, turn.messages[0].author)
        assertEquals("Continue", turn.messages[0].text)
        assertEquals(MessageAuthor.Assistant, turn.messages[1].author)
        assertEquals("Done", turn.messages[1].richText)
        assertEquals(2, turn.messages[1].historyItems.size)
        assertEquals("item-3", turn.messages[1].historyItems[0].id)
        assertEquals(HistoryItemKind.Command, turn.messages[1].historyItems[0].kind)
        assertEquals(ToolStatus.Completed, turn.messages[1].historyItems[0].status)
        assertTrue(turn.messages[1].historyItems[0].hasDeferredDetail)
        assertEquals("item-4", turn.messages[1].historyItems[1].id)
        assertEquals(HistoryItemKind.Image, turn.messages[1].historyItems[1].kind)
        assertEquals("apps/android/output/screen.png", turn.messages[1].historyItems[1].assetPath)
        assertTrue(preview.workspacePreview.nodes.single().selected)
    }
}
