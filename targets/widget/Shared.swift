import Foundation

// State shared with the app through the App Group.
//
// The app writes `widget.snapshot` (a JSON string) whenever today's tasks
// change. The widget never edits app data directly: a tap in the widget
// updates the snapshot optimistically and appends a toggle to
// `widget.toggles`, which the app applies the next time it becomes active.
// The app records the last toggle it applied in `widget.processedSeq`; only
// the widget writes `widget.toggles`, so the two sides never overwrite each
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
  static let lock = NSLock()

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

  static func loadToggles() -> [PendingToggle] {
    guard let raw = defaults?.string(forKey: togglesKey), let data = raw.data(using: .utf8) else {
      return []
    }
    return (try? JSONDecoder().decode([PendingToggle].self, from: data)) ?? []
  }

  /// Queue a tick/untick for the app. Drops entries the app already applied.
  static func appendToggle(id: String, date: String, done: Bool) {
    let processed = defaults?.integer(forKey: processedKey) ?? 0
    var toggles = loadToggles().filter { $0.seq > processed }
    let next = max(toggles.map(\.seq).max() ?? 0, processed) + 1
    toggles.append(PendingToggle(seq: next, id: id, date: date, done: done))
    // Keep the queue small even if the app isn't opened for a long time.
    if toggles.count > 50 { toggles = Array(toggles.suffix(50)) }
    guard let data = try? JSONEncoder().encode(toggles), let raw = String(data: data, encoding: .utf8) else {
      return
    }
    defaults?.set(raw, forKey: togglesKey)
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

struct PendingToggle: Codable {
  let seq: Int
  let id: String
  let date: String
  let done: Bool
}
