import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";

import { useColors } from "@/hooks/use-colors";
import { track } from "@/lib/daily-tasks/analytics";
import {
  answerNudge,
  declineNudge,
  dismissWidgetTip,
  loadFirstDays,
  noteCheckOff,
  noteFinishedDay,
  openFirstDays,
  saveFirstDays,
  shouldShowNudgeCard,
  shouldShowWidgetTip,
  type FirstDaysRecord,
} from "@/lib/daily-tasks/first-days";
import type { NotificationPermissionState } from "@/lib/daily-tasks/types";

interface FirstDaysCardsProps {
  today: string;
  /** Off while first run, the rollover card or a background launch is up: nothing loads or shows. */
  active: boolean;
  /** Bumped when first run writes a fresh record, so it's read again. */
  version: number;
  /** A task is checked off today: the first nudge may come forward to today. */
  checkedOff: boolean;
  /** Every planned task done today (at least one): earns the widget tip for the next open. */
  dayFinished: boolean;
  permission: NotificationPermissionState | undefined;
  /** "Yes": ask iOS, and turn morning reminders on when allowed. */
  onAskNudge: () => Promise<NotificationPermissionState>;
}

/**
 * The cards that replaced first run's last two screens (1.5; rules in
 * lib/daily-tasks/first-days.ts): "Want a nudge in the morning?" from the
 * first check-off (or the next day), then, from the app open after the first
 * finished day, the widget tip. One card at a time, the nudge first.
 */
export function FirstDaysCards({
  today,
  active,
  version,
  checkedOff,
  dayFinished,
  permission,
  onAskNudge,
}: FirstDaysCardsProps) {
  const colors = useColors();
  const [record, setRecord] = useState<FirstDaysRecord | null>(null);
  // The latest record, for answers that land after an await (the permission prompt).
  const recordRef = useRef<FirstDaysRecord | null>(null);
  recordRef.current = record;
  const [asking, setAsking] = useState(false);
  // A ref too: two taps in one frame both see `asking` false (state lags a render).
  const askingRef = useRef(false);
  const shownLogged = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadFirstDays().then((loaded) => {
      if (cancelled) return;
      // A load is a new app open or a new day: an earned widget tip is due now.
      const opened = loaded ? openFirstDays(loaded) : null;
      recordRef.current = opened;
      setRecord(opened);
      if (opened && opened !== loaded) void saveFirstDays(opened);
    });
    return () => {
      cancelled = true;
    };
  }, [active, today, version]);

  /** Change the latest record (never a stale copy) and save it. */
  const update = (change: (current: FirstDaysRecord) => FirstDaysRecord) => {
    const current = recordRef.current;
    if (!current) return;
    const next = change(current);
    if (next === current) return;
    recordRef.current = next;
    setRecord(next);
    void saveFirstDays(next);
  };

  // The first finished day earns the tip (shown from the next open, never on
  // the finished-day moment); the first check-off brings the nudge to today.
  useEffect(() => {
    if (record && dayFinished) update((current) => noteFinishedDay(current, true));
    if (record && checkedOff) update((current) => noteCheckOff(current, today, true));
  }, [record, dayFinished, checkedOff, today]);

  const showNudge = active && shouldShowNudgeCard({ record, today, permission });
  const showWidget =
    active && shouldShowWidgetTip({ record, widgetsSupported: Platform.OS === "ios", nudgeShowing: showNudge });
  const showing = showNudge ? "nudge" : showWidget ? "widget" : null;

  // card_shown once per card per day while the app runs (it can stay up across opens).
  useEffect(() => {
    if (!showing) return;
    const key = `${showing}:${today}`;
    if (shownLogged.current.has(key)) return;
    shownLogged.current.add(key);
    track("first_days_card", { kind: showing, action: "shown" });
  }, [showing, today]);

  if (!record || !showing) return null;

  if (showing === "nudge") {
    const yes = async () => {
      if (askingRef.current) return;
      askingRef.current = true;
      setAsking(true);
      let status: NotificationPermissionState = "undetermined";
      try {
        status = await onAskNudge();
      } catch {
        // Treated as not allowed; the card still goes (Settings › Reminders has it).
      } finally {
        askingRef.current = false;
        setAsking(false);
      }
      update(answerNudge);
      track("first_days_card", { kind: "nudge", action: "yes", outcome: status });
    };
    return (
      <Card icon="notifications-outline" testID="nudge-card">
        <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">
          Want a nudge in the morning?
        </Text>
        <Text className="text-sm text-muted">
          A reminder each morning to pick your three, and a few gentle nudges during the day and evening while
          tasks are open. Change anytime in Settings.
        </Text>
        <View className="flex-row items-center gap-4 mt-2">
          <Pressable
            onPress={() => void yes()}
            disabled={asking}
            accessibilityRole="button"
            accessibilityLabel={asking ? "Asking…" : "Yes, remind me"}
            accessibilityHint="Asks to send notifications, then turns on reminders"
            accessibilityState={{ disabled: asking }}
            className="rounded-full px-5 justify-center"
            style={{ backgroundColor: colors.primary, minHeight: 44 }}
            testID="nudge-card-yes"
          >
            <Text className="text-sm font-semibold" style={{ color: colors.onPrimary }}>
              {asking ? "Asking…" : "Yes, remind me"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => {
              update((current) => declineNudge(current, today));
              track("first_days_card", { kind: "nudge", action: "not_now" });
            }}
            disabled={asking}
            accessibilityRole="button"
            accessibilityLabel="Not now"
            hitSlop={8}
            className="justify-center"
            style={{ minHeight: 44 }}
            testID="nudge-card-not-now"
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Not now
            </Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  const appName = Constants.expoConfig?.name ?? "this app";
  return (
    <Card
      icon="apps-outline"
      testID="widget-tip"
      dismissLabel="Dismiss widget tip"
      onDismiss={() => {
        update(dismissWidgetTip);
        track("first_days_card", { kind: "widget", action: "dismissed" });
      }}
    >
      <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">
        Keep your three on your Home Screen
      </Text>
      <Text className="text-sm text-muted">
        Touch and hold an empty spot on your Home Screen, tap Edit, then Add Widget, and search for {appName}.
      </Text>
    </Card>
  );
}

function Card({
  icon,
  testID,
  onDismiss,
  dismissLabel = "Dismiss",
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  testID: string;
  onDismiss?: () => void;
  dismissLabel?: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View className="bg-surface rounded-2xl p-4 border" style={{ borderColor: colors.border }} testID={testID}>
      <View className="flex-row items-start gap-3">
        <Ionicons name={icon} size={20} color={colors.primary} />
        <View className="flex-1 gap-1">{children}</View>
        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel={dismissLabel}
            // A full 44 pt target, pulled into the card's corner padding.
            className="items-center justify-center"
            style={{ width: 44, height: 44, marginTop: -12, marginRight: -12 }}
            testID={`${testID}-dismiss`}
          >
            <Ionicons name="close" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
