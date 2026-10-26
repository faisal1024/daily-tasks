import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";

import { useColors } from "@/hooks/use-colors";
import { track } from "@/lib/daily-tasks/analytics";
import { SaveLaterHowTo } from "@/components/daily-tasks/save-later-how-to";
import {
  answerNudge,
  CAPTURE_CARD_COPY,
  captureCardShownOn,
  claimShownToday,
  declineNudge,
  dismissWidgetTip,
  finishCaptureCard,
  finishNagIntro,
  loadFirstDays,
  loadShownDays,
  markCaptureCardShown,
  nagIntroDue,
  noteAppForeground,
  noteCheckOff,
  noteFinishedDay,
  openFirstDays,
  saveFirstDays,
  shouldShowCaptureCard,
  shouldShowNagCard,
  shouldShowNudgeCard,
  shouldShowWidgetTip,
  widgetTipCopy,
  type FirstDaysCardKind,
  type FirstDaysRecord,
  type ShownDays,
} from "@/lib/daily-tasks/first-days";
import { NAG_CARD_COPY } from "@/lib/daily-tasks/whats-new";
import type { NotificationPermissionState } from "@/lib/daily-tasks/types";

export interface FirstDaysInput {
  today: string;
  /** Off while first run, the rollover card or a background launch is up: nothing loads or shows. */
  active: boolean;
  /** Bumped when first run writes a fresh record, so it's read again. */
  version: number;
  /** A task is checked off today: the first nudge may come forward to today. */
  checkedOff: boolean;
  /** Every planned task done today (at least one): earns the widget tip for a later launch. */
  dayFinished: boolean;
  permission: NotificationPermissionState | undefined;
  /** "Yes": ask iOS, and turn morning reminders on when allowed. */
  onAskNudge: () => Promise<NotificationPermissionState>;
  /**
   * The app is in front (not a background launch). Each return to the
   * foreground is a new "open": "Meet Nag mode" waits for the open after
   * first run's (1.5 D).
   */
  appActive?: boolean;
  /** Nag mode is already the reminder style: no card, no sheet. */
  nagOn?: boolean;
  /** Something has been checked off, today or on an earlier day: "Meet Nag mode" may come up on its own. */
  tickedEver?: boolean;
  /** The Nag card's button: open "Meet Nag mode". */
  onOpenNag?: () => void;
  /** Something was saved from the share sheet or Siri (1.6): no "Save for later from anywhere" card. */
  capturedEver?: boolean;
}

export interface FirstDaysCardsState {
  showing: FirstDaysCardKind | null;
  asking: boolean;
  yes: () => Promise<void>;
  notNow: () => void;
  dismissTip: () => void;
  /** The Nag card's button: the sheet opens (closing it calls nagIntroSeen). */
  openNag: () => void;
  /** × on the Nag card: neither the card nor the sheet comes back. */
  dismissNag: () => void;
  /** A new install's next open after first run: "Meet Nag mode" may come up on its own, once. */
  nagIntroDue: boolean;
  /** The sheet (on its own or from the card) was closed: seen, so it and the card are done. */
  nagIntroSeen: () => void;
  /** "Show me" on the capture card opened its how-to (1.6). */
  captureHowTo: () => void;
  /** "Got it" on the capture card: it's done. */
  dismissCapture: () => void;
}

/**
 * The state behind the cards that replaced first run's last two screens
 * (1.5; rules in lib/daily-tasks/first-days.ts). A hook, so Today can keep
 * it above any layout change: moving the cards never reloads the record or
 * re-logs "shown". "Want a nudge in the morning?" from the first check-off
 * (or the next day), never on a finished day; the widget tip from a later
 * launch or day after the first finished day. One card at a time, the nudge
 * first.
 */
export function useFirstDays({
  today,
  active,
  version,
  checkedOff,
  dayFinished,
  permission,
  onAskNudge,
  appActive = true,
  nagOn = false,
  tickedEver = false,
  onOpenNag,
  capturedEver = false,
}: FirstDaysInput): FirstDaysCardsState {
  const [record, setRecord] = useState<FirstDaysRecord | null>(null);
  // The latest record, for answers that land after an await (the permission prompt).
  const recordRef = useRef<FirstDaysRecord | null>(null);
  recordRef.current = record;
  const [asking, setAsking] = useState(false);
  // A ref too: two taps in one frame both see `asking` false (state lags a render).
  const askingRef = useRef(false);

  // A return to the foreground is a new open. Declared before the load below,
  // so the open is counted before the record is read again.
  const wasAppActive = useRef(appActive);
  useEffect(() => {
    if (appActive && !wasAppActive.current) noteAppForeground();
    wasAppActive.current = appActive;
  }, [appActive]);

  // The day each card last showed (1.6): the capture card never shares a day
  // with another. Null until read: no capture card before then.
  const [shownDays, setShownDays] = useState<ShownDays | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void loadShownDays().then((days) => {
      if (!cancelled) setShownDays((current) => ({ ...days, ...current }));
    });
    void loadFirstDays().then((loaded) => {
      if (cancelled) return;
      // An earned tip is due only on a later launch or day (never this session).
      const opened = loaded ? openFirstDays(loaded, { today }) : null;
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

  // The first finished day earns the tip (shown from a later launch or day,
  // never on the finished-day moment); the first check-off brings the nudge
  // to today.
  useEffect(() => {
    if (record && dayFinished) update((current) => noteFinishedDay(current, true, { today }));
    if (record && checkedOff) update((current) => noteCheckOff(current, today, true));
  }, [record, dayFinished, checkedOff, today]);

  // One card at a time: the morning nudge, then the Nag card, then the widget
  // tip, then (1.6) "Save for later from anywhere", which has a day to itself.
  const captureToday = captureCardShownOn(record, today);
  const showNudge = active && !captureToday && shouldShowNudgeCard({ record, today, permission, dayFinished });
  const showNag =
    active && !captureToday && shouldShowNagCard({ record, today, nagOn, nudgeShowing: showNudge, dayFinished });
  const showWidget =
    active &&
    !captureToday &&
    shouldShowWidgetTip({
      record,
      widgetsSupported: Platform.OS === "ios",
      nudgeShowing: showNudge,
      nagShowing: showNag,
    });
  const showCapture =
    active &&
    shownDays !== null &&
    shouldShowCaptureCard({
      record,
      today,
      tickedEver,
      capturedEver,
      otherShowing: showNudge || showNag || showWidget,
      shownToday: shownDays,
    });
  const showing: FirstDaysCardKind | null = !record
    ? null
    : showNudge
      ? "nudge"
      : showNag
        ? "nag"
        : showWidget
          ? "widget"
          : showCapture
            ? "capture"
            : null;

  // The capture card shows once: from its first showing, for that day only.
  useEffect(() => {
    if (showing === "capture" && record?.captureCard === "waiting") {
      update((current) => markCaptureCardShown(current, today));
    }
  }, [showing, record, today]);

  // "shown" once per card per day, deduped in storage (survives remounts and relaunches).
  useEffect(() => {
    if (!showing) return;
    // Known at once in this session too, whatever storage says.
    setShownDays((current) => (current?.[showing] === today ? current : { ...current, [showing]: today }));
    let cancelled = false;
    void claimShownToday(showing, today).then((first) => {
      if (first && !cancelled) track("first_days_card", { kind: showing, action: "shown" });
    });
    return () => {
      cancelled = true;
    };
  }, [showing, today]);

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

  const notNow = () => {
    if (askingRef.current) return;
    update((current) => declineNudge(current, today));
    track("first_days_card", { kind: "nudge", action: "not_now" });
  };

  const dismissTip = () => {
    update(dismissWidgetTip);
    track("first_days_card", { kind: "widget", action: "dismissed" });
  };

  // The sheet opens; it counts as seen when it's closed (nagIntroSeen), so a
  // sheet that had to step aside (a focus prompt) leaves the card in place.
  const openNag = () => {
    track("first_days_card", { kind: "nag", action: "open" });
    onOpenNag?.();
  };

  const dismissNag = () => {
    update(finishNagIntro);
    track("first_days_card", { kind: "nag", action: "dismissed" });
  };

  const nagIntroSeen = () => update(finishNagIntro);

  const captureHowTo = () => track("first_days_card", { kind: "capture", action: "how_to" });
  const dismissCapture = () => {
    update(finishCaptureCard);
    track("first_days_card", { kind: "capture", action: "dismissed" });
  };

  return {
    showing,
    asking,
    yes,
    notNow,
    dismissTip,
    openNag,
    dismissNag,
    nagIntroDue: active && nagIntroDue(record, nagOn, { today, tickedEver }),
    nagIntroSeen,
    captureHowTo,
    dismissCapture,
  };
}

/** The cards with their own state (one place on screen; Today uses the hook + view). */
export function FirstDaysCards(props: FirstDaysInput) {
  return <FirstDaysCardsView cards={useFirstDays(props)} />;
}

/** What useFirstDays says to show. */
export function FirstDaysCardsView({ cards }: { cards: FirstDaysCardsState }) {
  const colors = useColors();
  const { showing, asking, yes, notNow, dismissTip, openNag, dismissNag, captureHowTo, dismissCapture } = cards;
  const [howToOpen, setHowToOpen] = useState(false);
  if (!showing) return null;

  if (showing === "capture") {
    return (
      <Card icon="bookmark-outline" testID="capture-card">
        <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">
          {CAPTURE_CARD_COPY.title}
        </Text>
        <Text className="text-sm text-muted">{CAPTURE_CARD_COPY.body}</Text>
        {howToOpen ? <SaveLaterHowTo testID="capture-card-how-to" /> : null}
        <View className="flex-row flex-wrap items-center gap-x-4 mt-1">
          <Pressable
            onPress={() => {
              if (!howToOpen) captureHowTo();
              setHowToOpen(!howToOpen);
            }}
            accessibilityRole="button"
            accessibilityLabel={CAPTURE_CARD_COPY.showMe}
            accessibilityState={{ expanded: howToOpen }}
            hitSlop={8}
            className="justify-center"
            style={{ minHeight: 44 }}
            testID="capture-card-show-me"
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              {howToOpen ? CAPTURE_CARD_COPY.hide : CAPTURE_CARD_COPY.showMe}
            </Text>
          </Pressable>
          <Pressable
            onPress={dismissCapture}
            accessibilityRole="button"
            accessibilityLabel={CAPTURE_CARD_COPY.gotIt}
            hitSlop={8}
            className="justify-center"
            style={{ minHeight: 44 }}
            testID="capture-card-got-it"
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              {CAPTURE_CARD_COPY.gotIt}
            </Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  if (showing === "nag") {
    return (
      <Card icon="megaphone-outline" testID="nag-card" dismissLabel={NAG_CARD_COPY.dismiss} onDismiss={dismissNag}>
        <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">
          {NAG_CARD_COPY.title}
        </Text>
        <Text className="text-sm text-muted">{NAG_CARD_COPY.body}</Text>
        <Pressable
          onPress={openNag}
          accessibilityRole="button"
          accessibilityLabel={NAG_CARD_COPY.button}
          accessibilityHint="Opens Meet Nag mode"
          hitSlop={8}
          className="self-start justify-center mt-1"
          style={{ minHeight: 44 }}
          testID="nag-card-open"
        >
          <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
            {NAG_CARD_COPY.button}
          </Text>
        </Pressable>
      </Card>
    );
  }

  if (showing === "nudge") {
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
            onPress={notNow}
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

  const tipCopy = widgetTipCopy(Constants.expoConfig?.name ?? "this app");
  return (
    <Card
      icon="apps-outline"
      testID="widget-tip"
      dismissLabel="Dismiss widget tip"
      onDismiss={dismissTip}
    >
      <Text className="text-sm font-semibold text-foreground" accessibilityRole="header">
        {tipCopy.title}
      </Text>
      <Text className="text-sm text-muted">{tipCopy.body}</Text>
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
