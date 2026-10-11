// Turning Nag mode on (1.4), the one way: from Settings › Reminders' style
// choice and from the "Meet Nag mode" sheet. Plus-only and opt-in: a free
// user goes to the paywall first, iOS is asked for notifications if it hasn't
// been, and the first time it asks "Turn on Nag mode?", saying what is sent.
import { useCallback, useRef } from "react";
import { Alert } from "react-native";

import { usePaywallGate } from "@/hooks/use-paywall-gate";
import type { NagLevel, NagPersona } from "@/lib/daily-tasks/nag";
import {
  NAG_CONFIRM_MESSAGE,
  NAG_CONFIRM_TITLE,
  NAG_NO_PERMISSION_MESSAGE,
  NAG_NO_PERMISSION_TITLE,
} from "@/lib/daily-tasks/nag-copy";
import { useDailyTasks } from "@/lib/daily-tasks/store";

/** A voice and level to save as Nag turns on; without one the saved ones stay. */
export interface NagChoice {
  persona: NagPersona;
  level: NagLevel;
}

export interface NagTurnOnOptions {
  /** Nag was turned on just now (the style is saved). */
  onTurnedOn?: () => void;
}

export function useNagTurnOn({ onTurnedOn }: NagTurnOnOptions = {}) {
  const { state, hasPlus, notificationPermission, requestNotificationPermission, setReminderStyle } = useDailyTasks();
  const onTurnedOnRef = useRef(onTurnedOn);
  onTurnedOnRef.current = onTurnedOn;
  const latest = useRef({ hasPlus, notificationPermission, nagConfirmed: state.notifications.nagConfirmed });
  latest.current = { hasPlus, notificationPermission, nagConfirmed: state.notifications.nagConfirmed };

  // One question at a time: a second tap while iOS is being asked for
  // notifications, or while the question is up, does nothing.
  const asking = useRef(false);

  /** With Plus: permission if needed, then the question (asked once), then on. */
  const turnNagOn = useCallback(
    async (choice?: NagChoice) => {
      if (asking.current) return;
      asking.current = true;
      const done = () => {
        asking.current = false;
      };
      const apply = () => {
        done();
        setReminderStyle("nag", choice);
        onTurnedOnRef.current?.();
      };
      try {
        if (latest.current.notificationPermission !== "granted") {
          const status = await requestNotificationPermission();
          if (status !== "granted") {
            done();
            Alert.alert(NAG_NO_PERMISSION_TITLE, NAG_NO_PERMISSION_MESSAGE);
            return;
          }
        }
        // Asked once: after that Nag turns on with one tap.
        if (latest.current.nagConfirmed) {
          apply();
          return;
        }
        Alert.alert(
          NAG_CONFIRM_TITLE,
          NAG_CONFIRM_MESSAGE,
          [
            { text: "Not now", style: "cancel", onPress: done },
            { text: "Turn on", style: "default", onPress: apply },
          ],
          // Android: closed without an answer (it cannot be by default; this is the safety net).
          { onDismiss: done },
        );
      } catch (error) {
        done();
        throw error;
      }
    },
    [requestNotificationPermission, setReminderStyle],
  );

  // Picks up after the paywall (there is still a question to ask), only if
  // Plus was bought there.
  const showPaywall = usePaywallGate<{ choice: NagChoice | null }>((unlock) => {
    if (latest.current.hasPlus) void turnNagOn(unlock.choice ?? undefined);
  });

  /**
   * The user asked for Nag mode. Without Plus: the paywall (source
   * `nag_mode`), and the rest follows if Plus is bought there. `afterSheet`:
   * a sheet is closing first. Returns which way it went.
   */
  const requestNag = useCallback(
    ({ choice, afterSheet }: { choice?: NagChoice; afterSheet?: boolean } = {}): "paywall" | "turn_on" => {
      if (!latest.current.hasPlus) {
        showPaywall("nag_mode", {
          feature: "nag_mode",
          resume: { choice: choice ?? null },
          ...(afterSheet ? { afterSheet: true } : {}),
        });
        return "paywall";
      }
      void turnNagOn(choice);
      return "turn_on";
    },
    [showPaywall, turnNagOn],
  );

  return { requestNag, turnNagOn };
}
