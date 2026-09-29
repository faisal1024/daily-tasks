// App Intents for the focus session (1.3): the Live Activity's buttons and
// "start my next task" (Siri, Shortcuts, the widget's Start button).
//
// Compiled into the widget extension AND the app: plugins/with-focus-app-intents.js
// copies this file into the app target at prebuild. A Live Activity's intent
// runs in the app's process when the app has it (and in the extension
// otherwise), and an intent that opens the app runs in the app; the code is
// written to work in either. In the app, the shared types come from the
// FocusActivity module (modules/focus-activity); in the extension they're
// compiled in (FocusActivityShared.swift).

import AppIntents
import Foundation

#if canImport(FocusActivity)
  import FocusActivity
  import UIKit
#endif

// MARK: - Live Activity buttons (iOS 17)

@available(iOS 17.0, *)
struct FocusPauseIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Pause the timer"
  static let description = IntentDescription("Pauses the timer on your task.")
  static let isDiscoverable = false

  @Parameter(title: "Session") var sessionId: String

  init() {}
  init(sessionId: String) { self.sessionId = sessionId }

  func perform() async throws -> some IntentResult {
    await FocusActions.pause(sessionId: sessionId)
    return .result()
  }
}

@available(iOS 17.0, *)
struct FocusResumeIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Resume the timer"
  static let description = IntentDescription("Resumes the timer on your task.")
  static let isDiscoverable = false

  @Parameter(title: "Session") var sessionId: String

  init() {}
  init(sessionId: String) { self.sessionId = sessionId }

  func perform() async throws -> some IntentResult {
    await FocusActions.resume(sessionId: sessionId)
    return .result()
  }
}

/// Time's up: 5 more minutes on a timer, "Keep going" on a starter.
@available(iOS 17.0, *)
struct FocusExtendIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Keep the timer going"
  static let description = IntentDescription("Adds 5 more minutes, or keeps a 5-minute starter going.")
  static let isDiscoverable = false

  @Parameter(title: "Session") var sessionId: String

  init() {}
  init(sessionId: String) { self.sessionId = sessionId }

  func perform() async throws -> some IntentResult {
    await FocusActions.extend(sessionId: sessionId)
    return .result()
  }
}

@available(iOS 17.0, *)
struct FocusDoneIntent: LiveActivityIntent {
  static let title: LocalizedStringResource = "Mark the task done"
  static let description = IntentDescription("Ticks off the task the timer is on.")
  static let isDiscoverable = false

  @Parameter(title: "Session") var sessionId: String
  @Parameter(title: "Task ID") var taskId: String
  @Parameter(title: "Day") var date: String

  init() {}
  init(sessionId: String, taskId: String, date: String) {
    self.sessionId = sessionId
    self.taskId = taskId
    self.date = date
  }

  func perform() async throws -> some IntentResult {
    await FocusActions.done(sessionId: sessionId, taskId: taskId, date: date)
    return .result()
  }
}

// MARK: - Start my next task (opens the app)

/// Leaves the request in the App Group (the app picks it up once it's up,
/// even from a cold start) and, in the app, opens the deep link so a running
/// app acts on it at once. Both carry the same id: the app acts once.
@available(iOS 16.0, *)
enum FocusStart {
  @MainActor
  static func open(kind: String, source: String) async {
    // The link carries the request's id: the app acts on the pair once.
    let id = FocusGroup.requestStart(kind: kind, source: source)
    #if canImport(FocusActivity)
      if let url = FocusGroup.startURL(kind: kind, source: source, id: id) {
        _ = await UIApplication.shared.open(url)
      }
    #endif
  }
}

#if canImport(FocusActivity)
// Siri and Shortcuts: in the app only (see plugins/with-focus-app-intents.js
// for FocusShortcuts, the AppShortcutsProvider), so Shortcuts lists them once.
@available(iOS 16.0, *)
struct StartNextTaskIntent: AppIntent {
  static let title: LocalizedStringResource = "Start my next task"
  static let description = IntentDescription("Starts a timer on your next task, at the length you used last.")
  static let openAppWhenRun = true

  init() {}

  func perform() async throws -> some IntentResult {
    await FocusStart.open(kind: "timer", source: "siri")
    return .result()
  }
}

@available(iOS 16.0, *)
struct StartStarterIntent: AppIntent {
  static let title: LocalizedStringResource = "Start a 5-minute starter"
  static let description = IntentDescription("Starts 5 minutes on your next task. You can stop after 5 minutes.")
  static let openAppWhenRun = true

  init() {}

  func perform() async throws -> some IntentResult {
    await FocusStart.open(kind: "starter", source: "siri")
    return .result()
  }
}
#endif

/// The widget's Start button (a small widget can't hold a Link).
@available(iOS 17.0, *)
struct StartFromWidgetIntent: AppIntent {
  static let title: LocalizedStringResource = "Start a timer from the widget"
  static let openAppWhenRun = true
  static let isDiscoverable = false

  init() {}

  func perform() async throws -> some IntentResult {
    await FocusStart.open(kind: "timer", source: "widget")
    return .result()
  }
}
