import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import type { PendingRollover, TaskId } from "@/lib/daily-tasks/types";

interface RolloverModalProps {
  /** @deprecated the card shows whenever there's something pending. */
  visible?: boolean;
  pending: PendingRollover | null;
  remainingSlots: number;
  /** @deprecated unused; kept optional for callers. */
  currentTaskCount?: number;
  onApply: (carriedTaskIds: TaskId[]) => void;
}

/**
 * New day, one decision: tick what still matters and bring it in, or start
 * fresh. What isn't brought in stays in yesterday's history.
 *
 * A card on Today, not a modal: a modal blocked everything behind it (last
 * night's draft looked tappable but wasn't), and iOS can't stack a sheet on it.
 */
export function RolloverModal({ pending, remainingSlots, onApply }: RolloverModalProps) {
  const colors = useColors();
  const [selectedIds, setSelectedIds] = useState<TaskId[]>([]);

  useEffect(() => {
    setSelectedIds(pending ? pending.tasks.slice(0, remainingSlots).map((task) => task.id) : []);
  }, [pending, remainingSlots]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  if (!pending) return null;

  const hasRoom = remainingSlots > 0;
  const count = selectedIds.length;

  const toggle = (taskId: TaskId) => {
    setSelectedIds((current) => {
      if (current.includes(taskId)) return current.filter((id) => id !== taskId);
      if (current.length >= remainingSlots) return current;
      return [...current, taskId];
    });
  };

  return (
    <View
      className="rounded-3xl border p-5 gap-4"
      style={{ borderColor: colors.primary, backgroundColor: colors.surface }}
      testID="rollover-card"
    >
      <View className="gap-1">
        <Text
          accessibilityRole="header"
          style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontSize: 20, fontWeight: "800" }}
        >
          From before
        </Text>
        <Text className="text-base" style={{ color: colors.muted }}>
          {!hasRoom
            ? "Today's three are already full, so these stay in your history."
            : pending.tasks.length === 1
              ? "This one wasn't finished. Bring it into today? If not, it stays in your history."
              : remainingSlots === 1
                ? "These weren't finished. Room for 1 today: tick the one that matters most. The rest stay in your history."
                : `These weren't finished. Room for ${Math.min(remainingSlots, 3)} today: tick what still matters. The rest stay in your history.`}
        </Text>
      </View>

      <View
        className="rounded-2xl border overflow-hidden"
        style={{ borderColor: colors.border, backgroundColor: colors.background }}
      >
        {pending.tasks.map((task, index) => {
          const on = selectedSet.has(task.id);
          const full = !on && count >= remainingSlots;
          return (
            <View key={task.id}>
              {index > 0 ? <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 52 }} /> : null}
              <Pressable
                onPress={() => toggle(task.id)}
                disabled={!hasRoom || full}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !hasRoom || full }}
                accessibilityLabel={task.text}
                accessibilityHint={full ? "Today is full. Untick another one first." : undefined}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  opacity: !hasRoom || full ? 0.5 : 1,
                }}
              >
                <Ionicons
                  name={on ? "checkmark-circle" : "ellipse-outline"}
                  size={24}
                  color={on ? colors.primary : colors.muted}
                  accessibilityElementsHidden
                />
                <Text className="flex-1 text-base text-foreground" style={{ fontWeight: "600" }}>
                  {task.text}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </View>

      <View className="gap-2">
        <Pressable
          onPress={() => onApply(hasRoom ? selectedIds : [])}
          accessibilityRole="button"
          style={{ borderRadius: 999, paddingVertical: 16, alignItems: "center", backgroundColor: colors.primary }}
          testID="rollover-apply"
        >
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 17 }}>
            {!hasRoom
              ? "Got it"
              : count === 0
                ? "Start fresh"
                : count === 1
                  ? "Bring 1 into today"
                  : `Bring ${count} into today`}
          </Text>
        </Pressable>
        {hasRoom && count > 0 ? (
          <Pressable
            onPress={() => onApply([])}
            accessibilityRole="button"
            hitSlop={8}
            style={{ alignItems: "center", paddingVertical: 8 }}
            testID="rollover-fresh"
          >
            <Text className="text-base font-semibold" style={{ color: colors.primary }}>
              Start fresh
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
