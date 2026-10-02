// The routines sheet wired to the store and the paywall (1.3), so Settings
// and Today (its routines card's Edit, and the Ideas sheet) open the same thing. At the free limit
// "Add a routine" closes the sheet and opens the paywall; once that closes,
// the sheet comes back: straight into "New routine" after a purchase,
// otherwise the list the user was on.
import { useMemo, useState } from "react";

import { RoutinesSheet } from "@/components/daily-tasks/routines-sheet";
import { usePaywallGate } from "@/hooks/use-paywall-gate";
import { track } from "@/lib/daily-tasks/analytics";
import { FREE_ROUTINE_LIMIT, routineBlock, routinesDueToday } from "@/lib/daily-tasks/routines";
import { useDailyTasks } from "@/lib/daily-tasks/store";

export function RoutinesManager({
  visible,
  onVisibleChange,
}: {
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}) {
  const {
    state,
    hasPlus,
    addRoutine,
    canAddRoutine,
    updateRoutine,
    setRoutinePaused,
    removeRoutine,
    today,
    remainingSlots,
  } = useDailyTasks();
  // For the line after a save: is it due today, and could it be added now?
  const dueTodayIds = useMemo(
    () => routinesDueToday(state.routines, state.tasks, today).map((routine) => routine.id),
    [state.routines, state.tasks, today],
  );
  const canAddToToday = routineBlock({ locked: state.todayLocked, remainingSlots }) === null;
  const [startNew, setStartNew] = useState(false);
  const showPaywall = usePaywallGate<"routines">(() => {
    // Plus as of now: bought means straight into a new routine.
    setStartNew(hasPlus);
    onVisibleChange(true);
  });

  const handleLimit = () => {
    // Only a free user is sent to Plus (Plus stops at MAX_ROUTINES, quietly).
    if (hasPlus) return;
    track("routine_limit_hit", { count: state.routines.length });
    setStartNew(false);
    onVisibleChange(false);
    showPaywall("routines", { feature: "routines", afterSheet: true, resume: "routines" });
  };

  return (
    <RoutinesSheet
      visible={visible}
      routines={state.routines}
      canAdd={canAddRoutine}
      atFreeLimit={!hasPlus && state.routines.length >= FREE_ROUTINE_LIMIT}
      startInEditor={startNew && canAddRoutine}
      onAdd={addRoutine}
      onLimit={handleLimit}
      onUpdate={updateRoutine}
      onSetPaused={setRoutinePaused}
      onRemove={removeRoutine}
      dueTodayIds={dueTodayIds}
      canAddToToday={canAddToToday}
      onClose={() => {
        setStartNew(false);
        onVisibleChange(false);
      }}
    />
  );
}
