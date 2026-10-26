// App Group side of capture from anywhere (1.6 E; see capture.ts). Same
// WidgetStorage module as the widget (widget-bridge.ts); a no-op without it
// (Android, web, Expo Go, tests).
//
// Key ownership: native code (the share extension, the "Add to Three Today"
// shortcut) writes `capture.inbox` and drops entries the app already saved;
// the app only writes `capture.processedSeq`. Native code (the "Brain dump"
// shortcut, the Dump control) writes `capture.openRequest`; the app writes
// `capture.openHandled`. So the two sides never overwrite each other's keys.

import { Platform } from "react-native";

import { loadWidgetStorage, type WidgetStorageModule } from "@/modules/widget-storage";

import { APP_GROUP } from "./widget-bridge";

const INBOX_KEY = "capture.inbox";
const INBOX_PROCESSED_KEY = "capture.processedSeq";
const OPEN_REQUEST_KEY = "capture.openRequest";
const OPEN_HANDLED_KEY = "capture.openHandled";

let storage: WidgetStorageModule | null | undefined;

function getStorage(): WidgetStorageModule | null {
  if (storage !== undefined) return storage;
  storage = Platform.OS === "ios" ? loadWidgetStorage() : null;
  return storage;
}

/** The capture inbox (raw JSON) and the last entry the app saved. */
export function readCaptureInbox(): { raw: string | null; processedSeq: number } {
  const store = getStorage();
  if (!store) return { raw: null, processedSeq: 0 };
  try {
    const processed = Number(store.getInt(INBOX_PROCESSED_KEY, APP_GROUP));
    return {
      raw: store.getString(INBOX_KEY, APP_GROUP) ?? null,
      processedSeq: Number.isFinite(processed) ? processed : 0,
    };
  } catch {
    return { raw: null, processedSeq: 0 };
  }
}

export function markCaptureInboxProcessed(seq: number): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setInt(INBOX_PROCESSED_KEY, seq, APP_GROUP);
  } catch {
    // Saving again is harmless: Saved for later skips text it already has.
  }
}

/** The open request native code left (raw JSON) and the id of the last one handled. */
export function readCaptureOpenRequest(): { raw: string | null; handledId: string | null } {
  const store = getStorage();
  if (!store) return { raw: null, handledId: null };
  try {
    return {
      raw: store.getString(OPEN_REQUEST_KEY, APP_GROUP) ?? null,
      handledId: store.getString(OPEN_HANDLED_KEY, APP_GROUP) ?? null,
    };
  } catch {
    return { raw: null, handledId: null };
  }
}

export function markCaptureOpenRequestHandled(id: string): void {
  const store = getStorage();
  if (!store) return;
  try {
    store.setString(OPEN_HANDLED_KEY, id, APP_GROUP);
  } catch {
    // It's ignored anyway once it's older than a minute.
  }
}

/** Test-only: forget the cached module. */
export function __resetCaptureBridgeForTests(): void {
  storage = undefined;
}
