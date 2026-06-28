import Foundation
import AVFoundation

/// Configures a full-duplex `AVAudioSession` so ACTIG can listen and speak at
/// the same time — the prerequisite for barge-in (req 12). Uses voice-chat mode
/// with echo cancellation and ducking so the assistant's own TTS doesn't
/// retrigger the recognizer.
actor DuplexAudioSession {
    func configurePlayAndRecord() async {
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.defaultToSpeaker, .allowBluetooth, .duckOthers]
            )
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            // Audio config failure is non-fatal; UI still works in text mode.
            print("[ACTIG] Audio session config failed: \(error)")
        }
        #endif
    }

    func deactivate() async {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }
}
