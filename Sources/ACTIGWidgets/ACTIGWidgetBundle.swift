import WidgetKit
import SwiftUI
import AppIntents

/// Widget + Control Center bundle. These are the system-wide, always-reachable
/// entry points that approximate "buttons available on any screen" (req 8 & 9)
/// within iOS rules: a Lock/Home-Screen widget and a Control Center control,
/// both of which wake ACTIG via the shared `WakeACTIGIntent`.
@main
struct ACTIGWidgetBundle: WidgetBundle {
    var body: some Widget {
        ACTIGWakeWidget()
        if #available(iOS 18.0, *) {
            ACTIGControl()
        }
        if #available(iOS 16.1, *) {
            ACTIGLiveActivity()
        }
    }
}

/// A tappable Lock/Home-Screen widget that wakes ACTIG.
struct ACTIGWakeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ACTIGWakeWidget", provider: WakeProvider()) { _ in
            ZStack {
                ContainerRelativeShape().fill(.black)
                VStack(spacing: 6) {
                    Image(systemName: "bolt.fill")
                        .font(.title)
                        .foregroundStyle(Color(red: 0.27, green: 0.78, blue: 1.0))
                    Text("Wake ACTIG").font(.caption2).foregroundStyle(.white)
                }
            }
            .widgetURL(URL(string: "actig://wake"))
        }
        .configurationDisplayName("Wake ACTIG")
        .description("Tap to wake ACTIG and start listening.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

struct WakeProvider: TimelineProvider {
    struct Entry: TimelineEntry { let date: Date }
    func placeholder(in context: Context) -> Entry { Entry(date: .now) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        completion(Entry(date: .now))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        completion(Timeline(entries: [Entry(date: .now)], policy: .never))
    }
}

/// Control Center control (iOS 18+) that runs the wake intent directly.
@available(iOS 18.0, *)
struct ACTIGControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.actig.control.wake") {
            ControlWidgetButton(action: WakeACTIGIntent()) {
                Label("Wake ACTIG", systemImage: "bolt.fill")
            }
        }
        .displayName("Wake ACTIG")
    }
}
