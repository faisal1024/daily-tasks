// The Sunday reset's way in (1.6): the Today card on Sunday evenings, the
// Progress row any day, and the gate that opens the sheet for Plus or the
// paywall (source `sunday_reset`) for a free user, then the sheet once Plus.
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useHour } from "@/hooks/use-hour";
import { usePaywallGate } from "@/hooks/use-paywall-gate";
import { track } from "@/lib/daily-tasks/analytics";
import { usePlus } from "@/lib/daily-tasks/plus-context";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import {
  sundayResetCard,
  sundayResetOf,
  usedBeforeToday,
  weekKey,
  type SundayResetCardKind,
} from "@/lib/daily-tasks/sunday-reset";
import { SundayResetSheet, type SundayResetSource } from "./sunday-reset-sheet";

/**
 * Opens the reset from `source`: the sheet with Plus, otherwise the paywall,
 * and the sheet after it if Plus was bought. Render `sheet` once.
 */
export function useSundayResetGate(source: SundayResetSource) {
  const { hasPlus } = useDailyTasks();
  const [open, setOpen] = useState(false);
  const hasPlusRef = useRef(hasPlus);
  hasPlusRef.current = hasPlus;
  const showPaywall = usePaywallGate<true>(() => {
    // Read as of the paywall closing: bought → straight into the reset.
    if (hasPlusRef.current) setOpen(true);
  });
  const start = () => {
    if (hasPlus) {
      setOpen(true);
      return;
    }
    track("sunday_reset", { step: source === "today" ? "intro" : "card", action: "plus", source });
    showPaywall("sunday_reset", { feature: "sunday_reset", resume: true });
  };
  const sheet = <SundayResetSheet visible={open} onClose={() => setOpen(false)} source={source} />;
  return { start, sheet, open };
}

/**
 * The Today card: Sunday from 5 PM (see sundayResetCard). Plus: "Set up your
 * week" with Start. A free user: the same title with a short Plus intro,
 * shown in one week only. × closes it for the week (and skips that week's
 * notification).
 */
export function SundayResetCard({ firstRunActive }: { firstRunActive: boolean }) {
  const colors = useColors();
  const hour = useHour();
  const { ready, state, today, plusConfirmed, hasPlus, updateSundayReset } = useDailyTasks();
  const { paywallEnabled } = usePlus();
  const gate = useSundayResetGate("today");
  const reset = sundayResetOf(state);
  const kind: SundayResetCardKind | null = ready
    ? sundayResetCard({
        today,
        hour,
        reset,
        plus: plusConfirmed ? "yes" : hasPlus ? "unknown" : "no",
        paywallEnabled,
        usedBefore: usedBeforeToday(state.history, today),
        firstRunActive,
      })
    : null;
  const week = weekKey(today);

  // "shown" once per card and week in this launch; a free user's intro is
  // stamped with its week, so it never comes back in a later one.
  const shownFor = useRef<string | null>(null);
  useEffect(() => {
    if (!kind) return;
    const tag = `${kind}:${week}`;
    if (shownFor.current === tag) return;
    shownFor.current = tag;
    track("sunday_reset", { step: kind === "free" ? "intro" : "card", action: "shown", source: "today" });
    if (kind === "free" && reset.freeIntroWeek !== week) updateSundayReset({ freeIntroWeek: week });
  }, [kind, week, reset.freeIntroWeek, updateSundayReset]);

  return (
    <>
      {kind ? (
        <View
          className="rounded-3xl border p-5 gap-3"
          style={{ borderColor: colors.border, backgroundColor: colors.surface }}
          testID={kind === "free" ? "sunday-reset-intro" : "sunday-reset-card"}
        >
          <View className="flex-row items-start gap-2">
            <Ionicons name="sunny-outline" size={20} color={colors.primary} style={{ marginTop: 2 }} />
            <View className="flex-1 gap-1">
              <Text
                accessibilityRole="header"
                style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontWeight: "700", fontSize: 18 }}
              >
                Set up your week
              </Text>
              <Text className="text-sm" style={{ color: colors.muted }}>
                {kind === "plus"
                  ? "Two minutes: last week's wins, a dump for the week, and Monday's three."
                  : "Plus walks you through it on Sunday evenings: last week's wins, a dump for the week, and Monday's three from your coach. Your three stay free either way."}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                updateSundayReset({ dismissedWeek: week });
                track("sunday_reset", { step: kind === "free" ? "intro" : "card", action: "dismissed", source: "today" });
              }}
              accessibilityRole="button"
              accessibilityLabel="Not this week"
              hitSlop={10}
              testID="sunday-reset-dismiss"
            >
              <Ionicons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>
          <Pressable
            onPress={() => {
              if (kind === "plus") track("sunday_reset", { step: "card", action: "start", source: "today" });
              gate.start();
            }}
            accessibilityRole="button"
            accessibilityHint={kind === "free" ? "Shows Plus plans" : undefined}
            className="self-start rounded-full px-4 py-2"
            style={{ backgroundColor: kind === "plus" ? colors.primary : `${colors.primary}16` }}
            testID="sunday-reset-start"
          >
            <Text style={{ color: kind === "plus" ? colors.onPrimary : colors.primary, fontWeight: "700", fontSize: 15 }}>
              {kind === "plus" ? "Start" : "See Plus"}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {gate.sheet}
    </>
  );
}

/** Progress's row (any day): the reset for the next day, or Plus for a free user. */
export function SundayResetRow() {
  const colors = useColors();
  const { hasPlus } = useDailyTasks();
  const gate = useSundayResetGate("progress");
  return (
    <>
      <Pressable
        onPress={() => {
          if (hasPlus) track("sunday_reset", { step: "card", action: "start", source: "progress" });
          gate.start();
        }}
        accessibilityRole="button"
        accessibilityHint={hasPlus ? "Plans tomorrow's three" : "Shows Plus plans"}
        className="flex-row items-center gap-3 rounded-2xl border p-4"
        style={{ borderColor: colors.border, backgroundColor: colors.surface }}
        testID="sunday-reset-row"
      >
        <Ionicons name="sunny-outline" size={20} color={colors.primary} />
        <View className="flex-1">
          <Text className="text-base text-foreground" style={{ fontWeight: "700" }}>
            Set up your week
          </Text>
          <Text className="text-sm" style={{ color: colors.muted }}>
            Two minutes: your wins, a dump for the week, and tomorrow&apos;s three.
          </Text>
        </View>
        {hasPlus ? (
          <Ionicons name="chevron-forward" size={18} color={colors.muted} />
        ) : (
          <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
            Plus
          </Text>
        )}
      </Pressable>
      {gate.sheet}
    </>
  );
}
