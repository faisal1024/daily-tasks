// Edit the path toward the goal: rename, reword, add or remove steps, or ask
// for a new path. The path stays put otherwise (it no longer changes daily).
import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import type { MilestoneView } from "@/lib/daily-tasks/milestones";

export const MAX_PATH_STEPS = 6;

type Draft = { key: string; id?: string; title: string; description: string };

interface PathEditorProps {
  visible: boolean;
  milestones: MilestoneView[];
  /** With Plus a new path comes from the AI; without, the starter path. */
  plus: boolean;
  onSave: (items: { id?: string; title: string; description?: string }[]) => void;
  onSuggestNew: () => void;
  onClose: () => void;
}

export function PathEditor({ visible, milestones, plus, onSave, onSuggestNew, onClose }: PathEditorProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [drafts, setDrafts] = useState<Draft[]>([]);

  // Start from the current path each time the editor opens.
  useEffect(() => {
    if (visible) {
      setDrafts(milestones.map((m) => ({ key: m.id, id: m.id, title: m.title, description: m.description ?? "" })));
    }
    // Only on open: edits in progress mustn't be overwritten by a re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const update = (key: string, patch: Partial<Draft>) =>
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const remove = (key: string) => setDrafts((current) => current.filter((d) => d.key !== key));
  const add = () =>
    setDrafts((current) =>
      current.length >= MAX_PATH_STEPS
        ? current
        : [...current, { key: `new_${Date.now().toString(36)}`, title: "", description: "" }],
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
        ? "Your coach will suggest a fresh path for your goal. This replaces the current steps and their ticks."
        : "This goes back to the starter path for your goal and clears its ticks.",
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
      onRequestClose={onClose}
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
          <Pressable onPress={onClose} accessibilityRole="button" hitSlop={10}>
            <Text className="text-base" style={{ color: colors.primary }}>
              Cancel
            </Text>
          </Pressable>
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontSize: 18, fontWeight: "700" }}>
            Edit your path
          </Text>
          <Pressable
            onPress={save}
            disabled={!canSave}
            accessibilityRole="button"
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
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 32, gap: 12 }}
        >
          <Text className="text-sm" style={{ color: colors.muted }}>
            The steps toward your goal. They stay the same until you change them here.
          </Text>
          {drafts.map((d, index) => (
            <View
              key={d.key}
              className="rounded-2xl border p-3 gap-2"
              style={{ borderColor: colors.border, backgroundColor: colors.surface }}
            >
              <View className="flex-row items-center gap-2">
                <Text className="text-xs font-bold" style={{ color: colors.muted, width: 18 }}>
                  {index + 1}
                </Text>
                <TextInput
                  value={d.title}
                  onChangeText={(title) => update(d.key, { title })}
                  placeholder="Step"
                  placeholderTextColor={colors.muted}
                  maxLength={80}
                  accessibilityLabel={`Step ${index + 1}`}
                  className="flex-1 text-base"
                  style={{ color: colors.foreground, fontWeight: "700" }}
                />
                <Pressable
                  onPress={() => remove(d.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove step ${index + 1}`}
                  hitSlop={10}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.muted} />
                </Pressable>
              </View>
              <TextInput
                value={d.description}
                onChangeText={(description) => update(d.key, { description })}
                placeholder="What it looks like (optional)"
                placeholderTextColor={colors.muted}
                maxLength={200}
                multiline
                accessibilityLabel={`Step ${index + 1} details`}
                className="text-sm"
                style={{ color: colors.muted, marginLeft: 26 }}
              />
            </View>
          ))}

          {drafts.length < MAX_PATH_STEPS ? (
            <Pressable
              onPress={add}
              accessibilityRole="button"
              className="flex-row items-center justify-center gap-2 rounded-2xl border py-3"
              style={{ borderColor: colors.border, borderStyle: "dashed" }}
              testID="path-editor-add"
            >
              <Ionicons name="add" size={18} color={colors.primary} />
              <Text className="text-base font-semibold" style={{ color: colors.primary }}>
                Add a step
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={suggestNew}
            accessibilityRole="button"
            className="items-center py-3"
            testID="path-editor-new"
          >
            <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
              {plus ? "Suggest a new path" : "Start over with the starter path"}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
