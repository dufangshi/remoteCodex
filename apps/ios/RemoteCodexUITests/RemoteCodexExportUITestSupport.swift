import XCTest

extension RemoteCodexUITests {
    @MainActor
    func testThreadExportFixtureExportsPDFAndHTMLCustomTurns() {
        let app = XCUIApplication()
        app.launchArguments = ["--reset-settings", "--ui-test-workspace-fixture", "--ui-test-thread-route"]
        app.launch()

        openExportDialog(in: app)
        XCTAssertTrue(tapElement(app.buttons["Custom"], in: app, maxSwipes: 2))
        XCTAssertTrue(tapElement(app.buttons["thread-export-submit"], in: app, maxSwipes: 2))
        XCTAssertTrue(app.buttons["Share fixture-thread.pdf"].waitForExistence(timeout: 5))

        openExportDialog(in: app)
        XCTAssertTrue(tapElement(app.buttons["HTML"], in: app, maxSwipes: 2))
        XCTAssertTrue(tapElement(app.buttons["thread-export-submit"], in: app, maxSwipes: 2))
        XCTAssertTrue(app.buttons["Share fixture-thread.html"].waitForExistence(timeout: 5))
    }

    @MainActor
    private func openExportDialog(in app: XCUIApplication) {
        XCTAssertTrue(tapElement(app.buttons["thread-export-transcript"], in: app, maxSwipes: 12))
        XCTAssertTrue(app.navigationBars["Export"].waitForExistence(timeout: 5))
    }
}
