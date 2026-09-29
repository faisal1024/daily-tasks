import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The focus session's Live Activity and Dynamic Island (1.3). The app starts,
// updates and ends it (modules/focus-activity); the countdown and its ring
// tick on their own (`timerInterval`), with no updates. The buttons act
// without opening the app (FocusIntents.swift); a tap anywhere else opens the
// session's focus screen. Calm: the widget's colours, no red, and "Time's up"
// is never shown as done.
//
// Lock screen: ring | caption + task (2 lines) | big time, buttons below,
// kept within 160pt with a 2-line task at larger text sizes.

/// The lock screen's background in light mode (the widget's daytime indigo).
private let lockScreenIndigo = Color(hex: 0x4A40D0)
/// On the dark Dynamic Island: a lighter indigo that reads on black.
private let islandAccent = Color(hex: 0x9B94FF)
/// Text on an islandAccent button.
private let islandInk = Color(hex: 0x17143A)

extension FocusActivityAttributes.ContentState {
  var focusText: String { stepText ?? taskText }
  var minutes: Int { max(1, Int((durationMs / 60_000).rounded())) }
  /// A countdown this long began at endAt - duration (a pause or "5 more
  /// minutes" moves the end, so it isn't when the session began).
  var countdown: ClosedRange<Date>? {
    guard status == "running", let endAt, durationMs > 0 else { return nil }
    return endAt.addingTimeInterval(-durationMs / 1000)...endAt
  }

  /// What to show at `now`: a running countdown past its end is time's up.
  func phase(at now: Date, isStale: Bool) -> FocusPhase {
    switch status {
    case "done": return .done
    // Stopped by hand: Stop timer in the app, or Take a break ("break").
    case "stopped", "break": return .stopped
    case "paused": return .paused
    case "running":
      if isStale { return .timesUp }
      if let endAt, endAt > now { return .running }
      return .timesUp
    default: return .timesUp
    }
  }

  /// Share of the countdown still left while paused (0...1).
  var pausedFraction: Double {
    guard durationMs > 0 else { return 0 }
    return min(1, max(0, (pausedRemainingMs ?? 0) / durationMs))
  }

  /// "4:12", "1:05:00": the paused time left, rounded up like the app.
  var pausedLeft: String { formatRemaining(ms: pausedRemainingMs ?? 0) }

  /// The line above the task.
  func caption(_ phase: FocusPhase) -> String {
    switch phase {
    // One short line (the app's longer "Just start. You can stop after 5
    // minutes." was cut off here).
    case .running: return kind == "starter" && minutes == 5 ? "Just 5 minutes" : "Focusing"
    case .paused: return "Paused"
    // The app's check-in: a starter asks to keep going.
    case .timesUp: return kind == "starter" ? "\(capitalized(durationWords(minutes))) in" : "Time's up"
    case .done: return "Done"
    case .stopped: return status == "break" ? "Timer ended" : "Timer stopped"
    }
  }

  /// The Dynamic Island's shorter caption (one narrow line).
  func islandCaption(_ phase: FocusPhase) -> String {
    phase == .running && kind == "starter" && minutes == 5 ? "Just start" : caption(phase)
  }

  /// The time's-up button, as the app's check-in has it.
  var extendTitle: String { kind == "starter" ? "Keep going" : "5 more minutes" }
  /// The check-in's quiet way out (focus-session.ts checkInBreakLabel).
  var breakTitle: String { kind == "starter" ? "Stop for now" : "Take a break" }

  /// A countdown of an hour or more needs the smaller compact font.
  var isLong: Bool { durationMs >= 3_600_000 }
}

enum FocusPhase { case running, paused, timesUp, done, stopped }

func formatRemaining(ms: Double) -> String {
  let total = max(0, Int((ms / 1000).rounded(.up)))
  let hours = total / 3600
  let minutes = (total % 3600) / 60
  let seconds = total % 60
  if hours > 0 { return String(format: "%d:%02d:%02d", hours, minutes, seconds) }
  return String(format: "%d:%02d", minutes, seconds)
}

/// "1 minute", "20 minutes", "1 hour 15 minutes" (the app's durationWords).
func durationWords(_ minutes: Int) -> String {
  let hours = minutes / 60
  let mins = minutes % 60
  let h = hours == 1 ? "1 hour" : "\(hours) hours"
  let m = mins == 1 ? "1 minute" : "\(mins) minutes"
  if hours == 0 { return m }
  return mins == 0 ? h : "\(h) \(m)"
}

private func capitalized(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }

// MARK: - Pieces

/// The countdown ring: it drains on its own while running; frozen while
/// paused (no glyph: the caption says Paused and Resume is right there; the
/// frozen arc is at half opacity, so paused never looks like running);
/// full with a bell at time's up; a check once done.
struct FocusRing: View {
  let state: FocusActivityAttributes.ContentState
  let phase: FocusPhase
  var size: CGFloat
  var lineWidth: CGFloat
  var color: Color = .white
  /// The bell at time's up. The compact island leaves it to the trailing side
  /// (one bell, on the right).
  var showsBell = true

  var body: some View {
    ZStack {
      // The system's timer ring draws its own track.
      if phase != .running {
        Circle().stroke(color.opacity(0.25), lineWidth: lineWidth)
      }
      switch phase {
      case .running:
        if let countdown = state.countdown {
          ProgressView(timerInterval: countdown, countsDown: true, label: { EmptyView() }, currentValueLabel: { EmptyView() })
            .progressViewStyle(.circular)
            .tint(color)
            .frame(width: size, height: size)
        }
      case .paused:
        arc(state.pausedFraction).opacity(0.5)
      case .timesUp:
        arc(1)
        if showsBell {
          Image(systemName: "bell.fill").font(.system(size: size * 0.34, weight: .semibold)).foregroundStyle(color)
        }
      case .done:
        arc(1)
        Image(systemName: "checkmark").font(.system(size: size * 0.38, weight: .heavy)).foregroundStyle(color)
      case .stopped:
        Image(systemName: "stop.fill").font(.system(size: size * 0.3, weight: .bold)).foregroundStyle(color.opacity(0.8))
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  private func arc(_ fraction: Double) -> some View {
    Circle()
      .trim(from: 0, to: fraction)
      .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
      .rotationEffect(.degrees(-90))
  }
}

/// The big time on the right: a live countdown, or the time left while
/// paused ("4:12" over "left"; the caption says Paused).
struct FocusTime: View {
  let state: FocusActivityAttributes.ContentState
  let phase: FocusPhase
  var size: CGFloat
  var color: Color = .white

  var body: some View {
    switch phase {
    case .running:
      if let countdown = state.countdown {
        Text(timerInterval: countdown, countsDown: true)
          .font(.system(size: size, weight: .bold, design: .rounded))
          .monospacedDigit()
          .multilineTextAlignment(.trailing)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
          .frame(maxWidth: size * 3.8, alignment: .trailing)
          .foregroundStyle(color)
      }
    case .paused:
      VStack(alignment: .trailing, spacing: -2) {
        Text(state.pausedLeft)
          .font(.system(size: size, weight: .bold, design: .rounded))
          .monospacedDigit()
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Text("left").font(.caption.weight(.semibold)).opacity(0.8)
      }
      .foregroundStyle(color.opacity(0.85))
    default:
      EmptyView()
    }
  }
}

/// The buttons, which act in place (LiveActivityIntent). While it runs, only
/// Pause / Resume: the lock screen never offers a one-tap tick mid-session
/// (a timer is often just the first sitting). At time's up, as the app's
/// check-in: 5 more minutes (Keep going for a starter, the solid lead), Take
/// a break (Stop for now), and Mark done, which ticks the task and is never
/// the loud one. Three in one row (no icons, a smaller font) so the lock
/// screen stays within 160pt.
struct FocusButtons: View {
  let attributes: FocusActivityAttributes
  let state: FocusActivityAttributes.ContentState
  let phase: FocusPhase
  /// The solid button's fill and text.
  var solidFill: Color
  var solidInk: Color

  var body: some View {
    HStack(spacing: 8) {
      switch phase {
      case .running:
        pill(FocusPauseIntent(sessionId: attributes.sessionId), "Pause", symbol: "pause.fill", solid: false)
      case .paused:
        pill(FocusResumeIntent(sessionId: attributes.sessionId), "Resume", symbol: "play.fill", solid: false)
      case .timesUp:
        pill(FocusExtendIntent(sessionId: attributes.sessionId), state.extendTitle, solid: true)
        pill(FocusBreakIntent(sessionId: attributes.sessionId), state.breakTitle, solid: false)
          .accessibilityHint("Ends the timer. The task stays open.")
        pill(
          FocusDoneIntent(sessionId: attributes.sessionId, taskId: attributes.taskId, date: attributes.date),
          "Mark done", solid: false
        )
        .accessibilityLabel("Mark task done")
        .accessibilityHint("Ticks off \(state.taskText)")
      default:
        EmptyView()
      }
    }
  }

  private func pill<I: AppIntent>(_ intent: I, _ title: String, symbol: String? = nil, solid: Bool) -> some View {
    Button(intent: intent) {
      Group {
        if let symbol {
          Label(title, systemImage: symbol)
        } else {
          Text(title)
        }
      }
      .font(.system(size: symbol == nil ? 14 : 15, weight: .semibold, design: .rounded))
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      .padding(.horizontal, 6)
      .frame(maxWidth: .infinity, minHeight: 34)
      .foregroundStyle(solid ? solidInk : .white)
      .background(Capsule().fill(solid ? solidFill : Color.white.opacity(0.2)))
    }
    .buttonStyle(.plain)
  }
}

// MARK: - Lock screen

struct FocusLockScreenView: View {
  let context: ActivityViewContext<FocusActivityAttributes>
  @Environment(\.colorScheme) private var colorScheme

  var body: some View {
    // The widget's daytime indigo at every hour (never the morning's warm red:
    // this sits on the lock screen all day); its evening colour in dark mode
    // and StandBy.
    let tint = colorScheme == .dark ? DayPhase.evening.colors[0] : lockScreenIndigo
    FocusLockScreenContent(
      attributes: context.attributes, state: context.state,
      phase: context.state.phase(at: Date(), isStale: context.isStale), tint: tint
    )
    .activityBackgroundTint(tint)
    .activitySystemActionForegroundColor(.white)
    .widgetURL(FocusGroup.openURL(sessionId: context.attributes.sessionId))
  }
}

/// The lock screen's layout, apart from ActivityKit (so its height can be
/// measured with a render: within 160pt, see docs/2026-09-v1.3-timer.md).
struct FocusLockScreenContent: View {
  let attributes: FocusActivityAttributes
  let state: FocusActivityAttributes.ContentState
  let phase: FocusPhase
  let tint: Color

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .center, spacing: 12) {
        FocusRing(state: state, phase: phase, size: 44, lineWidth: 5)
        VStack(alignment: .leading, spacing: 1) {
          Text(state.caption(phase))
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.85))
            .lineLimit(1)
          Text(state.focusText)
            .font(.system(size: 16, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(2)
        }
        Spacer(minLength: 6)
        FocusTime(state: state, phase: phase, size: 26)
      }
      FocusButtons(attributes: attributes, state: state, phase: phase, solidFill: .white, solidInk: tint)
    }
    .padding(14)
  }
}

// MARK: - Activity

struct FocusLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: FocusActivityAttributes.self) { context in
      FocusLockScreenView(context: context)
    } dynamicIsland: { context in
      let state = context.state
      let phase = state.phase(at: Date(), isStale: context.isStale)
      return DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          FocusRing(state: state, phase: phase, size: 44, lineWidth: 5, color: islandAccent)
            .padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          FocusTime(state: state, phase: phase, size: 24, color: islandAccent)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 1) {
            Text(state.islandCaption(phase))
              .font(.caption2.weight(.semibold))
              .foregroundStyle(.white.opacity(0.7))
              .lineLimit(1)
            Text(state.focusText)
              .font(.system(size: 15, weight: .semibold, design: .rounded))
              .lineLimit(1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.bottom) {
          FocusButtons(
            attributes: context.attributes, state: state, phase: phase, solidFill: islandAccent, solidInk: islandInk
          )
          .padding(.top, 4)
        }
      } compactLeading: {
        FocusRing(state: state, phase: phase, size: 22, lineWidth: 3, color: islandAccent, showsBell: false)
      } compactTrailing: {
        switch phase {
        case .running:
          if let countdown = state.countdown {
            Text(timerInterval: countdown, countsDown: true)
              .font(.system(size: state.isLong ? 12 : 14, weight: .semibold, design: .rounded))
              .monospacedDigit()
              .multilineTextAlignment(.trailing)
              .frame(maxWidth: 54)
              .foregroundStyle(islandAccent)
          }
        case .paused:
          Text(state.pausedLeft)
            .font(.system(size: state.isLong ? 12 : 14, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .frame(maxWidth: 54)
            .foregroundStyle(.white.opacity(0.7))
        case .timesUp:
          Image(systemName: "bell.fill").foregroundStyle(islandAccent)
        case .done:
          Image(systemName: "checkmark").foregroundStyle(islandAccent)
        case .stopped:
          EmptyView()
        }
      } minimal: {
        FocusRing(state: state, phase: phase, size: 22, lineWidth: 3, color: islandAccent)
      }
      .widgetURL(FocusGroup.openURL(sessionId: context.attributes.sessionId))
      .keylineTint(islandAccent)
    }
  }
}

// MARK: - Previews

extension FocusActivityAttributes {
  static let preview = FocusActivityAttributes(sessionId: "s1", taskId: "t1", date: FocusGroup.todayKey())
}

extension FocusActivityAttributes.ContentState {
  static let running = FocusActivityAttributes.ContentState(
    taskText: "Reply to Sam's email", stepText: nil, kind: "timer", status: "running",
    endAt: Date().addingTimeInterval(12 * 60), durationMs: 20 * 60_000, pausedRemainingMs: nil)
  static let paused = FocusActivityAttributes.ContentState(
    taskText: "Reply to Sam's email", stepText: nil, kind: "timer", status: "paused", endAt: nil,
    durationMs: 20 * 60_000, pausedRemainingMs: 252_000)
  static let timesUp = FocusActivityAttributes.ContentState(
    taskText: "Go for a walk", stepText: nil, kind: "starter", status: "ended", endAt: nil,
    durationMs: 5 * 60_000, pausedRemainingMs: nil)
}

#Preview("Lock screen", as: .content, using: FocusActivityAttributes.preview) {
  FocusLiveActivity()
} contentStates: {
  FocusActivityAttributes.ContentState.running
  FocusActivityAttributes.ContentState.paused
  FocusActivityAttributes.ContentState.timesUp
}
