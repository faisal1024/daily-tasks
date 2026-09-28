import { Pressable, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";

/** Midday's "Next on your path: <next open milestone>". Tapping opens Progress. */
export function NextPathLink({ title, onPress }: { title: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Next on your path: ${title}.`}
      accessibilityHint="Opens Progress"
      // All inline (no className): a style function needs the full style.
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 24,
        borderWidth: 1,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.7 : 1,
      })}
      testID="next-path-link"
    >
      <Ionicons name="trail-sign-outline" size={18} color={colors.primary} />
      <Text className="flex-1 text-base text-foreground" numberOfLines={2}>
        <Text style={{ color: colors.muted }}>Next on your path: </Text>
        <Text className="font-semibold">{title}</Text>
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  );
}
