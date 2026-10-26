// Lifetime after two dismissals (1.5, PR #102), through the real PlusProvider
// and the real paywall sheet: what counts as a dismissal, that the count
// survives a relaunch and "Reset all data", and what the analytics event says.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { PaywallHost } from "@/components/daily-tasks/paywall-sheet";
import { track } from "@/lib/daily-tasks/analytics";
import type { PaywallSource, PlusPackage } from "@/lib/daily-tasks/plus";
import { PAYWALL_DISMISSALS_KEY, PlusProvider, usePlus, type PlusContextValue } from "@/lib/daily-tasks/plus-context";
import {
  fetchPlusStatus,
  loadPackages,
  purchase as purchasePackage,
  restore as restorePurchases,
} from "@/lib/daily-tasks/purchases";
import { clearState } from "@/lib/daily-tasks/storage";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/purchases", () => ({
  isPaywallConfigured: () => true,
  configurePurchases: () => true,
  fetchPlusStatus: jest.fn(async () => ({ active: false, lapsedAt: null })),
  onPlusStatusChange: jest.fn(() => () => {}),
  loadPackages: jest.fn(),
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

const plan = (kind: PlusPackage["kind"], priceString: string): PlusPackage => ({
  id: `$rc_${kind}`,
  kind,
  priceString,
  pricePerMonthString: null,
  trialDays: null,
});
const PLANS = [plan("lifetime", "$79.99"), plan("monthly", "$4.99"), plan("annual", "$29.99")];

let plus: PlusContextValue;
function Probe() {
  plus = usePlus();
  return null;
}
const app = () => (
  <PlusProvider>
    <Probe />
    <PaywallHost />
  </PlusProvider>
);

beforeEach(async () => {
  await AsyncStorage.clear();
  (loadPackages as jest.Mock).mockResolvedValue(PLANS);
  (purchasePackage as jest.Mock).mockResolvedValue({ outcome: "purchased", active: true });
  (restorePurchases as jest.Mock).mockResolvedValue(true);
});
afterEach(() => {
  jest.clearAllMocks();
});

/** Open a paywall and let it get on screen (the test Modal has no onShow). */
async function openShown(source: PaywallSource) {
  await act(async () => {
    plus.openPaywall(source);
  });
  await waitFor(() => expect(screen.getByTestId("paywall-sheet")).toBeOnTheScreen());
  await act(async () => plus.markPaywallShown());
  await waitFor(() => expect(screen.getByTestId("paywall-plan-annual")).toBeOnTheScreen());
}
const dismiss = async () => {
  await fireEvent.press(screen.getByTestId("paywall-close"));
  await waitFor(() => expect(plus.paywallSource).toBeNull());
};

describe("lifetime after two dismissals", () => {
  it("is held back on the first two paywalls and shown on every one after, whatever its source", async () => {
    await render(app());
    await waitFor(() => expect(plus.paywallDismissals).toBe(0));
    for (const source of ["break_down", "evening_draft"] as const) {
      await openShown(source);
      expect(screen.queryByTestId("paywall-plan-lifetime")).toBeNull();
      await dismiss();
    }
    expect(plus.paywallDismissals).toBe(2);
    for (const source of ["brain_dump", "nag_mode", "evening_draft"] as const) {
      await openShown(source);
      expect(screen.getByTestId("paywall-plan-lifetime")).toBeOnTheScreen();
      expect(screen.getByTestId("paywall-plan-annual")).toBeOnTheScreen();
      await dismiss();
    }
  });

  it("counts a close only once the paywall was on screen", async () => {
    await render(app());
    await waitFor(() => expect(plus.paywallDismissals).toBe(0));
    await act(async () => {
      plus.openPaywall("break_down");
    });
    // iOS never presented it: no markPaywallShown.
    await act(async () => plus.closePaywall());
    expect(plus.paywallDismissals).toBe(0);
    expect(track).not.toHaveBeenCalledWith("paywall_dismissed", expect.anything());
  });

  it("does not count a close after buying, or after restoring", async () => {
    await render(app());
    await waitFor(() => expect(plus.paywallDismissals).toBe(0));
    await openShown("break_down");
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() => expect(plus.paywallSource).toBeNull());
    expect(purchasePackage).toHaveBeenCalledTimes(1);
    expect(plus.paywallDismissals).toBe(0);

    await openShown("evening_draft");
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    await waitFor(() => expect(plus.paywallSource).toBeNull());
    expect(restorePurchases).toHaveBeenCalledTimes(1);
    expect(plus.paywallDismissals).toBe(0);
    expect(track).not.toHaveBeenCalledWith("paywall_dismissed", expect.anything());
    expect(await AsyncStorage.getItem(PAYWALL_DISMISSALS_KEY)).toBeNull();
  });

  it("still counts a close after a restore that found nothing, or a purchase that was cancelled", async () => {
    (restorePurchases as jest.Mock).mockResolvedValue(false);
    (purchasePackage as jest.Mock).mockResolvedValue({ outcome: "cancelled", active: false });
    await render(app());
    await waitFor(() => expect(plus.paywallDismissals).toBe(0));
    await openShown("break_down");
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    await waitFor(() => expect(screen.getByTestId("paywall-message")).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() => expect(purchasePackage).toHaveBeenCalled());
    await dismiss();
    expect(plus.paywallDismissals).toBe(1);
  });

  it("keeps the count across launches and Reset all data, so lifetime is there on the next launch", async () => {
    const first = await render(app());
    await waitFor(() => expect(plus.paywallDismissals).toBe(0));
    for (const source of ["break_down", "brain_dump"] as const) {
      await openShown(source);
      await dismiss();
    }
    expect(await AsyncStorage.getItem(PAYWALL_DISMISSALS_KEY)).toBe("2");
    await first.unmount();

    // "Reset all data" clears the app's state, not this count (the PR's intent).
    await clearState();
    expect(await AsyncStorage.getItem(PAYWALL_DISMISSALS_KEY)).toBe("2");

    await render(app());
    await waitFor(() => expect(plus.paywallDismissals).toBe(2));
    await openShown("settings");
    expect(screen.getByTestId("paywall-plan-lifetime")).toBeOnTheScreen();
    await dismiss();
    await openShown("break_down");
    expect(screen.getByTestId("paywall-plan-lifetime")).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(PAYWALL_DISMISSALS_KEY)).toBe("3");
  });

  it("an unreadable stored count starts again from zero", async () => {
    await AsyncStorage.setItem(PAYWALL_DISMISSALS_KEY, "banana");
    await render(app());
    await waitFor(() => expect(plus.paywallDismissals).toBe(0));
    await openShown("break_down");
    expect(screen.queryByTestId("paywall-plan-lifetime")).toBeNull();
  });

  it("sends paywall_dismissed with the source and the count, and nothing else", async () => {
    await render(app());
    await waitFor(() => expect(plus.paywallDismissals).toBe(0));
    await openShown("evening_draft");
    await dismiss();
    const events = (track as jest.Mock).mock.calls.filter(([name]) => name === "paywall_dismissed");
    expect(events).toEqual([["paywall_dismissed", { source: "evening_draft", count: 1 }]]);
    // paywall_closed still goes out as before.
    expect(track).toHaveBeenCalledWith("paywall_closed", { source: "evening_draft" });
  });
});

describe("which closes count toward lifetime (review fixes)", () => {
  it("paywalls the app showed on its own (onboarding, aha, win-back) don't count", async () => {
    await render(app());
    await waitFor(() => expect(plus.paywallDismissals).toBe(0));
    for (const source of ["onboarding", "aha", "win_back"] as const) {
      await openShown(source);
      await dismiss();
    }
    expect(plus.paywallDismissals).toBe(0);
    expect(track).not.toHaveBeenCalledWith("paywall_dismissed", expect.anything());
  });

  it("a close before the plans loaded doesn't count", async () => {
    (loadPackages as jest.Mock).mockImplementation(() => new Promise(() => {}));
    await render(app());
    await waitFor(() => expect(plus.paywallDismissals).toBe(0));
    await act(async () => {
      plus.openPaywall("break_down");
    });
    await waitFor(() => expect(screen.getByTestId("paywall-sheet")).toBeOnTheScreen());
    await act(async () => plus.markPaywallShown());
    await dismiss();
    expect(plus.paywallDismissals).toBe(0);
  });

  it("a lapsed subscriber isn't offered lifetime for dismissals (a retried renewal could charge twice); Settings still shows it", async () => {
    (fetchPlusStatus as jest.Mock).mockResolvedValue({ active: false, lapsedAt: new Date(Date.now() - 86_400_000).toISOString() });
    await AsyncStorage.setItem(PAYWALL_DISMISSALS_KEY, "5");
    await render(app());
    await waitFor(() => expect(plus.subscriptionLapsed).toBe(true));
    await waitFor(() => expect(plus.paywallDismissals).toBe(5));
    await openShown("break_down");
    expect(screen.queryByTestId("paywall-plan-lifetime")).toBeNull();
    await dismiss();
    await openShown("settings");
    expect(screen.getByTestId("paywall-plan-lifetime")).toBeOnTheScreen();
    (fetchPlusStatus as jest.Mock).mockResolvedValue({ active: false, lapsedAt: null });
  });
});
