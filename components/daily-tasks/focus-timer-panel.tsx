// Focus mode's timer (1.2), modelled on Apple's Clock timer: pick a length
// (5 / 10 / 20 min, the last custom one, or Custom on a duration wheel), then
// Start; while it runs, Pause / Resume and Cancel. Optional: nothing runs
// until Start.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, AppState, Platform, Pressable, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { ProgressRing } from "@/components/daily-tasks/progress-ring";
import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useColors } from "@/hooks/use-colors";
import {
  FOCUS_TIMER_DEFAULT_CUSTOM_MINUTES,
  FOCUS_TIMER_MAX_MINUTES,
  FOCUS_TIMER_MIN_MINUTES,
  FOCUS_TIMER_PRESETS,
  clampTimerMinutes,
  durationShort,
  durationWords,
  formatEndTime,
  formatRemaining,
  timesUpText,
} from "@/lib/daily-tasks/focus-timer";
import { loadLastCustomTimer, saveLastCustomTimer } from "@/lib/daily-tasks/focus-timer-storage";
import {
  cancelFocusTimerNotification,
  scheduleFocusTimerNotification,
} from "@/lib/daily-tasks/notifications";

const MINUTE_MS = 60_000;
/** Lets the tapped button's own label read out before the announcement. */
const ANNOUNCE_DELAY_MS = 300;
/** The fallback stepper's step (Android and the web have no duration wheel). */
const STEPPER_STEP = 5;

/** A picked length: a chip's minutes, or the Custom wheel. */
type Choice = number | "custom" | null;

/**
 * A run. `endAt` while it's running (or finished), `pausedMs` (time left)
 * while it's paused: one or the other.
 */
interface Run {
  minutes: number;
  endAt: number | null;
  pausedMs: number;
}

/** Today's date at h:mm, which is how the countdown wheel holds a length. */
function wheelDate(minutes: number): Date {
  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

interface FocusTimerPanelProps {
  /** A timer started (Start or Restart), with its length in minutes. */
  onStart: (minutes: number) => void;
}

/**
 * Timestamp based, so it's right after the app comes back from the
 * background; it ticks each second only while running. The end notification
 * is scheduled only while it runs: cancelled on Pause, Cancel, finishing
 * in-app and unmount (focus mode closing), and scheduled again on Resume.
 */
export function FocusTimerPanel({ onStart }: FocusTimerPanelProps) {
  const colors = useColors();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const [choice, setChoice] = useState<Choice>(null);
  const [customMinutes, setCustomMinutes] = useState(FOCUS_TIMER_DEFAULT_CUSTOM_MINUTES);
  const [lastCustom, setLastCustom] = useState<number | null>(null);
  // Remounts the wheel when a length had to be clamped, so it shows the clamp.
  const [wheelKey, setWheelKey] = useState(0);
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The last custom length, offered as a chip. Best-effort.
  const touchedCustom = useRef(false);
  useEffect(() => {
    let live = true;
    void loadLastCustomTimer().then((minutes) => {
      if (!live || minutes === null) return;
      setLastCustom(minutes);
      if (!touchedCustom.current) setCustomMinutes(minutes);
    });
    return () => {
      live = false;
    };
  }, []);

  const durationMs = run ? run.minutes * MINUTE_MS : 0;
  // Clamped both ways: the clock can move back as well as forward.
  const remainingMs = !run
    ? 0
    : run.endAt === null
      ? run.pausedMs
      : Math.min(durationMs, Math.max(0, run.endAt - now));
  const paused = run !== null && run.endAt === null;
  const running = run !== null && run.endAt !== null && remainingMs > 0;
  const finished = run !== null && run.endAt !== null && remainingMs === 0;
  const runningEndAt = running ? run.endAt : null;

  useEffect(() => {
    if (!running) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (status) => {
      if (status === "active") setNow(Date.now());
    });
    return () => {
      clearInterval(tick);
      sub.remove();
    };
  }, [running]);

  // A notification for the end, in case they're in another app (only with
  // permission already given). Replaced on a restart or resume; cancelled
  // (and cleared if it already went off) as soon as it isn't running.
  const runMinutes = run?.minutes ?? 0;
  useEffect(() => {
    if (runningEndAt === null) return;
    void scheduleFocusTimerNotification(new Date(runningEndAt), runMinutes);
    return () => {
      void cancelFocusTimerNotification();
    };
  }, [runningEndAt, runMinutes]);

  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announceSoon = (text: string) => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => {
      announceTimer.current = null;
      AccessibilityInfo.announceForAccessibility(text);
    }, ANNOUNCE_DELAY_MS);
  };
  useEffect(
    () => () => {
      if (announceTimer.current) clearTimeout(announceTimer.current);
    },
    [],
  );

  // Once per run: one light haptic and the line read out. Never closes.
  useEffect(() => {
    if (!finished || !run) return;
    if (announceTimer.current) clearTimeout(announceTimer.current);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    AccessibilityInfo.announceForAccessibility(timesUpText(run.minutes));
    // Only when it finishes; the length can't change without a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const chosenMinutes = choice === "custom" ? customMinutes : choice;

  const startRun = (minutes: number) => {
    const start = Date.now();
    setNow(start);
    setRun({ minutes, endAt: start + minutes * MINUTE_MS, pausedMs: 0 });
    onStart(minutes);
    announceSoon(`Timer started, ${durationWords(minutes)}`);
  };

  const start = () => {
    if (chosenMinutes === null) return;
    if (choice === "custom") {
      setLastCustom(chosenMinutes);
      void saveLastCustomTimer(chosenMinutes);
    }
    startRun(chosenMinutes);
  };

  const pause = () => {
    if (!run || run.endAt === null) return;
    const at = Date.now();
    const left = Math.min(durationMs, Math.max(0, run.endAt - at));
    // It ran out between ticks: let it finish rather than pause at 0:00.
    if (left === 0) {
      setNow(at);
      return;
    }
    setRun({ ...run, endAt: null, pausedMs: left });
    announceSoon("Paused");
  };

  const resume = () => {
    if (!run || run.endAt !== null) return;
    const at = Date.now();
    setNow(at);
    setRun({ ...run, endAt: at + run.pausedMs, pausedMs: 0 });
    announceSoon("Resumed");
  };

  // Cancel (and Done with timer) go back to the length picker, nothing picked.
  const reset = () => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
    setRun(null);
    setChoice(null);
  };

  const restart = () => {
    if (run) startRun(run.minutes);
  };

  const pickCustom = (minutes: number) => {
    touchedCustom.current = true;
    const clamped = clampTimerMinutes(minutes);
    if (clamped !== minutes) setWheelKey((key) => key + 1);
    setCustomMinutes(clamped);
  };

  // The last custom length, when it isn't one of the presets already.
  const chips: number[] = [...FOCUS_TIMER_PRESETS];
  if (lastCustom !== null && !chips.includes(lastCustom)) chips.push(lastCustom);

  const minutesLeft = Math.ceil(remainingMs / MINUTE_MS);
  const endsAt = runningEndAt !== null ? formatEndTime(new Date(runningEndAt)) : null;
  // Whole minutes (and a fixed end time), so VoiceOver isn't told every second.
  const ringLabel = !run
    ? ""
    : finished
      ? "Timer finished"
      : paused
        ? `Timer paused, ${durationWords(minutesLeft)} left of ${durationWords(run.minutes)}`
        : `${durationWords(minutesLeft)} left of ${durationWords(run.minutes)}, ends ${endsAt}`;

  const pill = (fill: "primary" | "tint" | "surface") => ({
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 999,
    backgroundColor: fill === "primary" ? colors.primary : fill === "tint" ? `${colors.primary}1F` : colors.surface,
  });

  if (!run) {
    return (
      <View className="gap-3 self-stretch" testID="focus-timer">
        <Text className="text-sm font-semibold" style={{ color: colors.muted }}>
          Timer
        </Text>
        <View className="flex-row flex-wrap gap-2" testID="focus-timer-options">
          {chips.map((minutes) => {
            const selected = choice === minutes;
            return (
              <Chip
                key={minutes}
                label={durationShort(minutes)}
                accessibilityLabel={minutes < 60 ? `${minutes} minute timer` : `${durationWords(minutes)} timer`}
                selected={selected}
                onPress={() => setChoice(minutes)}
                testID={`focus-timer-${minutes}`}
              />
            );
          })}
          <Chip
            label="Custom"
            accessibilityLabel="Custom timer"
            accessibilityHint="Choose your own length"
            selected={choice === "custom"}
            onPress={() => setChoice("custom")}
            testID="focus-timer-custom"
          />
        </View>

        {choice === "custom" ? (
          Platform.OS === "ios" ? (
            <View className="items-center">
              <DateTimePicker
                key={wheelKey}
                value={wheelDate(customMinutes)}
                mode="countdown"
                display="spinner"
                themeVariant={scheme}
                accentColor={colors.primary}
                accessibilityLabel={`Timer length, ${durationWords(customMinutes)}`}
                onChange={(_event, date) => {
                  if (date) pickCustom(date.getHours() * 60 + date.getMinutes());
                }}
                testID="focus-timer-wheel"
              />
            </View>
          ) : (
            <MinutesStepper minutes={customMinutes} onChange={pickCustom} />
          )
        ) : null}

        {chosenMinutes !== null ? (
          <View className="flex-row gap-3">
            <Pressable
              onPress={reset}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              accessibilityHint="Clears the timer length"
              style={pill("surface")}
              testID="focus-timer-cancel"
            >
              <Text className="text-base font-semibold text-foreground">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={start}
              accessibilityRole="button"
              accessibilityLabel="Start"
              accessibilityHint={`Starts a ${durationWords(chosenMinutes)} timer`}
              style={pill("primary")}
              testID="focus-timer-start"
            >
              <Text className="text-base font-bold" style={{ color: colors.onPrimary }}>
                Start
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View className="gap-4 items-center self-stretch" testID="focus-timer">
      <Text className="self-start text-sm font-semibold" style={{ color: colors.muted }}>
        Timer
      </Text>
      <View accessible accessibilityLabel={ringLabel} testID="focus-timer-ring">
        <ProgressRing
          completed={durationMs - remainingMs}
          total={durationMs}
          color={finished ? colors.success : colors.primary}
          size={232}
          strokeWidth={10}
        >
          {finished ? (
            <Ionicons name="checkmark" size={56} color={colors.success} testID="focus-timer-check" />
          ) : (
            <View className="items-center px-6" style={{ maxWidth: 200 }}>
              <Text
                style={{
                  color: paused ? colors.muted : colors.foreground,
                  fontFamily: Fonts.rounded,
                  fontSize: 44,
                  fontWeight: "700",
                  fontVariant: ["tabular-nums"],
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
                testID="focus-timer-remaining"
              >
                {formatRemaining(remainingMs)}
              </Text>
              <View className="flex-row items-center gap-1">
                <Ionicons name={paused ? "pause" : "notifications"} size={14} color={colors.muted} />
                <Text
                  className="text-sm"
                  style={{ color: colors.muted, fontVariant: ["tabular-nums"] }}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  maxFontSizeMultiplier={1.6}
                  testID="focus-timer-ends"
                >
                  {paused ? "Paused" : `Ends ${endsAt}`}
                </Text>
              </View>
            </View>
          )}
        </ProgressRing>
      </View>

      {finished ? (
        <Text className="text-base text-center text-foreground" testID="focus-times-up">
          {timesUpText(run.minutes)}
        </Text>
      ) : null}

      {finished ? (
        <View className="flex-row gap-3 self-stretch">
          <Pressable
            onPress={reset}
            accessibilityRole="button"
            accessibilityLabel="Done with timer"
            accessibilityHint="Goes back to choosing a length"
            style={pill("surface")}
            testID="focus-timer-clear"
          >
            <Text className="text-base font-semibold text-foreground text-center">Done with timer</Text>
          </Pressable>
          <Pressable
            onPress={restart}
            accessibilityRole="button"
            accessibilityLabel="Restart"
            accessibilityHint={`Starts the ${durationWords(run.minutes)} timer again`}
            style={pill("tint")}
            testID="focus-timer-restart"
          >
            <Text className="text-base font-bold" style={{ color: colors.primary }}>
              Restart
            </Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-row gap-3 self-stretch">
          <Pressable
            onPress={reset}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            accessibilityHint="Stops the timer"
            style={pill("surface")}
            testID="focus-timer-cancel"
          >
            <Text className="text-base font-semibold text-foreground">Cancel</Text>
          </Pressable>
          {paused ? (
            <Pressable
              onPress={resume}
              accessibilityRole="button"
              accessibilityLabel="Resume"
              style={pill("primary")}
              testID="focus-timer-resume"
            >
              <Text className="text-base font-bold" style={{ color: colors.onPrimary }}>
                Resume
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={pause}
              accessibilityRole="button"
              accessibilityLabel="Pause"
              style={pill("tint")}
              testID="focus-timer-pause"
            >
              <Text className="text-base font-bold" style={{ color: colors.primary }}>
                Pause
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function Chip({
  label,
  accessibilityLabel,
  accessibilityHint,
  selected,
  onPress,
  testID,
}: {
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected }}
      style={{
        minHeight: 44,
        minWidth: 64,
        paddingHorizontal: 16,
        paddingVertical: 8,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        backgroundColor: selected ? colors.primary : colors.surface,
      }}
      testID={testID}
    >
      <Text className="text-sm font-semibold" style={{ color: selected ? colors.onPrimary : colors.foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Android and the web have no duration wheel: minutes in steps of 5 (1 to 180). */
function MinutesStepper({ minutes, onChange }: { minutes: number; onChange: (minutes: number) => void }) {
  const colors = useColors();
  const down = minutes <= STEPPER_STEP ? FOCUS_TIMER_MIN_MINUTES : Math.ceil(minutes / STEPPER_STEP) * STEPPER_STEP - STEPPER_STEP;
  const up = minutes < STEPPER_STEP ? STEPPER_STEP : Math.floor(minutes / STEPPER_STEP) * STEPPER_STEP + STEPPER_STEP;
  const canDown = minutes > FOCUS_TIMER_MIN_MINUTES;
  const canUp = minutes < FOCUS_TIMER_MAX_MINUTES;
  const button = (icon: "remove" | "add", label: string, enabled: boolean, next: number, testID: string) => (
    <Pressable
      onPress={() => onChange(Math.min(FOCUS_TIMER_MAX_MINUTES, next))}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      style={{
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface,
        opacity: enabled ? 1 : 0.4,
      }}
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={colors.foreground} />
    </Pressable>
  );
  return (
    <View className="flex-row items-center justify-between gap-3" testID="focus-timer-stepper">
      {button("remove", "Shorter timer", canDown, down, "focus-timer-stepper-down")}
      <Text
        className="flex-1 text-center text-lg font-semibold text-foreground"
        accessibilityLabel={`Timer length, ${durationWords(minutes)}`}
        accessibilityLiveRegion="polite"
        testID="focus-timer-stepper-value"
      >
        {durationShort(minutes)}
      </Text>
      {button("add", "Longer timer", canUp, up, "focus-timer-stepper-up")}
    </View>
  );
}
