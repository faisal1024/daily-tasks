// Native side of the widget: App Group storage via @bacons/apple-targets.
//
// iOS only. The module is loaded lazily inside a try (like app-review.ts), so
// a binary without it (Expo Go, Android, web, tests) just has no widget.

import { Platform } from "react-native";

import type { WidgetSnapshot } from "./widget-snapshot";

export const APP_GROUP = "group.com.faisalislam.dailytasks";
export const WIDGET_KIND = "DailyTasksWidget";
const SNAPSHOT_KEY = "widget.snapshot";
const TOGGLES_KEY = "widget.toggles";
const PROCESSED_KEY = "widget.processedSeq";

type StorageModule = typeof import("@bacons/apple-targets");
type Storage = InstanceType<StorageModule["ExtensionStorage"]>;

let storage: Storage | null | undefined;
let lastWritten: string | null = null;

function getStorage(): Storage | null {
  if (storage !== undefined) return storage;
  storage = null;
  if (Platform.OS !== "ios") return storage;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExtensionStorage } = require("@bacons/apple-targets") as StorageModule;
    storage = new ExtensionStorage(APP_GROUP);
  } catch {
    storage = null;
  }
  return storage;
}

/** Write today's snapshot and refresh the widget (skipped when unchanged). */
export function writeWidgetSnapshot(snapshot: WidgetSnapshot): void {
  const store = getStorage();
  if (!store) return;
  const raw = JSON.stringify(snapshot);
  if (raw === lastWritten) return;
  try {
    store.set(SNAPSHOT_KEY, raw);
    lastWritten = raw;
    reload();
  } catch {
    // The widget just keeps its previous state.
  }
}

/** The widget's queued toggles (raw JSON) and the last one the app applied. */
export function readWidgetToggles(): { raw: string | null; processedSeq: number } {
  const store = getStorage();
  if (!store) return { raw: null, processedSeq: 0 };
  try {
    const processed = Number(store.get(PROCESSED_KEY) ?? 0);
    return {
      raw: store.get(TOGGLES_KEY),
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
    store.set(PROCESSED_KEY, seq);
  } catch {
    // Re-applying is harmless: toggles carry the wanted state, not a flip.
  }
}

function reload(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ExtensionStorage } = require("@bacons/apple-targets") as StorageModule;
    ExtensionStorage.reloadWidget(WIDGET_KIND);
  } catch {
    // no widget in this binary
  }
}

/** Test-only: forget the cached module and last write. */
export function __resetWidgetBridgeForTests(): void {
  storage = undefined;
  lastWritten = null;
}
