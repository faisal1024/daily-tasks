// Today's spoken (and felt) cues for the focus session (1.3). Today is always
// mounted, so it owns them; the timer itself lives on the task's row.
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

import { announcePolitely } from "@/components/daily-tasks/focus-check-in";
import { checkInTitle, sessionMinutes, type FocusSession } from "@/lib/daily-tasks/focus-session";
import { durationWords } from "@/lib/daily-tasks/focus-timer";

/** A session this new was just started here (not one restored at launch). */
const JUST_STARTED_MS = 5_000;

/**
 * A session's start and end, said out loud (politely) and, at the end, felt
 * (one success haptic). For Today, which is always mounted: once per new
 * session, and once per countdown that ends while the app is open (again
 * after "5 more minutes"); never for one restored at launch. The end is the
 * store's (it marks the session ended right on time).
 */
export function useFocusSessionCues(session: FocusSession | null, ready: boolean): void {
  const lastId = useRef(session?.id ?? null);
  useEffect(() => {
    const id = session?.id ?? null;
    if (id === lastId.current) return;
    lastId.current = id;
    // Until saved state has loaded, whatever arrives is restored, not new.
    if (!ready || !session || session.status !== "running" || Date.now() - session.startedAt > JUST_STARTED_MS) return;
    announcePolitely(
      session.kind === "starter" ? "5-minute starter started" : `Timer started, ${durationWords(sessionMinutes(session))}`,
    );
    // Only for a new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, ready]);

  const status = session?.status ?? null;
  const countdown = session ? `${session.id}|${session.durationMs}` : null;
  const seen = useRef<{ countdown: string | null; status: string | null }>({ countdown, status });
  useEffect(() => {
    const before = seen.current;
    seen.current = { countdown, status };
    // The first loaded session is where "seen" starts: one that ended while
    // the app was closed isn't announced as if it just did.
    if (!ready || !session || status !== "ended" || before.status === "ended") return;
    // Only a countdown seen running (or paused) while the app was open.
    if (before.countdown !== countdown) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    announcePolitely(checkInTitle(session));
    // Only when it ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, countdown, ready]);
}
