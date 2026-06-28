import AppIntents

/// Spoken-phrase → intent mappings so "Hey Siri, ACTIG / wake up ACTIG" works
/// system-wide (req 6/7) and the core actions are voice-triggerable (req 13/16).
/// Lives only in the app target (an `AppShortcutsProvider` must be singular).
struct ACTIGShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: WakeACTIGIntent(),
            phrases: ["Wake up \(.applicationName)", "\(.applicationName) wake up", "Hey \(.applicationName)"],
            shortTitle: "Wake ACTIG",
            systemImageName: "bolt.fill"
        )
        AppShortcut(
            intent: OpenStudioIntent(),
            phrases: ["Open \(.applicationName) 3D space", "\(.applicationName) open studio"],
            shortTitle: "3D Space",
            systemImageName: "cube.transparent"
        )
        AppShortcut(
            intent: AskACTIGIntent(),
            phrases: ["Ask \(.applicationName)", "Tell \(.applicationName)"],
            shortTitle: "Ask ACTIG",
            systemImageName: "bubble.left"
        )
    }
}
