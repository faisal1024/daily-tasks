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
  const tint = icon === "flame" ? colors.accent : colors.primary;
  return (
    <View
      className="flex-1 rounded-3xl p-4 border"
      style={{ backgroundColor: `${tint}12`, borderColor: `${tint}33` }}
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={20} color={tint} />
        <Text className="text-sm uppercase tracking-wide font-semibold" style={{ color: tint }}>
          {label}
        </Text>
      </View>
      <Text className="text-3xl font-extrabold text-foreground mt-2">{value}</Text>
    </View>
  );
}
