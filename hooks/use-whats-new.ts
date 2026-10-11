// When Today shows a "What's new" sheet (1.4): once, to someone who updated,
// in the quiet window right after a launch or a return to the foreground.
// If the user does anything first it gives up until the next foreground, so
// it never slides up in the middle of planning. The rule for who sees it is
// in lib/daily-tasks/whats-new.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDailyTasks } from "@/lib/daily-tasks/store";
import {
  WHATS_NEW_DELAY_MS,
  WHATS_NEW_MAX_TRIES,
  WHATS_NEW_RETRY_MS,
  WHATS_NEW_SHOW_TIMEOUT_MS,
  whatsNewDecision,
  type WhatsNewMoment,
} from "@/lib/daily-tasks/whats-new";

export function useWhatsNew({
  active,
  idle,
  pending,
  activity,
  canShowNow,
}: {
  /** The app is in front. Each time this turns true (a launch, a return) is one chance. */
  active: boolean;
  /** Today is in front with nothing on top of it and nobody in the middle of something (`todayIdleForWhatsNew`). */
  idle: boolean;
  /** Something that only needs a moment at launch (Plus still being checked): the wait starts once it clears. */
  pending: boolean;
  /** Changes when a task is added, ticked or edited (`whatsNewActivity`). */
  activity: string;
  /** Asked as the delay ends, for what isn't state (`whatsNewMoment`). */
  canShowNow: () => WhatsNewMoment;
}) {
  const { ready, state, markWhatsNewSeen } = useDailyTasks();
  const { hasSeenOnboarding, whatsNewSeen, notifications } = state;
  const decision = useMemo(
    () => whatsNewDecision({ hasSeenOnboarding, whatsNewSeen, notifications }),
    [hasSeenOnboarding, whatsNewSeen, notifications],
  );
  /** The announcement whose sheet is up (or was asked to come up). */
  const [openId, setOpenId] = useState<string | null>(null);

  // Already using the feature: nothing to introduce, now or later.
  const skip = decision.skip.join(",");
  useEffect(() => {
    if (ready && skip) markWhatsNewSeen(skip.split(","));
  }, [ready, skip, markWhatsNewSeen]);

  const canShowNowRef = useRef(canShowNow);
  canShowNowRef.current = canShowNow;
  /** One foreground session: from a launch or a return to the foreground until the app leaves it. */
  const live = ready && active;
  const dueId = live && openId === null ? (decision.show?.id ?? null) : null;
  /** This foreground session's chance is used up: the user did something, or the sheet was closed. */
  const [spent, setSpent] = useState(false);
  // Bumped to ask again a little later (a launch-time blocker, or iOS dropped the sheet).
  const [retry, setRetry] = useState(0);
  const dropped = useRef(0);
  useEffect(() => {
    if (live) return;
    // The next foreground is a new chance.
    setSpent(false);
    setRetry(0);
    dropped.current = 0;
  }, [live]);

  // The user got there first: something came up, or they started typing or dragging.
  useEffect(() => {
    if (dueId && !idle) setSpent(true);
  }, [dueId, idle]);
  // Or a task was added, ticked or edited.
  const lastActivity = useRef<string | null>(null);
  useEffect(() => {
    const before = lastActivity.current;
    lastActivity.current = live ? activity : null;
    if (live && before !== null && before !== activity) setSpent(true);
  }, [live, activity]);

  const shownRef = useRef(false);
  const waitingId = !spent && idle && !pending ? dueId : null;
  useEffect(() => {
    if (!waitingId) return;
    const timer = setTimeout(
      () => {
        const moment = canShowNowRef.current();
        if (moment === "yes") {
          shownRef.current = false;
          setOpenId(waitingId);
        } else if (moment === "later") setRetry((count) => count + 1);
        else setSpent(true);
      },
      retry === 0 ? WHATS_NEW_DELAY_MS : WHATS_NEW_RETRY_MS,
    );
    return () => clearTimeout(timer);
  }, [waitingId, retry]);

  // iOS drops a sheet presented while something else is presenting (a menu,
  // an alert, another sheet still closing) and says nothing. Not on screen in
  // time: take it back, not seen, and ask again a little later.
  useEffect(() => {
    if (!openId) return;
    const timer = setTimeout(() => {
      if (shownRef.current) return;
      dropped.current += 1;
      setOpenId(null);
      if (dropped.current >= WHATS_NEW_MAX_TRIES) setSpent(true);
      else setRetry((count) => count + 1);
    }, WHATS_NEW_SHOW_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [openId]);
  /** The sheet is on screen (its `onShow`). */
  const shown = useCallback(() => {
    shownRef.current = true;
  }, []);

  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  /** The user closed it, whichever way: it has been seen. */
  const close = useCallback(() => {
    if (openIdRef.current) markWhatsNewSeen([openIdRef.current]);
    setOpenId(null);
    setSpent(true);
  }, [markWhatsNewSeen]);
  /** Something else needs the screen (a focus prompt): it goes, not seen, until the next foreground. */
  const postpone = useCallback(() => {
    setOpenId(null);
    setSpent(true);
  }, []);

  return { openId, close, postpone, shown };
}
