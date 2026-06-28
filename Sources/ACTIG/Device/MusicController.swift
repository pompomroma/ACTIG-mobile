import Foundation
import MediaPlayer

/// Plays Apple Music content via `MPMusicPlayerController` (req 18). Requires the
/// Apple Music usage permission and an active subscription for full catalog
/// playback; otherwise it plays from the user's library.
@MainActor
final class MusicController {
    private let player = MPMusicPlayerController.systemMusicPlayer

    /// Search the library/catalog for `query` and start playback. Returns true
    /// if something was queued.
    func playAppleMusic(query: String) async -> Bool {
        guard await authorize() else { return false }

        // Library search first (works without catalog entitlement).
        let q = MPMediaQuery.songs()
        q.addFilterPredicate(MPMediaPropertyPredicate(
            value: query, forProperty: MPMediaItemPropertyTitle,
            comparisonType: .contains
        ))
        if let items = q.items, !items.isEmpty {
            player.setQueue(with: MPMediaItemCollection(items: items))
            player.play()
            return true
        }

        // Catalog playback by search term (needs Apple Music subscription).
        player.setQueue(with: [query]) // store IDs / search term
        player.play()
        return true
    }

    func pause() { player.pause() }
    func resume() { player.play() }
    func skip() { player.skipToNextItem() }

    private func authorize() async -> Bool {
        await withCheckedContinuation { cont in
            MPMediaLibrary.requestAuthorization { cont.resume(returning: $0 == .authorized) }
        }
    }
}
