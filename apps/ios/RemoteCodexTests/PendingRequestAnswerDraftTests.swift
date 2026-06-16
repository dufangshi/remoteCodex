@testable import RemoteCodex
import XCTest

final class PendingRequestAnswerDraftTests: XCTestCase {
    func testSingleSelectUsesSelectedOption() {
        let question = makeQuestion(
            id: "q1",
            multiSelect: false,
            options: [
                option("Approve"),
                option("Deny")
            ]
        )
        var draft = PendingRequestAnswerDraft()

        XCTAssertFalse(draft.hasAnswer(for: question))
        draft.toggle(label: "Approve", multiSelect: question.multiSelect)

        XCTAssertTrue(draft.hasAnswer(for: question))
        XCTAssertEqual(draft.answers(for: question), ["Approve"])
        XCTAssertEqual(
            pendingRequestAnswerPayload(questions: [question], drafts: ["q1": draft]),
            ["q1": ["Approve"]]
        )
    }

    func testOtherSelectionRequiresAndSubmitsCustomAnswer() {
        let question = makeQuestion(
            id: "q1",
            multiSelect: false,
            isOther: true,
            options: [option("Implement")]
        )
        var draft = PendingRequestAnswerDraft()
        draft.toggle(label: "Other", multiSelect: question.multiSelect)

        XCTAssertFalse(draft.hasAnswer(for: question))

        draft.customAnswer = "Discuss tradeoffs first"

        XCTAssertTrue(draft.hasAnswer(for: question))
        XCTAssertEqual(draft.answers(for: question), ["Discuss tradeoffs first"])
    }

    func testMultiSelectPreservesOptionOrderAndAppendsCustomAnswer() {
        let question = makeQuestion(
            id: "q1",
            multiSelect: true,
            isOther: true,
            options: [
                option("Implement"),
                option("Test"),
                option("Document")
            ]
        )
        var draft = PendingRequestAnswerDraft()
        draft.toggle(label: "Document", multiSelect: question.multiSelect)
        draft.toggle(label: "Implement", multiSelect: question.multiSelect)
        draft.toggle(label: "Other", multiSelect: question.multiSelect)
        draft.customAnswer = "Update checklist"

        XCTAssertTrue(draft.hasAnswer(for: question))
        XCTAssertEqual(draft.answers(for: question), ["Implement", "Document", "Update checklist"])
    }

    func testFreeFormQuestionRequiresText() {
        let question = makeQuestion(id: "q1")
        var draft = PendingRequestAnswerDraft()

        XCTAssertFalse(pendingRequestAllQuestionsAnswered(questions: [question], drafts: ["q1": draft]))

        draft.customAnswer = "Use the smaller scope"

        XCTAssertTrue(pendingRequestAllQuestionsAnswered(questions: [question], drafts: ["q1": draft]))
        XCTAssertEqual(draft.answers(for: question), ["Use the smaller scope"])
    }

    func testPlanDecisionOptionBuildsImmediateSingleAnswerPayload() {
        let question = makeQuestion(
            id: "decision",
            options: [
                option("Implement (recommended)", description: "Start changing files"),
                option("Discuss", description: "Ask for more detail")
            ]
        )

        XCTAssertEqual(
            pendingRequestPlanDecisionAnswerPayload(question: question, selectedLabel: "Discuss"),
            ["decision": ["Discuss"]]
        )
    }

    private func makeQuestion(
        id: String,
        multiSelect: Bool = false,
        isOther: Bool = false,
        options: [SupervisorThreadActionQuestionOption] = []
    ) -> SupervisorThreadActionQuestion {
        SupervisorThreadActionQuestion(
            id: id,
            header: "Decision",
            question: "How should Codex proceed?",
            multiSelect: multiSelect,
            isOther: isOther,
            options: options
        )
    }

    private func option(_ label: String, description: String = "") -> SupervisorThreadActionQuestionOption {
        SupervisorThreadActionQuestionOption(label: label, description: description)
    }
}
