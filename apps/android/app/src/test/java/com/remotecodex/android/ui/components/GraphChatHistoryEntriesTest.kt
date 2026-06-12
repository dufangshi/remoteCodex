package com.remotecodex.android.ui.components

import com.remotecodex.android.ui.model.HistoryGroupPreview
import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.HistoryItemPreview
import com.remotecodex.android.ui.model.ToolStatus
import com.remotecodex.android.ui.presentation.graphChatHistoryGroupCountLabel
import org.junit.Assert.assertEquals
import org.junit.Test

class GraphChatHistoryEntriesTest {
    @Test
    fun extractsGroupCountBadgeLabels() {
        assertEquals("3", graphChatHistoryGroupCountLabel("3 commands"))
        assertEquals("12", graphChatHistoryGroupCountLabel("12 file reads"))
        assertEquals("4", graphChatHistoryGroupCountLabel("4 file changes"))
    }

    @Test
    fun fallsBackToCompactUppercaseCountLabels() {
        assertEquals("BA", graphChatHistoryGroupCountLabel("batch"))
        assertEquals("", graphChatHistoryGroupCountLabel(""))
    }

    @Test
    fun groupsConsecutiveCommandItemsFromFlatHistory() {
        val entries = buildGraphChatHistoryEntries(
            items = listOf(
                historyItem(HistoryItemKind.Command, "rg --files"),
                historyItem(HistoryItemKind.Command, "./gradlew test"),
                historyItem(HistoryItemKind.WebSearch, "Compose timeline"),
            ),
            groups = emptyList(),
        )

        assertEquals(2, entries.size)
        val commandGroup = entries[0] as GraphChatHistoryEntry.CommandGroup
        assertEquals("command_batch", commandGroup.group.title)
        assertEquals("2 commands", commandGroup.group.countLabel)
        assertEquals("completed", commandGroup.group.statusLabel)
        assertEquals(2, commandGroup.group.items.size)
        assertEquals("rg --files", commandGroup.group.items[0].summary)
        assertEquals(true, entries[1] is GraphChatHistoryEntry.Item)
    }

    @Test
    fun keepsSingleGroupableHistoryItemAsItem() {
        val entries = buildGraphChatHistoryEntries(
            items = listOf(historyItem(HistoryItemKind.FileRead, "ThreadTimeline.tsx")),
            groups = emptyList(),
        )

        assertEquals(1, entries.size)
        val item = entries.single() as GraphChatHistoryEntry.Item
        assertEquals(HistoryItemKind.FileRead, item.item.kind)
        assertEquals("ThreadTimeline.tsx", item.item.summary)
    }

    @Test
    fun groupsConsecutiveFileChangesWithDeltaTotals() {
        val entries = buildGraphChatHistoryEntries(
            items = listOf(
                historyItem(
                    kind = HistoryItemKind.FileChange,
                    summary = "ThreadPresentation.kt",
                    changedFiles = 1,
                    addedLines = 12,
                    removedLines = 3,
                ),
                historyItem(
                    kind = HistoryItemKind.FileChange,
                    summary = "ThreadTimelineComponents.kt",
                    changedFiles = 2,
                    addedLines = 5,
                    removedLines = 0,
                ),
            ),
            groups = emptyList(),
        )

        val fileChangeGroup = entries.single() as GraphChatHistoryEntry.FileChangeGroup
        assertEquals("file_change_batch", fileChangeGroup.group.title)
        assertEquals("2 file changes", fileChangeGroup.group.countLabel)
        assertEquals(3, fileChangeGroup.group.changedFiles)
        assertEquals(17, fileChangeGroup.group.addedLines)
        assertEquals(3, fileChangeGroup.group.removedLines)
    }

    @Test
    fun groupsConsecutiveWebSearchesWithSearchesLabelAndRunningStatus() {
        val entries = buildGraphChatHistoryEntries(
            items = listOf(
                historyItem(HistoryItemKind.WebSearch, "Compose", status = ToolStatus.Completed),
                historyItem(HistoryItemKind.WebSearch, "Android", status = ToolStatus.Running),
            ),
            groups = emptyList(),
        )

        val searchGroup = entries.single() as GraphChatHistoryEntry.SearchGroup
        assertEquals("web_search_batch", searchGroup.group.title)
        assertEquals("2 searches", searchGroup.group.countLabel)
        assertEquals("running", searchGroup.group.statusLabel)
    }

    @Test
    fun appendsExplicitHistoryGroupsAfterFlatEntries() {
        val entries = buildGraphChatHistoryEntries(
            items = listOf(historyItem(HistoryItemKind.Hook, "PreToolUse hook")),
            groups = listOf(
                HistoryGroupPreview(
                    kind = HistoryItemKind.WebSearch,
                    title = "web_search_batch",
                    countLabel = "2 searches",
                    statusLabel = null,
                    items = listOf(
                        historyItem(HistoryItemKind.WebSearch, "Compose"),
                        historyItem(HistoryItemKind.WebSearch, "Android"),
                    ),
                ),
            ),
        )

        assertEquals(true, entries[0] is GraphChatHistoryEntry.Item)
        assertEquals(true, entries[1] is GraphChatHistoryEntry.SearchGroup)
    }

    private fun historyItem(
        kind: HistoryItemKind,
        summary: String,
        status: ToolStatus = ToolStatus.Completed,
        changedFiles: Int? = null,
        addedLines: Int? = null,
        removedLines: Int? = null,
    ): HistoryItemPreview {
        return HistoryItemPreview(
            kind = kind,
            title = kind.name,
            status = status,
            summary = summary,
            detail = null,
            actionLabel = null,
            changedFiles = changedFiles,
            addedLines = addedLines,
            removedLines = removedLines,
        )
    }
}
