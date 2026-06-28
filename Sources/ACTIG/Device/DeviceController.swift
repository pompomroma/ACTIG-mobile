import Foundation
import UIKit

/// Sanctioned device/cross-app control (req 18 & 19). iOS forbids true "access
/// to everything", so this exposes the *allowed* surface: launching apps and
/// deep actions via URL schemes / x-callback-url, opening Settings panes, and
/// playing music. Permission-gated data (Contacts/Calendar/etc.) is added here
/// behind the system permission prompts.
@MainActor
final class DeviceController {
    private let music = MusicController()

    /// Play a track/playlist the user requested (req 18). Tries Apple Music via
    /// MusicKit first, then falls back to deep-linking Spotify / a web search.
    @discardableResult
    func playMusic(query: String) async -> Bool {
        if await music.playAppleMusic(query: query) { return true }
        if openURL(spotifySearchURL(query)) { return true }
        return openURL(webSearchURL("play \(query)"))
    }

    /// Launch another app by its URL scheme (req 19, the allowed form of "open
    /// any installed app"). Returns false if the scheme isn't installed.
    @discardableResult
    func launchApp(scheme: String) -> Bool {
        guard let url = URL(string: scheme) else { return false }
        return openURL(url)
    }

    /// Open a specific Settings pane (req 19: settings access, within limits).
    @discardableResult
    func openSettings(pane: String = UIApplication.openSettingsURLString) -> Bool {
        guard let url = URL(string: pane) else { return false }
        return openURL(url)
    }

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
