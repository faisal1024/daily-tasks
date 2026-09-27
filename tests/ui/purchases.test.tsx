// RevenueCat wrapper: purchase outcomes, trial eligibility, and "no key → no
// paywall". The SDK is mocked; jest-expo runs as iOS.
import {
  __resetPurchasesForTests,
  configurePurchases,
  fetchPlusStatus,
  loadPackages,
  onPlusStatusChange,
  purchase,
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

  it("fetchPlusStatus reports the entitlement, trial end and lapse, or null when it can't check", async () => {
    expect(await fetchPlusStatus()).toBeNull(); // not configured
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_test";
    configurePurchases();
    const trial = { identifier: "plus", isActive: true, periodType: "TRIAL", willRenew: true, expirationDate: "2099-10-04T12:00:00Z" };
    mockSdk.getCustomerInfo.mockResolvedValueOnce({ entitlements: { active: { plus: trial }, all: { plus: trial } } });
    expect(await fetchPlusStatus()).toEqual({ active: true, trialEndsAt: "2099-10-04T12:00:00Z", lapsedAt: null });
    const expired = { identifier: "plus", isActive: false, periodType: "NORMAL", expirationDate: "2020-01-01T00:00:00Z" };
    mockSdk.getCustomerInfo.mockResolvedValueOnce({ entitlements: { active: {}, all: { plus: expired } } });
    expect(await fetchPlusStatus()).toEqual({ active: false, trialEndsAt: null, lapsedAt: "2020-01-01T00:00:00Z" });
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
    expect(listener).toHaveBeenCalledWith({ active: true, trialEndsAt: null, lapsedAt: null });
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
