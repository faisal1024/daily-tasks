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
import { shownWinBackOffer, trialReminderEnd, type PaywallSource, type PlusPackage, type PlusTrial } from "./plus";
import {
  configurePurchases,
  fetchPlusStatus,
  isPaywallConfigured,
  loadPackages as loadSdkPackages,
  onPlusStatusChange,
  type PlusStatus,
  purchase as purchasePackage,
  redeemCode as presentRedeemSheet,
  restore as restorePurchases,
  type PurchaseOutcome,
} from "./purchases";
import { setTrialActiveForUses } from "./trial-note";
import { syncTrialReminder } from "./trial-reminder";

// Win-back, per lapse (keyed by its expiry), at most two showings:
// 1. the plain one, once, 2+ days after the lapse (whatever Apple offers then);
// 2. later, one more, only once Apple has a win-back offer for this subscriber
//    (Apple's eligibility usually needs a longer lapse), checked at most once a day.
// Seeing the offer on any paywall spends the second showing.
export const WIN_BACK_KEY = "daily-tasks/plus-win-back-offered-for";
export const WIN_BACK_OFFER_KEY = "daily-tasks/plus-win-back-offer-shown-for";
export const WIN_BACK_CHECK_KEY = "daily-tasks/plus-win-back-offer-checked";
/** Let a lapse settle before offering Plus back (people who just cancelled meant it). */
export const WIN_BACK_DELAY_MS = 2 * 24 * 60 * 60_000;
/** paywall_viewed is sent by now even if the offer lookup hasn't answered. */
export const VIEWED_CAP_MS = 3000;

/** The day an offer was last looked for, for which lapse. */
interface OfferCheck {
  lapse: string;
  day: string;
}

function parseOfferCheck(raw: string | null): OfferCheck | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OfferCheck>;
    return typeof parsed?.lapse === "string" && typeof parsed.day === "string"
      ? { lapse: parsed.lapse, day: parsed.day }
      : null;
  } catch {
    return null;
  }
}
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
  /**
   * Returns false when it didn't open (no paywall, or one is already up).
   * `taskCount`: what first run set, for the onboarding headline.
   */
  openPaywall: (source: PaywallSource, details?: { taskCount?: number }) => boolean;
  /** Tasks first run set, passed with openPaywall("onboarding"); undefined otherwise. */
  paywallTaskCount: number | undefined;
  /** The paywall's "Prefer to start small? Monthly…" line was tapped. */
  trackMonthlyNudge: () => void;
  closePaywall: () => void;
  /** The paywall sheet reports that iOS actually presented it. */
  markPaywallShown: () => void;
  /** The open paywall's plans (with a win-back offer lookup for a lapsed subscriber). */
  loadPaywallPackages: () => Promise<PlusPackage[]>;
  purchase: (pkg: PlusPackage) => Promise<PurchaseOutcome>;
  restore: () => Promise<boolean | null>;
  /** Ask for Apple's offer-code sheet. False when it can't be requested here. */
  redeemCode: () => Promise<boolean>;
  /** Plus lapsed over two days ago and this lapse hasn't been offered back yet. */
  winBackDue: boolean;
  /**
   * The plain win-back was shown and no offer has been yet this lapse: at the
   * next small win, call checkWinBackOffer (it looks at most once a day).
   */
  winBackOfferPending: boolean;
  /**
   * Today's one look for an Apple win-back offer (recorded before it runs).
   * True when one is available: open the win_back paywall again.
   */
  checkWinBackOffer: () => Promise<boolean>;
  /** The free trial of Plus this install is in (for the day-5 note), or null. */
  trial: PlusTrial | null;
  /** What the aha paywall rule needs; null while loading or unreadable (no offer). */
  ahaPaywallState: AhaPaywallState | null;
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
  paywallTaskCount: undefined,
  trackMonthlyNudge: () => {},
  closePaywall: () => {},
  markPaywallShown: () => {},
  loadPaywallPackages: async () => [],
  purchase: async () => "failed",
  restore: async () => null,
  redeemCode: async () => false,
  winBackDue: false,
  winBackOfferPending: false,
  checkWinBackOffer: async () => false,
  trial: null,
  ahaPaywallState: null,
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
  const [paywallTaskCount, setPaywallTaskCount] = useState<number | undefined>(undefined);
  const sourceRef = useRef<PaywallSource | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const purchasingRef = useRef(false);
  const [purchaseCount, setPurchaseCount] = useState(0);
  const [lapsedAt, setLapsedAt] = useState<string | null>(null);
  const [trial, setTrial] = useState<PlusTrial | null>(null);
  // The win-back flags (see WIN_BACK_KEY), read once at launch. Nothing is due
  // until they're read (or unreadable), so a spent showing isn't repeated.
  const [winBack, setWinBack] = useState<{
    loaded: boolean;
    offeredFor: string | null;
    offerShownFor: string | null;
    check: OfferCheck | null;
  }>({ loaded: false, offeredFor: null, offerShownFor: null, check: null });
  const winBackRef = useRef(winBack);
  winBackRef.current = winBack;
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      AsyncStorage.getItem(WIN_BACK_KEY),
      AsyncStorage.getItem(WIN_BACK_OFFER_KEY),
      AsyncStorage.getItem(WIN_BACK_CHECK_KEY),
    ])
      .then(([offeredFor, offerShownFor, check]) => ({ offeredFor, offerShownFor, check: parseOfferCheck(check) }))
      .catch(() => ({ offeredFor: null, offerShownFor: null, check: null }))
      .then((loaded) => {
        if (cancelled) return;
        // Something marked while loading wins over the stored value.
        setWinBack((current) => ({
          loaded: true,
          offeredFor: current.offeredFor ?? loaded.offeredFor,
          offerShownFor: current.offerShownFor ?? loaded.offerShownFor,
          check: current.check ?? loaded.check,
        }));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const markWinBack = useCallback((field: "offeredFor" | "offerShownFor", lapse: string) => {
    if (winBackRef.current[field] === lapse) return;
    const next = { ...winBackRef.current, [field]: lapse };
    winBackRef.current = next;
    setWinBack(next);
    void AsyncStorage.setItem(field === "offeredFor" ? WIN_BACK_KEY : WIN_BACK_OFFER_KEY, lapse).catch(() => {});
  }, []);
  const winBackDue =
    winBack.loaded &&
    lapsedAt !== null &&
    !entitlementActive &&
    winBack.offeredFor !== lapsedAt &&
    Date.now() - Date.parse(lapsedAt) >= WIN_BACK_DELAY_MS;
  const winBackOfferPending =
    winBack.loaded &&
    lapsedAt !== null &&
    !entitlementActive &&
    winBack.offeredFor === lapsedAt &&
    winBack.offerShownFor !== lapsedAt;
  const [ahaPaywallState, setAhaPaywallState] = useState<AhaPaywallState | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadAhaState().then((loaded) => {
      if (cancelled || !loaded) return;
      // A paywall shown while this was loading already updated the state: keep that.
      setAhaPaywallState((current) =>
        current
          ? {
              installDay: loaded.installDay,
              ahaShown: current.ahaShown || loaded.ahaShown,
              // The later of the two: a stored time can be newer (e.g. a clock change).
              lastPaywallShownAt:
                current.lastPaywallShownAt === null
                  ? loaded.lastPaywallShownAt
                  : loaded.lastPaywallShownAt === null
                    ? current.lastPaywallShownAt
                    : Math.max(current.lastPaywallShownAt, loaded.lastPaywallShownAt),
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
  const entitlementRef = useRef(false);
  entitlementRef.current = entitlementActive;

  // One place applies what RevenueCat says: entitlement, lapse, trial reminder.
  const applyStatus = useCallback((status: PlusStatus) => {
    setEntitlementActive(status.active);
    setEntitlementAnswered(true);
    setLapsedAt(status.active ? null : status.lapsedAt);
    const trialNow = status.active ? (status.trial ?? null) : null;
    setTrial(trialNow);
    // Plus uses are only counted (for the day-5 note) during a free trial.
    setTrialActiveForUses(trialNow !== null);
    // A heads-up two days before a free trial that will renew ends (cleared otherwise).
    void syncTrialReminder(trialReminderEnd(trialNow));
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
  // Each open gets a number. For a lapsed subscriber the paywall looks up an
  // Apple win-back offer; paywall_viewed waits for that answer (at most
  // VIEWED_CAP_MS) so it can say whether the offer was on screen. The open
  // decides once whether it's a lapsed subscriber's (so whether its plans
  // look for an offer); loading, reloading and marking follow that decision.
  const openSeq = useRef(0);
  const offerLookup = useRef<{
    seq: number;
    lapse: string;
    offer: boolean | null;
    viewPending: boolean;
  } | null>(null);
  const viewedCapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearViewedCap = useCallback(() => {
    if (viewedCapTimer.current) clearTimeout(viewedCapTimer.current);
    viewedCapTimer.current = null;
  }, []);
  const beginOpen = useCallback((source: PaywallSource, taskCount: number | undefined) => {
    sourceRef.current = source;
    shownRef.current = false;
    openedAt.current = Date.now();
    openSeq.current += 1;
    clearViewedCap();
    const lapse = lapsedRef.current;
    offerLookup.current = lapse ? { seq: openSeq.current, lapse, offer: null, viewPending: false } : null;
    setPaywallTaskCount(taskCount);
    setPaywallSource(source);
  }, [clearViewedCap]);
  const trackViewed = useCallback(
    (source: PaywallSource, offer: boolean | null) => {
      clearViewedCap();
      track("paywall_viewed", offer === null ? { source } : { source, offer });
      // An offer on screen spends this lapse's offer showing (from any paywall).
      const lapse = offerLookup.current?.lapse;
      if (offer && lapse) markWinBack("offerShownFor", lapse);
    },
    [markWinBack, clearViewedCap],
  );
  const reopenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (reopenTimer.current) clearTimeout(reopenTimer.current);
      clearViewedCap();
    },
    [clearViewedCap],
  );

  const openPaywall = useCallback(
    (source: PaywallSource, details: { taskCount?: number } = {}): boolean => {
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
          beginOpen(source, details.taskCount);
        }, 60);
        return true;
      }
      beginOpen(source, details.taskCount);
      return true;
    },
    [paywallEnabled, beginOpen],
  );

  // Only the Modal's onShow proves iOS presented it (onLayout fires even when
  // presentation was refused). If onShow never came, the only cost is a later
  // open replacing the request; nothing can be opened while one is visible.
  const markPaywallShown = useCallback(() => {
    if (!sourceRef.current || shownRef.current) return;
    shownRef.current = true;
    const source = sourceRef.current;
    const lookup = offerLookup.current;
    if (lookup && lookup.seq === openSeq.current && lookup.offer === null) {
      lookup.viewPending = true;
      // Never hold paywall_viewed back for long: a hung lookup counts as no offer.
      clearViewedCap();
      viewedCapTimer.current = setTimeout(() => {
        viewedCapTimer.current = null;
        if (!lookup.viewPending || offerLookup.current !== lookup || !sourceRef.current) return;
        lookup.viewPending = false;
        lookup.offer = false;
        trackViewed(sourceRef.current, false);
      }, VIEWED_CAP_MS);
    } else trackViewed(source, lookup ? lookup.offer : null);
    // Any paywall shown starts the aha paywall's 24-hour gap; the aha one is once per install.
    const now = Date.now();
    void AsyncStorage.setItem(LAST_PAYWALL_KEY, String(now)).catch(() => {});
    if (source === "aha") void AsyncStorage.setItem(AHA_SHOWN_KEY, "1").catch(() => {});
    setAhaPaywallState((current) =>
      current
        ? { ...current, lastPaywallShownAt: now, ahaShown: current.ahaShown || source === "aha" }
        : // Still loading: no install day yet (so no offer); the load fills it in.
          { installDay: "", lastPaywallShownAt: now, ahaShown: source === "aha" },
    );
    // A win-back showing counts as used only once iOS has actually shown it:
    // the first (plain) one here; the later offer one only with an offer on
    // screen (marked by trackViewed, or when a late lookup finds one).
    const lapse = lookup?.lapse ?? lapsedRef.current;
    if (source === "win_back" && lapse && winBackRef.current.offeredFor !== lapse) {
      markWinBack("offeredFor", lapse);
    }
  }, [trackViewed, markWinBack, clearViewedCap]);

  const closePaywall = useCallback(() => {
    if (!sourceRef.current) return;
    // Closed before the offer lookup answered: no offer was on screen.
    const lookup = offerLookup.current;
    if (lookup?.viewPending) {
      lookup.viewPending = false;
      lookup.offer = false;
      trackViewed(sourceRef.current, false);
    }
    offerLookup.current = null;
    clearViewedCap();
    if (shownRef.current) track("paywall_closed", { source: sourceRef.current });
    sourceRef.current = null;
    shownRef.current = false;
    setPaywallSource(null);
    setPaywallTaskCount(undefined);
  }, [trackViewed, clearViewedCap]);
  const trackMonthlyNudge = useCallback(() => {
    if (sourceRef.current) track("paywall_monthly_nudge_tapped", { source: sourceRef.current });
  }, []);

  const closePaywallRef = useRef(closePaywall);
  closePaywallRef.current = closePaywall;

  // A lapsed subscriber's paywall (decided when it opened) also asks Apple
  // for a win-back offer; a reload (e.g. after a failed offer purchase) asks again.
  const loadPaywallPackages = useCallback(async (): Promise<PlusPackage[]> => {
    const seq = openSeq.current;
    const forOpen = offerLookup.current?.seq === seq ? offerLookup.current : null;
    const settle = (offer: boolean) => {
      const lookup = offerLookup.current;
      if (!lookup || lookup.seq !== seq) return;
      lookup.offer = offer;
      if (lookup.viewPending && sourceRef.current) {
        lookup.viewPending = false;
        trackViewed(sourceRef.current, offer);
      } else if (offer && shownRef.current && sourceRef.current) {
        // Found after paywall_viewed went out (capped wait, or a reload): still on screen.
        markWinBack("offerShownFor", lookup.lapse);
      }
    };
    if (!forOpen) return loadSdkPackages();
    try {
      const packages = await loadSdkPackages({ winBack: true });
      settle(packages.some((pkg) => shownWinBackOffer(pkg) !== null));
      return packages;
    } catch (error) {
      settle(false);
      throw error;
    }
  }, [trackViewed, markWinBack]);

  // Today's one look for a win-back offer (see WIN_BACK_KEY). Recorded first,
  // so a slow or failed answer still counts as today's check.
  const checking = useRef(false);
  const checkWinBackOffer = useCallback(async (): Promise<boolean> => {
    const lapse = lapsedRef.current;
    const flags = winBackRef.current;
    const today = todayKey();
    if (!paywallEnabled || checking.current || !lapse || entitlementRef.current || !flags.loaded) return false;
    if (flags.offeredFor !== lapse || flags.offerShownFor === lapse) return false;
    if (flags.check?.lapse === lapse && flags.check.day === today) return false;
    // Not while a paywall is up (its plans would be replaced under it).
    if (sourceRef.current) return false;
    checking.current = true;
    const check = { lapse, day: today };
    const next = { ...flags, check };
    winBackRef.current = next;
    setWinBack(next);
    void AsyncStorage.setItem(WIN_BACK_CHECK_KEY, JSON.stringify(check)).catch(() => {});
    try {
      const packages = await loadSdkPackages({ winBack: true });
      // Still the same lapse, still free, and nothing else opened meanwhile.
      return (
        lapsedRef.current === lapse &&
        !entitlementRef.current &&
        packages.some((pkg) => shownWinBackOffer(pkg) !== null)
      );
    } catch {
      return false;
    } finally {
      checking.current = false;
    }
  }, [paywallEnabled]);

  const purchase = useCallback(async (pkg: PlusPackage): Promise<PurchaseOutcome> => {
    // RevenueCat rejects a second purchase while one is running.
    if (purchasingRef.current) return "pending";
    purchasingRef.current = true;
    setPurchasing(true);
    const source = sourceRef.current ?? "settings";
    // Bought with an Apple win-back offer (shown on the plan): marked offer: true.
    const withOffer = shownWinBackOffer(pkg) !== null;
    const offer = withOffer ? { offer: true } : {};
    track("purchase_started", { plan: pkg.kind, source, ...offer });
    const buying = withOffer ? purchasePackage(pkg.id, { winBack: true }) : purchasePackage(pkg.id);
    const result = await buying.finally(() => {
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
      track("purchase_cancelled", { plan: pkg.kind, source, trial: pkg.trialDays != null, ...offer });
    } else {
      track(result.outcome === "purchased" ? "purchase_completed" : "purchase_failed", {
        plan: pkg.kind,
        source,
        outcome: result.outcome,
        trial: pkg.trialDays != null,
        ...offer,
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
      paywallTaskCount,
      trackMonthlyNudge,
      closePaywall,
      markPaywallShown,
      loadPaywallPackages,
      purchase,
      restore,
      redeemCode,
      winBackDue,
      winBackOfferPending,
      checkWinBackOffer,
      trial,
      ahaPaywallState,
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
      paywallTaskCount,
      trackMonthlyNudge,
      closePaywall,
      markPaywallShown,
      loadPaywallPackages,
      purchase,
      restore,
      redeemCode,
      winBackDue,
      winBackOfferPending,
      checkWinBackOffer,
      trial,
      ahaPaywallState,
    ],
  );

  return <PlusContext.Provider value={value}>{children}</PlusContext.Provider>;
}

export function usePlus(): PlusContextValue {
  return useContext(PlusContext);
}
