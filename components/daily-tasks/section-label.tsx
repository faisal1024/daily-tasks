import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { DisplayFont } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";

interface SectionLabelProps {
  /** Leading icon (Ionicons name) shown inside the chip. */
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
}

/**
 * The soft rounded "status chip" header used across the app. Self-sizing (does
 * not stretch full width). Icons, not emoji: emoji are read aloud by VoiceOver
 * and look out of place in native UI.
 */
export function SectionLabel({ icon, label }: SectionLabelProps) {
  const colors = useColors();
  return (
    <View
      className="self-start flex-row items-center gap-2 rounded-2xl px-3.5 py-2"
      style={{ backgroundColor: `${colors.primary}16` }}
      // One accessible element with the header trait (so it's in the
      // VoiceOver Headings rotor); the icon is decorative.
      accessible
      accessibilityRole="header"
      accessibilityLabel={label}
    >
      {icon && (
        <Ionicons
          name={icon}
          size={16}
          color={colors.primary}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
      <Text className="text-base" style={{ color: colors.primary, fontFamily: DisplayFont.semibold }}>
        {label}
      </Text>
    </View>
  );
}
