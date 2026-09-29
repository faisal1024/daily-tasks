// The "Now" bar (1.3): under Today's header while a focus session exists.
// The task on one line, the time left and Pause/Resume; "Paused" while
// paused; at zero, the check-in. Tapping it opens the focus screen.
import { useEffect, useRef } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";

import { announcePolitely, FocusCheckIn, type FocusSessionControls } from "@/components/daily-tasks/focus-check-in";
import { ProgressRing } from "@/components/daily-tasks/progress-ring";
import { useColors } from "@/hooks/use-colors";
import { useFocusClock } from "@/hooks/use-focus-clock";
import {
  checkInTitle,
  remainingMs,
  sessionFocusText,
  sessionMinutes,
  sessionPhase,
  starterLine,
  type FocusSession,
} from "@/lib/daily-tasks/focus-session";
import { durationWords, formatRemaining } from "@/lib/daily-tasks/focus-timer";

const MINUTE_MS = 60_000;
const RING = 36;
/** A session this new was just started here (not one restored at launch). */
const JUST_STARTED_MS = 5_000;

/**
 * A session's start and end, said out loud (politely) and, at the end, felt
 * (one success haptic). For Today, which is always mounted: once per new
 * session, and once per countdown that ends while the app is open (again
 * after "5 more minutes"); never for one restored at launch. The end is the
 * store's (it marks the session ended right on time).
 */
export function useFocusSessionCues(session: FocusSession | null): void {
  const lastId = useRef(session?.id ?? null);
  useEffect(() => {
    const id = session?.id ?? null;
    if (id === lastId.current) return;
    lastId.current = id;
    if (!session || session.status !== "running" || Date.now() - session.startedAt > JUST_STARTED_MS) return;
    announcePolitely(
      session.kind === "starter" ? "5-minute starter started" : `Timer started, ${durationWords(sessionMinutes(session))}`,
    );
    // Only for a new session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  const status = session?.status ?? null;
  const countdown = session ? `${session.id}|${session.durationMs}` : null;
  const seen = useRef<{ countdown: string | null; status: string | null }>({ countdown, status });
  useEffect(() => {
    const before = seen.current;
    seen.current = { countdown, status };
    if (!session || status !== "ended" || before.status === "ended") return;
    // Only a countdown seen running (or paused) while the app was open.
    if (before.countdown !== countdown) return;
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
    announcePolitely(checkInTitle(session));
    // Only when it ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, countdown]);
}

export function NowBar({
  session,
  controls,
  onOpen,
}: {
  session: FocusSession;
  controls: FocusSessionControls;
  /** Opens the focus screen on the session's task. */
  onOpen: () => void;
}) {
  const colors = useColors();
  const now = useFocusClock(session);
  const phase = sessionPhase(session, now);
  const left = remainingMs(session, now);
  const text = sessionFocusText(session);

  const container = {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
  };

  if (phase === "ended") {
    return (
      <View style={container} className="gap-1" testID="now-bar">
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${checkInTitle(session)} Opens focus`}
          style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44 }}
          testID="now-bar-open"
        >
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <Text className="flex-1 text-base font-semibold text-foreground" numberOfLines={2} testID="now-bar-title">
            {checkInTitle(session)}
          </Text>
        </Pressable>
        <FocusCheckIn session={session} controls={controls} showTitle={false} />
      </View>
    );
  }

  const paused = phase === "paused";
  const minutesLeft = Math.ceil(left / MINUTE_MS);
  // Whole minutes, so VoiceOver isn't told every second.
  const label = paused
    ? `Focus timer paused: ${text}. ${durationWords(minutesLeft)} left`
    : `Focus timer: ${text}. ${durationWords(minutesLeft)} left`;
  const line = starterLine(session);

  return (
    <View style={[container, { flexDirection: "row", alignItems: "center", gap: 8 }]} testID="now-bar">
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint="Opens focus"
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44 }}
        testID="now-bar-open"
      >
        <ProgressRing
          completed={session.durationMs - left}
          total={session.durationMs}
          color={paused ? colors.muted : colors.primary}
          size={RING}
          strokeWidth={4}
        >
          <Ionicons name={paused ? "pause" : "play"} size={13} color={paused ? colors.muted : colors.primary} />
        </ProgressRing>
        <View className="flex-1">
          <Text className="text-base font-semibold text-foreground" numberOfLines={1} testID="now-bar-task">
            {text}
          </Text>
          <Text
            className="text-sm"
            style={{ color: colors.muted, fontVariant: ["tabular-nums"] }}
            numberOfLines={1}
            testID="now-bar-time"
          >
            {paused ? `Paused · ${formatRemaining(left)} left` : `${formatRemaining(left)} left`}
          </Text>
          {line ? (
            <Text className="text-xs" style={{ color: colors.muted }} numberOfLines={2} testID="now-bar-starter">
              {line}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        onPress={() => {
          if (paused) {
            controls.resume();
            announcePolitely("Resumed");
          } else {
            controls.pause();
            announcePolitely("Paused");
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={paused ? "Resume timer" : "Pause timer"}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: `${colors.primary}1F`,
        }}
        testID={paused ? "now-bar-resume" : "now-bar-pause"}
      >
        <Ionicons name={paused ? "play" : "pause"} size={20} color={colors.primary} />
      </Pressable>
    </View>
  );
}
