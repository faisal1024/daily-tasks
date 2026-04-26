import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import type { DayRecord } from "@/lib/daily-tasks/types";

interface DayDetailCardProps {
  dateLabel: string;
  record: DayRecord | undefined;
}

export function DayDetailCard({ dateLabel, record }: DayDetailCardProps) {
  const colors = useColors();

  if (!record || record.total === 0) {
    return (
      <View className="rounded-2xl bg-surface border border-border p-4 gap-2">
        <Text className="text-xs uppercase tracking-wide" style={{ color: colors.muted }}>
          {dateLabel}
        </Text>
        <Text className="text-lg font-semibold text-foreground">No task history</Text>
        <Text className="text-sm" style={{ color: colors.muted }}>
          This day has no saved tasks yet.
        </Text>
      </View>
    );
  }

  return (
    <View className="rounded-2xl bg-surface border border-border p-4 gap-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="gap-1">
          <Text className="text-xs uppercase tracking-wide" style={{ color: colors.muted }}>
            {dateLabel}
          </Text>
          <Text className="text-lg font-semibold text-foreground">
            {record.completed}/{record.total} completed
          </Text>
        </View>
        {record.locked && (
          <View
            className="rounded-full px-3 py-1 flex-row items-center gap-1"
            style={{ backgroundColor: `${colors.primary}16` }}
          >
            <Ionicons name="lock-closed" size={12} color={colors.primary} />
            <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
              Locked
            </Text>
          </View>
        )}
      </View>

      <View className="gap-2">
        {record.tasks.map((task) => (
          <View key={task.id} className="flex-row items-center gap-3">
            <Ionicons
              name={task.completed ? "checkmark-circle" : "ellipse-outline"}
              size={18}
              color={task.completed ? colors.success : colors.muted}
            />
            <Text
              className="flex-1 text-sm text-foreground"
              style={{ opacity: task.completed ? 0.65 : 1 }}
            >
              {task.text}
            </Text>
            {task.rolloverOutcome === "carried" && (
              <Text className="text-xs font-semibold" style={{ color: colors.primary }}>
                Carried
              </Text>
            )}
            {task.rolloverOutcome === "dropped" && (
              <Text className="text-xs font-semibold" style={{ color: colors.muted }}>
                Dropped
              </Text>
            )}
          </View>
        ))}
      </View>

      {record.reflection && (
        <View className="rounded-2xl bg-background border border-border p-3 gap-1">
          <Text className="text-xs uppercase tracking-wide" style={{ color: colors.muted }}>
            Reflection
          </Text>
          <Text className="text-sm text-foreground">{record.reflection}</Text>
        </View>
      )}
    </View>
  );
}
