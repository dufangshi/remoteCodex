import Foundation

@MainActor
extension ThreadDetailViewModel {
    var exportTurnIds: [String] {
        presentation?.exportTurns.map(\.id) ?? []
    }

    var selectedExportTurnCount: Int {
        selectedExportTurnIds.intersection(Set(exportTurnIds)).count
    }

    var selectedExportTurnIdsInOrder: [String] {
        exportTurnIds.filter { selectedExportTurnIds.contains($0) }
    }

    func selectAllExportTurns() {
        selectedExportTurnIds = Set(exportTurnIds)
    }

    func clearSelectedExportTurns() {
        selectedExportTurnIds.removeAll()
    }
}
