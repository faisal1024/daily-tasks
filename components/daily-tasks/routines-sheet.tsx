// Manage routines (1.3), opened from Settings › Routines, Today's routines
// or the Ideas sheet (see RoutinesManager): add one (words + days), edit,
// pause/resume, delete. Routines never fill a slot by themselves; on their
// days they're suggested on Today (and in Ideas).
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import {
  ALL_DAYS,
  capVisibleChars,
  cleanDays,
  cleanRoutineText,
  DAY_NAMES,
  DAY_PRESETS,
  DAY_SHORT,
  describeDays,
  PICKER_ORDER,
  presetFor,
  routineSavedNote,
  type AddRoutineResult,
  type DaysPreset,
} from "@/lib/daily-tasks/routines";
import type { Routine } from "@/lib/daily-tasks/types";

/** The full explainer, shown while there are no routines yet. */
export const ROUTINES_EXPLAINER =
  "Things you do on repeat. They show on Today on their days — you choose if they make today's three.";
/** The short reminder once there are some. */
export const ROUTINES_EXPLAINER_SHORT = "They show on Today on their days.";
export const ROUTINES_FREE_LIMIT_NOTE = "Free keeps two routines. Plus keeps as many as you like.";

interface RoutinesSheetProps {
  visible: boolean;
  routines: Routine[];
  /** False when a free user is at the limit: "Add a routine" asks for Plus instead. */
  canAdd: boolean;
  /** A free user at the free limit: say so under "Add a routine" before the tap. */
  atFreeLimit?: boolean;
  /** Open straight into "New routine" (e.g. right after buying Plus). */
  startInEditor?: boolean;
  onAdd: (text: string, days: number[]) => AddRoutineResult;
  /** Tapped "Add a routine" at the free limit (the sheet closes, then the paywall opens). */
  onLimit: () => void;
  onUpdate: (id: string, text: string, days: number[]) => void;
  onSetPaused: (id: string, paused: boolean) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  /** Routines due today and not on today's list yet (for the note after a save). */
  dueTodayIds?: readonly string[];
  /** Today's routines card is showing with Add on: a routine due today can be added right now. */
  canAddToToday?: boolean;
  /** Today (yyyy-MM-dd), for "next on Monday" after a save. */
  today?: string;
}

type Editing = { kind: "new" } | { kind: "edit"; routine: Routine } | null;

/** The routine just saved, to say when it shows (a new one is found by its words and days). */
type JustSaved = { key: number; id: string | null; text: string; days: number[] };

const looseText = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const sameRoutine = (routine: Routine, saved: JustSaved) =>
  saved.id !== null
    ? routine.id === saved.id
    : looseText(routine.text) === looseText(saved.text) && routine.days.join() === saved.days.join();

export function RoutinesSheet({
  visible,
  routines,
  canAdd,
  atFreeLimit = false,
  startInEditor = false,
  onAdd,
  onLimit,
  onUpdate,
  onSetPaused,
  onRemove,
  onClose,
  dueTodayIds = [],
  canAddToToday = false,
  today,
}: RoutinesSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const sheetAnimation = useSheetAnimation();
  const [editing, setEditing] = useState<Editing>(startInEditor && visible ? { kind: "new" } : null);
  // Each time it opens: the list, or "New routine" when asked.
  const [wasVisible, setWasVisible] = useState(visible);
  // After a save: a line under that routine saying when it shows on Today.
  const [justSaved, setJustSaved] = useState<JustSaved | null>(null);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    setJustSaved(null);
    if (visible) setEditing(startInEditor ? { kind: "new" } : null);
  }
  const savedRoutine = justSaved && !editing ? routines.find((r) => sameRoutine(r, justSaved)) : undefined;
  const savedNote = savedRoutine
    ? routineSavedNote({
        days: savedRoutine.days,
        paused: savedRoutine.paused,
        dueToday: dueTodayIds.includes(savedRoutine.id),
        canAddNow: canAddToToday,
        today,
      })
    : null;
  // Said once per save, when the line first appears.
  const announcedKey = useRef<number | null>(null);
  useEffect(() => {
    if (!savedNote || !justSaved || announcedKey.current === justSaved.key) return;
    announcedKey.current = justSaved.key;
    AccessibilityInfo.announceForAccessibility(`Saved. ${savedNote}`);
  }, [savedNote, justSaved]);
  const markSaved = (id: string | null, text: string, days: number[]) => {
    const clean = cleanRoutineText(text);
    if (!clean) return;
    setJustSaved({ key: Date.now(), id, text: clean, days: cleanDays(days) });
  };

  const close = () => {
    setEditing(null);
    onClose();
  };

  const startAdd = () => {
    setJustSaved(null);
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
                markSaved(editing.routine.id, text, days);
                setEditing(null);
                return;
              }
              const result = onAdd(text, days);
              if (result === "limit") {
                setEditing(null);
                onLimit();
                return;
              }
              // "exists": the same one is already there (a double tap): done too.
              if (result === "added" || result === "exists") {
                markSaved(null, text, days);
                setEditing(null);
              }
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
                {routines.length === 0 ? ROUTINES_EXPLAINER : ROUTINES_EXPLAINER_SHORT}
              </Text>

              {routines.map((routine) => (
                <RoutineRow
                  key={routine.id}
                  routine={routine}
                  savedNote={routine === savedRoutine ? savedNote : null}
                  onEdit={() => {
                    setJustSaved(null);
                    setEditing({ kind: "edit", routine });
                  }}
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
              {atFreeLimit && (
                // Said up front, before the tap opens Plus.
                <Text className="text-sm text-center" style={{ color: colors.muted }} testID="routines-limit-note">
                  {ROUTINES_FREE_LIMIT_NOTE}
                </Text>
              )}
            </ScrollView>
          </>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function RoutineRow({
  routine,
  savedNote = null,
  onEdit,
  onTogglePaused,
  onRemove,
}: {
  routine: Routine;
  /** Just saved: when it shows on Today. */
  savedNote?: string | null;
  onEdit: () => void;
  onTogglePaused: () => void;
  onRemove: () => void;
}) {
  const colors = useColors();
  const spokenDays = describeDays(routine.days, { spoken: true });
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
      {savedNote && (
        <View
          className="flex-row items-start gap-1.5"
          accessibilityLiveRegion="polite"
          testID={`routine-saved-note-${routine.id}`}
        >
          <Ionicons
            name="checkmark-circle-outline"
            size={16}
            color={colors.primary}
            style={{ marginTop: 2 }}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text className="flex-1 text-sm" style={{ color: colors.muted }}>
            {savedNote}
          </Text>
        </View>
      )}
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

/** Cancel and Save stop growing at 2x, so the title between them keeps its room. */
const HEADER_BUTTON_MAX_FONT = 2;

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
  // The field grows with its words to about three lines, then scrolls.
  const { fontScale } = useWindowDimensions();
  const fieldMaxHeight = Math.round(3 * 24 * Math.max(fontScale || 1, 1) + 24);
  const startDays = initial ? cleanDays(initial.days) : [...ALL_DAYS];
  const [text, setText] = useState(initial?.text ?? "");
  const [days, setDays] = useState<number[]>(startDays);
  // "Custom days" stays picked once chosen, even if the days happen to match a preset later.
  const [custom, setCustom] = useState(presetFor(startDays) === "custom");
  const selected: DaysPreset = custom ? "custom" : presetFor(days);
  const canSave = cleanRoutineText(text) !== null && days.length > 0;
  // A second tap before the editor closes is refused by the store ("exists").
  const save = () => {
    if (canSave) onSave(text, days);
  };

  const pickPreset = (preset: DaysPreset) => {
    if (preset === "custom") {
      // From a preset, Custom starts blank: the user picks the days (Save
      // waits for one). Tapping it again keeps the days already picked.
      if (selected !== "custom") setDays([]);
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
          style={{ minHeight: 44, justifyContent: "center", flexShrink: 0 }}
        >
          <Text className="text-base" style={{ color: colors.primary }} maxFontSizeMultiplier={HEADER_BUTTON_MAX_FONT}>
            Cancel
          </Text>
        </Pressable>
        <Text
          accessibilityRole="header"
          // Two lines (shrinking to fit) at the large sizes, never "N..".
          numberOfLines={2}
          adjustsFontSizeToFit
          // Takes what's left between Cancel and Save, so they never collide at large text sizes.
          style={{
            flex: 1,
            textAlign: "center",
            marginHorizontal: 12,
            color: colors.foreground,
            fontFamily: Fonts.rounded,
            fontSize: 18,
            fontWeight: "700",
          }}
        >
          {initial ? "Edit routine" : "New routine"}
        </Text>
        <Pressable
          onPress={save}
          disabled={!canSave}
          accessibilityRole="button"
          accessibilityLabel="Save routine"
          accessibilityState={{ disabled: !canSave }}
          hitSlop={10}
          style={{ minHeight: 44, justifyContent: "center", flexShrink: 0 }}
          testID="routine-save"
        >
          <Text
            className="text-base font-bold"
            // Disabled reads as disabled: muted and dimmed, not a paler tint.
            style={{ color: canSave ? colors.primary : colors.muted, opacity: canSave ? 1 : 0.45 }}
            maxFontSizeMultiplier={HEADER_BUTTON_MAX_FONT}
            testID="routine-save-label"
          >
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
          // Capped by visible character, like the saved text (maxLength counts
          // UTF-16 units, so emoji would hit it early).
          // One line of words: a pasted line break becomes a space.
          onChangeText={(value) => setText(capVisibleChars(value.replace(/[\r\n]+/g, " ")))}
          // Wraps as it grows, but return still saves (when it can) and closes the keyboard.
          multiline
          submitBehavior="blurAndSubmit"
          onSubmitEditing={save}
          placeholder="e.g. Walk after lunch"
          placeholderTextColor={colors.muted}
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
            maxHeight: fieldMaxHeight,
            textAlignVertical: "top",
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
                  accessibilityRole="checkbox"
                  accessibilityLabel={DAY_NAMES[day]}
                  accessibilityState={{ checked: on }}
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
