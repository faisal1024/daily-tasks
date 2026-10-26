// The Sunday reset (1.6, Plus): your week's wins → a dump for the week →
// the next day's three. Skip or close at any step; nothing typed is lost.
// See lib/daily-tasks/sunday-reset.ts for the rules. Rendered once, by
// SundayResetProvider (sunday-reset-provider.tsx).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState as RNAppState,
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
import { draftDueReasons } from "@/lib/daily-tasks/resurface";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import {
  cleanOwnTask,
  defaultPicks,
  doneLine,
  fitSaved,
  isSunday,
  localWeekSort,
  MAX_CANDIDATES_SHOWN,
  nextDayCandidates,
  overflowLine,
  resetTargetDay,
  savedForReset,
  sortWeek,
  sundayResetOf,
  WEEK_SORT_TIMEOUT_MS,
  weekdayOf,
  weekKey,
  weekWins,
  winsCopy,
  type WeekSort,
} from "@/lib/daily-tasks/sunday-reset";
import { MAX_TASKS, type TaskWhen } from "@/lib/daily-tasks/types";

type Stage = "wins" | "dump" | "sorting" | "three" | "done";
export type SundayResetSource = "today" | "progress" | "notification";

/** What the provider can ask of an open sheet. */
export interface SundayResetSheetHandle {
  /** Close it as the × does: a typed dump is saved first. */
  close: () => void;
}

const STEP_OF: Partial<Record<Stage, number>> = { wins: 1, dump: 2, sorting: 2, three: 3 };
const looseKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

export const SundayResetSheet = forwardRef<
  SundayResetSheetHandle,
  { visible: boolean; onClose: () => void; source: SundayResetSource }
>(function SundayResetSheet({ visible, onClose, source }, ref) {
  const colors = useColors();
  const sheetAnimation = useSheetAnimation();
  const insets = useSafeAreaInsets();
  const store = useDailyTasks();
  const { state, today, daysShowedUp, hasPlus, parkTasks, removeParkedTask, setResetDraft, updateSundayReset } = store;
  // The latest saved list, for what lands after an await.
  const parkedRef = useRef(state.parkedTasks);
  parkedRef.current = state.parkedTasks;
  const [stage, setStage] = useState<Stage>("wins");
  const stageRef = useRef<Stage>("wins");
  stageRef.current = stage;
  const [dump, setDump] = useState("");
  const dumpRef = useRef("");
  dumpRef.current = dump;
  const [sorted, setSorted] = useState<WeekSort | null>(null);
  const [aiMissed, setAiMissed] = useState(false);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<string[]>([]);
  const [own, setOwn] = useState("");
  const [overflow, setOverflow] = useState(0);
  const [result, setResult] = useState<{ picked: number; added: number }>({ picked: 0, added: 0 });
  // The day the sort was for, captured then (so finishing after midnight
  // still fills that day), and the store's day it ran on.
  const [plan, setPlan] = useState<{ sortDay: string; target: string } | null>(null);
  // Items the dump step already saved (the app went to the background): a
  // later save replaces them, so a half-typed line doesn't stay behind.
  const provisional = useRef<string[]>([]);
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
      setReasons({});
      setChosen([]);
      setOwn("");
      setOverflow(0);
      setResult({ picked: 0, added: 0 });
      setPlan(null);
      provisional.current = [];
      track("sunday_reset", { step: "wins", action: "shown", source });
    }
    // Only on opening and closing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // VoiceOver hears which step it's on.
  const step = STEP_OF[stage === "sorting" ? "dump" : stage];
  const lastStep = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!visible || step === undefined || step === lastStep.current) {
      if (!visible) lastStep.current = undefined;
      return;
    }
    lastStep.current = step;
    AccessibilityInfo.announceForAccessibility(`Step ${step} of 3`);
  }, [step, visible]);

  const target = plan?.target ?? resetTargetDay(today);
  const weekday = weekdayOf(target);
  const sundayRitual = isSunday(plan?.sortDay ?? today);
  const wins = useMemo(() => winsCopy(weekWins(state.history, today), daysShowedUp), [state.history, today, daysShowedUp]);

  /**
   * Save `items` for later (only what fits), replacing whatever the dump step
   * saved provisionally that isn't among them. `dates`: the AI's (1.6 F);
   * without them the device reads dates from the words.
   */
  const saveForLater = (items: string[], dates?: Record<string, TaskWhen>): { fits: string[]; overflow: number } => {
    const keep = new Set(items.map(looseKey));
    const stale = provisional.current.filter((text) => !keep.has(looseKey(text)));
    let parked = parkedRef.current;
    if (stale.length > 0) {
      const gone = new Set(stale.map(looseKey));
      for (const item of parked) if (gone.has(looseKey(item.text))) removeParkedTask(item.id);
      parked = parked.filter((item) => !gone.has(looseKey(item.text)));
    }
    const fit = fitSaved(items, parked);
    if (fit.fits.length > 0) {
      if (dates && Object.keys(dates).length > 0) parkTasks(fit.fits, dates);
      else parkTasks(fit.fits);
    }
    provisional.current = [];
    return fit;
  };

  /** The dump as typed, saved with the simple split (closing, or the app leaving). */
  const saveTypedDump = () => {
    const typed = dumpRef.current.trim();
    if (!typed) return [];
    const items = localWeekSort(typed, parkedRef.current.map((item) => item.text)).dumpItems;
    return saveForLater(items).fits;
  };

  const close = () => {
    const now = stageRef.current;
    // A week's dump typed but not sorted yet (or still sorting) is saved, never lost.
    if (now === "dump" || now === "sorting") saveTypedDump();
    if (now !== "done") track("sunday_reset", { step: now === "sorting" ? "dump" : now, action: "close", source });
    onClose();
  };
  useImperativeHandle(ref, () => ({ close }));

  // Going to the background mid-dump saves it as closing does (the app may
  // not come back); coming back carries on, and the sort replaces it.
  useEffect(() => {
    if (!visible) return;
    const sub = RNAppState.addEventListener("change", (status) => {
      if (status !== "background") return;
      const now = stageRef.current;
      if (now !== "dump" && now !== "sorting") return;
      provisional.current = saveTypedDump();
    });
    return () => sub.remove();
    // saveTypedDump reads refs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const sortTheWeek = async () => {
    const mine = session.current;
    const typed = dump.trim();
    const sortDay = today;
    const forDate = resetTargetDay(sortDay);
    setPlan({ sortDay, target: forDate });
    track("sunday_reset", { step: "dump", action: typed ? "next" : "skip", source });
    setStage("sorting");
    const parkedNow = state.parkedTasks;
    const saved = savedForReset(parkedNow, sortDay, forDate);
    const memory = buildBasicMemory(state.history, sortDay, state.memoryClearedAt ?? null);
    const aiReachable = hasPlus && proxyRouteUrl(getMomentumAiProxyUrl(), "brain-dump") != null;
    const sort = await sortWeek({
      dump: typed,
      saved: saved.order,
      forDay: weekdayOf(forDate),
      goalTitle: state.momentumProfile.goalTitle,
      stats: memoryStatsPayload(memory),
      useAi: aiReachable,
      today: sortDay,
      notByDefault: saved.later,
      timeoutMs: WEEK_SORT_TIMEOUT_MS,
    });
    // Closed (and the dump saved) meanwhile: this answer is for nobody.
    if (mine !== session.current) return;
    // Everything new from the week's dump goes to Saved for later now (what
    // fits); the ones used on the next day leave it that morning.
    const fit = saveForLater(sort.dumpItems, sort.dates);
    if (fit.fits.length > 0) track("sunday_reset", { step: "dump", action: "saved", count: fit.fits.length, source });
    setOverflow(fit.overflow);
    const draft = state.tomorrowDraft?.forDate === forDate ? state.tomorrowDraft : null;
    const ownDraft = draft?.from === "reset" ? draft.tasks : [];
    const existingDraft = draft && draft.from !== "reset" ? draft.tasks : [];
    const list = nextDayCandidates({
      ownDraft,
      dueOnTarget: saved.dueOnTarget,
      suggested: sort.suggested,
      dumpItems: fit.fits,
      saved: parkedNow.map((item) => item.text),
      existingDraft,
    });
    setSorted(sort);
    setResult({ picked: 0, added: fit.fits.length });
    setAiMissed(aiReachable && sort.source !== "ai" && (typed !== "" || saved.order.length > 0));
    setCandidates(list);
    setReasons({ ...draftDueReasons(list, parkedNow, sortDay), ...sort.reasons });
    setChosen(defaultPicks({ ownDraft, dueOnTarget: saved.dueOnTarget, suggested: sort.suggested, existingDraft }));
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
    setCandidates((current) => (current.some((item) => looseKey(item) === looseKey(text)) ? current : [text, ...current]));
    setChosen((current) =>
      current.some((item) => looseKey(item) === looseKey(text)) || current.length >= MAX_TASKS ? current : [...current, text],
    );
  };

  const finish = () => {
    // In the list's order, so the next morning reads as it did here.
    const picked = candidates.filter((text) => chosen.includes(text)).slice(0, MAX_TASKS);
    const sortDay = plan?.sortDay ?? today;
    if (picked.length > 0) setResetDraft(picked, sorted?.source ?? "local", plan?.target);
    updateSundayReset({ doneWeek: weekKey(sortDay) });
    track("sunday_reset", { step: "three", action: "set", count: picked.length, source });
    setResult((current) => ({ ...current, picked: picked.length }));
    setStage("done");
  };

  const full = chosen.length >= MAX_TASKS;
  // A short list: the first rows, and anything ticked further down.
  const shown = [
    ...candidates.slice(0, MAX_CANDIDATES_SHOWN),
    ...candidates.slice(MAX_CANDIDATES_SHOWN).filter((text) => chosen.includes(text)),
  ];
  const more = candidates.length - shown.length;
  const nudgeLine =
    hasPlus && sundayResetOf(state).reminder && state.notifications.enabled
      ? "We'll nudge you Sundays at 6 PM. Turn it off in Settings › Reminders."
      : null;

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
  const heading = (text: string) => (
    <Text accessibilityRole="header" className="text-lg text-foreground" style={{ fontWeight: "700" }}>
      {text}
    </Text>
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
              {sundayRitual ? "Set up your week" : "Plan tomorrow"}
            </Text>
            {step && stage !== "done" ? (
              <Text className="text-sm" style={{ color: colors.muted }} testID="sunday-reset-step">
                Step {step} of 3
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessibilityHint={
              stage === "dump" || stage === "sorting"
                ? "What you typed is saved for later"
                : stage === "three"
                  ? "Your dump is already saved. Your picks won't be set."
                  : undefined
            }
            hitSlop={12}
            style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}
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
              {heading("Your week's wins")}
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
              {primary(
                "Next",
                () => {
                  track("sunday_reset", { step: "wins", action: "next", source });
                  setStage("dump");
                },
                "sunday-reset-next",
              )}
            </>
          )}

          {stage === "dump" && (
            <>
              {heading("Dump for the week")}
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
              {heading(`${weekday}'s three`)}
              <Text className="text-base" style={{ color: colors.muted }} testID="sunday-reset-three-hint">
                {candidates.length === 0
                  ? `Nothing saved yet. Add one for ${weekday}, or finish here.`
                  : aiMissed
                    ? "Couldn't reach your coach, so here's a simple start. Tap to change."
                    : sorted?.source === "ai"
                      ? "Your coach suggests these. Tap to change."
                      : "Here's a start. Tap to change."}
              </Text>
              {overflow > 0 ? (
                <Text className="text-sm" style={{ color: colors.muted }} testID="sunday-reset-overflow">
                  {overflowLine(overflow)}
                </Text>
              ) : null}
              {shown.map((text) => {
                const on = chosen.includes(text);
                const blocked = !on && full;
                const reason = reasons[text];
                return (
                  <Pressable
                    key={text}
                    onPress={() => toggle(text)}
                    disabled={blocked}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: blocked }}
                    accessibilityLabel={reason ? `${text}. ${reason}` : text}
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
              {more > 0 ? (
                <Text className="text-sm" style={{ color: colors.muted }} testID="sunday-reset-more">
                  +{more} more in Saved for later
                </Text>
              ) : null}
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
                  style={{ minHeight: 44, backgroundColor: own.trim() ? `${colors.primary}16` : colors.surface }}
                  testID="sunday-reset-own-add"
                >
                  <Text className="text-base font-semibold" style={{ color: own.trim() ? colors.primary : colors.muted }}>
                    Add
                  </Text>
                </Pressable>
              </View>
              {primary(chosen.length === 0 ? "Finish" : `Set ${weekday}'s plan`, finish, "sunday-reset-set")}
            </>
          )}

          {stage === "done" && (
            <>
              <View className="items-center gap-3 py-8" accessibilityLiveRegion="polite" testID="sunday-reset-done">
                <Ionicons name="sunny-outline" size={36} color={colors.primary} />
                <Text
                  accessibilityRole="header"
                  className="text-xl text-foreground text-center"
                  style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}
                >
                  {sundayRitual ? "Your week is set up." : "Tomorrow is set up."}
                </Text>
                <Text className="text-base text-center" style={{ color: colors.muted }} testID="sunday-reset-done-line">
                  {doneLine({ weekday, picked: result.picked, added: result.added })}
                </Text>
                {nudgeLine ? (
                  <Text className="text-sm text-center" style={{ color: colors.muted }} testID="sunday-reset-nudge-line">
                    {nudgeLine}
                  </Text>
                ) : null}
              </View>
              {primary("Done", onClose, "sunday-reset-finish")}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
});
