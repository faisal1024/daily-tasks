// "Meet Nag mode" wired to the store, the paywall and the turn-on flow, so
// Today (the one-time "What's new") and Settings › Reminders ("What is Nag
// mode?") open the same thing.
import { useEffect, useRef } from "react";

import { NagIntroSheet } from "@/components/daily-tasks/nag-intro-sheet";
import { useNagTurnOn, type NagChoice } from "@/hooks/use-nag-turn-on";
import { track } from "@/lib/daily-tasks/analytics";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import { NAG_ANNOUNCEMENT_ID } from "@/lib/daily-tasks/whats-new";

export function NagIntro({
  visible,
  source,
  onClose,
  onTurnedOn,
  onShow,
  id = NAG_ANNOUNCEMENT_ID,
}: {
  visible: boolean;
  /**
   * Where it was opened: on its own on Today, from the row in Settings, or
   * from a new install's Nag card on Today (1.5 D), or from 1.6's What's
   * new ("Try Nag mode").
   */
  source: "today" | "settings" | "card" | "whats_new";
  /**
   * The id in its events: the 1.4 announcement, the first days' id for a new
   * install, or 1.6's What's new ("Try Nag mode").
   */
  id?: string;
  /**
   * Close the sheet (Today marks the announcement seen here). `next`
   * "paywall": it is closing so the paywall can come up.
   */
  onClose: (next?: "paywall") => void;
  /** Nag mode was turned on from here, now or after the paywall. */
  onTurnedOn?: () => void;
  /** The sheet is on screen. */
  onShow?: () => void;
}) {
  const { state, hasPlus } = useDailyTasks();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const { requestNag } = useNagTurnOn({
    onTurnedOn: () => {
      // With Plus the question is asked over the sheet: it closes once Nag is on.
      if (visibleRef.current) onCloseRef.current();
      onTurnedOn?.();
    },
  });

  // Ids only, never a line or a task.
  useEffect(() => {
    if (visible) track("whats_new_shown", { id, source });
  }, [visible, source, id]);

  const act = (action: "try" | "dismiss", choice: NagChoice) =>
    track("whats_new_action", { id, action, persona: choice.persona, level: choice.level, source });

  // The preview may name the next open task, on the phone only; not with names hidden.
  const taskText = state.notifications.hideTaskNames
    ? null
    : (state.tasks.find((task) => !state.todayCompletions.includes(task.id))?.text ?? null);

  return (
    <NagIntroSheet
      visible={visible}
      hasPlus={hasPlus}
      initial={{ persona: state.notifications.nagPersona, level: state.notifications.nagLevel }}
      taskText={taskText}
      onShow={onShow}
      onTry={(choice) => {
        act("try", choice);
        if (hasPlus) {
          // Stays up under the permission request and the question; "Turn on" closes it.
          requestNag({ choice });
          return;
        }
        // One modal at a time: the sheet goes, then the paywall comes up. If
        // Plus is bought there, the question follows.
        onClose("paywall");
        requestNag({ choice, afterSheet: true });
      }}
      onDismiss={(choice) => {
        act("dismiss", choice);
        onClose();
      }}
    />
  );
}
