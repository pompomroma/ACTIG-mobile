import Foundation

/// Single command pipeline shared by every input source (req 13–16): it first
/// tries to match a fast, deterministic device/UI command (open 3D space, play
/// music, toggle gestures, mute, etc.) and otherwise hands off to the agentic
/// brain. Because both voice and text call `AppState.submit` → here, every
/// function is reachable by both (req 14) from any screen (req 15).
@MainActor
final class CommandRouter {
    private let agent: Orchestrator
    private let device: DeviceController

    init(agent: Orchestrator, device: DeviceController) {
        self.agent = agent
        self.device = device
    }

    func handle(_ text: String, language: AppLanguage, app: AppState) async -> AgentOutcome {
        let lowered = text.lowercased()

        // --- Deterministic intents (multilingual keyword sets) ---------------
        if matches(lowered, Intents.openStudio) {
            app.toggleStudio(true)
            return reply("Opening the 3D project space.", language)
        }
        if matches(lowered, Intents.closeStudio) {
            app.toggleStudio(false)
            return reply("Closing the 3D project space.", language)
        }
        if matches(lowered, Intents.gestureOff) {
            app.toggleGestureControl(false)
            return reply("Camera gesture control is off.", language)
        }
        if matches(lowered, Intents.gestureOn) {
            app.toggleGestureControl(true)
            return reply("Camera gesture control is on.", language)
        }
        if matches(lowered, Intents.muteUser) {
            app.voice.setUserMuted(true)
            return reply("Your mic is muted.", language)
        }
        if matches(lowered, Intents.muteAI) {
            app.voice.setAIMuted(true)
            return reply("I'll stay quiet — voice output muted.", language)
        }
        if matches(lowered, Intents.stop) {
            app.interrupt()
            return reply("Stopped.", language)
        }
        if matches(lowered, Intents.playMusic) {
            let query = MusicQueryExtractor.extract(from: text)
            let ok = await device.playMusic(query: query)
            return reply(ok ? "Playing \(query)." : "I couldn't start that track.", language)
        }

        // --- Fall back to the agentic brain ---------------------------------
        let context = app.transcript.suffix(10).map {
            LLMMessage(role: $0.role == .user ? .user : .assistant, content: $0.text)
        }
        return await agent.run(task: text, language: language, context: Array(context))
    }

    // MARK: helpers

    private func matches(_ text: String, _ phrases: [String]) -> Bool {
        phrases.contains { text.contains($0) }
    }

    private func reply(_ english: String, _ language: AppLanguage) -> AgentOutcome {
        AgentOutcome(reply: Localized.confirm(english, language), options: [], suggestions: [])
    }
}

/// Keyword sets per intent. English plus a few high-frequency translations so
/// voice/text commands work across languages (req 1, 14). Extend as needed.
private enum Intents {
    static let openStudio = ["3d project", "3d space", "open studio", "modeling space",
                             "3d 프로젝트", "3d 공간", "3dプロジェクト", "3d项目"]
    static let closeStudio = ["close 3d", "close studio", "exit 3d", "3d 닫기"]
    static let gestureOff = ["gesture off", "turn off gesture", "stop hand tracking",
                             "제스처 꺼", "ジェスチャーオフ"]
    static let gestureOn = ["gesture on", "turn on gesture", "start hand tracking",
                            "제스처 켜", "ジェスチャーオン"]
    static let muteUser = ["mute me", "mute my mic", "mute user", "내 마이크 음소거"]
    static let muteAI = ["mute yourself", "mute ai", "be quiet", "stop talking", "조용히"]
    static let stop = ["stop", "cancel", "그만", "멈춰", "やめて", "停止"]
    static let playMusic = ["play ", "put on ", "play song", "play music",
                            "음악 틀어", "노래 틀어", "音楽をかけて", "播放"]
}

/// Pulls the song/artist out of a "play X" command.
enum MusicQueryExtractor {
    static func extract(from text: String) -> String {
        let lowered = text.lowercased()
        for marker in ["play ", "put on ", "음악 틀어", "노래 틀어", "播放"] {
            if let r = lowered.range(of: marker) {
                let tail = text[r.upperBound...].trimmingCharacters(in: .whitespaces)
                if !tail.isEmpty { return tail }
            }
        }
        return text
    }
}
