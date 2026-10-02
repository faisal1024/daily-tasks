// App-wide Plus state: whether this build has a paywall, the RevenueCat
// entitlement, and which paywall (if any) is open.
//
// This provider sits OUTSIDE DailyTasksProvider so the store can combine the
// entitlement with its own grandfathering flag (see hasPlusAccess). Without a
// provider (e.g. in tests) the defaults mean "no paywall", i.e. full access.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState as RNAppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AhaPaywallState } from "./aha-paywall";
import { flush, track } from "./analytics";
import { todayKey } from "./date";
import type { PaywallSource, PlusPackage } from "./plus";
import {
  configurePurchases,
  fetchPlusStatus,
  isPaywallConfigured,
  loadPackages,
  onPlusStatusChange,
  type PlusStatus,
  purchase as purchasePackage,
  redeemCode as presentRedeemSheet,
  restore as restorePurchases,
  type PurchaseOutcome,
} from "./purchases";
import { syncTrialReminder } from "./trial-reminder";

// Win-back: which lapse (by its expiry) was already offered, so each is offered once.
const WIN_BACK_KEY = "daily-tasks/plus-win-back-offered-for";
/** Let a lapse settle before offering Plus back (people who just cancelled meant it). */
export const WIN_BACK_DELAY_MS = 2 * 24 * 60 * 60_000;
// The aha paywall (aha-paywall.ts): first launch day, once-per-install flag,
// and when any paywall was last shown. Own keys, so "Reset all data" keeps them.
export const INSTALL_DAY_KEY = "daily-tasks/install-day";
export const AHA_SHOWN_KEY = "daily-tasks/plus-aha-shown";
export const LAST_PAYWALL_KEY = "daily-tasks/plus-last-paywall-shown-at";

/** Read (and on the very first launch, record) what the aha rule needs. Null on a storage error. */
async function loadAhaState(): Promise<AhaPaywallState | null> {
  try {
    const [installDay, shown, last] = await Promise.all([
      AsyncStorage.getItem(INSTALL_DAY_KEY),
      AsyncStorage.getItem(AHA_SHOWN_KEY),
      AsyncStorage.getItem(LAST_PAYWALL_KEY),
    ]);
    let day = installDay;
    if (!day) {
      day = todayKey();
      await AsyncStorage.setItem(INSTALL_DAY_KEY, day);
    }
    const lastAt = last === null ? null : Number(last);
    return {
      installDay: day,
      ahaShown: shown !== null,
      // Unreadable counts as "just now" (fail closed: no aha paywall yet).
      lastPaywallShownAt: lastAt === null ? null : Number.isFinite(lastAt) ? lastAt : Date.now(),
    };
  } catch {
    return null;
  }
}

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
  /** Ask for Apple's offer-code sheet. False when it can't be requested here. */
  redeemCode: () => Promise<boolean>;
  /** Plus lapsed over two days ago and this lapse hasn't been offered back yet. */
  winBackDue: boolean;
  /** What the aha paywall rule needs; null while loading or unreadable (no offer). */
  ahaPaywall: AhaPaywallState | null;
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
  redeemCode: async () => false,
  winBackDue: false,
  ahaPaywall: null,
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
  const [lapsedAt, setLapsedAt] = useState<string | null>(null);
  const [offeredFor, setOfferedFor] = useState<string | null>(null);
  useEffect(() => {
    AsyncStorage.getItem(WIN_BACK_KEY)
      .then((value) => setOfferedFor(value))
      .catch(() => {});
  }, []);
  const winBackDue =
    lapsedAt !== null &&
    !entitlementActive &&
    offeredFor !== lapsedAt &&
    Date.now() - Date.parse(lapsedAt) >= WIN_BACK_DELAY_MS;
  const [ahaPaywall, setAhaPaywall] = useState<AhaPaywallState | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadAhaState().then((loaded) => {
      if (cancelled || !loaded) return;
      // A paywall shown while this was loading already updated the state: keep that.
      setAhaPaywall((current) =>
        current
          ? {
              installDay: loaded.installDay,
              ahaShown: current.ahaShown || loaded.ahaShown,
              lastPaywallShownAt: current.lastPaywallShownAt ?? loaded.lastPaywallShownAt,
            }
          : loaded,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const lapsedRef = useRef<string | null>(null);
  lapsedRef.current = lapsedAt;

  // One place applies what RevenueCat says: entitlement, lapse, trial reminder.
  const applyStatus = useCallback((status: PlusStatus) => {
    setEntitlementActive(status.active);
    setEntitlementAnswered(true);
    setLapsedAt(status.active ? null : status.lapsedAt);
    // A heads-up two days before a free trial ends (cleared otherwise).
    void syncTrialReminder(status.trialEndsAt);
  }, []);

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
      fetchPlusStatus().then((status) => {
        if (cancelled) return;
        // null = couldn't check: stay "unknown" (so a subscriber is never shown
        // the paywall by mistake) and try again on the next foreground.
        if (status === null) return;
        applyStatus(status);
      });
    void refresh();
    const unsubscribe = onPlusStatusChange((status) => {
      if (cancelled) return;
      applyStatus(status);
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
  }, [paywallEnabled, applyStatus]);

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
    const source = sourceRef.current;
    track("paywall_viewed", { source });
    // Any paywall shown starts the aha paywall's 24-hour gap; the aha one is once per install.
    const now = Date.now();
    void AsyncStorage.setItem(LAST_PAYWALL_KEY, String(now)).catch(() => {});
    if (source === "aha") void AsyncStorage.setItem(AHA_SHOWN_KEY, "1").catch(() => {});
    setAhaPaywall((current) =>
      current
        ? { ...current, lastPaywallShownAt: now, ahaShown: current.ahaShown || source === "aha" }
        : // Still loading: no install day yet (so no offer); the load fills it in.
          { installDay: "", lastPaywallShownAt: now, ahaShown: source === "aha" },
    );
    // The win-back offer counts as used only once iOS has actually shown it.
    const lapse = lapsedRef.current;
    if (sourceRef.current === "win_back" && lapse) {
      setOfferedFor(lapse);
      void AsyncStorage.setItem(WIN_BACK_KEY, lapse).catch(() => {});
    }
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
      setLapsedAt(null);
      // A trial just started: schedule its reminder now, not next launch.
      void fetchPlusStatus().then((status) => {
        if (status?.active) applyStatus(status);
      });
    }
    if (result.outcome === "purchased") {
      setPurchaseCount((count) => count + 1);
      // Also covers a paywall reopened while this purchase was running.
      closePaywallRef.current();
    }
    if (result.outcome === "cancelled") {
      // Backed out of Apple's purchase sheet: not an error, a funnel drop-off.
      track("purchase_cancelled", { plan: pkg.kind, source, trial: pkg.trialDays != null });
    } else {
      track(result.outcome === "purchased" ? "purchase_completed" : "purchase_failed", {
        plan: pkg.kind,
        source,
        outcome: result.outcome,
        trial: pkg.trialDays != null,
      });
    }
    return result.outcome;
  }, [applyStatus]);

  const restore = useCallback(async () => {
    const active = await restorePurchases();
    if (active) {
      setEntitlementActive(true);
      setEntitlementAnswered(true);
      setLapsedAt(null);
      void fetchPlusStatus().then((status) => {
        if (status?.active) applyStatus(status);
      });
    }
    track("restore_completed", { active: active === true, outcome: active === null ? "failed" : "ok" });
    return active;
  }, [applyStatus]);

  const redeemCode = useCallback(async () => {
    const shown = await presentRedeemSheet();
    // The code (never its text) is Apple's business; the result comes via the listener.
    track("redeem_code_opened", { outcome: shown ? "requested" : "unavailable" });
    return shown;
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
      redeemCode,
      winBackDue,
      ahaPaywall,
    }),
    [
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
      purchase,
      restore,
      redeemCode,
      winBackDue,
      ahaPaywall,
    ],
  );

  return <PlusContext.Provider value={value}>{children}</PlusContext.Provider>;
}

export function usePlus(): PlusContextValue {
  return useContext(PlusContext);
}
