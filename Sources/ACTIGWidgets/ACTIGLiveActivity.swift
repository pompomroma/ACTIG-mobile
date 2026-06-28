import SwiftUI
import WidgetKit
#if canImport(ActivityKit)
import ActivityKit

/// Lock Screen + Dynamic Island presentation for ACTIG's Live Activity. The
/// expanded/compact regions show status and a wake control, giving an
/// always-present entry point across the system (reqs 8 & 9) within iOS rules.
@available(iOS 16.1, *)
struct ACTIGLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: ACTIGActivityAttributes.self) { context in
            // Lock Screen / banner.
            HStack {
                Image(systemName: context.state.awake ? "waveform.circle.fill" : "bolt.fill")
                    .foregroundStyle(Color(red: 0.27, green: 0.78, blue: 1.0))
                VStack(alignment: .leading) {
                    Text("ACTIG").font(.headline)
                    Text(context.state.status).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Link(destination: URL(string: "actig://wake")!) {
                    Image(systemName: "mic.fill").font(.title3)
                }
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.6))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "bolt.fill")
                        .foregroundStyle(Color(red: 0.27, green: 0.78, blue: 1.0))
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.status).font(.caption)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Link(destination: URL(string: "actig://wake")!) {
                        Image(systemName: "mic.fill")
                    }
                }
            } compactLeading: {
                Image(systemName: "bolt.fill")
                    .foregroundStyle(Color(red: 0.27, green: 0.78, blue: 1.0))
            } compactTrailing: {
                Image(systemName: context.state.awake ? "waveform" : "mic")
            } minimal: {
                Image(systemName: "bolt.fill")
            }
            .widgetURL(URL(string: "actig://wake"))
        }
    }
}
#endif
