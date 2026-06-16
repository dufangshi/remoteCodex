@testable import RemoteCodex
import XCTest

final class GraphMoleculePresentationTests: XCTestCase {
    func testNormalizesExtxyzToXyz() {
        XCTAssertEqual(normalizeMoleculeFormat("extxyz"), "xyz")
        XCTAssertEqual(normalizeMoleculeFormat(nil), "xyz")
        XCTAssertEqual(normalizeMoleculeFormat("CIF"), "cif")
    }

    func testSplitsConcatenatedXyzTrajectoryIntoFrames() {
        let source = """
        2
        first frame
        H 0.0 0.0 0.0
        O 0.0 0.0 1.0

        1
        second frame
        C 1.0 2.0 3.0
        """

        let data = readGraphMoleculeViewerData(source: source, format: "XYZ")

        XCTAssertEqual(data.format, "xyz")
        XCTAssertEqual(data.frames.count, 2)
        XCTAssertTrue(data.frames[0].contains("first frame"))
        XCTAssertTrue(data.frames[1].contains("second frame"))
        XCTAssertEqual(
            data.exportContent,
            "2\nfirst frame\nH 0.0 0.0 0.0\nO 0.0 0.0 1.0\n1\nsecond frame\nC 1.0 2.0 3.0\n"
        )
    }

    func testInvalidXyzFallsBackToSingleSourceFrame() {
        let source = """
        ethanol
        C 0 0 0
        O 1 0 0
        """

        XCTAssertEqual(splitXyzTrajectory(source), [source])
    }

    func testParsesAtomsFromFirstXyzFrame() throws {
        let frame = """
        3
        ethanol fragment
        C -0.7 0.0 0.0
        C 0.7 0.1 0.0
        O 1.5 0.2 0.5
        """

        let atoms = parseXyzAtoms(frame)

        XCTAssertEqual(atoms.count, 3)
        XCTAssertEqual(atoms[0].element, "C")
        XCTAssertEqual(atoms[0].coordinateX, -0.7, accuracy: 0.001)
        XCTAssertEqual(try XCTUnwrap(atoms.last).element, "O")
        XCTAssertEqual(try XCTUnwrap(atoms.last).coordinateZ, 0.5, accuracy: 0.001)
    }

    func testRecognizesLikelyMoleculeStructures() {
        let xyz = """
        2
        water
        O 0.0 0.0 0.0
        H 0.0 0.0 0.9
        """
        let pdb = "ATOM      1  N   GLY A   1      11.104  13.207   9.723"
        let cif = """
        data_example
        _atom_site.label_atom_id
        """

        XCTAssertTrue(looksLikeMoleculeStructure(xyz, format: "xyz"))
        XCTAssertTrue(looksLikeMoleculeStructure(xyz, format: "extxyz"))
        XCTAssertTrue(looksLikeMoleculeStructure(pdb, format: "pdb"))
        XCTAssertTrue(looksLikeMoleculeStructure(cif, format: "cif"))
        XCTAssertFalse(looksLikeMoleculeStructure("file contents...", format: "xyz"))
        XCTAssertFalse(looksLikeMoleculeStructure("...", format: "xyz"))
        XCTAssertTrue(isMoleculeCodeBlock(language: "xyz", code: xyz))
        XCTAssertFalse(isMoleculeCodeBlock(language: "swift", code: xyz))
    }

    func testBuildsFirstFrameFallbackPreviewModel() {
        let source = """
        3
        ethanol fragment
        C -0.7 0.0 0.0
        C 0.7 0.1 0.0
        O 1.5 0.2 0.5
        """
        let data = readGraphMoleculeViewerData(source: source, format: "xyz")

        let model = buildMoleculeFallbackPreview(data: data, width: 320, height: 170)

        XCTAssertEqual(model.format, "xyz")
        XCTAssertEqual(model.frameCount, 1)
        XCTAssertEqual(model.atoms.map(\.element), ["C", "C", "O"])
        XCTAssertFalse(model.bonds.isEmpty)
        XCTAssertTrue(model.sourcePreview.contains("ethanol fragment"))
    }

    func testNonXyzFallbackUsesDefaultSchematicAtoms() {
        let data = readGraphMoleculeViewerData(
            source: "ATOM      1  N   GLY A   1      11.104  13.207   9.723\n",
            format: "pdb"
        )

        let model = buildMoleculeFallbackPreview(data: data)

        XCTAssertEqual(model.format, "pdb")
        XCTAssertEqual(model.atoms.map(\.element), ["C", "C", "O"])
    }
}
