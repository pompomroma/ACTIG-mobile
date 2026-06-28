import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// On-device, fully-offline brain backed by Apple's **Foundation Models**
/// framework (the system language model shipped with iOS 26 / Apple
/// Intelligence). No weights to bundle, no network, free — this is the real
/// "local offline AI" the request asked for.
///
/// Wrapped in `canImport` + availability guards so the project still compiles on
/// SDKs/devices without Foundation Models, where `isAvailable` is false and the
/// router falls through to MLX / the deterministic fallback. Uses only the most
/// stable API surface (`LanguageModelSession().respond(to:)`) and relies on the
/// protocol's default `stream` implementation.
final class FoundationModelsEngine: BrainEngine, @unchecked Sendable {

    var isAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available: return true
            default: return false
            }
        }
        #endif
        return false
    }

    func complete(messages: [LLMMessage], language: AppLanguage) async throws -> LLMResponse {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), case .available = SystemLanguageModel.default.availability {
            // Fold the system instructions + prior turns into one prompt so we
            // depend only on the simple `respond(to: String)` entry point.
            let instructions = messages.first { $0.role == .system }?.content
                ?? PromptBuilder.system(language: language)
            let convo = messages
                .filter { $0.role != .system }
                .map { "\($0.role == .assistant ? "ACTIG" : "User"): \($0.content)" }
                .joined(separator: "\n")
            let prompt = "\(instructions)\n\n\(convo)\nACTIG:"

            let session = LanguageModelSession()
            let response = try await session.respond(to: prompt)
            return StructuredReplyParser.parse(response.content)
        }
        #endif
        throw BrainError.noEngineAvailable
    }
}
