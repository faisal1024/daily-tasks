// How AI plan requests fail, what the user is told, and how plan status
// survives an app restart. Pure (no React Native imports) so it's unit-tested.

import { toDateKey } from "./date";
import type { MomentumPlan } from "./types";

export type AiFailureKind =
  | "timeout"
  | "rate_limited"
  | "busy"
  | "unauthorized"
  | "network"
  | "unavailable"
  | "invalid_response";

const KINDS: readonly AiFailureKind[] = [
  "timeout",
  "rate_limited",
  "busy",
  "unauthorized",
  "network",
  "unavailable",
  "invalid_response",
];

/** Error thrown by the AI client; `kind` drives user-facing copy. */
export class MomentumAiError extends Error {
  readonly kind: AiFailureKind;
  readonly status: number | null;

  constructor(kind: AiFailureKind, message: string, status: number | null = null) {
    super(message);
    this.name = "MomentumAiError";
    this.kind = kind;
    this.status = status;
  }
}

/** Map a proxy HTTP status to a failure kind. */
export function kindForStatus(status: number): AiFailureKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 503) return "busy";
  return "unavailable";
}

/** Classify anything thrown by a plan request. Unknown errors count as network trouble. */
export function classifyAiFailure(error: unknown): AiFailureKind {
  if (error instanceof MomentumAiError) return error.kind;
  return "network";
}

export function isAiFailureKind(value: unknown): value is AiFailureKind {
  return typeof value === "string" && (KINDS as readonly string[]).includes(value);
}

/**
 * Short, friendly copy for the suggestions card. Never shows raw error text.
 * Returns null when there's nothing worth telling the user.
 */
export function aiFailureMessage(kind: AiFailureKind | null): string | null {
  switch (kind) {
    case null:
      return null;
    case "rate_limited":
      return "You've refreshed a lot. Try again in a minute.";
    case "busy":
      return "Smart suggestions are resting for today. Here are some starters.";
    case "unauthorized":
      // Old builds after the proxy secret is enabled: an update fixes it.
      return "Smart suggestions need the latest version of the app.";
    case "timeout":
    case "network":
    case "unavailable":
    case "invalid_response":
      return "Couldn't get fresh ideas right now. Try again in a bit.";
  }
}

export type PlanStatus = "idle" | "loading" | "ready" | "error";

/**
 * Status to use when restoring saved state. A saved "loading" means the app was
 * killed mid-request; nothing is in flight anymore, so it must not stay loading
 * (that would disable "New ideas" and block the daily auto-fetch forever).
 */
export function restorePlanStatus(saved: unknown, hasPlan: boolean): PlanStatus {
  if (saved === "ready" || saved === "error") return saved;
  return hasPlan ? "ready" : "idle";
}

/**
 * Plan to keep after a failed AI request: the current plan if there is one
 * (never replace good ideas with generic ones), otherwise the fallback.
 */
export function planAfterAiFailure(
  current: MomentumPlan | null,
  buildFallback: () => MomentumPlan | null,
): MomentumPlan | null {
  return current ?? buildFallback();
}

/** Copy under the suggestions header, adapted to how many ideas are showing. */
export function suggestionsHint(count: number): string {
  if (count <= 1) return "Add it if it fits, or write your own below.";
  if (count === 2) return "Add one or both, or write your own below.";
  return "Add any you like — one, two, or all three. You can also write your own below.";
}

/** Failures worth retrying automatically; limits and auth problems are not. */
const TRANSIENT: ReadonlySet<AiFailureKind> = new Set([
  "timeout",
  "network",
  "unavailable",
  "invalid_response",
]);

export const FOREGROUND_RETRY_COOLDOWN_MS = 2 * 60_000;

/**
 * Whether returning to the foreground should retry a failed AI fetch: only for
 * transient failures, and not more often than the cooldown (so a dead network
 * doesn't turn every app switch into a request).
 */
export function shouldRetryAiOnForeground(params: {
  status: PlanStatus;
  failureKind: AiFailureKind | null;
  lastFailureAt: number | null;
  now: number;
}): boolean {
  if (params.status !== "error" || !params.failureKind) return false;
  if (!TRANSIENT.has(params.failureKind)) return false;
  if (params.lastFailureAt == null) return true;
  return params.now - params.lastFailureAt >= FOREGROUND_RETRY_COOLDOWN_MS;
}

/** Local YYYY-MM-DD for a timestamp (same keys as todayKey). */
function localDateKey(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : toDateKey(date);
}

/**
 * True when `plan` is an AI plan generated today for the current goal. Such a
 * plan is kept across app launches instead of being replaced by a template and
 * re-fetched (which flashed generic ideas and cost an AI call per launch).
 */
export function isFreshAiPlan(
  plan: MomentumPlan | null,
  goalTitle: string | null,
  today: string,
): boolean {
  return Boolean(
    plan &&
      plan.provider === "ai" &&
      goalTitle &&
      plan.goalTitle === goalTitle &&
      localDateKey(plan.generatedAt) === today,
  );
}
