// Momentum Plus (Phase 4): who has access, grandfathering of saved state, and
// the paywall's plan labels and legal terms.
import { describe, expect, it } from "vitest";

import {
  defaultPackageId,
  freeTrialDays,
  hasPlusAccess,
  PLUS_BENEFITS,
  paywallHeadline,
  planLabel,
  purchaseButtonLabel,
  purchaseTerms,
  shownWinBackOffer,
  visiblePackages,
  winBackOfferPhrase,
  type PaywallSource,
  type PlusPackage,
  type WinBackOffer,
} from "../lib/daily-tasks/plus";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";

function pkg(overrides: Partial<PlusPackage> = {}): PlusPackage {
  return {
    id: "$rc_annual",
    kind: "annual",
    priceString: "$29.99",
    pricePerMonthString: "$2.49",
    trialDays: null,
    ...overrides,
  };
}

describe("hasPlusAccess", () => {
  it("gives access without a paywall, to grandfathered users, or with the entitlement; otherwise not", () => {
    const off = { paywallEnabled: true, grandfathered: false, entitlementActive: false };
    expect(hasPlusAccess(off)).toBe(false);
    expect(hasPlusAccess({ ...off, paywallEnabled: false })).toBe(true);
    expect(hasPlusAccess({ ...off, grandfathered: true })).toBe(true);
    expect(hasPlusAccess({ ...off, entitlementActive: true })).toBe(true);
  });
});

describe("grandfathering in saved state", () => {
  it("grandfathers state saved before the paywall (no flag), but not a fresh install or an explicit false", () => {
    const saved = JSON.parse(JSON.stringify(buildInitialState(new Date(2026, 8, 26))));
    delete saved.plusGrandfathered;
    delete saved.analyticsEnabled;
    const migrated = normalizeState(saved);
    expect(migrated?.plusGrandfathered).toBe(true);
    // Analytics defaults on (it's still off unless the build has a key).
    expect(migrated?.analyticsEnabled).toBe(true);

    expect(buildInitialState().plusGrandfathered).toBe(false);
    expect(normalizeState({ ...saved, plusGrandfathered: false })?.plusGrandfathered).toBe(false);
    expect(normalizeState({ ...saved, analyticsEnabled: false })?.analyticsEnabled).toBe(false);
  });
});

describe("paywall plans and terms", () => {
  it("reads a free intro offer as trial days, and anything paid as no trial", () => {
    expect(freeTrialDays({ price: 0, periodUnit: "WEEK", periodNumberOfUnits: 1 })).toBe(7);
    expect(freeTrialDays({ price: 0, periodUnit: "DAY", periodNumberOfUnits: 3 })).toBe(3);
    expect(freeTrialDays({ price: 0.99, periodUnit: "MONTH", periodNumberOfUnits: 1 })).toBeNull();
    expect(freeTrialDays(null)).toBeNull();
  });

  it("selects annual by default whatever order the store returns", () => {
    const monthly = pkg({ id: "$rc_monthly", kind: "monthly", priceString: "$4.99" });
    const lifetime = pkg({ id: "$rc_lifetime", kind: "lifetime", priceString: "$59.99" });
    expect(defaultPackageId([monthly, lifetime, pkg()])).toBe("$rc_annual");
    expect(defaultPackageId([lifetime, monthly])).toBe("$rc_monthly");
    expect(defaultPackageId([])).toBeNull();
  });

  it("badges the annual trial and shows the monthly equivalent", () => {
    expect(planLabel(pkg({ trialDays: 7 }))).toEqual({
      title: "Yearly",
      price: "$29.99/year",
      detail: "About $2.49/month, billed yearly",
      badge: "7-day free trial",
    });
    expect(purchaseButtonLabel(pkg({ trialDays: 7 }))).toBe("Start 7-day free trial");
    expect(purchaseButtonLabel(pkg())).toBe("Subscribe");
  });

  it("states the renewal price and period by the button (with and without a trial), and no renewal for lifetime", () => {
    const trial = purchaseTerms(pkg({ trialDays: 7 }));
    expect(trial).toMatch(/^Free for 7 days, then \$29\.99\/year\./);
    expect(trial).toContain("Renews automatically at $29.99/year until you cancel.");
    expect(trial).toContain("Settings › your name › Subscriptions");
    expect(purchaseTerms(pkg({ kind: "monthly", priceString: "$4.99" }))).toContain(
      "Renews automatically at $4.99/month",
    );
    const lifetime = purchaseTerms(pkg({ kind: "lifetime", priceString: "$59.99" }));
    expect(lifetime).toContain("One-time payment of $59.99");
    expect(lifetime).not.toMatch(/Renews/);
  });
});

describe("which plans a paywall shows (Phase 11a)", () => {
  const annual = pkg();
  const monthly = pkg({ id: "$rc_monthly", kind: "monthly" });
  const lifetime = pkg({ id: "$rc_lifetime", kind: "lifetime", trialDays: null });
  const all = [annual, monthly, lifetime];

  it("keeps lifetime only for Settings", () => {
    expect(visiblePackages(all, "settings")).toEqual(all);
    const elsewhere: (PaywallSource | null)[] = ["win_back", "brain_dump", "onboarding", "break_down", null];
    for (const source of elsewhere) {
      expect(visiblePackages(all, source)).toEqual([annual, monthly]);
    }
  });

  it("has a win-back headline", () => {
    expect(paywallHeadline("win_back")).toBe("Want the AI helpers back?");
  });

  it("lists calendar planning, not the now-free weekly review", () => {
    const titles = PLUS_BENEFITS.map((b) => b.title);
    expect(titles).toContain("Plan around your calendar");
    expect(titles).not.toContain("Weekly review");
  });
});

// --- 1.3: Apple win-back offers (PR #81) ----------------------------------------

describe("win-back offer wording", () => {
  const offer = (overrides: Partial<WinBackOffer> = {}): WinBackOffer => ({
    price: 9.99,
    priceString: "$9.99",
    cycles: 1,
    periodUnit: "MONTH",
    periodNumberOfUnits: 3,
    ...overrides,
  });

  it("phrases pay up front, pay as you go and free offers", () => {
    expect(winBackOfferPhrase(offer())).toBe("3 months for $9.99");
    expect(winBackOfferPhrase(offer({ price: 2.99, priceString: "$2.99", cycles: 3, periodNumberOfUnits: 1 }))).toBe(
      "$2.99/month for 3 months",
    );
    expect(winBackOfferPhrase(offer({ price: 5, priceString: "$5.00", cycles: 3, periodNumberOfUnits: 2 }))).toBe(
      "$5.00 every 2 months for 6 months",
    );
    expect(winBackOfferPhrase(offer({ price: 0, priceString: "$0.00", periodNumberOfUnits: 1 }))).toBe("1 month free");
    expect(winBackOfferPhrase(offer({ price: 0, priceString: "Free", periodUnit: "WEEK", periodNumberOfUnits: 2 }))).toBe(
      "2 weeks free",
    );
  });

  it("labels, buttons and terms the offered plan, then the full price", () => {
    const annual = pkg({ trialDays: null, winBackOffer: offer({ periodUnit: "YEAR", periodNumberOfUnits: 1 }) });
    expect(planLabel(annual)).toEqual({
      title: "Yearly",
      price: "1 year for $9.99",
      detail: "Then $29.99/year",
      badge: "Welcome back",
    });
    expect(purchaseButtonLabel(annual)).toBe("Continue with offer");
    const terms = purchaseTerms(annual);
    expect(terms).toMatch(/^Welcome-back offer: 1 year for \$9\.99, then \$29\.99\/year\. /);
    expect(terms).toContain("Renews automatically at $29.99/year until you cancel.");

    const monthly = pkg({ id: "$rc_monthly", kind: "monthly", priceString: "$4.99", winBackOffer: offer() });
    expect(planLabel(monthly)).toMatchObject({ title: "Monthly", detail: "Then $4.99/month", badge: "Welcome back" });
  });

  it.each([
    ["an unknown period", { periodUnit: "FORTNIGHT" }],
    ["zero cycles", { cycles: 0 }],
    ["fractional cycles", { cycles: 1.5 }],
    ["zero period units", { periodNumberOfUnits: 0 }],
    ["a negative price", { price: -1 }],
    ["a NaN price", { price: Number.NaN }],
    ["no price string", { priceString: "" }],
    ["a blank price string", { priceString: "  " }],
    ["free over several cycles", { price: 0, cycles: 3 }],
    ["no period", { periodUnit: undefined }],
    ["no period length", { periodNumberOfUnits: undefined }],
    ["negative cycles", { cycles: -1 }],
    ["no price", { price: undefined }],
  ])("ignores a malformed offer (%s): the plain plan, trial and terms stay", (_why, bad) => {
    const plan = pkg({ trialDays: 7, winBackOffer: offer(bad as Partial<WinBackOffer>) });
    expect(shownWinBackOffer(plan)).toBeNull();
    expect(planLabel(plan)).toEqual(planLabel(pkg({ trialDays: 7 })));
    expect(purchaseButtonLabel(plan)).toBe("Start 7-day free trial");
    expect(purchaseTerms(plan)).toBe(purchaseTerms(pkg({ trialDays: 7 })));
  });

  it("never shows an offer on lifetime", () => {
    const lifetime = pkg({ id: "$rc_lifetime", kind: "lifetime", priceString: "$59.99", winBackOffer: offer() });
    expect(shownWinBackOffer(lifetime)).toBeNull();
    expect(purchaseButtonLabel(lifetime)).toBe("Buy lifetime");
    expect(purchaseTerms(lifetime)).toBe("One-time payment of $59.99. No subscription.");
    expect(planLabel(lifetime).badge).not.toBe("Welcome back");
    expect(shownWinBackOffer(null)).toBeNull();
  });
});
