import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { Fonts } from "@/constants/theme";
import { useSheetAnimation } from "@/hooks/use-sheet-animation";
import { useColors } from "@/hooks/use-colors";
import { MAX_BRAIN_DUMP_CHARS, pickReason, type SortedBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { PRIVACY_URL } from "@/lib/daily-tasks/links";

const NUMBER_WORDS = ["zero", "one", "two", "three"];
const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

// Shown instead of the sorter's own notice: this screen only unticks.
const FALLBACK_NOTICE = "We couldn't sort this one, so here are the first few. Untick any that aren't for today.";
// The free AI sorts are used up (e.g. after "Reset all data"): say so.
const FIRST_RUN_LIMIT_NOTICE =
  "Your free AI sorts are used up, so we kept the first things you wrote. Untick any that aren't for today.";

// Three screens since 1.5: the dump (with "sorting" while it's picked) and
// "Here are your three", then Today. The morning nudge and the widget tip
// became Today cards (components/daily-tasks/first-days-cards.tsx).
export type FirstRunStep = "dump" | "sorting" | "three";

/**
 * How first run ended: `picked` tasks went on today; `source` is "dump" (a
 * dump was sorted), "own" ("I'll add my own") or "resume" (tasks were already
 * on today when it opened, so nothing was asked).
 */
export interface FirstRunResult {
  picked: number;
  source: "dump" | "own" | "resume";
  /** 1.5 D: what to call them, typed on the "three" screen (optional; absent when left empty). */
  name?: string;
}

/** The longest name kept (the same as Settings' field). */
export const FIRST_RUN_NAME_MAX = 40;

interface FirstRunProps {
  visible: boolean;
  /** Sort the dump into picks and the rest (AI when available, else local). */
  onSort: (text: string) => Promise<SortedBrainDump>;
  /** The chosen three go on today's list; the rest is saved for later. */
  /** Returns how many actually went on today (0 when the day was locked meanwhile). */
  onSet: (picks: string[], parked: string[]) => number;
  onStep?: (step: FirstRunStep) => void;
  /**
   * Tasks already on today when it (re)appears (an earlier first run that
   * added them but didn't get to finish): nothing left to ask, so it finishes.
   */
  resumeCount?: number;
  /** Over: on to Today. `picked` is how many went on today's list here. */
  onFinish: (result: FirstRunResult) => void;
}

/**
 * First run, in the app's own ritual: dump what's on your mind → we pick
 * three → Today. No questionnaire: goal and name are asked later, and the
 * morning nudge and the widget tip on Today, when they're useful.
 */
export function FirstRun({ visible, onSort, onSet, onStep, onFinish, resumeCount = 0 }: FirstRunProps) {
  const colors = useColors();
  const sheetAnimation = useSheetAnimation();
  const [step, setStep] = useState<FirstRunStep>("dump");
  const [text, setText] = useState("");
  const [picks, setPicks] = useState<string[]>([]);
  // Why each pick was picked (1.5), same order as picks; null for none.
  const [reasons, setReasons] = useState<(string | null)[]>([]);
  const [parked, setParked] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  // 1.5 D: optional, on the "three" screen; saved as the name in greetings.
  const [name, setName] = useState("");
  const sortRun = useRef(0);
  // Guards against double taps (two sorts, or the three added twice).
  const committing = useRef(false);
  const stepRef = useRef<FirstRunStep>("dump");
  stepRef.current = step;

  const go = (next: FirstRunStep) => {
    setStep(next);
    onStep?.(next);
    // VoiceOver: the old step's controls are gone, so say where we are.
    if (next === "sorting") AccessibilityInfo.announceForAccessibility("Picking your three");
  };

  // Each first run starts fresh at the dump (also after "Reset all data").
  useEffect(() => {
    if (!visible) return;
    sortRun.current += 1;
    committing.current = false;
    setText("");
    setPicks([]);
    setReasons([]);
    setParked([]);
    setChosen(new Set());
    setNotice(null);
    setName("");
    setStep("dump");
    if (resumeCount > 0) {
      committing.current = true;
      onFinish({ picked: 0, source: "resume" });
      return;
    }
    onStep?.("dump");
    // onStep / onFinish are callbacks; re-running on their identity would re-log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const sort = async () => {
    const trimmed = text.trim();
    if (!trimmed || stepRef.current !== "dump") return;
    stepRef.current = "sorting";
    const run = ++sortRun.current;
    go("sorting");
    const sorted = await onSort(trimmed);
    if (run !== sortRun.current) return;
    const { picks: nextPicks, parked: nextParked } = sorted.result;
    if (nextPicks.length === 0) {
      // Nothing to pick (e.g. only notes): keep it all and move on to Today.
      if (committing.current) return;
      committing.current = true;
      onSet([], nextParked);
      onFinish({ picked: 0, source: "dump" });
      return;
    }
    setPicks(nextPicks);
    setReasons(nextPicks.map((_, index) => pickReason(sorted.result, index)));
    setParked(nextParked);
    setChosen(new Set(nextPicks));
    const nextNotice = sorted.freeLimit
      ? FIRST_RUN_LIMIT_NOTICE
      : sorted.freeSortUsed
        ? sorted.notice
        : sorted.notice
          ? FALLBACK_NOTICE
          : null;
    setNotice(nextNotice);
    go("three");
    // The notice sits below the title: say it, so VoiceOver users hear it too.
    if (nextNotice) AccessibilityInfo.announceForAccessibility(nextNotice);
  };

  const confirm = () => {
    const use = picks.filter((pick) => chosen.has(pick));
    if (use.length === 0 || committing.current) return;
    committing.current = true;
    const rest = [...picks.filter((pick) => !chosen.has(pick)), ...parked];
    const picked = onSet(use, rest);
    const typed = name.trim().replace(/\s+/g, " ").slice(0, FIRST_RUN_NAME_MAX);
    onFinish(typed ? { picked, source: "dump", name: typed } : { picked, source: "dump" });
  };

  const toggle = (pick: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(pick)) next.delete(pick);
      else next.add(pick);
      return next;
    });
  };

  const chosenCount = picks.filter((pick) => chosen.has(pick)).length;

  const footer = (() => {
    switch (step) {
      case "dump":
        return (
          <>
            <Primary label="Pick my three" disabled={!text.trim()} onPress={() => void sort()} />
            <Secondary
              label="I'll add my own"
              onPress={() => {
                if (committing.current) return;
                committing.current = true;
                onFinish({ picked: 0, source: "own" });
              }}
            />
          </>
        );
      case "sorting":
        return (
          <Secondary
            label="Cancel"
            onPress={() => {
              // Ignore the reply when it lands; the text is kept.
              sortRun.current += 1;
              go("dump");
            }}
          />
        );
      case "three":
        return (
          <>
            <Primary
              label={chosenCount === 1 ? "Use this one" : `Use these ${countWord(chosenCount)}`}
              disabled={chosenCount === 0}
              onPress={confirm}
            />
            <Secondary
              label="Start over"
              onPress={() => {
                committing.current = false;
                go("dump");
              }}
            />
          </>
        );
    }
  })();

  return (
    <Modal visible={visible} animationType={sheetAnimation} presentationStyle="fullScreen" onRequestClose={() => {}}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 72, gap: 20 }}
          keyboardShouldPersistTaps="handled"
          testID={`first-run-${step}`}
        >
          {step === "dump" && (
            <>
              <Title
                title="What's on your mind today?"
                body="Type everything: work, errands, the thing you keep putting off. We'll pick three for today and save the rest."
              />
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="e.g. finish the report, call the dentist, groceries, reply to Sam, go for a run…"
                placeholderTextColor={colors.muted}
                multiline
                autoFocus
                maxLength={MAX_BRAIN_DUMP_CHARS}
                accessibilityLabel="What's on your mind today"
                className="text-base text-foreground rounded-2xl px-4 py-3"
                style={{
                  minHeight: 140,
                  textAlignVertical: "top",
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                }}
              />
              <Text className="text-sm" style={{ color: colors.muted }}>
                Tip: tap the microphone on your keyboard to say it instead.
              </Text>
              <Text className="text-xs" style={{ color: colors.muted }}>
                To pick your three, what you type is sent to our AI service (it isn&apos;t
                stored or used for ads). Please leave out anything sensitive.{" "}
                <Text
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(PRIVACY_URL)}
                  style={{ color: colors.primary, textDecorationLine: "underline" }}
                >
                  Privacy policy
                </Text>
              </Text>
            </>
          )}

          {step === "sorting" && (
            <View className="flex-1 items-center justify-center gap-3">
              <ActivityIndicator color={colors.primary} size="large" />
              <Text className="text-base" style={{ color: colors.muted }}>
                Picking your three…
              </Text>
            </View>
          )}

          {step === "three" && (
            <>
              <Title
                title={picks.length === 1 ? "Here's one for today" : `Here are your ${countWord(picks.length)} for today`}
                body="Untick anything that isn't for today and we'll save it for later."
              />
              {notice ? (
                <Text className="text-sm" style={{ color: colors.muted }}>
                  {notice}
                </Text>
              ) : null}
              <View className="gap-2">
                {picks.map((pick, index) => {
                  const on = chosen.has(pick);
                  const reason = reasons[index] ?? null;
                  return (
                    <Pressable
                      key={pick}
                      onPress={() => toggle(pick)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={pick}
                      accessibilityValue={reason ? { text: reason } : undefined}
                      accessibilityHint={on ? "Untick to save it for later" : "Tick to do it today"}
                      className="flex-row items-center gap-3 rounded-2xl border p-4"
                      style={{
                        borderColor: on ? colors.primary : colors.border,
                        backgroundColor: on ? `${colors.primary}10` : colors.surface,
                      }}
                    >
                      <Ionicons
                        name={on ? "checkmark-circle" : "ellipse-outline"}
                        size={22}
                        color={on ? colors.primary : colors.muted}
                        accessibilityElementsHidden
                      />
                      <View className="flex-1">
                        <Text className="text-base text-foreground" style={{ fontWeight: "600" }}>
                          {pick}
                        </Text>
                        {reason ? (
                          <Text className="text-sm mt-0.5" style={{ color: colors.muted }} testID="first-run-reason">
                            {reason}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {parked.length > 0 ? (
                <Text className="text-sm" style={{ color: colors.muted }}>
                  {parked.length === 1 ? "1 more thing" : `${parked.length} more things`} saved for later.
                </Text>
              ) : null}
              {/* 1.5 D: one optional field, no extra screen. */}
              <View className="gap-2 mt-2">
                <Text className="text-base font-semibold text-foreground" nativeID="first-run-name-label">
                  What should we call you?
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Your name (optional)"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="words"
                  autoComplete="given-name"
                  textContentType="givenName"
                  returnKeyType="done"
                  maxLength={FIRST_RUN_NAME_MAX}
                  accessibilityLabel="What should we call you? Optional"
                  accessibilityLabelledBy="first-run-name-label"
                  className="text-base text-foreground rounded-2xl px-4 py-3"
                  style={{ borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}
                  testID="first-run-name"
                />
                <Text className="text-sm" style={{ color: colors.muted }}>
                  For your greeting. Change it anytime in Settings.
                </Text>
              </View>
            </>
          )}

        </ScrollView>
        {/* Outside the scroll view so it rides above the keyboard. */}
        <View className="gap-2" style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36 }}>
          {footer}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Title({ title, body }: { title: string; body: string }) {
  const colors = useColors();
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontWeight: "700", fontSize: 28 }}>
        {title}
      </Text>
      <Text className="text-base" style={{ color: colors.muted }}>
        {body}
      </Text>
    </View>
  );
}

function Primary({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      className="rounded-full py-4 items-center"
      style={{ backgroundColor: disabled ? colors.border : colors.primary }}
    >
      <Text style={{ color: disabled ? colors.muted : colors.onPrimary, fontWeight: "700", fontSize: 17 }}>{label}</Text>
    </Pressable>
  );
}

function Secondary({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} className="items-center py-2">
      <Text className="text-base font-semibold" style={{ color: colors.primary }}>
        {label}
      </Text>
    </Pressable>
  );
}
