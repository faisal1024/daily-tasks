import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { remainingMs, type FocusSession } from "@/lib/daily-tasks/focus-session";

/**
 * The time for showing a focus session (1.3): ticks each second only while
 * it's running with time left, and catches up when the app comes back from
 * the background. Each timer view owns one, so a tick re-renders only that
 * view, never the whole of Today.
 */
export function useFocusClock(session: FocusSession | null): number {
  const [now, setNow] = useState(() => Date.now());
  const endAt = session?.status === "running" ? session.endAt : null;
  const live = session !== null && endAt !== null && remainingMs(session, now) > 0;
  useEffect(() => {
    // A new run (start, resume, extend) reads the clock at once.
    setNow(Date.now());
    if (!live) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") setNow(Date.now());
    });
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, [live, endAt]);
  return now;
}
