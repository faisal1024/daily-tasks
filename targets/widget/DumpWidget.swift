// The Dump widget and control (1.6 E): one tap opens Three Today straight to
// the brain dump (`dailytasks://dump?source=widget`, handled by
// app/+native-intent.tsx). Nothing personal is shown, so it's the same on a
// locked phone. See lib/daily-tasks/capture.ts.

import AppIntents
import SwiftUI
import WidgetKit

struct DumpEntry: TimelineEntry {
  let date: Date
}

/// Nothing changes: one entry, never refreshed.
struct DumpProvider: TimelineProvider {
  func placeholder(in context: Context) -> DumpEntry { DumpEntry(date: Date()) }

  func getSnapshot(in context: Context, completion: @escaping (DumpEntry) -> Void) {
    completion(DumpEntry(date: Date()))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<DumpEntry>) -> Void) {
    completion(Timeline(entries: [DumpEntry(date: Date())], policy: .never))
  }
}

struct DumpWidgetView: View {
  @Environment(\.widgetFamily) var family
  @Environment(\.widgetRenderingMode) var renderingMode

  static let symbol = "square.and.pencil"

  var body: some View {
    Group {
      switch family {
      case .accessoryCircular:
        ZStack {
          AccessoryWidgetBackground()
          Image(systemName: Self.symbol)
            .font(.title2.weight(.semibold))
            .widgetAccentable()
        }
      case .accessoryRectangular:
        VStack(alignment: .leading, spacing: 2) {
          Label("Brain dump", systemImage: Self.symbol)
            .font(.headline)
            .widgetAccentable()
          Text("Get it out of your head")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      default:
        VStack(alignment: .leading, spacing: 6) {
          Image(systemName: Self.symbol)
            .font(.title.weight(.semibold))
            .foregroundStyle(renderingMode == .fullColor ? Color("primary") : Color.primary)
            .widgetAccentable()
          Spacer(minLength: 0)
          Text("Brain dump")
            .font(.system(.headline, design: .rounded).weight(.bold))
            .foregroundStyle(renderingMode == .fullColor ? Color("foreground") : Color.primary)
          Text("Get it out of your head")
            .font(.caption)
            .foregroundStyle(renderingMode == .fullColor ? Color("muted") : Color.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Brain dump")
    .accessibilityHint("Opens Three Today to write everything down")
    .widgetURL(CaptureGroup.dumpURL(source: "widget"))
    .containerBackground(for: .widget) {
      if family == .systemSmall { Color("$widgetBackground") } else { Color.clear }
    }
  }
}

struct DumpWidget: Widget {
  static let kind = "ThreeTodayDump"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Self.kind, provider: DumpProvider()) { _ in
      DumpWidgetView()
    }
    .configurationDisplayName("Brain dump")
    .description("Get a thought out of your head: opens Three Today straight to the brain dump.")
    .supportedFamilies([.accessoryCircular, .accessoryRectangular, .systemSmall])
  }
}

/// Control Center, the Lock Screen's controls and the Action button (iOS 18).
@available(iOS 18.0, *)
struct DumpControl: ControlWidget {
  static let kind = "com.faisalislam.dailytasks.dump"

  var body: some ControlWidgetConfiguration {
    StaticControlConfiguration(kind: Self.kind) {
      ControlWidgetButton(action: OpenDumpFromControlIntent()) {
        Label("Brain dump", systemImage: DumpWidgetView.symbol)
      }
    }
    .displayName("Brain dump")
    .description("Opens Three Today straight to the brain dump.")
  }
}

#Preview("Dump circular", as: .accessoryCircular) {
  DumpWidget()
} timeline: {
  DumpEntry(date: Date())
}

#Preview("Dump rectangular", as: .accessoryRectangular) {
  DumpWidget()
} timeline: {
  DumpEntry(date: Date())
}

#Preview("Dump small", as: .systemSmall) {
  DumpWidget()
} timeline: {
  DumpEntry(date: Date())
}
