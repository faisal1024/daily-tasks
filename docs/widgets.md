# Widgets (Phase 5)

Home-screen (small, medium) and lock-screen (circular, rectangular, inline) widgets
for Today's three. Native code lives in `targets/widget/` and is linked into the
Xcode project by `@bacons/apple-targets` at prebuild (the generated `ios/` folder is
not committed). Needs iOS 17 (interactive buttons); the app itself still supports
older iOS, where there's simply no widget.

## Data flow

- **App → widget:** the store writes `widget.snapshot` (JSON: date, tasks with done
  state, streak, plus) to the App Group `group.com.faisalislam.dailytasks` whenever
  today's tasks or completions change, then reloads the widget
  (`lib/daily-tasks/widget-bridge.ts`, `widget-snapshot.ts`).
- **Widget → app:** tapping a task's circle (Plus only) runs `ToggleTaskIntent`,
  which updates the snapshot optimistically and appends `{seq, id, date, done}` to
  `widget.toggles`. The app applies queued toggles on launch and every time it comes
  to the foreground (through the normal `toggleTask` action, so XP, perfect days and
  milestones behave exactly as in-app), then records `widget.processedSeq`.
- Only the widget writes `widget.toggles`; only the app writes `widget.snapshot` and
  `widget.processedSeq` (the intent's optimistic snapshot edit is overwritten by the
  app's next write). Toggles carry the wanted state, so replaying one is harmless.
- Toggles for another day, or for tasks that no longer exist, are ignored. The widget
  refreshes at midnight and shows "Pick your three" until the app writes the new day.

## Release notes

- EAS needs a provisioning profile for the extension bundle id
  `com.faisalislam.dailytasks.widget` and the App Group on both ids. The first
  production build may need `eas credentials` / an interactive `eas build` once.
