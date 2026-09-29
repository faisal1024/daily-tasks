import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { remainingMs, sessionPhase, type FocusSession } from "@/lib/daily-tasks/focus-session";

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

/**
 * Whether the session has reached time's up, stored or not. Unlike
 * useFocusClock it doesn't tick: one timer for the end (and a check when the
 * app comes back), so a screen can switch its way out at zero without
 * re-rendering every second.
 */
export function useSessionEnded(session: FocusSession | null): boolean {
  const [now, setNow] = useState(() => Date.now());
  const endAt = session?.status === "running" ? session.endAt : null;
  useEffect(() => {
    setNow(Date.now());
    if (endAt === null) return;
    const wait = endAt - Date.now();
    const timer = wait > 0 ? setTimeout(() => setNow(Date.now()), wait) : null;
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") setNow(Date.now());
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      sub.remove();
    };
  }, [endAt]);
  return session !== null && sessionPhase(session, now) === "ended";
}
