import SwiftUI

/// The always-present holographic control surface (req 5). Floats over whatever
/// tab is showing and exposes: the emergency wake button (req 8), user & AI
/// mic-mute (req 5), the 3D-project call button (req 5/16), and a quick text
/// chat field. When ACTIG is awake, the ring pulses.
struct HoloHUDView: View {
    @Environment(AppState.self) private var app
    @State private var quickText = ""
    @State private var pulse = false

    var body: some View {
        VStack {
            Spacer()
            HStack(alignment: .bottom, spacing: 14) {
                // Emergency wake — always visible, works when voice can't be used.
                HoloButton(systemImage: "bolt.fill", tint: Holo.danger) {
                    Task { await app.handleWake() }
                }
                .accessibilityLabel("Emergency wake ACTIG")

                // User mic mute.
                HoloButton(systemImage: app.voice.userMuted ? "mic.slash.fill" : "mic.fill") {
                    app.voice.setUserMuted(!app.voice.userMuted)
                }
                .accessibilityLabel("Mute my microphone")

                // AI voice mute.
                HoloButton(systemImage: app.voice.aiMuted ? "speaker.slash.fill" : "speaker.wave.2.fill") {
                    app.voice.setAIMuted(!app.voice.aiMuted)
                }
                .accessibilityLabel("Mute ACTIG voice")

                // Open the 3D project space (req 5/16).
                HoloButton(systemImage: "cube.transparent", tint: Holo.accent) {
                    app.toggleStudio(true)
                }
                .accessibilityLabel("Open 3D project space")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .holoPanel()
            .overlay(alignment: .top) { wakeIndicator }
            .padding(.bottom, 64) // keep clear of the tab bar
            .padding(.horizontal)
        }
        .onAppear { pulse = true }
    }

    @ViewBuilder private var wakeIndicator: some View {
        if app.isAwake {
            Text("ACTIG online")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Holo.primary)
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(.ultraThinMaterial, in: Capsule())
                .offset(y: -14)
                .scaleEffect(pulse ? 1.05 : 0.95)
                .animation(.easeInOut(duration: 1).repeatForever(autoreverses: true), value: pulse)
        }
    }
}
