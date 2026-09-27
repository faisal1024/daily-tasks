import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import type { TodayStatus } from "@/lib/daily-tasks/today-view";

interface StatusLineProps {
  status: TodayStatus;
  onLock: () => void;
  /** Undo "Set" right here (it used to live only in Settings). */
  onUnlock?: () => void;
}

/** One line under the tasks: where the day stands, plus Set / Change. */
export function StatusLine({ status, onLock, onUnlock }: StatusLineProps) {
  const colors = useColors();
  const locked = status.kind === "set" || status.kind === "auto";

  return (
    <View className="flex-row items-center gap-2" testID="status-line">
      {locked && <Ionicons name="pin" size={14} color={colors.muted} />}
      <Text className="flex-1 text-sm" style={{ color: colors.muted }}>
        {status.text}
      </Text>
      {status.canLock && (
        <Pressable
          onPress={onLock}
          accessibilityRole="button"
          accessibilityLabel="Set today's tasks"
          accessibilityHint="You can still check tasks off, but won't add or change them today."
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
      {locked && onUnlock && (
        <Pressable
          onPress={onUnlock}
          accessibilityRole="button"
          accessibilityLabel="Change today's tasks"
          accessibilityHint="Lets you add or change today's tasks again."
          hitSlop={10}
          className="px-2 py-1"
          testID="status-unlock"
        >
          <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
            Change
          </Text>
        </Pressable>
      )}
    </View>
  );
}
