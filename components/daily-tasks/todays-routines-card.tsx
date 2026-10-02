// Today's routines on Today (1.3): routines due today and not on the list
// yet, right under the task card, each with a compact "+ Add". A quiet
// suggestion, never a slot filler: when today is full or set the Add buttons
// are off and one muted line says why. Nothing is ever marked missed.
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/use-colors";
import { routineBlockedLine, type RoutineBlock } from "@/lib/daily-tasks/routines";

export function TodaysRoutinesCard({
  routines,
  block,
  onAdd,
  onEdit,
}: {
  routines: { id: string; text: string }[];
  /** Why Add is off right now (set or full), or null. */
  block: RoutineBlock;
  onAdd: (id: string) => void;
  /** Opens the routines sheet. */
  onEdit: () => void;
}) {
  const colors = useColors();
  const blockedLine = routineBlockedLine(block);
  const disabled = blockedLine !== null;
  return (
    <View
      className="rounded-3xl border px-4 pt-1 pb-2"
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}
      testID="today-routines"
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text
          accessibilityRole="header"
          className="flex-1 text-sm font-semibold"
          style={{ color: colors.muted }}
        >
          Today&apos;s routines
        </Text>
        <Pressable
          onPress={onEdit}
          accessibilityRole="button"
          accessibilityLabel="Edit routines"
          accessibilityHint="Opens routines"
          style={{ minHeight: 44, minWidth: 44, alignItems: "flex-end", justifyContent: "center" }}
          testID="today-routines-edit"
        >
          <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
            Edit
          </Text>
        </Pressable>
      </View>
      {blockedLine && (
        <Text className="text-sm pb-1" style={{ color: colors.muted }} testID="today-routines-blocked">
          {blockedLine}
        </Text>
      )}
      {routines.map((routine, index) => (
        <View key={routine.id}>
          {index > 0 && <View style={{ height: 1, backgroundColor: colors.border, marginLeft: 26 }} />}
          <View
            className="flex-row items-center gap-2.5 py-1.5"
            style={{ minHeight: 52 }}
            testID={`today-routine-${routine.id}`}
          >
            <Ionicons
              name="repeat"
              size={16}
              color={colors.muted}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            {/* The Add button carries the words for VoiceOver, so they're said once. */}
            <Text
              className="flex-1 text-base text-foreground"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {routine.text}
            </Text>
            <Pressable
              onPress={() => onAdd(routine.id)}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Add ${routine.text} to today`}
              accessibilityHint={blockedLine ?? "Adds this routine to today's three"}
              accessibilityState={{ disabled }}
              className="flex-row items-center justify-center gap-1 rounded-full px-3.5"
              style={{
                minHeight: 44,
                minWidth: 44,
                flexShrink: 0,
                backgroundColor: disabled ? "transparent" : `${colors.primary}16`,
                opacity: disabled ? 0.45 : 1,
              }}
              testID={`today-routine-add-${routine.id}`}
            >
              <Ionicons name="add" size={16} color={disabled ? colors.muted : colors.primary} />
              <Text
                className="text-sm font-semibold"
                style={{ color: disabled ? colors.muted : colors.primary }}
              >
                Add
              </Text>
            </Pressable>
          </View>
        </View>
      ))}
    </View>
  );
}
