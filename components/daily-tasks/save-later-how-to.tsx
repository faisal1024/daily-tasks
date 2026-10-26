// The small how-to behind "Show me" (1.6): the share sheet, the Siri phrase,
// the Dump widget. Shown in place, in What's new's first card and in the new
// install's "Save for later from anywhere" card on Today.
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import { WHATS_NEW_16_COPY } from "@/lib/daily-tasks/whats-new-16";

export function SaveLaterHowTo({ testID }: { testID: string }) {
  const colors = useColors();
  return (
    <View className="gap-2 pt-1" testID={testID}>
      {WHATS_NEW_16_COPY.saveLater.steps.map((step) => (
        <View key={step.text} className="flex-row gap-3 items-start">
          <Ionicons
            name={step.icon}
            size={18}
            color={colors.primary}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text className="flex-1 text-sm text-foreground">{step.text}</Text>
        </View>
      ))}
    </View>
  );
}
