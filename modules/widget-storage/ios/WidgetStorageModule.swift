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

    Function("reloadWidget") { (kind: String) in
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
      }
    }
  }
}
