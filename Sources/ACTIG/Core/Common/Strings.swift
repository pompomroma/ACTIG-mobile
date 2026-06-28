import Foundation

/// Centralized user-facing constant strings. The wake and reaction phrases are
/// fixed by the spec (requirements 6 & 7). Shared between the app and the widget
/// extension.
enum Strings {
    static let wakeWord = "wake up ACTIG"
    static let wakeReaction = "ACTIG at your service sir"
    static let appName = "ACTIG"
}
