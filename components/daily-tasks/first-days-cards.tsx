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
  noteFinishedDay,
  saveFirstDays,
  shouldShowNudgeCard,
  shouldShowWidgetTip,
  type FirstDaysRecord,
} from "@/lib/daily-tasks/first-days";
import type { NotificationPermissionState } from "@/lib/daily-tasks/types";

interface FirstDaysCardsProps {
  today: string;
  /** Off while first run (or a background launch) is up: nothing loads or shows. */
  active: boolean;
  /** Bumped when first run writes a fresh record, so it's read again. */
  version: number;
  /** All three done today: the widget tip becomes due. */
  dayFinished: boolean;
  permission: NotificationPermissionState | undefined;
  /** "Yes": ask iOS, and turn morning reminders on when allowed. */
  onAskNudge: () => Promise<NotificationPermissionState>;
}

/**
 * The cards that replaced first run's last two screens (1.5; rules in
 * lib/daily-tasks/first-days.ts): "Want a nudge in the morning?" on the first
 * visits, then once, after the first finished day, the widget tip. One card at
 * a time, the nudge first.
 */
export function FirstDaysCards({ today, active, version, dayFinished, permission, onAskNudge }: FirstDaysCardsProps) {
  const colors = useColors();
  const [record, setRecord] = useState<FirstDaysRecord | null>(null);
  // The latest record, for answers that land after an await (the permission prompt).
  const recordRef = useRef<FirstDaysRecord | null>(null);
  recordRef.current = record;
  const [asking, setAsking] = useState(false);
  const shownLogged = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadFirstDays().then((loaded) => {
      if (!cancelled) setRecord(loaded);
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

  // The first finished day: the tip is due from now until it's dismissed.
  useEffect(() => {
    if (record && dayFinished) update((current) => noteFinishedDay(current, true));
  }, [record, dayFinished]);

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
      if (asking) return;
      setAsking(true);
      let status: NotificationPermissionState = "undetermined";
      try {
        status = await onAskNudge();
      } catch {
        // Treated as not allowed; the card still goes (Settings › Reminders has it).
      } finally {
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
          A reminder to pick your three, and a few gentle ones while they&apos;re open. Change them any time in
          Settings.
        </Text>
        <View className="flex-row items-center gap-4 mt-2">
          <Pressable
            onPress={() => void yes()}
            disabled={asking}
            accessibilityRole="button"
            accessibilityLabel={asking ? "Asking…" : "Yes"}
            accessibilityHint="Asks to send notifications, then turns on the morning reminder"
            accessibilityState={{ disabled: asking }}
            className="rounded-full px-5 justify-center"
            style={{ backgroundColor: colors.primary, minHeight: 44 }}
            testID="nudge-card-yes"
          >
            <Text className="text-sm font-semibold" style={{ color: colors.onPrimary }}>
              {asking ? "Asking…" : "Yes"}
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
        Keep tomorrow&apos;s three on your Home Screen
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
