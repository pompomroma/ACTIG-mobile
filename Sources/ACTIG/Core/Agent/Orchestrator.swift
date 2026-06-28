import Foundation

/// Drives agentic tasks: plan → act → observe. The brain may emit `<<TOOL>>`
/// directives (see `ToolDirectiveParser`); the orchestrator executes them via
/// the `ToolRegistry`, records each as a workflow checkpoint command with its
/// result (req 1: checkpoints, how/why it succeeded/failed, ETA), and returns a
/// natural reply plus any options/suggestions the brain produced.
@MainActor
final class Orchestrator {
    private let brain: LLMRouter
    private let history: HistoryStore
    private let device: DeviceController
    /// Set once `AppState` exists so tools can drive the app/device.
    var tools: ToolRegistry?

    init(brain: LLMRouter, history: HistoryStore, device: DeviceController) {
        self.brain = brain
        self.history = history
        self.device = device
    }

    func run(task: String, language: AppLanguage, context: [LLMMessage]) async -> AgentOutcome {
        let checkpoint = WorkflowCheckpoint(
            title: String(task.prefix(60)),
            taskDescription: task,
            etaSeconds: estimateETA(for: task)
        )
        history.newCheckpoint(checkpoint)

        var messages: [LLMMessage] = [.init(role: .system, content: systemPrompt(language: language))]
        messages.append(contentsOf: context)
        messages.append(.init(role: .user, content: task))

        do {
            let response = try await brain.complete(messages: messages, language: language)
            let (clean, calls) = ToolDirectiveParser.parse(response.text)

            // Execute any tool calls and gather their results.
            var toolResults: [String] = []
            for call in calls {
                let result = await tools?.execute(call) ?? "Tools unavailable."
                checkpoint.commands.append("\(call.name)(\(call.args))")
                toolResults.append(result)
            }

            checkpoint.status = .succeeded
            let reply = [clean, toolResults.joined(separator: " ")]
                .filter { !$0.isEmpty }
                .joined(separator: "\n")
            checkpoint.result = reply
            checkpoint.explanation = calls.isEmpty
                ? "Answered via \(brain.preferLocal ? "on-device" : "hybrid") brain."
                : "Ran \(calls.count) tool(s): \(calls.map(\.name).joined(separator: ", "))."
            history.update(checkpoint)

            return AgentOutcome(reply: reply.isEmpty ? response.text : reply,
                                options: response.options,
                                suggestions: response.suggestions)
        } catch {
            checkpoint.status = .failed
            let explanation = Self.explainError(error, language: language)
            checkpoint.explanation = explanation
            checkpoint.result = error.localizedDescription
            history.update(checkpoint)
            return AgentOutcome(reply: explanation, options: [], suggestions: [])
        }
    }

    /// System prompt = persona/language contract + the live tool catalog so the
    /// model knows what it can actually do on this device.
    private func systemPrompt(language: AppLanguage) -> String {
        var prompt = PromptBuilder.system(language: language)
        if let catalog = tools?.catalogForPrompt, !catalog.isEmpty {
            prompt += """


            You can take actions on the device by emitting, on their own lines,
            one or more directives of the form:
            \(ToolDirectiveParser.marker){"name":"<tool>","args":{...}}
            Emit a directive ONLY when the user clearly wants that action; keep a
            short natural sentence above it. Available tools:
            \(catalog)
            """
        }
        return prompt
    }

    private func estimateETA(for task: String) -> Double {
        let words = task.split(separator: " ").count
        return min(60, max(2, Double(words) * 0.4))
    }

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
