import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import { MAX_TASKS } from "@/lib/daily-tasks/types";

interface TodaySummaryCardProps {
  completedCount: number;
  total: number;
  remainingSlots: number;
  locked: boolean;
}

export function TodaySummaryCard({
  completedCount,
  total,
  remainingSlots,
  locked,
}: TodaySummaryCardProps) {
  const colors = useColors();
  const remainingTasks = Math.max(0, total - completedCount);
  const isDone = total > 0 && completedCount === total;
  const headline = getHeadline({
    isDone,
    locked,
    total,
    remainingTasks,
    remainingSlots,
  });
  const subcopy = getSubcopy({
    isDone,
    locked,
    total,
    remainingTasks,
    remainingSlots,
  });

  return (
    <View
      className="rounded-[28px] border border-border p-5 gap-5 overflow-hidden"
      style={{ backgroundColor: `${colors.primary}0D` }}
    >
      <View className="flex-row items-start justify-between gap-4">
        <View className="flex-1 gap-2">
          <Text
            className="text-xs uppercase tracking-[2px]"
            style={{ color: colors.primary }}
          >
            Daily commitment
          </Text>
          <Text className="text-2xl font-bold text-foreground">{headline}</Text>
          <Text className="text-sm leading-5" style={{ color: colors.muted }}>
            {subcopy}
          </Text>
        </View>

        <View
          className="w-12 h-12 rounded-2xl items-center justify-center"
          style={{
            backgroundColor: isDone
              ? `${colors.success}22`
              : `${colors.primary}18`,
          }}
        >
          <Ionicons
            name={isDone ? "sparkles" : locked ? "lock-closed" : "leaf"}
            size={22}
            color={isDone ? colors.success : colors.primary}
          />
        </View>
      </View>

      <View className="flex-row gap-2">
        <SummaryPill
          label="Done"
          value={`${completedCount}/${total || MAX_TASKS}`}
        />
        <SummaryPill label="Open" value={`${remainingTasks}`} />
        <SummaryPill
          label={locked ? "Set" : "Open slots"}
          value={locked ? "Yes" : `${remainingSlots}`}
        />
      </View>
    </View>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View className="flex-1 rounded-2xl bg-background border border-border p-3">
      <Text
        className="text-xs uppercase tracking-wide"
        style={{ color: colors.muted }}
      >
        {label}
      </Text>
      <Text className="text-lg font-bold text-foreground mt-1">{value}</Text>
    </View>
  );
}

function getHeadline({
  isDone,
  locked,
  total,
  remainingTasks,
  remainingSlots,
}: {
  isDone: boolean;
  locked: boolean;
  total: number;
  remainingTasks: number;
  remainingSlots: number;
}) {
  if (isDone) return "A complete day";
  if (locked && remainingTasks > 0) return `${remainingTasks} left to finish`;
  if (total === 0) return "Choose Today's Three";
  if (remainingSlots > 0) return "Still shaping today";
  return "Today's Three are set";
}

function getSubcopy({
  isDone,
  locked,
  total,
  remainingTasks,
  remainingSlots,
}: {
  isDone: boolean;
  locked: boolean;
  total: number;
  remainingTasks: number;
  remainingSlots: number;
}) {
  if (isDone) return "You kept the list small and finished what mattered.";
  if (locked && remainingTasks > 0)
    return "The day is chosen. Now the work is simply to finish.";
  if (total === 0)
    return "Pick the focus commitments that would make today feel meaningfully complete.";
  if (remainingSlots > 0)
    return "You can choose fewer than three. Enough is allowed.";
  return "Protect your attention and move through the three calmly.";
}
