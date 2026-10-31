// "Which task makes way?" for a swap on a full day (a saved item's "Swap in",
// a routine's "Swap"). iOS asks in a menu; Android lists the choices under the
// row instead (an alert has room for three buttons, and three open tasks need
// a Cancel too).
import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import { showActionSheet } from "@/lib/daily-tasks/action-sheet";

/** Asks which of today's open tasks it replaces. */
export const SWAP_IN_QUESTION = "Which task should it replace? That one goes to Saved for later.";

/** What a swap button's VoiceOver hint says. */
export const SWAP_HINT = "Choose which task it replaces. That task goes to Saved for later.";

export type SwapTarget = { id: string; text: string };

/**
 * iOS: shows the menu and returns true (onPick runs with the chosen task).
 * Elsewhere returns false: the caller shows <SwapChoices> under the row.
 */
export function askSwapTarget(itemText: string, targets: readonly SwapTarget[], onPick: (taskId: string) => void): boolean {
  if (Platform.OS !== "ios") return false;
  showActionSheet(
    {
      title: `Swap in “${itemText}”`,
      message: SWAP_IN_QUESTION,
      options: [...targets.map((t) => t.text), "Cancel"],
      cancelButtonIndex: targets.length,
    },
    (index) => {
      const target = targets[index];
      if (target) onPick(target.id);
    },
  );
  return true;
}

/** Android: the open tasks as buttons under the row, plus Cancel. */
export function SwapChoices({
  targets,
  onPick,
  onCancel,
  testID,
}: {
  targets: readonly SwapTarget[];
  onPick: (taskId: string) => void;
  onCancel: () => void;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <View className="gap-2 px-1" testID={testID}>
      <Text className="text-sm" style={{ color: colors.muted }}>
        {SWAP_IN_QUESTION}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {targets.map((target) => (
          <Pressable
            key={target.id}
            onPress={() => onPick(target.id)}
            accessibilityRole="button"
            accessibilityLabel={`Replace ${target.text}`}
            className="rounded-full px-3 justify-center"
            style={{ minHeight: 44, borderWidth: 1, borderColor: colors.primary }}
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              {target.text}
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          className="rounded-full px-3 justify-center"
          style={{ minHeight: 44 }}
        >
          <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * One row-at-a-time swap chooser: `press(item)` asks on iOS, or opens the
 * choices under that row on Android (`choosingId`); `pick` and `cancel` close
 * them. Closed again when swapping stops being possible or the list hides.
 */
export function useSwapChooser({
  enabled,
  targets,
  onSwap,
  visible = true,
}: {
  enabled: boolean;
  targets: readonly SwapTarget[];
  onSwap?: (itemId: string, taskId: string) => void;
  visible?: boolean;
}) {
  const [choosingId, setChoosingId] = useState<string | null>(null);
  const open = enabled && visible && Boolean(onSwap);
  useEffect(() => {
    if (!open) setChoosingId(null);
  }, [open]);
  const press = (item: SwapTarget) => {
    if (!open || !onSwap) return;
    if (askSwapTarget(item.text, targets, (taskId) => onSwap(item.id, taskId))) return;
    setChoosingId((current) => (current === item.id ? null : item.id));
  };
  const pick = (itemId: string, taskId: string) => {
    setChoosingId(null);
    onSwap?.(itemId, taskId);
  };
  const cancel = () => setChoosingId(null);
  return { choosingId: open ? choosingId : null, press, pick, cancel };
}
