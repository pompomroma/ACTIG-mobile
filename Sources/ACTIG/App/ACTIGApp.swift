import SwiftUI
import SwiftData
import UIKit

/// App delegate for the few things SwiftUI's `App` can't do directly: register
/// background-task handlers before launch finishes, and receive the APNs token.
@MainActor
final class ACTIGAppDelegate: NSObject, UIApplicationDelegate {
    let background = BackgroundCoordinator()

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions:
                     [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        background.register()
        // When iOS grants a background window, surface a tap-to-wake prompt
        // (apps cannot resume listening fully on their own — see LIMITATIONS.md).
        background.onBackgroundTick = { PushManager.shared.scheduleWakeReminder(after: 1) }
        background.schedule()
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        // No backend in this build; persist for a future push server.
        UserDefaults(suiteName: "group.com.actig.shared")?.set(token, forKey: "apnsToken")
    }
}

/// Application entry point.
///
/// Sets up the SwiftData model container (history + checkpoints + file-vault
/// index) and injects the shared ``AppState`` actor-backed view model. Scene
/// restoration is handled by SwiftUI automatically for the navigation state;
/// the conversation itself is reloaded from `HistoryStore` on launch, which is
/// the closest iOS allows to "resume where it left off" after the OS suspends
/// or terminates the app.
@main
struct ACTIGApp: App {
    /// Shared model container for all persisted types.
    let modelContainer: ModelContainer

    @UIApplicationDelegateAdaptor(ACTIGAppDelegate.self) private var appDelegate
    @State private var appState: AppState

    init() {
        do {
            let container = try ModelContainer(
                for: ConversationTurn.self, WorkflowCheckpoint.self, VaultItem.self
            )
            self.modelContainer = container
            _appState = State(initialValue: AppState(modelContext: container.mainContext))
        } catch {
            fatalError("Failed to create ModelContainer: \(error)")
        }
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .task { await appState.bootstrap() }
        }
        .modelContainer(modelContainer)
    }
}
