package com.remotecodex.android.ui.components

import androidx.compose.runtime.Composable
import com.remotecodex.android.ui.model.HistoryGroupPreview
import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.HistoryItemPreview
import com.remotecodex.android.ui.model.ToolStatus

sealed interface GraphChatHistoryEntry {
    val key: String

    data class Item(
        override val key: String,
        val item: HistoryItemPreview,
    ) : GraphChatHistoryEntry

    data class CommandGroup(
        override val key: String,
        val group: HistoryGroupPreview,
    ) : GraphChatHistoryEntry

    data class FileChangeGroup(
        override val key: String,
        val group: HistoryGroupPreview,
    ) : GraphChatHistoryEntry

    data class SearchGroup(
        override val key: String,
        val group: HistoryGroupPreview,
    ) : GraphChatHistoryEntry

    data class FileReadGroup(
        override val key: String,
        val group: HistoryGroupPreview,
    ) : GraphChatHistoryEntry
}

@Composable
fun GraphChatHistoryEntries(
    entries: List<GraphChatHistoryEntry>,
    renderCommandGroup: @Composable (GraphChatHistoryEntry.CommandGroup) -> Unit,
    renderFileChangeGroup: @Composable (GraphChatHistoryEntry.FileChangeGroup) -> Unit,
    renderFileReadGroup: @Composable (GraphChatHistoryEntry.FileReadGroup) -> Unit,
    renderItem: @Composable (GraphChatHistoryEntry.Item) -> Unit,
    renderSearchGroup: @Composable (GraphChatHistoryEntry.SearchGroup) -> Unit,
) {
    entries.forEach { entry ->
        when (entry) {
            is GraphChatHistoryEntry.CommandGroup -> renderCommandGroup(entry)
            is GraphChatHistoryEntry.FileChangeGroup -> renderFileChangeGroup(entry)
            is GraphChatHistoryEntry.FileReadGroup -> renderFileReadGroup(entry)
            is GraphChatHistoryEntry.Item -> renderItem(entry)
            is GraphChatHistoryEntry.SearchGroup -> renderSearchGroup(entry)
        }
    }
}

fun buildGraphChatHistoryEntries(
    items: List<HistoryItemPreview>,
    groups: List<HistoryGroupPreview>,
): List<GraphChatHistoryEntry> {
    return buildList {
        addAll(groupConsecutiveHistoryItems(items))
        groups.forEachIndexed { index, group ->
            add(group.toGraphChatHistoryEntry(index))
        }
    }
}

private fun groupConsecutiveHistoryItems(
    items: List<HistoryItemPreview>,
): List<GraphChatHistoryEntry> {
    return buildList {
        var index = 0
        while (index < items.size) {
            val current = items[index]
            val groupableKind = current.kind.takeIf { it.isConsecutiveHistoryGroupKind() }
            if (groupableKind == null) {
                add(GraphChatHistoryEntry.Item(key = current.itemKey(index), item = current))
                index += 1
                continue
            }

            val startIndex = index
            val groupedItems = mutableListOf<HistoryItemPreview>()
            while (index < items.size && items[index].kind == groupableKind) {
                groupedItems.add(items[index])
                index += 1
            }

            if (groupedItems.size == 1) {
                add(
                    GraphChatHistoryEntry.Item(
                        key = groupedItems.first().itemKey(startIndex),
                        item = groupedItems.first(),
                    ),
                )
            } else {
                add(groupedItems.toHistoryGroupEntry(kind = groupableKind, startIndex = startIndex))
            }
        }
    }
}

private fun HistoryItemKind.isConsecutiveHistoryGroupKind(): Boolean {
    return this == HistoryItemKind.Command ||
        this == HistoryItemKind.FileChange ||
        this == HistoryItemKind.FileRead ||
        this == HistoryItemKind.WebSearch
}

private fun HistoryItemPreview.itemKey(index: Int): String {
    return "item:$kind:$title:$index"
}

private fun List<HistoryItemPreview>.toHistoryGroupEntry(
    kind: HistoryItemKind,
    startIndex: Int,
): GraphChatHistoryEntry {
    val group = HistoryGroupPreview(
        kind = kind,
        title = kind.consecutiveGroupTitle(),
        countLabel = kind.consecutiveGroupCountLabel(size),
        statusLabel = consecutiveGroupStatusLabel(),
        items = this,
        changedFiles = if (kind == HistoryItemKind.FileChange) sumOfPositiveValues { it.changedFiles } else null,
        addedLines = if (kind == HistoryItemKind.FileChange) sumOfPositiveValues { it.addedLines } else null,
        removedLines = if (kind == HistoryItemKind.FileChange) sumOfPositiveValues { it.removedLines } else null,
    )
    val key = joinToString(separator = ":") { item -> "${item.kind}:${item.title}" }
        .ifBlank { "group:$kind:$startIndex" }
    return group.toGraphChatHistoryEntry(index = startIndex, keyOverride = key)
}

private fun List<HistoryItemPreview>.consecutiveGroupStatusLabel(): String? {
    return when {
        any { item -> item.status == ToolStatus.Running } -> "running"
        else -> firstNotNullOfOrNull { item -> item.status?.name?.lowercase() }
    }
}

private fun List<HistoryItemPreview>.sumOfPositiveValues(
    selector: (HistoryItemPreview) -> Int?,
): Int? {
    val total = sumOf { item -> selector(item)?.takeIf { it > 0 } ?: 0 }
    return total.takeIf { it > 0 }
}

private fun HistoryItemKind.consecutiveGroupTitle(): String {
    return when (this) {
        HistoryItemKind.Command -> "command_batch"
        HistoryItemKind.FileChange -> "file_change_batch"
        HistoryItemKind.FileRead -> "file_read_batch"
        HistoryItemKind.WebSearch -> "web_search_batch"
        else -> "history_batch"
    }
}

private fun HistoryItemKind.consecutiveGroupCountLabel(count: Int): String {
    val noun = when (this) {
        HistoryItemKind.Command -> "command"
        HistoryItemKind.FileChange -> "file change"
        HistoryItemKind.FileRead -> "file read"
        HistoryItemKind.WebSearch -> "search"
        else -> "entry"
    }
    if (this == HistoryItemKind.WebSearch && count != 1) {
        return "$count searches"
    }
    return "$count ${if (count == 1) noun else "${noun}s"}"
}

private fun HistoryGroupPreview.toGraphChatHistoryEntry(index: Int): GraphChatHistoryEntry {
    return toGraphChatHistoryEntry(index = index, keyOverride = null)
}

private fun HistoryGroupPreview.toGraphChatHistoryEntry(
    index: Int,
    keyOverride: String?,
): GraphChatHistoryEntry {
    val key = keyOverride ?: "group:$kind:$title:$index"
    return when (kind) {
        HistoryItemKind.Command -> GraphChatHistoryEntry.CommandGroup(key = key, group = this)
        HistoryItemKind.FileChange -> GraphChatHistoryEntry.FileChangeGroup(key = key, group = this)
        HistoryItemKind.FileRead -> GraphChatHistoryEntry.FileReadGroup(key = key, group = this)
        HistoryItemKind.WebSearch -> GraphChatHistoryEntry.SearchGroup(key = key, group = this)
        else -> GraphChatHistoryEntry.Item(
            key = key,
            item = items.firstOrNull()
                ?: HistoryItemPreview(
                    kind = kind,
                    title = title,
                    status = null,
                    summary = statusLabel ?: countLabel,
                    detail = null,
                    actionLabel = null,
                ),
        )
    }
}
