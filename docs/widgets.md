# Widgets (Phase 5)

Home-screen (small, medium) and lock-screen (circular, rectangular, inline) widgets
for Today's three. Native code lives in `targets/widget/` and is linked into the
Xcode project by `@bacons/apple-targets` at prebuild (the generated `ios/` folder is
not committed). The widget needs iOS 17 (interactive buttons). The app keeps its iOS 15.1
minimum: App Group storage goes through our own tiny module (`modules/widget-storage`)
instead of the plugin's `ExtensionStorage` (which needs 16.4 and is excluded from
autolinking in package.json).

## Data flow

- **App → widget:** the store writes `widget.snapshot` (JSON: date, tasks with done
  state, streak, plus) to the App Group `group.com.faisalislam.dailytasks` whenever
  today's tasks or completions change, then reloads the widget
  (`lib/daily-tasks/widget-bridge.ts`, `widget-snapshot.ts`). Plus is written only once
  confirmed, so a free user's widget never becomes interactive while RevenueCat loads.
- **Widget → app:** tapping a task's circle (Plus only) runs `ToggleTaskIntent`,
  which updates the snapshot optimistically and appends `{seq, id, date, done}` to
  `widget.toggles`. The app applies queued toggles **before any rollover** (on launch,
  on every foreground, and on the in-app day change), to the day its tasks belong to
  (`lastOpenedDate`): a tap made at 11 pm counts for that day even if the app is only
  opened the next morning. The `applyWidgetToggles` reducer action toggles only tasks
  whose state differs (via the normal `toggleTask`, so XP, perfect days and milestones
  behave exactly as in-app), so replaying is harmless. Then `widget.processedSeq` is
  recorded and the snapshot is rewritten from app state (undoing any optimistic tap
  the app didn't apply).
- Key ownership: the widget writes `widget.toggles` and edits `widget.snapshot`
  optimistically; the app writes `widget.snapshot` (authoritative) and
  `widget.processedSeq`. Intent writes are serialised with a lock.
- Toggles for another day, or for tasks that no longer exist, are ignored. The widget
  refreshes at local midnight (calendar math, DST-safe) and shows "Open to pick
your three for today." until the app writes the new day. Task text on the lock screen is marked
`privacySensitive`.

## Release notes

- EAS needs a provisioning profile for the extension bundle id
  `com.faisalislam.dailytasks.widget` and the App Group on both ids. The first
  production build may need `eas credentials` / an interactive `eas build` once.
