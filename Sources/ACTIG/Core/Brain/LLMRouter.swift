import Foundation

/// Hybrid brain. Prefers the cloud engine (Claude) for best quality when it's
/// available, and falls back to the on-device engine for offline/fast replies —
/// satisfying the "local agentic AI" goal with high fluency when online.
final class LLMRouter: BrainEngine, @unchecked Sendable {
    private let cloud: BrainEngine
    private let local: BrainEngine

    /// User preference: force-offline (privacy / no network) even if a key exists.
    var preferLocal: Bool = false

    init(cloud: BrainEngine = ClaudeClient(), local: BrainEngine = LocalEngine()) {
        self.cloud = cloud
        self.local = local
    }

    var isAvailable: Bool { cloud.isAvailable || local.isAvailable }

    func complete(messages: [LLMMessage], language: AppLanguage) async throws -> LLMResponse {
        let primary = chooseEngine()
        do {
            return try await primary.complete(messages: messages, language: language)
        } catch {
            // Graceful degradation: if the cloud call fails, never leave the user
            // stranded — fall through to the always-available local engine.
            if (primary as AnyObject) !== (local as AnyObject) {
                return try await local.complete(messages: messages, language: language)
            }
            throw error
        }
    }

    func stream(messages: [LLMMessage], language: AppLanguage) -> AsyncThrowingStream<String, Error> {
        chooseEngine().stream(messages: messages, language: language)
    }

    private func chooseEngine() -> BrainEngine {
        if preferLocal { return local }
        return cloud.isAvailable ? cloud : local
    }
}
