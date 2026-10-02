// 1.3 paywalls: the aha paywall rule (once per install, never on install day,
// 24 h after any paywall, fails closed), the onboarding headline that echoes
// first run, the trial timeline and the monthly line's wording.
import { describe, expect, it } from "vitest";

import {
  AHA_PAYWALL_GAP_MS,
  shouldOfferAhaPaywall,
  type AhaPaywallInput,
} from "../lib/daily-tasks/aha-paywall";
import { todayKey } from "../lib/daily-tasks/date";
import {
  monthlyNudgeText,
  paywallHeadline,
  trialTimeline,
  trialTimelineLabel,
  type PlusPackage,
} from "../lib/daily-tasks/plus";

// Local-time fixtures: CI runs in several time zones.
const INSTALL = new Date(2026, 8, 20, 9, 0);
const NEXT_DAY = new Date(2026, 8, 21, 9, 0);

function input(overrides: Partial<AhaPaywallInput> = {}): AhaPaywallInput {
  return {
    today: todayKey(NEXT_DAY),
    state: { installDay: todayKey(INSTALL), ahaShown: false, lastPaywallShownAt: null },
    now: NEXT_DAY.getTime(),
    paywallEnabled: true,
    hasPlus: false,
    busy: false,
    ...overrides,
  };
}

describe("shouldOfferAhaPaywall", () => {
  it("offers it the day after install, to a free user with nothing else going on", () => {
    expect(shouldOfferAhaPaywall(input())).toBe(true);
  });

  it("never on install day, even late at night", () => {
    const lateInstallDay = new Date(2026, 8, 20, 23, 59);
    expect(shouldOfferAhaPaywall(input({ today: todayKey(lateInstallDay), now: lateInstallDay.getTime() }))).toBe(
      false,
    );
  });

  it("waits a full 24 h after the last paywall: not at 24 h less 1 ms, yes at exactly 24 h", () => {
    const now = NEXT_DAY.getTime();
    const state = (last: number) => ({ installDay: todayKey(INSTALL), ahaShown: false, lastPaywallShownAt: last });
    expect(shouldOfferAhaPaywall(input({ state: state(now - AHA_PAYWALL_GAP_MS + 1) }))).toBe(false);
    expect(shouldOfferAhaPaywall(input({ state: state(now - AHA_PAYWALL_GAP_MS) }))).toBe(true);
  });

  it("waits when the clock was set backwards (last paywall in the future, or today before install day)", () => {
    const now = NEXT_DAY.getTime();
    expect(
      shouldOfferAhaPaywall(
        input({ state: { installDay: todayKey(INSTALL), ahaShown: false, lastPaywallShownAt: now + 3 * AHA_PAYWALL_GAP_MS } }),
      ),
    ).toBe(false);
    const before = new Date(2026, 8, 19, 9, 0);
    expect(shouldOfferAhaPaywall(input({ today: todayKey(before), now: before.getTime() }))).toBe(false);
  });

  it("fails closed with no saved state, or a state that never got its install day", () => {
    expect(shouldOfferAhaPaywall(input({ state: null }))).toBe(false);
    expect(shouldOfferAhaPaywall(input({ state: undefined }))).toBe(false);
    expect(
      shouldOfferAhaPaywall(input({ state: { installDay: "", ahaShown: false, lastPaywallShownAt: null } })),
    ).toBe(false);
  });

  it("not once it has been shown, not to Plus (or a still-loading check), not when busy or without a paywall", () => {
    const base = input();
    expect(shouldOfferAhaPaywall({ ...base, state: { ...base.state!, ahaShown: true } })).toBe(false);
    // hasPlus is true while the entitlement is still being checked: the same "no".
    expect(shouldOfferAhaPaywall(input({ hasPlus: true }))).toBe(false);
    expect(shouldOfferAhaPaywall(input({ busy: true }))).toBe(false);
    expect(shouldOfferAhaPaywall(input({ paywallEnabled: false }))).toBe(false);
  });
});

describe("onboarding paywall headline", () => {
  it.each([
    [0, "A little extra help, when you want it"],
    [1, "It's set."],
    [2, "Your two are set."],
    [3, "Your three are set."],
    [undefined, "Your three are set."],
  ])("with %s tasks from first run: %s", (taskCount, headline) => {
    expect(paywallHeadline("onboarding", { taskCount })).toBe(headline);
  });
});

function pkg(overrides: Partial<PlusPackage> = {}): PlusPackage {
  return {
    id: "$rc_annual",
    kind: "annual",
    priceString: "$29.99",
    pricePerMonthString: "$2.49",
    trialDays: 7,
    ...overrides,
  };
}

describe("trialTimeline", () => {
  it("is only for a subscription with a free trial", () => {
    const on = { remindersAllowed: true };
    expect(trialTimeline(null, on)).toBeNull();
    expect(trialTimeline(pkg({ trialDays: null }), on)).toBeNull();
    expect(trialTimeline(pkg({ trialDays: 0 }), on)).toBeNull();
    expect(trialTimeline(pkg({ kind: "lifetime" }), on)).toBeNull();
    expect(trialTimeline(pkg({ kind: "other" }), on)).toBeNull();
  });

  it("numbers the days from the trial length, with the price per year or per month", () => {
    expect(trialTimeline(pkg(), { remindersAllowed: true })).toEqual([
      { when: "Today", what: "All of Plus, free" },
      { when: "Day 5", what: "We remind you" },
      { when: "Day 7", what: "$29.99/year, cancel anytime" },
    ]);
    expect(trialTimeline(pkg({ kind: "monthly", priceString: "$4.99", trialDays: 14 }), { remindersAllowed: true })).toEqual([
      { when: "Today", what: "All of Plus, free" },
      { when: "Day 12", what: "We remind you" },
      { when: "Day 14", what: "$4.99/month, cancel anytime" },
    ]);
  });

  it("drops the reminder when notifications aren't allowed or the trial is under 3 days", () => {
    const whens = (steps: ReturnType<typeof trialTimeline>) => steps?.map((step) => step.when);
    expect(whens(trialTimeline(pkg(), { remindersAllowed: false }))).toEqual(["Today", "Day 7"]);
    expect(whens(trialTimeline(pkg({ trialDays: 2 }), { remindersAllowed: true }))).toEqual(["Today", "Day 2"]);
    expect(whens(trialTimeline(pkg({ trialDays: 3 }), { remindersAllowed: true }))).toEqual([
      "Today",
      "Day 1",
      "Day 3",
    ]);
  });

  it("reads as one sentence, with the price said per year", () => {
    expect(trialTimelineLabel(trialTimeline(pkg(), { remindersAllowed: true })!)).toBe(
      "How the free trial works. Today: All of Plus, free. Day 5: We remind you. Day 7: $29.99 per year, cancel anytime.",
    );
  });
});

describe("monthlyNudgeText", () => {
  it("names the free days, or the price when monthly has no trial", () => {
    expect(monthlyNudgeText(pkg({ kind: "monthly", trialDays: 7 }))).toBe("Prefer to start small? Monthly, 7 days free.");
    expect(monthlyNudgeText(pkg({ kind: "monthly", priceString: "$4.99", trialDays: null }))).toBe(
      "Prefer to start small? Monthly is $4.99/month.",
    );
  });
});
