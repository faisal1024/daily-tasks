// Capture from anywhere (1.6 E): App Intents that open the brain dump or
// save a thought for later. See lib/daily-tasks/capture.ts.
//
// Compiled into the widget extension AND the app, like FocusIntents.swift
// (plugins/with-focus-app-intents.js copies it into the app at prebuild): a
// control's intent must be in both, and an intent that opens the app runs
// in the app. Siri / Shortcuts ones are in the app only (FocusShortcuts,
// the AppShortcutsProvider, lists them), so Shortcuts shows them once.

import AppIntents
import Foundation

#if canImport(FocusActivity)
  import UIKit
#endif

/// Leaves the request in the App Group (the app picks it up once it's up,
/// even from a cold start) and, in the app, opens the deep link so a running
/// app acts on it at once. Both carry the same id: the app acts once.
@available(iOS 16.0, *)
enum CaptureOpen {
  @MainActor
  static func open(source: String) async {
    let id = CaptureGroup.requestOpen(source: source)
    #if canImport(FocusActivity)
      if let url = CaptureGroup.dumpURL(source: source, id: id) {
        _ = await UIApplication.shared.open(url)
      }
    #endif
  }
}

/// The Dump control (iOS 18: Control Center, the Lock Screen, the Action
/// button). Not listed in Shortcuts: "Brain dump" is the one there.
@available(iOS 17.0, *)
struct OpenDumpFromControlIntent: AppIntent {
  static let title: LocalizedStringResource = "Open the brain dump"
  static let openAppWhenRun = true
  static let isDiscoverable = false

  init() {}

  func perform() async throws -> some IntentResult {
    await CaptureOpen.open(source: "widget")
    return .result()
  }
}

#if canImport(FocusActivity)
/// "Brain dump in Three Today": opens the app straight to the brain dump.
@available(iOS 16.0, *)
struct BrainDumpIntent: AppIntent {
  static let title: LocalizedStringResource = "Brain dump"
  static let description = IntentDescription("Opens Three Today straight to the brain dump.")
  static let openAppWhenRun = true

  init() {}

  func perform() async throws -> some IntentResult {
    await CaptureOpen.open(source: "intent")
    return .result()
  }
}

/// "Add to Three Today": saves a thought for later without opening the app.
/// The app moves it to Saved for later when it next opens; it never goes on
/// today's three by itself.
@available(iOS 16.0, *)
struct AddToThreeTodayIntent: AppIntent {
  static let title: LocalizedStringResource = "Add to Three Today"
  static let description = IntentDescription(
    "Saves a thought for later in Three Today without opening it. It waits in Ideas, never on today's three by itself."
  )
  static let openAppWhenRun = false

  @Parameter(title: "Thought", requestValueDialog: IntentDialog("What's on your mind?"))
  var text: String

  init() {}

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let saved = CaptureGroup.append(text, source: "intent")
    return .result(dialog: saved ? "Saved for later in Three Today." : "There was nothing to save.")
  }
}
#endif
