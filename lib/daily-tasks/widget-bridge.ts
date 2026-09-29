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

let storage: WidgetStorageModule | null | undefined;
let lastWritten: string | null = null;
let lastSessionWritten: string | null = null;

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
 * Mirror the focus session to the App Group (skipped when unchanged): the
 * session's own fields plus `v`, or JSON `null` when there's none. Times are
 * epoch milliseconds. Nothing reloads the widget yet: nothing native reads it
 * until the Live Activity and widget Start (PR F).
 */
export function writeFocusSession(session: FocusSession | null): void {
  const store = getStorage();
  if (!store) return;
  const raw = session ? JSON.stringify({ v: FOCUS_SESSION_VERSION, ...session }) : "null";
  if (raw === lastSessionWritten) return;
  try {
    store.setString(FOCUS_SESSION_KEY, raw, APP_GROUP);
    lastSessionWritten = raw;
  } catch {
    // Native readers keep the previous one; the next change writes again.
  }
}

/** Test-only: forget the cached module and last write. */
export function __resetWidgetBridgeForTests(): void {
  storage = undefined;
  lastWritten = null;
  lastSessionWritten = null;
}
