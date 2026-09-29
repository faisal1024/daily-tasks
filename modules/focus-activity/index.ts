// JS side of the local FocusActivity module (see ios/FocusActivityModule.swift):
// the focus session's Live Activity. Returns null when the native module isn't
// in this binary (Android, web, Expo Go, tests), so callers can treat Live
// Activities as absent. lib/daily-tasks/live-activity.ts is the only caller.

import { requireOptionalNativeModule } from "expo";

export interface FocusActivityModule {
  areActivitiesEnabled(): boolean;
  activeSessionIds(): string[];
  /** The session mirror's JSON (widget-bridge's `focus.session` shape). */
  start(json: string): Promise<boolean>;
  update(json: string): Promise<boolean>;
  end(sessionId: string | null, finalStatus: "done" | "stopped" | "break" | null, dismissAfterSeconds: number): Promise<void>;
}

export function loadFocusActivity(): FocusActivityModule | null {
  try {
    return requireOptionalNativeModule<FocusActivityModule>("FocusActivity");
  } catch {
    return null;
  }
}
