// App Group side of capture from anywhere (1.6 E; see capture.ts). Same
// WidgetStorage module as the widget (widget-bridge.ts); a no-op without it
// (Android, web, Expo Go, tests, or a binary from before 1.6).
//
// The capture inbox is one JSON file per capture in the App Group's
// `capture-inbox/` folder (targets/share/CaptureInbox.swift). Native code
// (the share extension, the "Save for later" shortcut) only adds files; the
// app only reads them and deletes each one once it's saved for good. Native
// code (the "Brain dump" shortcut, the Dump control) writes
// `capture.openRequest`; the app writes `capture.openHandled`. So the two
// sides never overwrite each other's data.

import { Platform } from "react-native";

import { loadWidgetStorage, type WidgetStorageModule } from "@/modules/widget-storage";

import type { CaptureFile } from "./capture";
import { APP_GROUP } from "./widget-bridge";

export const CAPTURE_INBOX_FOLDER = "capture-inbox";
const OPEN_REQUEST_KEY = "capture.openRequest";
const OPEN_HANDLED_KEY = "capture.openHandled";

let storage: WidgetStorageModule | null | undefined;

function getStorage(): WidgetStorageModule | null {
  if (storage !== undefined) return storage;
  storage = Platform.OS === "ios" ? loadWidgetStorage() : null;
  return storage;
}

/** Every capture file waiting in the inbox (unsorted; see parseCaptureFiles). */
export function readCaptureFiles(): CaptureFile[] {
  const store = getStorage();
  if (!store?.listInboxFiles) return [];
  try {
    const files = store.listInboxFiles(APP_GROUP, CAPTURE_INBOX_FOLDER);
    if (!Array.isArray(files)) return [];
    return files.filter(
      (file): file is CaptureFile =>
        !!file && typeof file.name === "string" && !!file.name && typeof file.contents === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Delete one capture file, once what it held is saved for good. False when
 * it couldn't be deleted (it's read again next time; Saved for later then
 * already has it, so nothing is added twice).
 */
export function deleteCaptureFile(name: string): boolean {
  const store = getStorage();
  if (!store?.deleteInboxFile) return false;
  try {
    return store.deleteInboxFile(APP_GROUP, CAPTURE_INBOX_FOLDER, name) === true;
  } catch {
    return false;
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
