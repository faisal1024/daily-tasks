import ActivityKit
import ExpoModulesCore

// The focus session's Live Activity (1.3), driven by the app's store through
// lib/daily-tasks/live-activity.ts. Activities start on iOS 17+ only: the
// widget extension that draws them (and their buttons) needs iOS 17, so an
// activity started on 16 would have no views. Elsewhere every call is a no-op. Nothing here throws into JS: a failed start or update
// just means no (or a stale) Live Activity, and the app reconciles on its next
// foreground. The attributes and the button logic are in FocusActivityShared.swift.
public class FocusActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FocusActivity")

    /// Live Activities are allowed for this app (the user can turn them off).
    Function("areActivitiesEnabled") { () -> Bool in
      guard #available(iOS 17.0, *) else { return false }
      return ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Sessions that have a Live Activity showing.
    Function("activeSessionIds") { () -> [String] in
      guard #available(iOS 16.2, *) else { return [] }
      return FocusActions.liveActivities().map { $0.attributes.sessionId }
    }

    /// Start one for a session (the mirror's JSON; see FocusSessionMirror), or
    /// update the one it already has. Only a running or paused session gets one.
    AsyncFunction("start") { (json: String) async -> Bool in
      guard #available(iOS 17.0, *), let session = FocusGroup.decodeSession(json) else { return false }
      guard session.status == "running" || session.status == "paused" else { return false }
      if !FocusActions.liveActivities(for: session.id).isEmpty {
        await FocusActions.show(session)
        return true
      }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }
      do {
        _ = try Activity<FocusActivityAttributes>.request(
          attributes: session.attributes,
          content: ActivityContent(state: session.contentState, staleDate: session.staleDate),
          pushType: nil)
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
  }
}
