// "Start my next task" from outside the app (1.3, PR F): the widget's Start
// button and Siri / Shortcuts. Both open `dailytasks://focus/start?task=next`
// (with `source=widget|siri`, and `kind=starter` for the 5-minute starter),
// and Siri also leaves the request in the App Group (`focus.startRequest`) in
// case the app was cold-started and missed the link. The router hands links to
// queueFocusStart (app/+native-intent.tsx); the store plans and acts on them
// once it's ready. Idempotent: a start never restarts a timer already on that task.
import type { FocusSession, FocusSessionKind } from "./focus-session";
import type { TaskId } from "./types";

export type FocusStartSource = "widget" | "siri";

export interface FocusStartRequest {
  kind: FocusSessionKind;
  source: FocusStartSource;
}

/** The default length when none has been used yet, in minutes. */
export const DEFAULT_LINK_MINUTES = 20;
/** A request left in the App Group is only acted on this soon after it was made. */
export const START_REQUEST_MAX_AGE_MS = 60_000;

/**
 * The request in a link, or null when it isn't "start my next task". Takes a
 * full URL (`dailytasks://focus/start?...`) or the router's path (`/focus/start?...`).
 */
export function parseFocusStartLink(url: string | null | undefined): FocusStartRequest | null {
  if (!url) return null;
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?\/*focus\/start\/?(?:\?([^#]*))?(?:#.*)?$/i.exec(url.trim());
  if (!match) return null;
  const params = new Map<string, string>();
  for (const pair of (match[1] ?? "").split("&")) {
    if (!pair) continue;
    const [key, value = ""] = pair.split("=");
    try {
      params.set(decodeURIComponent(key), decodeURIComponent(value.replace(/\+/g, " ")));
    } catch {
      // A malformed pair is ignored.
    }
  }
  // Only the next task for now; anything else isn't ours.
  const task = params.get("task") ?? "next";
  if (task !== "next") return null;
  return {
    kind: params.get("kind") === "starter" ? "starter" : "timer",
    source: params.get("source") === "siri" ? "siri" : "widget",
  };
}

/**
 * The request Siri left in the App Group, if it's new (not the one last
 * handled) and recent. Malformed JSON is ignored.
 */
export function parseFocusStartRequest(
  raw: string | null,
  handledId: string | null,
  now: number,
): (FocusStartRequest & { id: string }) | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { id, kind, source, at } = parsed as Record<string, unknown>;
  if (typeof id !== "string" || id === handledId) return null;
  if (typeof at !== "number" || !Number.isFinite(at) || Math.abs(now - at) > START_REQUEST_MAX_AGE_MS) return null;
  return { id, kind: kind === "starter" ? "starter" : "timer", source: source === "widget" ? "widget" : "siri" };
}

export type FocusStartPlan =
  /** Start a session on this task. */
  | { type: "start"; taskId: TaskId }
  /** Show Today as it is: nothing to start, or this task's timer is already on. */
  | { type: "show" }
  /** Another task's timer is on: open this task's focus screen, which says it would stop it. */
  | { type: "confirm"; taskId: TaskId };

/**
 * What a start request does. The next task is the first open one on today's
 * list (as the widget shows it).
 */
export function planFocusStart(state: {
  tasks: { id: TaskId }[];
  todayCompletions: string[];
  focusSession: FocusSession | null;
}): FocusStartPlan {
  const next = state.tasks.find((task) => !state.todayCompletions.includes(task.id));
  if (!next) return { type: "show" };
  const session = state.focusSession;
  if (!session) return { type: "start", taskId: next.id };
  // Never restart the timer that's already on it (running, paused or checking in).
  if (session.taskId === next.id) return { type: "show" };
  // Never silently replace another task's timer.
  return { type: "confirm", taskId: next.id };
}

// Links arrive before the store is ready (a cold start): they wait here.
type Listener = () => void;
let pending: FocusStartRequest[] = [];
const listeners = new Set<Listener>();

export function queueFocusStart(request: FocusStartRequest): void {
  pending.push(request);
  listeners.forEach((listener) => listener());
}

/** Take (and clear) what's waiting. */
export function takeFocusStarts(): FocusStartRequest[] {
  const taken = pending;
  pending = [];
  return taken;
}

export function subscribeFocusStarts(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only. */
export function __resetFocusLinkForTests(): void {
  pending = [];
  listeners.clear();
}
