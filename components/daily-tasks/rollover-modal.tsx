import { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";

import { useColors } from "@/hooks/use-colors";
import type { PendingRollover, TaskId } from "@/lib/daily-tasks/types";

interface RolloverModalProps {
  visible: boolean;
  pending: PendingRollover | null;
  remainingSlots: number;
  currentTaskCount: number;
  onApply: (carriedTaskIds: TaskId[]) => void;
}

export function RolloverModal({
  visible,
  pending,
  remainingSlots,
  currentTaskCount,
  onApply,
}: RolloverModalProps) {
  const colors = useColors();
  const [selectedIds, setSelectedIds] = useState<TaskId[]>([]);

  useEffect(() => {
    if (!pending) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(
      pending.tasks.slice(0, remainingSlots).map((task) => task.id),
    );
  }, [pending, remainingSlots]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  if (!pending) return null;

  const toggleTask = (taskId: TaskId) => {
    setSelectedIds((current) => {
      if (current.includes(taskId)) {
        return current.filter((id) => id !== taskId);
      }
      if (current.length >= remainingSlots) {
        return current;
      }
      return [...current, taskId];
    });
  };

  const carryAll = () => {
    setSelectedIds(
      pending.tasks.slice(0, remainingSlots).map((task) => task.id),
    );
  };

  const dropAll = () => {
    setSelectedIds([]);
  };

  const selectedCount = selectedIds.length;
  const hasAvailableSlots = remainingSlots > 0;
  const slotsMessage = hasAvailableSlots
    ? `You can carry ${remainingSlots} more ${remainingSlots === 1 ? "focus" : "focuses"} into today.`
    : "Today's Three is full, so yesterday's unfinished work can only be released.";
  const decisionMessage = hasAvailableSlots
    ? `${selectedCount} selected to carry forward. Released work stays in yesterday's history.`
    : "Nothing will be erased. Released work stays in yesterday's history.";

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View
        className="flex-1 justify-end"
        style={{ backgroundColor: "rgba(15, 23, 42, 0.36)" }}
      >
        <View className="rounded-t-3xl bg-background p-6 gap-4">
          <View className="gap-1">
            <Text className="text-base text-muted">New day</Text>
            <Text className="text-2xl font-bold text-foreground">
              Carry forward or release
            </Text>
          </View>

          <Text className="text-sm text-muted">
            Yesterday is done. Choose what still deserves one of today's three
            slots.
          </Text>

          <View
            className="rounded-2xl p-4 border border-border"
            style={{ backgroundColor: `${colors.primary}10` }}
          >
            <Text className="text-sm font-semibold text-foreground">
              {slotsMessage}
            </Text>
            <Text className="text-xs mt-1" style={{ color: colors.muted }}>
              You already have {currentTaskCount} of 3 focus slots filled today.{" "}
              {decisionMessage}
            </Text>
          </View>

          <View className="flex-row gap-3">
            <QuickAction
              label={
                hasAvailableSlots ? "Carry all that fit" : "No room to carry"
              }
              disabled={!hasAvailableSlots}
              onPress={carryAll}
            />
            <QuickAction label="Release all" onPress={dropAll} />
          </View>

          <ScrollView
            style={{ maxHeight: 320 }}
            contentContainerStyle={{ gap: 12 }}
          >
            {pending.tasks.map((task) => {
              const selected = selectedSet.has(task.id);
              const carryDisabled =
                !selected && selectedIds.length >= remainingSlots;

              return (
                <View
                  key={task.id}
                  className="rounded-2xl border border-border p-4 gap-3 bg-surface"
                >
                  <Text className="text-base text-foreground">{task.text}</Text>
                  <View className="flex-row gap-3">
                    <ChoiceButton
                      label={
                        remainingSlots === 0 ? "No room today" : "Carry forward"
                      }
                      active={selected}
                      disabled={remainingSlots === 0 || carryDisabled}
                      onPress={() => toggleTask(task.id)}
                    />
                    <ChoiceButton
                      label="Release"
                      active={!selected}
                      onPress={() =>
                        setSelectedIds((current) =>
                          current.filter((id) => id !== task.id),
                        )
                      }
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>

          <Pressable
            onPress={() => onApply(selectedIds)}
            className="rounded-full px-5 py-4 items-center"
            style={{ backgroundColor: colors.primary }}
          >
            <Text
              className="text-base font-semibold"
              style={{ color: colors.background }}
            >
              Save today's choices
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function QuickAction({
  label,
  disabled = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="rounded-full border border-border px-4 py-2"
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <Text className="text-sm font-semibold text-foreground">{label}</Text>
    </Pressable>
  );
}

function ChoiceButton({
  label,
  active,
  disabled = false,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="rounded-full border px-4 py-2"
      style={{
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? `${colors.primary}16` : "transparent",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text
        className="text-sm font-semibold"
        style={{ color: active ? colors.primary : colors.foreground }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
