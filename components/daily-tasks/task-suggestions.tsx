import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import type { CatalogTask } from "@/lib/daily-tasks/task-catalog";
import { USER_GOAL_META } from "@/lib/daily-tasks/task-catalog";

interface TaskSuggestionsProps {
  suggestion: CatalogTask | null;
  onAccept: (text: string) => void;
  onShuffle: () => void;
  onCustom: () => void;
}

export function TaskSuggestions({
  suggestion,
  onAccept,
  onShuffle,
  onCustom,
}: TaskSuggestionsProps) {
  const colors = useColors();

  if (!suggestion) return null;
  const goal = USER_GOAL_META[suggestion.goal];

  return (
    <View className="rounded-2xl border border-border bg-surface p-4 gap-3">
      <View className="flex-row items-start gap-3">
        <View
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: `${colors.primary}18` }}
        >
          <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
        </View>
        <View className="flex-1 gap-1">
          <Text className="text-xs uppercase tracking-wide" style={{ color: colors.muted }}>
            Suggested from {goal.label}
          </Text>
          <Text className="text-base font-semibold text-foreground">
            {suggestion.text}
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        <Pressable
          onPress={() => onAccept(suggestion.text)}
          accessibilityRole="button"
          accessibilityLabel={`Accept suggested focus: ${suggestion.text}`}
          className="rounded-full px-4 py-2"
          style={{ backgroundColor: colors.primary }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.background }}>
            Accept
          </Text>
        </Pressable>
        <Pressable
          onPress={onShuffle}
          accessibilityRole="button"
          accessibilityLabel="Pick another suggested focus"
          className="rounded-full px-4 py-2 border border-border flex-row items-center gap-1"
        >
          <Ionicons name="shuffle" size={15} color={colors.foreground} />
          <Text className="text-sm font-semibold text-foreground">Different one</Text>
        </Pressable>
        <Pressable
          onPress={onCustom}
          accessibilityRole="button"
          accessibilityLabel="Enter my own focus"
          className="rounded-full px-4 py-2 border border-border"
        >
          <Text className="text-sm font-semibold text-foreground">Enter my own</Text>
        </Pressable>
      </View>
    </View>
  );
}
