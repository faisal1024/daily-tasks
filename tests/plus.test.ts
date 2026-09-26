// Momentum Plus (Phase 4): who has access, grandfathering of saved state, and
// the paywall's plan labels and legal terms.
import { describe, expect, it } from "vitest";

import {
  defaultPackageId,
  freeTrialDays,
  hasPlusAccess,
  planLabel,
  purchaseTerms,
  type PlusPackage,
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
      detail: "Just $2.49/month",
      badge: "7-day free trial",
    });
  });

  it("states the renewal price and period by the button (with and without a trial), and no renewal for lifetime", () => {
    const trial = purchaseTerms(pkg({ trialDays: 7 }));
    expect(trial).toMatch(/^Free for 7 days, then \$29\.99\/year\./);
    expect(trial).toContain("Renews automatically at $29.99/year until you cancel.");
    expect(purchaseTerms(pkg({ kind: "monthly", priceString: "$4.99" }))).toContain(
      "Renews automatically at $4.99/month",
    );
    const lifetime = purchaseTerms(pkg({ kind: "lifetime", priceString: "$59.99" }));
    expect(lifetime).toContain("One-time payment of $59.99");
    expect(lifetime).not.toMatch(/Renews/);
  });
});
