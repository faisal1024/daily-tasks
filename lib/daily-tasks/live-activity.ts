// The focus session's Live Activity and Dynamic Island (1.3, PR F), through
// the local FocusActivity module (modules/focus-activity). iOS 16.2+ only;
// without the module (Android, web, Expo Go, tests) every call is a no-op.
//
// The store calls syncLiveActivity whenever the session changes, and again
// when the app becomes active (reconcile): one activity for the running or
// paused session, updated when it changes (pause, resume, 5 more minutes, the
// task's words), "Time's up" once it ends; any other activity is ended
// (an orphan from a session that's gone). When the session goes, its activity
// shows "Done" or "Timer stopped" briefly and then goes. Nothing here throws.
import { Platform } from "react-native";

import { loadFocusActivity, type FocusActivityModule } from "@/modules/focus-activity";

import type { FocusSession } from "./focus-session";
import { focusSessionJson } from "./widget-bridge";

/** How long the final "Done" / "Timer stopped" shows, in seconds. */
export const FINAL_DISMISS_SECONDS = 8;

export type LiveActivityEnding = "done" | "stopped";

let activityModule: FocusActivityModule | null | undefined;
// Calls are chained so a start can't race an update or end.
let queue: Promise<void> = Promise.resolve();
// What each activity last showed, so an unchanged session isn't re-sent.
const shown = new Map<string, string>();

function getModule(): FocusActivityModule | null {
  if (activityModule !== undefined) return activityModule;
  activityModule = Platform.OS === "ios" ? loadFocusActivity() : null;
  return activityModule;
}

/** What the activity shows of a session (the fields its content is built from). */
function contentKey(session: FocusSession): string {
  const { taskText, stepText, kind, status, endAt, durationMs, pausedRemainingMs } = session;
  return JSON.stringify([taskText, stepText, kind, status, endAt, durationMs, pausedRemainingMs]);
}

/**
 * Bring the Live Activity in line with the session. `ending` is how the
 * previous session went, when this call is for it going (null session);
 * without it (a reconcile), activities of sessions that are gone end at once.
 * `force` re-sends the content (after the app was away: a button may have
 * changed what the activity shows).
 */
export function syncLiveActivity(
  session: FocusSession | null,
  options: { ending?: LiveActivityEnding; force?: boolean } = {},
): Promise<void> {
  const native = getModule();
  if (!native) return Promise.resolve();
  const run = queue.then(() => sync(native, session, options)).catch(() => {});
  queue = run;
  return run;
}

async function sync(
  native: FocusActivityModule,
  session: FocusSession | null,
  { ending, force = false }: { ending?: LiveActivityEnding; force?: boolean },
): Promise<void> {
  if (force) shown.clear();
  const ids = native.activeSessionIds();
  for (const id of ids) {
    if (id === session?.id) continue;
    shown.delete(id);
    // The session that just went says how; any other is an orphan.
    await native.end(id, ending ?? null, ending ? FINAL_DISMISS_SECONDS : 0);
  }
  if (!session) return;
  const key = contentKey(session);
  const json = focusSessionJson(session, Date.now());
  if (ids.includes(session.id)) {
    if (shown.get(session.id) === key) return;
    if (await native.update(json)) shown.set(session.id, key);
    return;
  }
  // A new activity only for a timer that's on (not one already at time's up),
  // and only if the user allows them.
  if (session.status === "ended" || !native.areActivitiesEnabled()) return;
  if (await native.start(json)) shown.set(session.id, key);
}

/** Test-only: forget the cached module and what was shown. */
export function __resetLiveActivityForTests(): void {
  activityModule = undefined;
  queue = Promise.resolve();
  shown.clear();
}
