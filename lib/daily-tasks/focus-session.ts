// The focus session (1.3): one timer at a time, app-wide, on one of today's
// tasks. The store owns it (persisted, mirrored to the App Group for the
// widget and, in PR F, the Live Activity); these are its pure rules. Time is
// always timestamps, never a counter, so it's right after the app was in the
// background or killed.
import { durationWords } from "./focus-timer";

export const MINUTE_MS = 60_000;

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

/** Where a session was started (analytics). "check_in": the starter offered after "Stuck?". */
export type FocusSessionSource = "row" | "coach" | "widget" | "siri" | "focus" | "check_in";
/** How a session (or one of its countdowns) ended (analytics). */
/** "break": Take a break at time's up (the session ends, the task stays open). */
export type FocusSessionOutcome = "done" | "extended" | "stopped" | "break" | "cleared" | "broken_down";

/** A new session's length in whole minutes: at least 1, at most a day. */
export function clampSessionMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 1;
  return Math.min(MAX_SESSION_MS / MINUTE_MS, Math.max(1, Math.round(minutes)));
}

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
  const durationMs = clampSessionMinutes(input.minutes) * MINUTE_MS;
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
  const durationMs = clampSessionMinutes(minutes) * MINUTE_MS;
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
 * A saved session as the app finds it at launch: an end further off than its
 * length (the clock moved back while it was closed) is pulled in, and one that
 * ran out while the app was closed is already ended, so nothing is scheduled
 * for the past and nothing is announced as if it just happened.
 */
export function restoreSession(session: FocusSession, now: number): FocusSession {
  const clamped =
    session.status === "running" && session.endAt !== null && session.endAt > now + session.durationMs
      ? { ...session, endAt: now + session.durationMs }
      : session;
  return settle(clamped, now);
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

/** The check-in's line once it reaches zero (on screen, and said by VoiceOver). */
export function checkInTitle(session: FocusSession): string {
  if (session.kind === "starter") return `${capitalize(durationWords(sessionMinutes(session)))} in. Keep going?`;
  return `Time's up on “${sessionFocusText(session)}”.`;
}

/**
 * The line under the focus screen's ring at time's up. The ring already says
 * "Time's up", so this doesn't: "20 minutes on “Walk”. How did it go?". A
 * starter keeps its own line ("5 minutes in. Keep going?").
 */
export function checkInLine(session: FocusSession): string {
  if (session.kind === "starter") return checkInTitle(session);
  return `${capitalize(durationWords(sessionMinutes(session)))} on “${sessionFocusText(session)}”. How did it go?`;
}

/**
 * The check-in's quiet way out (time's up): "Take a break" on a timer, "Stop
 * for now" on a starter. Either ends the session; the task stays open.
 */
export function checkInBreakLabel(session: FocusSession): string {
  return session.kind === "starter" ? "Stop for now" : "Take a break";
}

/**
 * What VoiceOver says at time's up: the check-in's line and its two choices,
 * e.g. "Time's up on “Walk”. 5 more minutes, or take a break." A starter:
 * "5 minutes in. Keep going, or stop for now."
 */
export function checkInAnnouncement(session: FocusSession): string {
  if (session.kind === "starter") {
    return `${capitalize(durationWords(sessionMinutes(session)))} in. Keep going, or stop for now.`;
  }
  return `${checkInTitle(session)} 5 more minutes, or take a break.`;
}

/**
 * Said after the session is ended by hand (Take a break, Stop timer): the
 * task wasn't ticked. "Timer ended. Walk is still open."
 */
export function sessionEndedAnnouncement(stopped: "break" | "stopped", taskText: string): string {
  return `${stopped === "break" ? "Timer ended" : "Timer stopped"}. ${taskText} is still open.`;
}

/** The end notification's title: the task's words, cut to about 60 characters. */
export const NOTIFICATION_TITLE_MAX = 60;
export function notificationTitle(session: FocusSession): string {
  // By code points, so an emoji (a surrogate pair) is never split.
  const chars = Array.from(session.taskText.trim());
  if (chars.length <= NOTIFICATION_TITLE_MAX) return chars.join("");
  return `${chars.slice(0, NOTIFICATION_TITLE_MAX - 1).join("").trimEnd()}…`;
}

/**
 * The end notification's body (the title names the task): a timer asks
 * "5 more minutes, or mark it done?", a starter "5 minutes in. Keep going?"
 * (its buttons: 5 more minutes / Mark done, or Keep going / Mark done).
 */
export function notificationBody(session: FocusSession): string {
  if (session.kind === "starter") return checkInTitle(session);
  return "Time's up. 5 more minutes, or mark it done?";
}

/** A starter's line while it runs (only for the first 5 minutes' length). */
export function starterLine(session: FocusSession): string | null {
  return session.kind === "starter" && session.durationMs === STARTER_MINUTES * MINUTE_MS
    ? "Just start. You can stop after 5 minutes."
    : null;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
