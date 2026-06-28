import Foundation
import UIKit

/// Launches other apps and opens Settings panes — the *sanctioned* form of
/// "open any installed app / go to a setting" (req 19). iOS only lets us open
/// what an app publishes via a URL scheme / universal link, and only the
/// Settings panes Apple exposes; there is no API to reach into another app's
/// internal functions. Those hard limits are documented in docs/LIMITATIONS.md.
@MainActor
enum AppLauncher {
    /// Curated URL schemes for common apps, keyed by lowercased names/aliases.
    static let schemes: [String: String] = [
        "spotify": "spotify://",
        "youtube": "youtube://",
        "maps": "maps://",
        "google maps": "comgooglemaps://",
        "whatsapp": "whatsapp://",
        "instagram": "instagram://",
        "twitter": "twitter://",
        "x": "twitter://",
        "messages": "sms:",
        "mail": "message://",
        "phone": "tel:",
        "facetime": "facetime:",
        "calendar": "calshow://",
        "notes": "mobilenotes://",
        "camera": "camera://",
        "photos": "photos-redirect://",
        "music": "music://",
        "podcasts": "podcasts://",
        "safari": "https://www.apple.com"
    ]

    /// Settings panes reachable via the `App-Prefs:` root (subset Apple allows).
    /// Falls back to the app's own settings page when a pane isn't permitted.
    static let settingsPanes: [String: String] = [
        "wifi": "App-Prefs:root=WIFI",
        "bluetooth": "App-Prefs:root=Bluetooth",
        "cellular": "App-Prefs:root=MOBILE_DATA_SETTINGS_ID",
        "notifications": "App-Prefs:root=NOTIFICATIONS_ID",
        "battery": "App-Prefs:root=BATTERY_USAGE",
        "general": "App-Prefs:root=General",
        "display": "App-Prefs:root=DISPLAY",
        "sound": "App-Prefs:root=Sounds",
        "privacy": "App-Prefs:root=Privacy",
        "accessibility": "App-Prefs:root=ACCESSIBILITY"
    ]

    @discardableResult
    static func openApp(named name: String) -> Bool {
        let key = name.lowercased().trimmingCharacters(in: .whitespaces)
        guard let scheme = schemes[key], let url = URL(string: scheme) else { return false }
        return open(url)
    }

    @discardableResult
    static func openSettings(pane: String? = nil) -> Bool {
        if let pane, let mapped = settingsPanes[pane.lowercased()], let url = URL(string: mapped),
           UIApplication.shared.canOpenURL(url) {
            return open(url)
        }
        // Default: ACTIG's own entry in Settings (always allowed).
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return false }
        return open(url)
    }

    @discardableResult
    static func openURL(_ string: String) -> Bool {
        guard let url = URL(string: string) else { return false }
        return open(url)
    }

    @discardableResult
    private static func open(_ url: URL) -> Bool {
        guard UIApplication.shared.canOpenURL(url) else { return false }
        UIApplication.shared.open(url)
        return true
    }
}
