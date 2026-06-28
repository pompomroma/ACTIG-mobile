import Foundation
import AVFoundation

/// Owns the full voice pipeline and presents one simple surface to `AppState`:
/// wake-word listening, dictation, speaking, mic-mute (both directions, req 5),
/// and barge-in interruption (req 12). It wires the wake spotter, STT, and TTS
/// together over a shared duplex audio session.
@MainActor
final class VoiceCoordinator {
    // Injected/owned subsystems.
    private let session = DuplexAudioSession()
    private let wake = WakeWordSpotter()
    private let stt = SpeechInput()
    private let tts = SpeechOutput()

    // Callbacks set by AppState.
    var onWake: (() -> Void)?
    var onUtterance: ((String, AppLanguage) -> Void)?

    private(set) var userMuted = false
    private(set) var aiMuted = false

    init() {
        wake.onDetect = { [weak self] in self?.onWake?() }
        stt.onFinal = { [weak self] text in
            guard let self, !text.isEmpty else { return }
            self.onUtterance?(text, LanguageDetector.detect(text))
        }
        // Barge-in: if the user starts speaking while ACTIG is talking, stop
        // talking immediately and listen (req 12).
        stt.onSpeechStart = { [weak self] in self?.bargeIn() }
    }

    /// Passive listening for "wake up ACTIG" (req 6). Foreground/active only —
    /// iOS does not permit a third-party global wake word.
    func startWakeWordListening() async {
        await session.configurePlayAndRecord()
        await wake.start(targetPhrase: Strings.wakeWord)
    }

    /// Begin capturing a command after wake (or after the emergency button).
    func startDictation() async {
        guard !userMuted else { return }
        await stt.start()
    }

    /// Speak text with the voice matching the language (req 1 & 2). No-op if the
    /// AI is muted.
    func speak(_ text: String, language: AppLanguage) async {
        guard !aiMuted else { return }
        await tts.speak(text, language: language)
    }

    /// Stop current speech and immediately resume listening (req 12).
    func bargeIn() {
        tts.stop()
        Task { await stt.start() }
    }

    func setUserMuted(_ muted: Bool) {
        userMuted = muted
        if muted { stt.stop() }
    }

    func setAIMuted(_ muted: Bool) {
        aiMuted = muted
        if muted { tts.stop() }
    }

    /// Short spoken confirmation for state toggles (used by gesture toggle etc.).
    func announceState(_ english: String) {
        Task { await speak(english, language: .english) }
    }
}
