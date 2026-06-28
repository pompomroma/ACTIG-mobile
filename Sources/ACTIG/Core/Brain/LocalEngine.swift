import Foundation

/// On-device brain. The production implementation loads a quantized model via
/// MLX (`mlx-swift`) or llama.cpp and runs fully offline — the "local" half of
/// the hybrid requirement.
///
/// To keep the project compiling before model weights/dependencies are added,
/// this ships with a deterministic fallback that produces a coherent reply, so
/// the whole app (chat, history, voice, UI) is exercisable end-to-end. Replace
/// `generate(_:)` with the MLX call once `MLXSwift` is added in `project.yml`.
final class LocalEngine: BrainEngine, @unchecked Sendable {
    /// Set true once weights are bundled and the MLX path is wired up.
    private let modelLoaded: Bool

    init(modelLoaded: Bool = false) {
        self.modelLoaded = modelLoaded
    }

    /// Always "available" because the fallback guarantees an answer offline.
    var isAvailable: Bool { true }

    func complete(messages: [LLMMessage], language: AppLanguage) async throws -> LLMResponse {
        let prompt = messages.map { "\($0.role.rawValue): \($0.content)" }.joined(separator: "\n")
        let raw = await generate(prompt, language: language)
        return StructuredReplyParser.parse(raw)
    }

    // MARK: - Generation

    private func generate(_ prompt: String, language: AppLanguage) async -> String {
        if modelLoaded {
            // TODO: call into MLX / llama.cpp here.
            // return await MLXRunner.shared.run(prompt)
        }
        return Self.offlineFallback(language: language)
    }

    /// A minimal, honest offline reply so the app never goes silent without a
    /// network or weights. Localized to the active language.
    static func offlineFallback(language: AppLanguage) -> String {
        switch language {
        case .korean:
            return "오프라인 모드입니다. 온디바이스 모델 가중치를 추가하거나 인터넷에 연결하면 더 정확하게 답할 수 있어요."
        case .japanese:
            return "オフラインモードです。オンデバイスモデルを追加するか、ネットに接続するとより正確に応答できます。"
        case .chinese:
            return "当前为离线模式。添加本地模型权重或联网后，我可以给出更准确的回答。"
        case .spanish:
            return "Estoy en modo sin conexión. Añade los pesos del modelo local o conéctate a internet para respuestas más precisas."
        case .french:
            return "Je suis en mode hors ligne. Ajoutez le modèle local ou connectez-vous pour des réponses plus précises."
        case .german:
            return "Ich bin im Offline-Modus. Füge das lokale Modell hinzu oder gehe online für genauere Antworten."
        case .english:
            return "I'm running in offline mode right now. Add the on-device model weights or connect to the internet and I'll answer with full accuracy, sir."
        }
    }
}
