import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer } from "@/components/screen-container";
import { TaskCard } from "@/components/daily-tasks/task-card";
import { TimeStepper } from "@/components/daily-tasks/time-stepper";
import { useColors } from "@/hooks/use-colors";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import type {
  NotificationKey,
  NotificationFrequencyHours,
  NotificationPermissionState,
  UserEnergy,
  UserGoal,
  UserProfile,
  UserTimeWindow,
  UserWorkStyle,
} from "@/lib/daily-tasks/types";
import { USER_GOALS, USER_GOAL_META } from "@/lib/daily-tasks/task-catalog";

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
};

const ENERGY_OPTIONS: { value: UserEnergy; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "steady", label: "Steady" },
  { value: "high", label: "High" },
];

const TIME_OPTIONS: { value: UserTimeWindow; label: string }[] = [
  { value: "quick", label: "5-10 min" },
  { value: "medium", label: "20 min" },
  { value: "deep", label: "45 min" },
];

const STYLE_OPTIONS: { value: UserWorkStyle; label: string }[] = [
  { value: "gentle", label: "Gentle" },
  { value: "structured", label: "Structured" },
  { value: "ambitious", label: "Ambitious" },
];

const FREQUENCY_OPTIONS: { value: NotificationFrequencyHours; label: string }[] = [
  { value: 1, label: "Hourly" },
  { value: 2, label: "Every 2 hours" },
];

export default function SettingsScreen() {
  const colors = useColors();
  const {
    state,
    notificationPermission,
    isCompleted,
    editTask,
    deleteTask,
    toggleTask,
    setAutoLockEnabled,
    setAutoLockTime,
    setNotificationsEnabled,
    setNotificationEnabled,
    setNotificationFrequency,
    refreshNotificationPermission,
    requestNotificationPermission,
    setProfile,
    resetAll,
  } = useDailyTasks();

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

  const updateProfile = (patch: Partial<UserProfile>) => {
    setProfile({ ...state.profile, ...patch });
  };

  const toggleGoal = (goal: UserGoal) => {
    const nextGoals = state.profile.goals.includes(goal)
      ? state.profile.goals.filter((item) => item !== goal)
      : [...state.profile.goals, goal].slice(0, 4);
    if (nextGoals.length === 0) return;
    updateProfile({ goals: nextGoals });
  };

  return (
    <ScreenContainer>
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 28 }}
      >
        <View className="gap-1">
          <Text className="text-base text-muted">Settings</Text>
          <Text className="text-3xl font-bold text-foreground">
            Tune your day
          </Text>
        </View>

        <Section
          title="Today's Three"
          subtitle="Review or finish the focus commitments you chose."
        >
          <View className="gap-3">
            {state.todayLocked && (
              <View className="rounded-2xl border border-border bg-surface p-4">
                <Text className="text-sm font-semibold text-foreground">
                  Today's Three is set
                </Text>
                <Text className="text-sm text-muted mt-1">
                  You can still check things off, but today is no longer a place
                  to reshuffle.
                </Text>
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
          title="Profile"
          subtitle="Suggestions use this to pick better focus commitments."
        >
          <View className="bg-surface rounded-2xl p-4 border border-border gap-5">
            <ProfileGroup title="Goals">
              <View className="flex-row flex-wrap gap-2">
                {USER_GOALS.map((goal) => (
                  <ChoicePill
                    key={goal}
                    label={USER_GOAL_META[goal].label}
                    active={state.profile.goals.includes(goal)}
                    onPress={() => toggleGoal(goal)}
                  />
                ))}
              </View>
            </ProfileGroup>

            <ProfileGroup title="Energy">
              <ChoiceRow
                options={ENERGY_OPTIONS}
                value={state.profile.energy}
                onChange={(energy) => updateProfile({ energy })}
              />
            </ProfileGroup>

            <ProfileGroup title="Time">
              <ChoiceRow
                options={TIME_OPTIONS}
                value={state.profile.timeWindow}
                onChange={(timeWindow) => updateProfile({ timeWindow })}
              />
            </ProfileGroup>

            <ProfileGroup title="Style">
              <ChoiceRow
                options={STYLE_OPTIONS}
                value={state.profile.workStyle}
                onChange={(workStyle) => updateProfile({ workStyle })}
              />
            </ProfileGroup>
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

            <View className="gap-2">
              <Text className="text-sm font-semibold text-foreground">
                Reminder frequency
              </Text>
              <ChoiceRow
                options={FREQUENCY_OPTIONS}
                value={state.notifications.frequencyHours}
                onChange={setNotificationFrequency}
              />
            </View>
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

function ProfileGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-semibold text-foreground">{title}</Text>
      {children}
    </View>
  );
}

function ChoiceRow<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => (
        <ChoicePill
          key={String(option.value)}
          label={option.label}
          active={value === option.value}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

function ChoicePill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      className="rounded-full px-3 py-2 border"
      style={{
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? `${colors.primary}16` : colors.background,
      }}
    >
      <Text
        className="text-sm font-semibold"
        style={{ color: active ? colors.primary : colors.foreground }}
      >
        {label}
      </Text>
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
