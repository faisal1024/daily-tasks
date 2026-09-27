// Thin wrapper over RevenueCat (react-native-purchases).
//
// - The paywall only exists when EXPO_PUBLIC_REVENUECAT_IOS_KEY is set at build
//   time. Without it every call here is a no-op and the app behaves exactly as
//   before (everyone has every feature).
// - The native module is loaded lazily inside a try, like app-review.ts: a binary
//   without it degrades to "no paywall" instead of crashing at launch.
// - SDK objects are converted to the plain types in plus.ts right here, so the
//   rest of the app never touches RevenueCat types.

import { Platform } from "react-native";

import { freeTrialDays, planKind, PLUS_ENTITLEMENT, type PlusPackage } from "./plus";

type PurchasesModule = typeof import("react-native-purchases");
type SdkPackage = import("react-native-purchases").PurchasesPackage;
type SdkCustomerInfo = import("react-native-purchases").CustomerInfo;

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
  return configured;
}

export function isPlusActive(info: SdkCustomerInfo | null | undefined): boolean {
  return Boolean(info?.entitlements?.active?.[PLUS_ENTITLEMENT]);
}

/** When a free trial of Plus ends (ISO), or null when not on a trial. */
export function trialEndsAt(info: SdkCustomerInfo | null | undefined): string | null {
  const entitlement = info?.entitlements?.active?.[PLUS_ENTITLEMENT];
  if (!entitlement || entitlement.periodType !== "TRIAL") return null;
  // Already cancelled, or shared by family (they can't cancel it): no reminder.
  if (entitlement.willRenew === false || entitlement.unsubscribeDetectedAt) return null;
  if (entitlement.ownershipType === "FAMILY_SHARED") return null;
  return entitlement.expirationDate ?? null;
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

export interface PlusStatus {
  active: boolean;
  trialEndsAt: string | null;
  lapsedAt: string | null;
}

function toStatus(info: SdkCustomerInfo): PlusStatus {
  return { active: isPlusActive(info), trialEndsAt: trialEndsAt(info), lapsedAt: lapsedAt(info) };
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
  };
}

/** Packages in the current offering. Throws when they can't be loaded. */
export async function loadPackages(): Promise<PlusPackage[]> {
  const sdk = loadSdk();
  if (!configured || !sdk) throw new Error("Purchases aren't available.");
  const offerings = await sdk.default.getOfferings();
  const packages = offerings.current?.availablePackages ?? [];
  // Someone who already used a trial can't get another: don't promise one.
  let eligibility: Record<string, { status: number }> = {};
  try {
    eligibility = await sdk.default.checkTrialOrIntroductoryPriceEligibility(
      packages.map((pkg) => pkg.product.identifier),
    );
  } catch {
    eligibility = {};
  }
  sdkPackages.clear();
  return packages.map((pkg) => {
    sdkPackages.set(pkg.identifier, pkg);
    // Only promise a trial when RevenueCat confirms it (2 = ELIGIBLE). Unknown
    // or a failed check shows the plain price terms; Apple still applies a
    // trial the user is due, so we never over-promise.
    const trialEligible = eligibility[pkg.product.identifier]?.status === 2;
    return toPlusPackage(pkg, trialEligible);
  });
}

export type PurchaseOutcome = "purchased" | "cancelled" | "pending" | "failed";

/** Buy a package loaded by loadPackages(). Never throws. */
export async function purchase(packageId: string): Promise<{ outcome: PurchaseOutcome; active: boolean }> {
  const sdk = loadSdk();
  const pkg = sdkPackages.get(packageId);
  if (!configured || !sdk || !pkg) return { outcome: "failed", active: false };
  try {
    const { customerInfo } = await sdk.default.purchasePackage(pkg);
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
    return isPlusActive(await sdk.default.restorePurchases());
  } catch {
    return null;
  }
}

/** Test-only: forget configuration between tests. */
export function __resetPurchasesForTests(): void {
  configured = false;
  sdkPackages.clear();
}
