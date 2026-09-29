// The focus session's Live Activity (1.3), shared by the app and the widget.
//
// ONE SOURCE, TWO COPIES. This file is compiled into the widget extension
// (targets/widget/FocusActivityShared.swift) and into the app through the
// FocusActivity module (modules/focus-activity/ios/FocusActivityShared.swift).
// The copies must stay byte-identical: ActivityKit pairs the app's activity
// with the extension's views by the attributes' type name and Codable shape.
// tests/native-shared.test.ts fails when they differ; edit one, copy it over.
//
// Everything here goes through the App Group (see docs/2026-09-v1.3-timer.md):
// - `focus.session`: the session, written by the app (and optimistically by a
//   Pause/Resume tap here, like the widget's ticks);
// - `focus.commands`: Pause/Resume taps queued for the app (only written here);
//   the app records the last one it applied in `focus.processedSeq`
//   ("pause" | "resume", and "extend" for the time's-up button);
// - `widget.toggles`: Done queues a tick there, exactly like the widget;
// - `focus.startRequest`: "start my next task" from Siri or the widget.

import ActivityKit
import Darwin
import Foundation
import UserNotifications
import WidgetKit

// MARK: - The mirrored session

/// `focus.session`: the app's FocusSession plus `v` and `rev`. Times are epoch ms.
public struct FocusSessionMirror: Codable, Equatable {
  public var v: Int?
  public var rev: Double?
  public var id: String
  public var taskId: String
  public var taskText: String
  public var stepText: String?
  public var date: String
  /// "timer" | "starter"
  public var kind: String
  public var durationMs: Double
  public var startedAt: Double
  /// nil while paused.
  public var endAt: Double?
  public var pausedRemainingMs: Double?
  /// "running" | "paused" | "ended"
  public var status: String

  public var endDate: Date? { endAt.map { Date(timeIntervalSince1970: $0 / 1000) } }

  /// A shape this code understands (`v` goes up only for an incompatible change).
  var isSupported: Bool { (v ?? 1) <= 1 }

  /// Counting down, with its end still ahead.
  public func isRunning(at now: Date) -> Bool {
    guard status == "running", let end = endDate else { return false }
    return end > now
  }

  /// Time's up: saved as ended, or running past its end (the app may not have said so yet).
  public func hasEnded(at now: Date) -> Bool {
    status == "ended" || (status == "running" && !isRunning(at: now))
  }
}

// MARK: - ActivityKit

@available(iOS 16.1, *)
public struct FocusActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var taskText: String
    public var stepText: String?
    /// "timer" | "starter"
    public var kind: String
    /// "running" | "paused" | "ended" (time's up), and for the final content
    /// only, "done" | "stopped".
    public var status: String
    /// When it ends; nil while paused. The countdown began at endAt - duration.
    public var endAt: Date?
    public var durationMs: Double
    public var pausedRemainingMs: Double?

    public init(
      taskText: String, stepText: String?, kind: String, status: String, endAt: Date?, durationMs: Double,
      pausedRemainingMs: Double?
    ) {
      self.taskText = taskText
      self.stepText = stepText
      self.kind = kind
      self.status = status
      self.endAt = endAt
      self.durationMs = durationMs
      self.pausedRemainingMs = pausedRemainingMs
    }
  }

  public var sessionId: String
  public var taskId: String
  /// yyyy-MM-dd: the day the session (and a Done from it) belongs to.
  public var date: String

  public init(sessionId: String, taskId: String, date: String) {
    self.sessionId = sessionId
    self.taskId = taskId
    self.date = date
  }
}

@available(iOS 16.1, *)
extension FocusSessionMirror {
  public var attributes: FocusActivityAttributes {
    FocusActivityAttributes(sessionId: id, taskId: taskId, date: date)
  }

  /// The activity's content (its words cut to keep it well under ActivityKit's 4 KB).
  public var contentState: FocusActivityAttributes.ContentState {
    FocusActivityAttributes.ContentState(
      taskText: Self.cut(taskText), stepText: stepText.map(Self.cut), kind: kind, status: status, endAt: endDate,
      durationMs: durationMs, pausedRemainingMs: pausedRemainingMs)
  }

  static func cut(_ text: String) -> String { text.count > 120 ? String(text.prefix(119)) + "\u{2026}" : text }

  /// A running countdown goes stale at its end: the views then say "Time's up".
  public var staleDate: Date? { status == "running" ? endDate : nil }
}

// MARK: - App Group

public struct FocusCommand: Codable, Equatable {
  public let seq: Int
  public let sessionId: String
  /// "pause" | "resume" | "extend"
  public let action: String
  /// Epoch ms of the tap.
  public let at: Double
}

/// One entry of the widget's `widget.toggles` queue (see Shared.swift).
public struct QueuedToggle: Codable {
  public let seq: Int
  public let id: String
  public let date: String
  public let done: Bool
  /// "live_activity" for a Done on the Live Activity; absent for a widget tap.
  public var source: String?
}

public enum FocusGroup {
  public static let group = "group.com.faisalislam.dailytasks"
  public static let widgetKind = "DailyTasksWidget"
  public static let sessionKey = "focus.session"
  public static let commandsKey = "focus.commands"
  public static let commandsProcessedKey = "focus.processedSeq"
  public static let startRequestKey = "focus.startRequest"
  public static let snapshotKey = "widget.snapshot"
  public static let togglesKey = "widget.toggles"
  public static let togglesProcessedKey = "widget.processedSeq"
  /// The app's end notification (lib/daily-tasks/notifications.ts).
  static let notificationId = "three-today:focus-timer"
  /// Its categories (the buttons): a timer's 5 more minutes / Done.
  static let timerCategoryId = "three-today:focus-session"
  /// A timer's body (lib/daily-tasks/focus-session.ts notificationBody).
  static let timerNotificationBody = "Time's up. Done, or 5 more minutes?"
  static let heldNotificationKey = "focus.heldNotification"
  static let heldNotificationSessionKey = "focus.heldNotificationSession"
  /// Queues are kept short even if the app isn't opened for a long time.
  static let maxQueue = 50

  public static var defaults: UserDefaults? { UserDefaults(suiteName: group) }

  /// Serialises read-modify-write of the App Group's JSON queues and
  /// snapshot between native writers: two quick taps can run two intents at
  /// once, in one process or in two (the widget extension, and the app, which
  /// runs a Live Activity's intents). An NSLock within the process, plus an
  /// flock on a file in the App Group container across processes. The app's
  /// JS doesn't take this lock: it writes only the "processed" marks of the
  /// queues, but it does rewrite `widget.snapshot` whole (as before 1.3), so a
  /// native optimistic tick can in rare cases be overwritten by the app's own
  /// fresh snapshot (which is then correct anyway once the tap is applied).
  static let lock = NSLock()
  static let lockFileName = "FocusQueue.lock"

  public static func withLock<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    let fd: Int32 =
      FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
      .map { open($0.appendingPathComponent(lockFileName).path, O_CREAT | O_RDWR, 0o644) } ?? -1
    if fd >= 0 { flock(fd, LOCK_EX) }
    defer {
      if fd >= 0 {
        flock(fd, LOCK_UN)
        close(fd)
      }
    }
    return body()
  }

  /// Local calendar day as yyyy-MM-dd, matching the app's todayKey().
  public static func todayKey(_ date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  static func nowMs(_ date: Date = Date()) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }

  public static func loadSession() -> FocusSessionMirror? {
    defaults?.string(forKey: sessionKey).flatMap(decodeSession)
  }

  /// nil for anything malformed, or from a newer app with an incompatible shape.
  public static func decodeSession(_ raw: String) -> FocusSessionMirror? {
    guard let data = raw.data(using: .utf8),
      let session = try? JSONDecoder().decode(FocusSessionMirror.self, from: data), session.isSupported
    else { return nil }
    return session
  }

  static func saveSession(_ session: FocusSessionMirror) {
    guard let data = try? JSONEncoder().encode(session), let raw = String(data: data, encoding: .utf8) else { return }
    defaults?.set(raw, forKey: sessionKey)
  }

  private static func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
    guard let raw = defaults?.string(forKey: key), let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }

  private static func store<T: Encodable>(_ value: T, key: String) {
    guard let data = try? JSONEncoder().encode(value), let raw = String(data: data, encoding: .utf8) else { return }
    defaults?.set(raw, forKey: key)
  }

  /// Queue a Pause/Resume/extend for the app. Call inside `withLock`.
  static func appendCommand(_ action: String, sessionId: String, at: Double) {
    let processed = defaults?.integer(forKey: commandsProcessedKey) ?? 0
    var commands = (load([FocusCommand].self, key: commandsKey) ?? []).filter { $0.seq > processed }
    let next = max(commands.map(\.seq).max() ?? 0, processed) + 1
    commands.append(FocusCommand(seq: next, sessionId: sessionId, action: action, at: at))
    if commands.count > maxQueue { commands = Array(commands.suffix(maxQueue)) }
    store(commands, key: commandsKey)
  }

  /// Queue a tick/untick for the app (the widget's queue). Drops entries the
  /// app already applied. Call inside `withLock`.
  public static func appendToggle(id: String, date: String, done: Bool, source: String? = nil) {
    let processed = defaults?.integer(forKey: togglesProcessedKey) ?? 0
    var toggles = (load([QueuedToggle].self, key: togglesKey) ?? []).filter { $0.seq > processed }
    let next = max(toggles.map(\.seq).max() ?? 0, processed) + 1
    toggles.append(QueuedToggle(seq: next, id: id, date: date, done: done, source: source))
    if toggles.count > maxQueue { toggles = Array(toggles.suffix(maxQueue)) }
    store(toggles, key: togglesKey)
  }

  /// Shows a task as done in the widget's snapshot until the app rewrites it
  /// (the optimistic tick the widget's own buttons make). Call inside `withLock`.
  static func markDoneInSnapshot(taskId: String, date: String) {
    guard let raw = defaults?.string(forKey: snapshotKey), let data = raw.data(using: .utf8),
      var snapshot = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      snapshot["date"] as? String == date, var tasks = snapshot["tasks"] as? [[String: Any]],
      let index = tasks.firstIndex(where: { $0["id"] as? String == taskId })
    else { return }
    tasks[index]["done"] = true
    snapshot["tasks"] = tasks
    guard let out = try? JSONSerialization.data(withJSONObject: snapshot), let text = String(data: out, encoding: .utf8)
    else { return }
    defaults?.set(text, forKey: snapshotKey)
  }

  /// "Start my next task" (Siri, the widget): picked up by the app when it
  /// opens. `kind` is "timer" or "starter"; `source` is "siri" or "widget".
  /// Returns its id, which the deep link carries too (the app acts on it once).
  @discardableResult
  public static func requestStart(kind: String, source: String) -> String {
    let id = UUID().uuidString
    let request: [String: Any] = ["id": id, "kind": kind, "source": source, "at": nowMs()]
    if let data = try? JSONSerialization.data(withJSONObject: request), let raw = String(data: data, encoding: .utf8) {
      defaults?.set(raw, forKey: startRequestKey)
    }
    return id
  }

  /// The deep link the app handles (lib/daily-tasks/focus-link.ts).
  public static func startURL(kind: String, source: String, id: String? = nil) -> URL? {
    var components = URLComponents()
    components.scheme = "dailytasks"
    components.host = "focus"
    components.path = "/start"
    var items = [URLQueryItem(name: "task", value: "next"), URLQueryItem(name: "source", value: source)]
    if kind == "starter" { items.append(URLQueryItem(name: "kind", value: "starter")) }
    if let id { items.append(URLQueryItem(name: "id", value: id)) }
    components.queryItems = items
    return components.url
  }

  /// A tap on the Live Activity: the app opens that session's focus screen.
  public static func openURL(sessionId: String) -> URL? {
    var components = URLComponents()
    components.scheme = "dailytasks"
    components.host = "focus"
    components.queryItems = [URLQueryItem(name: "session", value: sessionId)]
    return components.url
  }

  public static func reloadWidget() {
    WidgetCenter.shared.reloadTimelines(ofKind: widgetKind)
  }
}

// MARK: - Actions (the Live Activity's buttons, and the app)

@available(iOS 16.2, *)
public enum FocusActions {
  /// How long the final "Done" / "Timer stopped" stays before it goes.
  public static let finalDismissSeconds: TimeInterval = 8

  /// This app's activities that are still showing (not already ended).
  public static func liveActivities(for sessionId: String? = nil) -> [Activity<FocusActivityAttributes>] {
    Activity<FocusActivityAttributes>.activities.filter { activity in
      (activity.activityState == .active || activity.activityState == .stale)
        && (sessionId == nil || activity.attributes.sessionId == sessionId)
    }
  }

  /// Show the session's current state on its activity (if there is one).
  public static func show(_ session: FocusSessionMirror) async {
    let content = ActivityContent(state: session.contentState, staleDate: session.staleDate)
    for activity in liveActivities(for: session.id) {
      await activity.update(content)
    }
  }

  /// End activities (all, or one session's). With a final status the activity
  /// says so ("done" / "stopped") for `dismissAfter` seconds; otherwise it goes now.
  public static func end(sessionId: String?, finalStatus: String?, dismissAfter: TimeInterval) async {
    for activity in liveActivities(for: sessionId) {
      var content: ActivityContent<FocusActivityAttributes.ContentState>? = nil
      if let finalStatus {
        var state = activity.content.state
        state.status = finalStatus
        content = ActivityContent(state: state, staleDate: nil)
      }
      let policy: ActivityUIDismissalPolicy =
        finalStatus != nil && dismissAfter > 0 ? .after(Date().addingTimeInterval(dismissAfter)) : .immediate
      await activity.end(content, dismissalPolicy: policy)
    }
  }

  /// Pause from the Live Activity: the session is paused here (for the widget
  /// and the activity) and the app is told through `focus.commands`.
  public static func pause(sessionId: String) async {
    let now = Date()
    let paused: FocusSessionMirror? = withLock {
      // Yesterday's session (the app clears it at midnight) isn't paused.
      guard var session = FocusGroup.loadSession(), session.id == sessionId, session.date == FocusGroup.todayKey(now),
        session.isRunning(at: now), let endAt = session.endAt
      else { return nil }
      let at = FocusGroup.nowMs(now)
      session.pausedRemainingMs = min(session.durationMs, max(0, endAt - at))
      session.endAt = nil
      session.status = "paused"
      session.rev = max((session.rev ?? 0) + 1, at)
      FocusGroup.saveSession(session)
      FocusGroup.appendCommand("pause", sessionId: sessionId, at: at)
      return session
    }
    guard let paused else { return await reflectApp(sessionId: sessionId) }
    await holdNotification(sessionId: sessionId)
    await show(paused)
    FocusGroup.reloadWidget()
  }

  public static func resume(sessionId: String) async {
    let now = Date()
    let resumed: FocusSessionMirror? = withLock {
      guard var session = FocusGroup.loadSession(), session.id == sessionId, session.date == FocusGroup.todayKey(now),
        session.status == "paused"
      else { return nil }
      let at = FocusGroup.nowMs(now)
      let left = min(session.durationMs, max(0, session.pausedRemainingMs ?? 0))
      session.endAt = at + left
      session.pausedRemainingMs = nil
      session.status = "running"
      session.rev = max((session.rev ?? 0) + 1, at)
      FocusGroup.saveSession(session)
      FocusGroup.appendCommand("resume", sessionId: sessionId, at: at)
      return session
    }
    guard let resumed else { return await reflectApp(sessionId: sessionId) }
    if let end = resumed.endDate { await releaseNotification(sessionId: sessionId, at: end) }
    await show(resumed)
    FocusGroup.reloadWidget()
  }

  /// The time's-up button: 5 more minutes on a timer; on a starter, "Keep
  /// going" (a 20-minute timer), as the app's check-in offers. Only at time's up.
  public static func extend(sessionId: String) async {
    let now = Date()
    let result: (session: FocusSessionMirror, wasStarter: Bool)? = withLock {
      guard var session = FocusGroup.loadSession(), session.id == sessionId, session.date == FocusGroup.todayKey(now),
        session.hasEnded(at: now)
      else { return nil }
      let at = FocusGroup.nowMs(now)
      let wasStarter = session.kind == "starter"
      if wasStarter {
        session.kind = "timer"
        session.durationMs = keepGoingMs
        session.startedAt = at
        session.endAt = at + keepGoingMs
      } else {
        // At the day-long cap it's a no-op, as in the app (focus-session.ts extend).
        let duration = min(maxSessionMs, session.durationMs + extendMs)
        guard duration > session.durationMs else { return nil }
        session.endAt = at + (duration - session.durationMs)
        session.durationMs = duration
      }
      session.status = "running"
      session.pausedRemainingMs = nil
      session.rev = max((session.rev ?? 0) + 1, at)
      FocusGroup.saveSession(session)
      FocusGroup.appendCommand("extend", sessionId: sessionId, at: at)
      return (session, wasStarter)
    }
    guard let result else { return await reflectApp(sessionId: sessionId) }
    // The "Time's up" that went off is answered: it goes from Notification
    // Center, and says it again at the new end (a starter's Keep going is a
    // timer now: its words and buttons become a timer's).
    if let end = result.session.endDate {
      await repeatDeliveredNotification(at: end, asTimer: result.wasStarter)
    } else {
      UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [FocusGroup.notificationId])
    }
    await show(result.session)
    FocusGroup.reloadWidget()
  }

  static let extendMs: Double = 5 * 60_000
  static let keepGoingMs: Double = 20 * 60_000
  static let maxSessionMs: Double = 24 * 60 * 60_000

  /// Done from the Live Activity: queues the tick like the widget does (the
  /// app applies it, with its usual celebration and analytics, when it next
  /// becomes active), then ends the activity with a short "Done".
  public static func done(sessionId: String, taskId: String, date: String) async {
    // A tap on yesterday's activity (before it went) must not tick anything:
    // it just goes.
    guard date == FocusGroup.todayKey() else {
      return await end(sessionId: sessionId, finalStatus: nil, dismissAfter: 0)
    }
    withLock {
      FocusGroup.appendToggle(id: taskId, date: date, done: true, source: "live_activity")
      FocusGroup.markDoneInSnapshot(taskId: taskId, date: date)
    }
    if FocusGroup.loadSession()?.id == sessionId {
      // No "Time's up" for a task that's done: not one to come, nor one that
      // already went off (it would linger with its "Keep going?").
      UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [FocusGroup.notificationId])
      UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [FocusGroup.notificationId])
      FocusGroup.defaults?.removeObject(forKey: FocusGroup.heldNotificationKey)
      FocusGroup.defaults?.removeObject(forKey: FocusGroup.heldNotificationSessionKey)
    }
    await end(sessionId: sessionId, finalStatus: "done", dismissAfter: finalDismissSeconds)
    FocusGroup.reloadWidget()
  }

  /// A button on an activity that doesn't match the app's session (it moved
  /// on meanwhile): show what the app has, or end the activity if its session is gone.
  static func reflectApp(sessionId: String) async {
    if let session = FocusGroup.loadSession(), session.id == sessionId {
      await show(session)
    } else {
      await end(sessionId: sessionId, finalStatus: nil, dismissAfter: 0)
    }
  }

  // The end notification: a pause here holds it (its content is kept in the
  // App Group), a resume here schedules it again for the new end, and 5 more
  // minutes repeats the one that went off. The app reschedules or cancels it
  // too when it next becomes active.

  static func repeatDeliveredNotification(at end: Date, asTimer: Bool = false) async {
    let center = UNUserNotificationCenter.current()
    let delivered = await center.deliveredNotifications()
    let last = delivered.last(where: { $0.request.identifier == FocusGroup.notificationId })
    center.removeDeliveredNotifications(withIdentifiers: [FocusGroup.notificationId])
    guard let last else { return }
    var content: UNNotificationContent = last.request.content
    if asTimer, let timer = last.request.content.mutableCopy() as? UNMutableNotificationContent {
      // The title (the task's words) and the data (the session) stay.
      timer.body = FocusGroup.timerNotificationBody
      timer.categoryIdentifier = FocusGroup.timerCategoryId
      content = timer
    }
    await schedule(content, at: end)
  }

  static func schedule(_ content: UNNotificationContent, at end: Date) async {
    // Like the app: never for an end less than a second away, nor past the
    // next midnight (the session clears then).
    let calendar = Calendar.current
    let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: Date())) ?? end
    let interval = end.timeIntervalSinceNow
    guard interval > 1, end <= midnight else { return }
    let request = UNNotificationRequest(
      identifier: FocusGroup.notificationId, content: content,
      trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false))
    try? await UNUserNotificationCenter.current().add(request)
  }

  static func holdNotification(sessionId: String) async {
    let center = UNUserNotificationCenter.current()
    let pending = await center.pendingNotificationRequests()
    if let request = pending.first(where: { $0.identifier == FocusGroup.notificationId }),
      let data = try? NSKeyedArchiver.archivedData(withRootObject: request.content, requiringSecureCoding: true)
    {
      FocusGroup.defaults?.set(data, forKey: FocusGroup.heldNotificationKey)
      FocusGroup.defaults?.set(sessionId, forKey: FocusGroup.heldNotificationSessionKey)
    }
    center.removePendingNotificationRequests(withIdentifiers: [FocusGroup.notificationId])
  }

  static func releaseNotification(sessionId: String, at end: Date) async {
    guard let defaults = FocusGroup.defaults else { return }
    let held = defaults.string(forKey: FocusGroup.heldNotificationSessionKey)
    let data = defaults.data(forKey: FocusGroup.heldNotificationKey)
    defaults.removeObject(forKey: FocusGroup.heldNotificationKey)
    defaults.removeObject(forKey: FocusGroup.heldNotificationSessionKey)
    guard held == sessionId, let data,
      let content = try? NSKeyedUnarchiver.unarchivedObject(ofClass: UNNotificationContent.self, from: data)
    else { return }
    await schedule(content, at: end)
  }

  private static func withLock<T>(_ body: () -> T) -> T { FocusGroup.withLock(body) }
}
