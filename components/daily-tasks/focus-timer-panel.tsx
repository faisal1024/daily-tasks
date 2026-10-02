// The focus screen's timer (1.2, on the session since 1.3), modelled on
// Apple's Clock timer. With no session on this task: a length chip (5 / 10 /
// 20 min, or the last custom one) starts one at once, like Apple's Recents;
// Custom opens a duration wheel with Cancel and Start. With one: its ring,
// Pause / Resume and Stop timer; at zero, the check-in. The timer itself is
// the store's session (see focus-session.ts), so it keeps going when the
// screen closes.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

import { focusPillStyle, type FocusSessionControls } from "@/components/daily-tasks/focus-check-in";
import { MinutesStepper } from "@/components/daily-tasks/minutes-stepper";
import { ProgressRing } from "@/components/daily-tasks/progress-ring";
import { Fonts } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useColors } from "@/hooks/use-colors";
import { useFocusClock } from "@/hooks/use-focus-clock";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import {
  MINUTE_MS,
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

const MAX_RING = 232;

/**
 * The timer's pill labels: one line that grows to 1.4× and then shrinks to
 * fit (as the check-in's buttons), so two pills side by side never wrap or
 * clip at the accessibility text sizes.
 */
const PILL_TEXT = { numberOfLines: 1, adjustsFontSizeToFit: true, maxFontSizeMultiplier: 1.4 } as const;

interface FocusTimerPanelProps {
  /** The session, when it's on this task; null offers the lengths. */
  session: FocusSession | null;
  /** A length was chosen (a chip or Custom's Start), in minutes. */
  onStart: (minutes: number) => void;
  controls: FocusSessionControls;
  /** The check-in, shown once the session reaches zero. */
  checkIn: ReactNode;
  /**
   * Shows the custom wheel (Custom… from a task's timer menu). Set once the
   * screen is on screen: the wheel's first-spin fix needs it mounted there.
   */
  openCustom?: boolean;
  /** Another task's timer, which a start here would stop. */
  otherTimerText?: string | null;
  /** Custom opened or a run started: bring the panel into view. */
  onReveal?: () => void;
  /**
   * The custom wheel opened or closed: while it's open its Start is the
   * screen's one solid button (the footer's Back to Today goes tinted).
   */
  onCustomOpenChange?: (open: boolean) => void;
}

export function FocusTimerPanel({
  session,
  onStart,
  controls,
  checkIn,
  openCustom = false,
  otherTimerText = null,
  onReveal,
  onCustomOpenChange,
}: FocusTimerPanelProps) {
  const colors = useColors();
  const { width, height } = useWindowDimensions();
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const [customOpen, setCustomOpen] = useState(false);
  useEffect(() => {
    if (openCustom) setCustomOpen(true);
  }, [openCustom]);
  const [customMinutes, setCustomMinutes] = useState(FOCUS_TIMER_DEFAULT_CUSTOM_MINUTES);
  const [lastCustom, setLastCustom] = useState<number | null>(null);
  // The wheel waits for the stored last length, so it mounts with the value
  // Start will use (never the default, changed under it a moment later).
  const [customLoaded, setCustomLoaded] = useState(false);
  const [canNotify, setCanNotify] = useState(false);
  const now = useFocusClock(session);

  // The last custom length, offered as a chip. Best-effort.
  const touchedCustom = useRef(false);
  useEffect(() => {
    let live = true;
    void loadLastCustomTimer()
      .then((minutes) => {
        if (!live || minutes === null) return;
        setLastCustom(minutes);
        if (!touchedCustom.current) setCustomMinutes(minutes);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setCustomLoaded(true);
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

  // The wheel is showing only with no session (a start closes it).
  const wheelShowing = customOpen && !session;
  useEffect(() => {
    onCustomOpenChange?.(wheelShowing);
    // Only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wheelShowing]);

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

  // Solid primary stays for the footer's Back to Today: the timer's actions are tinted
  // (primaryInk text). With the custom wheel open, its Start is the solid one.
  const pill = (fill: "primary" | "tint" | "surface") => ({
    ...focusPillStyle(colors, fill, 48),
    paddingHorizontal: 16,
    paddingVertical: 10,
  });

  // Only while choosing a length: with a session the ring says what it is.
  const header = (
    <Text className="self-start text-sm font-semibold" style={{ color: colors.muted }} accessibilityRole="header">
      Timer
    </Text>
  );

  if (!session) {
    return (
      <View className="gap-3 self-stretch" testID="focus-timer">
        {header}
        {otherTimerText ? (
          <Text className="text-sm" style={{ color: colors.muted }} testID="focus-timer-replaces">
            {`This stops the timer on “${otherTimerText}”.`}
          </Text>
        ) : null}
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
              customLoaded ? (
                <CountdownWheel
                  minutes={customMinutes}
                  onChange={pickCustom}
                  scheme={scheme}
                  accentColor={colors.primary}
                />
              ) : (
                // Holds the wheel's place for the moment the stored length loads.
                <View style={{ height: 216 }} testID="focus-timer-wheel-loading" />
              )
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
                <Text className="text-base font-semibold text-foreground" {...PILL_TEXT}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={startCustom}
                accessibilityRole="button"
                accessibilityLabel="Start"
                accessibilityHint={`Starts a timer for ${durationWords(customMinutes)}`}
                style={pill("primary")}
                testID="focus-timer-start"
              >
                <Text className="text-base font-bold" style={{ color: colors.onPrimary }} {...PILL_TEXT}>
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
  // The starter's line only while it runs: paused, the ring says Paused.
  const line = phase === "running" ? starterLine(session) : null;
  // Whole minutes (and a fixed end time), so VoiceOver isn't told every second.
  const ringLabel = finished
    ? "Time's up"
    : paused
      ? `Timer paused, ${durationWords(minutesLeft)} left of ${durationWords(minutes)}`
      : `${durationWords(minutesLeft)} left of ${durationWords(minutes)}, ends ${endsAt}`;

  return (
    <View className="gap-4 items-center self-stretch" testID="focus-timer">
      <View accessible accessibilityRole="timer" accessibilityLabel={ringLabel} testID="focus-timer-ring">
        {/* It drains (what's left), like Clock and the Live Activity. */}
        <ProgressRing
          completed={finished ? session.durationMs : left}
          total={session.durationMs}
          // Paused, it goes quiet (as the row's pill does).
          color={paused ? colors.muted : colors.primary}
          size={ringSize}
          strokeWidth={10}
        >
          {finished ? (
            // Time's up, not done: a full ring and words, never a green tick.
            // Bounded by the ring, so a large text size shrinks it to fit.
            <View className="items-center px-6" style={{ maxWidth: ringSize - 32 }}>
              <Text
                style={{ color: colors.muted, fontFamily: Fonts.rounded, fontSize: Math.round(clockFontSize * 0.7), fontWeight: "700" }}
                numberOfLines={1}
                adjustsFontSizeToFit
                testID="focus-timer-times-up"
              >
                Time&apos;s up
              </Text>
            </View>
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
                  // flexShrink: next to the icon it shrinks to fit the ring, not past it.
                  style={{ color: colors.muted, fontVariant: ["tabular-nums"], flexShrink: 1 }}
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
            <Text className="text-base font-semibold text-foreground" {...PILL_TEXT}>
              Stop timer
            </Text>
          </Pressable>
          {paused ? (
            <Pressable
              onPress={() => {
                controls.resume();
                announcePolitely("Resumed");
              }}
              accessibilityRole="button"
              accessibilityLabel="Resume"
              accessibilityHint="Resumes the timer"
              style={pill("tint")}
              testID="focus-timer-resume"
            >
              <Text className="text-base font-bold" style={{ color: colors.primaryInk }} {...PILL_TEXT}>
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
              accessibilityHint="Pauses the timer"
              style={pill("tint")}
              testID="focus-timer-pause"
            >
              <Text className="text-base font-bold" style={{ color: colors.primaryInk }} {...PILL_TEXT}>
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

/** A second nudge, for a Release build whose first frame beats the native mount. */
const WHEEL_SETTLE_MS = 250;

/**
 * The iOS countdown wheel (hours + minutes).
 *
 * UIKit quirk: in countdown mode UIDatePicker shows 0 h 1 min (and doesn't
 * report the first spin) unless its date is set again once it's on screen;
 * datetimepicker 8.4.4 (Fabric) sets the date before the mode on mount. So
 * the value is nudged by a second one frame after mounting, again a moment
 * later, and whenever a length had to be clamped: native setDate then runs
 * with the picker on screen, showing the length Start will use. No remounting.
 *
 * Each nudge moves the seconds on and leaves them (never "a second and
 * back"): in a Release build Fabric can mount only the latest of two quick
 * revisions, and a there-and-back pair cancels out to no setDate at all.
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
  const bump = useCallback(() => setNudge((count) => (count + 1) % 60), []);
  useEffect(() => {
    const frame = requestAnimationFrame(bump);
    const settle = setTimeout(bump, WHEEL_SETTLE_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [bump]);

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
          // Clamped: set the wheel back to the length Start will use.
          if (clampTimerMinutes(raw) !== raw) bump();
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
        // Selected (Custom, while its wheel shows): tinted, so the wheel's
        // Start stays the one solid button.
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? `${colors.primary}1F` : colors.surface,
      }}
      testID={testID}
    >
      <Text className="text-sm font-semibold" style={{ color: selected ? colors.primaryInk : colors.foreground }}>
        {label}
      </Text>
    </Pressable>
  );
}
