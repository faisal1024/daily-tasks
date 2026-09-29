import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The focus session's Live Activity and Dynamic Island (1.3). The app starts,
// updates and ends it (modules/focus-activity); the countdown and its ring
// tick on their own (`timerInterval`), with no updates. Done and Pause/Resume
// act without opening the app (FocusIntents.swift). Calm: the widget's
// indigo, no red, and "Time's up" is never shown as done.

/// The widget's daytime indigo, for the lock screen's background.
private let activityTint = Color(hex: 0x4A40D0)
/// On the dark Dynamic Island: a lighter indigo that reads on black.
private let islandAccent = Color(hex: 0x9B94FF)

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
    case "stopped": return .stopped
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

  /// "Time's up on "Walk"." / "5 minutes in. Keep going?" (the app's check-in).
  var timesUpTitle: String {
    if kind == "starter" { return "\(capitalized(durationWords(minutes))) in. Keep going?" }
    return "Time's up on \u{201C}\(focusText)\u{201D}."
  }

  /// A starter's line while its first 5 minutes run.
  var runningLine: String {
    kind == "starter" && minutes == 5 ? "Just start. You can stop after 5." : "Focusing"
  }
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
/// paused; full with a bell at time's up; a check once done.
struct FocusRing: View {
  let state: FocusActivityAttributes.ContentState
  let phase: FocusPhase
  var size: CGFloat
  var lineWidth: CGFloat
  var color: Color = .white

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
        arc(state.pausedFraction)
        Image(systemName: "pause.fill").font(.system(size: size * 0.32, weight: .bold)).foregroundStyle(color)
      case .timesUp:
        arc(1)
        Image(systemName: "bell.fill").font(.system(size: size * 0.34, weight: .semibold)).foregroundStyle(color)
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

/// The big time: a live countdown, "Paused · 4:12 left", or nothing.
struct FocusTime: View {
  let state: FocusActivityAttributes.ContentState
  let phase: FocusPhase
  var font: Font

  var body: some View {
    switch phase {
    case .running:
      if let countdown = state.countdown {
        Text(timerInterval: countdown, countsDown: true)
          .font(font)
          .monospacedDigit()
      }
    case .paused:
      Text("Paused · \(state.pausedLeft) left")
        .font(font)
        .monospacedDigit()
    default:
      EmptyView()
    }
  }
}

/// Pause/Resume and Done. Buttons act in place (LiveActivityIntent).
struct FocusButtons: View {
  let attributes: FocusActivityAttributes
  let phase: FocusPhase

  var body: some View {
    HStack(spacing: 10) {
      switch phase {
      case .running:
        pill(FocusPauseIntent(sessionId: attributes.sessionId), "Pause", "pause.fill", solid: false)
      case .paused:
        pill(FocusResumeIntent(sessionId: attributes.sessionId), "Resume", "play.fill", solid: false)
      default:
        EmptyView()
      }
      if phase == .running || phase == .paused || phase == .timesUp {
        pill(
          FocusDoneIntent(sessionId: attributes.sessionId, taskId: attributes.taskId, date: attributes.date),
          "Done", "checkmark", solid: true)
      }
    }
  }

  private func pill<I: AppIntent>(_ intent: I, _ title: String, _ symbol: String, solid: Bool) -> some View {
    Button(intent: intent) {
      Label(title, systemImage: symbol)
        .font(.system(size: 15, weight: .semibold, design: .rounded))
        .frame(maxWidth: .infinity, minHeight: 36)
        .foregroundStyle(solid ? activityTint : .white)
        .background(Capsule().fill(solid ? Color.white : Color.white.opacity(0.2)))
    }
    .buttonStyle(.plain)
  }
}

// MARK: - Lock screen

struct FocusLockScreenView: View {
  let context: ActivityViewContext<FocusActivityAttributes>

  var body: some View {
    let state = context.state
    let phase = state.phase(at: Date(), isStale: context.isStale)
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .center, spacing: 14) {
        FocusRing(state: state, phase: phase, size: 52, lineWidth: 6)
        VStack(alignment: .leading, spacing: 2) {
          Text(caption(state, phase))
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.85))
            .lineLimit(1)
          Text(title(state, phase))
            .font(.system(size: 17, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
            .lineLimit(2)
            .privacySensitive()
          FocusTime(state: state, phase: phase, font: .system(size: 22, weight: .bold, design: .rounded))
            .foregroundStyle(.white)
        }
        Spacer(minLength: 0)
      }
      FocusButtons(attributes: context.attributes, phase: phase)
    }
    .padding(16)
    .activityBackgroundTint(activityTint)
    .activitySystemActionForegroundColor(.white)
  }

  private func caption(_ state: FocusActivityAttributes.ContentState, _ phase: FocusPhase) -> String {
    switch phase {
    case .running: return state.runningLine
    case .paused: return "Paused"
    case .timesUp: return "Time's up"
    case .done: return "Done"
    case .stopped: return "Timer stopped"
    }
  }

  private func title(_ state: FocusActivityAttributes.ContentState, _ phase: FocusPhase) -> String {
    phase == .timesUp ? state.timesUpTitle : state.focusText
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
          if phase == .running, let countdown = state.countdown {
            Text(timerInterval: countdown, countsDown: true)
              .font(.system(size: 24, weight: .bold, design: .rounded))
              .monospacedDigit()
              .multilineTextAlignment(.trailing)
              .frame(maxWidth: 96, alignment: .trailing)
              .foregroundStyle(islandAccent)
          } else if phase == .paused {
            Text(state.pausedLeft)
              .font(.system(size: 24, weight: .bold, design: .rounded))
              .monospacedDigit()
              .foregroundStyle(.white.opacity(0.7))
          }
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(alignment: .leading, spacing: 1) {
            Text(islandCaption(phase))
              .font(.caption2.weight(.semibold))
              .foregroundStyle(.white.opacity(0.7))
            Text(phase == .timesUp ? state.timesUpTitle : state.focusText)
              .font(.system(size: 15, weight: .semibold, design: .rounded))
              .lineLimit(1)
              .privacySensitive()
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
        DynamicIslandExpandedRegion(.bottom) {
          FocusButtons(attributes: context.attributes, phase: phase)
            .padding(.top, 4)
        }
      } compactLeading: {
        FocusRing(state: state, phase: phase, size: 22, lineWidth: 3, color: islandAccent)
      } compactTrailing: {
        switch phase {
        case .running:
          if let countdown = state.countdown {
            Text(timerInterval: countdown, countsDown: true)
              .font(.system(size: 14, weight: .semibold, design: .rounded))
              .monospacedDigit()
              .multilineTextAlignment(.trailing)
              .frame(maxWidth: 48)
              .foregroundStyle(islandAccent)
          }
        case .paused:
          Text(state.pausedLeft)
            .font(.system(size: 14, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .foregroundStyle(.white.opacity(0.7))
        case .timesUp:
          Text("Time's up").font(.caption.weight(.semibold)).foregroundStyle(islandAccent)
        case .done:
          Text("Done").font(.caption.weight(.semibold)).foregroundStyle(islandAccent)
        case .stopped:
          EmptyView()
        }
      } minimal: {
        FocusRing(state: state, phase: phase, size: 22, lineWidth: 3, color: islandAccent)
      }
      .widgetURL(URL(string: "dailytasks://"))
      .keylineTint(islandAccent)
    }
  }

  private func islandCaption(_ phase: FocusPhase) -> String {
    switch phase {
    case .running: return "Focusing"
    case .paused: return "Paused"
    case .timesUp: return "Time's up"
    case .done: return "Done"
    case .stopped: return "Timer stopped"
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
