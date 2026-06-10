package com.remotecodex.android.ui.components

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
}
