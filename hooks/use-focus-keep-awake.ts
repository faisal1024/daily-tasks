import { useEffect } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { useAppActive } from "@/hooks/use-app-active";

/** The focus screen's keep-awake tag (only this screen holds it). */
export const FOCUS_KEEP_AWAKE_TAG = "three-today:focus";

/**
 * Keeps the screen on while `on` and the app is on screen (1.3 polish: the
 * focus screen with a running timer). Released as soon as either goes (a
 * pause, time's up, the session ending, the app going to the background) and
 * when the caller unmounts (the focus screen closing). Best-effort: without
 * the native module (web, tests) nothing happens.
 */
export function useFocusKeepAwake(on: boolean): void {
  const active = useAppActive();
  const keep = on && active;
  useEffect(() => {
    if (!keep) return;
    activateKeepAwakeAsync(FOCUS_KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      try {
        deactivateKeepAwake(FOCUS_KEEP_AWAKE_TAG).catch(() => {});
      } catch {
        // Not available: nothing was held.
      }
    };
  }, [keep]);
}
