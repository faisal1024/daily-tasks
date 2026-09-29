import { useEffect, useState } from "react";
import { AppState as RNAppState } from "react-native";

/**
 * The app is on screen. A Live Activity button or Siri can launch the app in
 * the background (1.3): then nothing user-facing may happen (no navigation,
 * no celebration, no "app_opened") until the user actually opens it.
 */
export function isAppActive(): boolean {
  const state: unknown = RNAppState.currentState;
  // A normal launch starts "inactive" (then "active"); only "background" is a
  // background launch.
  return state !== "background";
}

/** isAppActive, kept fresh. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(isAppActive);
  useEffect(() => {
    const sub = RNAppState.addEventListener("change", (status) => {
      if (status === "active") setActive(true);
      else if (status === "background") setActive(false);
    });
    return () => sub.remove();
  }, []);
  return active;
}
