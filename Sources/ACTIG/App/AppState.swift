import Foundation
import SwiftData
import Observation

/// Top-level, observable application state. Owns the long-lived subsystems
/// (brain, voice, agent, device) and exposes the high-level intents the UI and
/// command router call into. Marked `@MainActor` because it drives UI; the
/// heavy work is dispatched to async subsystems.
@MainActor
@Observable
final class AppState {
    // Subsystems
    let history: HistoryStore
    let brain: LLMRouter
    let voice: VoiceCoordinator
    let agent: Orchestrator
    let device: DeviceController
    let router: CommandRouter

    // UI-facing state
    var transcript: [ConversationTurn] = []
    var isAwake: Bool = false
    var isStudioOpen: Bool = false
    var gestureControlEnabled: Bool = true
    var status: String = "Idle"

    init(modelContext: ModelContext) {
        let history = HistoryStore(context: modelContext)
        let brain = LLMRouter()
        let device = DeviceController()
        let agent = Orchestrator(brain: brain, history: history, device: device)
        let voice = VoiceCoordinator()

        self.history = history
        self.brain = brain
        self.device = device
        self.agent = agent
        self.voice = voice
        self.router = CommandRouter(agent: agent, device: device)
    }

    /// Called once on launch. Restores the last session and starts passive
    /// wake-word listening (subject to microphone permission).
    func bootstrap() async {
        transcript = (try? history.recentTurns(limit: 200)) ?? []
        voice.onWake = { [weak self] in Task { await self?.handleWake() } }
        voice.onUtterance = { [weak self] text, lang in
            Task { await self?.submit(text, language: lang, source: .voice) }
        }
        await voice.startWakeWordListening()
        status = "Listening for \"wake up ACTIG\""
        await drainPendingCommand()
    }

    /// Executes any command queued by a Siri/Shortcut/Action-Button/widget intent
    /// before the scene was ready (see `SharedSignal`).
    func drainPendingCommand() async {
        switch SharedSignal.take() {
        case .wake: await handleWake()
        case .openStudio: toggleStudio(true)
        case .command(let text): await submit(text, source: .siri)
        case .none: break
        }
    }

    /// Fired by the wake word, the Siri intent, or the emergency button.
    func handleWake() async {
        guard !isAwake else { return }
        isAwake = true
        status = "Awake"
        await voice.speak(Strings.wakeReaction, language: .english)
        await voice.startDictation()
    }

    /// Single entry point for every command, regardless of source (voice, text,
    /// Siri, widget). Routes through the command router, which decides between a
    /// direct device/UI action and an LLM-backed agentic task.
    func submit(_ text: String, language: AppLanguage? = nil, source: InputSource) async {
        let lang = language ?? LanguageDetector.detect(text)
        let userTurn = history.record(
            role: .user, text: text, source: source, language: lang
        )
        transcript.append(userTurn)

        let outcome = await router.handle(text, language: lang, app: self)

        let assistantTurn = history.record(
            role: .assistant,
            text: outcome.reply,
            source: source,
            language: lang,
            options: outcome.options,
            suggestions: outcome.suggestions
        )
        transcript.append(assistantTurn)

        if source == .voice {
            await voice.speak(outcome.reply, language: lang)
        }
    }

    /// User (or voice) asked to interrupt the assistant mid-reply.
    func interrupt() {
        voice.bargeIn()
    }

    func toggleStudio(_ open: Bool) { isStudioOpen = open }
    func toggleGestureControl(_ on: Bool) {
        gestureControlEnabled = on
        voice.announceState("Gesture control \(on ? "on" : "off")")
    }
}

/// Where a command originated. Recorded in history so the transcript shows how
/// each turn was entered.
enum InputSource: String, Codable, Sendable {
    case voice, text, siri, widget, actionButton, shortcut
}
