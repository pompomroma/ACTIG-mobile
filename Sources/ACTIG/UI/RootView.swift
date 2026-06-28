import SwiftUI

/// Top-level shell. Hosts the tabbed surfaces (Chat, History, Settings) with the
/// holographic HUD overlaid on top of everything, and presents the 3D studio
/// full-screen when opened. The emergency wake button lives in the HUD so it is
/// always visible while the app is in use (req 8).
struct RootView: View {
    @Environment(AppState.self) private var app
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        @Bindable var app = app
        ZStack {
            TabView {
                ChatView()
                    .tabItem { Label("Chat", systemImage: "bubble.left.and.bubble.right") }
                HistoryView()
                    .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                SettingsView()
                    .tabItem { Label("Settings", systemImage: "gearshape") }
            }

            // Holographic overlay — present on every tab (req 5, 15).
            HoloHUDView()
                .allowsHitTesting(true)
        }
        .fullScreenCover(isPresented: $app.isStudioOpen) {
            ProjectSpaceView()
                .environment(app)
        }
        .preferredColorScheme(.dark)
        .onChange(of: scenePhase) { _, phase in
            // Drain Siri/Shortcut/Action-Button commands when we become active.
            if phase == .active { Task { await app.drainPendingCommand() } }
        }
        .onOpenURL { url in
            // Deep links from the Lock/Home-Screen widget (req 8/9).
            switch url.host {
            case "wake": Task { await app.handleWake() }
            case "studio": app.toggleStudio(true)
            default: break
            }
        }
    }
}
