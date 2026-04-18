import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";

interface StreakPillProps {
  icon: "flame" | "star";
  label: string;
  value: number;
}

export function StreakPill({ icon, label, value }: StreakPillProps) {
  const colors = useColors();
  const tint = icon === "flame" ? colors.warning : colors.primary;
  return (
    <View className="flex-1 bg-surface rounded-2xl p-4 border border-border">
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={18} color={tint} />
        <Text className="text-xs text-muted uppercase tracking-wide">{label}</Text>
      </View>
      <Text className="text-2xl font-bold text-foreground mt-2">{value}</Text>
    </View>
  );
}
