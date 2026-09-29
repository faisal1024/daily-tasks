// Focus mode's timer (1.2), modelled on Apple's Clock timer. A length chip
// (5 / 10 / 20 min, or the last custom one) starts it at once, like Apple's
// Recents; Custom opens a duration wheel with Cancel and Start. While it
// runs: Pause / Resume and Cancel. Optional: nothing runs until one is chosen.
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { MinutesStepper } from "@/components/daily-tasks/minutes-stepper";
import { ProgressRing } from "@/components/daily-tasks/progress-ring";
import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useColors } from "@/hooks/use-colors";
import {
  FOCUS_TIMER_DEFAULT_CUSTOM_MINUTES,
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
  getNotificationPermissionStatus,
  scheduleFocusTimerNotification,
} from "@/lib/daily-tasks/notifications";

const MINUTE_MS = 60_000;
/** Lets the tapped button's own label read out before the announcement. */
const ANNOUNCE_DELAY_MS = 300;
const MAX_RING = 232;

/**
 * A run. `endAt` while it's running (or finished), `pausedMs` (time left)
 * while it's paused: one or the other.
 */
interface Run {
  minutes: number;
  endAt: number | null;
  pausedMs: number;
}

interface FocusTimerPanelProps {
  /** A timer started (a chip, Start or Restart), with its length in minutes. */
  onStart: (minutes: number) => void;
  /** Cancel or Clear: the timer is gone. */
  onCancel?: () => void;
  /** Whether a timer is running or paused (not idle or finished). */
  onActiveChange?: (active: boolean) => void;
  /** Custom opened or a run started: bring the panel into view. */
  onReveal?: () => void;
}

/**
 * Timestamp based, so it's right after the app comes back from the
 * background; it ticks each second only while running. The end notification
 * is scheduled only while it runs: cancelled on Pause, Cancel, finishing
 * in-app and unmount (focus mode closing), and scheduled again on Resume.
 */
export function FocusTimerPanel({ onStart, onCancel, onActiveChange, onReveal }: FocusTimerPanelProps) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const [customOpen, setCustomOpen] = useState(false);
  const [customMinutes, setCustomMinutes] = useState(FOCUS_TIMER_DEFAULT_CUSTOM_MINUTES);
  const [lastCustom, setLastCustom] = useState<number | null>(null);
  const [canNotify, setCanNotify] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [revealCount, setRevealCount] = useState(0);

  // The last custom length, offered as a chip. Best-effort.
  const touchedCustom = useRef(false);
  useEffect(() => {
    let live = true;
    void loadLastCustomTimer().then((minutes) => {
      if (!live || minutes === null) return;
      setLastCustom(minutes);
      if (!touchedCustom.current) setCustomMinutes(minutes);
    });
    // The bell by the end time only when the end notification can go out.
    Promise.resolve(getNotificationPermissionStatus())
      .then((status) => {
        if (live) setCanNotify(status === "granted");
      })
      .catch(() => {});
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
  const active = running || paused;

  useEffect(() => {
    onActiveChange?.(active);
    // Only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (revealCount > 0) onReveal?.();
    // Only on a new reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealCount]);

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

  // Once per run: one success haptic and the line read out. Never closes.
  useEffect(() => {
    if (!finished || !run) return;
    if (announceTimer.current) clearTimeout(announceTimer.current);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    AccessibilityInfo.announceForAccessibility(timesUpText(run.minutes));
    // Only when it finishes; the length can't change without a new run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const startRun = (minutes: number) => {
    const start = Date.now();
    setNow(start);
    setRun({ minutes, endAt: start + minutes * MINUTE_MS, pausedMs: 0 });
    setCustomOpen(false);
    setRevealCount((count) => count + 1);
    onStart(minutes);
    announceSoon(`Timer started, ${durationWords(minutes)}`);
  };

  const openCustom = () => {
    setCustomOpen(true);
    setRevealCount((count) => count + 1);
  };

  const startCustom = () => {
    setLastCustom(customMinutes);
    void saveLastCustomTimer(customMinutes);
    startRun(customMinutes);
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

  // Cancel (and Clear) go back to the length chips.
  const reset = () => {
    if (announceTimer.current) clearTimeout(announceTimer.current);
    const hadRun = run !== null;
    setRun(null);
    setCustomOpen(false);
    if (hadRun) onCancel?.();
  };

  const restart = () => {
    if (run) startRun(run.minutes);
  };

  const pickCustom = (minutes: number) => {
    touchedCustom.current = true;
    setCustomMinutes(clampTimerMinutes(minutes));
  };

  // The last custom length joins the presets (in order) when it isn't one.
  const chips: number[] = [...FOCUS_TIMER_PRESETS];
  if (lastCustom !== null && !chips.includes(lastCustom)) chips.push(lastCustom);
  chips.sort((a, b) => a - b);

  const ringSize = Math.max(120, Math.min(MAX_RING, width - 48, Math.round(height * 0.3)));
  const clockFontSize = Math.round(ringSize * 0.19);
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

  // Solid primary stays for the footer's Done: the timer's actions are tinted.
  const pill = (fill: "tint" | "surface") => ({
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderRadius: 999,
    ...(fill === "tint"
      ? { backgroundColor: `${colors.primary}1F` }
      : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }),
  });

  const header = (
    <Text className="self-start text-sm font-semibold" style={{ color: colors.muted }} accessibilityRole="header">
      Timer
    </Text>
  );

  if (!run) {
    return (
      <View className="gap-3 self-stretch" testID="focus-timer">
        {header}
        <View className="flex-row flex-wrap gap-2" testID="focus-timer-options">
          {chips.map((minutes) => (
            <Chip
              key={minutes}
              label={durationShort(minutes)}
              accessibilityLabel={minutes < 60 ? `${minutes} minute timer` : `${durationWords(minutes)} timer`}
              accessibilityHint={`Starts a timer for ${durationWords(minutes)}`}
              selected={false}
              onPress={() => startRun(minutes)}
              testID={`focus-timer-${minutes}`}
            />
          ))}
          <Chip
            label="Custom"
            accessibilityLabel="Custom timer"
            accessibilityHint="Choose your own length"
            selected={customOpen}
            onPress={openCustom}
            testID="focus-timer-custom"
          />
        </View>

        {customOpen ? (
          <>
            {Platform.OS === "ios" ? (
              <CountdownWheel
                minutes={customMinutes}
                onChange={pickCustom}
                scheme={scheme}
                accentColor={colors.primary}
              />
            ) : (
              <MinutesStepper minutes={customMinutes} onChange={pickCustom} />
            )}
            <Text className="text-sm text-center" style={{ color: colors.muted }} testID="focus-timer-limit">
              Up to 3 hours
            </Text>
            <View className="flex-row gap-3">
              <Pressable
                onPress={reset}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                accessibilityHint="Closes the custom length"
                style={pill("surface")}
                testID="focus-timer-cancel"
              >
                <Text className="text-base font-semibold text-foreground">Cancel</Text>
              </Pressable>
              <Pressable
                onPress={startCustom}
                accessibilityRole="button"
                accessibilityLabel="Start"
                accessibilityHint={`Starts a timer for ${durationWords(customMinutes)}`}
                style={pill("tint")}
                testID="focus-timer-start"
              >
                <Text className="text-base font-bold" style={{ color: colors.primary }}>
                  Start
                </Text>
              </Pressable>
            </View>
          </>
        ) : null}
      </View>
    );
  }

  return (
    <View className="gap-4 items-center self-stretch" testID="focus-timer">
      {header}
      <View accessible accessibilityRole="timer" accessibilityLabel={ringLabel} testID="focus-timer-ring">
        <ProgressRing
          completed={durationMs - remainingMs}
          total={durationMs}
          color={finished ? colors.success : colors.primary}
          size={ringSize}
          strokeWidth={10}
        >
          {finished ? (
            <Ionicons
              name="checkmark"
              size={Math.round(ringSize * 0.24)}
              color={colors.success}
              testID="focus-timer-check"
            />
          ) : (
            <View className="items-center px-6" style={{ maxWidth: ringSize - 32 }}>
              <Text
                style={{
                  color: paused ? colors.muted : colors.foreground,
                  fontFamily: Fonts.rounded,
                  fontSize: clockFontSize,
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
                <Ionicons
                  name={paused ? "pause" : canNotify ? "notifications" : "time-outline"}
                  size={14}
                  color={colors.muted}
                  testID={paused ? "focus-timer-icon-paused" : canNotify ? "focus-timer-icon-bell" : "focus-timer-icon-clock"}
                />
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
            accessibilityLabel="Clear timer"
            accessibilityHint="Goes back to choosing a length"
            style={pill("surface")}
            testID="focus-timer-clear"
          >
            <Text className="text-base font-semibold text-foreground">Clear</Text>
          </Pressable>
          <Pressable
            onPress={restart}
            accessibilityRole="button"
            accessibilityLabel="Restart"
            accessibilityHint={`Starts the timer for ${durationWords(run.minutes)} again`}
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
              accessibilityHint="Continues the timer"
              style={pill("tint")}
              testID="focus-timer-resume"
            >
              <Text className="text-base font-bold" style={{ color: colors.primary }}>
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

/**
 * A fixed day (not today), so a daylight-saving change can't shift the h:mm
 * the countdown wheel shows. `second` is the nudge below; the wheel ignores it.
 */
function wheelDate(minutes: number, second = 0): Date {
  return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60, second);
}

/**
 * The iOS countdown wheel (hours + minutes).
 *
 * UIKit quirk: in countdown mode UIDatePicker doesn't report the first spin
 * (no valueChanged) unless its date is set again once it's on screen, and
 * datetimepicker 8.4.4 (Fabric) has no workaround. So one frame after it
 * mounts, and whenever a length had to be clamped, the value is nudged by a
 * second and back: two prop changes, so native setDate runs with the picker
 * on screen (and writes a clamped length back to the wheel). No remounting.
 */
function CountdownWheel({
  minutes,
  onChange,
  scheme,
  accentColor,
}: {
  minutes: number;
  onChange: (minutes: number) => void;
  scheme: "light" | "dark";
  accentColor: string;
}) {
  const [nudge, setNudge] = useState(0);
  const [nudges, setNudges] = useState(0);
  useEffect(() => {
    let second: number | null = null;
    const first = requestAnimationFrame(() => {
      setNudge(1);
      second = requestAnimationFrame(() => setNudge(0));
    });
    return () => {
      cancelAnimationFrame(first);
      if (second !== null) cancelAnimationFrame(second);
    };
  }, [nudges]);

  return (
    <View className="items-center">
      <DateTimePicker
        value={wheelDate(minutes, nudge)}
        mode="countdown"
        display="spinner"
        themeVariant={scheme}
        accentColor={accentColor}
        accessibilityLabel={`Timer length, ${durationWords(minutes)}`}
        onChange={(_event, date) => {
          if (!date) return;
          const raw = date.getHours() * 60 + date.getMinutes();
          if (clampTimerMinutes(raw) !== raw) setNudges((count) => count + 1);
          onChange(raw);
        }}
        testID="focus-timer-wheel"
      />
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
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
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
