import AppIntents

/// App Intents expose ACTIG to Siri, Spotlight, Shortcuts, the Action Button,
/// and the Control Center control — the system-wide entry points that
/// approximate "wake from anywhere" (req 6, 8, 9) within iOS rules, plus
/// voice/text command parity for the core actions (req 13, 14, 16).
///
/// "Hey Siri, ACTIG" → `WakeACTIGIntent`. The launcher Shortcut wraps this so it
/// can be triggered by automations (charging, NFC, Focus) — the closest legal
/// approximation of "run on power-on" (req 1).

struct WakeACTIGIntent: AppIntent {
    static var title: LocalizedStringResource = "Wake ACTIG"
    static var description = IntentDescription("Wakes ACTIG and starts listening.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult & ProvidesDialog {
        SharedSignal.set(.wake)
        return .result(dialog: IntentDialog(stringLiteral: Strings.wakeReaction))
    }
}

struct OpenStudioIntent: AppIntent {
    static var title: LocalizedStringResource = "Open ACTIG 3D Space"
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        SharedSignal.set(.openStudio)
        return .result()
    }
}

struct AskACTIGIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask ACTIG"
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Request")
    var request: String

    func perform() async throws -> some IntentResult {
        SharedSignal.set(.command(request))
        return .result()
    }
}
