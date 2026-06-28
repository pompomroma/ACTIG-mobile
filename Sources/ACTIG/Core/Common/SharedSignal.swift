import Foundation

/// Cross-process hand-off between the widget/Control-Center extension and the
/// main app. App Intents run in the extension's process, so an in-memory flag
/// wouldn't be visible to the app; this writes to the shared app-group
/// `UserDefaults`, which the app drains on activation.
enum SharedSignal {
    private static let suite = UserDefaults(suiteName: "group.com.actig.shared")
    private static let key = "pendingAction"

    /// The actions an intent can hand off to the app, encoded as plain strings
    /// so both targets can use it without sharing the SwiftUI/app types.
    enum Action: Equatable {
        case wake
        case openStudio
        case command(String)

        var encoded: String {
            switch self {
            case .wake: "wake"
            case .openStudio: "openStudio"
            case .command(let s): "cmd:\(s)"
            }
        }

        init?(encoded: String) {
            if encoded == "wake" { self = .wake }
            else if encoded == "openStudio" { self = .openStudio }
            else if encoded.hasPrefix("cmd:") { self = .command(String(encoded.dropFirst(4))) }
            else { return nil }
        }
    }

    static func set(_ action: Action) {
        suite?.set(action.encoded, forKey: key)
    }

    static func take() -> Action? {
        guard let raw = suite?.string(forKey: key) else { return nil }
        suite?.removeObject(forKey: key)
        return Action(encoded: raw)
    }
}
