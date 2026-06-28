import SwiftUI
import RealityKit
import UIKit

/// Hosts the RealityKit scene in a non-AR `ARView` viewport (works on iOS 17,
/// unlike SwiftUI's `RealityView` which needs iOS 18). Touch interaction comes
/// from `ARView.installGestures` — translation = "drag" and scale/pinch =
/// "enlarge/shrink" (req 4, the mouse-drag / scroll equivalents). A tap selects
/// the entity so clone/delete and camera hand-pose act on it. Camera hand-pose
/// runs in parallel via `StudioModel.handPose`.
struct StudioRealityView: UIViewRepresentable {
    let model: StudioModel
    let gestureEnabled: Bool

    func makeUIView(context: Context) -> ARView {
        let arView = ARView(frame: .zero, cameraMode: .nonAR, automaticallyConfigureSession: false)
        arView.environment.background = .color(.black)

        // A fixed camera looking at the origin.
        let camera = PerspectiveCamera()
        camera.position = [0, 0, 1.2]
        let camAnchor = AnchorEntity(world: .zero)
        camAnchor.addChild(camera)
        arView.scene.addAnchor(camAnchor)

        // Scene root + key light.
        arView.scene.addAnchor(model.root)
        let light = DirectionalLight()
        light.light.intensity = 2000
        light.position = [0, 1, 1]
        light.look(at: .zero, from: light.position, relativeTo: nil)
        model.root.addChild(light)

        model.attach(arView: arView)

        // Tap to select.
        let tap = UITapGestureRecognizer(target: context.coordinator,
                                         action: #selector(Coordinator.handleTap(_:)))
        arView.addGestureRecognizer(tap)
        context.coordinator.arView = arView

        if gestureEnabled { model.handPose.start() }
        return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {
        context.coordinator.model = model
    }

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    @MainActor
    final class Coordinator: NSObject {
        var model: StudioModel
        weak var arView: ARView?

        init(model: StudioModel) { self.model = model }

        @objc func handleTap(_ sender: UITapGestureRecognizer) {
            guard let arView else { return }
            let location = sender.location(in: arView)
            if let entity = arView.entity(at: location) as? ModelEntity {
                model.select(entity)
            }
        }
    }
}
