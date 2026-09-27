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
