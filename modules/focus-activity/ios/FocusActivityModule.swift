import ActivityKit
import ExpoModulesCore

// The focus session's Live Activity (1.3), driven by the app's store through
// lib/daily-tasks/live-activity.ts. Activities start on iOS 17.2+ only: the
// widget extension that draws them needs iOS 17, and Xcode's extracted App
// Intents metadata marks the Live Activity's button intents as introduced in
// 17.2, so an earlier start could show buttons that don't work. Elsewhere
// every call is a no-op. Nothing here throws into JS: a failed start or
// update just means no (or a stale) Live Activity, and the app reconciles on
// its next foreground. The attributes and the button logic are in FocusActivityShared.swift.
//
// A dismissed activity stays dismissed (1.3 polish): once the user swipes a
// session's activity away (its activityState becomes .dismissed), or the
// system ends it, that session never gets another, even after a pause,
// resume or 5 more minutes, or the app being killed and relaunched. A new
// session (a new id) can start one again. Kept in the app's own defaults.
public class FocusActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FocusActivity")

    /// Live Activities are allowed for this app (the user can turn them off).
    Function("areActivitiesEnabled") { () -> Bool in
      guard #available(iOS 17.2, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Sessions that have a Live Activity showing.
    Function("activeSessionIds") { () -> [String] in
      guard #available(iOS 16.2, *) else { return [] }
      return FocusActions.liveActivities().map { $0.attributes.sessionId }
    }

    /// Start one for a session (the mirror's JSON; see FocusSessionMirror), or
    /// update the one it already has. Only a running or paused session gets
    /// one, and never a session whose activity was dismissed.
    AsyncFunction("start") { (json: String) async -> Bool in
      guard #available(iOS 17.2, *), let session = FocusGroup.decodeSession(json) else { return false }
      guard session.status == "running" || session.status == "paused" else { return false }
      if !FocusActions.liveActivities(for: session.id).isEmpty {
        await FocusActions.show(session)
        return true
      }
      guard !DismissedActivities.contains(session.id) else { return false }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
      do {
        let activity = try Activity<FocusActivityAttributes>.request(
          attributes: session.attributes,
          content: ActivityContent(state: session.contentState, staleDate: session.staleDate),
          pushType: nil)
        DismissedActivities.started(session.id)
        DismissedActivities.watch(activity)
        return true
      } catch {
        // Not allowed right now (e.g. the app isn't in the foreground).
        return false
      }
    }

    /// Show a session's new state on its activity (no-op if it has none).
    AsyncFunction("update") { (json: String) async -> Bool in
      guard #available(iOS 16.2, *), let session = FocusGroup.decodeSession(json) else { return false }
      await FocusActions.show(session)
      return true
    }

    /// End one session's activity (or all, for nil). A final status ("done" /
    /// "stopped") is shown for `dismissAfterSeconds` first; without one it goes at once.
    AsyncFunction("end") { (sessionId: String?, finalStatus: String?, dismissAfterSeconds: Double) async in
      guard #available(iOS 16.2, *) else { return }
      await FocusActions.end(sessionId: sessionId, finalStatus: finalStatus, dismissAfter: dismissAfterSeconds)
    }

    OnCreate {
      // Activities from before a relaunch: still told when they're dismissed.
      guard #available(iOS 16.2, *) else { return }
      Activity<FocusActivityAttributes>.activities.forEach(DismissedActivities.watch)
    }
  }
}

/// Sessions whose Live Activity is gone while the session may still be on:
/// the user dismissed it, or the system ended it. Never given another.
enum DismissedActivities {
  /// The app's own defaults (not the App Group: only the app starts activities).
  private static let dismissedKey = "focusActivity.dismissedSessionIds"
  /// The last session an activity was started for.
  private static let startedKey = "focusActivity.startedSessionId"
  /// Only the latest few matter (there's one session at a time).
  private static let maxKept = 20
  private static let lock = NSLock()

  static func record(_ sessionId: String) {
    lock.lock()
    defer { lock.unlock() }
    var ids = UserDefaults.standard.stringArray(forKey: dismissedKey) ?? []
    guard !ids.contains(sessionId) else { return }
    ids.append(sessionId)
    UserDefaults.standard.set(Array(ids.suffix(maxKept)), forKey: dismissedKey)
  }

  static func started(_ sessionId: String) {
    UserDefaults.standard.set(sessionId, forKey: startedKey)
  }

  /// Called with no live activity for the session: it had one before (it was
  /// started, or one is still listed as dismissed or ended), so it was
  /// dismissed, even if that happened while the app wasn't running.
  @available(iOS 16.2, *)
  static func contains(_ sessionId: String) -> Bool {
    let gone = Activity<FocusActivityAttributes>.activities.contains {
      $0.attributes.sessionId == sessionId && ($0.activityState == .dismissed || $0.activityState == .ended)
    }
    if gone || UserDefaults.standard.string(forKey: startedKey) == sessionId {
      record(sessionId)
      return true
    }
    lock.lock()
    defer { lock.unlock() }
    return (UserDefaults.standard.stringArray(forKey: dismissedKey) ?? []).contains(sessionId)
  }

  /// Records the session when its activity is dismissed (the app ends one
  /// only once its session has gone, so that never blocks a session still on).
  @available(iOS 16.2, *)
  static func watch(_ activity: Activity<FocusActivityAttributes>) {
    let sessionId = activity.attributes.sessionId
    Task {
      for await state in activity.activityStateUpdates where state == .dismissed {
        record(sessionId)
        return
      }
    }
  }
}
