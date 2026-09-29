import Foundation

// State shared with the app through the App Group.
//
// The app writes `widget.snapshot` (a JSON string) whenever today's tasks
// change. The widget never edits app data directly: a tap in the widget
// updates the snapshot optimistically and appends a toggle to
// `widget.toggles`, which the app applies the next time it becomes active.
// The app records the last toggle it applied in `widget.processedSeq`; only
// the widget (and the Live Activity's Done, FocusActivityShared.swift) writes
// `widget.toggles`, never the app's JS, so the two sides never overwrite each
// other's keys.
enum Shared {
  static let group = "group.com.faisalislam.dailytasks"
  static let snapshotKey = "widget.snapshot"
  static let togglesKey = "widget.toggles"
  static let processedKey = "widget.processedSeq"
  static let kind = "DailyTasksWidget"

  static var defaults: UserDefaults? { UserDefaults(suiteName: group) }

  /// Serialises read-modify-write of the snapshot and queue: two quick taps
  /// can run two intents at once, and neither may lose the other's change.
  /// The same lock as the Live Activity's buttons (FocusActivityShared.swift).
  static var lock: NSLock { FocusGroup.lock }

  /// Local calendar day as yyyy-MM-dd, matching the app's todayKey().
  static func todayKey(_ date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = .current
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter.string(from: date)
  }

  static func loadSnapshot() -> Snapshot? {
    guard let raw = defaults?.string(forKey: snapshotKey), let data = raw.data(using: .utf8) else {
      return nil
    }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
  }

  static func save(_ snapshot: Snapshot) {
    guard let data = try? JSONEncoder().encode(snapshot), let raw = String(data: data, encoding: .utf8) else {
      return
    }
    defaults?.set(raw, forKey: snapshotKey)
  }

  /// Queue a tick/untick for the app. Drops entries the app already applied.
  static func appendToggle(id: String, date: String, done: Bool) {
    FocusGroup.appendToggle(id: id, date: date, done: done)
  }

  /// The focus session (1.3) the app mirrors, if it's on today and still
  /// showing: running, paused or at time's up.
  static func loadFocusSession(now: Date = Date()) -> FocusSessionMirror? {
    guard let session = FocusGroup.loadSession(), session.date == todayKey(now) else { return nil }
    return session
  }
}

struct WidgetTask: Codable, Hashable, Identifiable {
  let id: String
  let text: String
  var done: Bool
}

struct Snapshot: Codable {
  let date: String
  var tasks: [WidgetTask]
  /// No longer shown by the widget (1.2 shows "Day N"); optional and kept so
  /// snapshots from older or newer app versions decode either way.
  var streak: Int? = nil
  /// Plus users can tick tasks off from the widget.
  let plus: Bool
  /// "Day N" (days shown up, including today). Optional: snapshots written by
  /// app versions before 1.2 don't have it and must still decode.
  var day: Int? = nil

  var completed: Int { tasks.filter(\.done).count }
  var nextOpen: WidgetTask? { tasks.first { !$0.done } }
}
