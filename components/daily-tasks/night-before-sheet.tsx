// The night before (1.7): write what's on your mind → it becomes a list →
// tick what to do first → keep it till morning. Nothing is thrown out at
// night and nothing is filed: the typed words and the list are held as they
// are (state.nightLists, saved with the app's state). The words are written
// a moment after typing stops, and at once on closing or going to the
// background, so even a swipe-kill keeps them. Words added after the list
// was made become rows too (withTextLines). Reopening the same night brings
// it all back. The morning card decides what's added or saved.
// Rules and words: lib/daily-tasks/night-before.ts.
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  AppState as RNAppState,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { proxyRouteUrl } from "@/lib/daily-tasks/ai-client";
import { FREE_LIMIT_NOTICE, MAX_BRAIN_DUMP_CHARS } from "@/lib/daily-tasks/ai-helpers";
import { track } from "@/lib/daily-tasks/analytics";
import { announceLiveChange, announcePolitely } from "@/lib/daily-tasks/announce";
import { buildBasicMemory, memoryStatsPayload } from "@/lib/daily-tasks/coach-memory";
import { claimFreeAiDump, freeAiDumpNotice, refundFreeAiDump } from "@/lib/daily-tasks/free-uses";
import { getMomentumAiProxyUrl } from "@/lib/daily-tasks/momentum-ai";
import {
  aiCanHoldAll,
  dayWord,
  emptyNightList,
  hasContent,
  listFor,
  NIGHT_COPY,
  NIGHT_SORT_TIMEOUT_MS,
  NIGHT_TEXT_SAVE_MS,
  nightBeforeOf,
  nightDoneLine,
  nightDoneSpoken,
  reminderTimeLabel,
  sortedSpoken,
  sortNight,
  textAhead,
  weekdayFor,
  withSortedItems,
  withTextLines,
  type NightTarget,
} from "@/lib/daily-tasks/night-before";
import { makeId } from "@/lib/daily-tasks/storage";
import { recordPlusUse } from "@/lib/daily-tasks/trial-note";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import type { NightList } from "@/lib/daily-tasks/types";

type Stage = "write" | "sorting" | "review" | "done";
export type NightBeforeSource = "today" | "notification" | "whats_new";
type SortKind = "ai" | "local" | "free_ai";

/** From this text size the row's "Do first" label goes under the words. */
const LABEL_UNDER_FONT_SCALE = 1.3;

export function NightBeforeSheet({
  visible,
  target,
  source,
  onClose,
  onDone,
  onSeePlus,
}: {
  visible: boolean;
  /** The day planned, captured when the sheet was asked for (null: nothing to plan). */
  target: NightTarget | null;
  source: NightBeforeSource;
  /** Closed before "Keep till morning" (what's written is held all the same). */
  onClose: () => void;
  /** "Keep till morning", then Done (Today shows the toast). */
  onDone: () => void;
  /** "See Plus" on the free-limit notice: the sheet closes first; the list is held. */
  onSeePlus?: () => void;
}) {
  const colors = useColors();
  const sheetAnimation = useSheetAnimation();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const labelUnder = fontScale >= LABEL_UNDER_FONT_SCALE;
  const {
    state,
    today,
    hasPlus,
    setNightList,
    clearNightList,
    updateNightBefore,
    setNotificationsEnabled,
    notificationPermission,
    requestNotificationPermission,
  } = useDailyTasks();
  const held = target ? listFor(state.nightLists, target.forDate) : null;
  // The latest list, for what lands after an await or a timer.
  const heldRef = useRef<NightList | null>(held);
  heldRef.current = held;
  const targetRef = useRef(target);
  targetRef.current = target;
  const [stage, setStage] = useState<Stage>("write");
  // The words as typed: local, written to the store after a pause (flushText).
  const [text, setText] = useState("");
  const textRef = useRef("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notice, setNotice] = useState<{ text: string; freeLimit: boolean } | null>(null);
  const [nudge, setNudge] = useState<"ask" | "on" | "blocked" | null>(null);
  // Bumped on every open and close: a sort that lands after the sheet closed
  // only updates the list if the words are still the ones it sorted.
  const session = useRef(0);
  // One sort at a time (a double tap mustn't claim two free sorts).
  const sorting = useRef(false);
  const record = nightBeforeOf(state);
  const day = target ? dayWord(target, today) : "tomorrow";
  const items = held?.items ?? [];

  /** This night's list with `change` applied (started now if there's none). The other day's list is never touched. */
  const write = (change: (list: NightList) => NightList) => {
    const plan = targetRef.current;
    if (!plan) return;
    const base = heldRef.current ?? emptyNightList(plan, new Date().toISOString());
    const next = change(base);
    heldRef.current = next;
    setNightList(next);
  };

  /** The typed words into the store now (a pending save is done at once). */
  const flushText = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const typed = textRef.current;
    if (!targetRef.current || typed === (heldRef.current?.text ?? "")) return;
    write((list) => ({ ...list, text: typed }));
  };

  /** Leaving the sheet: the words saved, and any line added since the list was made becomes a row. */
  const settle = () => {
    flushText();
    const list = heldRef.current;
    if (!list || !targetRef.current) return;
    // Nothing written at all: no empty list is left behind.
    if (!hasContent(list)) {
      clearNightList(list.forDay);
      return;
    }
    if (list.items.length > 0 && textAhead(list)) write(withTextLines);
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  useEffect(() => {
    session.current += 1;
    if (!visible) {
      settleRef.current();
      return;
    }
    // Reopened the same night: the words and the list as they were. Words
    // that moved on from the rows open on the words.
    const list = heldRef.current;
    textRef.current = list?.text ?? "";
    setText(textRef.current);
    setStage(list && list.items.length > 0 && !textAhead(list) ? "review" : "write");
    setNotice(null);
    setNudge(null);
    track("night_before", { step: "write", action: "shown", kind: list && hasContent(list) ? "held" : "new", source });
    // Only on opening and closing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Going to the background (the app may not come back) or unmounting: the words are saved now.
  useEffect(() => {
    if (!visible) return;
    const sub = RNAppState.addEventListener("change", (status) => {
      if (status === "background") settleRef.current();
    });
    return () => sub.remove();
  }, [visible]);
  useEffect(() => () => settleRef.current(), []);

  // VoiceOver moves to each stage's header.
  const headerRef = useRef<Text>(null);
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      if (headerRef.current) AccessibilityInfo.sendAccessibilityEvent(headerRef.current, "focus");
    });
    return () => cancelAnimationFrame(frame);
  }, [stage, visible]);

  const sort = async () => {
    const dump = text;
    const plan = target;
    if (!dump.trim() || !plan || sorting.current) return;
    flushText();
    // The rows are already these words' (Edit, no change): no new sort, no free sort spent.
    const current = heldRef.current;
    if (current && current.items.length > 0 && current.sortedText === dump) {
      setStage("review");
      return;
    }
    sorting.current = true;
    const mine = session.current;
    setStage("sorting");
    // The sorting block is a live region, which only TalkBack reads.
    announceLiveChange(NIGHT_COPY.sorting.replace("…", ""));
    try {
      // A dump longer than the AI path can give back is split on the device
      // (every line kept), and no free sort is spent on it.
      const aiReachable = proxyRouteUrl(getMomentumAiProxyUrl(), "brain-dump") != null && aiCanHoldAll(dump);
      // Plus: always the AI. Free: the shared three free sorts, then the simple split.
      let freeLeft: number | null = null;
      let freeLimit = false;
      if (!hasPlus && aiReachable) {
        freeLeft = await claimFreeAiDump();
        if (freeLeft === null) {
          freeLimit = true;
          track("plus_gate_hit", { feature: "brain_dump", source: "night_before" });
        }
      }
      const useAi = aiReachable && (hasPlus || freeLeft !== null);
      const memory = buildBasicMemory(state.history, today, state.memoryClearedAt ?? null);
      const sorted = await sortNight({
        dump,
        ...(plan.forDate !== today ? { forDay: weekdayFor(plan.forDate) } : {}),
        // 1.6 F: the AI reads dates for Plus only, as in the brain dump.
        ...(hasPlus ? { today } : {}),
        goalTitle: state.momentumProfile.goalTitle,
        stats: memoryStatsPayload(memory),
        useAi,
        timeoutMs: NIGHT_SORT_TIMEOUT_MS,
      });
      // The AI couldn't be reached: that free sort doesn't count.
      if (freeLeft !== null && sorted.source !== "ai") void refundFreeAiDump();
      if (hasPlus && sorted.source === "ai") void recordPlusUse("brain_dump");
      // Closed meanwhile: the rows are still made if the words are the ones sorted.
      const latest = heldRef.current;
      if (mine !== session.current) {
        if (latest && latest.forDay === plan.forDate && latest.text === dump) {
          write((list) => withSortedItems(list, sorted, dump, () => makeId()));
        }
        return;
      }
      const kind: SortKind = sorted.source !== "ai" ? "local" : hasPlus ? "ai" : "free_ai";
      const line = freeLimit
        ? FREE_LIMIT_NOTICE
        : useAi && sorted.source !== "ai"
          ? NIGHT_COPY.aiMissed
          : kind === "free_ai" && freeLeft !== null
            ? freeAiDumpNotice(freeLeft)
            : null;
      let made: NightList["items"] = [];
      write((list) => {
        const next = withSortedItems({ ...list, text: dump }, sorted, dump, () => makeId());
        made = next.items;
        return next;
      });
      setNotice(line ? { text: line, freeLimit } : null);
      setStage("review");
      track("night_before", { step: "review", action: "sorted", kind, count: made.length, source });
      announcePolitely(line ? `${sortedSpoken(made)} ${line}` : sortedSpoken(made));
    } finally {
      sorting.current = false;
    }
  };

  const toggle = (id: string) =>
    write((list) => ({ ...list, items: list.items.map((item) => (item.id === id ? { ...item, picked: !item.picked } : item)) }));

  const keep = () => {
    if (!target || !held || held.items.length === 0) return;
    updateNightBefore({ doneFor: target.nightOf });
    track("night_before", {
      step: "review",
      action: "kept",
      count: held.items.length,
      skipped: held.items.filter((item) => !item.picked).length,
      source,
    });
    setNudge(!record.reminder && !record.reminderAsked ? "ask" : null);
    setStage("done");
    // The done block is a live region, which only TalkBack reads.
    announceLiveChange(nightDoneSpoken(held, day));
  };

  const close = () => {
    // The words saved, and any line added since the list was made a row, before anything else.
    settle();
    if (stage === "done") {
      onDone();
      return;
    }
    track("night_before", { step: stage === "review" ? "review" : "write", action: "close", source });
    onClose();
  };

  const answerNudge = async (yes: boolean) => {
    track("night_before", { step: "reminder", action: yes ? "on" : "off", source });
    if (!yes) {
      updateNightBefore({ reminderAsked: true });
      setNudge(null);
      return;
    }
    updateNightBefore({ reminder: true, reminderAsked: true });
    // "Yes" means the reminder it names: make sure reminders are on, and say so when iOS won't let them.
    if (!state.notifications.enabled) setNotificationsEnabled(true);
    let permission = notificationPermission;
    if (permission === "undetermined") permission = await requestNotificationPermission();
    const works = permission === "granted";
    setNudge(works ? "on" : "blocked");
    announcePolitely(works ? `Reminder on at ${reminderTimeLabel(record.reminderMinutes)}` : NIGHT_COPY.nudgeBlocked);
  };

  const link = (label: string, onPress: () => void, testID: string, spoken?: string) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken ?? label}
      hitSlop={6}
      className="px-3 rounded-full items-center justify-center"
      style={{ minHeight: 44, backgroundColor: `${colors.primary}12` }}
      testID={testID}
    >
      <Text className="text-sm font-semibold" style={{ color: colors.primaryInk }}>
        {label}
      </Text>
    </Pressable>
  );

  const primary = (label: string, onPress: () => void, testID: string, disabled = false) => (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className="rounded-2xl py-4 px-4 items-center mt-2"
      style={{ minHeight: 44, backgroundColor: disabled ? colors.border : colors.primary }}
      testID={testID}
    >
      <Text
        className="text-lg text-center"
        style={{ fontFamily: Fonts.rounded, fontWeight: "700", color: disabled ? colors.muted : colors.onPrimary }}
      >
        {label}
      </Text>
    </Pressable>
  );

  const picked = items.filter((item) => item.picked).length;

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
        testID="night-before-sheet"
      >
        <View
          className="flex-row items-center justify-between px-5"
          style={{ paddingTop: Platform.OS === "ios" ? 18 : insets.top + 12 }}
        >
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={2}
            className="flex-1 text-2xl text-foreground"
            style={{ fontFamily: Fonts.rounded, fontWeight: "700" }}
          >
            {day === "today" ? NIGHT_COPY.sheetTitleToday : NIGHT_COPY.sheetTitle}
          </Text>
          <Pressable
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            accessibilityHint={stage === "done" ? undefined : "What you wrote is kept till morning"}
            hitSlop={12}
            style={{ minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center" }}
            testID="night-before-close"
          >
            <Ionicons name="close" size={26} color={colors.muted} />
          </Pressable>
        </View>

        {/* Everything scrolls, the buttons too: nothing fixed hides a row at large text. */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 14 }}
        >
          {stage === "write" && (
            <>
              <Text ref={headerRef} className="text-base" style={{ color: colors.muted }} testID="night-before-write-hint">
                {NIGHT_COPY.writeHint.replace("{day}", day)}
              </Text>
              <TextInput
                value={text}
                onChangeText={(value) => {
                  setText(value);
                  textRef.current = value;
                  // Saved after a pause (and at once on closing or leaving the app).
                  if (saveTimer.current) clearTimeout(saveTimer.current);
                  saveTimer.current = setTimeout(flushText, NIGHT_TEXT_SAVE_MS);
                }}
                multiline
                autoFocus
                scrollEnabled
                maxLength={MAX_BRAIN_DUMP_CHARS}
                placeholder={"Call the dentist\nFinish the slides\nBuy milk…"}
                placeholderTextColor={colors.muted}
                accessibilityLabel={`What's on your mind for ${day}`}
                accessibilityHint="Type or dictate. One per line is fine."
                className="rounded-2xl border p-4 text-base"
                style={{
                  minHeight: 180,
                  maxHeight: 320,
                  textAlignVertical: "top",
                  color: colors.foreground,
                  borderColor: colors.controlBorder,
                  backgroundColor: colors.surface,
                  fontWeight: "600",
                }}
                testID="night-before-input"
              />
              {primary(NIGHT_COPY.writeButton, () => void sort(), "night-before-sort", !text.trim())}
            </>
          )}

          {stage === "sorting" && (
            <View className="items-center gap-3 py-16" accessibilityLiveRegion="polite" testID="night-before-sorting">
              <ActivityIndicator color={colors.primary} />
              <Text ref={headerRef} className="text-base" style={{ color: colors.muted }}>
                {NIGHT_COPY.sorting}
              </Text>
            </View>
          )}

          {stage === "review" && (
            <>
              <Text
                ref={headerRef}
                accessibilityRole="header"
                className="text-lg text-foreground"
                style={{ fontWeight: "700" }}
                testID="night-before-review-title"
              >
                {NIGHT_COPY.reviewTitle}
              </Text>
              <Text className="text-base" style={{ color: colors.muted }} testID="night-before-review-hint">
                {items.length > 0 ? NIGHT_COPY.reviewHint : NIGHT_COPY.empty}
              </Text>
              {notice ? (
                <View
                  className="flex-row flex-wrap items-center gap-2 rounded-2xl p-3"
                  style={{ backgroundColor: colors.surface }}
                  testID="night-before-notice"
                >
                  <Ionicons name="information-circle-outline" size={18} color={colors.muted} />
                  <Text className="flex-1 text-sm" style={{ color: colors.muted, minWidth: 160 }}>
                    {notice.text}
                  </Text>
                  {/* Quiet: a link, not a paywall. The list is held either way. */}
                  {notice.freeLimit && onSeePlus ? (
                    <Pressable
                      onPress={() => {
                        track("night_before", { step: "review", action: "plus", source });
                        onSeePlus();
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={NIGHT_COPY.seePlus}
                      accessibilityHint="Shows Plus plans. Your list is kept."
                      hitSlop={6}
                      style={{ minHeight: 44, justifyContent: "center" }}
                      testID="night-before-see-plus"
                    >
                      <Text className="text-sm font-semibold" style={{ color: colors.primaryInk }}>
                        {NIGHT_COPY.seePlus}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <View className="flex-row flex-wrap gap-2">
                {picked > 0
                  ? link(
                      NIGHT_COPY.clear,
                      () => write((list) => ({ ...list, items: list.items.map((item) => ({ ...item, picked: false })) })),
                      "night-before-clear",
                    )
                  : null}
                {link(NIGHT_COPY.edit, () => setStage("write"), "night-before-edit", "Edit what I wrote")}
              </View>
              {items.map((item) => {
                const on = item.picked;
                const label = on ? (
                  <Text className="text-xs font-semibold" style={{ color: colors.primaryInk }} testID="night-before-row-first">
                    {NIGHT_COPY.rowFirst}
                  </Text>
                ) : null;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => toggle(item.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={item.text}
                    accessibilityValue={on ? { text: "do first" } : undefined}
                    accessibilityHint={on ? undefined : "Marks it to do first"}
                    className="rounded-2xl border px-4 py-3 flex-row items-center gap-3"
                    style={{
                      minHeight: 44,
                      // controlBorder: the unticked ring is the control.
                      borderColor: on ? colors.primary : colors.controlBorder,
                      backgroundColor: on ? `${colors.primary}10` : colors.surface,
                    }}
                    testID="night-before-row"
                  >
                    {/* A flag, not a tick: "do first", not "done". */}
                    <Ionicons name={on ? "flag" : "flag-outline"} size={22} color={on ? colors.primary : colors.controlBorder} />
                    <View className="flex-1 gap-0.5">
                      <Text className="text-base text-foreground" style={{ fontWeight: "700" }}>
                        {item.text}
                      </Text>
                      {labelUnder ? label : null}
                    </View>
                    {labelUnder ? null : label}
                  </Pressable>
                );
              })}
              {primary(NIGHT_COPY.keep, keep, "night-before-keep", items.length === 0)}
            </>
          )}

          {stage === "done" && held && (
            <>
              <View className="items-center gap-3 py-8" accessibilityLiveRegion="polite" testID="night-before-done">
                <Ionicons name="moon-outline" size={36} color={colors.primary} />
                <Text
                  ref={headerRef}
                  accessibilityRole="header"
                  className="text-base text-center text-foreground"
                  style={{ fontWeight: "600" }}
                  testID="night-before-done-line"
                >
                  {nightDoneLine(held, day)}
                </Text>
              </View>
              {nudge === "ask" ? (
                <View
                  className="rounded-2xl border p-4 gap-3"
                  style={{ borderColor: colors.border, backgroundColor: colors.surface }}
                  testID="night-before-nudge"
                >
                  <Text className="text-base text-foreground" style={{ fontWeight: "600" }}>
                    {NIGHT_COPY.nudgeAsk.replace("{time}", reminderTimeLabel(record.reminderMinutes))}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {link(NIGHT_COPY.nudgeYes, () => void answerNudge(true), "night-before-nudge-yes", "Yes, remind me")}
                    {link(NIGHT_COPY.nudgeNo, () => void answerNudge(false), "night-before-nudge-no")}
                  </View>
                </View>
              ) : nudge === "on" ? (
                <Text className="text-sm text-center" style={{ color: colors.muted }} testID="night-before-nudge-on">
                  {`We'll remind you at ${reminderTimeLabel(record.reminderMinutes)}. Change it in Settings › Reminders.`}
                </Text>
              ) : nudge === "blocked" ? (
                <Text className="text-sm text-center" style={{ color: colors.muted }} testID="night-before-nudge-blocked">
                  {NIGHT_COPY.nudgeBlocked}
                </Text>
              ) : null}
              {primary(NIGHT_COPY.done, onDone, "night-before-finish")}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
