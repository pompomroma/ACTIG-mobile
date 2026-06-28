import SwiftUI

/// Runtime configuration: Claude API key (stored in Keychain), offline-only
/// toggle, and gesture-control toggle (req 4 toggle via button). Also surfaces
/// the honest iOS-limitations note so expectations stay clear.
struct SettingsView: View {
    @Environment(AppState.self) private var app
    @State private var apiKey = Keychain.read("claude_api_key") ?? ""
    @State private var preferLocal = false
    @State private var saved = false

    var body: some View {
        NavigationStack {
            Form {
                Section("AI brain") {
                    SecureField("Claude API key", text: $apiKey)
                    Toggle("Prefer on-device (offline) model", isOn: $preferLocal)
                        .onChange(of: preferLocal) { app.brain.preferLocal = preferLocal }
                    Button(saved ? "Saved ✓" : "Save key") {
                        Keychain.set(apiKey, for: "claude_api_key")
                        saved = true
                    }
                }

                Section("Interaction") {
                    Toggle("Camera gesture control", isOn: Binding(
                        get: { app.gestureControlEnabled },
                        set: { app.toggleGestureControl($0) }
                    ))
                }

                Section("Wake & reaction") {
                    LabeledContent("Wake phrase", value: "\"\(Strings.wakeWord)\"")
                    LabeledContent("Reaction", value: "\"\(Strings.wakeReaction)\"")
                }

                Section("What iOS allows") {
                    Text("""
                    On a stock iPhone, apps can't auto-launch on boot, run \
                    always-on in the background, place buttons over other apps, \
                    or access every app/setting. ACTIG approximates these with \
                    Siri, widgets, the Control Center control, the Action Button, \
                    and a launcher Shortcut. See the README for details.
                    """)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
        }
    }
}
