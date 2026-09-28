// Edit the path toward the goal: rename, reword, add or remove steps, or ask
// for a new path. The path stays put otherwise (it no longer changes daily).
import { useRef, useState } from "react";
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
import type { MilestoneView } from "@/lib/daily-tasks/milestones";

export const MAX_PATH_STEPS = 6;

type Draft = { key: string; id?: string; title: string; description: string; done: boolean };

interface PathEditorProps {
  visible: boolean;
  goalTitle?: string | null;
  milestones: MilestoneView[];
  /** With Plus a new path comes from the AI; without, the starter path. */
  plus: boolean;
  onSave: (items: { id?: string; title: string; description?: string }[]) => void;
  onSuggestNew: () => void;
  onClose: () => void;
}

/** Mounted only while open (see journey.tsx), so each open starts from the current path. */
export function PathEditor({ visible, goalTitle, milestones, plus, onSave, onSuggestNew, onClose }: PathEditorProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const toDraft = (m: MilestoneView): Draft => ({
    key: m.id,
    id: m.id,
    title: m.title,
    description: m.description ?? "",
    done: m.done,
  });
  const [initial] = useState<Draft[]>(() => milestones.map(toDraft));
  const [drafts, setDrafts] = useState<Draft[]>(initial);
  const nextKey = useRef(0);
  const dirty =
    JSON.stringify(drafts.map(({ key: _k, ...d }) => d)) !== JSON.stringify(initial.map(({ key: _k, ...d }) => d));

  // Leaving with unsaved edits asks first.
  const close = () => {
    if (!dirty) return onClose();
    Alert.alert("Discard changes?", "Your edits to the path won't be saved.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: onClose },
    ]);
  };

  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const remove = (key: string) => setDrafts((current) => current.filter((d) => d.key !== key));
  const add = () =>
    setDrafts((current) =>
      current.length >= MAX_PATH_STEPS
        ? current
        : [...current, { key: `new_${nextKey.current++}`, title: "", description: "", done: false }],
    );

  const filled = drafts.filter((d) => d.title.trim());
  const canSave = filled.length > 0;

  const save = () => {
    if (!canSave) return;
    onSave(filled.map((d) => ({ id: d.id, title: d.title, description: d.description })));
    onClose();
  };

  const suggestNew = () => {
    Alert.alert(
      "Get a new path?",
      plus
        ? "Your coach will suggest three new steps for your goal. Your current steps and ticks will be replaced."
        : "Go back to the starter steps for your goal? Your current steps and ticks will be replaced.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Replace path",
          style: "destructive",
          onPress: () => {
            onSuggestNew();
            onClose();
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      onRequestClose={close}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        testID="path-editor"
      >
        <View
          className="flex-row items-center justify-between px-5"
          style={{ paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12 }}
        >
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Cancel editing" hitSlop={10}>
            <Text className="text-base" style={{ color: colors.primary }}>
              Cancel
            </Text>
          </Pressable>
          <Text
            accessibilityRole="header"
            style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontSize: 18, fontWeight: "700" }}
          >
            Edit your path
          </Text>
          <Pressable
            onPress={save}
            disabled={!canSave}
            accessibilityRole="button"
            accessibilityLabel="Save path"
            accessibilityState={{ disabled: !canSave }}
            hitSlop={10}
            testID="path-editor-save"
          >
            <Text className="text-base font-bold" style={{ color: colors.primary, opacity: canSave ? 1 : 0.4 }}>
              Save
            </Text>
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 12 }}
        >
          <Text className="text-sm" style={{ color: colors.muted }}>
            {goalTitle ? `Your steps toward ${goalTitle}.` : "Your steps toward your goal."} They stay the same until
            you change them. Reached steps keep their tick when you reword them.
          </Text>
          {drafts.map((d, index) => (
            <View
              key={d.key}
              className="rounded-2xl border p-3 gap-2"
              style={{ borderColor: colors.border, backgroundColor: colors.surface }}
            >
              <View className="flex-row items-center gap-2">
                {d.done ? (
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} accessibilityElementsHidden />
                ) : (
                  <Text
                    className="text-xs font-bold"
                    style={{ color: colors.muted, width: 18 }}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    {index + 1}
                  </Text>
                )}
                <TextInput
                  value={d.title}
                  onChangeText={(title) => update(d.key, { title })}
                  placeholder={`Step ${index + 1}`}
                  returnKeyType="next"
                  autoFocus={d.id === undefined}
                  placeholderTextColor={colors.muted}
                  maxLength={80}
                  accessibilityLabel={`Step ${index + 1}${d.done ? ", reached" : ""}`}
                  className="flex-1 text-base"
                  style={{ color: colors.foreground, fontWeight: "700" }}
                />
                <Pressable
                  onPress={() => remove(d.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove step ${index + 1}${d.done ? " (reached)" : ""}`}
                  hitSlop={14}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.muted} />
                </Pressable>
              </View>
              <TextInput
                value={d.description}
                onChangeText={(description) => update(d.key, { description })}
                placeholder="How you'll know you're there (optional)"
                blurOnSubmit
                placeholderTextColor={colors.muted}
                maxLength={200}
                multiline
                accessibilityLabel={`Step ${index + 1} details`}
                className="text-sm"
                style={{ color: colors.muted, marginLeft: 26 }}
              />
            </View>
          ))}

          {!canSave ? (
            <Text className="text-sm" style={{ color: colors.muted }}>
              Add at least one step to save.
            </Text>
          ) : null}

          {drafts.length < MAX_PATH_STEPS ? (
            <Pressable
              onPress={add}
              accessibilityRole="button"
              className="flex-row items-center justify-center gap-2 rounded-2xl border py-3"
              style={{ borderColor: colors.border, borderStyle: "dashed" }}
              accessibilityLabel="Add a step"
              testID="path-editor-add"
            >
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text className="text-base font-semibold" style={{ color: colors.primary }}>
                Add a step
              </Text>
            </Pressable>
          ) : (
            <Text className="text-sm text-center" style={{ color: colors.muted }}>
              Up to {MAX_PATH_STEPS} steps.
            </Text>
          )}

          <Pressable
            onPress={suggestNew}
            accessibilityRole="button"
            accessibilityHint="Replaces your current steps"
            className="items-center py-3"
            testID="path-editor-new"
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              {plus ? "Suggest a new path" : "Reset to starter steps"}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
