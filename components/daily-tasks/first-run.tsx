import { useEffect, useRef, useState } from "react";
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

import { BodyFont, Fonts } from "@/constants/theme";
import { useColors } from "@/hooks/use-colors";
import { MAX_BRAIN_DUMP_CHARS, type SortedBrainDump } from "@/lib/daily-tasks/ai-helpers";

export type FirstRunStep = "dump" | "sorting" | "three" | "nudge" | "widget";

interface FirstRunProps {
  visible: boolean;
  /** Sort the dump into picks and the rest (AI when available, else local). */
  onSort: (text: string) => Promise<SortedBrainDump>;
  /** The chosen three go on today's list; the rest is saved for later. */
  onSet: (picks: string[], parked: string[]) => void;
  /** Ask for notification permission; resolves true when granted. */
  onAskNudge: () => Promise<boolean>;
  /** The Home Screen widget exists on iOS only. */
  showWidgetStep: boolean;
  onStep?: (step: FirstRunStep) => void;
  onFinish: () => void;
}

/**
 * First run, in the app's own ritual: dump what's on your mind → we pick
 * three → they're set → a morning nudge → the widget. No questionnaire:
 * goal and name are asked later, when they're useful.
 */
export function FirstRun({
  visible,
  onSort,
  onSet,
  onAskNudge,
  showWidgetStep,
  onStep,
  onFinish,
}: FirstRunProps) {
  const colors = useColors();
  const [step, setStep] = useState<FirstRunStep>("dump");
  const [text, setText] = useState("");
  const [picks, setPicks] = useState<string[]>([]);
  const [parked, setParked] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [setCount, setSetCount] = useState(0);
  const [asking, setAsking] = useState(false);
  const sortRun = useRef(0);

  const go = (next: FirstRunStep) => {
    setStep(next);
    onStep?.(next);
  };

  // Each first-run starts at the dump.
  useEffect(() => {
    if (!visible) return;
    setStep("dump");
    onStep?.("dump");
    // onStep is an analytics callback; re-running on its identity would re-log.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const sort = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const run = ++sortRun.current;
    go("sorting");
    const sorted = await onSort(trimmed);
    if (run !== sortRun.current) return;
    const { picks: nextPicks, parked: nextParked } = sorted.result;
    if (nextPicks.length === 0) {
      // Nothing to pick (e.g. only notes): keep it all and move on.
      onSet([], nextParked);
      setSetCount(0);
      go("nudge");
      return;
    }
    setPicks(nextPicks);
    setParked(nextParked);
    setChosen(new Set(nextPicks));
    setNotice(sorted.notice);
    go("three");
  };

  const confirm = () => {
    const use = picks.filter((pick) => chosen.has(pick));
    if (use.length === 0) return;
    const rest = [...picks.filter((pick) => !chosen.has(pick)), ...parked];
    onSet(use, rest);
    setSetCount(use.length);
    go("nudge");
  };

  const askNudge = async () => {
    if (asking) return;
    setAsking(true);
    try {
      await onAskNudge();
    } finally {
      setAsking(false);
    }
    afterNudge();
  };

  const afterNudge = () => {
    if (showWidgetStep) go("widget");
    else onFinish();
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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: colors.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 72, paddingBottom: 40, gap: 20 }}
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
                  minHeight: 160,
                  textAlignVertical: "top",
                  borderWidth: 1,
                  borderColor: colors.border,
                  backgroundColor: colors.surface,
                }}
              />
              <Text className="text-sm" style={{ color: colors.muted }}>
                Tip: tap the microphone on your keyboard to say it instead.
              </Text>
              <View className="flex-1" />
              <Primary label="Pick my three" disabled={!text.trim()} onPress={() => void sort()} />
              <Secondary
                label="I'll add my own"
                onPress={() => {
                  setSetCount(0);
                  go("nudge");
                }}
              />
            </>
          )}

          {step === "sorting" && (
            <View className="flex-1 items-center justify-center gap-3" accessibilityLiveRegion="polite">
              <ActivityIndicator color={colors.primary} size="large" />
              <Text className="text-base" style={{ color: colors.muted }}>
                Picking your three…
              </Text>
            </View>
          )}

          {step === "three" && (
            <>
              <Title
                title={picks.length === 1 ? "Here's one for today" : `Here are your ${picks.length} for today`}
                body="Untick anything that isn't for today. It'll be saved for later."
              />
              {notice ? (
                <Text className="text-sm" style={{ color: colors.muted }}>
                  {notice}
                </Text>
              ) : null}
              <View className="gap-2">
                {picks.map((pick) => {
                  const on = chosen.has(pick);
                  return (
                    <Pressable
                      key={pick}
                      onPress={() => toggle(pick)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={pick}
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
                      <Text className="flex-1 text-base text-foreground" style={{ fontFamily: BodyFont.semibold }}>
                        {pick}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {parked.length > 0 ? (
                <Text className="text-sm" style={{ color: colors.muted }}>
                  {parked.length === 1 ? "1 more thing" : `${parked.length} more things`} saved for later.
                </Text>
              ) : null}
              <View className="flex-1" />
              <Primary
                label={chosenCount === 1 ? "Set this one" : `Set my ${chosenCount === 3 ? "three" : chosenCount}`}
                disabled={chosenCount === 0}
                onPress={confirm}
              />
              <Secondary label="Start over" onPress={() => go("dump")} />
            </>
          )}

          {step === "nudge" && (
            <>
              <Title
                title={setCount > 0 ? (setCount === 1 ? "It's set." : "Your three are set.") : "You're all set."}
                body={
                  setCount > 0
                    ? "Do them today and tap each one off. Want a nudge each morning with your three, and one in the evening to close the day?"
                    : "Want a nudge each morning to pick your three, and one in the evening to close the day?"
                }
              />
              <View className="flex-1" />
              <Primary label={asking ? "Asking…" : "Yes, nudge me"} disabled={asking} onPress={() => void askNudge()} />
              <Secondary label="Not now" onPress={afterNudge} />
            </>
          )}

          {step === "widget" && (
            <>
              <Title
                title="Keep your three in sight"
                body="Add the widget so today's three are on your Home Screen or Lock Screen."
              />
              <View className="rounded-2xl bg-surface border border-border p-4 gap-3">
                {[
                  "Touch and hold an empty spot on your Home Screen.",
                  "Tap Edit, then Add Widget.",
                  "Search for this app and add it.",
                ].map((line, index) => (
                  <View key={line} className="flex-row gap-3">
                    <Text style={{ color: colors.primary, fontFamily: BodyFont.bold }}>{index + 1}</Text>
                    <Text className="flex-1 text-base text-foreground">{line}</Text>
                  </View>
                ))}
              </View>
              <View className="flex-1" />
              <Primary label="Done" onPress={onFinish} />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Title({ title, body }: { title: string; body: string }) {
  const colors = useColors();
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" style={{ color: colors.foreground, fontFamily: Fonts.rounded, fontSize: 28 }}>
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
      <Text style={{ color: disabled ? colors.muted : "#fff", fontFamily: BodyFont.bold, fontSize: 17 }}>{label}</Text>
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
