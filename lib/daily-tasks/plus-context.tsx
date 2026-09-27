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
  /**
   * RevenueCat has answered this launch, or stopped being waited for (after
   * CHECK_TIMEOUT_MS the user is treated by what we know, i.e. as free).
   */
  entitlementKnown: boolean;
  paywallSource: PaywallSource | null;
  /** A purchase is in flight (it may outlive the sheet that started it). */
  purchasing: boolean;
  /** Bumped after each completed purchase (drives the thank-you note). */
  purchaseCount: number;
  /** Returns false when it didn't open (no paywall, or one is already up). */
  openPaywall: (source: PaywallSource) => boolean;
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
  purchasing: false,
  purchaseCount: 0,
  openPaywall: () => false,
  closePaywall: () => {},
  markPaywallShown: () => {},
  loadPackages: async () => [],
  purchase: async () => "failed",
  restore: async () => null,
};

const PlusContext = createContext<PlusContextValue>(noPaywall);

/** How long gates wait for RevenueCat's first answer before treating the user as free. */
export const CHECK_TIMEOUT_MS = 6000;
/** A paywall request iOS hasn't presented after this long is considered failed. */
const PRESENT_TIMEOUT_MS = 2500;

export function PlusProvider({ children }: { children: React.ReactNode }) {
  const [paywallBuild] = useState(() => isPaywallConfigured());
  const [paywallEnabled] = useState(() => paywallBuild && configurePurchases());
  const [entitlementActive, setEntitlementActive] = useState(false);
  const [entitlementAnswered, setEntitlementAnswered] = useState(!paywallEnabled);
  const [checkTimedOut, setCheckTimedOut] = useState(false);
  const entitlementKnown = entitlementAnswered || checkTimedOut;
  const [paywallSource, setPaywallSource] = useState<PaywallSource | null>(null);
  const sourceRef = useRef<PaywallSource | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const purchasingRef = useRef(false);
  const [purchaseCount, setPurchaseCount] = useState(0);

  // Don't wait for RevenueCat forever: if it can't be reached (blocked domain,
  // outage) stop treating the user as "maybe Plus" after a few seconds. A late
  // answer still updates everything.
  useEffect(() => {
    if (!paywallEnabled) return;
    const timer = setTimeout(() => setCheckTimedOut(true), CHECK_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [paywallEnabled]);

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
        setEntitlementAnswered(true);
      });
    void refresh();
    const unsubscribe = onPlusChange((active) => {
      if (cancelled) return;
      setEntitlementActive(active);
      setEntitlementAnswered(true);
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

  // iOS can refuse to present the sheet (another modal still up). We never
  // close a paywall on a timer (that could hide one the user is reading);
  // instead the NEXT open replaces a request that wasn't shown in time.
  const shownRef = useRef(false);
  const openedAt = useRef(0);
  const reopenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (reopenTimer.current) clearTimeout(reopenTimer.current);
    },
    [],
  );

  const openPaywall = useCallback(
    (source: PaywallSource): boolean => {
      if (!paywallEnabled) return false;
      if (sourceRef.current) {
        const stale = !shownRef.current && Date.now() - openedAt.current > PRESENT_TIMEOUT_MS;
        if (!stale) return false;
        // Hide the failed request first so the Modal sees visible go false → true.
        sourceRef.current = null;
        setPaywallSource(null);
        if (reopenTimer.current) clearTimeout(reopenTimer.current);
        reopenTimer.current = setTimeout(() => {
          reopenTimer.current = null;
          // Something else opened in the 60 ms gap: let that one stand.
          if (sourceRef.current) return;
          sourceRef.current = source;
          shownRef.current = false;
          openedAt.current = Date.now();
          setPaywallSource(source);
        }, 60);
        return true;
      }
      sourceRef.current = source;
      shownRef.current = false;
      openedAt.current = Date.now();
      setPaywallSource(source);
      return true;
    },
    [paywallEnabled],
  );

  // Only the Modal's onShow proves iOS presented it (onLayout fires even when
  // presentation was refused). If onShow never came, the only cost is a later
  // open replacing the request; nothing can be opened while one is visible.
  const markPaywallShown = useCallback(() => {
    if (!sourceRef.current || shownRef.current) return;
    shownRef.current = true;
    track("paywall_viewed", { source: sourceRef.current });
  }, []);

  const closePaywall = useCallback(() => {
    if (!sourceRef.current) return;
    if (shownRef.current) track("paywall_closed", { source: sourceRef.current });
    sourceRef.current = null;
    shownRef.current = false;
    setPaywallSource(null);
  }, []);
  const closePaywallRef = useRef(closePaywall);
  closePaywallRef.current = closePaywall;

  const purchase = useCallback(async (pkg: PlusPackage): Promise<PurchaseOutcome> => {
    // RevenueCat rejects a second purchase while one is running.
    if (purchasingRef.current) return "pending";
    purchasingRef.current = true;
    setPurchasing(true);
    const source = sourceRef.current ?? "settings";
    track("purchase_started", { plan: pkg.kind, source });
    const result = await purchasePackage(pkg.id).finally(() => {
      purchasingRef.current = false;
      setPurchasing(false);
    });
    if (result.active) {
      setEntitlementActive(true);
      setEntitlementAnswered(true);
    }
    if (result.outcome === "purchased") {
      setPurchaseCount((count) => count + 1);
      // Also covers a paywall reopened while this purchase was running.
      closePaywallRef.current();
    }
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
    if (active) {
      setEntitlementActive(true);
      setEntitlementAnswered(true);
    }
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
      purchasing,
      purchaseCount,
      openPaywall,
      closePaywall,
      markPaywallShown,
      loadPackages,
      purchase,
      restore,
    }),
    [paywallBuild, paywallEnabled, entitlementActive, entitlementKnown, paywallSource, purchasing, purchaseCount, openPaywall, closePaywall, markPaywallShown, purchase, restore],
  );

  return <PlusContext.Provider value={value}>{children}</PlusContext.Provider>;
}

export function usePlus(): PlusContextValue {
  return useContext(PlusContext);
}
