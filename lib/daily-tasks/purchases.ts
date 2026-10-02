// Thin wrapper over RevenueCat (react-native-purchases).
//
// - The paywall only exists when EXPO_PUBLIC_REVENUECAT_IOS_KEY is set at build
//   time. Without it every call here is a no-op and the app behaves exactly as
//   before (everyone has every feature).
// - The native module is loaded lazily inside a try, like app-review.ts: a binary
//   without it degrades to "no paywall" instead of crashing at launch.
// - SDK objects are converted to the plain types in plus.ts right here, so the
//   rest of the app never touches RevenueCat types.

import { Linking, Platform } from "react-native";

import { setProxyUserId, setProxyUserIdPending } from "./ai-client";
import {
  freeTrialDays,
  isUsableWinBackOffer,
  planKind,
  PLUS_ENTITLEMENT,
  type PlusPackage,
  type PlusTrial,
  type WinBackOffer,
} from "./plus";

type PurchasesModule = typeof import("react-native-purchases");
type SdkPackage = import("react-native-purchases").PurchasesPackage;
type SdkCustomerInfo = import("react-native-purchases").CustomerInfo;
type SdkWinBackOffer = import("react-native-purchases").PurchasesWinBackOffer;

/**
 * How long the paywall waits for Apple's win-back eligibility before showing
 * the plain prices (the lookup must never hold the paywall up).
 */
export const WIN_BACK_LOOKUP_MS = 1500;

/** Apple's own subscriptions page (fallback when the SDK can't show the sheet). */
export const MANAGE_SUBSCRIPTIONS_URL = "https://apps.apple.com/account/subscriptions";

/** The public SDK key (safe to ship in the app; it's designed to be public). */
export function getRevenueCatKey(): string | null {
  const key = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.trim();
  return key ? key : null;
}

/** Whether this build has a paywall at all (iOS only for now). */
export function isPaywallConfigured(): boolean {
  return Platform.OS === "ios" && getRevenueCatKey() !== null;
}

function loadSdk(): PurchasesModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("react-native-purchases") as PurchasesModule;
  } catch {
    return null;
  }
}

let configured = false;
// Last packages loaded, keyed by id, so a purchase can hand the SDK its own object.
const sdkPackages = new Map<string, SdkPackage>();

/** Configure the SDK once. Returns false when there's no paywall in this build. */
export function configurePurchases(): boolean {
  if (configured) return true;
  const key = getRevenueCatKey();
  const sdk = loadSdk();
  if (!key || !sdk || Platform.OS !== "ios") return false;
  try {
    // Anonymous RevenueCat id: we never log users in or send personal data.
    sdk.default.configure({ apiKey: key });
    configured = true;
  } catch {
    return false;
  }
  // The proxy checks Plus by this anonymous id (never a name or email).
  // Separate from configure: a failure here must not turn the paywall off.
  refreshProxyUserId(sdk);
  return configured;
}

/** (Re)read RevenueCat's anonymous id for the proxy (at launch, after purchase/restore). */
function refreshProxyUserId(sdk: PurchasesModule | null = loadSdk()): void {
  if (!configured || !sdk) return;
  try {
    const pending = Promise.resolve(sdk.default.getAppUserID())
      .then((id) => setProxyUserId(typeof id === "string" ? id : null))
      .catch(() => {});
    setProxyUserIdPending(pending);
  } catch {
    // No id this launch: requests go without it (per-IP limits only).
  }
}

export function isPlusActive(info: SdkCustomerInfo | null | undefined): boolean {
  return Boolean(info?.entitlements?.active?.[PLUS_ENTITLEMENT]);
}

/**
 * When Plus lapsed (ISO expiry), read from RevenueCat's own record so it
 * holds after a reinstall and can't be fooled by a stale answer: the
 * entitlement exists but isn't active and has expired. Not during a billing
 * retry (a re-purchase would fail as "already subscribed").
 */
export function lapsedAt(info: SdkCustomerInfo | null | undefined, now: number = Date.now()): string | null {
  const entitlement = info?.entitlements?.all?.[PLUS_ENTITLEMENT];
  if (!entitlement || entitlement.isActive || entitlement.billingIssueDetectedAt) return null;
  const expiry = entitlement.expirationDate;
  if (!expiry) return null;
  const at = Date.parse(expiry);
  return Number.isFinite(at) && at < now ? expiry : null;
}

/**
 * The free trial this install is in, cancelled or not. Null when not on a
 * trial, or when the trial is family-shared (only the purchaser can manage it).
 */
export function currentTrial(info: SdkCustomerInfo | null | undefined): PlusTrial | null {
  const entitlement = info?.entitlements?.active?.[PLUS_ENTITLEMENT];
  if (!entitlement || entitlement.periodType !== "TRIAL") return null;
  if (entitlement.ownershipType === "FAMILY_SHARED") return null;
  const endsAt = entitlement.expirationDate;
  if (!endsAt || !Number.isFinite(Date.parse(endsAt))) return null;
  const started = entitlement.latestPurchaseDate;
  return {
    startedAt: started && Number.isFinite(Date.parse(started)) ? started : null,
    endsAt,
    willRenew: entitlement.willRenew !== false && !entitlement.unsubscribeDetectedAt,
  };
}

export interface PlusStatus {
  active: boolean;
  lapsedAt: string | null;
  /** The current free trial (for the day-5 note); null otherwise. */
  trial?: PlusTrial | null;
}

function toStatus(info: SdkCustomerInfo): PlusStatus {
  return {
    active: isPlusActive(info),
    lapsedAt: lapsedAt(info),
    trial: currentTrial(info),
  };
}

/** Plus status with the trial end and any lapse, or null when RevenueCat can't be reached. */
export async function fetchPlusStatus(): Promise<PlusStatus | null> {
  const sdk = loadSdk();
  if (!configured || !sdk) return null;
  try {
    return toStatus(await sdk.default.getCustomerInfo());
  } catch {
    return null;
  }
}

/** Like onPlusChange, with the full status. */
export function onPlusStatusChange(listener: (status: PlusStatus) => void): () => void {
  const sdk = loadSdk();
  if (!configured || !sdk) return () => {};
  const handler = (info: SdkCustomerInfo) => listener(toStatus(info));
  sdk.default.addCustomerInfoUpdateListener(handler);
  return () => {
    sdk.default.removeCustomerInfoUpdateListener(handler);
  };
}

/** Current entitlement (served from RevenueCat's on-device cache when offline). */
export async function fetchPlusActive(): Promise<boolean | null> {
  const sdk = loadSdk();
  if (!configured || !sdk) return null;
  try {
    return isPlusActive(await sdk.default.getCustomerInfo());
  } catch {
    return null;
  }
}

/** Subscribe to entitlement changes (renewals, refunds, purchases elsewhere). */
export function onPlusChange(listener: (active: boolean) => void): () => void {
  const sdk = loadSdk();
  if (!configured || !sdk) return () => {};
  const handler = (info: SdkCustomerInfo) => listener(isPlusActive(info));
  sdk.default.addCustomerInfoUpdateListener(handler);
  return () => {
    sdk.default.removeCustomerInfoUpdateListener(handler);
  };
}

function toPlusPackage(pkg: SdkPackage, trialEligible: boolean): PlusPackage {
  return {
    id: pkg.identifier,
    kind: planKind(pkg.packageType),
    priceString: pkg.product.priceString,
    pricePerMonthString: pkg.product.pricePerMonthString ?? null,
    trialDays: trialEligible ? freeTrialDays(pkg.product.introPrice) : null,
    trialUnit: trialEligible ? (pkg.product.introPrice?.periodUnit ?? null) : null,
  };
}

function toWinBackOffer(offer: SdkWinBackOffer | null | undefined): WinBackOffer | null {
  if (!offer) return null;
  const plain: WinBackOffer = {
    price: offer.price,
    priceString: offer.priceString,
    cycles: offer.cycles,
    periodUnit: offer.periodUnit,
    periodNumberOfUnits: offer.periodNumberOfUnits,
  };
  return isUsableWinBackOffer(plain) ? plain : null;
}

/** Resolves to null after `ms` instead of waiting longer. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * Apple win-back offers (iOS 18+) this lapsed subscriber can get, per
 * subscription package id. Anything going wrong (older iOS, no offer in App
 * Store Connect, not eligible, SDK error, slow answer) just means no offer.
 */
async function lookUpWinBackOffers(sdk: PurchasesModule, packages: SdkPackage[]): Promise<Map<string, SdkWinBackOffer>> {
  const found = new Map<string, SdkWinBackOffer>();
  const lookup = sdk.default.getEligibleWinBackOffersForPackage;
  if (Platform.OS !== "ios" || typeof lookup !== "function") return found;
  const subscriptions = packages.filter((pkg) => {
    const kind = planKind(pkg.packageType);
    return kind === "annual" || kind === "monthly";
  });
  const answers = await withTimeout(
    Promise.all(
      subscriptions.map(async (pkg) => {
        try {
          const offers = await lookup.call(sdk.default, pkg);
          // Apple lists the best offer for this subscriber first.
          const offer = offers?.find((candidate) => toWinBackOffer(candidate) !== null);
          return offer ? ([pkg.identifier, offer] as const) : null;
        } catch {
          return null;
        }
      }),
    ),
    WIN_BACK_LOOKUP_MS,
  );
  for (const answer of answers ?? []) if (answer) found.set(answer[0], answer[1]);
  return found;
}

// Win-back offers shown with the last packages loaded, keyed by package id.
const sdkWinBackOffers = new Map<string, SdkWinBackOffer>();

/**
 * Packages in the current offering. Throws when they can't be loaded.
 * `winBack`: also look up Apple win-back offers (only for a lapsed subscriber).
 */
export async function loadPackages(options: { winBack?: boolean } = {}): Promise<PlusPackage[]> {
  const sdk = loadSdk();
  if (!configured || !sdk) throw new Error("Purchases aren't available.");
  const offerings = await sdk.default.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];
  // Both lookups at once: the win-back one is capped at WIN_BACK_LOOKUP_MS.
  const winBackLookup = options.winBack
    ? lookUpWinBackOffers(sdk, packages)
    : Promise.resolve(new Map<string, SdkWinBackOffer>());
  // Someone who already used a trial can't get another: don't promise one.
  let eligibility: Record<string, { status: number }> = {};
  try {
    eligibility = await sdk.default.checkTrialOrIntroductoryPriceEligibility(
      packages.map((pkg) => pkg.product.identifier),
    );
  } catch {
    eligibility = {};
  }
  const winBackOffers = await winBackLookup;
  sdkPackages.clear();
  sdkWinBackOffers.clear();
  return packages.map((pkg) => {
    sdkPackages.set(pkg.identifier, pkg);
    // Only promise a trial when RevenueCat confirms it (2 = ELIGIBLE). Unknown
    // or a failed check shows the plain price terms; Apple still applies a
    // trial the user is due, so we never over-promise.
    const trialEligible = eligibility[pkg.product.identifier]?.status === 2;
    const plain = toPlusPackage(pkg, trialEligible);
    const offer = winBackOffers.get(pkg.identifier);
    if (!offer) return plain;
    sdkWinBackOffers.set(pkg.identifier, offer);
    // A win-back price replaces any trial promise (Apple applies one or the other).
    return { ...plain, trialDays: null, winBackOffer: toWinBackOffer(offer) };
  });
}

export type PurchaseOutcome = "purchased" | "cancelled" | "pending" | "failed";

/**
 * Buy a package loaded by loadPackages(). Never throws. `winBack`: the
 * paywall showed this plan's win-back price, so buy with that offer (and
 * never quietly at full price if the offer is gone).
 */
export async function purchase(
  packageId: string,
  options: { winBack?: boolean } = {},
): Promise<{ outcome: PurchaseOutcome; active: boolean }> {
  const sdk = loadSdk();
  const pkg = sdkPackages.get(packageId);
  if (!configured || !sdk || !pkg) return { outcome: "failed", active: false };
  const offer = options.winBack ? sdkWinBackOffers.get(packageId) : undefined;
  if (options.winBack && (!offer || typeof sdk.default.purchasePackageWithWinBackOffer !== "function")) {
    return { outcome: "failed", active: false };
  }
  try {
    const { customerInfo } = offer
      ? await sdk.default.purchasePackageWithWinBackOffer(pkg, offer)
      : await sdk.default.purchasePackage(pkg);
    refreshProxyUserId(sdk);
    const active = isPlusActive(customerInfo);
    // A completed transaction without the entitlement is a dashboard
    // misconfiguration, not Ask to Buy (that arrives as error "20").
    return { outcome: active ? "purchased" : "failed", active };
  } catch (error) {
    const e = error as { userCancelled?: boolean | null; code?: string };
    // Codes from PURCHASES_ERROR_CODE: "1" cancelled, "20" payment pending.
    if (e?.userCancelled || e?.code === "1") return { outcome: "cancelled", active: false };
    // Ask to Buy / deferred payments finish later via the update listener.
    if (e?.code === "20") return { outcome: "pending", active: false };
    return { outcome: "failed", active: false };
  }
}

/** Restore earlier purchases. Returns null if the restore itself failed. */
export async function restore(): Promise<boolean | null> {
  const sdk = loadSdk();
  if (!configured || !sdk) return null;
  try {
    const info = await sdk.default.restorePurchases();
    // A restore can move this install to the purchaser's RevenueCat id.
    refreshProxyUserId(sdk);
    return isPlusActive(info);
  } catch {
    return null;
  }
}

/**
 * Ask iOS for Apple's "Redeem code" sheet for offer codes made in App Store
 * Connect (codes must go through Apple, never a check in the app). Returns
 * false only when it can't be requested (no paywall, not iOS, SDK error):
 * iOS doesn't report whether the sheet actually appeared. A redeemed code
 * arrives later through the customer-info listener, like any other purchase.
 */
export async function redeemCode(): Promise<boolean> {
  const sdk = loadSdk();
  if (!configured || !sdk || Platform.OS !== "ios") return false;
  try {
    await sdk.default.presentCodeRedemptionSheet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Open subscription management: Apple's in-app sheet via RevenueCat, or the
 * App Store's subscriptions page when that isn't available. Never throws.
 */
export async function manageSubscriptions(): Promise<void> {
  const sdk = loadSdk();
  if (configured && sdk && Platform.OS === "ios" && typeof sdk.default.showManageSubscriptions === "function") {
    try {
      await sdk.default.showManageSubscriptions();
      return;
    } catch {
      // Fall through to the App Store page.
    }
  }
  await Linking.openURL(MANAGE_SUBSCRIPTIONS_URL).catch(() => {});
}

/** Test-only: forget configuration between tests. */
export function __resetPurchasesForTests(): void {
  configured = false;
  sdkPackages.clear();
  sdkWinBackOffers.clear();
}
