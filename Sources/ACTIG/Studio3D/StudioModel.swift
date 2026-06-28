import Foundation
import RealityKit
import Combine

/// Owns the studio scene graph and the operations the UI/voice/gestures invoke
/// (spawn, drag, scale, clone, delete). Kept separate from the SwiftUI view so
/// gesture controllers and the command router can drive the same scene.
@MainActor
final class StudioModel {
    /// Root anchor everything is parented to.
    let root = AnchorEntity(world: .zero)
    private(set) var entities: [ModelEntity] = []
    private(set) var selected: ModelEntity?
    private var gestureEnabled = true
    private weak var arView: ARView?

    let handPose = HandPoseController()

    init() {
        // Hand-pose callbacks map camera gestures onto scene operations (req 4).
        handPose.onPinchDrag = { [weak self] delta in self?.moveSelected(by: delta) }
        handPose.onTwoHandScale = { [weak self] factor in self?.scaleSelected(by: factor) }
    }

    /// Called by the view once the `ARView` exists, so touch gestures can be
    /// installed on entities.
    func attach(arView: ARView) { self.arView = arView }

    func spawn(_ kind: ShapeKind) {
        let entity = ShapeFactory.make(kind)
        root.addChild(entity)
        entities.append(entity)
        selected = entity
        installTouchGestures(on: entity)
    }

    func select(_ entity: ModelEntity?) { selected = entity }

    /// Native translate + scale + rotate touch gestures (req 4: touch/mouse drag
    /// and pinch/scroll scaling).
    private func installTouchGestures(on entity: ModelEntity) {
        entity.generateCollisionShapes(recursive: true)
        arView?.installGestures([.translation, .scale, .rotation], for: entity)
    }

    func moveSelected(by delta: SIMD3<Float>) {
        guard let selected else { return }
        selected.position += delta
    }

    /// Scale around the current size; clamps to a sane range (req 4: enlarge/shrink).
    func scaleSelected(by factor: Float) {
        guard let selected else { return }
        let next = (selected.scale * factor).clamped(min: 0.2, max: 6.0)
        selected.scale = next
    }

    func cloneSelected() {
        guard let selected else { return }
        let copy = ShapeFactory.clone(selected)
        root.addChild(copy)
        entities.append(copy)
        self.selected = copy
        installTouchGestures(on: copy)
    }

    func deleteSelected() {
        guard let selected else { return }
        let targetID = selected.id
        selected.removeFromParent()
        entities.removeAll { $0.id == targetID }
        self.selected = entities.last
    }

    func reset() {
        for e in entities { e.removeFromParent() }
        entities.removeAll()
        selected = nil
    }

    func setGestureControl(_ on: Bool) {
        gestureEnabled = on
        if on { handPose.start() } else { handPose.stop() }
    }
}

private extension SIMD3 where Scalar == Float {
    func clamped(min lo: Float, max hi: Float) -> SIMD3<Float> {
        SIMD3(Swift.min(Swift.max(x, lo), hi),
              Swift.min(Swift.max(y, lo), hi),
              Swift.min(Swift.max(z, lo), hi))
    }
}
