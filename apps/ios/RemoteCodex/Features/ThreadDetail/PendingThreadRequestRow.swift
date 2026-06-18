import SwiftUI

struct PendingThreadRequestRow: View {
    let request: SupervisorThreadActionRequest
    let resolvingRequestId: String?
    let onRespond: ([String: [String]]) -> Void
    @State private var answerDrafts: [String: PendingRequestAnswerDraft] = [:]

    private var questions: [SupervisorThreadActionQuestion] {
        request.questions ?? []
    }

    private var busy: Bool {
        resolvingRequestId == request.id
    }

    private var planDecisionMode: Bool {
        request.kind == "planDecision"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                GraphBadge(text: request.kind.pendingRequestBadgeText, tone: request.kind.pendingRequestBadgeTone)
                Text(request.title?.trimmedNonEmpty ?? "Request")
                    .font(.headline)
                Spacer()
                if busy {
                    ProgressView()
                }
            }
            if let description = request.description?.trimmedNonEmpty {
                Text(description)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            if questions.isEmpty {
                Text("No structured response choices were provided.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(questions) { question in
                PendingRequestQuestionForm(
                    question: question,
                    draft: draft(for: question),
                    busy: busy,
                    onToggleOption: { label in
                        if planDecisionMode {
                            onRespond(pendingRequestPlanDecisionAnswerPayload(question: question, selectedLabel: label))
                            return
                        }
                        updateDraft(for: question.id) { draft in
                            draft.toggle(label: label, multiSelect: question.multiSelect)
                        }
                    },
                    onCustomAnswerChange: { value in
                        updateDraft(for: question.id) { draft in
                            draft.customAnswer = value
                        }
                    }
                )
            }
            if !questions.isEmpty, !planDecisionMode {
                HStack {
                    Spacer()
                    Button {
                        onRespond(pendingRequestAnswerPayload(questions: questions, drafts: answerDrafts))
                    } label: {
                        Label(busy ? "Submitting..." : "Submit Response", systemImage: "paperplane")
                    }
                    .disabled(busy || !pendingRequestAllQuestionsAnswered(questions: questions, drafts: answerDrafts))
                    .accessibilityIdentifier("thread-pending-request-submit-\(request.id)")
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func draft(for question: SupervisorThreadActionQuestion) -> PendingRequestAnswerDraft {
        answerDrafts[question.id] ?? PendingRequestAnswerDraft()
    }

    private func updateDraft(
        for questionId: String,
        _ transform: (inout PendingRequestAnswerDraft) -> Void
    ) {
        var next = answerDrafts[questionId] ?? PendingRequestAnswerDraft()
        transform(&next)
        answerDrafts[questionId] = next
    }
}

struct PendingRequestQuestionForm: View {
    let question: SupervisorThreadActionQuestion
    let draft: PendingRequestAnswerDraft
    let busy: Bool
    let onToggleOption: (String) -> Void
    let onCustomAnswerChange: (String) -> Void

    private var otherLabel: String? {
        question.isOther ? "Other" : nil
    }

    private var showsOtherInput: Bool {
        guard let otherLabel else { return false }
        return draft.selectedLabels.contains(otherLabel)
    }

    private var showsFreeAnswerInput: Bool {
        question.options.isEmpty && otherLabel == nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(question.header.trimmedNonEmpty ?? "Question")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if let prompt = question.question.trimmedNonEmpty {
                Text(prompt)
                    .font(.callout)
            }
            if !question.options.isEmpty || otherLabel != nil {
                ForEach(question.options) { option in
                    PendingRequestOptionControl(
                        questionId: question.id,
                        option: option,
                        selected: draft.selectedLabels.contains(option.label),
                        multiSelect: question.multiSelect,
                        busy: busy
                    ) {
                        onToggleOption(option.label)
                    }
                }
                if let otherLabel {
                    Button {
                        onToggleOption(otherLabel)
                    } label: {
                        Label(otherLabel, systemImage: draft.selectedLabels.contains(otherLabel) ? "checkmark.circle.fill" : "circle")
                    }
                    .buttonStyle(.bordered)
                    .disabled(busy)
                    .accessibilityIdentifier("thread-pending-request-other-\(question.id)")
                }
            }
            if showsOtherInput || showsFreeAnswerInput {
                TextField(
                    showsOtherInput ? "Enter a custom answer" : "Enter an answer",
                    text: Binding(
                        get: { draft.customAnswer },
                        set: { value in
                            onCustomAnswerChange(value)
                        }
                    )
                )
                .textInputAutocapitalization(.sentences)
                .disabled(busy)
                .accessibilityLabel("\(question.header) answer")
                .accessibilityIdentifier("thread-pending-request-answer-\(question.id)")
            }
        }
        .padding(.vertical, 4)
    }
}

struct PendingRequestOptionControl: View {
    let questionId: String
    let option: SupervisorThreadActionQuestionOption
    let selected: Bool
    let multiSelect: Bool
    let busy: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: selected ? "checkmark.circle.fill" : (multiSelect ? "square" : "circle"))
                    .foregroundStyle(selected ? .orange : .secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.label)
                    if let description = option.description.trimmedNonEmpty {
                        Text(description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
            }
        }
        .buttonStyle(.bordered)
        .disabled(busy)
        .accessibilityLabel(option.description.trimmedNonEmpty.map { "\(option.label), \($0)" } ?? option.label)
        .accessibilityIdentifier("thread-pending-request-option-\(questionId)-\(option.label.pendingRequestIdentifierToken)")
    }
}

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

private extension String {
    var pendingRequestIdentifierToken: String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_"))
        let scalars = unicodeScalars.map { scalar in
            allowed.contains(scalar) ? Character(scalar) : "-"
        }
        let token = String(scalars).trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return token.isEmpty ? "option" : token
    }

    var pendingRequestBadgeText: String {
        switch self {
        case "approval":
            "APPROVAL"
        case "planDecision":
            "PLAN"
        case "requestUserInput":
            "INPUT"
        default:
            uppercased()
        }
    }

    var pendingRequestBadgeTone: GraphBadgeTone {
        switch self {
        case "approval", "planDecision":
            .warning
        default:
            .neutral
        }
    }
}
