// Momentum Plus: who has access, and how plans are described on the paywall.
//
// Everything here is pure (no SDK imports) so it can be unit tested. The
// RevenueCat wrapper (purchases.ts) turns SDK objects into PlusPackage values.

/** RevenueCat entitlement that unlocks Plus. Must match the dashboard. */
export const PLUS_ENTITLEMENT = "plus";

/**
 * Builds from this version on never auto-grandfather, even if one ships
 * without a RevenueCat key by mistake. The first paywall release is 1.1.0.
 */
export const GRANDFATHER_BEFORE_VERSION = "1.1.0";

export type PlusFeature = "brain_dump" | "break_down" | "ai_ideas" | "calendar" | "routines";

export type PaywallSource =
  | "onboarding"
  | "settings"
  | "brain_dump"
  | "break_down"
  | "new_ideas"
  | "calendar"
  | "win_back"
  // The gentle second paywall after a first real "aha" (lib/daily-tasks/aha-paywall.ts).
  | "aha"
  | "routines";

export type PlanKind = "annual" | "monthly" | "lifetime" | "other";

/** SDK-independent view of one purchasable package. */
export interface PlusPackage {
  id: string;
  kind: PlanKind;
  priceString: string;
  /** Monthly equivalent for annual plans, e.g. "$2.49", when the store gives it. */
  pricePerMonthString: string | null;
  /** Free-trial length in days, when the product has a free intro offer the user can get. */
  trialDays: number | null;
  /**
   * The store's unit for that free intro period ("DAY", "WEEK", "MONTH",
   * "YEAR"). The trial timeline only counts days for DAY/WEEK trials, since a
   * month or year isn't a fixed number of days.
   */
  trialUnit?: string | null;
  /**
   * An Apple win-back offer this lapsed subscriber is eligible for (iOS 18+,
   * created in App Store Connect). Absent or null: the plain price applies.
   */
  winBackOffer?: WinBackOffer | null;
}

/** A free trial of Plus, as RevenueCat reports it. */
export interface PlusTrial {
  /** When the trial started (ISO), when known. */
  startedAt: string | null;
  /** When the trial ends (ISO). */
  endsAt: string;
  /** False once the trial was cancelled (it won't turn into a subscription). */
  willRenew: boolean;
  /** The store product the trial is for (its price is what renews), when known. */
  productId?: string | null;
}

/** What a subscription renews at: "$29.99" a "year". */
export interface RenewalPrice {
  priceString: string;
  period: string;
}

/**
 * A store subscription period (ISO 8601, "P1Y", "P1M", "P1W") as the word
 * after a price's slash; null for anything else (the copy then leaves the
 * price out rather than guess).
 */
export function subscriptionPeriodWord(period: string | null | undefined): string | null {
  switch (period) {
    case "P1Y":
    case "P12M":
      return "year";
    case "P1M":
      return "month";
    case "P1W":
    case "P7D":
      return "week";
    default:
      return null;
  }
}

/**
 * When the trial-ending reminder is for: the trial's end, unless it was
 * already cancelled (nothing to warn about).
 */
export function trialReminderEnd(trial: PlusTrial | null | undefined): string | null {
  return trial && trial.willRenew ? trial.endsAt : null;
}

/** SDK-independent view of an Apple win-back offer (a discount, not a separate product). */
export interface WinBackOffer {
  /** Price per billing period in the local currency, e.g. 9.99 (0 = free). */
  price: number;
  /** Formatted price per billing period, e.g. "$9.99". */
  priceString: string;
  /** How many billing periods the price applies for (1 for "pay up front"). */
  cycles: number;
  /** DAY, WEEK, MONTH or YEAR. */
  periodUnit: string;
  periodNumberOfUnits: number;
}

/**
 * Plus access:
 * - no paywall configured (no RevenueCat key in this build) → everyone keeps
 *   every feature, exactly as before the paywall existed;
 * - people who used the app before the paywall shipped are grandfathered;
 * - otherwise it's the RevenueCat entitlement.
 */
export function hasPlusAccess(input: {
  paywallEnabled: boolean;
  grandfathered: boolean;
  entitlementActive: boolean;
}): boolean {
  return !input.paywallEnabled || input.grandfathered || input.entitlementActive;
}

export function planKind(packageType: string): PlanKind {
  switch (packageType) {
    case "ANNUAL":
      return "annual";
    case "MONTHLY":
      return "monthly";
    case "LIFETIME":
      return "lifetime";
    default:
      return "other";
  }
}

/** The trial reminder (trial-reminder.ts) goes out this many days before a trial ends. */
export const TRIAL_REMINDER_DAYS_BEFORE_END = 2;

const UNIT_DAYS: Record<string, number> = { DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 };

/** Trial length in days for a free intro offer, or null if it isn't a free trial. */
export function freeTrialDays(
  intro: { price: number; periodUnit: string; periodNumberOfUnits: number } | null | undefined,
): number | null {
  if (!intro || intro.price !== 0) return null;
  const days = UNIT_DAYS[intro.periodUnit];
  if (!days || !Number.isFinite(intro.periodNumberOfUnits) || intro.periodNumberOfUnits <= 0) {
    return null;
  }
  return days * intro.periodNumberOfUnits;
}

const ORDER: Record<PlanKind, number> = { annual: 0, monthly: 1, lifetime: 2, other: 3 };

/** Annual first (the plan we recommend), then monthly, then lifetime. */
export function sortPackages(packages: PlusPackage[]): PlusPackage[] {
  return [...packages].sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}

/**
 * What a paywall shows: lifetime only when opened from Settings (someone
 * looking for it), so the trial plans lead everywhere else.
 */
export function visiblePackages(packages: PlusPackage[], source: PaywallSource | null): PlusPackage[] {
  return source === "settings" ? packages : packages.filter((pkg) => pkg.kind !== "lifetime");
}

/** The plan selected when the paywall opens: annual if offered. */
export function defaultPackageId(packages: PlusPackage[]): string | null {
  return sortPackages(packages)[0]?.id ?? null;
}

export interface PlanLabel {
  title: string;
  price: string;
  detail: string | null;
  badge: string | null;
}

const UNIT_WORDS: Record<string, string> = { DAY: "day", WEEK: "week", MONTH: "month", YEAR: "year" };

function duration(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * The offer has a shape we can describe honestly; anything unexpected is
 * dropped (the plan shows its plain price): a missing or unknown period,
 * fewer than one cycle, a negative or missing price, no price text, or a free
 * offer spread over several cycles (Apple's free offers are one period).
 */
export function isUsableWinBackOffer(offer: WinBackOffer | null | undefined): offer is WinBackOffer {
  if (!offer) return false;
  if (typeof offer.periodUnit !== "string" || !UNIT_WORDS[offer.periodUnit]) return false;
  if (!Number.isInteger(offer.cycles) || offer.cycles < 1) return false;
  if (!Number.isInteger(offer.periodNumberOfUnits) || offer.periodNumberOfUnits < 1) return false;
  if (typeof offer.price !== "number" || !Number.isFinite(offer.price) || offer.price < 0) return false;
  if (typeof offer.priceString !== "string" || offer.priceString.trim() === "") return false;
  if (offer.price === 0 && offer.cycles > 1) return false;
  return true;
}

/**
 * The offer in plain words: "3 months for $9.99" (pay up front),
 * "$2.99/month for 3 months" (pay as you go) or "1 month free".
 */
export function winBackOfferPhrase(offer: WinBackOffer): string {
  const unit = UNIT_WORDS[offer.periodUnit] ?? offer.periodUnit.toLowerCase();
  const total = duration(offer.cycles * offer.periodNumberOfUnits, unit);
  if (offer.price === 0) return `${total} free`;
  if (offer.cycles === 1) return `${total} for ${offer.priceString}`;
  const per =
    offer.periodNumberOfUnits === 1
      ? `${offer.priceString}/${unit}`
      : `${offer.priceString} every ${duration(offer.periodNumberOfUnits, unit)}`;
  return `${per} for ${total}`;
}

/** The win-back offer to show (and buy with) for this plan, or null. Lifetime never has one. */
export function shownWinBackOffer(pkg: PlusPackage | null): WinBackOffer | null {
  if (!pkg || (pkg.kind !== "annual" && pkg.kind !== "monthly")) return null;
  return isUsableWinBackOffer(pkg.winBackOffer) ? pkg.winBackOffer : null;
}

export function planLabel(pkg: PlusPackage): PlanLabel {
  const offer = shownWinBackOffer(pkg);
  if (offer) {
    const period = pkg.kind === "annual" ? "year" : "month";
    return {
      title: pkg.kind === "annual" ? "Yearly" : "Monthly",
      price: winBackOfferPhrase(offer),
      detail: `Then ${pkg.priceString}/${period}`,
      badge: "Welcome back",
    };
  }
  switch (pkg.kind) {
    case "annual":
      return {
        title: "Yearly",
        price: `${pkg.priceString}/year`,
        detail: pkg.pricePerMonthString ? `About ${pkg.pricePerMonthString}/month, billed yearly` : null,
        badge: pkg.trialDays ? `${pkg.trialDays}-day free trial` : "Best value",
      };
    case "monthly":
      return {
        title: "Monthly",
        price: `${pkg.priceString}/month`,
        detail: pkg.trialDays ? `${pkg.trialDays}-day free trial` : null,
        badge: null,
      };
    case "lifetime":
      return { title: "Lifetime", price: pkg.priceString, detail: "Pay once, keep it forever", badge: null };
    default:
      return { title: "Plus", price: pkg.priceString, detail: null, badge: null };
  }
}

/** Main button text for the selected plan. */
export function purchaseButtonLabel(pkg: PlusPackage | null): string {
  if (!pkg) return "Continue";
  if (shownWinBackOffer(pkg)) return "Continue with offer";
  if (pkg.trialDays) return `Start ${pkg.trialDays}-day free trial`;
  return pkg.kind === "lifetime" ? "Buy lifetime" : "Subscribe";
}

/**
 * Plain-language terms under the button (App Store guideline 3.1.2 wants the
 * price, the period and what happens after a trial right by the button).
 */
export function purchaseTerms(pkg: PlusPackage | null): string {
  if (!pkg) return "";
  if (pkg.kind === "lifetime") return `One-time payment of ${pkg.priceString}. No subscription.`;
  const period = pkg.kind === "annual" ? "year" : "month";
  const renew = `Renews automatically at ${pkg.priceString}/${period} until you cancel. Cancel anytime in Settings › your name › Subscriptions.`;
  const offer = shownWinBackOffer(pkg);
  if (offer) {
    return `Welcome-back offer: ${winBackOfferPhrase(offer)}, then ${pkg.priceString}/${period}. ${renew}`;
  }
  return pkg.trialDays ? `Free for ${pkg.trialDays} days, then ${pkg.priceString}/${period}. ${renew}` : renew;
}

/** What Plus includes, in the order the paywall lists it. */
export const PLUS_BENEFITS: { icon: string; title: string; detail: string }[] = [
  {
    icon: "create-outline",
    title: "Smart brain dump",
    detail: "Dump everything; AI picks today's three and saves the rest.",
  },
  {
    icon: "list-outline",
    title: "Break it down",
    detail: "Turn a stuck task into tiny steps you can start now.",
  },
  {
    icon: "sparkles-outline",
    title: "AI ideas for your goal",
    detail: "Fresh suggestions each day that adapt to how your days go.",
  },
  {
    icon: "calendar-outline",
    title: "Plan around your calendar",
    detail: "Your three fit around today's events and reminders.",
  },
  {
    icon: "repeat-outline",
    title: "Unlimited routines",
    detail: "Keep every routine, not just two.",
  },
  {
    icon: "apps-outline",
    title: "Tick off from your Home Screen",
    detail: "Check tasks off right from the widget, without opening the app.",
  },
];

/**
 * Headline per entry point, so the paywall says why it appeared. The
 * onboarding one echoes what the user just did: `taskCount` is how many tasks
 * first run set (0 = they chose to add their own, so nothing to echo).
 */
export function paywallHeadline(source: PaywallSource, options: { taskCount?: number } = {}): string {
  switch (source) {
    case "onboarding": {
      const count = options.taskCount ?? 3;
      if (count <= 0) return "A little extra help, when you want it";
      return count >= 3 ? "Your three are set." : "You're set for today.";
    }
    case "aha":
      return "Today's three are set.";
    case "brain_dump":
      return "Let AI sort your brain dump";
    case "break_down":
      return "Break any task into tiny steps";
    case "new_ideas":
      return "Get fresh ideas for your goal";
    case "calendar":
      return "Plan your three around your day";
    case "win_back":
      return "Want the AI helpers back?";
    case "routines":
      return "Keep all your routines";
    default:
      return "A little extra help, when you want it";
  }
}

/** The line under the headline. */
export function paywallSubhead(source: PaywallSource, options: { taskCount?: number } = {}): string {
  switch (source) {
    case "onboarding":
      return (options.taskCount ?? 3) > 0
        ? "Want help like this every morning? Your three stay free either way."
        : "Your three tasks stay free forever. Plus adds the AI helpers.";
    case "aha":
      return "Plus sorts a messy brain dump, breaks big tasks into steps and plans around your calendar. Your three stay free either way.";
    case "win_back":
      return "Your three tasks stay free. Plus brings back AI sorting, break it down and calendar planning.";
    case "routines":
      return "Two routines are free, and they keep working. Plus keeps as many as you like, with the AI helpers too.";
    default:
      return "Your three tasks stay free forever. Plus adds the AI helpers.";
  }
}

export interface TrialStep {
  /** "Today", "Day 5", "Day 7". */
  when: string;
  what: string;
}

/**
 * What happens during a free trial, for the timeline under the plans: today,
 * the reminder, the first charge. Null when the plan has no free trial for
 * this user (or isn't a subscription), and null for month/year-unit trials,
 * whose length in days isn't fixed. The reminder step is left out when it
 * can't be kept: notifications aren't allowed, or the trial is too short for
 * the two-day heads-up.
 */
export function trialTimeline(
  pkg: PlusPackage | null,
  options: { remindersAllowed: boolean },
): TrialStep[] | null {
  if (!pkg || !pkg.trialDays || pkg.trialDays <= 0) return null;
  if (pkg.kind !== "annual" && pkg.kind !== "monthly") return null;
  if (pkg.trialUnit !== "DAY" && pkg.trialUnit !== "WEEK") return null;
  const period = pkg.kind === "annual" ? "year" : "month";
  const steps: TrialStep[] = [{ when: "Today", what: "All of Plus, free" }];
  const reminderDay = pkg.trialDays - TRIAL_REMINDER_DAYS_BEFORE_END;
  if (options.remindersAllowed && reminderDay >= 1) {
    steps.push({ when: `Day ${reminderDay}`, what: "We remind you, with time to cancel" });
  }
  steps.push({ when: `Day ${pkg.trialDays}`, what: `${pkg.priceString}/${period} starts. Cancel before then and you won't pay.` });
  return steps;
}

/** The timeline read as one sentence by VoiceOver. */
export function trialTimelineLabel(steps: TrialStep[]): string {
  const spoken = steps.map((step) => {
    const what = step.what.replace(/\/(year|month)\b/, " per $1");
    // Steps that are already sentences keep their own full stop.
    return `${step.when}: ${/[.!?]$/.test(what) ? what : `${what}.`}`;
  });
  return `How the free trial works. ${spoken.join(" ")}`;
}

/**
 * The quiet line offered after someone backs out of buying the yearly plan:
 * a smaller step, never a countdown. With a win-back offer on monthly, it
 * quotes the offer (as the card does), never the full price.
 */
export function monthlyNudgeText(monthly: PlusPackage): string {
  // A win-back offer replaces the plain price on the card: quote the same terms.
  const offer = shownWinBackOffer(monthly);
  if (offer) return `Prefer to start small? Monthly, ${winBackOfferPhrase(offer)}.`;
  return monthly.trialDays
    ? `Prefer to start small? Monthly, ${monthly.trialDays} days free.`
    : `Prefer to start small? Monthly is ${monthly.priceString}/month.`;
}

/** Status line for the Settings row. */
export function plusStatusLabel(input: {
  paywallEnabled: boolean;
  grandfathered: boolean;
  entitlementActive: boolean;
}): string {
  if (input.entitlementActive) return "Plus is active. Thank you!";
  if (input.grandfathered) return "Included free for early supporters.";
  if (!input.paywallEnabled) return "All features are included.";
  return "Plus adds AI help: smart brain dump, break it down and fresh goal ideas.";
}
