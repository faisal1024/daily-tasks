// Manage routines (1.3), opened from Settings › Routines: add one (words +
// days), edit, pause/resume, delete. Routines never fill a slot by
// themselves; on their days they wait in the Ideas sheet.
import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import {
  ALL_DAYS,
  cleanDays,
  cleanRoutineText,
  DAY_NAMES,
  DAY_PRESETS,
  DAY_SHORT,
  describeDays,
  describeDaysForAccessibility,
  MAX_ROUTINE_TEXT,
  PICKER_ORDER,
  presetFor,
  type DaysPreset,
} from "@/lib/daily-tasks/routines";
import type { Routine } from "@/lib/daily-tasks/types";

export const ROUTINES_EMPTY_COPY =
  "Things you do on repeat. They'll wait in Ideas on their days — you choose if they make today's three.";

interface RoutinesSheetProps {
  visible: boolean;
  routines: Routine[];
  /** False when a free user is at the limit: "Add a routine" asks for Plus instead. */
  canAdd: boolean;
  onAdd: (text: string, days: number[]) => "added" | "limit" | "invalid";
  /** Tapped "Add a routine" at the free limit (the sheet closes, then the paywall opens). */
  onLimit: () => void;
  onUpdate: (id: string, text: string, days: number[]) => void;
  onSetPaused: (id: string, paused: boolean) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

type Editing = { kind: "new" } | { kind: "edit"; routine: Routine } | null;

export function RoutinesSheet({
  visible,
  routines,
  canAdd,
  onAdd,
  onLimit,
  onUpdate,
  onSetPaused,
  onRemove,
  onClose,
}: RoutinesSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const sheetAnimation = useSheetAnimation();
  const [editing, setEditing] = useState<Editing>(null);

  const close = () => {
    setEditing(null);
    onClose();
  };

  const startAdd = () => {
    if (!canAdd) {
      setEditing(null);
      onLimit();
      return;
    }
    setEditing({ kind: "new" });
  };

  const confirmRemove = (routine: Routine) => {
    Alert.alert(
      "Delete this routine?",
      `“${routine.text}” won't be suggested again. Anything already on today stays.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => onRemove(routine.id) },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      onRequestClose={editing ? () => setEditing(null) : close}
      animationType={sheetAnimation}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        testID="routines-sheet"
      >
        {editing ? (
          <RoutineEditor
            key={editing.kind === "edit" ? editing.routine.id : "new"}
            initial={editing.kind === "edit" ? editing.routine : null}
            onCancel={() => setEditing(null)}
            onSave={(text, days) => {
              if (editing.kind === "edit") {
                onUpdate(editing.routine.id, text, days);
                setEditing(null);
                return;
              }
              const result = onAdd(text, days);
              if (result === "limit") {
                setEditing(null);
                onLimit();
                return;
              }
              if (result === "added") setEditing(null);
            }}
          />
        ) : (
          <>
            <View
              className="flex-row items-center justify-between px-5"
              style={{ paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12 }}
            >
              <Text
                accessibilityRole="header"
                className="text-2xl text-foreground"
                style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}
              >
                Routines
              </Text>
              <Pressable
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Close routines"
                hitSlop={10}
                className="items-center justify-center"
                style={{ minWidth: 44, minHeight: 44 }}
              >
                <Ionicons name="close" size={26} color={colors.muted} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{
                padding: 20,
                paddingBottom: insets.bottom + 32,
                gap: 12,
                width: "100%",
                maxWidth: 720,
                alignSelf: "center",
              }}
            >
              <Text className="text-base" style={{ color: colors.muted }} testID="routines-explainer">
                {ROUTINES_EMPTY_COPY}
              </Text>

              {routines.map((routine) => (
                <RoutineRow
                  key={routine.id}
                  routine={routine}
                  onEdit={() => setEditing({ kind: "edit", routine })}
                  onTogglePaused={() => onSetPaused(routine.id, !routine.paused)}
                  onRemove={() => confirmRemove(routine)}
                />
              ))}

              <Pressable
                onPress={startAdd}
                accessibilityRole="button"
                accessibilityLabel="Add a routine"
                accessibilityHint={canAdd ? undefined : "Free keeps two routines. Opens Plus."}
                className="flex-row items-center justify-center gap-2 rounded-2xl border py-3"
                style={{ borderColor: colors.border, borderStyle: "dashed", minHeight: 44 }}
                testID="routines-add"
              >
                <Ionicons name="add" size={18} color={colors.primary} />
                <Text className="text-base font-semibold" style={{ color: colors.primary }}>
                  Add a routine
                </Text>
              </Pressable>
            </ScrollView>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RoutineRow({
  routine,
  onEdit,
  onTogglePaused,
  onRemove,
}: {
  routine: Routine;
  onEdit: () => void;
  onTogglePaused: () => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const spokenDays = describeDaysForAccessibility(routine.days);
  return (
    <View
      className="rounded-2xl border p-3 gap-2"
      style={{ borderColor: colors.border, backgroundColor: colors.surface }}
      testID={`routine-row-${routine.id}`}
    >
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`${routine.text}, ${spokenDays}${routine.paused ? ", paused" : ""}`}
        accessibilityHint="Edit this routine"
        className="gap-0.5"
        style={{ minHeight: 44, justifyContent: "center", opacity: routine.paused ? 0.6 : 1 }}
      >
        <Text className="text-base text-foreground" style={{ fontWeight: "700" }}>
          {routine.text}
        </Text>
        <Text className="text-sm" style={{ color: colors.muted }}>
          {describeDays(routine.days)}
          {routine.paused ? " · Paused" : ""}
        </Text>
      </Pressable>
      <View className="flex-row flex-wrap gap-2">
        <SmallButton
          icon={routine.paused ? "play-outline" : "pause-outline"}
          label={routine.paused ? "Resume" : "Pause"}
          accessibilityLabel={`${routine.paused ? "Resume" : "Pause"} ${routine.text}`}
          onPress={onTogglePaused}
        />
        <SmallButton
          icon="trash-outline"
          label="Delete"
          accessibilityLabel={`Delete ${routine.text}`}
          onPress={onRemove}
        />
      </View>
    </View>
  );
}

function SmallButton({
  icon,
  label,
  accessibilityLabel,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      className="flex-row items-center gap-1.5 rounded-full px-4"
      style={{ minHeight: 44, backgroundColor: `${colors.primary}16` }}
    >
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
        {label}
      </Text>
    </Pressable>
  );
}

function RoutineEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial: Routine | null;
  onCancel: () => void;
  onSave: (text: string, days: number[]) => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const startDays = initial ? cleanDays(initial.days) : [...ALL_DAYS];
  const [text, setText] = useState(initial?.text ?? "");
  const [days, setDays] = useState<number[]>(startDays);
  // "Custom days" stays picked once chosen, even if the days happen to match a preset later.
  const [custom, setCustom] = useState(presetFor(startDays) === "custom");
  const selected: DaysPreset = custom ? "custom" : presetFor(days);
  const canSave = cleanRoutineText(text) !== null && days.length > 0;

  const pickPreset = (preset: DaysPreset) => {
    if (preset === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    setDays([...(DAY_PRESETS.find((p) => p.id === preset)?.days ?? ALL_DAYS)]);
  };

  const toggleDay = (day: number) => {
    const next = days.includes(day) ? days.filter((d) => d !== day) : cleanDays([...days, day]);
    setDays(next);
    setCustom(presetFor(next) === "custom");
  };

  const presets: { id: DaysPreset; label: string }[] = [
    ...DAY_PRESETS.map(({ id, label }) => ({ id, label })),
    { id: "custom", label: "Custom days" },
  ];

  return (
    <>
      <View
        className="flex-row items-center justify-between px-5"
        style={{ paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12 }}
      >
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          hitSlop={10}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text className="text-base" style={{ color: colors.primary }}>
            Cancel
          </Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontSize: 18, fontWeight: "700" }}
        >
          {initial ? "Edit routine" : "New routine"}
        </Text>
        <Pressable
          onPress={() => canSave && onSave(text, days)}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save routine"
          accessibilityState={{ disabled: !canSave }}
          hitSlop={10}
          style={{ minHeight: 44, justifyContent: "center" }}
          testID="routine-save"
        >
          <Text className="text-base font-bold" style={{ color: colors.primary, opacity: canSave ? 1 : 0.4 }}>
            Save
          </Text>
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: 20,
          paddingBottom: insets.bottom + 32,
          gap: 16,
          width: "100%",
          maxWidth: 720,
          alignSelf: "center",
        }}
      >
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="e.g. Walk after lunch"
          placeholderTextColor={colors.muted}
          maxLength={MAX_ROUTINE_TEXT}
          autoFocus={!initial}
          returnKeyType="done"
          accessibilityLabel="Routine"
          className="text-base rounded-xl px-3 py-3"
          style={{
            color: colors.foreground,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            minHeight: 44,
          }}
          testID="routine-text"
        />

        <View className="gap-2">
          <Text accessibilityRole="header" className="text-sm font-semibold text-foreground">
            Days
          </Text>
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            {presets.map((preset) => {
              const on = selected === preset.id;
              return (
                <Pressable
                  key={preset.id}
                  onPress={() => pickPreset(preset.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={preset.label}
                  accessibilityState={{ selected: on, checked: on }}
                  className="rounded-full px-4 border items-center justify-center"
                  style={{
                    minHeight: 44,
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? `${colors.primary}16` : colors.background,
                  }}
                  testID={`routine-preset-${preset.id}`}
                >
                  <Text className="text-sm font-semibold" style={{ color: on ? colors.primary : colors.text }}>
                    {preset.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View className="flex-row flex-wrap gap-2 mt-1">
            {PICKER_ORDER.map((day) => {
              const on = days.includes(day);
              return (
                <Pressable
                  key={day}
                  onPress={() => toggleDay(day)}
                  accessibilityRole="button"
                  // Spoken state in the label ("Monday, selected"), not a trait,
                  // so it's read once and the same way on every platform.
                  accessibilityLabel={`${DAY_NAMES[day]}, ${on ? "selected" : "not selected"}`}
                  accessibilityHint={on ? "Removes this day" : "Adds this day"}
                  className="rounded-full border items-center justify-center px-2"
                  style={{
                    minWidth: 44,
                    minHeight: 44,
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary : colors.background,
                  }}
                  testID={`routine-day-${day}`}
                >
                  <Text className="text-sm font-semibold" style={{ color: on ? colors.onPrimary : colors.text }}>
                    {DAY_SHORT[day]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {days.length === 0 && (
            <Text className="text-sm" style={{ color: colors.muted }}>
              Pick at least one day.
            </Text>
          )}
        </View>
      </ScrollView>
    </>
  );
}
