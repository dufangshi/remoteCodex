package com.remotecodex.android.ui.presentation

import org.junit.Assert.assertEquals
import org.junit.Test

class MathPresentationTest {
    @Test
    fun tokenizesSuperscriptsAndSubscripts() {
        assertEquals(
            MathPresentation(
                tokens = listOf(
                    MathToken.Text("E = mc"),
                    MathToken.Superscript("2"),
                    MathToken.Text(" + x"),
                    MathToken.Subscript("i"),
                ),
                copyText = "E = mc^2 + x_i",
            ),
            buildMathPresentation("E = mc^2 + x_i"),
        )
    }

    @Test
    fun tokenizesBracedScripts() {
        assertEquals(
            listOf(
                MathToken.Text("x"),
                MathToken.Superscript("n+1"),
                MathToken.Text(" + y"),
                MathToken.Subscript("total"),
            ),
            buildMathPresentation("x^{n+1} + y_{total}").tokens,
        )
    }

    @Test
    fun normalizesCommonLatexStructures() {
        assertEquals(
            listOf(
                MathToken.Text("(a+b)/(c) + sqrt(x) <= alpha"),
            ),
            buildMathPresentation("""\frac{a+b}{c} + \sqrt{x} \leq \alpha""").tokens,
        )
    }
}
