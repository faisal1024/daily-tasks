// "Today's routines" (1.3) from the store, through the one pure selector
// (todaysRoutinesState), so Today's card and the routines sheet's save note
// can never disagree about whether a routine can be added right now.
import { useEffect, useMemo, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { addDays } from "@/lib/daily-tasks/date";
import { draftToShow, isDayClosed } from "@/lib/daily-tasks/evening";
import { track } from "@/lib/daily-tasks/analytics";
import { allTasksDone, todaysRoutinesState, type RoutineBlock } from "@/lib/daily-tasks/routines";
import { useDailyTasks } from "@/lib/daily-tasks/store";

export function useTodaysRoutines() {
  const { state, today, remainingSlots, completedCount } = useDailyTasks();
  // Last night's draft leads while it shows (the same draft Today shows).
  const draftShowing =
    draftToShow(state.tomorrowDraft, {
      today,
      locked: state.todayLocked,
      taskTexts: state.tasks.map((task) => task.text),
      sourceDay: state.tomorrowDraft ? state.history[addDays(state.tomorrowDraft.forDate, -1)] : null,
    }) !== null;
  const allDone = allTasksDone(completedCount, state.tasks.length);
  const dayClosed = isDayClosed(state.eveningClose, today);
  return useMemo(
    () =>
      todaysRoutinesState({
        routines: state.routines,
        tasks: state.tasks,
        today,
        locked: state.todayLocked,
        remainingSlots,
        allDone,
        draftShowing,
        dayClosed,
      }),
    [state.routines, state.tasks, today, state.todayLocked, remainingSlots, allDone, draftShowing, dayClosed],
  );
}

/** The day "routines_card_shown" was last sent (so a relaunch the same day doesn't resend it). */
export const ROUTINES_CARD_SHOWN_KEY = "daily-tasks/routines-card-shown";

/**
 * "routines_card_shown" once per day, the first time Today's routines card is
 * on screen: how many were due and whether Add was off. Never any text.
 */
export function useRoutinesCardShownEvent(input: {
  show: boolean;
  today: string;
  count: number;
  block: RoutineBlock;
}) {
  const { show, today, count, block } = input;
  // The day already sent (or being checked) in this session.
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (!show || handled.current === today) return;
    handled.current = today;
    void (async () => {
      try {
        if ((await AsyncStorage.getItem(ROUTINES_CARD_SHOWN_KEY)) === today) return;
        await AsyncStorage.setItem(ROUTINES_CARD_SHOWN_KEY, today);
      } catch {
        // Unsaved: at worst it's counted again after a relaunch.
      }
      track("routines_card_shown", { count, blocked: block ?? "none" });
    })();
    // Once per day: the count and block as of the first showing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, today]);
}
