import Foundation

/// A single chat message in the format the brain engines consume.
struct LLMMessage: Codable, Sendable {
    enum Role: String, Codable, Sendable { case system, user, assistant }
    let role: Role
    let content: String
}

/// Result of a brain completion. `options`/`suggestions` are parsed out of the
/// model's structured reply so the UI can show adjustment choices and
/// recommendations (requirements 1.(3) and 1.(4)).
struct LLMResponse: Sendable {
    let text: String
    let options: [String]
    let suggestions: [String]

    init(text: String, options: [String] = [], suggestions: [String] = []) {
        self.text = text
        self.options = options
        self.suggestions = suggestions
    }
}

/// Abstraction over any chat-completion backend so the router can swap engines.
protocol BrainEngine: Sendable {
    var isAvailable: Bool { get }
    func complete(messages: [LLMMessage], language: AppLanguage) async throws -> LLMResponse
    /// Streamed tokens for low-latency speech/typing. Default adapts `complete`.
    func stream(messages: [LLMMessage], language: AppLanguage) -> AsyncThrowingStream<String, Error>
}

extension BrainEngine {
    func stream(messages: [LLMMessage], language: AppLanguage) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            Task {
                do {
                    let r = try await complete(messages: messages, language: language)
                    continuation.yield(r.text)
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
        }
    }
}

enum BrainError: Error, LocalizedError {
    case noEngineAvailable
    case missingAPIKey
    case http(Int, String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .noEngineAvailable: "No AI engine is available right now."
        case .missingAPIKey: "No Claude API key set, and the on-device model is unavailable."
        case .http(let code, let body): "AI request failed (HTTP \(code)): \(body)"
        case .decoding(let detail): "Could not read the AI response: \(detail)"
        }
    }
}

/// Builds the system prompt that enforces persona (requirement 10: natural,
/// human-like conversation), output language (requirement 1), and the
/// structured options/suggestions contract.
enum PromptBuilder {
    static func system(language: AppLanguage) -> String {
        """
        You are ACTIG, a witty, warm, JARVIS-style personal assistant. Speak \
        naturally and conversationally, like a sharp human aide — never robotic. \
        Always respond in \(language.displayName).

        When a request involves a choice or an adjustable direction, end your \
        reply with a compact machine-readable block, on its own lines:
        <<OPTIONS>>
        - option one
        - option two
        <<SUGGESTIONS>>
        - your recommended next step
        Only include those blocks when genuinely useful. Keep prose above them.
        """
    }
}
