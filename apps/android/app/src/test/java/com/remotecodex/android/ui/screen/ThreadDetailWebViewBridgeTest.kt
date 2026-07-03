package com.remotecodex.android.ui.screen

import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ThreadDetailWebViewBridgeTest {
    @Test
    fun parseNativeHttpBridgeRequestRejectsInvalidEnvelope() {
        val invalidJson = parseNativeHttpBridgeRequest("not-json")
        val missingRequestId = parseNativeHttpBridgeRequest("""{"url":"http://10.0.2.2:8821/api/threads"}""")

        assertTrue(invalidJson is NativeHttpBridgeRequestParseResult.Invalid)
        assertTrue(missingRequestId is NativeHttpBridgeRequestParseResult.Invalid)

        val response = JSONObject(invalidNativeHttpBridgeResponseJson(""))
        assertFalse(response.getBoolean("ok"))
        assertEquals(0, response.getInt("statusCode"))
        assertEquals("Invalid native HTTP request.", response.getString("error"))
    }

    @Test
    fun parseNativeHttpBridgeRequestKeepsMethodHeadersAndTextBody() {
        val parsed = parseNativeHttpBridgeRequest(
            """
            {
              "requestId": "req-1",
              "url": "http://10.0.2.2:8821/api/threads/thread-1/settings",
              "method": "patch",
              "headers": {
                "content-type": "application/json",
                "authorization": "Bearer token"
              },
              "body": "{\"model\":\"gpt-5\"}"
            }
            """.trimIndent(),
        ) as NativeHttpBridgeRequestParseResult.Valid

        assertEquals("req-1", parsed.requestId)
        assertEquals("PATCH", parsed.method)
        assertEquals("http://10.0.2.2:8821/api/threads/thread-1/settings", parsed.url)
        assertEquals("application/json", parsed.headers["content-type"])
        assertEquals("Bearer token", parsed.headers["authorization"])
        assertEquals("""{"model":"gpt-5"}""", parsed.bodyText)
        assertEquals(null, parsed.bodyBytes)
    }

    @Test
    fun parseNativeHttpBridgeRequestKeepsDeleteBase64Body() {
        val bodyBytes = """{"confirmWorkspaceId":"workspace-1"}""".toByteArray()
        val encodedBody = Base64.getEncoder().encodeToString(bodyBytes)
        val parsed = parseNativeHttpBridgeRequest(
            """
            {
              "requestId": "delete-1",
              "url": "http://10.0.2.2:8821/api/workspaces/workspace-1",
              "method": "DELETE",
              "headers": {"Content-Type": "application/json"},
              "bodyBase64": "$encodedBody"
            }
            """.trimIndent(),
        ) as NativeHttpBridgeRequestParseResult.Valid

        assertEquals("DELETE", parsed.method)
        assertEquals("application/json", parsed.headers["Content-Type"])
        assertEquals(null, parsed.bodyText)
        assertArrayEquals(bodyBytes, parsed.bodyBytes)
    }

    @Test
    fun nativeHttpBridgeResponseJsonIncludesTextAndBase64Bodies() {
        val bodyBytes = "ANDROID_WEB_THREAD_SERVER_OK".toByteArray()
        val response = JSONObject(
            nativeHttpBridgeResponseJson(
                requestId = "response-1",
                ok = true,
                statusCode = 200,
                headers = mapOf("Content-Type" to "application/json"),
                bodyBytes = bodyBytes,
            ),
        )

        assertEquals("response-1", response.getString("requestId"))
        assertTrue(response.getBoolean("ok"))
        assertEquals(200, response.getInt("statusCode"))
        assertEquals("application/json", response.getJSONObject("headers").getString("content-type"))
        assertEquals("ANDROID_WEB_THREAD_SERVER_OK", response.getString("body"))
        assertEquals(Base64.getEncoder().encodeToString(bodyBytes), response.getString("bodyBase64"))
        assertTrue(response.isNull("error"))
    }
}
