import Foundation
#if canImport(ActivityKit)
import ActivityKit

/// Shared definition for ACTIG's Live Activity (Lock Screen + Dynamic Island).
/// Lives in both the app and the widget extension targets so each can reference
/// the same type. The Live Activity is the closest iOS allows to an
/// "always-present on-screen control" across the system (reqs 8 & 9) — it cannot
/// float over arbitrary apps, but it persists on the Lock Screen and in the
/// Dynamic Island with a wake control.
struct ACTIGActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var status: String      // e.g. "Listening", "Awake", "Idle"
        var awake: Bool
    }

    var sessionName: String
}
#endif
