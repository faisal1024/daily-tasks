import { Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";

interface SectionLabelProps {
  /** Leading emoji shown inside the chip. */
  emoji?: string;
  label: string;
}

/**
 * The friendly "status chip" header used across the app — a soft rounded pill
 * with the hero's playful feel. Self-sizing (does not stretch full width).
 */
export function SectionLabel({ emoji, label }: SectionLabelProps) {
  const colors = useColors();
  return (
    <View
      className="self-start flex-row items-center rounded-2xl px-3.5 py-2"
      style={{ backgroundColor: `${colors.primary}16` }}
    >
      <Text className="text-sm font-extrabold" style={{ color: colors.primary }}>
        {emoji ? `${emoji}  ` : ""}
        {label}
      </Text>
    </View>
  );
}
