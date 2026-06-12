package com.remotecodex.android.ui.presentation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GraphMoleculeViewerDataTest {
    @Test
    fun normalizesExtxyzToXyz() {
        assertEquals("xyz", normalizeMoleculeFormat("extxyz"))
        assertEquals("xyz", normalizeMoleculeFormat(null))
        assertEquals("cif", normalizeMoleculeFormat("CIF"))
    }

    @Test
    fun splitsConcatenatedXyzTrajectoryIntoFrames() {
        val source = """
            2
            first frame
            H 0.0 0.0 0.0
            O 0.0 0.0 1.0

            1
            second frame
            C 1.0 2.0 3.0
        """.trimIndent()

        val data = readGraphMoleculeViewerData(source, "XYZ")

        assertEquals("xyz", data.format)
        assertEquals(2, data.frames.size)
        assertTrue(data.frames[0].contains("first frame"))
        assertTrue(data.frames[1].contains("second frame"))
        assertEquals("2\nfirst frame\nH 0.0 0.0 0.0\nO 0.0 0.0 1.0\n1\nsecond frame\nC 1.0 2.0 3.0\n", data.exportContent)
    }

    @Test
    fun invalidXyzFallsBackToSingleSourceFrame() {
        val source = """
            ethanol
            C 0 0 0
            O 1 0 0
        """.trimIndent()

        val frames = splitXyzTrajectory(source)

        assertEquals(listOf(source), frames)
    }

    @Test
    fun parsesAtomsFromFirstXyzFrame() {
        val frame = """
            3
            ethanol fragment
            C -0.7 0.0 0.0
            C 0.7 0.1 0.0
            O 1.5 0.2 0.5
        """.trimIndent()

        val atoms = parseXyzAtoms(frame)

        assertEquals(3, atoms.size)
        assertEquals("C", atoms[0].element)
        assertEquals(-0.7f, atoms[0].x)
        assertEquals("O", atoms[2].element)
        assertEquals(0.5f, atoms[2].z)
    }

    @Test
    fun recognizesLikelyMoleculeStructures() {
        val xyz = """
            2
            water
            O 0.0 0.0 0.0
            H 0.0 0.0 0.9
        """.trimIndent()
        val pdb = "ATOM      1  N   GLY A   1      11.104  13.207   9.723"
        val cif = """
            data_example
            _atom_site.label_atom_id
        """.trimIndent()

        assertEquals(true, looksLikeMoleculeStructure(xyz, "xyz"))
        assertEquals(true, looksLikeMoleculeStructure(xyz, "extxyz"))
        assertEquals(true, looksLikeMoleculeStructure(pdb, "pdb"))
        assertEquals(true, looksLikeMoleculeStructure(cif, "cif"))
        assertEquals(false, looksLikeMoleculeStructure("file contents...", "xyz"))
        assertEquals(false, looksLikeMoleculeStructure("...", "xyz"))
    }
}
