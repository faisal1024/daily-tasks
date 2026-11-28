// The night before (1.7): write what's on your mind → it becomes a list →
// tick the ones to do first → keep it till morning. Nothing is thrown out
// at night and nothing is filed: the typed text and the list are held as
// they are (state.nightList, saved with the app's state, so a killed app
// keeps even a half-written dump). Closing keeps them; reopening the same
// night brings them back to edit. The morning card decides what's added or
// saved. Rules and words: lib/daily-tasks/night-before.ts.
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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
  dayWord,
  emptyNightList,
  hasContent,
  listFor,
  NIGHT_COPY,
  NIGHT_SORT_TIMEOUT_MS,
  nightBeforeOf,
  nightDoneLine,
  nightDoneSpoken,
  reminderTimeLabel,
  sortedSpoken,
  sortNight,
  weekdayFor,
  withSortedItems,
  type NightTarget,
} from "@/lib/daily-tasks/night-before";
import { makeId } from "@/lib/daily-tasks/storage";
import { recordPlusUse } from "@/lib/daily-tasks/trial-note";
import { useDailyTasks } from "@/lib/daily-tasks/store";
import type { NightList } from "@/lib/daily-tasks/types";

type Stage = "write" | "sorting" | "review" | "done";
export type NightBeforeSource = "today" | "notification" | "whats_new";
type SortKind = "ai" | "local" | "free_ai";

/** From this text size the row's "First" label goes under the words. */
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
    updateNightBefore,
    setNotificationsEnabled,
    notificationPermission,
    requestNotificationPermission,
  } = useDailyTasks();
  const held = target ? listFor(state.nightList, target.forDate) : null;
  // The latest list, for what lands after an await.
  const heldRef = useRef<NightList | null>(held);
  heldRef.current = held;
  const [stage, setStage] = useState<Stage>("write");
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<{ text: string; freeLimit: boolean } | null>(null);
  const [nudge, setNudge] = useState<"ask" | "on" | null>(null);
  // Bumped on every open and close: a sort that lands after the sheet closed belongs to nobody.
  const session = useRef(0);
  const record = nightBeforeOf(state);
  const day = target ? dayWord(target, today) : "tomorrow";
  const items = held?.items ?? [];

  useEffect(() => {
    session.current += 1;
    if (!visible) return;
    // Reopened the same night: the words and the list as they were.
    const list = heldRef.current;
    setText(list?.text ?? "");
    setStage(list && list.items.length > 0 ? "review" : "write");
    setNotice(null);
    setNudge(null);
    track("night_before", { step: "write", action: "shown", kind: list && hasContent(list) ? "held" : "new", source });
    // Only on opening and closing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** This night's list with `change` applied (started now if there's none; one for another day is replaced). */
  const write = (change: (list: NightList) => NightList) => {
    if (!target) return;
    const base = heldRef.current ?? emptyNightList(target, new Date().toISOString());
    const next = change(base);
    heldRef.current = next;
    setNightList(next);
  };

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
    const dump = text.trim();
    if (!dump || !target) return;
    const mine = session.current;
    setStage("sorting");
    // The sorting block is a live region, which only TalkBack reads.
    announceLiveChange(NIGHT_COPY.sorting.replace("…", ""));
    const aiReachable = proxyRouteUrl(getMomentumAiProxyUrl(), "brain-dump") != null;
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
      ...(target.forDate !== today ? { forDay: weekdayFor(target.forDate) } : {}),
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
    // Closed meanwhile: the words are held; the list is made next time.
    if (mine !== session.current) return;
    const kind: SortKind = sorted.source !== "ai" ? "local" : hasPlus ? "ai" : "free_ai";
    const line = freeLimit
      ? FREE_LIMIT_NOTICE
      : useAi && sorted.source !== "ai"
        ? NIGHT_COPY.aiMissed
        : kind === "free_ai" && freeLeft !== null
          ? freeAiDumpNotice(freeLeft)
          : null;
    let made: NightList | null = null;
    write((list) => {
      made = withSortedItems({ ...list, text }, sorted, () => makeId());
      return made;
    });
    setNotice(line ? { text: line, freeLimit } : null);
    setStage("review");
    const rows = (made as NightList | null)?.items ?? [];
    track("night_before", { step: "review", action: "sorted", kind, count: rows.length, source });
    announcePolitely(line ? `${sortedSpoken(rows)} ${line}` : sortedSpoken(rows));
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
    if (stage === "done") {
      onDone();
      return;
    }
    // Nothing written at all: no empty list is left behind.
    if (held && !hasContent(held)) setNightList(null);
    track("night_before", { step: stage === "review" ? "review" : "write", action: "close", source });
    onClose();
  };

  const answerNudge = (yes: boolean) => {
    if (yes) {
      updateNightBefore({ reminder: true, reminderAsked: true });
      // "Yes" means the nudge it names: make sure reminders are on.
      if (!state.notifications.enabled) setNotificationsEnabled(true);
      if (notificationPermission === "undetermined") void requestNotificationPermission();
      announcePolitely(`Nudge on at ${reminderTimeLabel(record.reminderMinutes)}`);
    } else {
      updateNightBefore({ reminderAsked: true });
    }
    track("night_before", { step: "reminder", action: yes ? "on" : "off", source });
    setNudge(yes ? "on" : null);
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
      <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
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
                  // Held as it's typed: a killed app keeps it too.
                  write((list) => ({ ...list, text: value }));
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
              <Text className="text-base" style={{ color: colors.muted }}>
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
                      <Text className="text-sm font-semibold" style={{ color: colors.primary }}>
                        {NIGHT_COPY.seePlus}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <View className="flex-row flex-wrap gap-2">
                {picked > 0
                  ? link(NIGHT_COPY.clear, () => write((list) => ({ ...list, items: list.items.map((item) => ({ ...item, picked: false })) })), "night-before-clear")
                  : null}
                {link(NIGHT_COPY.edit, () => setStage("write"), "night-before-edit", "Edit what I wrote")}
              </View>
              {items.map((item) => {
                const on = item.picked;
                const label = on ? (
                  <Text className="text-xs font-semibold" style={{ color: colors.primary }} testID="night-before-row-first">
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
                    accessibilityValue={on ? { text: "first in the morning" } : undefined}
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
                    <Ionicons
                      name={on ? "checkmark-circle" : "ellipse-outline"}
                      size={24}
                      color={on ? colors.primary : colors.controlBorder}
                    />
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
                    {link(NIGHT_COPY.nudgeYes, () => answerNudge(true), "night-before-nudge-yes", "Yes, nudge me")}
                    {link(NIGHT_COPY.nudgeNo, () => answerNudge(false), "night-before-nudge-no")}
                  </View>
                </View>
              ) : nudge === "on" ? (
                <Text className="text-sm text-center" style={{ color: colors.muted }} testID="night-before-nudge-on">
                  {`We'll nudge you at ${reminderTimeLabel(record.reminderMinutes)}. Change it in Settings › Reminders.`}
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
