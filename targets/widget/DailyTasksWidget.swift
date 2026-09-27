import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Timeline

struct TodayEntry: TimelineEntry {
  let date: Date
  /// nil when the app hasn't written anything yet, or the snapshot is from another day.
  let snapshot: Snapshot?
}

struct TodayProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayEntry {
    TodayEntry(date: Date(), snapshot: .sample)
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
    completion(context.isPreview ? TodayEntry(date: Date(), snapshot: .sample) : currentEntry())
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
    let now = Date()
    // Refresh at midnight so yesterday's tasks never show as today's.
    let midnight = Calendar.current.startOfDay(for: now).addingTimeInterval(24 * 60 * 60 + 1)
    let entries = [currentEntry(now), TodayEntry(date: midnight, snapshot: nil)]
    completion(Timeline(entries: entries, policy: .after(midnight)))
  }

  private func currentEntry(_ now: Date = Date()) -> TodayEntry {
    let snapshot = Shared.loadSnapshot()
    return TodayEntry(date: now, snapshot: snapshot?.date == Shared.todayKey(now) ? snapshot : nil)
  }
}

extension Snapshot {
  static let sample = Snapshot(
    date: Shared.todayKey(),
    tasks: [
      WidgetTask(id: "1", text: "Go for a 20-minute walk", done: true),
      WidgetTask(id: "2", text: "Reply to Sam's email", done: false),
      WidgetTask(id: "3", text: "Plan tomorrow", done: false),
    ],
    streak: 4,
    plus: true
  )
}

// MARK: - Pieces

private let appURL = URL(string: "dailytasks://")

struct ProgressRing: View {
  let completed: Int
  let total: Int
  var lineWidth: CGFloat = 6

  var body: some View {
    let fraction = total == 0 ? 0 : Double(completed) / Double(total)
    ZStack {
      Circle().stroke(Color("primary").opacity(0.18), lineWidth: lineWidth)
      Circle()
        .trim(from: 0, to: fraction)
        .stroke(Color("primary"), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        .rotationEffect(.degrees(-90))
      Text("\(completed)/\(max(total, 3))")
        .font(.system(.caption, design: .rounded).weight(.bold))
        .foregroundStyle(Color("foreground"))
    }
  }
}

struct EmptyToday: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("Today")
        .font(.system(.headline, design: .rounded))
        .foregroundStyle(Color("foreground"))
      Text("Pick your three for today.")
        .font(.subheadline)
        .foregroundStyle(Color("muted"))
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct TaskRow: View {
  let task: WidgetTask
  let date: String
  let interactive: Bool

  var body: some View {
    HStack(spacing: 8) {
      if interactive {
        Button(intent: ToggleTaskIntent(taskId: task.id, date: date, done: !task.done)) {
          checkmark
        }
        .buttonStyle(.plain)
        .accessibilityLabel(task.done ? "Mark \(task.text) not done" : "Mark \(task.text) done")
      } else {
        checkmark.accessibilityHidden(true)
      }
      Text(task.text)
        .font(.subheadline.weight(.semibold))
        .strikethrough(task.done)
        .foregroundStyle(task.done ? Color("muted") : Color("foreground"))
        .lineLimit(1)
      Spacer(minLength: 0)
    }
  }

  private var checkmark: some View {
    Image(systemName: task.done ? "checkmark.circle.fill" : "circle")
      .font(.title3)
      .foregroundStyle(task.done ? Color("success") : Color("muted"))
  }
}

// MARK: - Families

struct SmallView: View {
  let snapshot: Snapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        ProgressRing(completed: snapshot.completed, total: snapshot.tasks.count)
          .frame(width: 44, height: 44)
        Spacer()
        if snapshot.streak > 0 {
          Label("\(snapshot.streak)", systemImage: "flame.fill")
            .font(.caption.weight(.bold))
            .foregroundStyle(Color("primary"))
            .accessibilityLabel("\(snapshot.streak) day streak")
        }
      }
      Spacer(minLength: 0)
      if let next = snapshot.nextOpen {
        Text("Next")
          .font(.caption2.weight(.semibold))
          .foregroundStyle(Color("muted"))
        Text(next.text)
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(Color("foreground"))
          .lineLimit(2)
      } else {
        Text("All done. You showed up today.")
          .font(.subheadline.weight(.semibold))
          .foregroundStyle(Color("foreground"))
          .lineLimit(2)
      }
    }
  }
}

struct MediumView: View {
  let snapshot: Snapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("Today")
          .font(.system(.headline, design: .rounded))
          .foregroundStyle(Color("foreground"))
        Spacer()
        Text("\(snapshot.completed) of \(snapshot.tasks.count) done")
          .font(.caption.weight(.semibold))
          .foregroundStyle(Color("muted"))
      }
      ForEach(snapshot.tasks) { task in
        TaskRow(task: task, date: snapshot.date, interactive: snapshot.plus)
      }
      Spacer(minLength: 0)
      if !snapshot.plus {
        Text("Tick tasks off from here with Plus")
          .font(.caption2)
          .foregroundStyle(Color("muted"))
      }
    }
  }
}

struct DailyTasksWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: TodayEntry

  var body: some View {
    Group {
      switch family {
      case .accessoryCircular:
        circular
      case .accessoryRectangular:
        rectangular
      case .accessoryInline:
        inline
      case .systemMedium:
        if let snapshot = entry.snapshot, !snapshot.tasks.isEmpty {
          MediumView(snapshot: snapshot)
        } else {
          EmptyToday()
        }
      default:
        if let snapshot = entry.snapshot, !snapshot.tasks.isEmpty {
          SmallView(snapshot: snapshot)
        } else {
          EmptyToday()
        }
      }
    }
    .widgetURL(appURL)
    .containerBackground(for: .widget) { Color("$widgetBackground") }
  }

  private var completed: Int { entry.snapshot?.completed ?? 0 }
  private var total: Int { entry.snapshot?.tasks.count ?? 0 }

  private var circular: some View {
    Gauge(value: Double(completed), in: 0...Double(max(total, 1))) {
      Image(systemName: "checkmark")
    } currentValueLabel: {
      Text("\(completed)/\(max(total, 3))")
    }
    .gaugeStyle(.accessoryCircularCapacity)
    .accessibilityLabel("\(completed) of \(total) tasks done today")
  }

  private var rectangular: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("Today · \(completed)/\(max(total, 3))")
        .font(.headline)
      if let next = entry.snapshot?.nextOpen {
        Text(next.text).lineLimit(2)
      } else if total > 0 {
        Text("All done")
      } else {
        Text("Pick your three")
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var inline: some View {
    if let next = entry.snapshot?.nextOpen {
      Text("\(completed)/\(max(total, 3)) · \(next.text)")
    } else if total > 0 {
      Text("All \(total) done today")
    } else {
      Text("Pick your three")
    }
  }
}

// MARK: - Widget

struct DailyTasksWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Shared.kind, provider: TodayProvider()) { entry in
      DailyTasksWidgetView(entry: entry)
    }
    .configurationDisplayName("Today's three")
    .description("See today's tasks and tick them off.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}

@main
struct DailyTasksWidgetBundle: WidgetBundle {
  var body: some Widget {
    DailyTasksWidget()
  }
}
