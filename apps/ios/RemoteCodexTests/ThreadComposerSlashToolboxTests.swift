@testable import RemoteCodex
import XCTest

final class ThreadComposerSlashToolboxTests: XCTestCase {
    func testParsesSlashQueryAndGoalArgument() {
        XCTAssertEqual(composerSlashCommandQuery("/goal Ship iOS"), "goal Ship iOS")
        XCTAssertEqual(
            composerSlashCommandArgument(prompt: "/goal Ship iOS", command: "/goal"),
            "Ship iOS"
        )
        XCTAssertNil(composerSlashCommandArgument(prompt: "/compact", command: "/goal"))
    }

    func testClearsPromptOnlyForMatchingSlashCommand() {
        XCTAssertEqual(composerPromptClearingSlashCommand("/compact", command: "/compact"), "")
        XCTAssertEqual(composerPromptClearingSlashCommand("/goal Ship iOS", command: "/goal"), "")
        XCTAssertEqual(composerPromptClearingSlashCommand("continue", command: "/compact"), "continue")
    }

    func testBuildsAndFiltersSlashItems() throws {
        let allItems = buildComposerSlashCommandItems(
            query: nil,
            fastMode: true,
            hasForkTargets: false,
            busy: false
        )

        XCTAssertEqual(allItems.map(\.command), ["/fast", "/compact", "/goal", "/fork", "/mcp", "/hooks", "/export"])
        XCTAssertEqual(allItems.first { $0.kind == .fast }?.status, "On")
        XCTAssertFalse(try XCTUnwrap(allItems.first { $0.kind == .fork }).enabled)

        let filtered = buildComposerSlashCommandItems(
            query: "go",
            fastMode: false,
            hasForkTargets: true,
            busy: false
        )

        XCTAssertEqual(filtered.map(\.command), ["/goal"])
    }
}
