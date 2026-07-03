import Foundation

struct PendingRequestAnswerDraft: Equatable {
    var selectedLabels: Set<String> = []
    var customAnswer = ""

    mutating func toggle(label: String, multiSelect: Bool) {
        if multiSelect {
            if selectedLabels.contains(label) {
                selectedLabels.remove(label)
            } else {
                selectedLabels.insert(label)
            }
        } else {
            selectedLabels = [label]
        }
    }

    func hasAnswer(for question: SupervisorThreadActionQuestion) -> Bool {
        let otherLabel = question.isOther ? "Other" : nil
        if question.options.isEmpty, otherLabel == nil {
            return customAnswer.trimmedNonEmpty != nil
        }
        guard !selectedLabels.isEmpty else { return false }
        if selectedLabels.count == 1, let otherLabel, selectedLabels.contains(otherLabel) {
            return customAnswer.trimmedNonEmpty != nil
        }
        return true
    }

    func answers(for question: SupervisorThreadActionQuestion) -> [String] {
        let otherLabel = question.isOther ? "Other" : nil
        if question.options.isEmpty, otherLabel == nil {
            return customAnswer.trimmedNonEmpty.map { [$0] } ?? []
        }
        var orderedAnswers = question.options
            .map(\.label)
            .filter { selectedLabels.contains($0) }
        if let otherLabel, selectedLabels.contains(otherLabel), let answer = customAnswer.trimmedNonEmpty {
            orderedAnswers.append(answer)
        }
        return orderedAnswers
    }
}

func pendingRequestAllQuestionsAnswered(
    questions: [SupervisorThreadActionQuestion],
    drafts: [String: PendingRequestAnswerDraft]
) -> Bool {
    questions.allSatisfy { question in
        (drafts[question.id] ?? PendingRequestAnswerDraft()).hasAnswer(for: question)
    }
}

func pendingRequestAnswerPayload(
    questions: [SupervisorThreadActionQuestion],
    drafts: [String: PendingRequestAnswerDraft]
) -> [String: [String]] {
    Dictionary(uniqueKeysWithValues: questions.map { question in
        (question.id, (drafts[question.id] ?? PendingRequestAnswerDraft()).answers(for: question))
    })
}

func pendingRequestPlanDecisionAnswerPayload(
    question: SupervisorThreadActionQuestion,
    selectedLabel: String
) -> [String: [String]] {
    [question.id: [selectedLabel]]
}
