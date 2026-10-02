// RevenueCat wrapper: purchase outcomes, trial eligibility, and "no key → no
// paywall". The SDK is mocked; jest-expo runs as iOS.
import { Platform } from "react-native";

import {
  __resetPurchasesForTests,
  configurePurchases,
  currentTrial,
  fetchPlusStatus,
  loadPackages,
  onPlusStatusChange,
  purchase,
  redeemCode,
  restore,
} from "@/lib/daily-tasks/purchases";

const mockSdk = {
  configure: jest.fn(),
  getOfferings: jest.fn(),
  checkTrialOrIntroductoryPriceEligibility: jest.fn(),
  purchasePackage: jest.fn(),
  getCustomerInfo: jest.fn(),
  restorePurchases: jest.fn(),
  addCustomerInfoUpdateListener: jest.fn(),
  removeCustomerInfoUpdateListener: jest.fn(),
  presentCodeRedemptionSheet: jest.fn(),
};
jest.mock("react-native-purchases", () => ({ __esModule: true, default: mockSdk }));

const mockSetProxyUserId = jest.fn();
const mockSetProxyUserIdPending = jest.fn();
jest.mock("@/lib/daily-tasks/ai-client", () => ({
  ...jest.requireActual("@/lib/daily-tasks/ai-client"),
  setProxyUserId: (id: string | null) => mockSetProxyUserId(id),
  setProxyUserIdPending: (p: Promise<unknown>) => mockSetProxyUserIdPending(p),
}));
// Optional on the SDK mock so tests can remove it (older native builds).
const sdkWithId = mockSdk as typeof mockSdk & { getAppUserID?: jest.Mock };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const ANNUAL = {
  identifier: "$rc_annual",
  packageType: "ANNUAL",
  product: {
    identifier: "plus_annual",
    priceString: "$29.99",
    pricePerMonthString: "$2.49",
    introPrice: { price: 0, periodUnit: "WEEK", periodNumberOfUnits: 1 },
  },
};

const ACTIVE = { entitlements: { active: { plus: { identifier: "plus" } } } };

async function configuredWithAnnual(eligibilityStatus = 2) {
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
  expect(configurePurchases()).toBe(true);
  mockSdk.getOfferings.mockResolvedValue({ current: { availablePackages: [ANNUAL] } });
  mockSdk.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({
    plus_annual: { status: eligibilityStatus },
  });
  return loadPackages();
}

beforeEach(() => {
  __resetPurchasesForTests();
  jest.clearAllMocks();
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
});

describe("purchases", () => {
  it("has no paywall without a RevenueCat key", () => {
    expect(configurePurchases()).toBe(false);
    expect(mockSdk.configure).not.toHaveBeenCalled();
  });

  it("offers the trial when eligible, and no trial when the store says ineligible (status 1)", async () => {
    expect((await configuredWithAnnual(2))[0]).toMatchObject({ kind: "annual", trialDays: 7 });
    __resetPurchasesForTests();
    expect((await configuredWithAnnual(1))[0].trialDays).toBeNull();
  });

  it.each([
    ["unknown (0)", { plus_annual: { status: 0 } }],
    ["missing", {}],
  ])("promises no trial when eligibility is %s", async (_why, result) => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
    configurePurchases();
    mockSdk.getOfferings.mockResolvedValue({ current: { availablePackages: [ANNUAL] } });
    mockSdk.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue(result);
    expect((await loadPackages())[0].trialDays).toBeNull();
  });

  it("promises no trial when the eligibility check fails", async () => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
    configurePurchases();
    mockSdk.getOfferings.mockResolvedValue({ current: { availablePackages: [ANNUAL] } });
    mockSdk.checkTrialOrIntroductoryPriceEligibility.mockRejectedValue(new Error("offline"));
    expect((await loadPackages())[0].trialDays).toBeNull();
  });

  it("treats a completed purchase without the entitlement as failed (not pending)", async () => {
    await configuredWithAnnual();
    mockSdk.purchasePackage.mockResolvedValue({ customerInfo: { entitlements: { active: {} } } });
    expect(await purchase("$rc_annual")).toEqual({ outcome: "failed", active: false });
  });

  it("maps an active entitlement to purchased", async () => {
    await configuredWithAnnual();
    mockSdk.purchasePackage.mockResolvedValue({ customerInfo: ACTIVE });
    expect(await purchase("$rc_annual")).toEqual({ outcome: "purchased", active: true });
    expect(mockSdk.purchasePackage).toHaveBeenCalledWith(ANNUAL);
  });

  it.each([
    [{ userCancelled: true }, "cancelled"],
    [{ code: "1" }, "cancelled"],
    [{ code: "20" }, "pending"],
    [{ code: "2" }, "failed"],
  ])("maps SDK error %j to %s", async (error, outcome) => {
    await configuredWithAnnual();
    mockSdk.purchasePackage.mockRejectedValue(error);
    expect(await purchase("$rc_annual")).toEqual({ outcome, active: false });
  });

  it("fetchPlusStatus reports the entitlement, trial and lapse, or null when it can't check", async () => {
    expect(await fetchPlusStatus()).toBeNull(); // not configured
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
    configurePurchases();
    const trial = { identifier: "plus", isActive: true, periodType: "TRIAL", willRenew: true, expirationDate: "2099-10-04T12:00:00Z" };
    mockSdk.getCustomerInfo.mockResolvedValueOnce({ entitlements: { active: { plus: trial }, all: { plus: trial } } });
    expect(await fetchPlusStatus()).toEqual({
      active: true,
      lapsedAt: null,
      trial: { startedAt: null, endsAt: "2099-10-04T12:00:00Z", willRenew: true, productId: null },
    });
    const expired = { identifier: "plus", isActive: false, periodType: "NORMAL", expirationDate: "2020-01-01T00:00:00Z" };
    mockSdk.getCustomerInfo.mockResolvedValueOnce({ entitlements: { active: {}, all: { plus: expired } } });
    expect(await fetchPlusStatus()).toEqual({
      active: false,
      lapsedAt: "2020-01-01T00:00:00Z",
      trial: null,
    });
    mockSdk.getCustomerInfo.mockRejectedValueOnce(new Error("offline"));
    expect(await fetchPlusStatus()).toBeNull();
  });

  it("onPlusStatusChange passes the full status and unsubscribes the same handler", () => {
    expect(onPlusStatusChange(jest.fn())).toEqual(expect.any(Function)); // not configured: no-op
    expect(mockSdk.addCustomerInfoUpdateListener).not.toHaveBeenCalled();
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
    configurePurchases();
    const listener = jest.fn();
    const off = onPlusStatusChange(listener);
    const handler = mockSdk.addCustomerInfoUpdateListener.mock.calls[0][0];
    handler(ACTIVE);
    expect(listener).toHaveBeenCalledWith({ active: true, lapsedAt: null, trial: null });
    off();
    expect(mockSdk.removeCustomerInfoUpdateListener).toHaveBeenCalledWith(handler);
  });

  describe("proxy user id", () => {
    beforeEach(() => {
      process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
    });
    afterEach(() => {
      delete sdkWithId.getAppUserID;
    });

    it("hands the anonymous RevenueCat id to the proxy client", async () => {
      sdkWithId.getAppUserID = jest.fn().mockResolvedValue("$RCAnonymousID:abc");
      expect(configurePurchases()).toBe(true);
      await flush();
      expect(mockSetProxyUserId).toHaveBeenCalledWith("$RCAnonymousID:abc");
    });

    it("still configures when getAppUserID is missing", async () => {
      expect(configurePurchases()).toBe(true);
      await flush();
      expect(mockSetProxyUserId).not.toHaveBeenCalled();
    });

    it("still configures when getAppUserID throws or rejects", async () => {
      sdkWithId.getAppUserID = jest.fn(() => {
        throw new Error("native crash");
      });
      expect(configurePurchases()).toBe(true);
      __resetPurchasesForTests();
      sdkWithId.getAppUserID = jest.fn().mockRejectedValue(new Error("offline"));
      expect(configurePurchases()).toBe(true);
      await flush();
      expect(mockSetProxyUserId).not.toHaveBeenCalled();
    });

    it("re-reads the id after a purchase and after a restore (the id can change)", async () => {
      sdkWithId.getAppUserID = jest.fn().mockResolvedValue("$RCAnonymousID:first");
      await configuredWithAnnual();
      await flush();
      sdkWithId.getAppUserID.mockResolvedValue("$RCAnonymousID:after-purchase");
      mockSdk.purchasePackage.mockResolvedValue({ customerInfo: ACTIVE });
      await purchase("$rc_annual");
      await flush();
      expect(mockSetProxyUserId).toHaveBeenLastCalledWith("$RCAnonymousID:after-purchase");
      sdkWithId.getAppUserID.mockResolvedValue("$RCAnonymousID:restored");
      mockSdk.restorePurchases.mockResolvedValue(ACTIVE);
      expect(await restore()).toBe(true);
      await flush();
      expect(mockSetProxyUserId).toHaveBeenLastCalledWith("$RCAnonymousID:restored");
      expect(sdkWithId.getAppUserID).toHaveBeenCalledTimes(3);
    });

    it("hands the pending lookup to the proxy client so the first request can wait", async () => {
      sdkWithId.getAppUserID = jest.fn().mockResolvedValue("$RCAnonymousID:abc");
      configurePurchases();
      expect(mockSetProxyUserIdPending).toHaveBeenCalledWith(expect.any(Promise));
    });

    it("sends no id when the SDK returns a non-string", async () => {
      sdkWithId.getAppUserID = jest.fn().mockResolvedValue(undefined);
      configurePurchases();
      await flush();
      expect(mockSetProxyUserId).toHaveBeenCalledWith(null);
    });
  });
});

describe("redeemCode (Apple offer codes)", () => {
  const originalOS = Platform.OS;
  // Optional so a test can remove it (a native build without the method).
  const sdkWithSheet = mockSdk as Omit<typeof mockSdk, "presentCodeRedemptionSheet"> & {
    presentCodeRedemptionSheet?: jest.Mock;
  };
  const sheet = mockSdk.presentCodeRedemptionSheet;

  afterEach(() => {
    Platform.OS = originalOS;
    sdkWithSheet.presentCodeRedemptionSheet = sheet;
  });

  function configure() {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
    expect(configurePurchases()).toBe(true);
  }

  it("presents Apple's sheet and reports it was shown", async () => {
    configure();
    sheet.mockResolvedValue(undefined);
    await expect(redeemCode()).resolves.toBe(true);
    expect(sheet).toHaveBeenCalledTimes(1);
  });

  it("is false and never touches the SDK when there's no paywall in this build", async () => {
    await expect(redeemCode()).resolves.toBe(false);
    expect(sheet).not.toHaveBeenCalled();
  });

  it("is false when a key is set but the SDK was never configured", async () => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
    await expect(redeemCode()).resolves.toBe(false);
    expect(sheet).not.toHaveBeenCalled();
  });

  it("is false off iOS, even once configured", async () => {
    configure();
    Platform.OS = "android";
    await expect(redeemCode()).resolves.toBe(false);
    expect(sheet).not.toHaveBeenCalled();
  });

  it("is false when the sheet rejects or throws synchronously", async () => {
    configure();
    sheet.mockRejectedValueOnce(new Error("store unavailable"));
    await expect(redeemCode()).resolves.toBe(false);
    sheet.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await expect(redeemCode()).resolves.toBe(false);
  });

  it("is false on an older native build without the method", async () => {
    configure();
    delete sdkWithSheet.presentCodeRedemptionSheet;
    await expect(redeemCode()).resolves.toBe(false);
  });

  it("doesn't treat opening the sheet as a purchase (the listener delivers any redemption)", async () => {
    configure();
    sheet.mockResolvedValue(undefined);
    await redeemCode();
    expect(mockSdk.getCustomerInfo).not.toHaveBeenCalled();
    expect(mockSdk.purchasePackage).not.toHaveBeenCalled();
  });
});

// --- 1.3: Apple win-back offers (PR #81) ----------------------------------------

describe("win-back offers", () => {
  // Optional on the SDK mock so a test can remove them (an older native build).
  const sdk = mockSdk as typeof mockSdk & {
    getEligibleWinBackOffersForPackage?: jest.Mock;
    purchasePackageWithWinBackOffer?: jest.Mock;
  };
  const MONTHLY = {
    identifier: "$rc_monthly",
    packageType: "MONTHLY",
    product: { identifier: "plus_monthly", priceString: "$4.99", pricePerMonthString: "$4.99", introPrice: null },
  };
  const OFFER = {
    identifier: "winback_3m",
    price: 2.99,
    priceString: "$2.99",
    cycles: 3,
    period: "P1M",
    periodUnit: "MONTH",
    periodNumberOfUnits: 1,
  };
  const originalOS = Platform.OS;

  beforeEach(() => {
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
    expect(configurePurchases()).toBe(true);
    mockSdk.getOfferings.mockResolvedValue({ current: { availablePackages: [ANNUAL, MONTHLY] } });
    mockSdk.checkTrialOrIntroductoryPriceEligibility.mockResolvedValue({ plus_annual: { status: 2 } });
    sdk.getEligibleWinBackOffersForPackage = jest.fn(async () => []);
    sdk.purchasePackageWithWinBackOffer = jest.fn();
  });
  afterEach(() => {
    jest.useRealTimers();
    Platform.OS = originalOS;
    delete sdk.getEligibleWinBackOffersForPackage;
    delete sdk.purchasePackageWithWinBackOffer;
  });

  /** What a non-lapsed paywall loads today (no lookup at all). */
  async function plainPackages() {
    const plain = await loadPackages();
    __resetPurchasesForTests();
    configurePurchases();
    return plain;
  }

  it("attaches an offer to its plan and drops that plan's trial promise", async () => {
    sdk.getEligibleWinBackOffersForPackage!.mockImplementation(async (pkg: { identifier: string }) =>
      pkg.identifier === "$rc_annual" ? [OFFER] : [],
    );
    const [annual, monthly] = await loadPackages({ winBack: true });
    expect(annual).toMatchObject({
      id: "$rc_annual",
      trialDays: null,
      winBackOffer: { price: 2.99, priceString: "$2.99", cycles: 3, periodUnit: "MONTH", periodNumberOfUnits: 1 },
    });
    expect(monthly.winBackOffer).toBeUndefined();
  });

  it.each([
    ["throws", () => jest.fn(() => { throw new Error("native"); })],
    ["rejects", () => jest.fn(async () => { throw new Error("offline"); })],
    ["answers empty", () => jest.fn(async () => [])],
    ["answers undefined", () => jest.fn(async () => undefined)],
    ["offers only malformed offers", () => jest.fn(async () => [{ ...OFFER, periodUnit: "FORTNIGHT" }, { ...OFFER, cycles: 0 }])],
    [
      "offers only unexpected shapes (free over several cycles, no period)",
      () => jest.fn(async () => [{ ...OFFER, price: 0, cycles: 3 }, { ...OFFER, periodUnit: undefined }]),
    ],
    ["is missing (older native build)", () => undefined],
  ])("when the lookup %s, the packages are exactly today's (trial kept, no offer)", async (_why, make) => {
    const plain = await plainPackages();
    expect(plain[0].trialDays).toBe(7);
    sdk.getEligibleWinBackOffersForPackage = make() as jest.Mock | undefined;
    const withLookup = await loadPackages({ winBack: true });
    expect(withLookup).toEqual(plain);
    expect(withLookup.every((pkg) => !("winBackOffer" in pkg))).toBe(true);
  });

  it("gives up on a lookup slower than 1.5 s and shows today's packages", async () => {
    const plain = await plainPackages();
    jest.useFakeTimers();
    sdk.getEligibleWinBackOffersForPackage!.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([OFFER]), 5000)),
    );
    let loaded: Awaited<ReturnType<typeof loadPackages>> | undefined;
    void loadPackages({ winBack: true }).then((value) => (loaded = value));
    await jest.advanceTimersByTimeAsync(1499);
    expect(loaded).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(loaded).toEqual(plain);
  });

  it("never looks one up off iOS", async () => {
    Platform.OS = "android";
    sdk.getEligibleWinBackOffersForPackage!.mockResolvedValue([OFFER]);
    const loaded = await loadPackages({ winBack: true });
    expect(sdk.getEligibleWinBackOffersForPackage).not.toHaveBeenCalled();
    expect(loaded.every((pkg) => !pkg.winBackOffer)).toBe(true);
  });

  it("buys with the offer that was shown", async () => {
    sdk.getEligibleWinBackOffersForPackage!.mockResolvedValue([OFFER]);
    await loadPackages({ winBack: true });
    sdk.purchasePackageWithWinBackOffer!.mockResolvedValue({ customerInfo: ACTIVE });
    expect(await purchase("$rc_annual", { winBack: true })).toEqual({ outcome: "purchased", active: true });
    expect(sdk.purchasePackageWithWinBackOffer).toHaveBeenCalledWith(ANNUAL, OFFER);
    expect(mockSdk.purchasePackage).not.toHaveBeenCalled();
  });

  it("never buys at full price when the shown offer is gone", async () => {
    // Loaded without an offer (e.g. the packages were reloaded meanwhile).
    await loadPackages({ winBack: true });
    expect(await purchase("$rc_annual", { winBack: true })).toEqual({ outcome: "failed", active: false });
    expect(mockSdk.purchasePackage).not.toHaveBeenCalled();
    expect(sdk.purchasePackageWithWinBackOffer).not.toHaveBeenCalled();
  });

  it("never buys at full price when the SDK can't buy with an offer", async () => {
    sdk.getEligibleWinBackOffersForPackage!.mockResolvedValue([OFFER]);
    await loadPackages({ winBack: true });
    delete sdk.purchasePackageWithWinBackOffer;
    expect(await purchase("$rc_annual", { winBack: true })).toEqual({ outcome: "failed", active: false });
    expect(mockSdk.purchasePackage).not.toHaveBeenCalled();
  });

  it("buys a plan without an offer at its plain price", async () => {
    sdk.getEligibleWinBackOffersForPackage!.mockImplementation(async (pkg: { identifier: string }) =>
      pkg.identifier === "$rc_annual" ? [OFFER] : [],
    );
    await loadPackages({ winBack: true });
    mockSdk.purchasePackage.mockResolvedValue({ customerInfo: ACTIVE });
    expect(await purchase("$rc_monthly")).toEqual({ outcome: "purchased", active: true });
    expect(mockSdk.purchasePackage).toHaveBeenCalledWith(MONTHLY);
    expect(sdk.purchasePackageWithWinBackOffer).not.toHaveBeenCalled();
  });
});

describe("currentTrial (the day-5 note's trial)", () => {
  const entitlement = {
    identifier: "plus",
    isActive: true,
    periodType: "TRIAL",
    willRenew: true,
    latestPurchaseDate: "2026-10-01T09:00:00Z",
    expirationDate: "2026-10-08T09:00:00Z",
    unsubscribeDetectedAt: null,
    ownershipType: "PURCHASED",
  };
  const info = (overrides: Record<string, unknown> = {}) =>
    ({ entitlements: { active: { plus: { ...entitlement, ...overrides } } } }) as never;

  it("reads the start, end and renewal; a cancelled trial won't renew", () => {
    expect(currentTrial(info())).toEqual({
      startedAt: "2026-10-01T09:00:00Z",
      endsAt: "2026-10-08T09:00:00Z",
      willRenew: true,
      productId: null,
    });
    expect(currentTrial(info({ unsubscribeDetectedAt: "2026-10-02T09:00:00Z" }))?.willRenew).toBe(false);
    expect(currentTrial(info({ willRenew: false }))?.willRenew).toBe(false);
    expect(currentTrial(info({ latestPurchaseDate: "junk" }))?.startedAt).toBeNull();
  });

  it("is null when not a trial, family-shared, or without a usable end", () => {
    expect(currentTrial(info({ periodType: "NORMAL" }))).toBeNull();
    expect(currentTrial(info({ ownershipType: "FAMILY_SHARED" }))).toBeNull();
    expect(currentTrial(info({ expirationDate: null }))).toBeNull();
    expect(currentTrial(info({ expirationDate: "junk" }))).toBeNull();
    expect(currentTrial(null)).toBeNull();
  });
});
