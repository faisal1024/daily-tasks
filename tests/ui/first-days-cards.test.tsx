// 1.5 A: the Today cards that replaced first run's nudge and widget screens
// (components/daily-tasks/first-days-cards.tsx). Day keys are plain local
// strings, so the suite reads the same in every time zone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";

import { FirstDaysCards } from "@/components/daily-tasks/first-days-cards";
import { track } from "@/lib/daily-tasks/analytics";
import {
  __newLaunchForTests,
  FIRST_DAYS_KEY,
  FIRST_DAYS_SHOWN_KEY,
  loadFirstDays,
  saveFirstDays,
  startFirstDays,
  type FirstDaysRecord,
} from "@/lib/daily-tasks/first-days";
import type { NotificationPermissionState } from "@/lib/daily-tasks/types";
import { clearState } from "@/lib/daily-tasks/storage";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));

const D1 = "2026-10-01";
const originalOS = Platform.OS;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Props = Parameters<typeof FirstDaysCards>[0];
const props = (over: Partial<Props> = {}): Props => ({
  today: D1,
  active: true,
  version: 0,
  checkedOff: false,
  dayFinished: false,
  permission: "undetermined",
  onAskNudge: jest.fn(async () => "granted" as NotificationPermissionState),
  ...over,
});

const seed = (record: FirstDaysRecord) => saveFirstDays(record);
/**
 * First run's record without 1.5 D's Nag card and sheet: these tests are
 * about the nudge and the widget tip (the Nag card has its own tests).
 */
const aRecord = (day: string): FirstDaysRecord => {
  const { nagCardFrom, nagCardUntil, nagIntro, nagIntroOpen, ...record } = startFirstDays(day);
  void [nagCardFrom, nagCardUntil, nagIntro, nagIntroOpen];
  return record;
};
/** A record whose nudge is due on D1 (first run ended the day before, or a task was checked off). */
const nudgeDue = (): FirstDaysRecord => ({ ...aRecord(D1), nudgeFrom: D1 });
const stored = async () => JSON.parse((await AsyncStorage.getItem(FIRST_DAYS_KEY)) ?? "null");
const cardEvents = () =>
  (track as jest.Mock).mock.calls.filter(([name]) => name === "first_days_card").map(([, p]) => p);
const nudge = () => screen.queryByTestId("nudge-card");
const tip = () => screen.queryByTestId("widget-tip");

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  Platform.OS = "ios";
});
afterEach(() => {
  Platform.OS = originalOS;
});

describe("nudge card", () => {
  it("shows only while the permission is undetermined", async () => {
    await seed(nudgeDue());
    const { rerender } = await render(<FirstDaysCards {...props()} />);
    await waitFor(() => expect(nudge()).toBeOnTheScreen());
    expect(screen.getByText("Want a nudge in the morning?")).toBeOnTheScreen();
    for (const permission of ["granted", "denied"] as const) {
      await rerender(<FirstDaysCards {...props({ permission })} />);
      expect(nudge()).toBeNull();
    }
    await rerender(<FirstDaysCards {...props({ permission: undefined })} />);
    expect(nudge()).toBeNull();
    await rerender(<FirstDaysCards {...props()} />);
    expect(nudge()).toBeOnTheScreen();
  });

  it("never shows for an install that updated from 1.4 (no record), and logs nothing", async () => {
    await render(<FirstDaysCards {...props({ dayFinished: true })} />);
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect(nudge()).toBeNull();
    expect(tip()).toBeNull();
    expect(cardEvents()).toEqual([]);
    expect(await AsyncStorage.getItem(FIRST_DAYS_KEY)).toBeNull();
  });

  it("stays away while first run (or a background launch) is up", async () => {
    await seed(nudgeDue());
    await render(<FirstDaysCards {...props({ active: false })} />);
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect(nudge()).toBeNull();
    expect(cardEvents()).toEqual([]);
  });

  it("Not now hides it for 3 days; the second Not now retires it for good", async () => {
    await seed(nudgeDue());
    const { rerender } = await render(<FirstDaysCards {...props()} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Not now" }));
    expect(nudge()).toBeNull();
    expect(await stored()).toEqual({ nudgeFrom: "2026-10-04", nudgeDeclines: 1, widgetTip: "waiting" });

    for (const day of ["2026-10-02", "2026-10-03"]) {
      await rerender(<FirstDaysCards {...props({ today: day })} />);
      for (let i = 0; i < 3; i++) await act(async () => {});
      expect(nudge()).toBeNull();
    }
    await rerender(<FirstDaysCards {...props({ today: "2026-10-04" })} />);
    await waitFor(() => expect(nudge()).toBeOnTheScreen());

    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
    expect(await stored()).toEqual({ nudgeFrom: null, nudgeDeclines: 2, widgetTip: "waiting" });
    for (const day of ["2026-10-07", "2026-11-30"]) {
      await rerender(<FirstDaysCards {...props({ today: day })} />);
      for (let i = 0; i < 3; i++) await act(async () => {});
      expect(nudge()).toBeNull();
    }
    expect(cardEvents().filter((e) => e.action === "not_now")).toHaveLength(2);
  });

  it("Yes asks once: while iOS is asking the button says so and a second tap does nothing", async () => {
    await seed(nudgeDue());
    const answer = deferred<NotificationPermissionState>();
    const onAskNudge = jest.fn(() => answer.promise);
    await render(<FirstDaysCards {...props({ onAskNudge })} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Yes, remind me" }));
    expect(onAskNudge).toHaveBeenCalledTimes(1);
    // While iOS is asking, the card says so and neither button answers.
    const asking = screen.getByRole("button", { name: "Asking…" });
    await fireEvent.press(asking);
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
    expect(onAskNudge).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve("denied"));
    expect(nudge()).toBeNull();
    // Retired by the Yes, whatever iOS said; Not now never counted.
    expect(await stored()).toMatchObject({ nudgeFrom: null, nudgeDeclines: 0 });
    expect(cardEvents().filter((e) => e.action === "yes")).toEqual([{ kind: "nudge", action: "yes", outcome: "denied" }]);
    expect(cardEvents().filter((e) => e.action === "not_now")).toEqual([]);
  });

  // Was a real bug (PR #104 review): yes() guarded on state, so two taps in
  // one frame both asked. It guards on a ref now.
  it("Yes asks once even when a double tap lands in the same frame", async () => {
    await seed(nudgeDue());
    const answer = deferred<NotificationPermissionState>();
    const onAskNudge = jest.fn(() => answer.promise);
    await render(<FirstDaysCards {...props({ onAskNudge })} />);
    const yes = await screen.findByRole("button", { name: "Yes, remind me" });
    await act(async () => {
      void fireEvent.press(yes);
      void fireEvent.press(yes);
    });
    expect(onAskNudge).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve("granted"));
    expect(cardEvents().filter((e) => e.action === "yes")).toHaveLength(1);
  });

  it("a prompt that throws still retires the card (Settings › Reminders has it)", async () => {
    await seed(nudgeDue());
    const onAskNudge = jest.fn(async () => {
      throw new Error("boom");
    });
    await render(<FirstDaysCards {...props({ onAskNudge })} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Yes, remind me" }));
    await waitFor(() => expect(nudge()).toBeNull());
    expect((await stored()).nudgeFrom).toBeNull();
  });
});

describe("widget tip", () => {
  const waiting = () => aRecord(D1);

  it("is earned on the first finished day but never shown in that session: it's due from the next open", async () => {
    await seed({ ...waiting(), nudgeFrom: null });
    const { rerender, unmount } = await render(<FirstDaysCards {...props({ permission: "granted" })} />);
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(tip()).toBeNull();
    await rerender(<FirstDaysCards {...props({ permission: "granted", dayFinished: true })} />);
    await waitFor(async () => expect((await stored()).widgetTip).toBe("earned"));
    for (let i = 0; i < 3; i++) await act(async () => {});
    // Not on the finished-day moment.
    expect(tip()).toBeNull();
    // Back from the background, or remounted elsewhere on Today: same launch, still not shown.
    await rerender(<FirstDaysCards {...props({ permission: "granted", dayFinished: true, active: false })} />);
    await rerender(<FirstDaysCards {...props({ permission: "granted", dayFinished: true })} />);
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(tip()).toBeNull();
    await unmount();
    const again = await render(<FirstDaysCards {...props({ permission: "granted", dayFinished: true })} />);
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(tip()).toBeNull();
    expect((await stored()).widgetTip).toBe("earned");
    await again.unmount();
    // A new launch: due now.
    __newLaunchForTests();
    await render(<FirstDaysCards {...props({ permission: "granted", dayFinished: true })} />);
    await waitFor(() => expect(tip()).toBeOnTheScreen());
    expect(screen.getByText("Keep your three on your Home Screen")).toBeOnTheScreen();
    expect((await stored()).widgetTip).toBe("due");
  });

  it("an earned tip is due on the next launch, or the next day", async () => {
    await seed({ ...waiting(), nudgeFrom: null, widgetTip: "earned" });
    const first = await render(<FirstDaysCards {...props({ permission: "granted" })} />);
    await waitFor(() => expect(tip()).toBeOnTheScreen());
    await first.unmount();

    await seed({ ...waiting(), nudgeFrom: null });
    const { rerender } = await render(<FirstDaysCards {...props({ permission: "granted", dayFinished: true })} />);
    await waitFor(async () => expect((await stored()).widgetTip).toBe("earned"));
    expect(tip()).toBeNull();
    await rerender(<FirstDaysCards {...props({ permission: "granted", today: "2026-10-02" })} />);
    await waitFor(() => expect(tip()).toBeOnTheScreen());
  });

  it("stays on later launches (day no longer finished) until dismissed, then never comes back", async () => {
    await seed({ ...waiting(), nudgeFrom: null, widgetTip: "due" });
    const first = await render(<FirstDaysCards {...props({ permission: "granted", today: "2026-10-02" })} />);
    await waitFor(() => expect(tip()).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole("button", { name: "Dismiss widget tip" }));
    expect(tip()).toBeNull();
    expect((await stored()).widgetTip).toBe("done");
    expect(cardEvents().filter((e) => e.kind === "widget" && e.action === "dismissed")).toHaveLength(1);
    await first.unmount();

    // Next launch, even on another finished day: gone for good.
    await render(<FirstDaysCards {...props({ permission: "granted", today: "2026-10-09", dayFinished: true })} />);
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect(tip()).toBeNull();
  });

  it("is iOS only", async () => {
    Platform.OS = "android";
    await seed({ ...waiting(), nudgeFrom: null, widgetTip: "due" });
    await render(<FirstDaysCards {...props({ permission: "granted" })} />);
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect(tip()).toBeNull();
    expect(cardEvents()).toEqual([]);
  });

  it("never shows alongside the nudge: the nudge goes first, the tip follows once it's answered", async () => {
    await seed({ ...nudgeDue(), widgetTip: "due" });
    await render(<FirstDaysCards {...props()} />);
    await waitFor(() => expect(nudge()).toBeOnTheScreen());
    expect(tip()).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
    // Snoozed for 3 days: the tip may take the slot meanwhile, never both at once.
    await waitFor(() => expect(tip()).toBeOnTheScreen());
    expect(nudge()).toBeNull();
  });
});

describe("first_days_card analytics: ids only", () => {
  const ALLOWED = {
    kind: ["nudge", "widget"],
    action: ["shown", "yes", "not_now", "dismissed"],
    outcome: ["granted", "denied", "undetermined"],
  } as const;

  it("every event carries only kind/action/outcome drawn from the fixed ids (no text, dates or counts)", async () => {
    await seed({ ...nudgeDue(), widgetTip: "due" });
    const { rerender } = await render(<FirstDaysCards {...props()} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Yes, remind me" }));
    await waitFor(() => expect(nudge()).toBeNull());
    await rerender(<FirstDaysCards {...props({ permission: "granted" })} />);
    await fireEvent.press(await screen.findByRole("button", { name: "Dismiss widget tip" }));

    const events = cardEvents();
    expect(events).toEqual([
      { kind: "nudge", action: "shown" },
      { kind: "nudge", action: "yes", outcome: "granted" },
      { kind: "widget", action: "shown" },
      { kind: "widget", action: "dismissed" },
    ]);
    for (const event of events) {
      for (const [key, value] of Object.entries(event)) {
        expect(Object.keys(ALLOWED)).toContain(key);
        expect(ALLOWED[key as keyof typeof ALLOWED] as readonly string[]).toContain(value);
      }
    }
  });

  it("'shown' is logged once per card per day, again on the next day", async () => {
    await seed(nudgeDue());
    const { rerender } = await render(<FirstDaysCards {...props()} />);
    await waitFor(() => expect(nudge()).toBeOnTheScreen());
    await rerender(<FirstDaysCards {...props({ version: 1 })} />);
    await rerender(<FirstDaysCards {...props({ version: 1, dayFinished: false })} />);
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(cardEvents().filter((e) => e.action === "shown")).toHaveLength(1);
    await rerender(<FirstDaysCards {...props({ today: "2026-10-02" })} />);
    await waitFor(() => expect(cardEvents().filter((e) => e.action === "shown")).toHaveLength(2));
  });
});

describe("the record is read again when first run writes a fresh one", () => {
  it("a bumped version shows the card that a missing record hid", async () => {
    const { rerender } = await render(<FirstDaysCards {...props()} />);
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(nudge()).toBeNull();
    await seed(nudgeDue());
    expect(await loadFirstDays()).not.toBeNull();
    await rerender(<FirstDaysCards {...props({ version: 1 })} />);
    await waitFor(() => expect(nudge()).toBeOnTheScreen());
  });
});

describe("nudge card timing (review fix)", () => {
  it("not on the first-run day until a task is checked off; then today", async () => {
    await seed(aRecord(D1));
    const { rerender } = await render(<FirstDaysCards {...props()} />);
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect(nudge()).toBeNull();
    await rerender(<FirstDaysCards {...props({ checkedOff: true })} />);
    await waitFor(() => expect(nudge()).toBeOnTheScreen());
    expect((await stored()).nudgeFrom).toBe(D1);
  });

  it("without a check-off it shows the next day", async () => {
    await seed(aRecord(D1));
    await render(<FirstDaysCards {...props({ today: "2026-10-02" })} />);
    await waitFor(() => expect(nudge()).toBeOnTheScreen());
  });

  it("a check-off never brings a snoozed nudge forward", async () => {
    await seed({ ...aRecord(D1), nudgeFrom: "2026-10-04", nudgeDeclines: 1 });
    await render(<FirstDaysCards {...props({ today: "2026-10-02", checkedOff: true })} />);
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect(nudge()).toBeNull();
    expect((await stored()).nudgeFrom).toBe("2026-10-04");
  });
});

describe("Reset all data", () => {
  it("removes the first-days record too, so the next first run starts it fresh", async () => {
    await seed({ ...nudgeDue(), nudgeDeclines: 2, nudgeFrom: null, widgetTip: "done" });
    expect(await AsyncStorage.getItem(FIRST_DAYS_KEY)).not.toBeNull();
    await AsyncStorage.setItem(FIRST_DAYS_SHOWN_KEY, JSON.stringify({ nudge: D1 }));
    await clearState();
    expect(await AsyncStorage.getItem(FIRST_DAYS_KEY)).toBeNull();
    expect(await AsyncStorage.getItem(FIRST_DAYS_SHOWN_KEY)).toBeNull();
  });
});

describe("review fixes: finished day, remounts", () => {
  it("no nudge on a finished day (it would sit on the done card); it's back once the day isn't finished", async () => {
    await seed(nudgeDue());
    const { rerender } = await render(<FirstDaysCards {...props({ dayFinished: true, checkedOff: true })} />);
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect(nudge()).toBeNull();
    await rerender(<FirstDaysCards {...props({ today: "2026-10-02" })} />);
    await waitFor(() => expect(nudge()).toBeOnTheScreen());
  });

  it("'shown' goes out once a day even when the card remounts or the app relaunches", async () => {
    await seed(nudgeDue());
    const first = await render(<FirstDaysCards {...props()} />);
    await waitFor(() => expect(nudge()).toBeOnTheScreen());
    await waitFor(() => expect(cardEvents().filter((e) => e.action === "shown")).toHaveLength(1));
    await first.unmount();
    __newLaunchForTests();
    await render(<FirstDaysCards {...props()} />);
    await waitFor(() => expect(nudge()).toBeOnTheScreen());
    for (let i = 0; i < 4; i++) await act(async () => {});
    expect(cardEvents().filter((e) => e.action === "shown")).toHaveLength(1);
  });
});
