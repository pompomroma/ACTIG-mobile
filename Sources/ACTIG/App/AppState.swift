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
    let live = LiveActivityManager()

    // UI-facing state
    var transcript: [ConversationTurn] = []
    var isAwake: Bool = false
    var isStudioOpen: Bool = false
    var gestureControlEnabled: Bool = true
    var status: String = "Idle"

    /// The live 3D studio scene, registered by `ProjectSpaceView` while open, so
    /// agent tools can spawn/clone/scale shapes by voice or text.
    var studio: StudioModel?

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
        // Give the agent its tool set now that `self` is fully initialized.
        agent.tools = ToolRegistry.makeDefault(context: self)
        voice.onWake = { [weak self] in Task { await self?.handleWake() } }
        voice.onUtterance = { [weak self] text, lang in
            Task { await self?.submit(text, language: lang, source: .voice) }
        }
        await voice.startWakeWordListening()
        status = "Listening for \"wake up ACTIG\""
        // Persistent presence + remote/scheduled wake (reqs 3, 8, 9).
        live.start(status: "Listening")
        await PushManager.shared.configure()
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
        live.update(status: "Awake", awake: true)
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

// MARK: - Agent tool context

/// Bridges the agent's tool calls to the concrete subsystems. Every action the
/// LLM can take (open the studio, play music, open an app/Settings, create a
/// reminder, etc.) routes through here — the same surface used by voice and text.
extension AppState: AgentToolContext {
    func openStudio(_ open: Bool) { toggleStudio(open) }

    func spawnShape(_ name: String) -> Bool {
        guard let studio else { toggleStudio(true); return false }
        guard let kind = ShapeKind(rawValue: name.lowercased()) else { return false }
        studio.spawn(kind)
        return true
    }

    func cloneSelectedShape() -> Bool {
        guard let studio, studio.selected != nil else { return false }
        studio.cloneSelected(); return true
    }

    func scaleSelectedShape(_ factor: Float) -> Bool {
        guard let studio, studio.selected != nil else { return false }
        studio.scaleSelected(by: factor); return true
    }

    func deleteSelectedShape() -> Bool {
        guard let studio, studio.selected != nil else { return false }
        studio.deleteSelected(); return true
    }

    func setGestureControl(_ on: Bool) { toggleGestureControl(on) }
    func setUserMuted(_ muted: Bool) { voice.setUserMuted(muted) }
    func setAIMuted(_ muted: Bool) { voice.setAIMuted(muted) }

    func playMusic(_ query: String) async -> Bool { await device.playMusic(query: query) }
    func pauseMusic() { device.pauseMusic() }
    func skipMusic() { device.skipMusic() }

    func openApp(_ name: String) -> Bool { device.launchApp(named: name) }
    func openSettingsPane(_ pane: String?) -> Bool { device.openSettings(pane: pane) }

    func createReminder(_ title: String) async -> String {
        await device.personal.createReminder(title: title)
    }
    func createCalendarEvent(_ title: String, at start: Date) async -> String {
        await device.personal.createEvent(title: title, start: start)
    }
    func lookupContact(_ name: String) async -> String {
        await device.personal.lookupContact(name: name)
    }
    func todaySteps() async -> String { await device.personal.todayStepCount() }
}
