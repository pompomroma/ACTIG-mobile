import Foundation
import UserNotifications
import UIKit

/// Handles notifications so ACTIG can be "woken" remotely or on a schedule —
/// the sanctioned approximation of an external wake when the custom wake word
/// can't be heard (reqs 6 & 8). A push (from your own server or a Shortcut) or a
/// scheduled local notification, when tapped, queues a wake via `SharedSignal`
/// which the app drains on activation. No-ops cleanly on Simulator / free builds.
@MainActor
final class PushManager: NSObject {
    static let shared = PushManager()

    /// Ask for notification permission and register for remote (APNs) pushes.
    func configure() async {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        guard granted else { return }
        UIApplication.shared.registerForRemoteNotifications()
    }

    /// Schedule a local "tap to wake ACTIG" notification after `delay` seconds.
    func scheduleWakeReminder(after delay: TimeInterval) {
        let content = UNMutableNotificationContent()
        content.title = Strings.appName
        content.body = "Tap to wake ACTIG."
        content.sound = .default
        content.userInfo = ["action": "wake"]
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, delay), repeats: false)
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }
}

extension PushManager: UNUserNotificationCenterDelegate {
    /// Tapping a notification queues a wake the app drains on next activation.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        if info["action"] as? String == "wake" {
            await MainActor.run { SharedSignal.set(.wake) }
        }
    }

    /// Show notifications even while ACTIG is foregrounded.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async
    -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
