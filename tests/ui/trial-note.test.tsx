// 1.3 day-5 trial note on Today (PR #81): shown once per trial (the event once
// across launches), Close and Manage remember the dismissal, and nothing while
// the app isn't in the foreground.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { TrialNote } from "@/components/daily-tasks/trial-note";
import { track } from "@/lib/daily-tasks/analytics";
import { fetchRenewalPrice, manageSubscriptions } from "@/lib/daily-tasks/purchases";
import { recordPlusUse, setTrialActiveForUses, trialKey, type PlusTrial } from "@/lib/daily-tasks/trial-note";

import { renderWithProviders as render } from "./render";

let mockTrial: PlusTrial | null = null;
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ trial: mockTrial }),
}));
jest.mock("@/lib/daily-tasks/purchases", () => ({
  manageSubscriptions: jest.fn(async () => {}),
  fetchRenewalPrice: jest.fn(async () => null),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));

const DAY = 24 * 60 * 60_000;
const NOTE_KEY = "daily-tasks/trial-note";
const TODAY = "2026-10-01";

/** A trial on day 6 (started 5 days ago, ends in 2). */
function dayFiveTrial(): PlusTrial {
  const now = Date.now();
  return {
    startedAt: new Date(now - 5 * DAY).toISOString(),
    endsAt: new Date(now + 2 * DAY).toISOString(),
    willRenew: true,
  };
}

/** Let the note's storage reads (several awaits) finish. */
async function settle() {
  for (let i = 0; i < 3; i += 1) await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
}

const shownEvents = () => (track as jest.Mock).mock.calls.filter(([name]) => name === "trial_note_shown");

async function launch(active = true) {
  const utils = await render(<TrialNote today={TODAY} active={active} />);
  await settle();
  return utils;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockTrial = dayFiveTrial();
  setTrialActiveForUses(true);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("TrialNote", () => {
  it("shows the counts on day 5 and tracks trial_note_shown once per trial, across launches", async () => {
    await recordPlusUse("brain_dump", Date.now() - DAY);
    await recordPlusUse("break_down", Date.now() - DAY);
    const first = await launch();
    expect(screen.getByTestId("trial-note")).toHaveTextContent(/Plus sorted 1 brain dump and broke down 1 task/);
    expect(shownEvents()).toEqual([["trial_note_shown", { count: 2 }]]);
    expect(JSON.parse((await AsyncStorage.getItem(NOTE_KEY))!)).toEqual({ key: trialKey(mockTrial!), dismissed: false });
    await first.unmount();

    // Next launch: still up (not dismissed), but not counted as shown again.
    await launch();
    expect(screen.getByTestId("trial-note")).toBeOnTheScreen();
    expect(shownEvents()).toHaveLength(1);
  });

  it.each([
    ["trial-note-dismiss", "close"],
    ["trial-note-manage", "manage"],
  ] as const)("%s hides it, tracks %s, and it stays dismissed next launch", async (testID, action) => {
    const first = await launch();
    await fireEvent.press(screen.getByTestId(testID));
    await act(async () => {});
    expect(screen.queryByTestId("trial-note")).toBeNull();
    expect(track).toHaveBeenCalledWith("trial_note_dismissed", { action });
    expect(manageSubscriptions).toHaveBeenCalledTimes(action === "manage" ? 1 : 0);
    expect(JSON.parse((await AsyncStorage.getItem(NOTE_KEY))!)).toEqual({ key: trialKey(mockTrial!), dismissed: true });
    await first.unmount();

    await launch();
    expect(screen.queryByTestId("trial-note")).toBeNull();
    expect(shownEvents()).toHaveLength(1);
  });

  it("shows nothing (and tracks nothing) while the app isn't active, then shows on foreground", async () => {
    const { rerender } = await launch(false);
    expect(screen.queryByTestId("trial-note")).toBeNull();
    expect(shownEvents()).toEqual([]);
    expect(await AsyncStorage.getItem(NOTE_KEY)).toBeNull();
    await rerender(<TrialNote today={TODAY} active />);
    await settle();
    expect(screen.getByTestId("trial-note")).toBeOnTheScreen();
    expect(shownEvents()).toHaveLength(1);
  });

  it("shows nothing before day 5 or without a trial", async () => {
    // Day 4 of a 7-day trial.
    mockTrial = {
      ...dayFiveTrial(),
      startedAt: new Date(Date.now() - 3 * DAY).toISOString(),
      endsAt: new Date(Date.now() + 4 * DAY).toISOString(),
    };
    const early = await launch();
    expect(screen.queryByTestId("trial-note")).toBeNull();
    await early.unmount();
    mockTrial = null;
    await launch();
    expect(screen.queryByTestId("trial-note")).toBeNull();
    expect(shownEvents()).toEqual([]);
  });

  it("keeps its words in place while it re-checks (a new day, a foreground): no layout jump", async () => {
    const { rerender } = await launch();
    expect(screen.getByTestId("trial-note")).toBeOnTheScreen();
    // A new day starts a re-check; the note doesn't blink out meanwhile.
    await rerender(<TrialNote today="2026-10-02" active />);
    expect(screen.getByTestId("trial-note")).toBeOnTheScreen();
    await rerender(<TrialNote today="2026-10-02" active={false} />);
    expect(screen.getByTestId("trial-note")).toBeOnTheScreen();
    await settle();
    expect(screen.getByTestId("trial-note")).toBeOnTheScreen();
    expect(shownEvents()).toHaveLength(1);
  });

  it("goes when it's ruled out (the trial ended) or the trial changes", async () => {
    const { rerender } = await launch();
    expect(screen.getByTestId("trial-note")).toBeOnTheScreen();
    // A different trial (already past its end): the old words don't carry over to it.
    mockTrial = { ...dayFiveTrial(), endsAt: new Date(Date.now() - 60_000).toISOString() };
    await rerender(<TrialNote today={TODAY} active />);
    await settle();
    expect(screen.queryByTestId("trial-note")).toBeNull();
    // No trial at all.
    mockTrial = dayFiveTrial();
    await rerender(<TrialNote today={TODAY} active />);
    await settle();
    expect(screen.getByTestId("trial-note")).toBeOnTheScreen();
    mockTrial = null;
    await rerender(<TrialNote today={TODAY} active />);
    await settle();
    expect(screen.queryByTestId("trial-note")).toBeNull();
  });

  it("keeps the same note when RevenueCat's start date differs between launches", async () => {
    const first = await launch();
    await fireEvent.press(screen.getByTestId("trial-note-dismiss"));
    await first.unmount();
    mockTrial = { ...mockTrial!, startedAt: new Date(Date.now() - 4 * DAY).toISOString() };
    await launch();
    expect(screen.queryByTestId("trial-note")).toBeNull();
  });

  it("is legible and easy to hit: body text-sm, a 44 pt close, and Manage says where it goes", async () => {
    await launch();
    expect(screen.getByText(/Your trial ends/)).toHaveProp("className", expect.stringContaining("text-sm"));
    expect(screen.getByTestId("trial-note-dismiss")).toHaveStyle({ width: 44, height: 44 });
    expect(screen.getByRole("button", { name: "Manage subscription" })).toHaveProp(
      "accessibilityHint",
      "Opens your App Store subscription settings",
    );
  });
});

// PR #83: the renewing line names the store's price; a cancelled trial never asks for one.
describe("TrialNote: the renewal price", () => {
  const fetchPrice = fetchRenewalPrice as jest.Mock;
  afterEach(() => {
    fetchPrice.mockReset();
    fetchPrice.mockImplementation(async () => null);
  });

  it("asks for the trial's product and names its price, with the day to cancel by", async () => {
    mockTrial = { ...dayFiveTrial(), productId: "plus_annual" };
    fetchPrice.mockResolvedValueOnce({ priceString: "$29.99", period: "year" });
    await launch();
    expect(fetchPrice).toHaveBeenCalledWith("plus_annual");
    // Ends in two days: the day before is tomorrow.
    expect(screen.getByTestId("trial-note")).toHaveTextContent(
      /then Plus renews at \$29\.99\/year\. Not for you\? Cancel by tomorrow with Manage below\./,
    );
  });

  it("keeps the old line when the price is unknown or the lookup rejects", async () => {
    mockTrial = { ...dayFiveTrial(), productId: "plus_annual" };
    fetchPrice.mockRejectedValueOnce(new Error("offline"));
    await launch();
    expect(screen.getByTestId("trial-note")).toHaveTextContent(/then Plus continues as your subscription/);
    expect(screen.getByTestId("trial-note")).not.toHaveTextContent(/renews at/);
  });

  it("never fetches a price for a cancelled trial", async () => {
    mockTrial = { ...dayFiveTrial(), productId: "plus_annual", willRenew: false };
    fetchPrice.mockResolvedValue({ priceString: "$29.99", period: "year" });
    await launch();
    expect(screen.getByTestId("trial-note")).toHaveTextContent(/won't renew/);
    expect(fetchPrice).not.toHaveBeenCalled();
  });
});
