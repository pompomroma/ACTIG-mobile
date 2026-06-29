import Foundation

/// Hybrid brain. Builds an ordered fallback chain and uses the first engine that
/// succeeds, so the assistant always answers:
///
///   online  : Nemotron (best fluency) → Foundation Models → MLX/local → fallback
///   offline : Foundation Models → MLX/local → fallback
///
/// `preferLocal` (privacy / no-network mode) skips the cloud entirely.
final class LLMRouter: BrainEngine, @unchecked Sendable {
    private let cloud: BrainEngine
    /// On-device engines, in preference order (Apple Foundation Models first,
    /// then the MLX/deterministic `LocalEngine`).
    private let onDevice: [BrainEngine]

    /// User preference: force-offline even if a cloud key exists.
    var preferLocal: Bool = false

    init(cloud: BrainEngine = NemotronClient(),
         onDevice: [BrainEngine] = [FoundationModelsEngine(), LocalEngine()]) {
        self.cloud = cloud
        self.onDevice = onDevice
    }

    var isAvailable: Bool { cloud.isAvailable || onDevice.contains { $0.isAvailable } }

    func complete(messages: [LLMMessage], language: AppLanguage) async throws -> LLMResponse {
        var lastError: Error = BrainError.noEngineAvailable
        for engine in engineChain() where engine.isAvailable {
            do { return try await engine.complete(messages: messages, language: language) }
            catch { lastError = error } // try the next engine in the chain
        }
        throw lastError
    }

    func stream(messages: [LLMMessage], language: AppLanguage) -> AsyncThrowingStream<String, Error> {
        let engine = engineChain().first { $0.isAvailable } ?? onDevice.last!
        return engine.stream(messages: messages, language: language)
    }

    /// Ordered list of engines to try for this request.
    private func engineChain() -> [BrainEngine] {
        if preferLocal { return onDevice }
        return [cloud] + onDevice
    }
}
