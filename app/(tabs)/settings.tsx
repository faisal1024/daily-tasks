import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { ScreenContainer } from "@/components/screen-container";
import { TaskCard } from "@/components/daily-tasks/task-card";
import { TimeStepper } from "@/components/daily-tasks/time-stepper";
import { useColors } from "@/hooks/use-colors";
import { ensurePermission } from "@/lib/daily-tasks/notifications";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import type { NotificationKey } from "@/lib/daily-tasks/types";

const NOTIFICATION_LABELS: Record<NotificationKey, { title: string; subtitle: string }> = {
  morning: { title: "Morning reminder", subtitle: "Plan your three tasks" },
  evening: { title: "Evening check-in", subtitle: "See how you're tracking" },
  night: { title: "Night reminder", subtitle: "Last chance to wrap up" },
};

export default function SettingsScreen() {
  const colors = useColors();
  const {
    state,
    isCompleted,
    editTask,
    deleteTask,
    toggleTask,
    setNotificationEnabled,
    setNotificationTime,
    resetAll,
  } = useDailyTasks();

  const handleEnable = async (key: NotificationKey, value: boolean) => {
    if (value) {
      const ok = await ensurePermission();
      if (!ok) {
        Alert.alert(
          "Notifications disabled",
          "Enable notifications for Daily Tasks in System Settings to use reminders.",
        );
        return;
      }
    }
    setNotificationEnabled(key, value);
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
                />
              ))
            )}
          </View>
        </Section>

        <Section title="Reminders" subtitle="Three local nudges. No data leaves your device.">
          <View className="gap-3">
            {(Object.keys(NOTIFICATION_LABELS) as NotificationKey[]).map((key) => {
              const slot = state.notifications[key];
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
                      <Text className="text-xs mt-1" style={{ color: colors.muted }}>
                        {meta.subtitle}
                      </Text>
                    </View>
                    <Switch
                      value={slot.enabled}
                      onValueChange={(v) => void handleEnable(key, v)}
                      trackColor={{ true: colors.primary }}
                    />
                  </View>
                  <TimeStepper
                    hour={slot.hour}
                    minute={slot.minute}
                    disabled={!slot.enabled}
                    onChange={(h, m) => setNotificationTime(key, h, m)}
                  />
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

        <Text className="text-xs text-center mt-2" style={{ color: colors.muted }}>
          Daily Tasks · v1.0.0
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
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
