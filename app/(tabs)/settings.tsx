import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer } from "@/components/screen-container";
import { TaskCard } from "@/components/daily-tasks/task-card";
import { useColors } from "@/hooks/use-colors";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import type { NotificationKey, NotificationPermissionState } from "@/lib/daily-tasks/types";

const SUPPORT_URL = "https://github.com/faisal1024/daily-tasks#support";
const PRIVACY_URL = "https://github.com/faisal1024/daily-tasks/blob/main/docs/privacy-policy.md";

const NOTIFICATION_LABELS: Record<NotificationKey, { title: string; subtitle: string }> = {
  morning: {
    title: "Morning reminders",
    subtitle: "A gentle start if today is still blank.",
  },
  progress: {
    title: "Progress reminders",
    subtitle: "Calm nudges while today's three tasks are still open.",
  },
  evening: {
    title: "Evening reminders",
    subtitle: "A soft wrap-up when something is still left.",
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
    setNotificationsEnabled,
    setNotificationEnabled,
    refreshNotificationPermission,
    requestNotificationPermission,
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
        "Allow notifications in System Settings to get calm reminders for today's tasks.",
      );
      return;
    }

    setNotificationsEnabled(true);
  };

  const handleReminderEnabled = async (key: NotificationKey, value: boolean) => {
    if (value && state.notifications.enabled && notificationPermission !== "granted") {
      const status = await requestNotificationPermission();
      if (status !== "granted") {
        Alert.alert(
          "Notifications unavailable",
          "Allow notifications in System Settings to get calm reminders for today's tasks.",
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
      "This deletes all tasks, history, and settings. This can't be undone.",
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
      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 48, gap: 28 }}>
        <View className="gap-1">
          <Text className="text-base text-muted">Settings</Text>
          <Text className="text-3xl font-bold text-foreground">Tune your day</Text>
        </View>

        <Section title="Your tasks" subtitle="Edit, complete, or remove from anywhere.">
          <View className="gap-3">
            {state.todayLocked && (
              <View className="rounded-2xl border border-border bg-surface p-4">
                <Text className="text-sm font-semibold text-foreground">
                  Today's list is locked
                </Text>
                <Text className="text-sm text-muted mt-1">
                  You can still check tasks off, but the list itself is set for today.
                </Text>
              </View>
            )}
            {state.tasks.length === 0 ? (
              <Text className="text-sm text-muted">No tasks yet — add some on the Tasks tab.</Text>
            ) : (
              state.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  completed={isCompleted(task.id)}
                  onToggle={() => toggleTask(task.id)}
                  onEdit={(text) => editTask(task.id, text)}
                  onDelete={() =>
                    Alert.alert("Delete task?", `Remove "${task.text}"?`, [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => deleteTask(task.id),
                      },
                    ])
                  }
                  canEdit={!state.todayLocked}
                  canDelete={!state.todayLocked}
                />
              ))
            )}
          </View>
        </Section>

        <Section title="Reminders" subtitle="Smart, local nudges that react to today's tasks.">
          <View className="bg-surface rounded-2xl p-4 border border-border gap-4">
            <View className="flex-row items-center justify-between gap-4">
              <View className="flex-1">
                <Text className="text-base font-semibold text-foreground">Notifications</Text>
                <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                  {permissionDescription(notificationPermission)}
                </Text>
              </View>
              <Switch
                value={state.notifications.enabled}
                onValueChange={(value) => void handleNotificationsEnabled(value)}
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
                  <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                    Open System Settings
                  </Text>
                </Pressable>
              )}
          </View>

          <View className="gap-3">
            {(Object.keys(NOTIFICATION_LABELS) as NotificationKey[]).map((key) => {
              const meta = NOTIFICATION_LABELS[key];
              return (
                <View key={key} className="bg-surface rounded-2xl p-4 border border-border">
                  <View className="flex-row items-center justify-between gap-4">
                    <View className="flex-1">
                      <Text className="text-base font-semibold text-foreground">
                        {meta.title}
                      </Text>
                      <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                        {meta.subtitle}
                      </Text>
                    </View>
                    <Switch
                      value={state.notifications[key]}
                      onValueChange={(value) => void handleReminderEnabled(key, value)}
                      trackColor={{ true: colors.primary }}
                    />
                  </View>
                </View>
              );
            })}
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
              <Text className="text-base font-semibold" style={{ color: colors.error }}>
                Reset all data
              </Text>
              <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                Clears tasks, history, and reminder settings.
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

        <Text className="text-xs text-center mt-2" style={{ color: colors.muted }}>
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
      <Text className="flex-1 text-base font-semibold text-foreground">{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.muted} />
    </Pressable>
  );
}

function permissionDescription(state: NotificationPermissionState): string {
  switch (state) {
    case "granted":
      return "Allowed. Reminders only appear when today's tasks still need attention.";
    case "denied":
      return "Blocked at the system level. You can turn them back on in Settings.";
    case "unsupported":
      return "Notifications are unavailable on web preview.";
    case "undetermined":
      return "Enable notifications to get calm reminders for today's three tasks.";
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
        {subtitle && <Text className="text-sm text-muted mt-0.5">{subtitle}</Text>}
      </View>
      {children}
    </View>
  );
}
