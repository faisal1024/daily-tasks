// Pause/Resume, 5 more minutes and Take a break from the Live Activity (1.3, PR F). Its buttons run without the
// app: they update the activity and the App Group mirror, and queue a command
// in `focus.commands` (FocusActivityShared.swift). The app applies the queue
// before anything else looks at the session (at launch, and whenever it becomes
// active), so a pause on the lock screen is never overtaken by "time's up".
// Pure; the bridge is widget-bridge.ts.
import { extend, keepGoing, pause, resume, sessionPhase, type FocusSession } from "./focus-session";

/**
 * "extend" is the time's-up button: 5 more minutes on a timer, "Keep going"
 * (a 20-minute timer) on a starter, as the app's check-in offers. "break" is
 * the check-in's Take a break (Stop for now on a starter): it ends the
 * session and the task stays open. Both only act at time's up.
 */
export type FocusCommandAction = "pause" | "resume" | "extend" | "break";
const ACTIONS: readonly FocusCommandAction[] = ["pause", "resume", "extend", "break"];

/** One queued tap. `at` is when it was made (epoch ms). */
export interface FocusCommand {
  seq: number;
  sessionId: string;
  action: FocusCommandAction;
  at: number;
}

/**
 * Parse the queue (a JSON string) and keep only commands newer than
 * `processedSeq`, in order. Anything malformed is ignored.
 */
export function parseFocusCommands(raw: string | null, processedSeq: number): FocusCommand[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item): item is FocusCommand => {
      if (!item || typeof item !== "object") return false;
      const command = item as Partial<FocusCommand>;
      return (
        Number.isInteger(command.seq) &&
        typeof command.sessionId === "string" &&
        ACTIONS.includes(command.action as FocusCommandAction) &&
        typeof command.at === "number" &&
        Number.isFinite(command.at)
      );
    })
    .filter((command) => command.seq > processedSeq)
    .sort((a, b) => a.seq - b.seq);
}

/** The last sequence number read (to mark the queue handled). */
export function lastCommandSeq(commands: FocusCommand[], processedSeq: number): number {
  return commands.reduce((max, command) => Math.max(max, command.seq), processedSeq);
}

/**
 * The session after the queued taps, each at the time it was made (a pause
 * keeps the time that was left then; a resume ends that much after it).
 * Only commands for this session count: one for an older session (the app
 * moved on meanwhile) is dropped. Pausing a paused session or resuming a
 * running one changes nothing, so replaying the queue is harmless. A tap time
 * in the future (the clock moved) counts as now. "extend" and "break" only act
 * at time's up (as their buttons only show then); a break clears the session. `applied` lists what each one did: a
 * pause that found the time already up ended it instead, which isn't a pause.
 */
export function applyFocusCommands(
  session: FocusSession | null,
  commands: FocusCommand[],
  now: number,
): { session: FocusSession | null; applied: FocusCommandAction[] } {
  let current = session;
  const applied: FocusCommandAction[] = [];
  for (const command of commands) {
    if (!current || command.sessionId !== current.id) continue;
    const at = Math.min(command.at, now);
    const next = step(current, command.action, at);
    if (next === current) continue;
    current = next;
    const did =
      (command.action === "pause" && next?.status === "paused") ||
      (command.action === "resume" && next?.status === "running") ||
      command.action === "extend" ||
      command.action === "break";
    if (did) applied.push(command.action);
  }
  return { session: current, applied };
}

function step(session: FocusSession, action: FocusCommandAction, at: number): FocusSession | null {
  if (action === "pause") return pause(session, at);
  if (action === "resume") return resume(session, at);
  if (sessionPhase(session, at) !== "ended") return session;
  if (action === "break") return null;
  return session.kind === "starter" ? keepGoing(session, at) : extend(session, at);
}
