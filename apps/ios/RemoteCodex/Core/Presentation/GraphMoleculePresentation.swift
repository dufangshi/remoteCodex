import Foundation

struct GraphMoleculeViewerData: Equatable {
    var format: String
    var frames: [String]
    var exportContent: String
}

struct MoleculeAtomPreview: Equatable {
    var element: String
    var coordinateX: Double
    var coordinateY: Double
    var coordinateZ: Double
}

struct MoleculeCanvasAtom: Equatable {
    var element: String
    var positionX: Double
    var positionY: Double
    var depth: Double
    var radius: Double
}

struct MoleculeBondPreview: Equatable {
    var startIndex: Int
    var endIndex: Int
}

struct MoleculeFallbackPreviewModel: Equatable {
    var format: String
    var frameCount: Int
    var atoms: [MoleculeCanvasAtom]
    var bonds: [MoleculeBondPreview]
    var sourcePreview: String
}

func normalizeMoleculeFormat(_ format: String?) -> String {
    let normalized = format?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    if normalized.isEmpty || normalized == "extxyz" {
        return "xyz"
    }
    return normalized
}

func splitXyzTrajectory(_ content: String) -> [String] {
    if content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return [content]
    }

    let lines = normalizedMoleculeLines(content)
    var frames: [String] = []
    var index = 0

    while index < lines.count {
        while index < lines.count, lines[index].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            index += 1
        }
        if index >= lines.count { break }

        guard let atomCount = Int(lines[index].trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return [content]
        }
        let frameEnd = index + atomCount + 2
        if atomCount < 0 || frameEnd > lines.count {
            return [content]
        }

        frames.append(trimMoleculeRight(lines[index ..< frameEnd].joined(separator: "\n")))
        index = frameEnd
    }

    return frames.isEmpty ? [content] : frames
}

func readGraphMoleculeViewerData(source: String, format: String?) -> GraphMoleculeViewerData {
    let normalizedFormat = normalizeMoleculeFormat(format)
    let frames = normalizedFormat == "xyz" ? splitXyzTrajectory(source) : [source]
    return GraphMoleculeViewerData(
        format: normalizedFormat,
        frames: frames,
        exportContent: joinMoleculeFramesForExport(frames)
    )
}

func looksLikeMoleculeStructure(_ content: String, format: String?) -> Bool {
    switch normalizeMoleculeFormat(format) {
    case "xyz":
        looksLikeXyzMolecule(content)
    case "pdb":
        looksLikePdbMolecule(content)
    case "cif":
        looksLikeCifMolecule(content)
    default:
        false
    }
}

func parseXyzAtoms(_ frame: String) -> [MoleculeAtomPreview] {
    let lines = normalizedMoleculeLines(frame)
    guard let firstDataLine = lines.firstIndex(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
        return []
    }

    let declaredCount = Int(lines[firstDataLine].trimmingCharacters(in: .whitespacesAndNewlines))
    let atomLines: ArraySlice<String> = if let declaredCount {
        lines.dropFirst(firstDataLine + 2).prefix(declaredCount)
    } else {
        lines.dropFirst(firstDataLine)
    }

    return atomLines.compactMap { line in
        let parts = line.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
        guard parts.count >= 4, parts[0].contains(where: \.isLetter) else { return nil }
        guard
            let coordinateX = Double(parts[1]),
            let coordinateY = Double(parts[2]),
            let coordinateZ = Double(parts[3])
        else { return nil }
        return MoleculeAtomPreview(
            element: normalizedElementSymbol(parts[0]),
            coordinateX: coordinateX,
            coordinateY: coordinateY,
            coordinateZ: coordinateZ
        )
    }
}

func isMoleculeCodeBlock(language: String, code: String) -> Bool {
    let normalized = language.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard ["xyz", "extxyz", "cif", "pdb"].contains(normalized) else { return false }
    return looksLikeMoleculeStructure(code, format: normalized)
}

func buildMoleculeFallbackPreview(
    data: GraphMoleculeViewerData,
    width: Double = 320,
    height: Double = 170
) -> MoleculeFallbackPreviewModel {
    let atoms = data.frames.first.map(parseXyzAtoms) ?? []
    let projected = projectMoleculeAtoms(atoms: atoms, width: width, height: height, padding: 24)
    let canvasAtoms = projected.isEmpty ? defaultMoleculeCanvasAtoms(width: width, height: height) : projected
    return MoleculeFallbackPreviewModel(
        format: data.format,
        frameCount: data.frames.count,
        atoms: canvasAtoms,
        bonds: estimateMoleculeBonds(canvasAtoms),
        sourcePreview: trimMoleculeRight(data.exportContent).components(separatedBy: .newlines).prefix(10).joined(separator: "\n")
    )
}

private func joinMoleculeFramesForExport(_ frames: [String]) -> String {
    trimMoleculeRight(frames.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.joined(separator: "\n")) + "\n"
}

private func looksLikeXyzMolecule(_ content: String) -> Bool {
    let lines = normalizedMoleculeLines(content)
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    guard lines.count >= 3, let atomCount = Int(lines[0]), atomCount > 0, lines.count >= atomCount + 2 else {
        return false
    }
    return lines.dropFirst(2).prefix(atomCount).allSatisfy { line in
        let parts = line.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
        guard parts.count >= 4 else { return false }
        let validElement = moleculeStringMatches(parts[0], pattern: #"^([A-Za-z][A-Za-z]?|\d+)$"#)
        return validElement && Double(parts[1]) != nil && Double(parts[2]) != nil && Double(parts[3]) != nil
    }
}

private func looksLikePdbMolecule(_ content: String) -> Bool {
    content.components(separatedBy: .newlines).contains { line in
        moleculeStringMatches(line, pattern: #"^(ATOM|HETATM)\s+"#, options: [.caseInsensitive])
    }
}

private func looksLikeCifMolecule(_ content: String) -> Bool {
    moleculeStringMatches(content, pattern: #"\bdata_[^\s]*"#, options: [.caseInsensitive]) &&
        moleculeStringMatches(content, pattern: #"_atom_site\."#, options: [.caseInsensitive])
}

private func projectMoleculeAtoms(atoms: [MoleculeAtomPreview], width: Double, height: Double, padding: Double) -> [MoleculeCanvasAtom] {
    guard !atoms.isEmpty else { return [] }
    let minX = atoms.map(\.coordinateX).min() ?? 0
    let maxX = atoms.map(\.coordinateX).max() ?? 0
    let minY = atoms.map(\.coordinateY).min() ?? 0
    let maxY = atoms.map(\.coordinateY).max() ?? 0
    let xRange = max(0.001, maxX - minX)
    let yRange = max(0.001, maxY - minY)
    let drawableWidth = max(1, width - padding * 2)
    let drawableHeight = max(1, height - padding * 2)
    let scale = min(drawableWidth / xRange, drawableHeight / yRange)
    let moleculeWidth = xRange * scale
    let moleculeHeight = yRange * scale
    let offsetX = (width - moleculeWidth) / 2
    let offsetY = (height - moleculeHeight) / 2

    return atoms.map { atom in
        MoleculeCanvasAtom(
            element: atom.element,
            positionX: offsetX + (atom.coordinateX - minX) * scale,
            positionY: height - (offsetY + (atom.coordinateY - minY) * scale),
            depth: atom.coordinateZ,
            radius: moleculeElementRadius(atom.element)
        )
    }
}

private func estimateMoleculeBonds(_ atoms: [MoleculeCanvasAtom]) -> [MoleculeBondPreview] {
    guard atoms.count >= 2 else { return [] }
    let nearest = Array(atoms.indices).compactMap { index -> MoleculeBondPreview? in
        let candidates = Array(atoms.indices)
            .filter { $0 != index }
            .map { other in
                (other, distanceBetween(atoms[index], atoms[other]))
            }
        guard let candidate = candidates.min(by: { $0.1 < $1.1 }) else { return nil }
        return MoleculeBondPreview(startIndex: min(index, candidate.0), endIndex: max(index, candidate.0))
    }

    return nearest.reduce(into: [MoleculeBondPreview]()) { result, bond in
        if !result.contains(bond), result.count < atoms.count + 2 {
            result.append(bond)
        }
    }
}

private func distanceBetween(_ start: MoleculeCanvasAtom, _ end: MoleculeCanvasAtom) -> Double {
    let deltaX = start.positionX - end.positionX
    let deltaY = start.positionY - end.positionY
    return (deltaX * deltaX + deltaY * deltaY).squareRoot()
}

private func defaultMoleculeCanvasAtoms(width: Double, height: Double) -> [MoleculeCanvasAtom] {
    [
        MoleculeCanvasAtom(element: "C", positionX: width * 0.34, positionY: height * 0.50, depth: 0, radius: moleculeElementRadius("C")),
        MoleculeCanvasAtom(element: "C", positionX: width * 0.50, positionY: height * 0.42, depth: 1, radius: moleculeElementRadius("C")),
        MoleculeCanvasAtom(element: "O", positionX: width * 0.66, positionY: height * 0.56, depth: 2, radius: moleculeElementRadius("O"))
    ]
}

private func moleculeElementRadius(_ element: String) -> Double {
    switch element.uppercased() {
    case "H":
        8.5
    case "C":
        11
    case "N", "O":
        12
    case "S", "P":
        13
    default:
        10.5
    }
}

private func normalizedElementSymbol(_ value: String) -> String {
    guard let first = value.first else { return value }
    return String(first).uppercased() + value.dropFirst().lowercased()
}

private func normalizedMoleculeLines(_ content: String) -> [String] {
    content.replacingOccurrences(of: "\r\n", with: "\n")
        .replacingOccurrences(of: "\r", with: "\n")
        .components(separatedBy: "\n")
}

private func moleculeStringMatches(_ value: String, pattern: String, options: NSRegularExpression.Options = []) -> Bool {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: options) else { return false }
    let range = NSRange(value.startIndex ..< value.endIndex, in: value)
    return regex.firstMatch(in: value, range: range) != nil
}

private func trimMoleculeRight(_ value: String) -> String {
    String(value.reversed().drop(while: { $0.isWhitespace || $0.isNewline }).reversed())
}
