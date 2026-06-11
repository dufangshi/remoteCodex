package com.remotecodex.android.ui.presentation

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownImageSourcesTest {
    @Test
    fun allowsRelativeThreadAssetImagePaths() {
        assertTrue(isSafeMarkdownImageSource("output/screen-shot.png"))
        assertTrue(isSafeMarkdownImageSource("artifacts/chart.svg"))
        assertTrue(isSafeMarkdownImageSource("image.png"))
    }

    @Test
    fun rejectsRemoteAbsoluteAndTraversalSources() {
        assertFalse(isSafeMarkdownImageSource("https://example.test/image.png"))
        assertFalse(isSafeMarkdownImageSource("http://example.test/image.png"))
        assertFalse(isSafeMarkdownImageSource("data:image/png;base64,abc"))
        assertFalse(isSafeMarkdownImageSource("file:///tmp/image.png"))
        assertFalse(isSafeMarkdownImageSource("/tmp/image.png"))
        assertFalse(isSafeMarkdownImageSource("../secret.png"))
        assertFalse(isSafeMarkdownImageSource("output/../secret.png"))
    }
}
