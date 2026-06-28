import SwiftUI
import SwiftData

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
