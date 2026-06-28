import Foundation
import Speech
import AVFoundation

/// Speech-to-text via `SFSpeechRecognizer` with live partial results. Reports
/// when speech starts (to trigger barge-in, req 12) and emits the final
/// transcription. Recognizer locale auto-follows the on-device default; the
/// detected language of the text is computed downstream so output can match.
@MainActor
final class SpeechInput {
    var onFinal: ((String) -> Void)?
    var onPartial: ((String) -> Void)?
    var onSpeechStart: (() -> Void)?

    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var started = false

    /// Request permission and begin recognizing. Safe to call repeatedly.
    func start() async {
        guard await requestPermission() else { return }
        stop() // reset any prior session

        recognizer = SFSpeechRecognizer() // user's current locale
        guard let recognizer, recognizer.isAvailable else { return }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        self.request = request

        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }

        audioEngine.prepare()
        do { try audioEngine.start() } catch { print("[ACTIG] STT engine error: \(error)"); return }

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self else { return }
            if let result {
                if !self.started {
                    self.started = true
                    self.onSpeechStart?()
                }
                let text = result.bestTranscription.formattedString
                self.onPartial?(text)
                if result.isFinal {
                    self.onFinal?(text)
                    self.stop()
                }
            }
            if error != nil { self.stop() }
        }
    }

    func stop() {
        started = false
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
    }

    private func requestPermission() async -> Bool {
        let speech = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await withCheckedContinuation { cont in
            AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
    }
}
