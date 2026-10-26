// 1.6: a new install's "Save for later from anywhere" Today card
// (first-days-cards.tsx). Around day three, after something was ticked; never
// on a day another first-days card showed; not once something was captured;
// once. Its "Show me" opens the same how-to as What's new's first card.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";

import { FirstDaysCards } from "@/components/daily-tasks/first-days-cards";
import { track } from "@/lib/daily-tasks/analytics";
import {
  addDays,
  FIRST_DAYS_KEY,
  FIRST_DAYS_SHOWN_KEY,
  saveFirstDays,
  startFirstDays,
  type FirstDaysRecord,
} from "@/lib/daily-tasks/first-days";
import type { NotificationPermissionState } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));

const D1 = "2026-10-20";
const D2 = addDays(D1, 1);
const D3 = addDays(D1, 2);
const D4 = addDays(D1, 3);
const originalOS = Platform.OS;

type Props = Parameters<typeof FirstDaysCards>[0];
const props = (over: Partial<Props> = {}): Props => ({
  today: D3,
  active: true,
  version: 0,
  checkedOff: false,
  dayFinished: false,
  // Granted: no nudge card in the way.
  permission: "granted",
  onAskNudge: jest.fn(async () => "granted" as NotificationPermissionState),
  tickedEver: true,
  ...over,
});

/** First run on D1 and opened on D2, without the Nag card (it has its own tests). */
const opened = (days: string[] = [D1, D2]): FirstDaysRecord => {
  const { nagCardFrom: _a, nagCardUntil: _b, nagIntro: _c, nagIntroOpen: _d, ...record } = startFirstDays(D1);
  return { ...record, openDays: days };
};
const stored = async (): Promise<FirstDaysRecord> => JSON.parse((await AsyncStorage.getItem(FIRST_DAYS_KEY)) ?? "null");
const card = () => screen.queryByTestId("capture-card");
const cardEvents = () =>
  (track as jest.Mock).mock.calls.filter(([name]) => name === "first_days_card").map(([, p]) => p);
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => {});
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  Platform.OS = "ios";
});
afterEach(() => {
  Platform.OS = originalOS;
});

describe("when it shows", () => {
  it("on the third day of use, once something was ticked: the words, a header, two 44 pt buttons", async () => {
    await saveFirstDays(opened());
    await render(<FirstDaysCards {...props()} />);
    await waitFor(() => expect(card()).toBeOnTheScreen());
    expect(screen.getByRole("header", { name: "Save for later from anywhere" })).toBeOnTheScreen();
    expect(
      screen.getByText("Share from any app, or tell Siri “Save for later in Three Today”. It waits in Ideas, never on today's three."),
    ).toBeOnTheScreen();
    for (const name of ["How it works", "Got it"]) {
      expect(screen.getByRole("button", { name }).props.style).toMatchObject({ minHeight: 44 });
    }
    expect(cardEvents()).toEqual([{ kind: "capture", action: "shown" }]);
    // Marked as shown on its day.
    expect(await stored()).toMatchObject({ captureCard: "shown", captureCardOn: D3 });
  });

  it("not on day two, and not before something was ticked", async () => {
    await saveFirstDays(opened([D1]));
    const { rerender } = await render(<FirstDaysCards {...props({ today: D2 })} />);
    await settle();
    expect(card()).toBeNull();
    await rerender(<FirstDaysCards {...props({ today: D3, version: 1, tickedEver: false })} />);
    await settle();
    expect(card()).toBeNull();
    await rerender(<FirstDaysCards {...props({ today: D3, version: 2 })} />);
    await waitFor(() => expect(card()).toBeOnTheScreen());
  });

  it("skipped once something was saved from the share sheet or Siri", async () => {
    await saveFirstDays(opened());
    await render(<FirstDaysCards {...props({ capturedEver: true })} />);
    await settle();
    expect(card()).toBeNull();
    expect(cardEvents()).toEqual([]);
  });

  it("never on a day another first-days card showed (here the widget tip, earlier today)", async () => {
    await saveFirstDays(opened());
    await AsyncStorage.setItem(FIRST_DAYS_SHOWN_KEY, JSON.stringify({ widget: D3 }));
    const { rerender } = await render(<FirstDaysCards {...props()} />);
    await settle();
    expect(card()).toBeNull();
    // The next day it may.
    await rerender(<FirstDaysCards {...props({ today: D4 })} />);
    await waitFor(() => expect(card()).toBeOnTheScreen());
  });

  it("one card at a time: the nudge goes first, and then the capture card waits for another day", async () => {
    await saveFirstDays({ ...opened(), nudgeFrom: D3 });
    const { rerender } = await render(<FirstDaysCards {...props({ permission: "undetermined" })} />);
    await waitFor(() => expect(screen.getByTestId("nudge-card")).toBeOnTheScreen());
    expect(card()).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
    await settle();
    // The nudge showed today: not the capture card as well.
    expect(screen.queryByTestId("nudge-card")).toBeNull();
    expect(card()).toBeNull();
    await rerender(<FirstDaysCards {...props({ today: D4 })} />);
    await waitFor(() => expect(card()).toBeOnTheScreen());
  });

  it("the day it showed is its own: a nudge that comes due later that day waits", async () => {
    await saveFirstDays(opened());
    const { rerender } = await render(<FirstDaysCards {...props()} />);
    await waitFor(() => expect(card()).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole("button", { name: "Got it" }));
    await settle();
    // A tick today brings a waiting nudge forward to today: still not today.
    await rerender(<FirstDaysCards {...props({ checkedOff: true, permission: "undetermined" })} />);
    await settle();
    expect(screen.queryByTestId("nudge-card")).toBeNull();
  });
});

describe("it shows once", () => {
  it("Got it: gone, and never back", async () => {
    await saveFirstDays(opened());
    const { rerender } = await render(<FirstDaysCards {...props()} />);
    await waitFor(() => expect(card()).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole("button", { name: "Got it" }));
    expect(card()).toBeNull();
    expect(cardEvents()).toContainEqual({ kind: "capture", action: "dismissed" });
    expect((await stored()).captureCard).toBe("done");
    await rerender(<FirstDaysCards {...props({ today: D4, version: 1 })} />);
    await settle();
    expect(card()).toBeNull();
  });

  it("left alone: it stays for the day, and is gone the next", async () => {
    await saveFirstDays(opened());
    const { rerender } = await render(<FirstDaysCards {...props()} />);
    await waitFor(() => expect(card()).toBeOnTheScreen());
    await rerender(<FirstDaysCards {...props({ version: 1 })} />);
    await settle();
    expect(card()).toBeOnTheScreen();
    await rerender(<FirstDaysCards {...props({ today: D4, version: 2 })} />);
    await settle();
    expect(card()).toBeNull();
    expect((await stored()).captureCard).toBe("done");
  });
});

describe("How it works", () => {
  it("opens the same how-to as What's new, in place; ids only in the events", async () => {
    await saveFirstDays(opened());
    await render(<FirstDaysCards {...props()} />);
    await waitFor(() => expect(card()).toBeOnTheScreen());
    const showMe = screen.getByRole("button", { name: "How it works" });
    expect(showMe.props.accessibilityState).toMatchObject({ expanded: false });
    await fireEvent.press(showMe);
    expect(screen.getByTestId("capture-card-how-to")).toBeOnTheScreen();
    expect(screen.getByText("Say to Siri: “Save for later in Three Today”.")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "In Safari or any app, tap Share on text or a link. Pick Three Today. Not there? Scroll the app row, tap More, and turn it on.",
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText(/^For a quick brain dump, add the Dump widget\./)).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "How it works" }).props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.getByText("Hide")).toBeOnTheScreen();
    // Still on screen: How it works doesn't dismiss it.
    expect(card()).toBeOnTheScreen();
    expect(cardEvents()).toEqual([
      { kind: "capture", action: "shown" },
      { kind: "capture", action: "how_to" },
    ]);
  });
});
