// JS side of the local WidgetStorage module (see ios/WidgetStorageModule.swift).
// Returns null when the native module isn't in this binary (Android, web,
// Expo Go, tests), so callers can treat the widget as absent.

import { requireOptionalNativeModule } from "expo";

export interface WidgetStorageModule {
  setString(key: string, value: string, group: string): void;
  getString(key: string, group: string): string | null;
  setInt(key: string, value: number, group: string): void;
  getInt(key: string, group: string): number;
  reloadWidget(kind: string): void;
  /** The capture inbox's files (1.6 E), each `{name, contents}`. Missing in builds before 1.6. */
  listInboxFiles?(group: string, folder: string): { name: string; contents: string }[];
  /** Deletes one capture file; true when it's gone (or was never there). */
  deleteInboxFile?(group: string, folder: string, name: string): boolean;
}

export function loadWidgetStorage(): WidgetStorageModule | null {
  try {
    return requireOptionalNativeModule<WidgetStorageModule>("WidgetStorage");
  } catch {
    return null;
  }
}
