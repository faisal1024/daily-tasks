// PlusProvider: replacing a paywall request iOS never presented, a bounded wait
// for RevenueCat, and no double purchases. Includes the real store on top, so
// "RevenueCat never answers" ends with a free user being gated.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook } from "@testing-library/react-native";

import { track } from "@/lib/daily-tasks/analytics";
import type { PlusPackage } from "@/lib/daily-tasks/plus";
import { CHECK_TIMEOUT_MS, PlusProvider, usePlus } from "@/lib/daily-tasks/plus-context";
import { fetchPlusActive, purchase as purchasePackage } from "@/lib/daily-tasks/purchases";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";

jest.mock("@/lib/daily-tasks/purchases", () => ({
  isPaywallConfigured: () => true,
  configurePurchases: () => true,
  fetchPlusActive: jest.fn(async () => false),
  onPlusChange: () => () => {},
  loadPackages: jest.fn(async () => []),
  purchase: jest.fn(),
  restore: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
  flush: jest.fn(),
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const wrapper = ({ children }: { children: ReactNode }) => <PlusProvider>{children}</PlusProvider>;

const ANNUAL: PlusPackage = {
  id: "$rc_annual",
  kind: "annual",
  priceString: "$29.99",
  pricePerMonthString: null,
  trialDays: null,
};

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe("PlusProvider: opening the paywall", () => {
  it("won't stack a second paywall, but replaces one iOS never presented", async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => usePlus(), { wrapper });
    let opened = false;
    await act(async () => {
      opened = result.current.openPaywall("break_down");
    });
    expect(opened).toBe(true);
    expect(result.current.paywallSource).toBe("break_down");

    // Still within the presentation window: a second request is refused.
    await act(async () => {
      opened = result.current.openPaywall("brain_dump");
    });
    expect(opened).toBe(false);
    expect(result.current.paywallSource).toBe("break_down");

    // Never closed on a timer...
    await act(async () => {
      jest.advanceTimersByTime(2600);
    });
    expect(result.current.paywallSource).toBe("break_down");
    expect(track).not.toHaveBeenCalledWith("paywall_viewed", expect.anything());

    // ...but the next request replaces the one that never showed.
    await act(async () => {
      opened = result.current.openPaywall("brain_dump");
    });
    expect(opened).toBe(true);
    expect(result.current.paywallSource).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(result.current.paywallSource).toBe("brain_dump");

    // Once it's on screen, it's never replaced, however long it's been up.
    await act(async () => result.current.markPaywallShown());
    expect(track).toHaveBeenCalledWith("paywall_viewed", { source: "brain_dump" });
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    await act(async () => {
      opened = result.current.openPaywall("new_ideas");
    });
    expect(opened).toBe(false);
    expect(result.current.paywallSource).toBe("brain_dump");
  });
});

describe("PlusProvider: a paywall iOS never presented", () => {
  it("is replaced by the next request after 2.5 s when onShow never came (layout alone doesn't count)", async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => usePlus(), { wrapper });
    await act(async () => {
      result.current.openPaywall("onboarding");
    });
    await act(async () => {
      jest.advanceTimersByTime(2501);
    });
    let opened = false;
    await act(async () => {
      opened = result.current.openPaywall("break_down");
    });
    expect(opened).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(result.current.paywallSource).toBe("break_down");
  });

  it("lets a paywall opened in the 60 ms reopen gap stand", async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => usePlus(), { wrapper });
    await act(async () => {
      result.current.openPaywall("onboarding");
    });
    await act(async () => {
      jest.advanceTimersByTime(2600);
    });
    await act(async () => {
      result.current.openPaywall("break_down");
    });
    expect(result.current.paywallSource).toBeNull();
    // Another gate opens during the gap: it wins, the delayed reopen yields.
    let opened = false;
    await act(async () => {
      opened = result.current.openPaywall("settings");
    });
    expect(opened).toBe(true);
    expect(result.current.paywallSource).toBe("settings");
    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(result.current.paywallSource).toBe("settings");
  });
});

describe("PlusProvider: purchases", () => {
  it("closes the paywall itself when a purchase completes", async () => {
    (purchasePackage as jest.Mock).mockResolvedValue({ outcome: "purchased", active: true });
    const { result } = await renderHook(() => usePlus(), { wrapper });
    await act(async () => {
      result.current.openPaywall("break_down");
    });
    await act(async () => result.current.markPaywallShown());
    await act(async () => {
      await result.current.purchase(ANNUAL);
    });
    expect(result.current.paywallSource).toBeNull();
    expect(track).toHaveBeenCalledWith("paywall_closed", { source: "break_down" });
  });

  it("never starts a second purchase while one is running, and counts a completed one", async () => {
    let finish!: (value: { outcome: "purchased"; active: boolean }) => void;
    (purchasePackage as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const { result } = await renderHook(() => usePlus(), { wrapper });
    let first!: Promise<string>;
    await act(async () => {
      first = result.current.purchase(ANNUAL);
    });
    expect(result.current.purchasing).toBe(true);
    let second = "";
    await act(async () => {
      second = await result.current.purchase(ANNUAL);
    });
    expect(second).toBe("pending");
    expect(purchasePackage).toHaveBeenCalledTimes(1);

    await act(async () => finish({ outcome: "purchased", active: true }));
    expect(await first).toBe("purchased");
    expect(result.current.purchasing).toBe(false);
    expect(result.current.purchaseCount).toBe(1);
    expect(result.current.entitlementActive).toBe(true);
  });
});

describe("PlusProvider: RevenueCat never answers", () => {
  it("stays unknown while it can't be reached, then gates a free user after the timeout", async () => {
    jest.useFakeTimers();
    (fetchPlusActive as jest.Mock).mockResolvedValue(null);
    const both = ({ children }: { children: ReactNode }) => (
      <PlusProvider>
        <DailyTasksProvider>{children}</DailyTasksProvider>
      </PlusProvider>
    );
    const { result } = await renderHook(() => ({ plus: usePlus(), store: useDailyTasks() }), {
      wrapper: both,
    });
    await act(async () => {});
    expect(result.current.store.ready).toBe(true);
    expect(result.current.plus.entitlementKnown).toBe(false);
    // Not gated while waiting (a subscriber must never see the paywall by mistake).
    expect(result.current.store.hasPlus).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(CHECK_TIMEOUT_MS);
    });
    expect(result.current.plus.entitlementKnown).toBe(true);
    expect(result.current.plus.entitlementActive).toBe(false);
    expect(result.current.store.hasPlus).toBe(false);
  });
});
