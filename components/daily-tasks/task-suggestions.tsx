import { Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

interface TaskSuggestionsProps {
  suggestions: string[];
  title?: string;
  onPick: (text: string) => void;
}

export function TaskSuggestions({
  suggestions,
  title = "Gentle starting points",
  onPick,
}: TaskSuggestionsProps) {
  const colors = useColors();

  if (suggestions.length === 0) return null;

  return (
    <View className="gap-2">
      <Text
        className="text-xs uppercase tracking-wide"
        style={{ color: colors.muted }}
      >
        {title}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {suggestions.map((text) => (
          <Pressable
            key={text}
            onPress={() => onPick(text)}
            accessibilityRole="button"
            accessibilityLabel={`Choose suggested focus: ${text}`}
            className="rounded-full px-3 py-2 border"
            style={{
              borderColor: colors.border,
              backgroundColor: colors.surface,
            }}
          >
            <Text className="text-sm text-foreground">{text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
