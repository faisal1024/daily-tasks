// Capture from anywhere (1.6 E): the App Group side, shared by the share
// extension, the widget extension and the app.
//
// ONE SOURCE, THREE PLACES. This file is compiled into the share extension
// (targets/share/CaptureInbox.swift), the widget extension
// (targets/widget/CaptureInbox.swift, a byte-identical copy) and the app
// (plugins/with-focus-app-intents.js copies targets/share's at prebuild).
// Edit targets/share/CaptureInbox.swift and copy it over:
//   cp targets/share/CaptureInbox.swift targets/widget/
//
// Keys (see lib/daily-tasks/capture.ts and capture-bridge.ts):
// - `capture.inbox`: thoughts to save for later, a JSON array of
//   {seq, text, source, at}. Written only here (the share sheet, "Add to
//   Three Today"); entries the app already saved are dropped on each append.
// - `capture.processedSeq`: the last entry the app saved (written by the app).
// - `capture.openRequest`: "open the brain dump" ({id, source, at}) from the
//   "Brain dump" shortcut or the Dump control, for a cold start that misses
//   the link. The app writes `capture.openHandled`.

import Darwin
import Foundation

enum CaptureGroup {
  static let group = "group.com.faisalislam.dailytasks"
  static let inboxKey = "capture.inbox"
  static let processedKey = "capture.processedSeq"
  static let openRequestKey = "capture.openRequest"
  /// Kept short even if the app isn't opened for a long time.
  static let maxQueue = 50
  /// The app cuts saved items shorter; this only keeps the inbox small.
  static let maxChars = 1000
  static let lockFileName = "CaptureInbox.lock"

  static var defaults: UserDefaults? { UserDefaults(suiteName: group) }

  struct Item: Codable {
    let seq: Int
    let text: String
    let source: String
    let at: Double
  }

  static func nowMs(_ date: Date = Date()) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }

  /// Serialises the inbox's read-modify-write across processes (the share
  /// extension and the app can append at once): an NSLock within the
  /// process, plus an flock on a file in the App Group container.
  static let lock = NSLock()

  static func withLock<T>(_ body: () -> T) -> T {
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

  /// Saves a thought for the app to put in Saved for later when it next
  /// opens. `source` is "share" or "intent". False when there's nothing to
  /// save (only whitespace) or the App Group can't be written.
  @discardableResult
  static func append(_ raw: String, source: String) -> Bool {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let defaults else { return false }
    let text = String(trimmed.prefix(maxChars))
    return withLock {
      let processed = defaults.integer(forKey: processedKey)
      var items = (loadInbox() ?? []).filter { $0.seq > processed }
      let next = max(items.map(\.seq).max() ?? 0, processed) + 1
      items.append(Item(seq: next, text: text, source: source, at: nowMs()))
      if items.count > maxQueue { items = Array(items.suffix(maxQueue)) }
      guard let data = try? JSONEncoder().encode(items), let json = String(data: data, encoding: .utf8) else {
        return false
      }
      defaults.set(json, forKey: inboxKey)
      return true
    }
  }

  static func loadInbox() -> [Item]? {
    guard let raw = defaults?.string(forKey: inboxKey), let data = raw.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode([Item].self, from: data)
  }

  /// "Open the brain dump", left for the app (it acts on it once it's up,
  /// even from a cold start). `source` is "widget" or "intent". Returns its
  /// id, which the deep link carries too, so the app acts on the pair once.
  @discardableResult
  static func requestOpen(source: String) -> String {
    let id = UUID().uuidString
    let request: [String: Any] = ["id": id, "source": source, "at": nowMs()]
    if let data = try? JSONSerialization.data(withJSONObject: request),
      let raw = String(data: data, encoding: .utf8)
    {
      defaults?.set(raw, forKey: openRequestKey)
    }
    return id
  }

  /// `dailytasks://dump?source=…[&id=…]`, handled by app/+native-intent.tsx.
  static func dumpURL(source: String, id: String? = nil) -> URL? {
    var components = URLComponents()
    components.scheme = "dailytasks"
    components.host = "dump"
    var items = [URLQueryItem(name: "source", value: source)]
    if let id { items.append(URLQueryItem(name: "id", value: id)) }
    components.queryItems = items
    return components.url
  }
}
