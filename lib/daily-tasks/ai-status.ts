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
  | "invalid_response"
  // 402: the server couldn't confirm Plus (not retried automatically).
  | "needs_plus";

const KINDS: readonly AiFailureKind[] = [
  "timeout",
  "rate_limited",
  "busy",
  "unauthorized",
  "network",
  "unavailable",
  "invalid_response",
  "needs_plus",
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

/**
 * Map a proxy HTTP status to a failure kind. A 503 means "daily spend cap hit"
 * only when our proxy says so; a 503 from the host during a deploy or outage is
 * a transient "unavailable" (retried, and not described as "for today").
 */
export function kindForStatus(status: number, proxyError?: unknown): AiFailureKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 402) return "needs_plus";
  if (status === 503 && typeof proxyError === "string" && /busy/i.test(proxyError)) {
    return "busy";
  }
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
 * Short, friendly copy for the suggestions card and Settings. Never shows raw
 * error text. `showingAiIdeas` is true when the (kept) plan on screen is still
 * the AI one, so the copy doesn't promise "starters" that aren't there.
 * Returns null when there's nothing worth telling the user.
 */
export function aiFailureMessage(
  kind: AiFailureKind | null,
  {
    showingAiIdeas = false,
    surface = "card",
  }: { showingAiIdeas?: boolean; surface?: "card" | "settings" } = {},
): string | null {
  switch (kind) {
    case null:
      return null;
    case "rate_limited":
      // Neutral: the automatic fetch or others on a shared network can trigger
      // this, and the daily limit lasts longer than a minute.
      return "Lots of requests right now. Try again a little later.";
    case "busy":
      // Settings shows no ideas, so point at the Tasks tab instead of "below".
      if (surface === "settings") {
        return showingAiIdeas
          ? "Smart suggestions are taking a break for today. Your ideas on the Tasks tab still work."
          : "Smart suggestions are taking a break for today. Starter ideas are on the Tasks tab.";
      }
      return showingAiIdeas
        ? "Smart suggestions are taking a break for today. Your ideas below still work."
        : "Smart suggestions are taking a break for today. Try these starters.";
    case "unauthorized":
      // Old builds after the proxy secret is enabled: an update fixes it.
      return "Smart suggestions need the latest version of the app.";
    case "needs_plus":
      return "We couldn't confirm your Plus subscription. Try Restore purchases in Settings.";
    case "timeout":
    case "network":
    case "unavailable":
    case "invalid_response":
      return "Couldn't get fresh ideas right now. Try again in a bit.";
  }
}

/**
 * Copy for a failed "Break it down". Limits and auth reuse the shared copy;
 * everything else gets step-specific wording (the shared copy talks about ideas).
 */
export function breakDownFailureMessage(kind: AiFailureKind): string {
  if (kind === "rate_limited" || kind === "unauthorized" || kind === "needs_plus") {
    return aiFailureMessage(kind) ?? "Try again in a bit.";
  }
  if (kind === "busy") return "Smart steps are taking a break for today. Try again tomorrow.";
  return "Couldn't reach smart steps right now. Try again in a bit.";
}

export type PlanStatus = "idle" | "loading" | "ready" | "error";

/**
 * Status to use when restoring saved state. A saved "loading" means the app was
 * killed mid-request; nothing is in flight anymore, so it must not stay loading
 * (that would disable "New ideas" and block the daily auto-fetch forever).
 */
export function restorePlanStatus(
  saved: unknown,
  hasPlan: boolean,
  savedError: unknown = null,
): PlanStatus {
  if (saved === "ready") return "ready";
  // An error is only meaningful with a known kind (older builds saved raw text,
  // which would show no message and never retry).
  if (saved === "error" && isAiFailureKind(savedError)) return "error";
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
  // Shown in the Ideas sheet, which has no text field, so no "write your own below".
  if (count <= 1) return "Add it if it fits.";
  if (count === 2) return "Add one or both.";
  return "Add any you like — one, two, or all three.";
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

/** Whether a finished request is still the newest one and may update state. */
export function isLatestRequest(requestId: number, latestRequestId: number): boolean {
  return requestId === latestRequestId;
}
