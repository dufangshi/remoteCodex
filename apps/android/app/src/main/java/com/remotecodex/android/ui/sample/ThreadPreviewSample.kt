package com.remotecodex.android.ui.sample

import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.AppShellNavigationItemPreview
import com.remotecodex.android.ui.model.AppShellPreview
import com.remotecodex.android.ui.model.HistoryGroupPreview
import com.remotecodex.android.ui.model.HistoryItemPreview
import com.remotecodex.android.ui.model.MessageAuthor
import com.remotecodex.android.ui.model.MessagePreview
import com.remotecodex.android.ui.model.ArtifactPreview
import com.remotecodex.android.ui.model.ExportTurnPreview
import com.remotecodex.android.ui.model.LivePlanPreview
import com.remotecodex.android.ui.model.LivePlanStepPreview
import com.remotecodex.android.ui.model.PendingRequestPreview
import com.remotecodex.android.ui.model.PlanStepStatus
import com.remotecodex.android.ui.model.PluginPreview
import com.remotecodex.android.ui.model.ReasoningPreview
import com.remotecodex.android.ui.model.RendererPreview
import com.remotecodex.android.ui.model.ShellProcessPreview
import com.remotecodex.android.ui.model.ShellPreview
import com.remotecodex.android.ui.model.ThreadDetailPreview
import com.remotecodex.android.ui.model.ThreadRoomPreview
import com.remotecodex.android.ui.model.ThreadStatus
import com.remotecodex.android.ui.model.TimelineAuxiliaryPreview
import com.remotecodex.android.ui.model.TimelineNotePreview
import com.remotecodex.android.ui.model.TimelineSteerPreview
import com.remotecodex.android.ui.model.ToolCallPreview
import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.model.TurnPreview
import com.remotecodex.android.ui.model.WorkspaceFilePreview
import com.remotecodex.android.ui.model.WorkspaceNodeKind
import com.remotecodex.android.ui.model.WorkspacePreview
import com.remotecodex.android.ui.presentation.WorkspaceTreePath
import com.remotecodex.android.ui.presentation.buildWorkspaceTreeNodes

object ThreadPreviewSample {
    private val largePlainTextMessage = buildString {
        append("Large message preview check. Open www.example.com/remote-codex/status, then expand this log when more detail is needed.\n\n")
        repeat(110) { index ->
            append("line ")
            append(index + 1)
            append(": native timeline body keeps long output collapsed until the operator asks for the full text.\n")
        }
    }

    val exportTurns = listOf(
        ExportTurnPreview(
            id = "turn-12",
            number = 12,
            timeLabel = "13:41",
            status = ThreadStatus.Running,
            promptPreview = "Continue Android app development and align native components with thread-ui.",
        ),
        ExportTurnPreview(
            id = "turn-11",
            number = 11,
            timeLabel = "13:28",
            status = ThreadStatus.Complete,
            promptPreview = "Build the first Kotlin Android skeleton and document the architecture.",
        ),
        ExportTurnPreview(
            id = "turn-10",
            number = 10,
            timeLabel = "12:56",
            status = ThreadStatus.Waiting,
            promptPreview = "Check emulator access and KVM permissions before running E2E.",
            selected = false,
        ),
        ExportTurnPreview(
            id = "turn-09",
            number = 9,
            timeLabel = "12:31",
            status = ThreadStatus.Complete,
            promptPreview = "Compare thread-ui workspace panels with native mobile affordances.",
        ),
    )

    val appShell = AppShellPreview(
        productName = "Remote Codex",
        supervisorLabel = "Local supervisor",
        connectionLabel = "Private network",
        defaultBackend = "codex",
        navigationItems = listOf(
            AppShellNavigationItemPreview(
                label = "Workspaces",
                detail = "Trusted project roots and recent activity",
                active = true,
            ),
            AppShellNavigationItemPreview(
                label = "Threads",
                detail = "Active turns, waiting confirmations, and recovery",
            ),
            AppShellNavigationItemPreview(
                label = "Shells",
                detail = "Durable terminal sessions attached to threads",
            ),
        ),
        plugins = listOf(
            PluginPreview(
                name = "Remote Codex tools",
                description = "Built-in thread panels and supervisor control surfaces.",
                capabilities = "thread panels, command output, workspace tools",
                source = "Built-in module",
                enabled = true,
            ),
            PluginPreview(
                name = "Molecule artifact",
                description = "Renderer contract for XYZ-like artifact previews.",
                capabilities = "chemistry.molecule3d",
                source = "Imported manifest",
                enabled = true,
            ),
            PluginPreview(
                name = "Graph workspace",
                description = "Workspace relationship view used by the thread UI.",
                capabilities = "graph panel, workspace guide",
                source = "Built-in module",
                enabled = false,
            ),
        ),
        renderers = listOf(
            RendererPreview(
                name = "Code preview",
                description = "Monospace file preview with metadata and copy/open actions.",
                status = "Native",
            ),
            RendererPreview(
                name = "Molecule preview",
                description = "Compact fallback for molecule artifacts until 3D rendering lands.",
                status = "Fallback",
            ),
            RendererPreview(
                name = "Plugin panel",
                description = "Complex plugin panels stay behind a WebView fallback in early builds.",
                status = "Deferred",
            ),
        ),
    )

    val detail = ThreadDetailPreview(
        title = "Android native thread client",
        workspace = "~/dev/remoteCodex-main",
        branch = "main",
        runtime = "codex / gpt-5-codex",
        usage = "in 42.8k / out 9.4k / cache 18.1k",
        items = "27 transcript items",
        rooms = listOf(
            ThreadRoomPreview(
                id = "android-native",
                title = "Android native thread client",
                workspaceLabel = "remoteCodex-main",
                status = ThreadStatus.Running,
                updatedLabel = "now",
                sessionId = "sess_android_native",
                active = true,
            ),
            ThreadRoomPreview(
                id = "auth-runtime",
                title = "Auth runtime modes",
                workspaceLabel = "remoteCodex-main",
                status = ThreadStatus.Waiting,
                updatedLabel = "8m",
                sessionId = "sess_auth_runtime",
            ),
            ThreadRoomPreview(
                id = "thread-ui-polish",
                title = "Graph-chat UI polish",
                workspaceLabel = "remote-codex-thread-ui",
                status = ThreadStatus.Complete,
                updatedLabel = "1h",
                sessionId = "sess_graphchat",
            ),
        ),
        turns = listOf(
            TurnPreview(
                index = 12,
                timeLabel = "13:41",
                statusLabel = "Running",
                tokenSummary = "5.8k tokens",
                optimistic = true,
                livePlan = LivePlanPreview(
                    title = "Plan update",
                    explanation = "Keep native parity moving while emulator verification is unavailable.",
                    steps = listOf(
                        LivePlanStepPreview(
                            step = "Map remaining thread-ui components to Android surfaces.",
                            status = PlanStepStatus.Completed,
                        ),
                        LivePlanStepPreview(
                            step = "Add native live plan and thread action dialogs.",
                            status = PlanStepStatus.Running,
                        ),
                        LivePlanStepPreview(
                            step = "Run APK build and metadata verification.",
                            status = PlanStepStatus.Pending,
                        ),
                    ),
                ),
                messages = listOf(
                    MessagePreview(
                        author = MessageAuthor.User,
                        status = ThreadStatus.Complete,
                        timeLabel = "13:39",
                        text = "Continue Android app development. Align native components with thread-ui and keep the visual language close to the web version.\n\n[PHOTO apps/android/output/shell-preview.png]\n[FILE docs/android-client-architecture.md]",
                    ),
                    MessagePreview(
                        author = MessageAuthor.Assistant,
                        status = ThreadStatus.Running,
                        timeLabel = "13:41",
                        text = "I am moving the skeleton to Compose, extracting the reusable console components first so the app can grow without rewriting the UI surface.",
                        richText = """
                            I am moving the skeleton to Compose and matching the graph-chat message surface:

                            - reusable console components first
                              - nested list levels stay visible on mobile
                            - native token parity for light and dark mode
                            - stable `ThreadDetailDto` projection later
                            - Inline **strong**, *emphasis*, ~~stale copy~~, and `code` match the web renderer.

                            1. Compare the web renderer.
                              1. Preserve the mobile-first structure.
                            2. Keep the native mobile surface compact.

                            - [x] Preserve clickable plain links.
                            - [x] Keep math notation readable in native markdown.

                            > Long agent output needs structure on mobile.
                            > Blockquotes stay framed without taking over the thread.

                            ---

                            | Area | Count | Native status |
                            | :--- | ---: | :---: |
                            | Links | 2 | Clickable |
                            | Tables | 1 | Aligned |

                            Plain links stay readable in native text: www.example.com/remote-codex/status.
                            Markdown links are native too: [architecture docs](docs/android-client-architecture.md).
                            Markdown images render as native placeholders: ![Shell preview](apps/android/output/shell-preview.png).
                            Inline formulas stay compact: ${'$'}tokens_{in} + tokens_{out}${'$'}.

                            ${'$'}${'$'}
                            latency = queue + model + tool
                            ${'$'}${'$'}

                            ```kotlin
                            @Composable
                            fun ThreadTimeline(turns: List<TurnPreview>) {
                                LazyColumn {
                                    items(turns, key = { it.index }) { turn ->
                                        TurnFrame(turn = turn)
                                    }
                                }
                            }
                            ```

                            ```tool-call
                            {"tool":"file.read","call_id":"call_android_doc","args":{"path":"docs/android-client-architecture.md"}}
                            ```

                            ```tool-result
                            {"call_id":"call_android_doc","result":{"status":"completed","summary":"Android coverage matrix updated."}}
                            ```
                        """.trimIndent(),
                        toolCall = ToolCallPreview(
                            name = "shell.exec",
                            status = ToolStatus.Completed,
                            parameters = listOf(
                                "cmd" to "./gradlew :app:assembleDebug",
                                "cwd" to "apps/android",
                            ),
                            result = "BUILD SUCCESSFUL in 17s\n35 actionable tasks: 35 executed",
                        ),
                        reasoningItems = listOf(
                            ReasoningPreview(
                                text = "The Web component exposes agent reasoning as a compact accordion under assistant replies. The Android surface should preserve that hierarchy without adding another full screen.",
                                status = ToolStatus.Completed,
                            ),
                            ReasoningPreview(
                                text = "Use a native disclosure row with bounded monospace content so long reasoning stays scannable on mobile.",
                                status = ToolStatus.Running,
                            ),
                        ),
                        historyItems = listOf(
                            HistoryItemPreview(
                                kind = HistoryItemKind.Command,
                                title = "command",
                                status = ToolStatus.Completed,
                                summary = "./gradlew :app:assembleDebug",
                                detail = "BUILD SUCCESSFUL in 17s\n35 actionable tasks: 35 executed",
                                actionLabel = "Command Output",
                                meta = "turn 12",
                            ),
                            HistoryItemPreview(
                                kind = HistoryItemKind.FileRead,
                                title = "file_read",
                                status = ToolStatus.Completed,
                                summary = "packages/thread-ui/src/components/graph-chat/GraphChatHistoryItems.tsx",
                                detail = "Read command, web search, file read, file change, artifact, hook, and grouped history item renderers.",
                                actionLabel = "File Read Details",
                            ),
                            HistoryItemPreview(
                                kind = HistoryItemKind.WebSearch,
                                title = "web_search",
                                status = ToolStatus.Completed,
                                summary = "Checked Android Compose layout affordances for bottom tool panels and process drawers.",
                                detail = "Native shell and composer controls should use platform touch targets and avoid desktop-only hover behavior.",
                                actionLabel = "Web Search Details",
                            ),
                            HistoryItemPreview(
                                kind = HistoryItemKind.FileChange,
                                title = "file_change",
                                status = ToolStatus.Completed,
                                summary = "apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTimelineComponents.kt",
                                detail = "Added native history item cards below assistant messages.",
                                actionLabel = "File Change Details",
                                addedLines = 214,
                                removedLines = 0,
                            ),
                            HistoryItemPreview(
                                kind = HistoryItemKind.Artifact,
                                title = "chemistry.molecule3d",
                                status = ToolStatus.Completed,
                                summary = "Ethanol molecule preview is available in the workspace artifact pane.",
                                detail = "XYZ, 9 atoms, 1 frame",
                                actionLabel = "Inspect",
                            ),
                            HistoryItemPreview(
                                kind = HistoryItemKind.Image,
                                title = "image",
                                status = ToolStatus.Completed,
                                summary = "Generated mobile shell preview screenshot placeholder.",
                                detail = "apps/android/output/shell-preview.png",
                                actionLabel = "Image Path",
                                assetPath = "apps/android/output/shell-preview.png",
                                imageLabel = "Shell preview",
                            ),
                        ),
                        historyGroups = listOf(
                            HistoryGroupPreview(
                                kind = HistoryItemKind.Command,
                                title = "command_batch",
                                countLabel = "3 commands",
                                statusLabel = "1 running",
                                expandedByDefault = true,
                                items = listOf(
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.Command,
                                        title = "command",
                                        status = ToolStatus.Completed,
                                        summary = "rg --files apps/android",
                                        detail = null,
                                        actionLabel = "Command Output",
                                    ),
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.Command,
                                        title = "command",
                                        status = ToolStatus.Completed,
                                        summary = "./gradlew :app:assembleDebug",
                                        detail = null,
                                        actionLabel = "Command Output",
                                    ),
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.Command,
                                        title = "command",
                                        status = ToolStatus.Running,
                                        summary = "aapt dump badging app-debug.apk",
                                        detail = null,
                                        actionLabel = "Command Output",
                                    ),
                                ),
                            ),
                            HistoryGroupPreview(
                                kind = HistoryItemKind.WebSearch,
                                title = "web_search_batch",
                                countLabel = "2 searches",
                                statusLabel = "design references",
                                items = listOf(
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.WebSearch,
                                        title = "web_search",
                                        status = ToolStatus.Completed,
                                        summary = "Compose bottom sheet and overlay interaction patterns",
                                        detail = "Use native touch targets, avoid hover-only affordances, keep detail overlays dismissible.",
                                        actionLabel = "Web Search Details",
                                    ),
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.WebSearch,
                                        title = "web_search",
                                        status = ToolStatus.Completed,
                                        summary = "Android terminal UI process list examples",
                                        detail = "Mobile terminal surfaces should keep process selection close to the active pane.",
                                        actionLabel = "Web Search Details",
                                    ),
                                ),
                            ),
                            HistoryGroupPreview(
                                kind = HistoryItemKind.FileRead,
                                title = "file_read_batch",
                                countLabel = "3 file reads",
                                statusLabel = "thread-ui references",
                                items = listOf(
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.FileRead,
                                        title = "file_read",
                                        status = ToolStatus.Completed,
                                        summary = "GraphChatHistoryItems.tsx",
                                        detail = "Read typed history item renderer branches.",
                                        actionLabel = "File Read Details",
                                    ),
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.FileRead,
                                        title = "file_read",
                                        status = ToolStatus.Completed,
                                        summary = "GraphChatHistoryGroupFrame.tsx",
                                        detail = "Read grouped batch frame treatment.",
                                        actionLabel = "File Read Details",
                                    ),
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.FileRead,
                                        title = "file_read",
                                        status = ToolStatus.Completed,
                                        summary = "LongTextDialog.tsx",
                                        detail = "Read full detail dialog structure.",
                                        actionLabel = "File Read Details",
                                    ),
                                ),
                            ),
                            HistoryGroupPreview(
                                kind = HistoryItemKind.FileChange,
                                title = "file_change_batch",
                                countLabel = "4 file changes",
                                statusLabel = "timeline components",
                                changedFiles = 4,
                                addedLines = 286,
                                removedLines = 12,
                                items = listOf(
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.FileChange,
                                        title = "file_change",
                                        status = ToolStatus.Completed,
                                        summary = "ThreadPreviewModels.kt",
                                        detail = null,
                                        actionLabel = "File Change Details",
                                        addedLines = 31,
                                        removedLines = 0,
                                    ),
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.FileChange,
                                        title = "file_change",
                                        status = ToolStatus.Completed,
                                        summary = "ThreadTimelineComponents.kt",
                                        detail = null,
                                        actionLabel = "File Change Details",
                                        addedLines = 219,
                                        removedLines = 8,
                                    ),
                                    HistoryItemPreview(
                                        kind = HistoryItemKind.FileChange,
                                        title = "file_change",
                                        status = ToolStatus.Completed,
                                        summary = "ThreadPreviewSample.kt",
                                        detail = null,
                                        actionLabel = "File Change Details",
                                        addedLines = 36,
                                        removedLines = 4,
                                    ),
                                ),
                            ),
                        ),
                    ),
                    MessagePreview(
                        author = MessageAuthor.Assistant,
                        status = ThreadStatus.Complete,
                        timeLabel = "13:42",
                        text = "Large assistant output preview.",
                        richText = largePlainTextMessage,
                    ),
                ),
            ),
            TurnPreview(
                index = 11,
                timeLabel = "13:28",
                statusLabel = "Complete",
                tokenSummary = "3.2k tokens",
                messages = listOf(
                    MessagePreview(
                        author = MessageAuthor.Assistant,
                        status = ThreadStatus.Complete,
                        timeLabel = "13:28",
                        text = "The first Kotlin Android skeleton is in place. The APK builds and the architecture doc records the path for API, auth, thread state, workspace, voice, and UI packages.",
                        historyItems = listOf(
                            HistoryItemPreview(
                                kind = HistoryItemKind.Context,
                                title = "context",
                                status = ToolStatus.Completed,
                                summary = "Context compacted after Android skeleton setup.",
                                detail = "Architecture doc now records API, auth, thread-state, workspace, voice, and UI package boundaries.",
                                actionLabel = null,
                            ),
                            HistoryItemPreview(
                                kind = HistoryItemKind.Plan,
                                title = "plan",
                                status = ToolStatus.Completed,
                                summary = "Build Android skeleton, verify APK, document long-term package boundaries.",
                                detail = null,
                                actionLabel = null,
                            ),
                        ),
                    ),
                ),
            ),
        ),
        timelineAuxiliary = TimelineAuxiliaryPreview(
            canLoadEarlier = true,
            loadingEarlier = false,
            activityNotes = listOf(
                TimelineNotePreview(
                    title = "Supervisor reconnected",
                    summaryLines = listOf("Socket resumed and timeline projection refreshed from thread detail."),
                    timeLabel = "13:40",
                ),
            ),
            answeredRequestNotes = listOf(
                TimelineNotePreview(
                    title = "Permission answered",
                    summaryLines = listOf(
                        "Approved Android debug build.",
                        "./gradlew :app:assembleDebug",
                    ),
                    timeLabel = "13:42",
                ),
            ),
            pendingSteers = listOf(
                TimelineSteerPreview(
                    prompt = "After the build, continue with ThreadTimeline top-level parity.",
                    statusLabel = "Accepted",
                    timeLabel = "13:43",
                ),
            ),
            ephemeralUserNote = "Keep going component by component; do not wait for emulator access.",
        ),
        pendingRequest = PendingRequestPreview(
            title = "Permission required",
            description = "Codex wants to run the Android debug build from the project workspace.",
            command = "./gradlew :app:assembleDebug",
            riskLabel = "Workspace write, local build",
        ),
        workspacePreview = WorkspacePreview(
            title = "Workspace",
            rootLabel = "remoteCodex-main",
            nodes = buildWorkspaceTreeNodes(
                selectedPath = "apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTimelineComponents.kt",
                paths = listOf(
                    WorkspaceTreePath("apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadTimelineComponents.kt"),
                    WorkspaceTreePath("apps/android/app/src/main/java/com/remotecodex/android/ui/components/ThreadComposer.kt"),
                    WorkspaceTreePath("docs/android-client-architecture.md"),
                    WorkspaceTreePath("artifacts/molecule-preview.xyz", WorkspaceNodeKind.Artifact),
                ),
            ),
            selectedFile = WorkspaceFilePreview(
                title = "ThreadTimelineComponents.kt",
                language = "kotlin",
                sizeLabel = "11,842 bytes",
                truncatedLabel = "showing 24,000 byte preview",
                content = """
                    @Composable
                    fun ThreadTimeline(turns: List<TurnPreview>) {
                        LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            contentPadding = PaddingValues(bottom = 132.dp),
                        ) {
                            items(turns, key = { it.index }) { turn ->
                                TurnFrame(turn = turn)
                            }
                        }
                    }
                """.trimIndent(),
            ),
            toolEvents = listOf(
                ToolCallPreview(
                    name = "file.read",
                    status = ToolStatus.Completed,
                    parameters = listOf("path" to "packages/thread-ui/src/styles.css"),
                    result = "Loaded graph-chat color tokens and message surface rules.",
                ),
                ToolCallPreview(
                    name = "shell.exec",
                    status = ToolStatus.Completed,
                    parameters = listOf("cmd" to "aapt dump badging app-debug.apk"),
                    result = "sdkVersion:'29'\ntargetSdkVersion:'34'",
                ),
            ),
            artifact = ArtifactPreview(
                id = "artifact-ethanol",
                title = "Ethanol molecule preview",
                type = "chemistry.molecule3d",
                summary = "Small XYZ structure used for renderer smoke checks.",
                format = "XYZ",
                atomCount = 9,
                frameCount = 1,
                sourcePreview = """
                    9
                    ethanol
                    C -0.748 0.015 0.024
                    C 0.748 -0.015 -0.024
                    O 1.420 1.172 0.210
                    H -1.111 -0.992 -0.173
                    H -1.129 0.698 -0.739
                """.trimIndent(),
            ),
            garbageFiles = listOf(
                "garbage/tmp-agent-plan.md",
                "garbage/shell-output-2026-06-10.log",
                "garbage/molecule-preview-old.xyz",
            ),
        ),
        shellPreview = ShellPreview(
            title = "Thread shell",
            status = "Attached",
            prompt = "remoteCodex-main %",
            lines = listOf(
                "remoteCodex-main % ./gradlew :app:assembleDebug",
                "> Task :app:compileDebugKotlin UP-TO-DATE",
                "> Task :app:packageDebug UP-TO-DATE",
                "BUILD SUCCESSFUL in 609ms",
                "remoteCodex-main %",
            ),
            controls = listOf("Paste", "Copy", "Clear", "Ctrl-C", "Ctrl-D", "Esc", "Tab", "Up", "Down"),
            processes = listOf(
                ShellProcessPreview(
                    id = "shell-build",
                    label = "Build shell",
                    cwd = "~/dev/remoteCodex-main/apps/android",
                    status = "attached",
                    runningCommand = "./gradlew :app:assembleDebug",
                    active = true,
                ),
                ShellProcessPreview(
                    id = "shell-root",
                    label = "Workspace shell",
                    cwd = "~/dev/remoteCodex-main",
                    status = "idle",
                    runningCommand = null,
                ),
                ShellProcessPreview(
                    id = "shell-api",
                    label = "Supervisor API",
                    cwd = "~/dev/remoteCodex-main/apps/supervisor-api",
                    status = "running",
                    runningCommand = "pnpm test --watch",
                ),
            ),
            activeProcessId = "shell-build",
            connectionLabel = "Connected",
            inputEnabled = true,
            commandRunning = true,
        ),
    )
}
