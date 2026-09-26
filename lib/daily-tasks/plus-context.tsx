// App-wide Plus state: whether this build has a paywall, the RevenueCat
// entitlement, and which paywall (if any) is open.
//
// This provider sits OUTSIDE DailyTasksProvider so the store can combine the
// entitlement with its own grandfathering flag (see hasPlusAccess). Without a
// provider (e.g. in tests) the defaults mean "no paywall", i.e. full access.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState as RNAppState } from "react-native";

import { flush, track } from "./analytics";
import type { PaywallSource, PlusPackage } from "./plus";
import {
  configurePurchases,
  fetchPlusActive,
  isPaywallConfigured,
  loadPackages,
  onPlusChange,
  purchase as purchasePackage,
  restore as restorePurchases,
  type PurchaseOutcome,
} from "./purchases";

export interface PlusContextValue {
  /** This build ships with a RevenueCat key (a "paywall build"). */
  paywallBuild: boolean;
  /** This build has a working paywall (RevenueCat configured). */
  paywallEnabled: boolean;
  /** RevenueCat says the Plus entitlement is active. */
  entitlementActive: boolean;
  /** The entitlement has been checked at least once this launch. */
  entitlementKnown: boolean;
  paywallSource: PaywallSource | null;
  openPaywall: (source: PaywallSource) => void;
  closePaywall: () => void;
  loadPackages: () => Promise<PlusPackage[]>;
  purchase: (pkg: PlusPackage) => Promise<PurchaseOutcome>;
  restore: () => Promise<boolean | null>;
}

const noPaywall: PlusContextValue = {
  paywallBuild: false,
  paywallEnabled: false,
  entitlementActive: false,
  entitlementKnown: true,
  paywallSource: null,
  openPaywall: () => {},
  closePaywall: () => {},
  loadPackages: async () => [],
  purchase: async () => "failed",
  restore: async () => null,
};

const PlusContext = createContext<PlusContextValue>(noPaywall);

export function PlusProvider({ children }: { children: React.ReactNode }) {
  const [paywallBuild] = useState(() => isPaywallConfigured());
  const [paywallEnabled] = useState(() => paywallBuild && configurePurchases());
  const [entitlementActive, setEntitlementActive] = useState(false);
  const [entitlementKnown, setEntitlementKnown] = useState(!paywallEnabled);
  const [paywallSource, setPaywallSource] = useState<PaywallSource | null>(null);
  const sourceRef = useRef<PaywallSource | null>(null);

  useEffect(() => {
    if (!paywallEnabled) return;
    let cancelled = false;
    const refresh = () =>
      fetchPlusActive().then((active) => {
        if (cancelled) return;
        // null = couldn't check; keep what we had (RevenueCat caches offline).
        if (active !== null) setEntitlementActive(active);
        setEntitlementKnown(true);
      });
    void refresh();
    const unsubscribe = onPlusChange((active) => {
      if (!cancelled) setEntitlementActive(active);
    });
    // Expiry or a refund made elsewhere shows up the next time the app opens.
    const sub = RNAppState.addEventListener("change", (status) => {
      if (status === "active") void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
      sub.remove();
    };
  }, [paywallEnabled]);

  // Send queued analytics when the app goes to the background.
  useEffect(() => {
    const sub = RNAppState.addEventListener("change", (status) => {
      if (status === "background") void flush();
    });
    return () => sub.remove();
  }, []);

  const openPaywall = useCallback(
    (source: PaywallSource) => {
      if (!paywallEnabled || sourceRef.current) return;
      sourceRef.current = source;
      setPaywallSource(source);
      track("paywall_viewed", { source });
    },
    [paywallEnabled],
  );

  const closePaywall = useCallback(() => {
    if (!sourceRef.current) return;
    track("paywall_closed", { source: sourceRef.current });
    sourceRef.current = null;
    setPaywallSource(null);
  }, []);

  const purchase = useCallback(async (pkg: PlusPackage) => {
    const source = sourceRef.current ?? "settings";
    track("purchase_started", { plan: pkg.kind, source });
    const result = await purchasePackage(pkg.id);
    if (result.active) setEntitlementActive(true);
    track(result.outcome === "purchased" ? "purchase_completed" : "purchase_failed", {
      plan: pkg.kind,
      source,
      outcome: result.outcome,
      trial: pkg.trialDays != null,
    });
    return result.outcome;
  }, []);

  const restore = useCallback(async () => {
    const active = await restorePurchases();
    if (active) setEntitlementActive(true);
    track("restore_completed", { active: active === true, outcome: active === null ? "failed" : "ok" });
    return active;
  }, []);

  const value = useMemo<PlusContextValue>(
    () => ({
      paywallBuild,
      paywallEnabled,
      entitlementActive,
      entitlementKnown,
      paywallSource,
      openPaywall,
      closePaywall,
      loadPackages,
      purchase,
      restore,
    }),
    [paywallBuild, paywallEnabled, entitlementActive, entitlementKnown, paywallSource, openPaywall, closePaywall, purchase, restore],
  );

  return <PlusContext.Provider value={value}>{children}</PlusContext.Provider>;
}

export function usePlus(): PlusContextValue {
  return useContext(PlusContext);
}
