import { useEffect, useState } from "react";
import { AppState as RNAppState, type AppStateStatus } from "react-native";

/** Milliseconds from `now` to the top of the next hour. */
function msToNextHour(now: Date): number {
  const next = new Date(now);
  next.setHours(now.getHours() + 1, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/**
 * The current local hour (0–23), kept fresh while the app is open: it
 * re-renders at the top of each hour and when the app becomes active again
 * (timers don't run while it's in the background).
 */
export function useHour(): number {
  const [hour, setHour] = useState(() => new Date().getHours());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      const now = new Date();
      setHour(now.getHours());
      // A little past the hour, so a timer that fires early still sees the new one.
      timer = setTimeout(refresh, msToNextHour(now) + 250);
    };
    refresh();
    const onChange = (status: AppStateStatus) => {
      if (status === "active") refresh();
    };
    const sub = RNAppState.addEventListener("change", onChange);
    return () => {
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return hour;
}
