// Siri and Shortcuts (1.3): "Start my next task" and "Start a 5-minute starter";
// 1.6 E: "Brain dump" and "Save for later" ("Add to Three Today").
//
// App target only: plugins/with-focus-app-intents.js adds this file (and a copy
// of targets/widget/FocusIntents.swift, where the intents live) to the app at
// prebuild. App Shortcuts are read from the app's App Intents metadata, which
// Xcode only extracts for code built in the app target itself (not in a pod).

import AppIntents

@available(iOS 16.0, *)
struct FocusShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: StartNextTaskIntent(),
      phrases: [
        "Start my next task in \(.applicationName)",
        "Start my next task with \(.applicationName)",
        "Focus on my next task in \(.applicationName)",
        "Start a timer in \(.applicationName)",
        "Start focusing in \(.applicationName)",
      ],
      shortTitle: "Start my next task",
      systemImageName: "timer"
    )
    AppShortcut(
      intent: StartStarterIntent(),
      phrases: [
        "Start a 5-minute starter in \(.applicationName)",
        "Start a five minute starter in \(.applicationName)",
        "Just start in \(.applicationName)",
      ],
      shortTitle: "5-minute starter",
      systemImageName: "play.circle"
    )
    // Capture from anywhere (1.6 E; the intents are in targets/widget/CaptureIntents.swift).
    AppShortcut(
      intent: BrainDumpIntent(),
      phrases: [
        "Brain dump in \(.applicationName)",
        "Brain dump with \(.applicationName)",
        "Open the brain dump in \(.applicationName)",
        "Empty my head in \(.applicationName)",
      ],
      shortTitle: "Brain dump",
      systemImageName: "square.and.pencil"
    )
    AppShortcut(
      intent: AddToThreeTodayIntent(),
      phrases: [
        "Add to \(.applicationName)",
        "Add a thought to \(.applicationName)",
        "Save a thought in \(.applicationName)",
        "Save for later in \(.applicationName)",
      ],
      shortTitle: "Save for later",
      systemImageName: "plus.bubble"
    )
  }
}
