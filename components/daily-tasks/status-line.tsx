import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import type { TodayStatus } from "@/lib/daily-tasks/today-view";

interface StatusLineProps {
  status: TodayStatus;
  onLock: () => void;
  /** "Unlock" on a locked day's line; the screen asks first (1.5). */
  onUnlock: () => void;
}

/**
 * One line under the tasks: where the day stands, plus "Lock today". A locked
 * day reads "Today is locked. N to go." with an inline "Unlock" right on the
 * line (1.5). Unlocking always asks first, so changing a locked day is still
 * a deliberate step, just not a trip to Settings.
 */
export function StatusLine({ status, onLock, onUnlock }: StatusLineProps) {
  const colors = useColors();
  const locked = status.kind === "set" || status.kind === "auto";

  if (locked) {
    return (
      <View className="flex-row items-center gap-2" testID="status-line">
        {/* The words already say the day is locked; the glyph adds nothing to hear. */}
        <Ionicons
          name="lock-closed"
          size={14}
          color={colors.muted}
          testID="status-locked"
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text className="flex-1 text-sm" style={{ color: colors.muted }}>
          {status.text}
        </Text>
        <Pressable
          onPress={onUnlock}
          accessibilityRole="button"
          accessibilityLabel="Unlock today"
          accessibilityHint="Asks first, then lets you change today's three"
          hitSlop={12}
          className="justify-center px-2"
          style={{ minHeight: 44 }}
          testID="status-unlock"
        >
          <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
            Unlock
          </Text>
        </Pressable>
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
          accessibilityLabel="Lock today"
          accessibilityHint="You can still check tasks off. Adding and changing pause until you unlock it."
          hitSlop={8}
          className="rounded-full px-4 py-2"
          style={{ backgroundColor: `${colors.primary}18` }}
        >
          <View className="flex-row items-center gap-1">
            <Ionicons name="lock-closed-outline" size={14} color={colors.primary} />
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              Lock today
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
