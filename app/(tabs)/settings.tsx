import {
  AccessibilityInfo,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useReducedMotion } from "react-native-reanimated";

import { ScreenContainer } from "@/components/screen-container";
import { ChoiceChips } from "@/components/daily-tasks/choice-chips";
import { CoachMemorySection } from "@/components/daily-tasks/coach-memory-section";
import { NagIntro } from "@/components/daily-tasks/nag-intro";
import { NagOwnLines } from "@/components/daily-tasks/nag-own-lines";
import { OnboardingModal } from "@/components/daily-tasks/onboarding-modal";
import { RoutinesManager } from "@/components/daily-tasks/routines-manager";
import { SectionLabel } from "@/components/daily-tasks/section-label";
import { TimePickerRow } from "@/components/daily-tasks/time-picker-row";
import { useColors } from "@/hooks/use-colors";
import { useNagTurnOn } from "@/hooks/use-nag-turn-on";
import { SHEET_SWAP_DELAY_MS, usePaywallGate } from "@/hooks/use-paywall-gate";
import { Fonts } from "@/constants/theme";
import { getCurrentVersion } from "@/lib/daily-tasks/app-update";
import { requestAgendaAccess } from "@/lib/daily-tasks/agenda";
import { aiFailureMessage } from "@/lib/daily-tasks/ai-status";
import { getPostHogKey, track } from "@/lib/daily-tasks/analytics";
import { formatTime } from "@/lib/daily-tasks/date";
import {
  FEEDBACK_URL,
  MANAGE_SUBSCRIPTIONS_URL,
  PRIVACY_URL,
  SUPPORT_URL,
  WRITE_REVIEW_URL,
  WRITE_REVIEW_WEB_URL,
} from "@/lib/daily-tasks/links";
import {
  builtInNagLines,
  MAX_NAG_COUNT,
  NAG_LEVEL_LABELS,
  NAG_LEVELS,
  NAG_PERSONA_LABELS,
  NAG_PERSONAS,
} from "@/lib/daily-tasks/nag";
import { NAG_LEVEL_COUNT_NOTE, nagLevelRudeNote } from "@/lib/daily-tasks/nag-copy";
import { loadFirstDays } from "@/lib/daily-tasks/first-days";
import { sundayResetOf } from "@/lib/daily-tasks/sunday-reset";
import {
  subscribeSettingsFocus,
  takeSettingsFocus,
  type SettingsFocusTarget,
} from "@/lib/daily-tasks/settings-focus";
import { NAG_ANNOUNCEMENT_ID, NAG_FIRST_DAYS_ID, NAG_INTRO_SETTINGS_ROW } from "@/lib/daily-tasks/whats-new";
import { plusStatusLabel } from "@/lib/daily-tasks/plus";
import { usePlus } from "@/lib/daily-tasks/plus-context";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import { clockTimeOf, formatClockTime, unlockConfirmation, UNLOCKED_NOTE } from "@/lib/daily-tasks/today-view";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import type {
  NotificationKey,
  NotificationPermissionState,
  ReminderStyle,
} from "@/lib/daily-tasks/types";


const NOTIFICATION_LABELS: Record<
  NotificationKey,
  { title: string; subtitle: string }
> = {
  morning: {
    title: "Morning reminders",
    subtitle: "A gentle start if today is still blank.",
  },
  progress: {
    title: "Progress reminders",
    subtitle: "Calm nudges while Today's Three are still open.",
  },
  evening: {
    title: "Evening reminders",
    subtitle: "A soft wrap-up when something is still left.",
  },
  hourly: {
    title: "Every hour",
    subtitle: "A nudge each hour (8am–9pm) until Today's Three are done.",
  },
};

/** Under the "Sunday reset" switch (1.6, Plus). */
const SUNDAY_RESET_HELP = "Sunday at 6 PM: two minutes to set up your week.";

/** Under the "Hide task names in notifications" switch (and its VoiceOver hint). */
const HIDE_TASK_NAMES_HELP =
  "Reminders and the timer's alert won't show what your tasks are.";

/** Under the "Reminder style" choice, by what is chosen. */
const REMINDER_STYLE_HELP: Record<ReminderStyle, string> = {
  calm: "Calm nudges at set times that say what's still open.",
  nag: "Reminders in a voice you pick, at random times, at most one an hour.",
};
/** Under the style choice, only while Nag is the style in use (chosen, with Plus) and names are hidden. */
const NAG_HIDDEN_NAMES_NOTE = "With task names hidden, nags won't name your tasks and nothing is sent to our AI service.";
/** One line under the reminder switches while Nag is on (the three it replaces are disabled). */
const NAG_CALM_SWITCHES_NOTE = "Morning reminders still apply. The other calm nudges are paused while Nag is on.";
/** Nag is the style in use but iOS won't deliver anything. */
const NAG_PERMISSION_DENIED_NOTE = "Notifications are off in System Settings, so no nags arrive.";
/** What VoiceOver says of a switch Nag has paused (the visible line is NAG_CALM_SWITCHES_NOTE). */
const NAG_SWITCH_PAUSED_HINT = "Paused while Nag is on.";

/**
 * A reminder switch with its title and help text. To VoiceOver the row is
 * one element, the switch (role, on/off state, the title as its label and
 * the help as its hint); the visible text is hidden from it, so nothing is
 * read twice.
 */
function ReminderSwitchRow({
  title,
  subtitle,
  value,
  onValueChange,
  disabled = false,
  showSubtitle = true,
  mutedColor,
  trackColor,
}: {
  title: string;
  /** The help under the title, and the switch's VoiceOver hint. */
  subtitle: string;
  /** False: the help is only the VoiceOver hint (one shared line on screen says it for several rows). */
  showSubtitle?: boolean;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  mutedColor: string;
  trackColor: string;
}) {
  return (
    <View
      className="bg-surface rounded-2xl p-4 border border-border"
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <View className="flex-row items-center justify-between gap-4">
        <View
          className="flex-1"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text className="text-lg font-bold text-foreground">{title}</Text>
          {showSubtitle ? (
            <Text className="text-sm mt-1" style={{ color: mutedColor }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          accessibilityRole="switch"
          accessibilityLabel={title}
          accessibilityHint={subtitle}
          accessibilityState={{ checked: value, disabled }}
          trackColor={{ true: trackColor }}
        />
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const {
    state,
    today,
    notificationPermission,
    setAutoLockEnabled,
    setAutoLockTime,
    unlockToday,
    setNotificationsEnabled,
    setNotificationEnabled,
    setHideTaskNamesInNotifications,
    updateSundayReset,
    setReminderStyle,
    setNagPersona,
    setNagLevel,
    setNagWindowEdge,
    pauseNagToday,
    resumeNag,
    refreshNotificationPermission,
    requestNotificationPermission,
    completeMomentumOnboarding,
    updateMomentumProfile,
    requestMomentumPlan,
    setMomentumSetting,
    setAgendaEnabled,
    resetAll,
    hasPlus,
    setAnalyticsEnabled,
  } = useDailyTasks();
  const plus = usePlus();
  // Turning Nag on (the paywall first without Plus, then the question) is
  // shared with the "Meet Nag mode" sheet. The other gates here have nothing
  // to pick up after the paywall: the toggle or button is right there.
  const { requestNag } = useNagTurnOn();
  const showPaywall = usePaywallGate<never>(() => {});
  const [routinesOpen, setRoutinesOpen] = useState(false);
  const pausedRoutines = state.routines.filter((routine) => routine.paused).length;
  const [restoring, setRestoring] = useState(false);

  // A short visible "Today is unlocked." where the row was (the row itself
  // just disappears), the same quiet note Today uses after an action.
  const [unlockedNote, setUnlockedNote] = useState(false);
  const unlockedNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (unlockedNoteTimer.current) clearTimeout(unlockedNoteTimer.current);
    },
    [],
  );

  // Unlock a locked day. Since 1.5 Today's status line has its own Unlock;
  // this row stays as a second way in. Both ask first, with "Unlock" the
  // clear action and "Keep locked" the cancel; only the words differ for a
  // day locked by hand and one locked automatically.
  const confirmUnlock = () => {
    const copy = unlockConfirmation({
      lockSource: state.todayLockSource,
      // The actual set time when known; the configured time for older saves.
      autoLockTime:
        clockTimeOf(state.todayLockedAt) ?? formatClockTime(state.autoLock.hour, state.autoLock.minute),
    });
    Alert.alert(copy.title, copy.message, [
      { text: copy.keep, style: "cancel" },
      {
        text: copy.unlock,
        style: "default",
        isPreferred: true,
        onPress: () => {
          // False when nothing was unlocked (the alert sat open past midnight
          // and the new day isn't set): nothing to track or say.
          if (!unlockToday()) return;
          track("day_unlocked", { source: "settings" });
          setUnlockedNote(true);
          if (unlockedNoteTimer.current) clearTimeout(unlockedNoteTimer.current);
          unlockedNoteTimer.current = setTimeout(() => setUnlockedNote(false), 4000);
          // The row disappears: tell VoiceOver what happened.
          announcePolitely(UNLOCKED_NOTE);
        },
      },
    ]);
  };

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    const active = await plus.restore();
    setRestoring(false);
    Alert.alert(
      active ? "Plus restored" : active === false ? "Nothing to restore" : "Couldn't restore",
      active
        ? "Welcome back. Every Plus feature is unlocked."
        : active === false
          ? "No Plus purchase was found for this Apple ID."
          : "Check your connection and try again.",
    );
  };
  const [redeeming, setRedeeming] = useState(false);
  const handleRedeem = async () => {
    if (redeeming) return;
    setRedeeming(true);
    const requested = await plus.redeemCode();
    setRedeeming(false);
    if (!requested) Alert.alert("Offer codes aren't available", "Code redemption isn't available right now.");
  };
  const [nameDraft, setNameDraft] = useState(state.momentumProfile.name ?? "");
  const [profileModalVisible, setProfileModalVisible] = useState(false);

  // Keep the inline name field in sync if the profile changes elsewhere (e.g. the
  // Update-profile modal), so a later blur can't silently revert the name.
  const profileName = state.momentumProfile.name ?? "";
  useEffect(() => {
    setNameDraft(profileName);
  }, [profileName]);

  const handleNotificationsEnabled = async (value: boolean) => {
    if (!value) {
      setNotificationsEnabled(false);
      return;
    }

    const status = await requestNotificationPermission();
    if (status !== "granted") {
      Alert.alert(
        "Notifications unavailable",
        "Allow notifications in System Settings to get calm reminders for Today's Three.",
      );
      return;
    }

    setNotificationsEnabled(true);
  };

  // Nag mode (1.4): Plus-only and opt-in. A saved "nag" without Plus shows
  // and behaves as Calm; the choice itself is kept.
  const nagActive = state.notifications.style === "nag" && hasPlus;
  const reminderStyle: ReminderStyle = nagActive ? "nag" : "calm";
  const nagPaused = state.notifications.nagPausedDate === today;

  const chooseReminderStyle = (style: ReminderStyle) => {
    if (style === reminderStyle) return;
    if (style === "calm") {
      setReminderStyle("calm");
      return;
    }
    requestNag();
  };

  // "What is Nag mode?": the "Meet Nag mode" sheet, again.
  const [nagIntroOpen, setNagIntroOpen] = useState(false);
  // A 1.5 D install (its first run wrote the Nag intro's record): its events
  // carry the first days' id, not 1.4's announcement. Read before it opens.
  const [nagIntroFresh, setNagIntroFresh] = useState(false);
  const openNagIntro = () => {
    void loadFirstDays().then((record) => {
      setNagIntroFresh(record?.nagIntro !== undefined);
      setNagIntroOpen(true);
    });
  };
  const nagIntroRow = useRef<View>(null);
  const nagIntroFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (nagIntroFocusTimer.current) clearTimeout(nagIntroFocusTimer.current);
    },
    [],
  );
  // A place to bring into view, asked for by What's new (1.6): "Write your
  // lines" (Nag's own lines) or "See what it remembers" (coach memory). Taken
  // as Settings mounts or while it's up; once laid out, it scrolls there and
  // VoiceOver moves to its header.
  const scrollRef = useRef<ScrollView>(null);
  const ownLinesRef = useRef<View>(null);
  const ownLinesHeaderRef = useRef<Text>(null);
  const coachMemoryRef = useRef<View>(null);
  const coachMemoryHeaderRef = useRef<View>(null);
  const reduceMotion = useReducedMotion();
  const [focusTarget, setFocusTarget] = useState<SettingsFocusTarget | null>(() => takeSettingsFocus());
  useEffect(
    () =>
      subscribeSettingsFocus(() => {
        const target = takeSettingsFocus();
        if (target) setFocusTarget(target);
      }),
    [],
  );
  useEffect(() => {
    if (!focusTarget) return;
    const timer = setTimeout(() => {
      setFocusTarget(null);
      const section = focusTarget === "coach-memory" ? coachMemoryRef.current : ownLinesRef.current;
      const header = focusTarget === "coach-memory" ? coachMemoryHeaderRef.current : ownLinesHeaderRef.current;
      const scroll = scrollRef.current;
      try {
        const inner = scroll?.getInnerViewNode();
        if (section && scroll && inner) {
          section.measureLayout(
            inner,
            (_x, y) => scroll.scrollTo({ y: Math.max(0, y - 16), animated: !reduceMotion }),
            () => {},
          );
        }
      } catch {
        // Not laid out (or no native view, as in tests): Settings stays where it is.
      }
      if (header) AccessibilityInfo.sendAccessibilityEvent(header, "focus");
    }, SHEET_SWAP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focusTarget, reduceMotion]);

  const closeNagIntro = () => {
    setNagIntroOpen(false);
    // VoiceOver goes back to the row that opened it (gone once Nag is on).
    if (nagIntroFocusTimer.current) clearTimeout(nagIntroFocusTimer.current);
    nagIntroFocusTimer.current = setTimeout(() => {
      nagIntroFocusTimer.current = null;
      if (nagIntroRow.current) AccessibilityInfo.sendAccessibilityEvent(nagIntroRow.current, "focus");
    }, SHEET_SWAP_DELAY_MS);
  };

  // A sample of how the chosen voice and level sound: built-in lines, about
  // the next open task unless names are hidden. Nothing is sent for it.
  const [sampleTurn, setSampleTurn] = useState(0);
  const sampleTask = state.notifications.hideTaskNames
    ? null
    : (state.tasks.find((task) => !state.todayCompletions.includes(task.id))?.text ?? null);
  const { nagPersona, nagLevel } = state.notifications;
  const samples = useMemo(
    () =>
      builtInNagLines({
        persona: nagPersona,
        level: nagLevel,
        tasks: sampleTask ? [{ text: sampleTask }] : [],
        count: MAX_NAG_COUNT,
        seed: "sample",
      }).map((line) => line.text),
    [nagPersona, nagLevel, sampleTask],
  );
  const sample = samples.length > 0 ? samples[sampleTurn % samples.length] : "";
  // The window's two pickers sit behind one row, so the card stays short.
  const [nagHoursOpen, setNagHoursOpen] = useState(false);
  const { startMinutes: nagStart, endMinutes: nagEnd } = state.notifications.nagWindow;
  // The device's own 12 or 24 hour format.
  const nagHours = `${formatTime(Math.floor(nagStart / 60), nagStart % 60)} to ${formatTime(Math.floor(nagEnd / 60), nagEnd % 60)}`;

  const handleAgendaEnabled = async (value: boolean) => {
    // Only Plus requests use it: don't ask for access a free user can't use.
    if (value && !hasPlus) {
      showPaywall("calendar", { feature: "calendar" });
      return;
    }
    if (!value) {
      setAgendaEnabled(false);
      track("agenda_toggled", { active: false });
      return;
    }
    const access = await requestAgendaAccess();
    if (access !== "granted") {
      Alert.alert(
        "Calendar access is off",
        "To plan around your day, allow Calendars or Reminders for this app in System Settings.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => void Linking.openSettings().catch(() => {}) },
        ],
      );
      return;
    }
    setAgendaEnabled(true);
    track("agenda_toggled", { active: true });
  };

  const handleReminderEnabled = async (
    key: NotificationKey,
    value: boolean,
  ) => {
    if (
      value &&
      state.notifications.enabled &&
      notificationPermission !== "granted"
    ) {
      const status = await requestNotificationPermission();
      if (status !== "granted") {
        Alert.alert(
          "Notifications unavailable",
          "Allow notifications in System Settings to get calm reminders for Today's Three.",
        );
        return;
      }
    }

    setNotificationEnabled(key, value);
  };

  const openSystemSettings = async () => {
    try {
      await Linking.openSettings();
      await refreshNotificationPermission();
    } catch {
      Alert.alert(
        "Open System Settings",
        "Notifications can be updated from your device settings for Three Today.",
      );
    }
  };

  const openExternal = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert("Couldn't open link", "Please try again later.");
    }
  };

  // The App Store's "Write a Review" page. Nothing is offered in return, and
  // there's no "do you like it?" step first (guideline 5.6.1).
  const openWriteReview = async () => {
    track("rate_row_tapped");
    // Straight to openURL: canOpenURL would need itms-apps declared in
    // LSApplicationQueriesSchemes. openURL rejects when it can't open.
    try {
      await Linking.openURL(WRITE_REVIEW_URL);
    } catch {
      await openExternal(WRITE_REVIEW_WEB_URL);
    }
  };

  const openFeedback = () => {
    track("feedback_row_tapped");
    void openExternal(FEEDBACK_URL);
  };

  const handleReset = () => {
    Alert.alert(
      "Reset everything?",
      "This deletes Today's Three, history, and settings. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            void resetAll();
          },
        },
      ],
    );
  };

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <ScrollView
        ref={scrollRef}
        // Readable width on iPad.
        contentContainerStyle={{
          padding: 24,
          paddingBottom: 48,
          gap: 28,
          width: "100%",
          maxWidth: 720,
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View className="gap-1">
          <Text className="text-lg font-medium text-muted">Settings</Text>
          <Text
            className="text-foreground"
            style={{ fontFamily: Fonts.rounded, fontWeight: "800", fontSize: 34 }}
          >
            Tune your day
          </Text>
        </View>

        {/* Only while today is locked. First on the screen, so it's found
            without scrolling (Today's status line has an Unlock too, 1.5). */}
        {state.todayLocked ? (
          <Pressable
            onPress={confirmUnlock}
            accessibilityRole="button"
            accessibilityLabel="Unlock today"
            accessibilityHint="Asks first, then lets you change today's three"
            className="bg-surface rounded-2xl p-4 border border-border flex-row items-center gap-3"
            style={{ minHeight: 44 }}
            testID="settings-unlock-today"
          >
            <Ionicons name="lock-open-outline" size={20} color={colors.muted} />
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">Unlock today</Text>
              <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                Today is locked. Unlock it to change your three.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        ) : unlockedNote ? (
          <View
            className="flex-row items-center gap-2 rounded-2xl p-3"
            style={{ backgroundColor: `${colors.success}18` }}
            accessibilityLiveRegion="polite"
            testID="settings-unlocked-note"
          >
            <Ionicons name="checkmark-circle" size={18} color={colors.success} />
            <Text className="flex-1 text-sm text-foreground">{UNLOCKED_NOTE}</Text>
          </View>
        ) : null}

        {plus.paywallEnabled && (
          <Section icon="sparkles-outline" title="Plus">
            <View className="bg-surface rounded-2xl p-4 border border-border gap-3" testID="settings-plus">
              <Text className="text-sm" style={{ color: colors.muted }}>
                {plusStatusLabel({
                  paywallEnabled: plus.paywallEnabled,
                  grandfathered: state.plusGrandfathered,
                  entitlementActive: plus.entitlementActive,
                })}
              </Text>
              {!hasPlus && (
                <Pressable
                  onPress={() => plus.openPaywall("settings")}
                  accessibilityRole="button"
                  className="rounded-2xl py-3 items-center"
                  style={{ backgroundColor: colors.primary }}
                >
                  <Text className="text-base font-semibold" style={{ color: colors.onPrimary }}>
                    See Plus plans
                  </Text>
                </Pressable>
              )}
              <View className="flex-row gap-5">
                <Pressable
                  onPress={() => void handleRestore()}
                  disabled={restoring}
                  accessibilityRole="button"
                  accessibilityLabel="Restore purchases"
                  accessibilityState={{ busy: restoring, disabled: restoring }}
                  hitSlop={8}
                >
                  <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                    {restoring ? "Restoring…" : "Restore purchases"}
                  </Text>
                </Pressable>
                {/* Apple offer codes are iOS only. */}
                {!hasPlus && Platform.OS === "ios" && (
                  <Pressable
                    onPress={() => void handleRedeem()}
                    disabled={redeeming}
                    accessibilityRole="button"
                    accessibilityLabel="Redeem offer code"
                    accessibilityState={{ disabled: redeeming }}
                    accessibilityHint="Opens Apple's sheet for entering an offer code"
                    hitSlop={8}
                  >
                    <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                      Redeem offer code
                    </Text>
                  </Pressable>
                )}
                {plus.entitlementActive && (
                  <Pressable
                    onPress={() => void openExternal(MANAGE_SUBSCRIPTIONS_URL)}
                    accessibilityRole="link"
                    hitSlop={8}
                  >
                    <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                      Manage subscription
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </Section>
        )}

        <Section
          icon="flag-outline"
          title="Your coach"
          subtitle="Personalize your accountability coach without adding a backlog."
        >
          <View className="bg-surface rounded-2xl p-4 border border-border gap-3">
            <View className="gap-2">
              <Text className="text-base font-semibold text-foreground">
                Your name
              </Text>
              <TextInput
                value={nameDraft}
                onChangeText={setNameDraft}
                onBlur={() => {
                  const next = nameDraft.trim();
                  if ((state.momentumProfile.name ?? "") !== next) {
                    updateMomentumProfile({
                      ...state.momentumProfile,
                      name: next ? next : null,
                    });
                  }
                }}
                placeholder="Add your name"
                placeholderTextColor={colors.muted}
                autoCapitalize="words"
                returnKeyType="done"
                maxLength={40}
                className="text-base text-foreground rounded-xl px-3 py-2.5"
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                }}
              />
            </View>
            <View className="gap-1">
              <Text className="text-base font-semibold text-foreground">
                {state.momentumProfile.goalTitle ?? "No goal selected"}
              </Text>
              <Text className="text-xs" style={{ color: colors.muted }}>
                {momentumSummary(state.momentumProfile)}
              </Text>
            </View>
            <Pressable
              onPress={() => setProfileModalVisible(true)}
              className="self-start rounded-full px-4 py-2"
              style={{ backgroundColor: `${colors.primary}16` }}
              accessibilityRole="button"
              accessibilityLabel="Update your profile"
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.primary }}
              >
                Update profile
              </Text>
            </Pressable>
          </View>
        </Section>

        <View ref={coachMemoryRef} collapsable={false}>
          <CoachMemorySection headerRef={coachMemoryHeaderRef} />
        </View>

        <Section
          icon="options-outline"
          title="AI adaptation"
          subtitle="How your coach tunes tomorrow based on today's follow-through. AI features send what they need (like your goal, recent task titles or a brain dump) to our AI service to create suggestions. Our server doesn't keep it, and it's never used for ads. Details are in the privacy policy."
        >
          <View className="bg-surface rounded-2xl p-4 border border-border gap-4">
            <View className="flex-row items-center justify-between gap-4">
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Adapt difficulty
                </Text>
                <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                  If recent days are missed, commitments get smaller and more
                  concrete.
                </Text>
              </View>
              <Switch
                value={state.momentumSettings.adaptivePlanning}
                onValueChange={(value) =>
                  setMomentumSetting("adaptivePlanning", value)
                }
                trackColor={{ true: colors.primary }}
              />
            </View>
            <View className="flex-row items-center justify-between gap-4">
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Reflect each evening
                </Text>
                <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                  One quick accountability check-in helps tune the next day.
                </Text>
              </View>
              <Switch
                value={state.momentumSettings.eveningReflection}
                onValueChange={(value) =>
                  setMomentumSetting("eveningReflection", value)
                }
                trackColor={{ true: colors.primary }}
              />
            </View>
            {Platform.OS === "ios" ? (
              <View className="flex-row items-center justify-between gap-4">
                <View className="flex-1">
                  <Text className="text-base font-semibold text-foreground">
                    Plan around my calendar
                  </Text>
                  <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                    Reads today&apos;s events and reminders so your three fit around them. Only
                    their titles and times are sent to our AI service when it makes
                    suggestions, and nothing is stored.{hasPlus ? "" : " Plus."}
                  </Text>
                </View>
                <Switch
                  value={hasPlus && state.agendaEnabled}
                  onValueChange={(value) => void handleAgendaEnabled(value)}
                  trackColor={{ true: colors.primary }}
                  accessibilityLabel="Plan around my calendar"
                />
              </View>
            ) : null}
            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                Tone of suggestions
              </Text>
              <View className="flex-row gap-2">
                {(["calm", "friendly", "direct"] as const).map((tone) => (
                  <Pressable
                    key={tone}
                    onPress={() => setMomentumSetting("suggestionTone", tone)}
                    className="flex-1 rounded-full py-2 items-center border"
                    style={{
                      borderColor:
                        state.momentumSettings.suggestionTone === tone
                          ? colors.primary
                          : colors.border,
                      backgroundColor:
                        state.momentumSettings.suggestionTone === tone
                          ? `${colors.primary}16`
                          : colors.background,
                    }}
                  >
                    <Text
                      className="text-xs font-semibold"
                      style={{
                        color:
                          state.momentumSettings.suggestionTone === tone
                            ? colors.primary
                            : colors.text,
                      }}
                    >
                      {formatChoice(tone)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Pressable
              onPress={() => {
                if (hasPlus) {
                  void requestMomentumPlan();
                  return;
                }
                showPaywall("new_ideas", { feature: "ai_ideas" });
              }}
              disabled={state.momentumPlanStatus === "loading"}
              className="self-start rounded-full px-4 py-2"
              style={{ backgroundColor: `${colors.primary}16` }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: colors.primary }}
              >
                {state.momentumPlanStatus === "loading"
                  ? "Refreshing..."
                  : hasPlus
                    ? "Refresh with AI"
                    : "Refresh with AI (Plus)"}
              </Text>
            </Pressable>
            {state.momentumPlanStatus === "error" && state.momentumPlanError && (
              <Text className="text-xs" style={{ color: colors.muted }}>
                {aiFailureMessage(state.momentumPlanError, {
                  showingAiIdeas: state.momentumPlan?.provider === "ai",
                  surface: "settings",
                })}
              </Text>
            )}
          </View>
        </Section>

        <Section
          icon="checkmark-done-outline"
          title="Locking the day"
          subtitle="A locked day keeps your three fixed; you can still check them off."
        >
          <View className="bg-surface rounded-2xl p-4 border border-border gap-3">
            <View className="flex-row items-center justify-between gap-4">
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Lock the day automatically
                </Text>
                <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                  Days with at least one task lock at this time.
                </Text>
              </View>
              <Switch
                value={state.autoLock.enabled}
                onValueChange={setAutoLockEnabled}
                trackColor={{ true: colors.primary }}
                accessibilityLabel="Lock the day automatically"
              />
            </View>
            <TimePickerRow
              label="Time"
              accessibilityLabel="Time to lock the day"
              hour={state.autoLock.hour}
              minute={state.autoLock.minute}
              disabled={!state.autoLock.enabled}
              onChange={setAutoLockTime}
            />
          </View>
        </Section>

        <Section
          icon="repeat-outline"
          title="Routines"
          subtitle="Things you do on repeat, shown on Today on their days."
        >
          <Pressable
            onPress={() => setRoutinesOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Manage routines"
            accessibilityHint="Add, edit, pause or delete routines"
            accessibilityValue={{ text: routinesSummary(state.routines.length, pausedRoutines) }}
            className="bg-surface rounded-2xl p-4 border border-border flex-row items-center gap-3"
            style={{ minHeight: 44 }}
            testID="settings-routines"
          >
            <View
              className="w-9 h-9 rounded-full items-center justify-center"
              style={{ backgroundColor: `${colors.primary}16` }}
            >
              <Ionicons name="repeat-outline" size={18} color={colors.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-semibold text-foreground">Manage routines</Text>
              <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                {routinesSummary(state.routines.length, pausedRoutines)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.muted} />
          </Pressable>
        </Section>

        <Section
          icon="notifications-outline"
          title="Reminders"
          subtitle="Smart, local nudges that react to Today's Three."
        >
          <View className="bg-surface rounded-2xl p-4 border border-border gap-4">
            <View className="flex-row items-center justify-between gap-4">
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Notifications
                </Text>
                <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                  {permissionDescription(notificationPermission)}
                </Text>
              </View>
              <Switch
                value={state.notifications.enabled}
                onValueChange={(value) =>
                  void handleNotificationsEnabled(value)
                }
                trackColor={{ true: colors.primary }}
              />
            </View>

            {notificationPermission !== "granted" &&
              notificationPermission !== "unsupported" && (
                <Pressable
                  onPress={() => void openSystemSettings()}
                  className="self-start rounded-full px-4 py-2"
                  style={{ backgroundColor: `${colors.primary}16` }}
                >
                  <Text
                    className="text-sm font-semibold"
                    style={{ color: colors.primary }}
                  >
                    Open System Settings
                  </Text>
                </Pressable>
              )}
          </View>

          {/* Calm or Nag (1.4). Nag is Plus-only and opt-in. */}
          <View className="bg-surface rounded-2xl p-4 border border-border gap-3" testID="settings-reminder-style">
            <Text accessibilityRole="header" className="text-base font-semibold text-foreground">
              Reminder style
            </Text>
            <ChoiceChips<ReminderStyle>
              label="Reminder style"
              value={reminderStyle}
              onChange={chooseReminderStyle}
              options={[
                { value: "calm", label: "Calm" },
                hasPlus
                  ? { value: "nag", label: "Nag" }
                  : { value: "nag", label: "Nag · Plus", accessibilityLabel: "Nag, Plus" },
              ]}
            />
            <Text className="text-xs" style={{ color: colors.muted }}>
              {REMINDER_STYLE_HELP[reminderStyle]}
            </Text>
            {nagActive && state.notifications.hideTaskNames ? (
              <Text className="text-xs" style={{ color: colors.muted }} testID="settings-nag-hidden-names">
                {NAG_HIDDEN_NAMES_NOTE}
              </Text>
            ) : null}
            {nagActive && !state.notifications.enabled ? (
              <Text className="text-xs" style={{ color: colors.muted }}>
                Notifications are off, so no nags arrive.
              </Text>
            ) : null}
            {nagActive && notificationPermission === "denied" ? (
              <Text className="text-xs" style={{ color: colors.muted }} testID="settings-nag-permission-denied">
                {NAG_PERMISSION_DENIED_NOTE}
              </Text>
            ) : null}
          </View>

          {/* Only while Nag is not on: what it is, before choosing it. */}
          {!nagActive ? (
            <Pressable
              ref={nagIntroRow}
              onPress={openNagIntro}
              accessibilityRole="button"
              accessibilityLabel={NAG_INTRO_SETTINGS_ROW}
              accessibilityHint="Shows what Nag mode does and how it sounds"
              className="bg-surface rounded-2xl p-4 border border-border flex-row items-center gap-3"
              style={{ minHeight: 44 }}
              testID="settings-nag-intro"
            >
              <Ionicons name="megaphone-outline" size={20} color={colors.primary} />
              <Text className="flex-1 text-base font-semibold text-foreground">{NAG_INTRO_SETTINGS_ROW}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ) : null}

          {nagActive ? (
            <View className="bg-surface rounded-2xl p-4 border border-border gap-4" testID="settings-nag">
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">Voice</Text>
                <ChoiceChips
                  label="Voice"
                  spokenGroup
                  value={nagPersona}
                  onChange={setNagPersona}
                  options={NAG_PERSONAS.map((persona) => ({ value: persona, label: NAG_PERSONA_LABELS[persona] }))}
                  columns={3}
                />
              </View>
              <View className="gap-2">
                <Text className="text-sm font-semibold text-foreground">Level</Text>
                <ChoiceChips
                  label="Level"
                  spokenGroup
                  value={nagLevel}
                  onChange={setNagLevel}
                  options={NAG_LEVELS.map((level) => ({ value: level, label: NAG_LEVEL_LABELS[level] }))}
                  columns={3}
                />
                <Text className="text-xs" style={{ color: colors.muted }} testID="settings-nag-level-count">
                  {NAG_LEVEL_COUNT_NOTE[nagLevel]}
                </Text>
                {nagLevelRudeNote(nagPersona, nagLevel) ? (
                  <Text className="text-xs" style={{ color: colors.muted }} testID="settings-nag-level-rude">
                    {nagLevelRudeNote(nagPersona, nagLevel)}
                  </Text>
                ) : null}
              </View>
              <View className="gap-1">
                <Text className="text-sm font-semibold text-foreground">Sample</Text>
                <Text
                  className="text-sm"
                  style={{ color: colors.muted }}
                  accessibilityLabel={`Sample: ${sample}`}
                  testID="settings-nag-sample"
                >
                  {sample}
                </Text>
                <Pressable
                  onPress={() => {
                    setSampleTurn(sampleTurn + 1);
                    // The line changes in place: say the new one.
                    if (samples.length > 0) announcePolitely(samples[(sampleTurn + 1) % samples.length]);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Show another"
                  accessibilityHint="Shows another sample line"
                  hitSlop={8}
                  className="self-start justify-center"
                  style={{ minHeight: 32 }}
                >
                  <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                    Show another
                  </Text>
                </Pressable>
              </View>
              <View ref={ownLinesRef} collapsable={false}>
                <NagOwnLines headerRef={ownLinesHeaderRef} />
              </View>
              <View className="gap-3">
                <Pressable
                  onPress={() => setNagHoursOpen(!nagHoursOpen)}
                  accessibilityRole="button"
                  accessibilityLabel={`Nag hours: ${nagHours}`}
                  accessibilityHint={nagHoursOpen ? "Hides the start and end times" : "Shows the start and end times"}
                  accessibilityState={{ expanded: nagHoursOpen }}
                  className="flex-row items-center justify-between gap-3"
                  style={{ minHeight: 44 }}
                  testID="settings-nag-hours"
                >
                  <Text className="text-sm font-semibold text-foreground">Nag hours</Text>
                  <View className="flex-1 flex-row items-center justify-end gap-1">
                    <Text className="text-sm text-right" style={{ color: colors.muted, flexShrink: 1 }}>
                      {nagHours}
                    </Text>
                    <Ionicons name={nagHoursOpen ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
                  </View>
                </Pressable>
                {nagHoursOpen ? (
                  <>
                    <TimePickerRow
                      label="From"
                      accessibilityLabel="Nag from"
                      hour={Math.floor(nagStart / 60)}
                      minute={nagStart % 60}
                      onChange={(hour, minute) => setNagWindowEdge("start", hour * 60 + minute)}
                    />
                    <TimePickerRow
                      label="Until"
                      accessibilityLabel="Nag until"
                      hour={Math.floor(nagEnd / 60)}
                      minute={nagEnd % 60}
                      onChange={(hour, minute) => setNagWindowEdge("end", hour * 60 + minute)}
                    />
                    <Text className="text-xs" style={{ color: colors.muted }}>
                      Nags only arrive between these times. The window is at least 3 hours long.
                    </Text>
                  </>
                ) : null}
              </View>
              {nagPaused ? (
                <View className="flex-row items-center justify-between gap-4" style={{ minHeight: 44 }}>
                  <Text
                    className="flex-1 text-sm text-foreground"
                    testID="settings-nag-paused"
                  >
                    Nagging is off until tomorrow
                  </Text>
                  <Pressable
                    onPress={() => {
                      resumeNag();
                      announcePolitely("Nagging is back on");
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Resume"
                    accessibilityHint="Turns today's nags back on"
                    hitSlop={8}
                    className="rounded-full px-4 justify-center"
                    style={{ minHeight: 44, backgroundColor: `${colors.primary}16` }}
                  >
                    <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                      Resume
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => {
                    pauseNagToday("settings");
                    announcePolitely("Nagging is off until tomorrow");
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Stop nagging me today"
                  accessibilityHint="No more nags today. Morning reminders stay."
                  className="rounded-full px-4 items-center justify-center self-start"
                  style={{ minHeight: 44, backgroundColor: `${colors.primary}16` }}
                >
                  <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                    Stop nagging me today
                  </Text>
                </Pressable>
              )}
            </View>
          ) : null}

          <View className="gap-3">
            {(Object.keys(NOTIFICATION_LABELS) as NotificationKey[]).map(
              (key) => {
                const meta = NOTIFICATION_LABELS[key];
                // Nags take the place of the daytime and evening nudges.
                const replacedByNags = nagActive && key !== "morning";
                // Hourly mode supersedes the spaced progress/evening nudges.
                const pausedByHourly =
                  !replacedByNags &&
                  state.notifications.hourly &&
                  (key === "progress" || key === "evening");
                return (
                  <ReminderSwitchRow
                    key={key}
                    title={meta.title}
                    subtitle={
                      replacedByNags
                        ? NAG_SWITCH_PAUSED_HINT
                        : pausedByHourly
                          ? "Paused while Every hour is on."
                          : meta.subtitle
                    }
                    value={state.notifications[key]}
                    onValueChange={(value) => void handleReminderEnabled(key, value)}
                    disabled={pausedByHourly || replacedByNags}
                    // One line under the switches says it for all three.
                    showSubtitle={!replacedByNags}
                    mutedColor={colors.muted}
                    trackColor={colors.primary}
                  />
                );
              },
            )}
            {/* The Sunday reset's notification (1.6, Plus): on unless turned off here. */}
            {hasPlus ? (
              <ReminderSwitchRow
                title="Sunday reset"
                subtitle={SUNDAY_RESET_HELP}
                value={sundayResetOf(state).reminder}
                onValueChange={(value) => updateSundayReset({ reminder: value })}
                mutedColor={colors.muted}
                trackColor={colors.primary}
              />
            ) : null}
            {nagActive ? (
              <Text className="text-xs" style={{ color: colors.muted }} testID="settings-nag-calm-note">
                {NAG_CALM_SWITCHES_NOTE}
              </Text>
            ) : null}
            {/* What the reminders say, not when: it never asks for permission. */}
            <Text
              accessibilityRole="header"
              className="text-sm font-semibold text-foreground mt-2"
            >
              What reminders say
            </Text>
            <ReminderSwitchRow
              title="Hide task names in notifications"
              subtitle={HIDE_TASK_NAMES_HELP}
              value={state.notifications.hideTaskNames}
              onValueChange={setHideTaskNamesInNotifications}
              mutedColor={colors.muted}
              trackColor={colors.primary}
            />
          </View>
        </Section>

        <Section icon="heart-outline" title="Feedback">
          <View className="bg-surface rounded-2xl border border-border overflow-hidden">
            <HelpRow
              icon="star-outline"
              label="Rate Three Today"
              hint="Opens the App Store to write a review"
              onPress={() => void openWriteReview()}
            />
            <View style={{ height: 1, backgroundColor: colors.border }} />
            <HelpRow
              icon="chatbubble-outline"
              label="Send feedback"
              hint="Opens the support page"
              onPress={openFeedback}
            />
          </View>
        </Section>

        <Section icon="help-circle-outline" title="Help">
          <View className="bg-surface rounded-2xl border border-border overflow-hidden">
            <HelpRow
              icon="chatbubble-ellipses-outline"
              label="Contact support"
              onPress={() => void openExternal(SUPPORT_URL)}
            />
            <View style={{ height: 1, backgroundColor: colors.border }} />
            <HelpRow
              icon="lock-closed-outline"
              label="Privacy policy"
              onPress={() => void openExternal(PRIVACY_URL)}
            />
          </View>
        </Section>

        {/* Last, so Reset all data is the final row. */}
        <Section
          icon="folder-outline"
          title="Data"
          subtitle="Your tasks and history are saved on this device, not in an account."
        >
          {getPostHogKey() !== null && (
            <View className="bg-surface rounded-2xl p-4 border border-border flex-row items-center justify-between gap-4">
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Share anonymous usage stats
                </Text>
                <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                  Anonymous counts like &quot;finished a task&quot; or &quot;viewed Plus&quot; help us
                  improve the app. Never your tasks, goals or name.
                </Text>
              </View>
              <Switch
                value={state.analyticsEnabled}
                onValueChange={setAnalyticsEnabled}
                trackColor={{ true: colors.primary }}
                accessibilityLabel="Share anonymous usage stats"
              />
            </View>
          )}
          <Pressable
            onPress={handleReset}
            className="bg-surface rounded-2xl p-4 border border-border flex-row items-center gap-3"
          >
            <View
              className="w-9 h-9 rounded-full items-center justify-center"
              style={{ backgroundColor: `${colors.error}22` }}
            >
              <Ionicons name="trash-outline" size={18} color={colors.error} />
            </View>
            <View className="flex-1">
              <Text
                className="text-base font-semibold"
                style={{ color: colors.error }}
              >
                Reset all data
              </Text>
              <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                Clears your tasks, history and settings on this device.
              </Text>
            </View>
          </Pressable>
        </Section>

        <Text
          className="text-xs text-center mt-2"
          style={{ color: colors.muted }}
        >
          Three Today · v{getCurrentVersion()}
        </Text>
      </ScrollView>
      </KeyboardAvoidingView>
      <RoutinesManager visible={routinesOpen} onVisibleChange={setRoutinesOpen} />
      <NagIntro
        visible={nagIntroOpen}
        source="settings"
        id={nagIntroFresh ? NAG_FIRST_DAYS_ID : NAG_ANNOUNCEMENT_ID}
        onClose={closeNagIntro}
        // The style card above now shows Nag, with its controls.
        onTurnedOn={() => announcePolitely("Nag mode is on")}
      />
      <OnboardingModal
        visible={profileModalVisible}
        initialProfile={state.momentumProfile}
        onRequestClose={() => setProfileModalVisible(false)}
        onComplete={(profile) => {
          completeMomentumOnboarding(profile);
          setProfileModalVisible(false);
        }}
      />
    </ScreenContainer>
  );
}

function HelpRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  hint?: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={hint}
      className="flex-row items-center gap-3 p-4"
    >
      <View
        className="w-9 h-9 rounded-full items-center justify-center"
        style={{ backgroundColor: `${colors.primary}16` }}
      >
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <Text className="flex-1 text-base font-semibold text-foreground">
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function routinesSummary(count: number, paused: number): string {
  if (count === 0) return "Things you do on repeat, suggested on Today on their days.";
  const base = `${count} ${count === 1 ? "routine" : "routines"}`;
  return paused > 0 ? `${base} · ${paused} paused` : base;
}

function permissionDescription(state: NotificationPermissionState): string {
  switch (state) {
    case "granted":
      return "Allowed. Reminders only appear when Today's Three still need attention.";
    case "denied":
      return "Blocked at the system level. You can turn them back on in Settings.";
    case "unsupported":
      return "Notifications are unavailable on web preview.";
    case "undetermined":
      return "Enable notifications to get calm reminders for Today's Three.";
  }
}

function momentumSummary(profile: {
  timeAvailability: string | null;
  experienceLevel: string | null;
  struggleType: string | null;
}): string {
  if (!profile.timeAvailability || !profile.experienceLevel || !profile.struggleType) {
    return "Add a goal and a few quick details so suggestions feel more personal.";
  }

  return `${formatChoice(profile.timeAvailability)} per day · ${formatChoice(
    profile.experienceLevel,
  )} · ${formatChoice(profile.struggleType)}`;
}

function formatChoice(value: string): string {
  return value.replace("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View className="gap-3">
      <View className="gap-1.5">
        <SectionLabel icon={icon} label={title} />
        {subtitle && (
          <Text className="text-sm mt-0.5" style={{ color: colors.muted }}>
            {subtitle}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}
