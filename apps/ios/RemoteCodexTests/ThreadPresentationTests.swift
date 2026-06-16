@testable import RemoteCodex
import XCTest

final class ThreadPresentationTests: XCTestCase {
    func testParsesBasicMarkdownBlocks() {
        let blocks = parseRichMessageBlocks(
            """
            ## Summary

            - first
            - second

            ```kotlin
            val value = 1
            ```
            """
        )

        XCTAssertEqual(
            blocks,
            [
                .heading(level: 2, text: "Summary"),
                .bullet(text: "first", level: 0),
                .bullet(text: "second", level: 0),
                .code(language: "kotlin", code: "val value = 1\n")
            ]
        )
    }

    func testParsesGfmBlocksTablesAndNestedLists() {
        let blocks = parseRichMessageBlocks(
            """
            > Keep this visible
            > across lines

            1. Read web renderer
            2. Port native behavior

            - [x] shipped
            - [ ] pending

            ---

            | Area | Count | State |
            | :--- | ---: | :---: |
            | Links | 3 | Done |
            | only first |

            - parent
              - child
                child continuation
            """
        )

        XCTAssertEqual(
            blocks,
            [
                .quote("Keep this visible\nacross lines"),
                .orderedItem(number: 1, text: "Read web renderer", level: 0),
                .orderedItem(number: 2, text: "Port native behavior", level: 0),
                .bullet(text: "shipped", checked: true, level: 0),
                .bullet(text: "pending", checked: false, level: 0),
                .horizontalRule,
                .table(
                    columns: [
                        RichTableColumn(header: "Area", alignment: .left),
                        RichTableColumn(header: "Count", alignment: .right),
                        RichTableColumn(header: "State", alignment: .center)
                    ],
                    rows: [
                        ["Links", "3", "Done"],
                        ["only first", "", ""]
                    ]
                ),
                .bullet(text: "parent", level: 0),
                .bullet(text: "child\nchild continuation", level: 1)
            ]
        )
    }

    func testParsesSetextHtmlMathAndCodeFenceInfoStrings() {
        let blocks = parseRichMessageBlocks(
            """
            Major heading
            =

            <details>
            <summary>Trace</summary>
            </details>

            ```swift title=Main.swift
            let value = 3
            ```

            $$a^2 + b^2 = c^2$$

            \\[x = y + z\\]
            """
        )

        XCTAssertEqual(
            blocks,
            [
                .heading(level: 1, text: "Major heading"),
                .html("<details>\n<summary>Trace</summary>\n</details>"),
                .code(language: "swift", code: "let value = 3\n"),
                .math("a^2 + b^2 = c^2"),
                .math("x = y + z")
            ]
        )
    }

    func testPlainTextInlineSegmentsAndLargePreview() {
        XCTAssertEqual(normalizeGraphChatHref("www.example.com/docs"), "https://www.example.com/docs")
        XCTAssertEqual(
            graphChatPlainTextSegments("Read [docs](docs/app.md), not ![chart](image.png), or www.example.com."),
            [
                .text("Read "),
                .url(text: "docs", href: "docs/app.md"),
                .text(", not "),
                .text("![chart](image.png)"),
                .text(", or "),
                .url(text: "www.example.com", href: "https://www.example.com"),
                .text(".")
            ]
        )
        XCTAssertEqual(
            graphChatInlineSegments("Use `code`, **strong**, *emphasis*, ~~old~~, ![screen](output/screen.png)."),
            [
                .text("Use "),
                .code("code"),
                .text(", "),
                .strong("strong"),
                .text(", "),
                .emphasis("emphasis"),
                .text(", "),
                .strikethrough("old"),
                .text(", "),
                .image(label: "screen", source: "output/screen.png"),
                .text(".")
            ]
        )
        let long = String(repeating: "a", count: largeMessagePreviewCharacters + 20)
        XCTAssertTrue(shouldShowGraphChatMessageExpansion(long))
        XCTAssertFalse(shouldShowGraphChatMessageExpansion(long, streaming: true))
        let expectedPreview = "\(String(repeating: "a", count: largeMessagePreviewCharacters))\n\n..."
        XCTAssertEqual(graphChatMessagePreviewText(long, expanded: false), expectedPreview)
        XCTAssertEqual(graphChatShowMoreLabel(charCount: largeMessagePreviewCharacters + 20), "Show more (4,020 chars)")
    }

    func testImageSourceSafetyAndUserAttachmentSegments() throws {
        XCTAssertTrue(isSafeMarkdownImageSource("output/screen-shot.png"))
        XCTAssertTrue(isSafeMarkdownImageSource("artifacts/chart.svg"))
        XCTAssertFalse(isSafeMarkdownImageSource("https://example.test/image.png"))
        XCTAssertFalse(isSafeMarkdownImageSource("data:image/png;base64,abc"))
        XCTAssertFalse(isSafeMarkdownImageSource("/tmp/image.png"))
        XCTAssertFalse(isSafeMarkdownImageSource("output/../secret.png"))

        let segments = parseUserMessageSegments(
            "Inspect:\n[PHOTO apps/ios/output/screen.png]\nthen [FILE docs/ios.md]."
        )
        XCTAssertEqual(
            segments,
            [
                .text("Inspect:\n"),
                .photo("apps/ios/output/screen.png"),
                .text("\nthen "),
                .file("docs/ios.md"),
                .text(".")
            ]
        )
        XCTAssertEqual(basenameFromAssetPath("C:\\Users\\u\\thread.log"), "thread.log")
        XCTAssertEqual(
            try XCTUnwrap(buildUserMessageAttachmentState(.photo("apps/ios/output/screen.png"))),
            UserMessageAttachmentState(
                kind: .photo,
                path: "apps/ios/output/screen.png",
                fileName: "screen.png",
                typeLabel: "PHOTO",
                fallbackLabel: "Attached image",
                accessibilityLabel: "image attachment: screen.png"
            )
        )
    }

    func testMathPresentationAndMarkdownHeuristics() {
        XCTAssertEqual(
            buildMathPresentation("E = mc^2 + x_i"),
            MathPresentation(
                tokens: [
                    .text("E = mc"),
                    .superscript("2"),
                    .text(" + x"),
                    .subscriptText("i")
                ],
                copyText: "E = mc^2 + x_i"
            )
        )
        XCTAssertEqual(
            buildMathPresentation(#"\frac{a+b}{c} + \sqrt{x} \leq \alpha"#).tokens,
            [.text("(a+b)/(c) + sqrt(x) <= alpha")]
        )
        XCTAssertTrue(hasLikelyMarkdownSyntax("Use $x + y$ inline."))
        XCTAssertTrue(hasLikelyMarkdownSyntax("\\[x = y\\]"))
    }

    func testInfersHistoryDetailContentTypes() {
        XCTAssertEqual(inferHistoryDetailContentType(kind: "toolCall", title: "result", text: #"{"items":[1,2]}"#), "application/json")
        XCTAssertEqual(inferHistoryDetailContentType(kind: "fileRead", title: "README.md", text: "# Title"), "text/markdown")
        XCTAssertEqual(
            inferHistoryDetailContentType(kind: "image", title: "screen.png", text: "screen.png", sourcePath: "output/screen.png"),
            "image/reference"
        )
        XCTAssertEqual(
            buildHistoryDetailPreview(
                kind: "fileRead",
                title: "config.json",
                text: #"{"ok":true}"#,
                contentType: "application/json",
                sourcePath: "config.json",
                assetPath: nil,
                fallback: HistoryDetailPreview(title: "Fallback", text: "fallback", contentType: "text/plain")
            ),
            HistoryDetailPreview(title: "config.json", text: #"{"ok":true}"#, contentType: "application/json", sourcePath: "config.json")
        )
    }
}
