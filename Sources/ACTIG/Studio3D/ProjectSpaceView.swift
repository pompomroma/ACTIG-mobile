import SwiftUI
import RealityKit

/// The Iron-Man / JARVIS 3D project space (req 4, 16, 17), sized for iPhone.
/// Renders a RealityKit scene with holographic shapes the user can spawn, drag,
/// scale, clone, and delete. Interaction works two ways:
///   • Touch: drag to move, pinch/scroll to scale (RealityKit gestures).
///   • Camera hand-pose: pinch-to-drag and two-hand extend/contract to scale,
///     driven by `HandPoseController` (req 4), toggleable by button/voice.
/// All in-studio functions are exposed as holographic buttons (req 5).
struct ProjectSpaceView: View {
    @Environment(AppState.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var model = StudioModel()

    var body: some View {
        ZStack {
            StudioRealityView(model: model, gestureEnabled: app.gestureControlEnabled)
                .ignoresSafeArea()

            VStack {
                topBar
                Spacer()
                shapePalette
                functionBar
            }
            .padding()
        }
        .background(Color.black)
        .onChange(of: app.gestureControlEnabled) { _, on in model.setGestureControl(on) }
    }

    // MARK: HUD inside the studio (req 5: buttons for all functions)

    private var topBar: some View {
        HStack {
            Text("3D PROJECT SPACE").font(.caption.weight(.bold)).foregroundStyle(Holo.primary)
            Spacer()
            HoloButton(systemImage: "xmark", tint: Holo.danger, size: 40) {
                app.toggleStudio(false); dismiss()
            }
        }
    }

    private var shapePalette: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(ShapeKind.allCases) { kind in
                    HoloButton(systemImage: kind.symbol, size: 50) { model.spawn(kind) }
                        .accessibilityLabel("Add \(kind.rawValue)")
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private var functionBar: some View {
        HStack(spacing: 14) {
            HoloButton(systemImage: "plus.square.on.square", tint: Holo.accent) { model.cloneSelected() }
                .accessibilityLabel("Clone selected")
            HoloButton(systemImage: "trash", tint: Holo.danger) { model.deleteSelected() }
                .accessibilityLabel("Delete selected")
            HoloButton(systemImage: app.gestureControlEnabled ? "hand.raised.fill" : "hand.raised.slash") {
                app.toggleGestureControl(!app.gestureControlEnabled)
            }
            .accessibilityLabel("Toggle camera gesture control")
            HoloButton(systemImage: "arrow.counterclockwise") { model.reset() }
                .accessibilityLabel("Reset scene")
        }
        .padding(.top, 10)
    }
}
