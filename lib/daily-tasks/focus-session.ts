// The focus session (1.3): one timer at a time, app-wide, on one of today's
// tasks. The store owns it (persisted, mirrored to the App Group for the
// widget and, in PR F, the Live Activity); these are its pure rules. Time is
// always timestamps, never a counter, so it's right after the app was in the
// background or killed.
import { durationWords } from "./focus-timer";

const MINUTE_MS = 60_000;

/** A starter is the 5-minute "just start"; a timer is a length the user chose. */
export type FocusSessionKind = "timer" | "starter";
export type FocusSessionStatus = "running" | "paused" | "ended";

export interface FocusSession {
  id: string;
  taskId: string;
  /** A snapshot of the task's words, for the widget and Live Activity. */
  taskText: string;
  /** A starter on a task's first step (after a break-down): that step's words. */
  stepText: string | null;
  /** yyyy-MM-dd: a session never crosses midnight. */
  date: string;
  kind: FocusSessionKind;
  /** The current length; grows with "5 more minutes". */
  durationMs: number;
  startedAt: number;
  /** When it ends; null while paused. */
  endAt: number | null;
  /** Time left while paused; null otherwise. */
  pausedRemainingMs: number | null;
  status: FocusSessionStatus;
}

export const STARTER_MINUTES = 5;
/** "5 more minutes". */
export const EXTEND_MINUTES = 5;
/** A starter's "Keep going" turns it into a timer this long. */
export const KEEP_GOING_MINUTES = 20;
/** However often it's extended, a session is at most a day long. */
export const MAX_SESSION_MS = 24 * 60 * MINUTE_MS;

/** Where a session was started (analytics). */
export type FocusSessionSource = "row" | "coach" | "widget" | "siri" | "focus";
/** How a session (or one of its countdowns) ended (analytics). */
export type FocusSessionOutcome = "done" | "extended" | "stopped" | "cleared" | "broken_down";

export function startSession(input: {
  id: string;
  taskId: string;
  taskText: string;
  stepText?: string | null;
  date: string;
  kind: FocusSessionKind;
  minutes: number;
  now: number;
}): FocusSession {
  const durationMs = Math.min(MAX_SESSION_MS, Math.max(MINUTE_MS, Math.round(input.minutes) * MINUTE_MS));
  return {
    id: input.id,
    taskId: input.taskId,
    taskText: input.taskText,
    stepText: input.stepText ?? null,
    date: input.date,
    kind: input.kind,
    durationMs,
    startedAt: input.now,
    endAt: input.now + durationMs,
    pausedRemainingMs: null,
    status: "running",
  };
}

/**
 * Time left at `now`: frozen while paused, 0 once ended. Clamped both ways,
 * since the clock can move back as well as forward.
 */
export function remainingMs(session: FocusSession, now: number): number {
  if (session.status === "ended") return 0;
  if (session.status === "paused") return Math.max(0, Math.min(session.durationMs, session.pausedRemainingMs ?? 0));
  return Math.max(0, Math.min(session.durationMs, (session.endAt ?? now) - now));
}

/** The status at `now`: a running session past its end has ended, stored or not. */
export function sessionPhase(session: FocusSession, now: number): FocusSessionStatus {
  if (session.status === "running" && remainingMs(session, now) === 0) return "ended";
  return session.status;
}

/** Marks a running session that has run out as ended (unchanged otherwise). */
export function settle(session: FocusSession, now: number): FocusSession {
  if (sessionPhase(session, now) !== "ended" || session.status === "ended") return session;
  return { ...session, status: "ended", pausedRemainingMs: null };
}

/** Ends it now, whatever is left (the check-in shows). */
export function end(session: FocusSession): FocusSession {
  if (session.status === "ended") return session;
  return { ...session, status: "ended", pausedRemainingMs: null };
}

/** No session: the check-in was answered, or it was stopped. */
export function clear(): null {
  return null;
}

export function pause(session: FocusSession, now: number): FocusSession {
  if (session.status !== "running") return session;
  const left = remainingMs(session, now);
  // It ran out between ticks: it ends rather than pausing at 0:00.
  if (left === 0) return settle(session, now);
  return { ...session, status: "paused", endAt: null, pausedRemainingMs: left };
}

export function resume(session: FocusSession, now: number): FocusSession {
  if (session.status !== "paused") return session;
  return { ...session, status: "running", endAt: now + (session.pausedRemainingMs ?? 0), pausedRemainingMs: null };
}

/**
 * "5 more minutes": adds to the length. A running or paused session keeps its
 * time left plus the extra; an ended one runs again for just the extra.
 */
export function extend(session: FocusSession, now: number, minutes = EXTEND_MINUTES): FocusSession {
  const extra = Math.round(minutes) * MINUTE_MS;
  if (extra <= 0) return session;
  const durationMs = Math.min(MAX_SESSION_MS, session.durationMs + extra);
  const added = durationMs - session.durationMs;
  if (added <= 0) return session;
  if (session.status === "paused") {
    return { ...session, durationMs, pausedRemainingMs: (session.pausedRemainingMs ?? 0) + added };
  }
  const left = remainingMs(session, now);
  return { ...session, durationMs, status: "running", endAt: now + left + added, pausedRemainingMs: null };
}

/** A starter's "Keep going": a fresh timer (20 minutes by default) on the same task. */
export function keepGoing(session: FocusSession, now: number, minutes = KEEP_GOING_MINUTES): FocusSession {
  const durationMs = Math.min(MAX_SESSION_MS, Math.max(MINUTE_MS, Math.round(minutes) * MINUTE_MS));
  return {
    ...session,
    kind: "timer",
    durationMs,
    startedAt: now,
    endAt: now + durationMs,
    pausedRemainingMs: null,
    status: "running",
  };
}

/**
 * The session as it should be for today's list: gone once its task is ticked,
 * removed (deleted, "Not today") or the day has changed; its snapshot kept in
 * step with the task's words (an edit drops the task's steps, so the step too).
 */
export function sessionForState(
  session: FocusSession | null,
  state: {
    tasks: { id: string; text: string; steps?: { text: string }[] }[];
    todayCompletions: string[];
    lastOpenedDate: string;
  },
): FocusSession | null {
  if (!session) return null;
  if (session.date !== state.lastOpenedDate) return null;
  const task = state.tasks.find((item) => item.id === session.taskId);
  if (!task || state.todayCompletions.includes(task.id)) return null;
  const stepGone = session.stepText !== null && !(task.steps ?? []).some((step) => step.text === session.stepText);
  if (task.text === session.taskText && !stepGone) return session;
  return { ...session, taskText: task.text, stepText: stepGone ? null : session.stepText };
}

/** The session's length in whole minutes (analytics, the Done report). */
export function sessionMinutes(session: FocusSession): number {
  return Math.max(1, Math.round(session.durationMs / MINUTE_MS));
}

/** What the session is on: the step for a step starter, else the task. */
export function sessionFocusText(session: FocusSession): string {
  return session.stepText ?? session.taskText;
}

/** The check-in's line once it reaches zero (on screen and in the notification). */
export function checkInTitle(session: FocusSession): string {
  if (session.kind === "starter") return `${capitalize(durationWords(sessionMinutes(session)))} in. Keep going?`;
  return `Time's up on "${sessionFocusText(session)}".`;
}

/** The end notification's body: the check-in, with the task named for a starter too. */
export function notificationBody(session: FocusSession): string {
  if (session.kind === "starter") {
    return `${capitalize(durationWords(sessionMinutes(session)))} in on "${sessionFocusText(session)}". Keep going?`;
  }
  return checkInTitle(session);
}

/** A starter's line while it runs (only for the first 5 minutes' length). */
export function starterLine(session: FocusSession): string | null {
  return session.kind === "starter" && session.durationMs === STARTER_MINUTES * MINUTE_MS
    ? "Just start. You can stop after 5."
    : null;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
