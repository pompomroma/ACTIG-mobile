import Foundation
import UIKit

/// Sanctioned device/cross-app control (req 18 & 19). iOS forbids true "access
/// to everything", so this exposes the *allowed* surface: launching apps and
/// deep actions via URL schemes / x-callback-url, opening Settings panes,
/// playing music, and permission-gated personal data via `PersonalDataController`.
/// The hard limits are documented in docs/LIMITATIONS.md.
@MainActor
final class DeviceController {
    private let music = MusicController()
    let personal = PersonalDataController()

    /// Play a track/playlist the user requested (req 18). Tries Apple Music via
    /// MusicKit first, then falls back to deep-linking Spotify / a web search.
    @discardableResult
    func playMusic(query: String) async -> Bool {
        if await music.playAppleMusic(query: query) { return true }
        if openURL(spotifySearchURL(query)) { return true }
        return openURL(webSearchURL("play \(query)"))
    }

    func pauseMusic() { music.pause() }
    func skipMusic() { music.skip() }

    /// Launch another app by friendly name (req 19, allowed form of "open any app").
    @discardableResult
    func launchApp(named name: String) -> Bool { AppLauncher.openApp(named: name) }

    /// Launch by raw scheme/URL.
    @discardableResult
    func launchApp(scheme: String) -> Bool { AppLauncher.openURL(scheme) }

    /// Open a Settings pane by friendly name (e.g. "wifi"), or ACTIG's settings.
    @discardableResult
    func openSettings(pane: String? = nil) -> Bool { AppLauncher.openSettings(pane: pane) }

    // MARK: helpers

    @discardableResult
    private func openURL(_ url: URL?) -> Bool {
        guard let url, UIApplication.shared.canOpenURL(url) else { return false }
        UIApplication.shared.open(url)
        return true
    }

    private func spotifySearchURL(_ q: String) -> URL? {
        let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "spotify://search/\(enc)")
    }

    private func webSearchURL(_ q: String) -> URL? {
        let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return URL(string: "https://www.youtube.com/results?search_query=\(enc)")
    }
}
