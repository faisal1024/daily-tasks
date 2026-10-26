import ExpoModulesCore
import WidgetKit

// Minimal App Group bridge for the widget (targets/widget/Shared.swift).
// Kept local (instead of @bacons/apple-targets' ExtensionStorage, which needs
// iOS 16.4) so the app can keep supporting iOS 15.1.
public class WidgetStorageModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WidgetStorage")

    Function("setString") { (key: String, value: String, group: String) in
      UserDefaults(suiteName: group)?.set(value, forKey: key)
    }

    Function("getString") { (key: String, group: String) -> String? in
      UserDefaults(suiteName: group)?.string(forKey: key)
    }

    Function("setInt") { (key: String, value: Int, group: String) in
      UserDefaults(suiteName: group)?.set(value, forKey: key)
    }

    Function("getInt") { (key: String, group: String) -> Int in
      UserDefaults(suiteName: group)?.integer(forKey: key) ?? 0
    }

    // The capture inbox (1.6 E; targets/share/CaptureInbox.swift): one JSON
    // file per capture in the App Group's `folder`. The app reads them all
    // ({name, contents}) and deletes each one once it's saved for good.
    Function("listInboxFiles") { (group: String, folder: String) -> [[String: String]] in
      guard let dir = Self.inboxFolder(group: group, folder: folder) else { return [] }
      let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
      return names.filter(Self.isInboxFileName).sorted().compactMap { name in
        guard let data = FileManager.default.contents(atPath: dir.appendingPathComponent(name).path),
          let contents = String(data: data, encoding: .utf8)
        else { return ["name": name, "contents": ""] }
        return ["name": name, "contents": contents]
      }
    }

    Function("deleteInboxFile") { (group: String, folder: String, name: String) -> Bool in
      guard Self.isInboxFileName(name), let dir = Self.inboxFolder(group: group, folder: folder) else { return false }
      let file = dir.appendingPathComponent(name)
      if !FileManager.default.fileExists(atPath: file.path) { return true }
      return (try? FileManager.default.removeItem(at: file)) != nil
    }

    Function("reloadWidget") { (kind: String) in
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
      }
    }
  }

  static func inboxFolder(group: String, folder: String) -> URL? {
    guard !folder.isEmpty, !folder.contains("/"), !folder.contains("..") else { return nil }
    return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
      .appendingPathComponent(folder, isDirectory: true)
  }

  /// Only a capture file's own name: never a path, never a temporary file.
  static func isInboxFileName(_ name: String) -> Bool {
    name.hasSuffix(".json") && !name.hasPrefix(".") && !name.contains("/") && !name.contains("..")
  }
}
