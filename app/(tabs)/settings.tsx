import {
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
import { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer } from "@/components/screen-container";
import { OnboardingModal } from "@/components/daily-tasks/onboarding-modal";
import { SectionLabel } from "@/components/daily-tasks/section-label";
import { TimePickerRow } from "@/components/daily-tasks/time-picker-row";
import { useColors } from "@/hooks/use-colors";
import { Fonts } from "@/constants/theme";
import { getCurrentVersion } from "@/lib/daily-tasks/app-update";
import { requestAgendaAccess } from "@/lib/daily-tasks/agenda";
import { aiFailureMessage } from "@/lib/daily-tasks/ai-status";
import { getPostHogKey, track } from "@/lib/daily-tasks/analytics";
import {
  FEEDBACK_URL,
  MANAGE_SUBSCRIPTIONS_URL,
  PRIVACY_URL,
  SUPPORT_URL,
  WRITE_REVIEW_URL,
  WRITE_REVIEW_WEB_URL,
} from "@/lib/daily-tasks/links";
import { plusStatusLabel } from "@/lib/daily-tasks/plus";
import { usePlus } from "@/lib/daily-tasks/plus-context";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import type {
  NotificationKey,
  NotificationPermissionState,
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

export default function SettingsScreen() {
  const colors = useColors();
  const {
    state,
    notificationPermission,
    setAutoLockEnabled,
    setAutoLockTime,
    setNotificationsEnabled,
    setNotificationEnabled,
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
  const [restoring, setRestoring] = useState(false);

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

  const handleAgendaEnabled = async (value: boolean) => {
    // Only Plus requests use it: don't ask for access a free user can't use.
    if (value && !hasPlus) {
      track("plus_gate_hit", { feature: "calendar" });
      plus.openPaywall("calendar");
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
                track("plus_gate_hit", { feature: "ai_ideas" });
                plus.openPaywall("new_ideas");
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
          title="Setting the day"
          subtitle="A set day keeps your three fixed; you can still check them off."
        >
          <View className="bg-surface rounded-2xl p-4 border border-border gap-3">
            <View className="flex-row items-center justify-between gap-4">
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Set the day automatically
                </Text>
                <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                  Days with at least one task are set at this time.
                </Text>
              </View>
              <Switch
                value={state.autoLock.enabled}
                onValueChange={setAutoLockEnabled}
                trackColor={{ true: colors.primary }}
                accessibilityLabel="Set the day automatically"
              />
            </View>
            <TimePickerRow
              label="Time"
              accessibilityLabel="Time to set the day"
              hour={state.autoLock.hour}
              minute={state.autoLock.minute}
              disabled={!state.autoLock.enabled}
              onChange={setAutoLockTime}
            />
          </View>
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

          <View className="gap-3">
            {(Object.keys(NOTIFICATION_LABELS) as NotificationKey[]).map(
              (key) => {
                const meta = NOTIFICATION_LABELS[key];
                // Hourly mode supersedes the spaced progress/evening nudges.
                const pausedByHourly =
                  state.notifications.hourly &&
                  (key === "progress" || key === "evening");
                return (
                  <View
                    key={key}
                    className="bg-surface rounded-2xl p-4 border border-border"
                    style={{ opacity: pausedByHourly ? 0.5 : 1 }}
                  >
                    <View className="flex-row items-center justify-between gap-4">
                      <View className="flex-1">
                        <Text className="text-lg font-bold text-foreground">
                          {meta.title}
                        </Text>
                        <Text
                          className="text-sm mt-1"
                          style={{ color: colors.muted }}
                        >
                          {pausedByHourly
                            ? "Paused while Every hour is on."
                            : meta.subtitle}
                        </Text>
                      </View>
                      <Switch
                        value={state.notifications[key]}
                        onValueChange={(value) =>
                          void handleReminderEnabled(key, value)
                        }
                        disabled={pausedByHourly}
                        trackColor={{ true: colors.primary }}
                      />
                    </View>
                  </View>
                );
              },
            )}
          </View>
        </Section>

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
              icon="mail-outline"
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

        <Text
          className="text-xs text-center mt-2"
          style={{ color: colors.muted }}
        >
          Three Today · v{getCurrentVersion()}
        </Text>
      </ScrollView>
      </KeyboardAvoidingView>
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
