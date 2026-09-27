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
    // Refresh at the next local midnight so yesterday's tasks never show as
    // today's. Calendar math (not +24h) keeps this right on DST change days.
    let calendar = Calendar.current
    let midnight =
      calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))
      ?? now.addingTimeInterval(60 * 60)
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

  var total: Int { tasks.count }
  var allDone: Bool { !tasks.isEmpty && completed == total }
  /// One wording for progress everywhere (text, ring label and VoiceOver).
  var progressText: String { "\(completed)/\(total)" }
  var progressSpoken: String { "\(completed) of \(total) done" }
}

// MARK: - Pieces

private let appURL = URL(string: "dailytasks://")

struct ProgressRing: View {
  let snapshot: Snapshot
  var lineWidth: CGFloat = 6

  var body: some View {
    let fraction = snapshot.total == 0 ? 0 : Double(snapshot.completed) / Double(snapshot.total)
    ZStack {
      Circle().stroke(Color("primary").opacity(0.18), lineWidth: lineWidth)
      Circle()
        .trim(from: 0, to: fraction)
        .stroke(Color("primary"), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        .rotationEffect(.degrees(-90))
        .widgetAccentable()
      Text(snapshot.progressText)
        .font(.system(.caption, design: .rounded).weight(.bold))
        .foregroundStyle(Color("foreground"))
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(snapshot.progressSpoken)
  }
}

struct EmptyToday: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("Today")
        .font(.system(.headline, design: .rounded))
        .foregroundStyle(Color("foreground"))
      Text("Open to pick your three for today.")
        .font(.subheadline)
        .foregroundStyle(Color("muted"))
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

/// One task. For Plus the whole row is the button (a near-miss mustn't open
/// the app instead); for free users it's plain text with a non-control marker.
struct TaskRow: View {
  let task: WidgetTask
  let date: String
  let interactive: Bool

  var body: some View {
    if interactive {
      Button(intent: ToggleTaskIntent(taskId: task.id, date: date, done: !task.done)) {
        content(marker: task.done ? "checkmark.circle.fill" : "circle")
      }
      .buttonStyle(.plain)
      .accessibilityLabel(task.text)
      .accessibilityValue(task.done ? "Done" : "Not done")
      .accessibilityHint(task.done ? "Marks it not done" : "Marks it done")
    } else {
      content(marker: task.done ? "checkmark.circle.fill" : "circle.fill")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(task.text)
        .accessibilityValue(task.done ? "Done" : "Not done")
    }
  }

  private func content(marker: String) -> some View {
    HStack(spacing: 8) {
      Image(systemName: marker)
        .font(interactive || task.done ? .title3 : .caption2)
        .frame(width: 24)
        .foregroundStyle(task.done ? Color("success") : Color("muted"))
        .widgetAccentable()
      Text(task.text)
        .font(.subheadline.weight(.semibold))
        .strikethrough(task.done)
        .foregroundStyle(task.done ? Color("muted") : Color("foreground"))
        .lineLimit(1)
        .minimumScaleFactor(0.85)
        .privacySensitive()
      Spacer(minLength: 0)
    }
    // A comfortable tap target only where the row is a button; read-only rows
    // keep their natural height so the medium widget fits on small phones.
    .frame(minHeight: interactive ? 26 : nil)
    .contentShape(Rectangle())
  }
}

// MARK: - Families

struct SmallView: View {
  let snapshot: Snapshot

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        ProgressRing(snapshot: snapshot)
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
        VStack(alignment: .leading, spacing: 2) {
          Text("Next")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Color("muted"))
          Text(next.text)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color("foreground"))
            .lineLimit(2)
            .privacySensitive()
        }
        .accessibilityElement(children: .combine)
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
    VStack(alignment: .leading, spacing: 4) {
      HStack {
        Text("Today")
          .font(.system(.headline, design: .rounded))
          .foregroundStyle(Color("foreground"))
        Spacer()
        Text(snapshot.allDone ? "All done. You showed up today." : snapshot.progressSpoken)
          .font(.caption.weight(.semibold))
          .foregroundStyle(Color("muted"))
          .lineLimit(1)
      }
      ForEach(snapshot.tasks) { task in
        TaskRow(task: task, date: snapshot.date, interactive: snapshot.plus)
      }
      Spacer(minLength: 0)
      if !snapshot.plus {
        Text("Tap to open. With Plus, tick off right here.")
          .font(.caption2)
          .foregroundStyle(Color("muted"))
          .lineLimit(1)
          .minimumScaleFactor(0.8)
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
        if let snapshot, !snapshot.tasks.isEmpty {
          MediumView(snapshot: snapshot)
        } else {
          EmptyToday()
        }
      default:
        if let snapshot, !snapshot.tasks.isEmpty {
          SmallView(snapshot: snapshot)
        } else {
          EmptyToday()
        }
      }
    }
    .widgetURL(appURL)
    .containerBackground(for: .widget) { Color("$widgetBackground") }
  }

  private var snapshot: Snapshot? {
    guard let snapshot = entry.snapshot, !snapshot.tasks.isEmpty else { return nil }
    return snapshot
  }

  private var circular: some View {
    Group {
      if let snapshot {
        Gauge(value: Double(snapshot.completed), in: 0...Double(snapshot.total)) {
          Image(systemName: "checkmark")
        } currentValueLabel: {
          Text(snapshot.progressText)
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .accessibilityLabel("Today, \(snapshot.progressSpoken)")
      } else {
        Image(systemName: "checklist")
          .font(.title2)
          .accessibilityLabel("Pick your three for today")
      }
    }
  }

  private var rectangular: some View {
    VStack(alignment: .leading, spacing: 2) {
      if let snapshot {
        Text("Today · \(snapshot.progressText)")
          .font(.headline)
        if let next = snapshot.nextOpen {
          Text(next.text).lineLimit(2).privacySensitive()
        } else {
          Text("All done")
        }
      } else {
        Text("Today").font(.headline)
        Text("Pick your three")
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private var inline: some View {
    if let snapshot, let next = snapshot.nextOpen {
      Text("\(snapshot.progressText) · \(next.text)").privacySensitive()
    } else if let snapshot {
      Text("All \(snapshot.total) done today")
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
    .description("Today's three at a glance. With Plus, tick them off right here.")
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
