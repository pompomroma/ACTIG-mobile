import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Starts/updates/ends ACTIG's Live Activity so a wake control persists on the
/// Lock Screen and in the Dynamic Island while ACTIG is in use (reqs 8 & 9).
/// Guarded so it compiles and no-ops where ActivityKit/Live Activities are
/// unavailable (older OS, Simulator without support, free builds).
@MainActor
final class LiveActivityManager {
    #if canImport(ActivityKit)
    private var activity: Activity<ACTIGActivityAttributes>?
    #endif

    func start(status: String = "Listening") {
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled, activity == nil else { return }
            let attributes = ACTIGActivityAttributes(sessionName: "ACTIG")
            let state = ACTIGActivityAttributes.ContentState(status: status, awake: false)
            activity = try? Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: nil)
            )
        }
        #endif
    }

    func update(status: String, awake: Bool) {
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            let state = ACTIGActivityAttributes.ContentState(status: status, awake: awake)
            Task { await activity?.update(.init(state: state, staleDate: nil)) }
        }
        #endif
    }

    func stop() {
        #if canImport(ActivityKit)
        if #available(iOS 16.1, *) {
            Task { await activity?.end(nil, dismissalPolicy: .immediate); activity = nil }
        }
        #endif
    }
}
