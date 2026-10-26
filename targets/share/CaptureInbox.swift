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
// The capture inbox (see lib/daily-tasks/capture.ts and capture-bridge.ts):
// one small JSON file per capture, `{text, at, source}`, in the App Group
// container's `capture-inbox/` folder, named `<at ms>-<uuid>.json` and
// written atomically. Native code only ever adds files; the app reads them
// oldest first and deletes each one only once it's saved (Saved for later)
// for good. So no lock and no shared list: a writer and the app can never
// lose each other's captures. At most `maxQueue` files: a full inbox refuses
// a new capture (and says so) instead of dropping an old one.
//
// `capture.openRequest` (UserDefaults): "open the brain dump" ({id, source,
// at}) from the "Brain dump" shortcut or the Dump control, for a cold start
// that misses the link. The app writes `capture.openHandled`.

import Foundation

enum CaptureGroup {
  static let group = "group.com.faisalislam.dailytasks"
  static let inboxFolder = "capture-inbox"
  static let openRequestKey = "capture.openRequest"
  /// The most captures waiting for the app. The inbox's own cap: separate from
  /// Saved for later's (MAX_PARKED_TASKS in the app, 100 from 1.6).
  static let maxQueue = 50
  /// The app cuts saved items shorter; this only keeps the files small.
  static let maxChars = 1000

  enum AppendResult: Equatable {
    case saved
    /// Only whitespace: nothing to save.
    case empty
    /// `maxQueue` captures are already waiting: open the app to sort them.
    case full
    /// The App Group couldn't be written.
    case failed
  }

  static func nowMs(_ date: Date = Date()) -> Double { (date.timeIntervalSince1970 * 1000).rounded() }

  static var inboxURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
      .appendingPathComponent(inboxFolder, isDirectory: true)
  }

  /// The captures waiting (file names), whatever their content.
  static func waitingCount(in folder: URL) -> Int {
    let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
    return names.filter { $0.hasSuffix(".json") }.count
  }

  /// Saves a thought for the app to put in Saved for later when it next
  /// opens. `source` is "share" or "intent".
  static func append(_ raw: String, source: String) -> AppendResult {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return .empty }
    guard let folder = inboxURL else { return .failed }
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    } catch {
      return .failed
    }
    if waitingCount(in: folder) >= maxQueue { return .full }
    let at = nowMs()
    let entry: [String: Any] = ["text": String(trimmed.prefix(maxChars)), "at": at, "source": source]
    guard let data = try? JSONSerialization.data(withJSONObject: entry) else { return .failed }
    let file = folder.appendingPathComponent("\(Int64(at))-\(UUID().uuidString).json")
    do {
      try data.write(to: file, options: .atomic)
      return .saved
    } catch {
      return .failed
    }
  }

  static var defaults: UserDefaults? { UserDefaults(suiteName: group) }

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
