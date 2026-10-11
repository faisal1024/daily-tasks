import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import { LOCKED_HINT, type TodayStatus } from "@/lib/daily-tasks/today-view";

interface StatusLineProps {
  status: TodayStatus;
  onLock: () => void;
}

/**
 * One line under the tasks: where the day stands, plus "Set today". A set day
 * shows a quiet locked state and nothing to tap (1.4): unlocking lives in
 * Settings only, so changing a set day takes a deliberate step.
 */
export function StatusLine({ status, onLock }: StatusLineProps) {
  const colors = useColors();
  const locked = status.kind === "set" || status.kind === "auto";

  if (locked) {
    return (
      <View
        className="flex-row items-center gap-2"
        accessible
        // The words already say the day is set; the lock glyph adds nothing to hear.
        accessibilityLabel={status.text}
        accessibilityHint={LOCKED_HINT}
        testID="status-line"
      >
        <Ionicons name="lock-closed" size={14} color={colors.muted} testID="status-locked" />
        <View className="flex-1">
          <Text className="text-sm" style={{ color: colors.muted }}>
            {status.text}
          </Text>
          <Text className="text-xs" style={{ color: colors.muted }} testID="status-locked-hint">
            {LOCKED_HINT}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2" testID="status-line">
      <Text className="flex-1 text-sm" style={{ color: colors.muted }}>
        {status.text}
      </Text>
      {status.canLock && (
        <Pressable
          onPress={onLock}
          accessibilityRole="button"
          accessibilityLabel="Set today's tasks"
          accessibilityHint="You can still check tasks off. Adding and changing pause until you unlock today in Settings."
          hitSlop={8}
          className="rounded-full px-4 py-2"
          style={{ backgroundColor: `${colors.primary}18` }}
        >
          <View className="flex-row items-center gap-1">
            <Ionicons name="pin-outline" size={14} color={colors.primary} />
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Set today
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
