import Foundation
import NaturalLanguage

/// Languages ACTIG can read, speak, and reason in. The raw value is a BCP-47
/// tag usable by `SFSpeechRecognizer`, `AVSpeechSynthesisVoice`, and the LLM
/// system prompt. Extend freely — the detector falls back gracefully.
enum AppLanguage: String, Codable, CaseIterable, Sendable {
    case english = "en-US"
    case korean = "ko-KR"
    case japanese = "ja-JP"
    case chinese = "zh-CN"
    case spanish = "es-ES"
    case french = "fr-FR"
    case german = "de-DE"

    /// Human-readable name used in LLM prompts ("respond in Korean").
    var displayName: String {
        switch self {
        case .english: "English"
        case .korean: "Korean"
        case .japanese: "Japanese"
        case .chinese: "Chinese"
        case .spanish: "Spanish"
        case .french: "French"
        case .german: "German"
        }
    }

    /// Map a detected `NLLanguage` to an `AppLanguage`, defaulting to English.
    init(nl: NLLanguage) {
        switch nl {
        case .korean: self = .korean
        case .japanese: self = .japanese
        case .simplifiedChinese, .traditionalChinese: self = .chinese
        case .spanish: self = .spanish
        case .french: self = .french
        case .german: self = .german
        default: self = .english
        }
    }
}

/// Detects the language of an input string so STT/TTS/LLM can switch to match
/// (requirement 1: "switches language of (in/out)put depending on the input").
enum LanguageDetector {
    static func detect(_ text: String) -> AppLanguage {
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(text)
        guard let lang = recognizer.dominantLanguage else { return .english }
        return AppLanguage(nl: lang)
    }
}

