import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useState } from "react";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer } from "@/components/screen-container";
import { OnboardingModal } from "@/components/daily-tasks/onboarding-modal";
import { TaskCard } from "@/components/daily-tasks/task-card";
import { TimeStepper } from "@/components/daily-tasks/time-stepper";
import { useColors } from "@/hooks/use-colors";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import type {
  NotificationKey,
  NotificationPermissionState,
} from "@/lib/daily-tasks/types";

const SUPPORT_URL = "https://github.com/faisal1024/daily-tasks#support";
const PRIVACY_URL =
  "https://github.com/faisal1024/daily-tasks/blob/main/docs/privacy-policy.md";

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
    isCompleted,
    editTask,
    deleteTask,
    toggleTask,
    unlockToday,
    setAutoLockEnabled,
    setAutoLockTime,
    setNotificationsEnabled,
    setNotificationEnabled,
    refreshNotificationPermission,
    requestNotificationPermission,
    completeMomentumOnboarding,
    requestMomentumPlan,
    setMomentumSetting,
    resetAll,
  } = useDailyTasks();
  const [profileModalVisible, setProfileModalVisible] = useState(false);

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
        "Notifications can be updated from your device settings for Daily Tasks.",
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
        contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 28 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <View className="gap-1">
          <Text className="text-base text-muted">Settings</Text>
          <Text className="text-3xl font-bold text-foreground">
            Tune your day
          </Text>
        </View>

        <Section
          title="Momentum"
          subtitle="Personalize your accountability coach without adding a backlog."
        >
          <View className="bg-surface rounded-2xl p-4 border border-border gap-3">
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
              accessibilityLabel="Update Momentum profile"
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
          title="AI adaptation"
          subtitle="How your coach tunes tomorrow based on today's follow-through."
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
              onPress={() => void requestMomentumPlan()}
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
                  : "Refresh with AI"}
              </Text>
            </Pressable>
            {state.momentumPlanError && (
              <Text className="text-xs" style={{ color: colors.muted }}>
                AI was unavailable, so Momentum kept a local fallback plan.
              </Text>
            )}
          </View>
        </Section>

        <Section
          title="Today's Three"
          subtitle="Review or finish the focus commitments you chose."
        >
          <View className="gap-3">
            {state.todayLocked && (
              <View className="rounded-2xl border border-border bg-surface p-4 gap-3">
                <View>
                  <Text className="text-sm font-semibold text-foreground">
                    Today's Three is set
                  </Text>
                  <Text className="text-sm text-muted mt-1">
                    You can still check things off. Unlock if you need to add,
                    edit, or swap a task today.
                  </Text>
                </View>
                <Pressable
                  onPress={unlockToday}
                  accessibilityRole="button"
                  accessibilityLabel="Unlock today's list"
                  className="self-start flex-row items-center gap-2 rounded-full px-4 py-2 border"
                  style={{ borderColor: colors.primary }}
                >
                  <Ionicons name="lock-open-outline" size={16} color={colors.primary} />
                  <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                    Unlock today
                  </Text>
                </Pressable>
              </View>
            )}
            {state.tasks.length === 0 ? (
              <Text className="text-sm text-muted">
                No focus commitments yet — choose them on the Today tab.
              </Text>
            ) : (
              state.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  completed={isCompleted(task.id)}
                  onToggle={() => toggleTask(task.id)}
                  onEdit={(text) => editTask(task.id, text)}
                  onDelete={() =>
                    Alert.alert(
                      "Release this focus?",
                      `Remove "${task.text}" from Today's Three?`,
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Delete",
                          style: "destructive",
                          onPress: () => deleteTask(task.id),
                        },
                      ],
                    )
                  }
                  canEdit={!state.todayLocked}
                  canDelete={!state.todayLocked}
                />
              ))
            )}
          </View>
        </Section>

        <Section
          title="Daily lock"
          subtitle="Choose whether Today's Three sets itself automatically."
        >
          <View className="bg-surface rounded-2xl p-4 border border-border gap-3">
            <View className="flex-row items-center justify-between gap-4">
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">
                  Auto-set today
                </Text>
                <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                  When on, days with at least one focus commitment are set at
                  your chosen time.
                </Text>
              </View>
              <Switch
                value={state.autoLock.enabled}
                onValueChange={setAutoLockEnabled}
                trackColor={{ true: colors.primary }}
              />
            </View>
            <TimeStepper
              hour={state.autoLock.hour}
              minute={state.autoLock.minute}
              disabled={!state.autoLock.enabled}
              onChange={setAutoLockTime}
            />
          </View>
        </Section>

        <Section
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
                return (
                  <View
                    key={key}
                    className="bg-surface rounded-2xl p-4 border border-border"
                  >
                    <View className="flex-row items-center justify-between gap-4">
                      <View className="flex-1">
                        <Text className="text-base font-semibold text-foreground">
                          {meta.title}
                        </Text>
                        <Text
                          className="text-xs mt-1"
                          style={{ color: colors.muted }}
                        >
                          {meta.subtitle}
                        </Text>
                      </View>
                      <Switch
                        value={state.notifications[key]}
                        onValueChange={(value) =>
                          void handleReminderEnabled(key, value)
                        }
                        trackColor={{ true: colors.primary }}
                      />
                    </View>
                  </View>
                );
              },
            )}
          </View>
        </Section>

        <Section title="Data" subtitle="Stored only on this device.">
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
                Clears focus commitments, history, and reminder settings.
              </Text>
            </View>
          </Pressable>
        </Section>

        <Section title="Help">
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
          Daily Tasks · v1.0.0
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
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
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
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-3">
      <View>
        <Text className="text-lg font-semibold text-foreground">{title}</Text>
        {subtitle && (
          <Text className="text-sm text-muted mt-0.5">{subtitle}</Text>
        )}
      </View>
      {children}
    </View>
  );
}
