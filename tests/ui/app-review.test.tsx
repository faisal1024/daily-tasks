// requestAppReview must never throw, even if the native module is missing, and
// must only report true when the rating prompt was actually requested (the
// Today screen spends the review cooldown on true).
describe("requestAppReview", () => {
  beforeEach(() => jest.resetModules());

  // Import after jest.doMock so each test gets a fresh module with its own mock.
  // (A static import would bind the module before doMock; dynamic import()
  // needs --experimental-vm-modules under Jest.)
  async function loadRequestAppReview(): Promise<() => Promise<boolean>> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- must load after jest.doMock
    return require("@/lib/daily-tasks/app-review").requestAppReview;
  }

  it("returns false instead of crashing when the native module can't load", async () => {
    jest.doMock("expo-store-review", () => {
      throw new Error("Cannot find native module 'ExpoStoreReview'");
    });
    const requestAppReview = await loadRequestAppReview();
    await expect(requestAppReview()).resolves.toBe(false);
  });

  it("requests a review when the store prompt is available", async () => {
    const requestReview = jest.fn(async () => {});
    jest.doMock("expo-store-review", () => ({
      isAvailableAsync: jest.fn(async () => true),
      requestReview,
    }));
    const requestAppReview = await loadRequestAppReview();
    await expect(requestAppReview()).resolves.toBe(true);
    expect(requestReview).toHaveBeenCalledTimes(1);
  });

  it("returns false when requestReview rejects", async () => {
    jest.doMock("expo-store-review", () => ({
      isAvailableAsync: jest.fn(async () => true),
      requestReview: jest.fn(async () => {
        throw new Error("SKStoreReviewController failed");
      }),
    }));
    const requestAppReview = await loadRequestAppReview();
    await expect(requestAppReview()).resolves.toBe(false);
  });

  it("returns false when the availability check itself rejects", async () => {
    const requestReview = jest.fn(async () => {});
    jest.doMock("expo-store-review", () => ({
      isAvailableAsync: jest.fn(async () => {
        throw new Error("not supported");
      }),
      requestReview,
    }));
    const requestAppReview = await loadRequestAppReview();
    await expect(requestAppReview()).resolves.toBe(false);
    expect(requestReview).not.toHaveBeenCalled();
  });

  it("does nothing when the prompt isn't available", async () => {
    const requestReview = jest.fn(async () => {
      throw new Error("boom");
    });
    jest.doMock("expo-store-review", () => ({
      isAvailableAsync: jest.fn(async () => false),
      requestReview,
    }));
    const requestAppReview = await loadRequestAppReview();
    await expect(requestAppReview()).resolves.toBe(false);
    expect(requestReview).not.toHaveBeenCalled();
  });
});
