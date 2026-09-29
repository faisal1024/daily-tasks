// "Start my next task" from outside the app (1.3, PR F): the widget's Start
// button and Siri / Shortcuts. Both open `dailytasks://focus/start?task=next`
// (with `source=widget|siri`, `kind=starter` for the 5-minute starter, and
// `id=` when native code made the request), and a tap on the Live Activity
// opens `dailytasks://focus?session=<id>`.
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
  /**
   * The request's id when native code made it (Siri, the widget's button):
   * the same id is in the link and in the App Group request, so one run
   * arriving both ways counts once.
   */
  id?: string;
}

/** A tap on the Live Activity: open that session's focus screen (or Today if it's gone). */
export interface FocusOpenRequest {
  sessionId: string;
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
  const link = parseFocusPath(url);
  if (!link || link.path !== "start") return null;
  const { params } = link;
  // Only the next task for now; anything else isn't ours.
  const task = params.get("task") ?? "next";
  if (task !== "next") return null;
  const id = params.get("id");
  return {
    kind: params.get("kind") === "starter" ? "starter" : "timer",
    source: params.get("source") === "siri" ? "siri" : "widget",
    ...(id ? { id } : {}),
  };
}

/** `dailytasks://focus?session=<id>` (a tap on the Live Activity), or null. */
export function parseFocusOpenLink(url: string | null | undefined): FocusOpenRequest | null {
  const link = parseFocusPath(url);
  if (!link || link.path !== "") return null;
  const sessionId = link.params.get("session");
  return sessionId ? { sessionId } : null;
}

/** Any `focus` link (`focus`, `focus/start`, …): these never go to the router as a route. */
export function isFocusLink(url: string | null | undefined): boolean {
  return parseFocusPath(url) !== null;
}

function parseFocusPath(url: string | null | undefined): { path: string; params: Map<string, string> } | null {
  if (!url) return null;
  const match = /^(?:[a-z][a-z0-9+.-]*:\/\/)?\/*focus(?:\/([^?#]*))?(?:\?([^#]*))?(?:#.*)?$/i.exec(url.trim());
  if (!match) return null;
  const params = new Map<string, string>();
  for (const pair of (match[2] ?? "").split("&")) {
    if (!pair) continue;
    const [key, value = ""] = pair.split("=");
    try {
      params.set(decodeURIComponent(key), decodeURIComponent(value.replace(/\+/g, " ")));
    } catch {
      // A malformed pair is ignored.
    }
  }
  return { path: (match[1] ?? "").replace(/\/+$/, ""), params };
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
let pendingOpen: FocusOpenRequest | null = null;
const listeners = new Set<Listener>();

export function queueFocusStart(request: FocusStartRequest): void {
  pending.push(request);
  listeners.forEach((listener) => listener());
}

export function queueFocusOpen(request: FocusOpenRequest): void {
  pendingOpen = request;
  listeners.forEach((listener) => listener());
}

/** Take (and clear) what's waiting. */
export function takeFocusStarts(): FocusStartRequest[] {
  const taken = pending;
  pending = [];
  return taken;
}

/** Take (and clear) the last Live Activity tap waiting, if any. */
export function takeFocusOpen(): FocusOpenRequest | null {
  const taken = pendingOpen;
  pendingOpen = null;
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
  pendingOpen = null;
  listeners.clear();
}
