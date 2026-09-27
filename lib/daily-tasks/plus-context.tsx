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
  /** RevenueCat has answered at least once this launch. */
  entitlementKnown: boolean;
  paywallSource: PaywallSource | null;
  openPaywall: (source: PaywallSource) => void;
  closePaywall: () => void;
  /** The paywall sheet reports that iOS actually presented it. */
  markPaywallShown: () => void;
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
  markPaywallShown: () => {},
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
        // null = couldn't check: stay "unknown" (so a subscriber is never shown
        // the paywall by mistake) and try again on the next foreground.
        if (active === null) return;
        setEntitlementActive(active);
        setEntitlementKnown(true);
      });
    void refresh();
    const unsubscribe = onPlusChange((active) => {
      if (cancelled) return;
      setEntitlementActive(active);
      setEntitlementKnown(true);
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

  // If iOS refuses to present the sheet (another modal is still up), onShow
  // never fires: forget the request so later gates can open it again.
  const shownRef = useRef(false);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearWatchdog = () => {
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
  };
  useEffect(() => clearWatchdog, []);

  const openPaywall = useCallback(
    (source: PaywallSource) => {
      if (!paywallEnabled || sourceRef.current) return;
      sourceRef.current = source;
      shownRef.current = false;
      setPaywallSource(source);
      clearWatchdog();
      watchdog.current = setTimeout(() => {
        watchdog.current = null;
        if (shownRef.current || sourceRef.current !== source) return;
        sourceRef.current = null;
        setPaywallSource(null);
      }, 2500);
    },
    [paywallEnabled],
  );

  const markPaywallShown = useCallback(() => {
    if (!sourceRef.current || shownRef.current) return;
    shownRef.current = true;
    clearWatchdog();
    track("paywall_viewed", { source: sourceRef.current });
  }, []);

  const closePaywall = useCallback(() => {
    if (!sourceRef.current) return;
    if (shownRef.current) track("paywall_closed", { source: sourceRef.current });
    clearWatchdog();
    sourceRef.current = null;
    shownRef.current = false;
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
      markPaywallShown,
      loadPackages,
      purchase,
      restore,
    }),
    [paywallBuild, paywallEnabled, entitlementActive, entitlementKnown, paywallSource, openPaywall, closePaywall, markPaywallShown, purchase, restore],
  );

  return <PlusContext.Provider value={value}>{children}</PlusContext.Provider>;
}

export function usePlus(): PlusContextValue {
  return useContext(PlusContext);
}
