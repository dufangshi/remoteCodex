package com.remotecodex.android.ui.components

import androidx.compose.runtime.Composable
import com.remotecodex.android.ui.model.HistoryGroupPreview
import com.remotecodex.android.ui.model.HistoryItemKind
import com.remotecodex.android.ui.model.HistoryItemPreview

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
        items.forEachIndexed { index, item ->
            add(GraphChatHistoryEntry.Item(key = "item:${item.kind}:${item.title}:$index", item = item))
        }
        groups.forEachIndexed { index, group ->
            add(group.toGraphChatHistoryEntry(index))
        }
    }
}

private fun HistoryGroupPreview.toGraphChatHistoryEntry(index: Int): GraphChatHistoryEntry {
    val key = "group:$kind:$title:$index"
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
