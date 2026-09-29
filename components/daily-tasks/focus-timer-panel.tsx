// The focus screen's timer (1.2, on the session since 1.3), modelled on
// Apple's Clock timer. With no session on this task: a length chip (5 / 10 /
// 20 min, or the last custom one) starts one at once, like Apple's Recents;
// Custom opens a duration wheel with Cancel and Start. With one: its ring,
// Pause / Resume and Stop timer; at zero, the check-in. The timer itself is
// the store's session (see focus-session.ts), so it keeps going when the
// screen closes.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import { announcePolitely, type FocusSessionControls } from "@/components/daily-tasks/focus-check-in";
import { MinutesStepper } from "@/components/daily-tasks/minutes-stepper";
import { ProgressRing } from "@/components/daily-tasks/progress-ring";
import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useColors } from "@/hooks/use-colors";
import { useFocusClock } from "@/hooks/use-focus-clock";
import {
  remainingMs,
  sessionMinutes,
  sessionPhase,
  starterLine,
  type FocusSession,
} from "@/lib/daily-tasks/focus-session";
import {
  FOCUS_TIMER_DEFAULT_CUSTOM_MINUTES,
  FOCUS_TIMER_PRESETS,
  clampTimerMinutes,
  durationShort,
  durationWords,
  formatEndTime,
  formatRemaining,
} from "@/lib/daily-tasks/focus-timer";
import { loadLastCustomTimer, saveLastCustomTimer } from "@/lib/daily-tasks/focus-timer-storage";
import { getNotificationPermissionStatus } from "@/lib/daily-tasks/notifications";

const MINUTE_MS = 60_000;
const MAX_RING = 232;

interface FocusTimerPanelProps {
  /** The session, when it's on this task; null offers the lengths. */
  session: FocusSession | null;
  /** A length was chosen (a chip or Custom's Start), in minutes. */
  onStart: (minutes: number) => void;
  controls: FocusSessionControls;
  /** The check-in, shown once the session reaches zero. */
  checkIn: ReactNode;
  /** Opens with the custom wheel showing (Custom… from a task's timer menu). */
  initialCustom?: boolean;
  /** Custom opened or a run started: bring the panel into view. */
  onReveal?: () => void;
}

export function FocusTimerPanel({ session, onStart, controls, checkIn, initialCustom = false, onReveal }: FocusTimerPanelProps) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const [customOpen, setCustomOpen] = useState(initialCustom);
  const [customMinutes, setCustomMinutes] = useState(FOCUS_TIMER_DEFAULT_CUSTOM_MINUTES);
  const [lastCustom, setLastCustom] = useState<number | null>(null);
  const [canNotify, setCanNotify] = useState(false);
  const now = useFocusClock(session);

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

  // Custom opening (including on open) or a session starting brings it into view.
  const sessionId = session?.id ?? null;
  useEffect(() => {
    if (customOpen || sessionId !== null) onReveal?.();
    // Only when either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customOpen, sessionId]);

  const start = (minutes: number) => {
    setCustomOpen(false);
    onStart(minutes);
  };

  const startCustom = () => {
    setLastCustom(customMinutes);
    void saveLastCustomTimer(customMinutes);
    start(customMinutes);
  };

  const pickCustom = (minutes: number) => {
    touchedCustom.current = true;
    setCustomMinutes(clampTimerMinutes(minutes));
  };

  // The last custom length joins the presets (in order) when it isn't one.
  const chips: number[] = [...FOCUS_TIMER_PRESETS];
  if (lastCustom !== null && !chips.includes(lastCustom)) chips.push(lastCustom);
  chips.sort((a, b) => a - b);

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

  if (!session) {
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
              onPress={() => start(minutes)}
              testID={`focus-timer-${minutes}`}
            />
          ))}
          <Chip
            label="Custom"
            accessibilityLabel="Custom timer"
            accessibilityHint="Choose your own length"
            selected={customOpen}
            onPress={() => setCustomOpen(true)}
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
                onPress={() => setCustomOpen(false)}
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

  const phase = sessionPhase(session, now);
  const left = remainingMs(session, now);
  const paused = phase === "paused";
  const finished = phase === "ended";
  const minutes = sessionMinutes(session);
  const ringSize = Math.max(120, Math.min(MAX_RING, width - 48, Math.round(height * 0.3)));
  const clockFontSize = Math.round(ringSize * 0.19);
  const minutesLeft = Math.ceil(left / MINUTE_MS);
  const endsAt = phase === "running" && session.endAt !== null ? formatEndTime(new Date(session.endAt)) : null;
  const line = starterLine(session);
  // Whole minutes (and a fixed end time), so VoiceOver isn't told every second.
  const ringLabel = finished
    ? "Timer finished"
    : paused
      ? `Timer paused, ${durationWords(minutesLeft)} left of ${durationWords(minutes)}`
      : `${durationWords(minutesLeft)} left of ${durationWords(minutes)}, ends ${endsAt}`;

  return (
    <View className="gap-4 items-center self-stretch" testID="focus-timer">
      {header}
      <View accessible accessibilityRole="timer" accessibilityLabel={ringLabel} testID="focus-timer-ring">
        <ProgressRing
          completed={session.durationMs - left}
          total={session.durationMs}
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
                {formatRemaining(left)}
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

      {line && !finished ? (
        <Text className="text-base text-center" style={{ color: colors.muted }} testID="focus-starter-line">
          {line}
        </Text>
      ) : null}

      {finished ? (
        checkIn
      ) : (
        <View className="flex-row gap-3 self-stretch">
          <Pressable
            onPress={controls.stop}
            accessibilityRole="button"
            accessibilityLabel="Stop timer"
            accessibilityHint="Clears the timer"
            style={pill("surface")}
            testID="focus-timer-stop"
          >
            <Text className="text-base font-semibold text-foreground">Stop timer</Text>
          </Pressable>
          {paused ? (
            <Pressable
              onPress={() => {
                controls.resume();
                announcePolitely("Resumed");
              }}
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
              onPress={() => {
                controls.pause();
                announcePolitely("Paused");
              }}
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
