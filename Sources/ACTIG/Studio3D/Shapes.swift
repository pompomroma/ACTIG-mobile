import Foundation
import RealityKit
import UIKit

/// Library of primitive shapes the user can spawn into the workspace (req 4:
/// "various shapes of 3D objects"). Each builds a RealityKit `ModelEntity` with
/// collision + input enabled so it can be dragged, scaled, and cloned.
enum ShapeKind: String, CaseIterable, Identifiable {
    case box, sphere, cylinder, cone, capsule, plane, torusApprox

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .box: "cube"
        case .sphere: "circle.fill"
        case .cylinder: "cylinder"
        case .cone: "cone"
        case .capsule: "capsule"
        case .plane: "square"
        case .torusApprox: "circle.circle"
        }
    }

    func makeMesh() -> MeshResource {
        switch self {
        case .box: .generateBox(size: 0.1, cornerRadius: 0.005)
        case .sphere: .generateSphere(radius: 0.06)
        case .cylinder: .generateCylinder(height: 0.12, radius: 0.05)
        case .cone: .generateCone(height: 0.12, radius: 0.05)
        case .capsule: .generateCapsule(height: 0.14, radius: 0.04)
        case .plane: .generatePlane(width: 0.12, depth: 0.12)
        case .torusApprox: .generateSphere(radius: 0.07) // torus not built-in; placeholder
        }
    }
}

enum ShapeFactory {
    /// Builds an interactive holographic-looking entity.
    static func make(_ kind: ShapeKind, at position: SIMD3<Float> = [0, 0, -0.4]) -> ModelEntity {
        var material = PhysicallyBasedMaterial()
        material.baseColor = .init(tint: UIColor(red: 0.27, green: 0.78, blue: 1.0, alpha: 0.85))
        material.roughness = 0.15
        material.metallic = 0.6
        material.emissiveColor = .init(color: UIColor(red: 0.27, green: 0.78, blue: 1.0, alpha: 1))
        material.emissiveIntensity = 0.4
        material.blending = .transparent(opacity: 0.85)

        let entity = ModelEntity(mesh: kind.makeMesh(), materials: [material])
        entity.position = position
        entity.name = "\(kind.rawValue)-\(UUID().uuidString.prefix(6))"
        entity.generateCollisionShapes(recursive: true)
        entity.components.set(InputTargetComponent())
        return entity
    }

    /// Deep-copies an entity to implement "cloned" (req 4).
    static func clone(_ entity: ModelEntity) -> ModelEntity {
        let copy = entity.clone(recursive: true)
        copy.position += [0.12, 0, 0]
        copy.name = entity.name + "-clone"
        return copy
    }
}
