// When Today shows a "What's new" sheet (1.4): once, to someone who updated,
// the first time Today is idle. The rule for who is in lib/daily-tasks/whats-new.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDailyTasks } from "@/lib/daily-tasks/store";
import { WHATS_NEW_DELAY_MS, WHATS_NEW_RETRY_MS, whatsNewDecision } from "@/lib/daily-tasks/whats-new";

export function useWhatsNew({
  idle,
  canShowNow,
}: {
  /** Today is in front with nothing on top of it and nobody typing. */
  idle: boolean;
  /** Asked as the delay ends, for what isn't in `idle` (a rating ask just made, a field in use). */
  canShowNow: () => boolean;
}) {
  const { ready, state, markWhatsNewSeen } = useDailyTasks();
  const { hasSeenOnboarding, whatsNewSeen, notifications } = state;
  const decision = useMemo(
    () => whatsNewDecision({ hasSeenOnboarding, whatsNewSeen, notifications }),
    [hasSeenOnboarding, whatsNewSeen, notifications],
  );
  /** The announcement whose sheet is up. */
  const [openId, setOpenId] = useState<string | null>(null);

  // Already using the feature: nothing to introduce, now or later.
  const skip = decision.skip.join(",");
  useEffect(() => {
    if (ready && skip) markWhatsNewSeen(skip.split(","));
  }, [ready, skip, markWhatsNewSeen]);

  const canShowNowRef = useRef(canShowNow);
  canShowNowRef.current = canShowNow;
  const dueId = ready && openId === null ? (decision.show?.id ?? null) : null;
  // Bumped to ask again a little later when the moment wasn't right.
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!idle) setRetry(0);
  }, [idle]);
  useEffect(() => {
    if (!dueId || !idle) return;
    // Anything coming up meanwhile clears this; it starts again at the next idle moment.
    const timer = setTimeout(
      () => {
        if (canShowNowRef.current()) setOpenId(dueId);
        else setRetry((count) => count + 1);
      },
      retry === 0 ? WHATS_NEW_DELAY_MS : WHATS_NEW_RETRY_MS,
    );
    return () => clearTimeout(timer);
  }, [dueId, idle, retry]);

  /** However the sheet closes, it has been seen. */
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const close = useCallback(() => {
    if (openIdRef.current) markWhatsNewSeen([openIdRef.current]);
    setOpenId(null);
  }, [markWhatsNewSeen]);

  return { openId, close };
}
