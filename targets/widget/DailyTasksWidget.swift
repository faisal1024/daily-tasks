import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Timeline

struct TodayEntry: TimelineEntry {
  let date: Date
  /// nil when the app hasn't written anything yet, or the snapshot is from another day.
  let snapshot: Snapshot?
  /// Today's focus session (1.3), if there is one.
  var session: FocusSessionMirror? = nil
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
    let calendar = Calendar.current
    // Refresh at the next local midnight so yesterday's tasks never show as
    // today's. Calendar math (not +24h) keeps this right on DST change days.
    let midnight =
      calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))
      ?? now.addingTimeInterval(60 * 60)
    let current = currentEntry(now)
    // Same data, later dates: the background theme follows the time of day
    // (see DayPhase) without the app having to run, and a running timer
    // turns into "Time's up" at its end.
    var changes = DayPhase.boundaryHours
      .compactMap { calendar.date(bySettingHour: $0, minute: 0, second: 0, of: now) }
    if let session = current.session, session.isRunning(at: now), let end = session.endDate {
      changes.append(end)
    }
    let later = changes
      .filter { $0 > now && $0 < midnight }
      .sorted()
      .map { TodayEntry(date: $0, snapshot: current.snapshot, session: current.session) }
    let entries = [current] + later + [TodayEntry(date: midnight, snapshot: nil)]
    completion(Timeline(entries: entries, policy: .after(midnight)))
  }

  private func currentEntry(_ now: Date = Date()) -> TodayEntry {
    let loaded = Shared.loadSnapshot()
    let snapshot = loaded?.date == Shared.todayKey(now) ? loaded : nil
    return TodayEntry(date: now, snapshot: snapshot, session: Shared.loadFocusSession(now: now))
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
    plus: true,
    day: 12
  )

  var total: Int { tasks.count }
  var allDone: Bool { !tasks.isEmpty && completed == total }
  var progressSpoken: String { "\(completed) of \(total) done" }
  /// "All three" for the usual three, "All done" otherwise.
  var allDoneLabel: String { total == 3 ? "All three" : "All done" }
  var allDoneTitle: String { "\(allDoneLabel)." }
  var dayText: String? { day.map { "Day \(max(1, $0))" } }
}

// MARK: - Theme

/// Time-of-day theme for the full-colour background.
enum DayPhase {
  case morning, daytime, evening

  /// Hours at which the phase changes (a timeline entry is added at each).
  static let boundaryHours = [5, 12, 17]

  init(date: Date, calendar: Calendar = .current) {
    let hour = calendar.component(.hour, from: date)
    switch hour {
    case 5..<12: self = .morning
    case 12..<17: self = .daytime
    // From 17:00, and through the small hours until 05:00, it's evening:
    // a sunrise gradient at 1am would look wrong.
    default: self = .evening
    }
  }

  /// Top-leading to bottom-trailing. Against every stop, white (primary text)
  /// is at least 5.6:1, white 85% (secondary) at least 4.5:1 and white 70%
  /// (faded: done tasks) at least 3.6:1. Dark mode darkens further. The
  /// morning is a warm coral into a dusty rose (1.3: no brick red).
  var colors: [Color] {
    switch self {
    case .morning: return [Color(hex: 0xA04F32), Color(hex: 0x9E4A5C)]
    case .daytime: return [Color(hex: 0x5249D6), Color(hex: 0x4338C9)]
    case .evening: return [Color(hex: 0x2E2878), Color(hex: 0x17143A)]
    }
  }
}

extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}

/// Foreground styles that read on the gradient (full colour) and still work
/// when the system tints or clears the widget (everything else).
struct Palette {
  let fullColor: Bool

  var primary: Color { fullColor ? .white : .primary }
  var secondary: Color { fullColor ? .white.opacity(0.85) : .secondary }
  var faded: Color { fullColor ? .white.opacity(0.7) : .secondary }
  var track: Color { fullColor ? .white.opacity(0.25) : .primary.opacity(0.2) }
  var fill: Color { fullColor ? .white : .primary }
}

private struct PaletteKey: EnvironmentKey {
  static let defaultValue = Palette(fullColor: true)
}

extension EnvironmentValues {
  var palette: Palette {
    get { self[PaletteKey.self] }
    set { self[PaletteKey.self] = newValue }
  }
}

// MARK: - Pieces

private let appURL = URL(string: "dailytasks://")

/// One arc per task with a gap between; done arcs are filled.
struct SegmentedRing: View {
  let total: Int
  let completed: Int
  var lineWidth: CGFloat = 8
  @Environment(\.palette) private var palette

  var body: some View {
    let count = max(total, 1)
    let segment = 1.0 / Double(count)
    // Round caps poke past the trim ends, so the gap must cover them too.
    let gap = count > 1 ? 0.07 : 0
    ZStack {
      ForEach(0..<count, id: \.self) { index in
        let from = Double(index) * segment + gap / 2
        let to = Double(index + 1) * segment - gap / 2
        let done = total > 0 && index < completed
        Circle()
          .trim(from: from, to: to)
          .stroke(done ? palette.fill : palette.track, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
          .rotationEffect(.degrees(-90))
          .modifier(AccentIf(done))
      }
    }
    .padding(lineWidth / 2)
  }
}

/// `widgetAccentable()` only where it should take the accent colour.
private struct AccentIf: ViewModifier {
  let on: Bool
  init(_ on: Bool) { self.on = on }

  func body(content: Content) -> some View {
    if on { content.widgetAccentable() } else { content }
  }
}

/// The ring with the done count and "of 3" in the middle. Empty (no tasks
/// yet): an empty track around a sun, hidden from VoiceOver since the text
/// next to it says it all. All done with `sunWhenDone`: the sun + check.
struct RingCount: View {
  let snapshot: Snapshot?
  var size: CGFloat
  var lineWidth: CGFloat
  var numeralSize: CGFloat
  var sunWhenDone = false
  @Environment(\.palette) private var palette

  var body: some View {
    let total = snapshot?.total ?? 3
    let completed = snapshot?.completed ?? 0
    ZStack {
      SegmentedRing(total: total, completed: completed, lineWidth: lineWidth)
      if snapshot == nil {
        Image(systemName: "sun.max.fill")
          .font(.system(size: numeralSize * 0.8))
          .foregroundStyle(palette.primary)
          .widgetAccentable()
      } else if sunWhenDone, snapshot?.allDone == true {
        SunCheck(size: numeralSize * 0.9)
      } else {
        VStack(spacing: -2) {
          Text("\(completed)")
            .font(.system(size: numeralSize, weight: .bold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(palette.primary)
            .widgetAccentable()
          // "of 3" (fewer tasks: "of 2").
          Text("of \(total)")
            .font(.system(size: max(11, numeralSize * 0.3), weight: .semibold, design: .rounded))
            .foregroundStyle(palette.primary.opacity(0.9))
        }
      }
    }
    .frame(width: size, height: size)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(snapshot?.progressSpoken ?? "")
    .accessibilityHidden(snapshot == nil)
  }
}

/// Sun with a check: the "all done" mark.
struct SunCheck: View {
  var size: CGFloat = 26
  @Environment(\.palette) private var palette

  var body: some View {
    ZStack(alignment: .bottomTrailing) {
      Image(systemName: "sun.max.fill")
        .font(.system(size: size))
        .foregroundStyle(palette.primary)
        .widgetAccentable()
      // A darkened disc under the check, so it doesn't vanish into the
      // white sun (a knocked-out check.circle shows the sun through it).
      ZStack {
        Circle().fill(Color.black.opacity(0.35))
        Circle().strokeBorder(palette.fill, lineWidth: max(1, size * 0.05))
        Image(systemName: "checkmark")
          .font(.system(size: size * 0.24, weight: .heavy))
          .foregroundStyle(palette.fill)
      }
      .frame(width: size * 0.5, height: size * 0.5)
      .offset(x: size * 0.15, y: size * 0.1)
    }
    .accessibilityHidden(true)
  }
}

/// A small moon in the evening (full colour only, it's decoration).
struct PhaseGlyph: View {
  let phase: DayPhase
  @Environment(\.palette) private var palette

  var body: some View {
    if phase == .evening && palette.fullColor {
      Image(systemName: "moon.stars.fill")
        .font(.caption)
        .foregroundStyle(palette.secondary)
        .accessibilityHidden(true)
    }
  }
}

/// One task. For Plus the whole row is the button (a near-miss mustn't open
/// the app instead); for free users it's plain text with a non-control marker.
struct TaskRow: View {
  let task: WidgetTask
  let date: String
  let interactive: Bool
  /// The next open task: bold and slightly larger.
  var isNext = false
  /// Its timer is on (1.3): a small timer glyph after the words.
  var timed = false
  var lineLimit = 1
  @Environment(\.palette) private var palette

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
      content(marker: task.done ? "checkmark.circle.fill" : "circle")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(task.text)
        .accessibilityValue(task.done ? "Done" : "Not done")
    }
  }

  private func content(marker: String) -> some View {
    HStack(spacing: 7) {
      Image(systemName: marker)
        .font(.system(size: interactive ? 17 : 13, weight: .semibold))
        .frame(width: interactive ? 22 : 16)
        .foregroundStyle(task.done ? palette.fill : (interactive ? palette.primary : palette.faded))
        .opacity(task.done ? 0.75 : 1)
        .modifier(AccentIf(task.done))
      Text(task.text)
        .font(isNext ? .system(size: 15, weight: .bold) : .system(size: 13, weight: .medium))
        .strikethrough(task.done, color: palette.faded)
        .foregroundStyle(task.done ? palette.faded : (isNext ? palette.primary : palette.secondary))
        .lineLimit(lineLimit)
        .minimumScaleFactor(0.85)
        .privacySensitive()
      if timed {
        Image(systemName: "timer")
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(palette.secondary)
          .accessibilityHidden(true)
      }
      Spacer(minLength: 0)
    }
    // A comfortable tap target only where the row is a button; read-only rows
    // keep their natural height so the medium widget fits on small phones.
    .frame(minHeight: interactive ? 26 : nil)
    .contentShape(Rectangle())
  }
}

// MARK: - Focus session (1.3)

/// Starts a timer on the next open task in the app (the last length used, or
/// 20 minutes). A small widget can't hold a Link, so it's a button whose
/// intent opens the app; the medium one uses StartLink.
struct StartButton: View {
  @Environment(\.palette) private var palette

  var body: some View {
    Button(intent: StartFromWidgetIntent()) {
      // "▶ Start": a 36pt capsule, clear of the ring and the task below.
      Label("Start", systemImage: "play.fill")
        .font(.system(size: 13, weight: .bold, design: .rounded))
        .labelStyle(CompactLabel())
        // One line, never "Star/t": it takes its own width, shrinking a
        // little at the largest text sizes rather than wrapping.
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .fixedSize(horizontal: true, vertical: false)
        .foregroundStyle(palette.primary)
        .padding(.horizontal, 12)
        .frame(minHeight: 36)
        .background(Capsule().fill(palette.track))
        .contentShape(Capsule())
        .widgetAccentable()
    }
    .buttonStyle(.plain)
    .accessibilityLabel("Start a timer")
    .accessibilityHint("Opens Three Today and starts a timer on your next task")
  }
}

struct StartLink: View {
  var body: some View {
    if let url = FocusGroup.startURL(kind: "timer", source: "widget") {
      Link(destination: url) {
        StartGlyph()
      }
      .accessibilityLabel("Start a timer")
      .accessibilityHint("Opens Three Today and starts a timer on this task")
    }
  }
}

/// ▶ in a soft circle.
struct StartGlyph: View {
  @Environment(\.palette) private var palette

  var body: some View {
    ZStack {
      Circle().fill(palette.track)
      Image(systemName: "play.fill")
        .font(.system(size: 12, weight: .bold))
        .foregroundStyle(palette.primary)
        .offset(x: 1)
    }
    .frame(width: 30, height: 30)
    .contentShape(Circle())
    .widgetAccentable()
  }
}

extension FocusSessionMirror {
  /// When the current countdown began (a pause or "5 more minutes" moves the
  /// end; `startedAt` is when the session began).
  func countdown(at now: Date) -> ClosedRange<Date>? {
    guard isRunning(at: now), let end = endDate, durationMs > 0 else { return nil }
    return end.addingTimeInterval(-durationMs / 1000)...end
  }

  var focusText: String { stepText ?? taskText }
}

/// The session's time: a live countdown while it runs, the time left while
/// paused, nothing at time's up (the caption says it).
struct SessionTime: View {
  let session: FocusSessionMirror
  let date: Date
  var fontSize: CGFloat
  @Environment(\.palette) private var palette

  var body: some View {
    Group {
      if let countdown = session.countdown(at: date) {
        Text(timerInterval: countdown, countsDown: true)
      } else if session.status == "paused" {
        Text(formatRemaining(ms: session.pausedRemainingMs ?? 0))
      }
      // Time's up: the line below says so (with its bell).
    }
    .font(.system(size: fontSize, weight: .bold, design: .rounded))
    .monospacedDigit()
    .multilineTextAlignment(.trailing)
    .lineLimit(1)
    .minimumScaleFactor(0.7)
    .frame(maxWidth: 84, alignment: .trailing)
    .foregroundStyle(palette.primary)
    .widgetAccentable()
    .accessibilityHidden(true)
  }
}

/// "Focusing" / "Paused" / "Time's up" with the session's words (small widget).
struct SessionBlock: View {
  let session: FocusSessionMirror
  let date: Date
  @Environment(\.palette) private var palette

  var body: some View {
    VStack(alignment: .leading, spacing: 1) {
      Label(sessionCaption(session, date), systemImage: sessionSymbol(session, date))
        .font(.caption2.weight(.semibold))
        .foregroundStyle(palette.secondary)
        .labelStyle(CompactLabel())
      Text(session.focusText)
        .font(.system(size: 15, weight: .bold))
        .foregroundStyle(palette.primary)
        .lineLimit(2)
        .minimumScaleFactor(0.85)
        .privacySensitive()
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(sessionSpoken(session, date))
  }
}

/// The medium widget's header while a session is on.
struct SessionHeader: View {
  let session: FocusSessionMirror
  let date: Date
  @Environment(\.palette) private var palette

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: sessionSymbol(session, date))
      if let countdown = session.countdown(at: date) {
        Text(timerInterval: countdown, countsDown: true)
          .monospacedDigit()
          .frame(maxWidth: 64, alignment: .leading)
      } else if session.status == "paused" {
        Text("Paused · \(formatRemaining(ms: session.pausedRemainingMs ?? 0)) left")
          .monospacedDigit()
      } else {
        Text("Time's up")
      }
    }
    .font(.caption.weight(.semibold))
    .foregroundStyle(palette.primary)
    .lineLimit(1)
    .widgetAccentable()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(sessionSpoken(session, date))
  }
}

private struct CompactLabel: LabelStyle {
  func makeBody(configuration: Configuration) -> some View {
    HStack(spacing: 4) {
      configuration.icon
      configuration.title
    }
  }
}

private func sessionCaption(_ session: FocusSessionMirror, _ date: Date) -> String {
  if session.isRunning(at: date) { return "Focusing" }
  return session.status == "paused" ? "Paused" : "Time's up"
}

private func sessionSymbol(_ session: FocusSessionMirror, _ date: Date) -> String {
  if session.isRunning(at: date) { return "timer" }
  return session.status == "paused" ? "pause.fill" : "bell.fill"
}

private func sessionSpoken(_ session: FocusSessionMirror, _ date: Date) -> String {
  if session.isRunning(at: date) { return "Focusing on \(session.focusText)" }
  if session.status == "paused" {
    return "Timer paused on \(session.focusText), \(formatRemaining(ms: session.pausedRemainingMs ?? 0)) left"
  }
  return "Time's up on \(session.focusText)"
}

// MARK: - Families

struct SmallView: View {
  let snapshot: Snapshot?
  let phase: DayPhase
  var session: FocusSessionMirror? = nil
  var date = Date()
  @Environment(\.palette) private var palette

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack(alignment: .top) {
        RingCount(snapshot: snapshot, size: 54, lineWidth: 6, numeralSize: 24, sunWhenDone: true)
        Spacer(minLength: 4)
        VStack(alignment: .trailing, spacing: 6) {
          PhaseGlyph(phase: phase)
          if let session {
            SessionTime(session: session, date: date, fontSize: 20)
          } else if snapshot?.nextOpen != nil {
            StartButton()
          }
        }
      }
      Spacer(minLength: 4)
      if snapshot != nil, let session {
        SessionBlock(session: session, date: date)
      } else if let snapshot {
        if let next = snapshot.nextOpen {
          Text("Next")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(palette.secondary)
          TaskRow(task: next, date: snapshot.date, interactive: snapshot.plus, isNext: true, lineLimit: 2)
        } else {
          AllDoneBlock(snapshot: snapshot)
        }
      } else {
        EmptyBlock(titleSize: 15)
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct MediumView: View {
  let snapshot: Snapshot?
  let phase: DayPhase
  var session: FocusSessionMirror? = nil
  var date = Date()
  @Environment(\.palette) private var palette

  var body: some View {
    HStack(spacing: 16) {
      RingCount(snapshot: snapshot, size: 96, lineWidth: 9, numeralSize: 40)
      VStack(alignment: .leading, spacing: 4) {
        HStack(spacing: 6) {
          if let session {
            SessionHeader(session: session, date: date)
          } else if let snapshot, snapshot.allDone {
            allDoneHeader(snapshot)
          } else {
            Text(header)
              .font(.caption.weight(.semibold))
              .foregroundStyle(palette.secondary)
              .textCase(.uppercase)
              .lineLimit(1)
          }
          Spacer(minLength: 0)
          PhaseGlyph(phase: phase)
        }
        if let snapshot {
          // All done keeps the (done) rows so a mistaken tick can be undone
          // right here (Plus); the header says it's all done.
          // The timer's task leads while one is on; otherwise the next open
          // one, with Start beside it.
          let nextId = session?.taskId ?? snapshot.nextOpen?.id
          ForEach(snapshot.tasks) { task in
            HStack(spacing: 10) {
              TaskRow(
                task: task, date: snapshot.date, interactive: snapshot.plus, isNext: task.id == nextId,
                timed: session?.taskId == task.id)
              if session == nil && task.id == nextId {
                StartLink()
              }
            }
          }
          Spacer(minLength: 0)
          // No upsell on a finished day: that moment is for the win.
          if !snapshot.plus && !snapshot.allDone {
            Text("With Plus, tick off right here.")
              .font(.caption2)
              .foregroundStyle(palette.secondary)
              .lineLimit(1)
              .minimumScaleFactor(0.8)
          }
        } else {
          Spacer(minLength: 0)
          EmptyBlock()
          Spacer(minLength: 0)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
  }

  private var header: String {
    if let day = snapshot?.dayText { return "Today · \(day)" }
    return "Today"
  }

  /// Sun + check, "All three." and "Day N" in one compact line.
  private func allDoneHeader(_ snapshot: Snapshot) -> some View {
    HStack(spacing: 8) {
      SunCheck(size: 16)
      Text(snapshot.allDoneTitle)
        .font(.system(size: 15, weight: .bold, design: .rounded))
        .foregroundStyle(palette.primary)
      if let day = snapshot.dayText {
        Text(day)
          .font(.caption.weight(.semibold))
          .foregroundStyle(palette.secondary)
      }
    }
    .lineLimit(1)
    .minimumScaleFactor(0.85)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel([snapshot.allDoneTitle, snapshot.dayText].compactMap { $0 }.joined(separator: " "))
  }
}

/// Small widget, all done: the title and "Day N" (the sun + check is in the ring).
struct AllDoneBlock: View {
  let snapshot: Snapshot
  @Environment(\.palette) private var palette

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(snapshot.allDoneTitle)
        .font(.system(.headline, design: .rounded).weight(.bold))
        .foregroundStyle(palette.primary)
        .lineLimit(1)
      if let day = snapshot.dayText {
        Text(day)
          .font(.caption.weight(.medium))
          .foregroundStyle(palette.secondary)
          .lineLimit(1)
      }
    }
    .minimumScaleFactor(0.8)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel([snapshot.allDoneTitle, snapshot.dayText].compactMap { $0 }.joined(separator: " "))
  }
}

struct EmptyBlock: View {
  var titleSize: CGFloat = 17
  @Environment(\.palette) private var palette

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text("Pick today's three")
        .font(.system(size: titleSize, weight: .bold, design: .rounded))
        .foregroundStyle(palette.primary)
        .lineLimit(2)
      Text("Tap to choose")
        .font(.caption.weight(.medium))
        .foregroundStyle(palette.secondary)
    }
    .accessibilityElement(children: .combine)
  }
}

/// ●●○: one dot per task, filled when done.
struct DotsRow: View {
  let snapshot: Snapshot

  var body: some View {
    HStack(spacing: 3) {
      ForEach(snapshot.tasks) { task in
        Circle()
          .strokeBorder(.primary, lineWidth: 1.2)
          .background(Circle().fill(task.done ? Color.primary : .clear))
          .frame(width: 7, height: 7)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(snapshot.progressSpoken)
  }
}

struct DailyTasksWidgetView: View {
  @Environment(\.widgetFamily) var family
  @Environment(\.widgetRenderingMode) var renderingMode
  @Environment(\.colorScheme) var colorScheme
  let entry: TodayEntry

  var body: some View {
    let fullColor = renderingMode == .fullColor
    let phase = DayPhase(date: entry.date)
    Group {
      switch family {
      case .accessoryCircular:
        circular
      case .accessoryRectangular:
        rectangular
      case .accessoryInline:
        inline
      case .systemMedium:
        MediumView(snapshot: snapshot, phase: phase, session: session, date: entry.date)
      default:
        SmallView(snapshot: snapshot, phase: phase, session: session, date: entry.date)
      }
    }
    .environment(\.palette, Palette(fullColor: fullColor))
    .widgetURL(appURL)
    .containerBackground(for: .widget) {
      background(fullColor: fullColor, phase: phase)
    }
  }

  @ViewBuilder
  private func background(fullColor: Bool, phase: DayPhase) -> some View {
    if isAccessory {
      Color.clear
    } else if fullColor {
      ZStack {
        LinearGradient(colors: phase.colors, startPoint: .topLeading, endPoint: .bottomTrailing)
        // A touch darker in dark mode so the widget doesn't glare at night.
        if colorScheme == .dark { Color.black.opacity(0.18) }
      }
    } else {
      // Tinted / clear: the system restyles the background; no gradient.
      Color("$widgetBackground")
    }
  }

  private var isAccessory: Bool {
    switch family {
    case .accessoryCircular, .accessoryRectangular, .accessoryInline: return true
    default: return false
    }
  }

  /// Today's focus session while its task is on the list and still open (a
  /// Done from the Live Activity or the widget hides it at once).
  private var session: FocusSessionMirror? {
    guard let session = entry.session, let snapshot,
      snapshot.tasks.contains(where: { $0.id == session.taskId && !$0.done })
    else { return nil }
    return session
  }

  /// Today's snapshot with at least one task, else nil (the empty state).
  private var snapshot: Snapshot? {
    guard let snapshot = entry.snapshot, !snapshot.tasks.isEmpty else { return nil }
    return snapshot
  }

  private var circular: some View {
    Group {
      if let snapshot {
        Gauge(value: Double(snapshot.completed), in: 0...Double(snapshot.total)) {
          Image(systemName: "sun.max.fill")
        } currentValueLabel: {
          if snapshot.allDone {
            Image(systemName: "checkmark")
              .font(.system(.title3, design: .rounded).weight(.bold))
          } else {
            Text("\(snapshot.completed)")
              .font(.system(.title2, design: .rounded).weight(.bold))
          }
        } minimumValueLabel: {
          Text("0")
        } maximumValueLabel: {
          Text("\(snapshot.total)")
        }
        .gaugeStyle(.accessoryCircular)
        .widgetAccentable()
        .accessibilityLabel("Today, \(snapshot.progressSpoken)")
      } else {
        ZStack {
          AccessoryWidgetBackground()
          Image(systemName: "sun.max.fill")
            .font(.title2)
            .widgetAccentable()
        }
        .accessibilityLabel("Pick today's three")
      }
    }
  }

  private var rectangular: some View {
    VStack(alignment: .leading, spacing: 2) {
      if let snapshot {
        HStack(spacing: 6) {
          DotsRow(snapshot: snapshot)
            .widgetAccentable()
          if let day = snapshot.dayText {
            Text(day)
              .font(.caption.weight(.semibold))
              .foregroundStyle(.secondary)
          }
        }
        if let next = snapshot.nextOpen {
          Text(next.text)
            .font(.headline)
            .lineLimit(2)
            .privacySensitive()
        } else {
          Label(snapshot.allDoneTitle, systemImage: "sun.max.fill")
            .font(.headline)
            .widgetAccentable()
          Text("You showed up.")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      } else {
        Label("Today", systemImage: "sun.max.fill")
          .font(.caption.weight(.semibold))
          .widgetAccentable()
        Text("Pick today's three")
          .font(.headline)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  /// "☀ 2 of 3 · Day 12" with the SF Symbol sun.
  private var inline: some View {
    Text("\(Image(systemName: "sun.max.fill")) \(inlineText)")
  }

  private var inlineText: String {
    guard let snapshot else { return "Pick today's three" }
    let progress = snapshot.allDone ? snapshot.allDoneLabel : "\(snapshot.completed) of \(snapshot.total)"
    if let day = snapshot.dayText { return "\(progress) · \(day)" }
    return "\(progress) today"
  }
}

// MARK: - Widget

struct DailyTasksWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: Shared.kind, provider: TodayProvider()) { entry in
      DailyTasksWidgetView(entry: entry)
    }
    .configurationDisplayName("Today's three")
    .description("Today's three at a glance. Start a timer on the next one; with Plus, tick them off here.")
    .supportedFamilies([
      .systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline,
    ])
  }
}

@main
struct DailyTasksWidgetBundle: WidgetBundle {
  var body: some Widget {
    DailyTasksWidget()
    FocusLiveActivity()
  }
}

// MARK: - Previews

private func previewEntry(hour: Int, snapshot: Snapshot?) -> TodayEntry {
  let date = Calendar.current.date(bySettingHour: hour, minute: 0, second: 0, of: Date()) ?? Date()
  return TodayEntry(date: date, snapshot: snapshot)
}

extension Snapshot {
  static let allDoneSample = Snapshot(
    date: Shared.todayKey(),
    tasks: Snapshot.sample.tasks.map { WidgetTask(id: $0.id, text: $0.text, done: true) },
    streak: 5,
    plus: true,
    day: 13
  )
  static let freeSample = Snapshot(
    date: Shared.todayKey(),
    tasks: Snapshot.sample.tasks,
    streak: 4,
    plus: false,
    day: nil
  )
  static let twoTasksSample = Snapshot(
    date: Shared.todayKey(),
    tasks: Array(Snapshot.sample.tasks.prefix(2)),
    streak: 1,
    plus: true,
    day: 2
  )
}

#Preview("Medium", as: .systemMedium) {
  DailyTasksWidget()
} timeline: {
  previewEntry(hour: 8, snapshot: .sample)
  previewEntry(hour: 14, snapshot: .freeSample)
  previewEntry(hour: 20, snapshot: .allDoneSample)
  previewEntry(hour: 14, snapshot: .twoTasksSample)
  previewEntry(hour: 9, snapshot: nil)
}

#Preview("Small", as: .systemSmall) {
  DailyTasksWidget()
} timeline: {
  previewEntry(hour: 8, snapshot: .sample)
  previewEntry(hour: 14, snapshot: .freeSample)
  previewEntry(hour: 20, snapshot: .allDoneSample)
  previewEntry(hour: 9, snapshot: nil)
}

#Preview("Circular", as: .accessoryCircular) {
  DailyTasksWidget()
} timeline: {
  previewEntry(hour: 8, snapshot: .sample)
  previewEntry(hour: 20, snapshot: .allDoneSample)
  previewEntry(hour: 9, snapshot: nil)
}

#Preview("Rectangular", as: .accessoryRectangular) {
  DailyTasksWidget()
} timeline: {
  previewEntry(hour: 8, snapshot: .sample)
  previewEntry(hour: 20, snapshot: .allDoneSample)
  previewEntry(hour: 9, snapshot: nil)
}

#Preview("Inline", as: .accessoryInline) {
  DailyTasksWidget()
} timeline: {
  previewEntry(hour: 8, snapshot: .sample)
  previewEntry(hour: 20, snapshot: .allDoneSample)
  previewEntry(hour: 9, snapshot: nil)
}
