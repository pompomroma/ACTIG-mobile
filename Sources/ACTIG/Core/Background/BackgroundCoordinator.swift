import Foundation
#if canImport(BackgroundTasks)
import BackgroundTasks
#endif

/// Registers and schedules background tasks so ACTIG can periodically resume
/// listening and drain queued work (req 3 — "always active" to the maximum iOS
/// permits). iOS still decides when/if these run and apps cannot run
/// continuously; this is the sanctioned mechanism, documented in
/// docs/LIMITATIONS.md. Task identifiers must match
/// `BGTaskSchedulerPermittedIdentifiers` in Info.plist.
@MainActor
final class BackgroundCoordinator {
    static let refreshID = "com.actig.refresh"
    static let processID = "com.actig.process"

    /// Optional hook invoked when a background window opens (e.g. resume voice).
    var onBackgroundTick: (() -> Void)?

    /// Register handlers. Must be called before app finishes launching.
    func register() {
        #if canImport(BackgroundTasks)
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshID, using: nil) { task in
            Task { @MainActor in self.handle(task) }
        }
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.processID, using: nil) { task in
            Task { @MainActor in self.handle(task) }
        }
        #endif
    }

    /// Ask the system to schedule the next windows.
    func schedule() {
        #if canImport(BackgroundTasks)
        let refresh = BGAppRefreshTaskRequest(identifier: Self.refreshID)
        refresh.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(refresh)

        let process = BGProcessingTaskRequest(identifier: Self.processID)
        process.requiresNetworkConnectivity = false
        process.earliestBeginDate = Date(timeIntervalSinceNow: 30 * 60)
        try? BGTaskScheduler.shared.submit(process)
        #endif
    }

    #if canImport(BackgroundTasks)
    private func handle(_ task: BGTask) {
        schedule() // chain the next window
        onBackgroundTick?()
        task.setTaskCompleted(success: true)
    }
    #endif
}
