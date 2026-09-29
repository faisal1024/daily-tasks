// Native side of the widget: App Group storage via the local WidgetStorage
// module (modules/widget-storage). iOS only; without the module (Android, web,
// Expo Go, tests) every call is a no-op and there's simply no widget.

import { Platform } from "react-native";

import { loadWidgetStorage, type WidgetStorageModule } from "@/modules/widget-storage";

import type { FocusSession } from "./focus-session";
import type { WidgetSnapshot } from "./widget-snapshot";

export const APP_GROUP = "group.com.faisalislam.dailytasks";
export const WIDGET_KIND = "DailyTasksWidget";
const SNAPSHOT_KEY = "widget.snapshot";
const TOGGLES_KEY = "widget.toggles";
const PROCESSED_KEY = "widget.processedSeq";
/** The focus session (1.3) for the widget and Live Activity: see the 1.3 spec. */
export const FOCUS_SESSION_KEY = "focus.session";
/** Bumped if the mirrored shape ever changes incompatibly. */
export const FOCUS_SESSION_VERSION = 1;
/** Pause/Resume from the Live Activity, queued for the app (PR F; see focus-commands.ts). */
const FOCUS_COMMANDS_KEY = "focus.commands";
const FOCUS_COMMANDS_PROCESSED_KEY = "focus.processedSeq";
/** "Start my next task" from Siri or the widget, left for the app (see focus-link.ts). */
const FOCUS_START_REQUEST_KEY = "focus.startRequest";
const FOCUS_START_HANDLED_KEY = "focus.startHandled";

let storage: WidgetStorageModule | null | undefined;
let lastWritten: string | null = null;
let lastSessionWritten: string | null = null;
let lastSessionRev = 0;

function getStorage(): WidgetStorageModule | null {
  if (storage !== undefined) return storage;
  storage = Platform.OS === "ios" ? loadWidgetStorage() : null;
  return storage;
}

/** Write today's snapshot and refresh the widget (skipped when unchanged). */
export function writeWidgetSnapshot(snapshot: WidgetSnapshot): void {
  const store = getStorage();
  if (!store) return;
  const raw = JSON.stringify(snapshot);
  if (raw === lastWritten) return;
  try {
    store.setString(SNAPSHOT_KEY, raw, APP_GROUP);
    lastWritten = raw;
    store.reloadWidget(WIDGET_KIND);
  } catch {
    // The widget just keeps its previous state.
  }
}

/**
 * Forget what we last wrote, so the next write goes through even if the app's
 * state didn't change. Needed after applying widget taps: the widget edits the
 * snapshot optimistically, and a tap the app didn't apply must be undone there.
 */
export function invalidateWidgetSnapshot(): void {
  lastWritten = null;
}

/** The widget's queued toggles (raw JSON) and the last one the app applied. */
export function readWidgetToggles(): { raw: string | null; processedSeq: number } {
  const store = getStorage();
  if (!store) return { raw: null, processedSeq: 0 };
  try {
    const processed = Number(store.getInt(PROCESSED_KEY, APP_GROUP));
    return {
      raw: store.getString(TOGGLES_KEY, APP_GROUP) ?? null,
      processedSeq: Number.isFinite(processed) ? processed : 0,
    };
  } catch {
    return { raw: null, processedSeq: 0 };
  }
}

export function markWidgetTogglesProcessed(seq: number): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setInt(PROCESSED_KEY, seq, APP_GROUP);
  } catch {
    // Re-applying is harmless: the reducer sets the wanted state, it doesn't flip blindly.
  }
}

/**
 * The mirror's JSON for a session: its own fields plus `v` and `rev` (see
 * writeFocusSession). The Live Activity is started and updated with the same.
 */
export function focusSessionJson(session: FocusSession, rev: number): string {
  return JSON.stringify({ v: FOCUS_SESSION_VERSION, rev, ...session });
}

/**
 * Mirror the focus session to the App Group (skipped when unchanged): the
 * session's own fields plus `v` and `rev`, or JSON `null` when there's none,
 * and refresh the widget (it shows the session). Times are epoch
 * milliseconds. `rev` goes up with every write (it's at least the time of the
 * write, so it keeps going up across launches): native code can tell a newer
 * state from an older one.
 */
export function writeFocusSession(session: FocusSession | null): void {
  const store = getStorage();
  if (!store) return;
  const content = session ? JSON.stringify(session) : "null";
  if (content === lastSessionWritten) return;
  const rev = Math.max(lastSessionRev + 1, Date.now());
  const raw = session ? focusSessionJson(session, rev) : "null";
  try {
    store.setString(FOCUS_SESSION_KEY, raw, APP_GROUP);
    lastSessionWritten = content;
    lastSessionRev = rev;
    store.reloadWidget(WIDGET_KIND);
  } catch {
    // Native readers keep the previous one; the next change writes again.
  }
}

/**
 * Forget the last session written, so the next write goes through: the Live
 * Activity's Pause/Resume write the mirror optimistically, and one the app
 * didn't apply (a stale tap) must be undone there.
 */
export function invalidateFocusSession(): void {
  lastSessionWritten = null;
}

/** The Live Activity's queued commands (raw JSON) and the last one the app applied. */
export function readFocusCommands(): { raw: string | null; processedSeq: number } {
  const store = getStorage();
  if (!store) return { raw: null, processedSeq: 0 };
  try {
    const processed = Number(store.getInt(FOCUS_COMMANDS_PROCESSED_KEY, APP_GROUP));
    return {
      raw: store.getString(FOCUS_COMMANDS_KEY, APP_GROUP) ?? null,
      processedSeq: Number.isFinite(processed) ? processed : 0,
    };
  } catch {
    return { raw: null, processedSeq: 0 };
  }
}

export function markFocusCommandsProcessed(seq: number): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setInt(FOCUS_COMMANDS_PROCESSED_KEY, seq, APP_GROUP);
  } catch {
    // Re-applying is harmless: pause and resume are no-ops when already so.
  }
}

/** The start request Siri or the widget left (raw JSON) and the id of the last one handled. */
export function readFocusStartRequest(): { raw: string | null; handledId: string | null } {
  const store = getStorage();
  if (!store) return { raw: null, handledId: null };
  try {
    return {
      raw: store.getString(FOCUS_START_REQUEST_KEY, APP_GROUP) ?? null,
      handledId: store.getString(FOCUS_START_HANDLED_KEY, APP_GROUP) ?? null,
    };
  } catch {
    return { raw: null, handledId: null };
  }
}

export function markFocusStartRequestHandled(id: string): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setString(FOCUS_START_HANDLED_KEY, id, APP_GROUP);
  } catch {
    // It's ignored anyway once it's older than a minute.
  }
}

/** Test-only: forget the cached module and last write. */
export function __resetWidgetBridgeForTests(): void {
  storage = undefined;
  lastWritten = null;
  lastSessionWritten = null;
  lastSessionRev = 0;
}
