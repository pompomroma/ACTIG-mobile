import Foundation

/// Drives agentic tasks: plan → act → observe, while writing workflow
/// checkpoints (req 1: checkpoints), estimating duration (req 1.(2-4)), and
/// producing the success/failure explanation (req 1.(2-3)).
@MainActor
final class Orchestrator {
    private let brain: LLMRouter
    private let history: HistoryStore
    private let device: DeviceController

    init(brain: LLMRouter, history: HistoryStore, device: DeviceController) {
        self.brain = brain
        self.history = history
        self.device = device
    }

    /// Run a conversational/agentic task. Returns the reply plus any options and
    /// suggestions the brain produced.
    func run(task: String, language: AppLanguage, context: [LLMMessage]) async -> AgentOutcome {
        let checkpoint = WorkflowCheckpoint(
            title: String(task.prefix(60)),
            taskDescription: task,
            etaSeconds: estimateETA(for: task)
        )
        history.newCheckpoint(checkpoint)

        var messages: [LLMMessage] = [.init(role: .system, content: PromptBuilder.system(language: language))]
        messages.append(contentsOf: context)
        messages.append(.init(role: .user, content: task))

        do {
            let response = try await brain.complete(messages: messages, language: language)
            checkpoint.status = .succeeded
            checkpoint.result = response.text
            checkpoint.explanation = "Completed via \(brain.preferLocal ? "on-device" : "hybrid") brain."
            checkpoint.commands.append(task)
            history.update(checkpoint)
            return AgentOutcome(reply: response.text,
                                options: response.options,
                                suggestions: response.suggestions)
        } catch {
            checkpoint.status = .failed
            let explanation = Self.explainError(error, language: language)
            checkpoint.explanation = explanation
            checkpoint.result = error.localizedDescription
            history.update(checkpoint)
            // Requirement 1.(2-1): explain errors to the user in their language.
            return AgentOutcome(reply: explanation, options: [], suggestions: [])
        }
    }

    /// Naive ETA heuristic shown to the user (req 1.(2-4)). Replace with a
    /// learned estimate once telemetry exists.
    private func estimateETA(for task: String) -> Double {
        let words = task.split(separator: " ").count
        return min(60, max(2, Double(words) * 0.4))
    }

    /// Turns a raw error into a friendly, localized explanation.
    static func explainError(_ error: Error, language: AppLanguage) -> String {
        let detail = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        switch language {
        case .korean: return "문제가 발생했어요: \(detail)"
        case .japanese: return "問題が発生しました: \(detail)"
        case .chinese: return "出现了一个问题：\(detail)"
        case .spanish: return "Algo salió mal: \(detail)"
        case .french: return "Un problème est survenu : \(detail)"
        case .german: return "Etwas ist schiefgelaufen: \(detail)"
        case .english: return "Something went wrong, sir: \(detail)"
        }
    }
}

/// What an agent run returns to the caller / UI.
struct AgentOutcome: Sendable {
    var reply: String
    var options: [String]
    var suggestions: [String]
}
