// requestAppReview must never throw, even if the native module is missing.
describe("requestAppReview", () => {
  beforeEach(() => jest.resetModules());

  it("returns false instead of crashing when the native module can't load", async () => {
    jest.doMock("expo-store-review", () => {
      throw new Error("Cannot find native module 'ExpoStoreReview'");
    });
    const { requestAppReview } = require("@/lib/daily-tasks/app-review");
    await expect(requestAppReview()).resolves.toBe(false);
  });

  it("requests a review when the store prompt is available", async () => {
    const requestReview = jest.fn(async () => {});
    jest.doMock("expo-store-review", () => ({
      isAvailableAsync: jest.fn(async () => true),
      requestReview,
    }));
    const { requestAppReview } = require("@/lib/daily-tasks/app-review");
    await expect(requestAppReview()).resolves.toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the prompt isn't available or errors", async () => {
    const requestReview = jest.fn(async () => {
      throw new Error("boom");
    });
    jest.doMock("expo-store-review", () => ({
      isAvailableAsync: jest.fn(async () => false),
      requestReview,
    }));
    const { requestAppReview } = require("@/lib/daily-tasks/app-review");
    await expect(requestAppReview()).resolves.toBe(false);
    expect(requestReview).not.toHaveBeenCalled();
  });
});
