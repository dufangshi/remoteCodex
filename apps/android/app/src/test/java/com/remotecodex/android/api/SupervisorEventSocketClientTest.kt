package com.remotecodex.android.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SupervisorEventSocketClientTest {
    @Test
    fun parsesThreadEventEnvelope() {
        val event = parseSupervisorThreadEvent(
            """
            {
              "type": "thread.output.delta",
              "threadId": "thread-1",
              "timestamp": "2026-06-11T20:00:00.000Z",
              "payload": {
                "turnId": "turn-1",
                "itemId": "item-1",
                "sequence": 1,
                "delta": "hello"
              }
            }
            """.trimIndent(),
        )

        assertEquals("thread.output.delta", event?.type)
        assertEquals("thread-1", event?.threadId)
        assertEquals("2026-06-11T20:00:00.000Z", event?.timestamp)
    }

    @Test
    fun ignoresNonThreadAndMalformedMessages() {
        assertNull(parseSupervisorThreadEvent("""{"type":"supervisor.connected","timestamp":"now"}"""))
        assertNull(
            parseSupervisorThreadEvent(
                """{"type":"shell.status","shellId":"shell-1","timestamp":"now","payload":{"threadId":"thread-1"}}""",
            ),
        )
        assertNull(parseSupervisorThreadEvent("""{"type":"thread.output.delta","payload":{}}"""))
        assertNull(parseSupervisorThreadEvent("not-json"))
    }
}
