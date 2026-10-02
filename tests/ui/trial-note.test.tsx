// 1.3 day-5 trial note on Today (PR #81): shown once per trial (the event once
// across launches), Close and Manage remember the dismissal, and nothing while
// the app isn't in the foreground.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen } from "@testing-library/react-native";

import { TrialNote } from "@/components/daily-tasks/trial-note";
import { track } from "@/lib/daily-tasks/analytics";
import { manageSubscriptions } from "@/lib/daily-tasks/purchases";
import { recordPlusUse, trialKey, type PlusTrial } from "@/lib/daily-tasks/trial-note";

import { renderWithProviders as render } from "./render";

let mockTrial: PlusTrial | null = null;
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ trial: mockTrial }),
}));
jest.mock("@/lib/daily-tasks/purchases", () => ({
  manageSubscriptions: jest.fn(async () => {}),
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
    mockTrial = { ...dayFiveTrial(), startedAt: new Date(Date.now() - 3 * DAY).toISOString() };
    const early = await launch();
    expect(screen.queryByTestId("trial-note")).toBeNull();
    await early.unmount();
    mockTrial = null;
    await launch();
    expect(screen.queryByTestId("trial-note")).toBeNull();
    expect(shownEvents()).toEqual([]);
  });
});
