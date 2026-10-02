// PlusProvider: replacing a paywall request iOS never presented, a bounded wait
// for RevenueCat, and no double purchases. Includes the real store on top, so
// "RevenueCat never answers" ends with a free user being gated.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { track } from "@/lib/daily-tasks/analytics";
import type { PlusPackage } from "@/lib/daily-tasks/plus";
import { CHECK_TIMEOUT_MS, PlusProvider, WIN_BACK_DELAY_MS, usePlus } from "@/lib/daily-tasks/plus-context";
import {
  fetchPlusStatus,
  loadPackages as loadSdkPackages,
  onPlusStatusChange,
  purchase as purchasePackage,
  redeemCode as presentRedeemSheet,
  restore as restorePurchases,
  type PlusStatus,
} from "@/lib/daily-tasks/purchases";
import { syncTrialReminder } from "@/lib/daily-tasks/trial-reminder";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";

jest.mock("@/lib/daily-tasks/purchases", () => ({
  isPaywallConfigured: () => true,
  configurePurchases: () => true,
  fetchPlusStatus: jest.fn(async () => ({ active: false, trialEndsAt: null, lapsedAt: null })),
  onPlusStatusChange: jest.fn(() => () => {}),
  loadPackages: jest.fn(async () => []),
  purchase: jest.fn(),
  restore: jest.fn(),
  redeemCode: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/trial-reminder", () => ({
  syncTrialReminder: jest.fn(async () => {}),
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

const FREE: PlusStatus = { active: false, trialEndsAt: null, lapsedAt: null };
const DAY = 24 * 60 * 60_000;
/** A lapse that ended `ms` ago. */
const lapsed = (ms: number): PlusStatus => ({
  active: false,
  trialEndsAt: null,
  lapsedAt: new Date(Date.now() - ms).toISOString(),
});

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
  (fetchPlusStatus as jest.Mock).mockResolvedValue(FREE);
  (onPlusStatusChange as jest.Mock).mockImplementation(() => () => {});
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

describe("PlusProvider: purchase funnel events", () => {
  it.each([
    ["cancelled", "purchase_cancelled", { plan: "annual", source: "break_down", trial: true }],
    ["pending", "purchase_failed", { plan: "annual", source: "break_down", outcome: "pending", trial: true }],
    ["failed", "purchase_failed", { plan: "annual", source: "break_down", outcome: "failed", trial: true }],
    ["purchased", "purchase_completed", { plan: "annual", source: "break_down", outcome: "purchased", trial: true }],
  ])("tracks a %s purchase as %s with exactly its props", async (outcome, event, props) => {
    (purchasePackage as jest.Mock).mockResolvedValue({ outcome, active: outcome === "purchased" });
    const { result } = await renderHook(() => usePlus(), { wrapper });
    await act(async () => {
      result.current.openPaywall("break_down");
    });
    await act(async () => {
      await result.current.purchase({ ...ANNUAL, trialDays: 7 });
    });
    const purchaseEvents = (track as jest.Mock).mock.calls.filter(([name]) =>
      ["purchase_cancelled", "purchase_failed", "purchase_completed"].includes(name),
    );
    // toEqual: a cancel must not carry `outcome` (it's a drop-off, not an error).
    expect(purchaseEvents).toEqual([[event, props]]);
  });
});

describe("PlusProvider: RevenueCat never answers", () => {
  it("stays unknown while it can't be reached, then gates a free user after the timeout", async () => {
    jest.useFakeTimers();
    (fetchPlusStatus as jest.Mock).mockResolvedValue(null);
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

// --- Phase 11a: win-back after a lapse, and the trial-ending reminder ---------

/** Render the provider with RevenueCat's status listener captured. */
async function renderWithListener() {
  let emit: ((status: PlusStatus) => void) | undefined;
  (onPlusStatusChange as jest.Mock).mockImplementation((listener: (status: PlusStatus) => void) => {
    emit = listener;
    return () => {};
  });
  const hook = await renderHook(() => usePlus(), { wrapper });
  await act(async () => {});
  const change = async (status: PlusStatus) => {
    await act(async () => emit?.(status));
  };
  return { ...hook, change };
}

describe("PlusProvider: win-back after Plus lapses", () => {
  it("is never due for someone who never had Plus", async () => {
    const { result } = await renderWithListener();
    await waitFor(() => expect(result.current.entitlementKnown).toBe(true));
    expect(result.current.winBackDue).toBe(false);
  });

  it("waits two days after the lapse before it's due", async () => {
    expect(WIN_BACK_DELAY_MS).toBe(2 * DAY);
    const { result, change } = await renderWithListener();
    await change(lapsed(DAY));
    expect(result.current.winBackDue).toBe(false);
    await change(lapsed(2 * DAY - 60_000));
    expect(result.current.winBackDue).toBe(false);
    await change(lapsed(2 * DAY + 60_000));
    expect(result.current.winBackDue).toBe(true);
  });

  it("is due for a lapse found at launch", async () => {
    (fetchPlusStatus as jest.Mock).mockResolvedValue(lapsed(3 * DAY));
    const { result } = await renderWithListener();
    await waitFor(() => expect(result.current.winBackDue).toBe(true));
  });

  it("is never due while Plus is active, even with an old lapse on record", async () => {
    const { result, change } = await renderWithListener();
    await change({ ...lapsed(3 * DAY), active: true });
    expect(result.current.entitlementActive).toBe(true);
    expect(result.current.winBackDue).toBe(false);
  });

  it("counts as offered only once iOS shows the win_back paywall, then not again for that lapse", async () => {
    const status = lapsed(3 * DAY);
    const { result, change } = await renderWithListener();
    await change(status);

    // Asked for but never presented: still due.
    await act(async () => {
      result.current.openPaywall("win_back");
    });
    expect(result.current.winBackDue).toBe(true);
    await act(async () => result.current.closePaywall());
    expect(result.current.winBackDue).toBe(true);

    // Another paywall shown doesn't use it up either.
    await act(async () => {
      result.current.openPaywall("settings");
    });
    await act(async () => result.current.markPaywallShown());
    await act(async () => result.current.closePaywall());
    expect(result.current.winBackDue).toBe(true);

    await act(async () => {
      result.current.openPaywall("win_back");
    });
    await act(async () => result.current.markPaywallShown());
    expect(result.current.winBackDue).toBe(false);
    expect(await AsyncStorage.getItem("daily-tasks/plus-win-back-offered-for")).toBe(status.lapsedAt);
    await act(async () => result.current.closePaywall());

    // Same lapse reported again: stays offered.
    await change(status);
    expect(result.current.winBackDue).toBe(false);
  });

  it("isn't due at launch for a lapse already offered on an earlier run", async () => {
    const status = lapsed(3 * DAY);
    await AsyncStorage.setItem("daily-tasks/plus-win-back-offered-for", status.lapsedAt!);
    (fetchPlusStatus as jest.Mock).mockResolvedValue(status);
    const { result } = await renderWithListener();
    await waitFor(() => expect(result.current.entitlementKnown).toBe(true));
    await act(async () => {});
    expect(result.current.winBackDue).toBe(false);
  });

  it("offers a later, different lapse again", async () => {
    await AsyncStorage.setItem("daily-tasks/plus-win-back-offered-for", lapsed(40 * DAY).lapsedAt!);
    (fetchPlusStatus as jest.Mock).mockResolvedValue(lapsed(3 * DAY));
    const { result } = await renderWithListener();
    await waitFor(() => expect(result.current.winBackDue).toBe(true));
  });

  it("a stale 'not active' answer right after a purchase doesn't undo it or trigger win-back", async () => {
    (fetchPlusStatus as jest.Mock).mockResolvedValue(lapsed(3 * DAY));
    const { result } = await renderWithListener();
    await waitFor(() => expect(result.current.winBackDue).toBe(true));
    (purchasePackage as jest.Mock).mockResolvedValue({ outcome: "purchased", active: true });
    // RevenueCat's cache still says lapsed for a moment.
    await act(async () => {
      await result.current.purchase(ANNUAL);
    });
    await act(async () => {});
    expect(result.current.entitlementActive).toBe(true);
    expect(result.current.winBackDue).toBe(false);
  });

  it("restoring an active Plus clears a due win-back", async () => {
    (fetchPlusStatus as jest.Mock).mockResolvedValue(lapsed(3 * DAY));
    (restorePurchases as jest.Mock).mockResolvedValue(true);
    const { result } = await renderWithListener();
    await waitFor(() => expect(result.current.winBackDue).toBe(true));
    await act(async () => {
      await result.current.restore();
    });
    expect(result.current.entitlementActive).toBe(true);
    expect(result.current.winBackDue).toBe(false);
  });
});

describe("PlusProvider: trial-ending reminder", () => {
  const TRIAL: PlusStatus = { active: true, trialEndsAt: "2026-10-04T12:00:00Z", lapsedAt: null };

  it("syncs the reminder with RevenueCat's trial end on launch", async () => {
    (fetchPlusStatus as jest.Mock).mockResolvedValue(TRIAL);
    await renderWithListener();
    await waitFor(() => expect(syncTrialReminder).toHaveBeenCalledWith("2026-10-04T12:00:00Z"));
  });

  it("clears it on launch when there's no trial, and follows later status changes", async () => {
    const { change } = await renderWithListener();
    await waitFor(() => expect(syncTrialReminder).toHaveBeenCalledWith(null));
    await change(TRIAL);
    expect(syncTrialReminder).toHaveBeenLastCalledWith("2026-10-04T12:00:00Z");
  });

  it("doesn't touch the reminder when RevenueCat can't be reached", async () => {
    (fetchPlusStatus as jest.Mock).mockResolvedValue(null);
    await renderWithListener();
    await act(async () => {});
    expect(syncTrialReminder).not.toHaveBeenCalled();
  });

  it("schedules it right after a purchase starts a trial (not on the next launch)", async () => {
    const { result } = await renderWithListener();
    await waitFor(() => expect(syncTrialReminder).toHaveBeenCalledWith(null));
    (syncTrialReminder as jest.Mock).mockClear();
    (purchasePackage as jest.Mock).mockResolvedValue({ outcome: "purchased", active: true });
    (fetchPlusStatus as jest.Mock).mockResolvedValue(TRIAL);
    await act(async () => {
      await result.current.purchase(ANNUAL);
    });
    await waitFor(() => expect(syncTrialReminder).toHaveBeenCalledWith("2026-10-04T12:00:00Z"));
  });
});

describe("PlusProvider: redeem a code", () => {
  it.each([
    [true, "requested"],
    [false, "unavailable"],
  ] as const)("returns the sheet's result (%s) and tracks it as %s, with nothing else", async (shown, outcome) => {
    (presentRedeemSheet as jest.Mock).mockResolvedValue(shown);
    const { result } = await renderHook(() => usePlus(), { wrapper });
    await act(async () => {});
    (track as jest.Mock).mockClear();
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.redeemCode();
    });
    expect(returned).toBe(shown);
    expect(presentRedeemSheet).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("redeem_code_opened", { outcome });
  });

  it("opening the sheet doesn't grant Plus; a redemption arrives through the status listener", async () => {
    (presentRedeemSheet as jest.Mock).mockResolvedValue(true);
    let listener: ((status: PlusStatus) => void) | null = null;
    (onPlusStatusChange as jest.Mock).mockImplementation((fn: (status: PlusStatus) => void) => {
      listener = fn;
      return () => {};
    });
    const { result } = await renderHook(() => usePlus(), { wrapper });
    await waitFor(() => expect(result.current.entitlementKnown).toBe(true));
    await act(async () => {
      await result.current.redeemCode();
    });
    expect(result.current.entitlementActive).toBe(false);
    await act(async () => listener?.({ active: true, trialEndsAt: null, lapsedAt: null }));
    expect(result.current.entitlementActive).toBe(true);
  });

  it("is a harmless no-op outside the provider", async () => {
    const { result } = await renderHook(() => usePlus());
    await expect(result.current.redeemCode()).resolves.toBe(false);
    expect(presentRedeemSheet).not.toHaveBeenCalled();
  });
});

// --- 1.3: Apple win-back offers on the paywall (PR #81) -------------------------

describe("PlusProvider: paywall_viewed with a win-back offer lookup", () => {
  const OFFERED: PlusPackage = {
    ...ANNUAL,
    winBackOffer: { price: 9.99, priceString: "$9.99", cycles: 1, periodUnit: "YEAR", periodNumberOfUnits: 1 },
  };
  const paywallEvents = () =>
    (track as jest.Mock).mock.calls.filter(([name]) => name === "paywall_viewed" || name === "paywall_closed");

  function deferredPackages() {
    let resolve!: (value: PlusPackage[]) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<PlusPackage[]>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  async function renderLapsed() {
    (fetchPlusStatus as jest.Mock).mockResolvedValue(lapsed(3 * DAY));
    const hook = await renderWithListener();
    await waitFor(() => expect(hook.result.current.winBackDue).toBe(true));
    (track as jest.Mock).mockClear();
    return hook;
  }

  it("a lookup answering after the sheet shows: one paywall_viewed, with the offer", async () => {
    const { result } = await renderLapsed();
    const lookup = deferredPackages();
    (loadSdkPackages as jest.Mock).mockReturnValueOnce(lookup.promise);
    await act(async () => {
      result.current.openPaywall("win_back");
    });
    let loading!: Promise<PlusPackage[]>;
    await act(async () => {
      loading = result.current.loadPackages();
    });
    expect(loadSdkPackages).toHaveBeenCalledWith({ winBack: true });
    await act(async () => result.current.markPaywallShown());
    expect(paywallEvents()).toEqual([]);
    await act(async () => {
      lookup.resolve([OFFERED]);
      await loading;
    });
    await act(async () => result.current.closePaywall());
    expect(paywallEvents()).toEqual([
      ["paywall_viewed", { source: "win_back", feature: "offer" }],
      ["paywall_closed", { source: "win_back" }],
    ]);
  });

  it("a lookup answering before the sheet shows: one paywall_viewed on show", async () => {
    const { result } = await renderLapsed();
    (loadSdkPackages as jest.Mock).mockResolvedValueOnce([ANNUAL]);
    await act(async () => {
      result.current.openPaywall("break_down");
    });
    await act(async () => {
      await result.current.loadPackages();
    });
    expect(paywallEvents()).toEqual([]);
    await act(async () => result.current.markPaywallShown());
    await act(async () => result.current.markPaywallShown()); // a second onShow
    expect(paywallEvents()).toEqual([["paywall_viewed", { source: "break_down", feature: "plain" }]]);
  });

  it("a failed lookup counts as plain", async () => {
    const { result } = await renderLapsed();
    (loadSdkPackages as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      result.current.openPaywall("break_down");
    });
    await act(async () => result.current.markPaywallShown());
    await act(async () => {
      await result.current.loadPackages().catch(() => {});
    });
    expect(paywallEvents()).toEqual([["paywall_viewed", { source: "break_down", feature: "plain" }]]);
  });

  it("closed before the lookup answers: paywall_viewed plain, then paywall_closed, and the late answer adds nothing", async () => {
    const { result } = await renderLapsed();
    const lookup = deferredPackages();
    (loadSdkPackages as jest.Mock).mockReturnValueOnce(lookup.promise);
    await act(async () => {
      result.current.openPaywall("win_back");
    });
    let loading!: Promise<PlusPackage[]>;
    await act(async () => {
      loading = result.current.loadPackages();
    });
    await act(async () => result.current.markPaywallShown());
    await act(async () => result.current.closePaywall());
    await act(async () => {
      lookup.resolve([OFFERED]);
      await loading;
    });
    expect(paywallEvents()).toEqual([
      ["paywall_viewed", { source: "win_back", feature: "plain" }],
      ["paywall_closed", { source: "win_back" }],
    ]);
  });

  it("a stale lookup from an earlier open isn't credited to the next one", async () => {
    const { result } = await renderLapsed();
    const first = deferredPackages();
    const second = deferredPackages();
    (loadSdkPackages as jest.Mock).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    // First open: never shown, closed while its lookup is still running.
    await act(async () => {
      result.current.openPaywall("break_down");
    });
    let firstLoad!: Promise<PlusPackage[]>;
    await act(async () => {
      firstLoad = result.current.loadPackages();
    });
    await act(async () => result.current.closePaywall());
    // Second open: shown, its own lookup still running.
    await act(async () => {
      result.current.openPaywall("brain_dump");
    });
    let secondLoad!: Promise<PlusPackage[]>;
    await act(async () => {
      secondLoad = result.current.loadPackages();
    });
    await act(async () => result.current.markPaywallShown());
    // The first open's late "offer" answer must not decide the second's event.
    await act(async () => {
      first.resolve([OFFERED]);
      await firstLoad;
    });
    expect(paywallEvents()).toEqual([]);
    await act(async () => {
      second.resolve([ANNUAL]);
      await secondLoad;
    });
    expect(paywallEvents()).toEqual([["paywall_viewed", { source: "brain_dump", feature: "plain" }]]);
  });

  it("someone who never lapsed: no lookup, and exactly { source } on show", async () => {
    const { result } = await renderWithListener();
    await waitFor(() => expect(result.current.entitlementKnown).toBe(true));
    (track as jest.Mock).mockClear();
    await act(async () => {
      result.current.openPaywall("break_down");
    });
    await act(async () => {
      await result.current.loadPackages();
    });
    expect((loadSdkPackages as jest.Mock).mock.calls).toEqual([[]]);
    await act(async () => result.current.markPaywallShown());
    expect(paywallEvents()).toEqual([["paywall_viewed", { source: "break_down" }]]);
  });
});

describe("PlusProvider: buying with a win-back offer", () => {
  const OFFERED: PlusPackage = {
    ...ANNUAL,
    winBackOffer: { price: 9.99, priceString: "$9.99", cycles: 1, periodUnit: "YEAR", periodNumberOfUnits: 1 },
  };

  it("buys a plan showing an offer with that offer, and marks the funnel events", async () => {
    (purchasePackage as jest.Mock).mockResolvedValue({ outcome: "cancelled", active: false });
    const { result } = await renderHook(() => usePlus(), { wrapper });
    await act(async () => {
      result.current.openPaywall("win_back");
    });
    await act(async () => {
      await result.current.purchase(OFFERED);
    });
    expect((purchasePackage as jest.Mock).mock.calls).toEqual([["$rc_annual", { winBack: true }]]);
    expect(track).toHaveBeenCalledWith("purchase_started", { plan: "annual", source: "win_back", feature: "offer" });
    expect(track).toHaveBeenCalledWith("purchase_cancelled", {
      plan: "annual",
      source: "win_back",
      trial: false,
      feature: "offer",
    });
  });

  it.each([
    ["no offer", ANNUAL],
    ["a malformed offer", { ...OFFERED, winBackOffer: { ...OFFERED.winBackOffer!, cycles: 0 } }],
    ["lifetime (never an offer)", { ...OFFERED, id: "$rc_lifetime", kind: "lifetime" as const }],
  ])("buys a plan with %s plainly: purchase(id) and no options", async (_why, pkg) => {
    (purchasePackage as jest.Mock).mockResolvedValue({ outcome: "failed", active: false });
    const { result } = await renderHook(() => usePlus(), { wrapper });
    await act(async () => {
      await result.current.purchase(pkg);
    });
    expect((purchasePackage as jest.Mock).mock.calls).toEqual([[pkg.id]]);
    expect(track).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ feature: "offer" }));
  });
});
