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

export type PlusFeature = "brain_dump" | "break_down" | "ai_ideas" | "weekly_review";

export type PaywallSource =
  | "onboarding"
  | "settings"
  | "brain_dump"
  | "break_down"
  | "new_ideas"
  | "weekly_review"
  | "calendar";

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

export function planLabel(pkg: PlusPackage): PlanLabel {
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
    title: "Weekly review",
    detail: "See your best days and the tasks that keep sliding.",
  },
  {
    icon: "apps-outline",
    title: "Tick off from your Home Screen",
    detail: "Check tasks off right from the widget, without opening the app.",
  },
];

/** Headline per entry point, so the paywall says why it appeared. */
export function paywallHeadline(source: PaywallSource): string {
  switch (source) {
    case "brain_dump":
      return "Let AI sort your brain dump";
    case "break_down":
      return "Break any task into tiny steps";
    case "weekly_review":
      return "See how your weeks are going";
    case "new_ideas":
      return "Get fresh ideas for your goal";
    case "calendar":
      return "Plan your three around your day";
    default:
      return "A little extra help, when you want it";
  }
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
