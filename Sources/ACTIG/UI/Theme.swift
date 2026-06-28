import SwiftUI

/// Shared "hologram" visual language: cyan glow, glassmorphic panels, scanline
/// accents — the JARVIS aesthetic (req 5).
enum Holo {
    static let primary = Color(red: 0.27, green: 0.78, blue: 1.0)
    static let accent = Color(red: 0.55, green: 0.9, blue: 1.0)
    static let danger = Color(red: 1.0, green: 0.32, blue: 0.36)

    static var glassBackground: some ShapeStyle {
        LinearGradient(
            colors: [primary.opacity(0.18), primary.opacity(0.04)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
    }
}

/// A reusable holographic panel modifier.
struct HoloPanel: ViewModifier {
    var cornerRadius: CGFloat = 18
    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: cornerRadius))
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius)
                    .stroke(Holo.primary.opacity(0.6), lineWidth: 1)
            )
            .shadow(color: Holo.primary.opacity(0.4), radius: 12)
    }
}

extension View {
    func holoPanel(cornerRadius: CGFloat = 18) -> some View {
        modifier(HoloPanel(cornerRadius: cornerRadius))
    }
}

/// A glowing circular holo button used throughout the HUD.
struct HoloButton: View {
    let systemImage: String
    var tint: Color = Holo.primary
    var size: CGFloat = 54
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: size * 0.4, weight: .semibold))
                .frame(width: size, height: size)
                .foregroundStyle(tint)
                .background(.ultraThinMaterial, in: Circle())
                .overlay(Circle().stroke(tint.opacity(0.7), lineWidth: 1.5))
                .shadow(color: tint.opacity(0.6), radius: 10)
        }
        .buttonStyle(.plain)
    }
}
