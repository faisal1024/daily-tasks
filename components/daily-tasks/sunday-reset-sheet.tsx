// The Sunday reset (1.6, Plus): last week's wins → a dump for the week →
// the next day's three. Skip or close at any step. See
// lib/daily-tasks/sunday-reset.ts for the rules.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { proxyRouteUrl } from "@/lib/daily-tasks/ai-client";
import { MAX_BRAIN_DUMP_CHARS } from "@/lib/daily-tasks/ai-helpers";
import { track } from "@/lib/daily-tasks/analytics";
import { buildBasicMemory, memoryStatsPayload } from "@/lib/daily-tasks/coach-memory";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import {
  cleanOwnTask,
  localWeekSort,
  nextDayCandidates,
  resetTargetDay,
  sortWeek,
  weekdayOf,
  weekKey,
  weekWins,
  winsCopy,
  type WeekSort,
} from "@/lib/daily-tasks/sunday-reset";
import { MAX_TASKS } from "@/lib/daily-tasks/types";

type Stage = "wins" | "dump" | "sorting" | "three" | "done";
export type SundayResetSource = "today" | "progress";

const STEP_OF: Partial<Record<Stage, number>> = { wins: 1, dump: 2, sorting: 2, three: 3 };

export function SundayResetSheet({
  visible,
  onClose,
  source,
}: {
  visible: boolean;
  onClose: () => void;
  source: SundayResetSource;
}) {
  const colors = useColors();
  const sheetAnimation = useSheetAnimation();
  const insets = useSafeAreaInsets();
  const { state, today, daysShowedUp, hasPlus, parkTasks, setResetDraft, updateSundayReset } = useDailyTasks();
  const [stage, setStage] = useState<Stage>("wins");
  const [dump, setDump] = useState("");
  const [sorted, setSorted] = useState<WeekSort | null>(null);
  const [aiMissed, setAiMissed] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [own, setOwn] = useState("");
  const [setCount, setSetCount] = useState(0);
  // Bumped on every open and close: a sort that lands after the sheet closed
  // (or reopened) belongs to an old session and is dropped.
  const session = useRef(0);

  useEffect(() => {
    session.current += 1;
    if (visible) {
      setStage("wins");
      setDump("");
      setSorted(null);
      setAiMissed(false);
      setCandidates([]);
      setChosen([]);
      setOwn("");
      setSetCount(0);
      track("sunday_reset", { step: "wins", action: "shown", source });
    }
    // Only on opening and closing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const target = resetTargetDay(today);
  const weekday = weekdayOf(target);
  const wins = useMemo(() => winsCopy(weekWins(state.history, today), daysShowedUp), [state.history, today, daysShowedUp]);
  const saved = state.parkedTasks.map((item) => item.text);
  const step = STEP_OF[stage];
  // The one place the reset saves items for later. Seam for 1.6 F (#107):
  // once its dated saved items are on main, pass the sort's dates here
  // (parkTasks(texts, dates)) and send `today` with the week's brain dump.
  const saveForLater = (items: string[]) => {
    if (items.length > 0) parkTasks(items);
  };

  const close = () => {
    // A week's dump typed but not sorted yet is saved, never lost.
    if (stage === "dump" && dump.trim()) {
      saveForLater(localWeekSort(dump, saved).dumpItems);
    }
    if (stage !== "done") track("sunday_reset", { step: stage === "sorting" ? "dump" : stage, action: "close", source });
    onClose();
  };

  const sortTheWeek = async () => {
    const mine = session.current;
    const typed = dump.trim();
    track("sunday_reset", { step: "dump", action: typed ? "next" : "skip", source });
    setStage("sorting");
    const memory = buildBasicMemory(state.history, today, state.memoryClearedAt ?? null);
    const aiReachable = hasPlus && proxyRouteUrl(getMomentumAiProxyUrl(), "brain-dump") != null;
    const result = await sortWeek({
      dump: typed,
      saved,
      forDay: weekday,
      goalTitle: state.momentumProfile.goalTitle,
      stats: memoryStatsPayload(memory),
      useAi: aiReachable,
    });
    if (mine !== session.current) return;
    // Everything from the week's dump goes to Saved for later now; the ones
    // used on the next day leave it that morning (applyTomorrowDraft).
    if (result.dumpItems.length > 0) {
      saveForLater(result.dumpItems);
      track("sunday_reset", { step: "dump", action: "saved", count: result.dumpItems.length, source });
    }
    const existingDraft = state.tomorrowDraft?.forDate === target ? state.tomorrowDraft.tasks : [];
    setSorted(result);
    setAiMissed(aiReachable && result.source !== "ai" && (typed !== "" || saved.length > 0));
    setCandidates(nextDayCandidates({ suggested: result.suggested, dumpItems: result.dumpItems, saved, existingDraft }));
    setChosen(result.suggested.length > 0 ? result.suggested.slice(0, MAX_TASKS) : existingDraft.slice(0, MAX_TASKS));
    setStage("three");
  };

  const toggle = (text: string) => {
    setChosen((current) => {
      if (current.includes(text)) return current.filter((item) => item !== text);
      if (current.length >= MAX_TASKS) return current;
      return [...current, text];
    });
  };

  const addOwn = () => {
    const text = cleanOwnTask(own);
    if (!text) return;
    setOwn("");
    setCandidates((current) =>
      current.some((item) => item.toLowerCase() === text.toLowerCase()) ? current : [text, ...current],
    );
    setChosen((current) =>
      current.some((item) => item.toLowerCase() === text.toLowerCase()) || current.length >= MAX_TASKS
        ? current
        : [...current, text],
    );
  };

  const finish = () => {
    // In the list's order, so the next morning reads as it did here.
    const picked = candidates.filter((text) => chosen.includes(text)).slice(0, MAX_TASKS);
    if (picked.length > 0) setResetDraft(picked, sorted?.source ?? "local");
    updateSundayReset({ doneWeek: weekKey(today) });
    track("sunday_reset", { step: "three", action: "set", count: picked.length, source });
    setSetCount(picked.length);
    setStage("done");
  };

  const full = chosen.length >= MAX_TASKS;
  const primary = (label: string, onPress: () => void, testID: string, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className="rounded-2xl py-4 items-center mt-2"
      style={{ backgroundColor: disabled ? colors.border : colors.primary }}
      testID={testID}
    >
      <Text
        className="text-lg"
        style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: disabled ? colors.muted : colors.onPrimary }}
      >
        {label}
      </Text>
    </Pressable>
  );
  return (
    <Modal
      visible={visible}
      onRequestClose={close}
      animationType={sheetAnimation}
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
    >
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        testID="sunday-reset-sheet"
      >
        <View
          className="flex-row items-center justify-between px-5"
          style={{ paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12 }}
        >
          <View className="flex-1">
            <Text
              accessibilityRole="header"
              className="text-2xl text-foreground"
              style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}
            >
              Set up your week
            </Text>
            {step ? (
              <Text className="text-sm" style={{ color: colors.muted }} testID="sunday-reset-step">
                Step {step} of 3
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessibilityHint={stage === "dump" ? "What you typed is saved for later" : undefined}
            hitSlop={10}
            testID="sunday-reset-close"
          >
            <Ionicons name="close" size={26} color={colors.muted} />
          </Pressable>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 14 }}
        >
          {stage === "wins" && (
            <>
              <Text className="text-lg text-foreground" style={{ fontWeight: "700" }}>
                Last week&apos;s wins
              </Text>
              <View
                className="rounded-2xl border p-4 gap-2"
                style={{ borderColor: colors.border, backgroundColor: colors.surface }}
                testID="sunday-reset-wins"
              >
                <Text className="text-base text-foreground" style={{ fontWeight: "700" }}>
                  {wins.headline}
                </Text>
                {wins.lines.map((line) => (
                  <Text key={line} className="text-base" style={{ color: colors.muted }}>
                    {line}
                  </Text>
                ))}
              </View>
              {primary("Next", () => {
                track("sunday_reset", { step: "wins", action: "next", source });
                setStage("dump");
              }, "sunday-reset-next")}
            </>
          )}

          {stage === "dump" && (
            <>
              <Text className="text-lg text-foreground" style={{ fontWeight: "700" }}>
                Dump for the week
              </Text>
              <Text className="text-base" style={{ color: colors.muted }}>
                Plans, errands, anything on your mind. It all goes to Saved for later.
              </Text>
              <TextInput
                value={dump}
                onChangeText={setDump}
                multiline
                autoFocus
                scrollEnabled
                maxLength={MAX_BRAIN_DUMP_CHARS}
                placeholder={"Book the dentist\nFinish the slides\nCall Sam back…"}
                placeholderTextColor={colors.muted}
                accessibilityLabel="Your week"
                accessibilityHint="Type or dictate what's coming up. One per line is fine."
                className="rounded-2xl border p-4 text-base"
                style={{
                  minHeight: 160,
                  maxHeight: 300,
                  textAlignVertical: "top",
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                  fontWeight: "600",
                }}
                testID="sunday-reset-dump"
              />
              {primary(dump.trim() ? "Next" : "Skip", () => void sortTheWeek(), "sunday-reset-sort")}
            </>
          )}

          {stage === "sorting" && (
            <View className="items-center gap-3 py-16" accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.primary} />
              <Text className="text-base" style={{ color: colors.muted }}>
                Looking at your week…
              </Text>
            </View>
          )}

          {stage === "three" && (
            <>
              <Text className="text-lg text-foreground" style={{ fontWeight: "700" }}>
                {weekday}&apos;s three
              </Text>
              <Text className="text-base" style={{ color: colors.muted }} testID="sunday-reset-three-hint">
                {candidates.length === 0
                  ? `Nothing saved yet. Add one for ${weekday}, or finish here.`
                  : aiMissed
                    ? "Couldn't reach your coach, so here's a simple start. Tap to change."
                    : sorted?.source === "ai"
                      ? "Your coach suggests these. Tap to change."
                      : "Here's a start. Tap to change."}
              </Text>
              {candidates.map((text) => {
                const on = chosen.includes(text);
                const blocked = !on && full;
                const reason = sorted?.reasons[text];
                return (
                  <Pressable
                    key={text}
                    onPress={() => toggle(text)}
                    disabled={blocked}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: blocked }}
                    accessibilityLabel={text}
                    accessibilityValue={reason ? { text: reason } : undefined}
                    accessibilityHint={blocked ? "Untick another one first." : undefined}
                    className="rounded-2xl border p-4 flex-row items-center gap-3"
                    style={{
                      borderColor: on ? colors.primary : colors.border,
                      backgroundColor: colors.surface,
                      opacity: blocked ? 0.5 : 1,
                    }}
                    testID="sunday-reset-candidate"
                  >
                    <Ionicons
                      name={on ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={on ? colors.primary : colors.muted}
                    />
                    <View className="flex-1">
                      <Text className="text-base text-foreground" style={{ fontWeight: "700" }}>
                        {text}
                      </Text>
                      {reason ? (
                        <Text className="text-sm mt-0.5" style={{ color: colors.muted }}>
                          {reason}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              <View className="flex-row items-center gap-2">
                <TextInput
                  value={own}
                  onChangeText={setOwn}
                  onSubmitEditing={addOwn}
                  returnKeyType="done"
                  maxLength={120}
                  placeholder="Add your own"
                  placeholderTextColor={colors.muted}
                  accessibilityLabel={`Add your own for ${weekday}`}
                  className="flex-1 rounded-2xl border px-4 py-3 text-base"
                  style={{ color: colors.foreground, borderColor: colors.border, backgroundColor: colors.surface }}
                  testID="sunday-reset-own"
                />
                <Pressable
                  onPress={addOwn}
                  disabled={!own.trim()}
                  accessibilityRole="button"
                  accessibilityLabel="Add"
                  accessibilityState={{ disabled: !own.trim() }}
                  hitSlop={8}
                  className="rounded-2xl px-4 py-3"
                  style={{ backgroundColor: own.trim() ? `${colors.primary}16` : colors.surface }}
                  testID="sunday-reset-own-add"
                >
                  <Text className="text-base font-semibold" style={{ color: own.trim() ? colors.primary : colors.muted }}>
                    Add
                  </Text>
                </Pressable>
              </View>
              {primary(
                chosen.length === 0 ? "Finish" : chosen.length === MAX_TASKS ? `Set ${weekday}'s three` : `Set ${weekday}'s plan`,
                finish,
                "sunday-reset-set",
              )}
            </>
          )}

          {stage === "done" && (
            <>
              <View className="items-center gap-3 py-8" accessibilityLiveRegion="polite" testID="sunday-reset-done">
                <Ionicons name="sunny-outline" size={36} color={colors.primary} />
                <Text className="text-xl text-foreground text-center" style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}>
                  Your week is set up.
                </Text>
                <Text className="text-base text-center" style={{ color: colors.muted }}>
                  {setCount > 0
                    ? `${weekday}'s plan will be waiting in the morning.`
                    : "Everything else is in Saved for later."}
                </Text>
              </View>
              {primary("Done", onClose, "sunday-reset-finish")}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
