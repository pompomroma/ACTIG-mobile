import Foundation

/// Cloud brain backed by the Claude Messages API. Used for top fluency and
/// accuracy (requirements 10 & 11) when the network and a key are available.
/// The API key is read from the Keychain, never hard-coded.
final class ClaudeClient: BrainEngine, @unchecked Sendable {
    /// Default to the most capable current model. Override per-build if desired.
    static let defaultModel = "claude-opus-4-8"

    private let model: String
    private let session: URLSession
    private let endpoint = URL(string: "https://api.anthropic.com/v1/messages")!

    init(model: String = ClaudeClient.defaultModel, session: URLSession = .shared) {
        self.model = model
        self.session = session
    }

    var apiKey: String? {
        ProcessInfo.processInfo.environment["ACTIG_CLAUDE_API_KEY"]
            ?? Keychain.read("claude_api_key")
    }

    var isAvailable: Bool { apiKey?.isEmpty == false }

    func complete(messages: [LLMMessage], language: AppLanguage) async throws -> LLMResponse {
        guard let key = apiKey, !key.isEmpty else { throw BrainError.missingAPIKey }

        // Anthropic takes the system prompt separately from the turn list.
        let system = messages.first { $0.role == .system }?.content
            ?? PromptBuilder.system(language: language)
        let turns = messages.filter { $0.role != .system }.map {
            ["role": $0.role == .assistant ? "assistant" : "user", "content": $0.content]
        }

        let body: [String: Any] = [
            "model": model,
            "max_tokens": 1024,
            "system": system,
            "messages": turns
        ]

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(key, forHTTPHeaderField: "x-api-key")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw BrainError.decoding("No HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            throw BrainError.http(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }

        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let content = json["content"] as? [[String: Any]]
        else { throw BrainError.decoding("Unexpected response shape") }

        let text = content.compactMap { $0["text"] as? String }.joined()
        return StructuredReplyParser.parse(text)
    }
}
