import Foundation

/// Cloud brain backed by **NVIDIA Nemotron** via the OpenAI-compatible NIM
/// Chat Completions API. Used for top fluency and accuracy (requirements 10 &
/// 11) when the network and a key are available. The API key is read from the
/// Keychain, never hard-coded.
///
/// The agent's tool-use and options/suggestions are prompt-based (see
/// `PromptBuilder` and `ToolDirectiveParser`), so behaviour is identical to the
/// previous Claude setup — only the transport/model changed.
final class NemotronClient: BrainEngine, @unchecked Sendable {
    /// Default model id (override per-build or via Settings if your account
    /// exposes a different identifier). Must be a real NIM model — the old
    /// "nemotron-3-ultra-550b-a55b" did not exist and every request failed.
    static let defaultModel = "nvidia/llama-3.1-nemotron-70b-instruct"

    private let model: String
    private let session: URLSession
    private let endpoint = URL(string: "https://integrate.api.nvidia.com/v1/chat/completions")!

    init(model: String = NemotronClient.defaultModel, session: URLSession = .shared) {
        self.model = model
        self.session = session
    }

    /// Built-in NVIDIA API key so the app works with zero setup. An env var or a
    /// key saved in the Keychain (via Settings) takes precedence over this.
    static let builtInKey = "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"

    var apiKey: String? {
        ProcessInfo.processInfo.environment["ACTIG_LLM_API_KEY"]
            ?? Keychain.read("llm_api_key")
            ?? NemotronClient.builtInKey
    }

    var isAvailable: Bool { apiKey?.isEmpty == false }

    func complete(messages: [LLMMessage], language: AppLanguage) async throws -> LLMResponse {
        guard let key = apiKey, !key.isEmpty else { throw BrainError.missingAPIKey }

        // OpenAI-compatible: system prompt is the first message in the list.
        var wire: [[String: String]] = []
        if !messages.contains(where: { $0.role == .system }) {
            wire.append(["role": "system", "content": PromptBuilder.system(language: language)])
        }
        wire.append(contentsOf: messages.map { m in
            let role = m.role == .assistant ? "assistant" : (m.role == .system ? "system" : "user")
            return ["role": role, "content": m.content]
        })

        let body: [String: Any] = [
            "model": model,
            "messages": wire,
            "max_tokens": 1024,
            "temperature": 0.6,
        ]

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
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
            let choices = json["choices"] as? [[String: Any]],
            let message = choices.first?["message"] as? [String: Any],
            let content = message["content"] as? String
        else { throw BrainError.decoding("Unexpected response shape") }

        return StructuredReplyParser.parse(content)
    }
}
