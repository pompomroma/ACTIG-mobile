import Foundation
import Speech
import AVFoundation

/// On-device wake-word detector for "wake up ACTIG" (req 6). Implemented as a
/// lightweight always-on `SFSpeechRecognizer` pass that scans partial
/// transcripts for the target phrase. This works while the app is foreground or
/// in its background-audio window — iOS does not allow a third-party global wake
/// word, so for system-wide invocation we additionally ship the Siri intent and
/// the emergency button (req 8).
///
/// For production, swap this for a dedicated on-device keyword-spotting model
/// (e.g. a small Core ML classifier) to cut battery use; the interface stays the
/// same.
@MainActor
final class WakeWordSpotter {
    var onDetect: (() -> Void)?

    private let recognizer = SFSpeechRecognizer()
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var phrase = Strings.wakeWord.lowercased()
    private var running = false

    func start(targetPhrase: String) async {
        phrase = targetPhrase.lowercased()
        guard !running, let recognizer, recognizer.isAvailable else { return }
        guard await authorized() else { return }
        running = true

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        audioEngine.prepare()
        try? audioEngine.start()

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            if let result {
                let heard = result.bestTranscription.formattedString.lowercased()
                if heard.contains(self.phrase) {
                    self.onDetect?()
                    self.restart() // reset so the next wake is detected cleanly
                }
            }
            if error != nil { self.restart() }
        }
    }

    func stop() {
        running = false
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
    }

    private func restart() {
        stop()
        Task { await start(targetPhrase: phrase) }
    }

    private func authorized() async -> Bool {
        await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0 == .authorized) }
        }
    }
}
