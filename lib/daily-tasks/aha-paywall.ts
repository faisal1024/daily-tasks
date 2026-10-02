// The gentle second paywall (source "aha"): offered once per install, at the
// first real "aha" after the first day: using last night's draft for today,
// tapping Set (even with only one or two tasks: Set is a deliberate "my day is
// set" moment), or a brain dump that fills the day's three. Typing the third
// task by hand doesn't count (too interruptive mid-typing). Pure, so the rule
// can be unit tested; plus-context persists what it needs and the Today screen
// reports the moments.

import { MAX_TASKS } from "./types";

/** No paywall of any kind within this long of the last one shown. */
export const AHA_PAYWALL_GAP_MS = 24 * 60 * 60_000;

/** Let the moment land (and any closing sheet animate away) before offering. */
export const AHA_PAYWALL_DELAY_MS = 1200;

/** What plus-context remembers for the rule (per install; "Reset all data" keeps it). */
export interface AhaPaywallState {
  /** Local date key (YYYY-MM-DD) of the first launch that recorded it. */
  installDay: string;
  /** The aha paywall was actually shown (iOS presented it). */
  ahaShown: boolean;
  /** When any paywall was last shown (epoch ms), or null if never recorded. */
  lastPaywallShownAt: number | null;
}

export interface AhaPaywallInput {
  /** Today's local date key. */
  today: string;
  /** Null while the saved state is loading or couldn't be read: no offer. */
  state: AhaPaywallState | null | undefined;
  now: number;
  paywallEnabled: boolean;
  /** Plus, a trial, grandfathered, or still being checked: no offer. */
  hasPlus: boolean;
  /** First run, a focus session, a sheet or another paywall is up. */
  busy: boolean;
}

/** Whether the aha paywall may be offered right now. Fails closed. */
export function shouldOfferAhaPaywall(input: AhaPaywallInput): boolean {
  const { state } = input;
  if (!input.paywallEnabled || input.hasPlus || input.busy || !state) return false;
  if (state.ahaShown) return false;
  // Never on install day (date keys compare in order as strings).
  if (!state.installDay || !(input.today > state.installDay)) return false;
  if (state.lastPaywallShownAt !== null) {
    const since = input.now - state.lastPaywallShownAt;
    // A clock set backwards (negative) also waits.
    if (!Number.isFinite(since) || since < AHA_PAYWALL_GAP_MS) return false;
  }
  return true;
}

/** Whether an add took the day from under three tasks to a full three. */
export function fillsDay(before: number, after: number): boolean {
  return before < MAX_TASKS && after >= MAX_TASKS;
}
